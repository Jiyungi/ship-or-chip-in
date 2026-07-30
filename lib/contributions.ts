import type Stripe from "stripe";

export async function completeContribution(
  db: D1Database,
  intent: Stripe.PaymentIntent,
) {
  if (intent.metadata.ship_or_chip_contribution !== "1") return;

  const pactId = intent.metadata.pact_id;
  const teamId = intent.metadata.team_id;
  if (!pactId || !teamId) return;

  await db
    .prepare(
      "INSERT OR IGNORE INTO transactions (id, team_id, pact_id, amount_cents, provider, status) VALUES (?, ?, ?, ?, 'stripe_sandbox', 'processing')",
    )
    .bind(intent.id, teamId, pactId, intent.amount_received || intent.amount)
    .run();

  const claimed = await db
    .prepare(
      "UPDATE transactions SET status = 'succeeded' WHERE id = ? AND status != 'succeeded'",
    )
    .bind(intent.id)
    .run();
  if (!claimed.meta.changes) return;

  const pact = await db
    .prepare("SELECT title, stake_cents FROM pacts WHERE id = ? AND team_id = ?")
    .bind(pactId, teamId)
    .first<{ title: string; stake_cents: number }>();
  if (!pact) return;

  await db.batch([
    db
      .prepare(
        "UPDATE pacts SET contribution_status = 'succeeded', stripe_payment_intent_id = ? WHERE id = ?",
      )
      .bind(intent.id, pactId),
    db
      .prepare("UPDATE teams SET pot_cents = pot_cents + ? WHERE id = ?")
      .bind(pact.stake_cents, teamId),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'money')",
      )
      .bind(
        crypto.randomUUID(),
        teamId,
        `Stripe confirmed a $${(pact.stake_cents / 100).toFixed(0)} test contribution for “${pact.title}”.`,
      ),
  ]);
}

export async function failContribution(
  db: D1Database,
  intent: Stripe.PaymentIntent,
) {
  if (intent.metadata.ship_or_chip_contribution !== "1") return;

  const pactId = intent.metadata.pact_id;
  const teamId = intent.metadata.team_id;
  if (!pactId || !teamId) return;

  await db.batch([
    db
      .prepare(
        "INSERT OR REPLACE INTO transactions (id, team_id, pact_id, amount_cents, provider, status) VALUES (?, ?, ?, ?, 'stripe_sandbox', 'failed')",
      )
      .bind(intent.id, teamId, pactId, intent.amount),
    db
      .prepare(
        "UPDATE pacts SET contribution_status = 'needs_action', stripe_payment_intent_id = ? WHERE id = ?",
      )
      .bind(intent.id, pactId),
    db
      .prepare(
        "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'review')",
      )
      .bind(
        crypto.randomUUID(),
        teamId,
        "A Stripe test contribution needs the cardholder’s attention.",
      ),
  ]);
}
