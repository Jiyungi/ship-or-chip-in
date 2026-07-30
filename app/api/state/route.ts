import { env } from "cloudflare:workers";
import type Stripe from "stripe";
import { auth0, isAuth0Configured } from "../../../lib/auth0";
import {
  completeContribution,
  failContribution,
} from "../../../lib/contributions";
import { getStripe } from "../../../lib/stripe";

const TEAM_ID = "team_launch_club";
const REVIEW_THRESHOLD = 2;
const APPEAL_GRACE_MS = 24 * 60 * 60 * 1000;
const DEMO_CHARGE_DELAY_MS = 30 * 1000;

type Viewer = {
  sub: string;
  name: string;
  email: string;
  initials: string;
};

type TeamMember = {
  id: string;
  team_id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: string;
  auth0_sub: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
};

type CreatePactPayload = {
  action: "create";
  title?: string;
  assigneeId?: string;
  dueAt?: string;
  stakeCents?: number;
  criteria?: string[];
  contributionAuthorized?: boolean;
};

type SubmitPayload = {
  action: "submit";
  pactId?: string;
  note?: string;
  workUrl?: string;
};

type ImportNotesPayload = {
  action: "importNotes";
  notes?: string;
  dueAt?: string;
};

type ReviewPayload = {
  action: "review";
  pactId?: string;
  decision?: "approve" | "reject";
};

type AppealPayload = {
  action: "appeal";
  pactId?: string;
  category?: "health" | "family" | "other";
  note?: string;
  requestedDueAt?: string;
};

type ResolveAppealPayload = {
  action: "resolveAppeal";
  appealId?: string;
  decision?: "approve" | "reject";
};

type ResetPayload = {
  action: "reset";
};

type ActionPayload =
  | CreatePactPayload
  | SubmitPayload
  | ImportNotesPayload
  | ReviewPayload
  | AppealPayload
  | ResolveAppealPayload
  | ResetPayload;

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

function formatDueLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function parseMeetingTasks(
  notes: string,
  members: Array<{ id: string; name: string }>,
) {
  const tasks: Array<{ assigneeId: string; title: string }> = [];
  const seen = new Set<string>();

  for (const rawLine of notes.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "");
    if (!line) continue;

    for (const member of members) {
      const escapedName = member.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const patterns = [
        new RegExp(
          `^(?:action(?: item)?\\s*[:\\-]\\s*)?@?${escapedName}\\s*(?::|[-–—])\\s*(.+)$`,
          "i",
        ),
        new RegExp(
          `^@?${escapedName}\\s+(?:will|to|owns?|is responsible for)\\s+(.+)$`,
          "i",
        ),
      ];
      const match = patterns
        .map((pattern) => line.match(pattern))
        .find(Boolean);
      const title = match?.[1]?.trim().replace(/[.;]+$/, "");
      if (!title) continue;

      const key = `${member.id}:${title.toLowerCase()}`;
      if (!seen.has(key)) {
        tasks.push({ assigneeId: member.id, title: title.slice(0, 160) });
        seen.add(key);
      }
      break;
    }
    if (tasks.length >= 20) break;
  }

  return tasks;
}

async function getViewer(): Promise<Viewer | null> {
  if (!isAuth0Configured()) {
    return {
      sub: "demo|jiyun",
      name: "Jiyun",
      email: "jiyun@example.com",
      initials: "JK",
    };
  }

  const session = await auth0.getSession();
  if (!session) return null;

  const sub =
    typeof session.user.sub === "string" ? session.user.sub : "";
  if (!sub) return null;
  const email =
    typeof session.user.email === "string" ? session.user.email : "";
  const name =
    typeof session.user.name === "string" && session.user.name.trim()
      ? session.user.name.trim()
      : email
        ? email.split("@")[0]
        : "Teammate";

  return { sub, name, email, initials: initialsFor(name) };
}

async function setup() {
  const db = env.DB;
  if (!db) throw new Error("Database binding unavailable");

  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pot_cents INTEGER NOT NULL DEFAULT 0,
        plan TEXT NOT NULL DEFAULT 'free',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        initials TEXT NOT NULL,
        color TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        auth0_sub TEXT,
        stripe_customer_id TEXT,
        stripe_payment_method_id TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pacts (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        title TEXT NOT NULL,
        assignee_id TEXT NOT NULL,
        due_label TEXT NOT NULL,
        due_at TEXT,
        stake_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        criteria TEXT NOT NULL,
        submission_note TEXT,
        submission_url TEXT,
        contribution_authorized INTEGER NOT NULL DEFAULT 0,
        contribution_status TEXT NOT NULL DEFAULT 'none',
        charge_after_at TEXT,
        stripe_payment_intent_id TEXT,
        approvals INTEGER NOT NULL DEFAULT 0,
        rejections INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        body TEXT NOT NULL,
        tone TEXT NOT NULL DEFAULT 'neutral',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        pact_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        provider TEXT NOT NULL DEFAULT 'stripe_test',
        status TEXT NOT NULL DEFAULT 'succeeded',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS review_votes (
        pact_id TEXT NOT NULL,
        voter_sub TEXT NOT NULL,
        decision TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pact_id, voter_sub)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS appeals (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        pact_id TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        category TEXT NOT NULL,
        note TEXT,
        requested_due_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resolved_by_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS invitations (
        token TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        created_by_sub TEXT NOT NULL,
        used_by_sub TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
  ]);

  await Promise.allSettled([
    db.prepare("ALTER TABLE teams ADD COLUMN stripe_customer_id TEXT").run(),
    db.prepare("ALTER TABLE teams ADD COLUMN stripe_subscription_id TEXT").run(),
    db.prepare("ALTER TABLE members ADD COLUMN auth0_sub TEXT").run(),
    db.prepare("ALTER TABLE members ADD COLUMN stripe_customer_id TEXT").run(),
    db.prepare("ALTER TABLE members ADD COLUMN stripe_payment_method_id TEXT").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN due_at TEXT").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN submission_url TEXT").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN contribution_authorized INTEGER NOT NULL DEFAULT 0").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN contribution_status TEXT NOT NULL DEFAULT 'none'").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN charge_after_at TEXT").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN stripe_payment_intent_id TEXT").run(),
  ]);

  await db
    .prepare(
      "UPDATE pacts SET submission_url = ? WHERE id = 'p_pricing' AND submission_url IS NULL",
    )
    .bind(
      "https://ship-or-chip-in.jiyun956706.chatgpt.site",
    )
    .run();

  await db
    .prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS members_auth0_sub_unique ON members(auth0_sub) WHERE auth0_sub IS NOT NULL",
    )
    .run();

  const team = await db
    .prepare("SELECT id FROM teams WHERE id = ?")
    .bind(TEAM_ID)
    .first();

  if (!team) {
    await seed(db);
  } else {
    await ensureDemoAppeal(db);
  }
  return db;
}

async function ensureDemoAppeal(db: D1Database) {
  const existing = await db
    .prepare("SELECT id FROM appeals WHERE pact_id = 'p_invites' LIMIT 1")
    .first();
  if (existing) return;

  const pact = await db
    .prepare(
      "SELECT id FROM pacts WHERE id = 'p_invites' AND team_id = ? AND status = 'active'",
    )
    .bind(TEAM_ID)
    .first();
  if (!pact) return;

  await db.batch([
    db
      .prepare(
        "INSERT INTO appeals (id, team_id, pact_id, requester_id, category, note, requested_due_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
      )
      .bind(
        "appeal_invites",
        TEAM_ID,
        "p_invites",
        "m_lex",
        "family",
        "A family situation came up. I need two more days; no further details.",
        new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      ),
    db.prepare("UPDATE pacts SET status = 'appeal' WHERE id = 'p_invites'"),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'review')",
      )
      .bind(
        crypto.randomUUID(),
        TEAM_ID,
        "Lex requested a compassionate extension for “Connect the team invitation flow”.",
      ),
  ]);
}

async function seed(db: D1Database) {
  const now = Date.now();
  const isoIn = (hours: number) =>
    new Date(now + hours * 60 * 60 * 1000).toISOString();
  const statements = [
    db
      .prepare(
        "INSERT INTO teams (id, name, pot_cents, plan) VALUES (?, ?, ?, ?)",
      )
      .bind(TEAM_ID, "Launch Club", 2400, "free"),
    db
      .prepare(
        "INSERT INTO members (id, team_id, name, email, initials, color, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "m_jiyun",
        TEAM_ID,
        "Jiyun",
        "jiyun@example.com",
        "JK",
        "#ff6542",
        "owner",
      ),
    db
      .prepare(
        "INSERT INTO members (id, team_id, name, email, initials, color, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "m_maya",
        TEAM_ID,
        "Maya",
        "maya@example.com",
        "MY",
        "#ffcc45",
        "reviewer",
      ),
    db
      .prepare(
        "INSERT INTO members (id, team_id, name, email, initials, color, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "m_theo",
        TEAM_ID,
        "Theo",
        "theo@example.com",
        "TH",
        "#64c7bc",
        "member",
      ),
    db
      .prepare(
        "INSERT INTO members (id, team_id, name, email, initials, color, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "m_lex",
        TEAM_ID,
        "Lex",
        "lex@example.com",
        "LX",
        "#9887ef",
        "member",
      ),
    db
      .prepare(
        "INSERT INTO pacts (id, team_id, title, assignee_id, due_label, due_at, stake_cents, status, criteria, submission_note, submission_url, approvals, rejections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "p_pricing",
        TEAM_ID,
        "Ship the pricing page",
        "m_theo",
        "Today · 4:30 PM",
        isoIn(4),
        500,
        "review",
        JSON.stringify([
          "Works on mobile",
          "Includes monthly and annual plans",
          "No broken links",
        ]),
        "Pricing page is live. I also tightened the comparison copy.",
        "https://ship-or-chip-in.jiyun956706.chatgpt.site",
        1,
        0,
      ),
    db
      .prepare(
        "INSERT INTO review_votes (pact_id, voter_sub, decision) VALUES (?, ?, ?)",
      )
      .bind("p_pricing", "seed|maya", "approve"),
    db
      .prepare(
        "INSERT INTO pacts (id, team_id, title, assignee_id, due_label, due_at, stake_cents, status, criteria, approvals, rejections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "p_interviews",
        TEAM_ID,
        "Summarize five user interviews",
        "m_jiyun",
        "Tomorrow · 11:00 AM",
        isoIn(28),
        1000,
        "active",
        JSON.stringify([
          "Five interview summaries",
          "Top three repeated problems",
          "One recommendation",
        ]),
        0,
        0,
      ),
    db
      .prepare(
        "INSERT INTO pacts (id, team_id, title, assignee_id, due_label, due_at, stake_cents, status, criteria, approvals, rejections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "p_invites",
        TEAM_ID,
        "Connect the team invitation flow",
        "m_lex",
        "Friday · 2:00 PM",
        isoIn(52),
        500,
        "appeal",
        JSON.stringify([
          "Invite opens a secure Auth0 sign-up",
          "Invite expires after seven days",
          "Accepted member appears in roster",
        ]),
        0,
        0,
      ),
    db
      .prepare(
        "INSERT INTO appeals (id, team_id, pact_id, requester_id, category, note, requested_due_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
      )
      .bind(
        "appeal_invites",
        TEAM_ID,
        "p_invites",
        "m_lex",
        "family",
        "A family situation came up. I need two more days; no further details.",
        isoIn(76),
      ),
    db
      .prepare(
        "INSERT INTO pacts (id, team_id, title, assignee_id, due_label, due_at, stake_cents, status, criteria, approvals, rejections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "p_copy",
        TEAM_ID,
        "Write onboarding copy",
        "m_maya",
        "Completed yesterday",
        isoIn(-24),
        500,
        "complete",
        JSON.stringify([
          "Under 120 words",
          "Explains voluntary commitments",
          "Includes one example",
        ]),
        2,
        0,
      ),
    db
      .prepare(
        "INSERT INTO review_votes (pact_id, voter_sub, decision) VALUES (?, ?, ?)",
      )
      .bind("p_copy", "seed|jiyun", "approve"),
    db
      .prepare(
        "INSERT INTO review_votes (pact_id, voter_sub, decision) VALUES (?, ?, ?)",
      )
      .bind("p_copy", "seed|theo", "approve"),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone, created_at) VALUES (?, ?, ?, ?, datetime('now', '-15 minutes'))",
      )
      .bind(
        "a_review",
        TEAM_ID,
        "Theo submitted “Ship the pricing page” for review.",
        "review",
      ),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone, created_at) VALUES (?, ?, ?, ?, datetime('now', '-3 hours'))",
      )
      .bind(
        "a_complete",
        TEAM_ID,
        "Maya shipped the onboarding copy. No chips required.",
        "success",
      ),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone, created_at) VALUES (?, ?, ?, ?, datetime('now', '-1 day'))",
      )
      .bind(
        "a_pizza",
        TEAM_ID,
        "The pizza fund grew by $5 after a missed research deadline.",
        "money",
      ),
  ];

  await db.batch(statements);
}

async function ensureViewerMember(db: D1Database, viewer: Viewer) {
  const existing = await db
    .prepare("SELECT * FROM members WHERE auth0_sub = ?")
    .bind(viewer.sub)
    .first<TeamMember>();
  if (existing) return existing;

  const linkedCount = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM members WHERE team_id = ? AND auth0_sub IS NOT NULL",
    )
    .bind(TEAM_ID)
    .first<{ count: number }>();

  if (Number(linkedCount?.count ?? 0) === 0) {
    await db
      .prepare(
        "UPDATE members SET name = ?, email = ?, initials = ?, auth0_sub = ? WHERE id = 'm_jiyun'",
      )
      .bind(viewer.name, viewer.email, viewer.initials, viewer.sub)
      .run();
  } else {
    const colors = ["#64c7bc", "#9887ef", "#ffcc45", "#ff6542"];
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM members WHERE team_id = ?")
      .bind(TEAM_ID)
      .first<{ count: number }>();
    await db
      .prepare(
        "INSERT INTO members (id, team_id, name, email, initials, color, role, auth0_sub) VALUES (?, ?, ?, ?, ?, ?, 'member', ?)",
      )
      .bind(
        crypto.randomUUID(),
        TEAM_ID,
        viewer.name,
        viewer.email,
        viewer.initials,
        colors[Number(count?.count ?? 0) % colors.length],
        viewer.sub,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'success')",
      )
      .bind(
        crypto.randomUUID(),
        TEAM_ID,
        `${viewer.name} joined Launch Club through Auth0.`,
      )
      .run();
  }

  const member = await db
    .prepare("SELECT * FROM members WHERE auth0_sub = ?")
    .bind(viewer.sub)
    .first<TeamMember>();
  if (!member) throw new Error("Unable to connect your account to the team");
  return member;
}

async function scheduleContribution(
  db: D1Database,
  teamId: string,
  pact: {
    id: string;
    title: string;
    stake_cents: number;
    assignee_id: string;
    contribution_authorized: number;
  },
) {
  if (pact.stake_cents <= 0) {
    await db
      .prepare(
        "UPDATE pacts SET contribution_status = 'none', charge_after_at = NULL WHERE id = ?",
      )
      .bind(pact.id)
      .run();
    return;
  }

  const assignee = await db
    .prepare(
      "SELECT stripe_customer_id, stripe_payment_method_id FROM members WHERE id = ? AND team_id = ?",
    )
    .bind(pact.assignee_id, teamId)
    .first<{
      stripe_customer_id: string | null;
      stripe_payment_method_id: string | null;
    }>();
  const ready = Boolean(
    pact.contribution_authorized &&
      assignee?.stripe_customer_id &&
      assignee?.stripe_payment_method_id,
  );

  if (!ready) {
    await db.batch([
      db
        .prepare(
          "UPDATE pacts SET contribution_status = 'not_authorized', charge_after_at = NULL WHERE id = ?",
        )
        .bind(pact.id),
      db
        .prepare(
          "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'neutral')",
        )
        .bind(
          crypto.randomUUID(),
          teamId,
          `“${pact.title}” failed, but no test charge was made because its contribution was not authorized.`,
        ),
    ]);
    return;
  }

  const chargeAfterAt = new Date(
    Date.now() + DEMO_CHARGE_DELAY_MS,
  ).toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE pacts SET contribution_status = 'pending', charge_after_at = ?, stripe_payment_intent_id = NULL WHERE id = ?",
      )
      .bind(chargeAfterAt, pact.id),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'review')",
      )
      .bind(
        crypto.randomUUID(),
        teamId,
        `“${pact.title}” failed. A $${(pact.stake_cents / 100).toFixed(0)} Stripe test contribution is scheduled after the 30-second appeal window.`,
      ),
  ]);
}

async function processPendingContributions(
  db: D1Database,
  teamId: string,
) {
  if (!process.env.STRIPE_SECRET_KEY) return;

  const pending = await db
    .prepare(
      `SELECT pacts.id, pacts.title, pacts.stake_cents, pacts.charge_after_at,
              members.stripe_customer_id, members.stripe_payment_method_id
       FROM pacts
       JOIN members ON members.id = pacts.assignee_id
       WHERE pacts.team_id = ?
         AND pacts.contribution_status = 'pending'
         AND pacts.charge_after_at IS NOT NULL
         AND pacts.charge_after_at <= ?`,
    )
    .bind(teamId, new Date().toISOString())
    .all<{
      id: string;
      title: string;
      stake_cents: number;
      charge_after_at: string;
      stripe_customer_id: string | null;
      stripe_payment_method_id: string | null;
    }>();
  if (pending.results.length === 0) return;

  const stripe = getStripe();
  for (const pact of pending.results) {
    const claimed = await db
      .prepare(
        "UPDATE pacts SET contribution_status = 'processing' WHERE id = ? AND contribution_status = 'pending'",
      )
      .bind(pact.id)
      .run();
    if (!claimed.meta.changes) continue;

    if (!pact.stripe_customer_id || !pact.stripe_payment_method_id) {
      await db
        .prepare(
          "UPDATE pacts SET contribution_status = 'needs_action' WHERE id = ?",
        )
        .bind(pact.id)
        .run();
      continue;
    }

    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: pact.stake_cents,
          currency: "usd",
          customer: pact.stripe_customer_id,
          payment_method: pact.stripe_payment_method_id,
          confirm: true,
          off_session: true,
          description: `Ship or Chip In test contribution: ${pact.title}`,
          metadata: {
            ship_or_chip_contribution: "1",
            pact_id: pact.id,
            team_id: teamId,
          },
        },
        {
          idempotencyKey: `contribution_${pact.id}_${pact.charge_after_at}`,
        },
      );

      await db
        .prepare(
          "UPDATE pacts SET stripe_payment_intent_id = ? WHERE id = ?",
        )
        .bind(intent.id, pact.id)
        .run();

      if (intent.status === "succeeded") {
        await completeContribution(db, intent);
      } else {
        await db.batch([
          db
            .prepare(
              "INSERT OR IGNORE INTO transactions (id, team_id, pact_id, amount_cents, provider, status) VALUES (?, ?, ?, ?, 'stripe_sandbox', ?)",
            )
            .bind(intent.id, teamId, pact.id, pact.stake_cents, intent.status),
          db
            .prepare(
              "UPDATE pacts SET contribution_status = 'needs_action' WHERE id = ?",
            )
            .bind(pact.id),
        ]);
      }
    } catch (error) {
      const intent =
        typeof error === "object" &&
        error &&
        "payment_intent" in error &&
        error.payment_intent
          ? (error.payment_intent as Stripe.PaymentIntent)
          : null;
      if (intent) {
        await failContribution(db, intent);
      } else {
        await db
          .prepare(
            "UPDATE pacts SET contribution_status = 'needs_action' WHERE id = ?",
          )
          .bind(pact.id)
          .run();
      }
    }
  }
}

async function settleExpiredPacts(db: D1Database, teamId: string) {
  const graceCutoff = new Date(Date.now() - APPEAL_GRACE_MS).toISOString();
  const expired = await db
    .prepare(
      "SELECT id, title, stake_cents, assignee_id, contribution_authorized FROM pacts WHERE team_id = ? AND status = 'active' AND due_at IS NOT NULL AND due_at <= ?",
    )
    .bind(teamId, graceCutoff)
    .all<{
      id: string;
      title: string;
      stake_cents: number;
      assignee_id: string;
      contribution_authorized: number;
    }>();

  for (const pact of expired.results) {
    const update = await db
      .prepare(
        "UPDATE pacts SET status = 'failed' WHERE id = ? AND status = 'active'",
      )
      .bind(pact.id)
      .run();
    if (!update.meta.changes) continue;

    await scheduleContribution(db, teamId, pact);
  }
}

async function readState(
  db: D1Database,
  member: TeamMember,
) {
  const [team, members, pacts, appeals, activities, transactions] =
    await Promise.all([
    db.prepare("SELECT * FROM teams WHERE id = ?").bind(member.team_id).first(),
    db
      .prepare(
        `SELECT id, team_id, name, email, initials, color, role, auth0_sub,
                CASE
                  WHEN stripe_customer_id IS NOT NULL
                   AND stripe_payment_method_id IS NOT NULL
                  THEN 1 ELSE 0
                END AS payment_method_ready
         FROM members
         WHERE team_id = ?
         ORDER BY rowid`,
      )
      .bind(member.team_id)
      .all(),
    db
      .prepare("SELECT * FROM pacts WHERE team_id = ? ORDER BY created_at DESC")
      .bind(member.team_id)
      .all(),
    db
      .prepare("SELECT * FROM appeals WHERE team_id = ? ORDER BY created_at DESC")
      .bind(member.team_id)
      .all(),
    db
      .prepare(
        "SELECT * FROM activities WHERE team_id = ? ORDER BY created_at DESC LIMIT 12",
      )
      .bind(member.team_id)
      .all(),
    db
      .prepare(
        "SELECT * FROM transactions WHERE team_id = ? ORDER BY created_at DESC LIMIT 12",
      )
      .bind(member.team_id)
      .all(),
  ]);

  return {
    team,
    current_member_id: member.id,
    members: members.results,
    pacts: pacts.results.map((pact) => ({
      ...pact,
      criteria: JSON.parse(String(pact.criteria)),
    })),
    appeals: appeals.results,
    activities: activities.results,
    transactions: transactions.results,
  };
}

export async function GET() {
  try {
    const viewer = await getViewer();
    if (!viewer) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }
    const db = await setup();
    const member = await ensureViewerMember(db, viewer);
    await settleExpiredPacts(db, member.team_id);
    await processPendingContributions(db, member.team_id);
    return Response.json(await readState(db, member));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load team" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await getViewer();
    if (!viewer) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }
    const payload = (await request.json()) as ActionPayload;
    const db = await setup();
    let member = await ensureViewerMember(db, viewer);
    const teamId = member.team_id;
    await settleExpiredPacts(db, teamId);
    await processPendingContributions(db, teamId);

    if (payload.action === "create") {
      const title = payload.title?.trim();
      const criteria = (payload.criteria ?? [])
        .map((criterion) => criterion.trim())
        .filter(Boolean);
      const assignee = payload.assigneeId
        ? await db
            .prepare("SELECT id FROM members WHERE id = ? AND team_id = ?")
            .bind(payload.assigneeId, teamId)
            .first()
        : null;
      if (!title || !assignee || criteria.length === 0) {
        return Response.json(
          { error: "Title, owner, and at least one criterion are required." },
          { status: 400 },
        );
      }

      const dueAt = payload.dueAt
        ? new Date(payload.dueAt)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
      if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
        return Response.json(
          { error: "Choose a deadline in the future." },
          { status: 400 },
        );
      }

      const id = crypto.randomUUID();
      const amount = Math.min(
        2500,
        Math.max(0, Number(payload.stakeCents ?? 0)),
      );
      const contributionAuthorized = Boolean(payload.contributionAuthorized);
      if (amount > 0) {
        if (payload.assigneeId !== member.id) {
          return Response.json(
            {
              error:
                "A paid contribution can only be authorized by the teammate assigning the task to themselves.",
            },
            { status: 400 },
          );
        }
        if (!contributionAuthorized) {
          return Response.json(
            { error: "Confirm the automatic test contribution." },
            { status: 400 },
          );
        }
        if (!member.stripe_customer_id || !member.stripe_payment_method_id) {
          return Response.json(
            { error: "Connect a Stripe test card before authorizing a contribution." },
            { status: 400 },
          );
        }
      }
      const dueLabel = formatDueLabel(dueAt);

      await db.batch([
        db
          .prepare(
            "INSERT INTO pacts (id, team_id, title, assignee_id, due_label, due_at, stake_cents, status, criteria, contribution_authorized, contribution_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
          )
          .bind(
            id,
            teamId,
            title,
            payload.assigneeId,
            dueLabel,
            dueAt.toISOString(),
            amount,
            JSON.stringify(criteria),
            contributionAuthorized ? 1 : 0,
            contributionAuthorized ? "armed" : "none",
          ),
        db
          .prepare(
            "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            teamId,
            `A new task was accepted: “${title}”.`,
            "neutral",
          ),
      ]);
    }

    if (payload.action === "importNotes") {
      const notes = payload.notes?.trim() ?? "";
      if (notes.length < 5 || notes.length > 10_000) {
        return Response.json(
          { error: "Paste meeting notes between 5 and 10,000 characters." },
          { status: 400 },
        );
      }

      const dueAt = payload.dueAt
        ? new Date(payload.dueAt)
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      if (
        Number.isNaN(dueAt.getTime()) ||
        dueAt.getTime() <= Date.now() ||
        dueAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000
      ) {
        return Response.json(
          { error: "Choose a default deadline within the next 30 days." },
          { status: 400 },
        );
      }

      const teamMembers = await db
        .prepare("SELECT id, name FROM members WHERE team_id = ?")
        .bind(teamId)
        .all<{ id: string; name: string }>();
      const importedTasks = parseMeetingTasks(notes, teamMembers.results);
      if (importedTasks.length === 0) {
        return Response.json(
          {
            error:
              "No assigned tasks found. Try lines like “Maya: draft the launch email” or “Theo will test checkout”.",
          },
          { status: 400 },
        );
      }

      const dueLabel = formatDueLabel(dueAt);
      const criteria = JSON.stringify([
        "The completed work is shared with the team",
        "It matches the scope agreed in the meeting",
      ]);
      const statements = importedTasks.map((task) =>
        db
          .prepare(
            "INSERT INTO pacts (id, team_id, title, assignee_id, due_label, due_at, stake_cents, status, criteria) VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?)",
          )
          .bind(
            crypto.randomUUID(),
            teamId,
            task.title,
            task.assigneeId,
            dueLabel,
            dueAt.toISOString(),
            criteria,
          ),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'neutral')",
          )
          .bind(
            crypto.randomUUID(),
            teamId,
            `${importedTasks.length} ${
              importedTasks.length === 1 ? "task was" : "tasks were"
            } created from meeting notes.`,
          ),
      );
      await db.batch(statements);
    }

    if (payload.action === "submit") {
      if (!payload.pactId) {
        return Response.json({ error: "Missing task" }, { status: 400 });
      }
      const pact = await db
        .prepare(
          "SELECT title, assignee_id, status FROM pacts WHERE id = ? AND team_id = ?",
        )
        .bind(payload.pactId, teamId)
        .first<{ title: string; assignee_id: string; status: string }>();
      if (!pact) {
        return Response.json({ error: "Task not found" }, { status: 404 });
      }
      if (pact.status !== "active") {
        return Response.json(
          { error: "This task is not ready to be submitted." },
          { status: 409 },
        );
      }
      if (pact.assignee_id !== member.id && member.role !== "owner") {
        return Response.json(
          { error: "Only the task owner can submit this work." },
          { status: 403 },
        );
      }
      const workUrl = payload.workUrl?.trim() ?? "";
      try {
        const parsedUrl = new URL(workUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          throw new Error("Unsupported protocol");
        }
      } catch {
        return Response.json(
          { error: "Add a valid link to the completed work." },
          { status: 400 },
        );
      }
      await db.batch([
        db
          .prepare(
            "UPDATE pacts SET status = 'review', submission_note = ?, submission_url = ?, approvals = 0, rejections = 0 WHERE id = ?",
          )
          .bind(
            payload.note?.trim() || "Ready for review.",
            workUrl,
            payload.pactId,
          ),
        db
          .prepare("DELETE FROM review_votes WHERE pact_id = ?")
          .bind(payload.pactId),
        db
          .prepare(
            "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            teamId,
            `“${pact.title}” was submitted for team review.`,
            "review",
          ),
      ]);
    }

    if (payload.action === "review") {
      if (!payload.pactId || !payload.decision) {
        return Response.json({ error: "Missing review" }, { status: 400 });
      }
      const pact = await db
        .prepare(
          "SELECT id, title, stake_cents, assignee_id, status, contribution_authorized FROM pacts WHERE id = ? AND team_id = ?",
        )
        .bind(payload.pactId, teamId)
        .first<{
          title: string;
          id: string;
          stake_cents: number;
          assignee_id: string;
          status: string;
          contribution_authorized: number;
        }>();

      if (!pact || pact.status !== "review") {
        return Response.json(
          { error: "This task is no longer awaiting review." },
          { status: 409 },
        );
      }
      if (pact.assignee_id === member.id) {
        return Response.json(
          { error: "Task owners cannot review their own submission." },
          { status: 403 },
        );
      }
      const existingVote = await db
        .prepare(
          "SELECT decision FROM review_votes WHERE pact_id = ? AND voter_sub = ?",
        )
        .bind(payload.pactId, viewer.sub)
        .first();
      if (existingVote) {
        return Response.json(
          { error: "You already voted on this submission." },
          { status: 409 },
        );
      }

      await db
        .prepare(
          "INSERT INTO review_votes (pact_id, voter_sub, decision) VALUES (?, ?, ?)",
        )
        .bind(payload.pactId, viewer.sub, payload.decision)
        .run();
      const counts = await db
        .prepare(
          "SELECT SUM(CASE WHEN decision = 'approve' THEN 1 ELSE 0 END) AS approvals, SUM(CASE WHEN decision = 'reject' THEN 1 ELSE 0 END) AS rejections FROM review_votes WHERE pact_id = ?",
        )
        .bind(payload.pactId)
        .first<{ approvals: number | null; rejections: number | null }>();
      const approvals = Number(counts?.approvals ?? 0);
      const rejections = Number(counts?.rejections ?? 0);
      const finalStatus =
        approvals >= REVIEW_THRESHOLD
          ? "complete"
          : rejections >= REVIEW_THRESHOLD
            ? "failed"
            : "review";

      await db
        .prepare(
          "UPDATE pacts SET approvals = ?, rejections = ?, status = ? WHERE id = ?",
        )
        .bind(approvals, rejections, finalStatus, payload.pactId)
        .run();

      if (finalStatus === "complete") {
        await db
          .prepare(
            "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            teamId,
            `“${pact.title}” passed review. No chips required.`,
            "success",
          )
          .run();
      } else if (finalStatus === "failed") {
        await scheduleContribution(db, teamId, pact);
      }
    }

    if (payload.action === "appeal") {
      if (
        !payload.pactId ||
        !payload.category ||
        !payload.requestedDueAt
      ) {
        return Response.json(
          { error: "Choose a reason and a new deadline." },
          { status: 400 },
        );
      }
      if (!["health", "family", "other"].includes(payload.category)) {
        return Response.json(
          { error: "Choose a valid appeal category." },
          { status: 400 },
        );
      }

      const pact = await db
        .prepare(
          "SELECT title, assignee_id, status, due_at, contribution_status, charge_after_at FROM pacts WHERE id = ? AND team_id = ?",
        )
        .bind(payload.pactId, teamId)
        .first<{
          title: string;
          assignee_id: string;
          status: string;
          due_at: string | null;
          contribution_status: string;
          charge_after_at: string | null;
        }>();
      const isChargeAppeal = Boolean(
        pact &&
          pact.status === "failed" &&
          pact.contribution_status === "pending" &&
          pact.charge_after_at &&
          new Date(pact.charge_after_at).getTime() > Date.now(),
      );
      if (!pact || (pact.status !== "active" && !isChargeAppeal)) {
        return Response.json(
          { error: "This task is not currently eligible for an appeal." },
          { status: 409 },
        );
      }
      if (pact.assignee_id !== member.id) {
        return Response.json(
          { error: "Only the task owner can request an extension." },
          { status: 403 },
        );
      }

      const existing = await db
        .prepare(
          "SELECT id FROM appeals WHERE pact_id = ? AND status = 'pending'",
        )
        .bind(payload.pactId)
        .first();
      if (existing) {
        return Response.json(
          { error: "This task already has an appeal awaiting review." },
          { status: 409 },
        );
      }

      const requestedDueAt = new Date(payload.requestedDueAt);
      const maxDueAt = Date.now() + 14 * 24 * 60 * 60 * 1000;
      if (
        Number.isNaN(requestedDueAt.getTime()) ||
        requestedDueAt.getTime() <= Date.now() ||
        requestedDueAt.getTime() > maxDueAt
      ) {
        return Response.json(
          { error: "Choose a new deadline within the next 14 days." },
          { status: 400 },
        );
      }

      const note = payload.note?.trim().slice(0, 280) || null;
      const appealId = crypto.randomUUID();
      await db.batch([
        db
          .prepare(
            "INSERT INTO appeals (id, team_id, pact_id, requester_id, category, note, requested_due_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
          )
          .bind(
            appealId,
            teamId,
            payload.pactId,
            member.id,
            payload.category,
            note,
            requestedDueAt.toISOString(),
          ),
        isChargeAppeal
          ? db
              .prepare(
                "UPDATE pacts SET status = 'appeal', contribution_status = 'paused', charge_after_at = NULL WHERE id = ?",
              )
              .bind(payload.pactId)
          : db
              .prepare("UPDATE pacts SET status = 'appeal' WHERE id = ?")
              .bind(payload.pactId),
        db
          .prepare(
            "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'review')",
          )
          .bind(
            crypto.randomUUID(),
            teamId,
            isChargeAppeal
              ? `${member.name} appealed the scheduled test contribution for “${pact.title}”.`
              : `${member.name} requested a compassionate extension for “${pact.title}”.`,
          ),
      ]);
    }

    if (payload.action === "resolveAppeal") {
      if (!payload.appealId || !payload.decision) {
        return Response.json(
          { error: "Choose whether to approve the extension." },
          { status: 400 },
        );
      }
      const appeal = await db
        .prepare(
          "SELECT appeals.id, appeals.pact_id, appeals.requester_id, appeals.requested_due_at, appeals.status, pacts.title, pacts.contribution_status FROM appeals JOIN pacts ON pacts.id = appeals.pact_id WHERE appeals.id = ? AND appeals.team_id = ?",
        )
        .bind(payload.appealId, teamId)
        .first<{
          id: string;
          pact_id: string;
          requester_id: string;
          requested_due_at: string;
          status: string;
          title: string;
          contribution_status: string;
        }>();
      if (!appeal || appeal.status !== "pending") {
        return Response.json(
          { error: "This appeal has already been decided." },
          { status: 409 },
        );
      }
      if (appeal.requester_id === member.id) {
        return Response.json(
          { error: "Someone else on the team must decide the appeal." },
          { status: 403 },
        );
      }

      const approved = payload.decision === "approve";
      const requestedDueAt = new Date(appeal.requested_due_at);
      const isChargeAppeal = appeal.contribution_status === "paused";
      const rejectedChargeAt = new Date(
        Date.now() + DEMO_CHARGE_DELAY_MS,
      ).toISOString();
      await db.batch([
        db
          .prepare(
            "UPDATE appeals SET status = ?, resolved_by_id = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(approved ? "approved" : "rejected", member.id, appeal.id),
        approved
          ? db
              .prepare(
                "UPDATE pacts SET status = 'active', due_at = ?, due_label = ?, contribution_status = CASE WHEN contribution_authorized = 1 THEN 'armed' ELSE 'none' END, charge_after_at = NULL WHERE id = ?",
              )
              .bind(
                requestedDueAt.toISOString(),
                formatDueLabel(requestedDueAt),
                appeal.pact_id,
              )
          : isChargeAppeal
            ? db
                .prepare(
                  "UPDATE pacts SET status = 'failed', contribution_status = 'pending', charge_after_at = ? WHERE id = ?",
                )
                .bind(rejectedChargeAt, appeal.pact_id)
            : db
                .prepare("UPDATE pacts SET status = 'active' WHERE id = ?")
                .bind(appeal.pact_id),
        db
          .prepare(
            "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            teamId,
            approved
              ? `${member.name} approved the extension for “${appeal.title}”.`
              : `${member.name} kept the original deadline for “${appeal.title}”.`,
            approved ? "success" : "neutral",
          ),
      ]);

      if (!approved && !isChargeAppeal) await settleExpiredPacts(db, teamId);
    }

    if (payload.action === "reset") {
      if (member.role !== "owner") {
        return Response.json(
          { error: "Only the team owner can reset the demo." },
          { status: 403 },
        );
      }
      await db.batch([
        db.prepare("DELETE FROM appeals WHERE team_id = ?").bind(teamId),
        db
          .prepare(
            "DELETE FROM review_votes WHERE pact_id IN (SELECT id FROM pacts WHERE team_id = ?)",
          )
          .bind(teamId),
        db.prepare("DELETE FROM invitations WHERE team_id = ?").bind(teamId),
        db.prepare("DELETE FROM transactions WHERE team_id = ?").bind(teamId),
        db.prepare("DELETE FROM activities WHERE team_id = ?").bind(teamId),
        db.prepare("DELETE FROM pacts WHERE team_id = ?").bind(teamId),
        db.prepare("DELETE FROM members WHERE team_id = ?").bind(teamId),
        db.prepare("DELETE FROM teams WHERE id = ?").bind(teamId),
      ]);
      await seed(db);
      member = await ensureViewerMember(db, viewer);
    }

    return Response.json(await readState(db, member));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 },
    );
  }
}
