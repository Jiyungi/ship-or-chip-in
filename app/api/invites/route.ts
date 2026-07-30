import { env } from "cloudflare:workers";
import { auth0 } from "../../../lib/auth0";

export async function POST(request: Request) {
  const session = await auth0.getSession();
  const sub =
    session && typeof session.user.sub === "string" ? session.user.sub : "";
  if (!sub) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const db = env.DB;
  const member = await db
    .prepare("SELECT team_id, name FROM members WHERE auth0_sub = ?")
    .bind(sub)
    .first<{ team_id: string; name: string }>();
  if (!member) {
    return Response.json(
      { error: "Open the dashboard once before creating an invite." },
      { status: 409 },
    );
  }

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS invitations (
        token TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        created_by_sub TEXT NOT NULL,
        used_by_sub TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .run();

  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO invitations (token, team_id, created_by_sub, expires_at) VALUES (?, ?, ?, ?)",
      )
      .bind(token, member.team_id, sub, expiresAt),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'neutral')",
      )
      .bind(
        crypto.randomUUID(),
        member.team_id,
        `${member.name} created a seven-day team invite.`,
      ),
  ]);

  return Response.json({
    url: new URL(`/join/${token}`, request.url).toString(),
    expiresAt,
  });
}
