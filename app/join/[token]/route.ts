import { env } from "cloudflare:workers";
import { auth0 } from "../../../lib/auth0";

function initialsFor(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "TM"
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const session = await auth0.getSession();
  if (!session) {
    const returnTo = `/join/${encodeURIComponent(token)}`;
    return Response.redirect(
      new URL(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`, request.url),
      302,
    );
  }

  const sub =
    typeof session.user.sub === "string" ? session.user.sub : "";
  if (!sub) return Response.redirect(new URL("/?invite=invalid", request.url), 302);

  const db = env.DB;
  const invite = await db
    .prepare(
      "SELECT team_id, used_by_sub, expires_at FROM invitations WHERE token = ?",
    )
    .bind(token)
    .first<{
      team_id: string;
      used_by_sub: string | null;
      expires_at: string;
    }>();

  if (
    !invite ||
    invite.used_by_sub ||
    new Date(invite.expires_at).getTime() < Date.now()
  ) {
    return Response.redirect(new URL("/?invite=invalid", request.url), 302);
  }

  const existing = await db
    .prepare("SELECT id FROM members WHERE auth0_sub = ?")
    .bind(sub)
    .first();
  const email =
    typeof session.user.email === "string" ? session.user.email : "";
  const name =
    typeof session.user.name === "string" && session.user.name.trim()
      ? session.user.name.trim()
      : email
        ? email.split("@")[0]
        : "Teammate";

  const statements = [
    db
      .prepare(
        "UPDATE invitations SET used_by_sub = ? WHERE token = ? AND used_by_sub IS NULL",
      )
      .bind(sub, token),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'success')",
      )
      .bind(
        crypto.randomUUID(),
        invite.team_id,
        `${name} accepted a team invitation.`,
      ),
  ];

  if (!existing) {
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM members WHERE team_id = ?")
      .bind(invite.team_id)
      .first<{ count: number }>();
    const colors = ["#64c7bc", "#9887ef", "#ffcc45", "#ff6542"];
    statements.unshift(
      db
        .prepare(
          "INSERT INTO members (id, team_id, name, email, initials, color, role, auth0_sub) VALUES (?, ?, ?, ?, ?, ?, 'member', ?)",
        )
        .bind(
          crypto.randomUUID(),
          invite.team_id,
          name,
          email,
          initialsFor(name),
          colors[Number(count?.count ?? 0) % colors.length],
          sub,
        ),
    );
  }

  await db.batch(statements);
  return Response.redirect(new URL("/?joined=1", request.url), 302);
}
