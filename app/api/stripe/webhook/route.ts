import { env } from "cloudflare:workers";
import Stripe from "stripe";
import {
  completeContribution,
  failContribution,
} from "../../../../lib/contributions";
import { getStripe, stripeCryptoProvider } from "../../../../lib/stripe";

const TEAM_ID = "team_launch_club";

async function prepareDatabase() {
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
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        body TEXT NOT NULL,
        tone TEXT NOT NULL DEFAULT 'neutral',
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
    db.prepare("ALTER TABLE members ADD COLUMN stripe_customer_id TEXT").run(),
    db.prepare("ALTER TABLE members ADD COLUMN stripe_payment_method_id TEXT").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN contribution_status TEXT NOT NULL DEFAULT 'none'").run(),
    db.prepare("ALTER TABLE pacts ADD COLUMN stripe_payment_intent_id TEXT").run(),
  ]);

  await db
    .prepare(
      "INSERT OR IGNORE INTO teams (id, name, pot_cents, plan) VALUES (?, 'Launch Club', 0, 'free')",
    )
    .bind(TEAM_ID)
    .run();

  return db;
}

function stripeId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    return Response.json(
      { error: "Stripe webhook is not configured" },
      { status: 503 },
    );
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    const rawBody = await request.text();
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      stripeCryptoProvider,
    );
  } catch {
    return Response.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  const db = await prepareDatabase();
  const claimed = await db
    .prepare(
      "INSERT OR IGNORE INTO webhook_events (id, event_type) VALUES (?, ?)",
    )
    .bind(event.id, event.type)
    .run();

  if (!claimed.meta.changes) {
    return Response.json({ received: true, duplicate: true });
  }

  try {
    const stripe = getStripe();
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const customerId = stripeId(session.customer);
        const subscriptionId = stripeId(session.subscription);
        await db.batch([
          db
            .prepare(
              "UPDATE teams SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?",
            )
            .bind(customerId, subscriptionId, TEAM_ID),
          db
            .prepare(
              "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'success')",
            )
            .bind(
              crypto.randomUUID(),
              TEAM_ID,
              "Launch Club upgraded to Pro through Stripe Sandbox.",
          ),
        ]);
      } else if (
        session.mode === "setup" &&
        session.metadata?.ship_or_chip_setup === "1"
      ) {
        const setupIntentId = stripeId(session.setup_intent);
        const memberId = session.metadata.member_id;
        const teamId = session.metadata.team_id;
        if (setupIntentId && memberId && teamId) {
          const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
          const paymentMethodId = stripeId(setupIntent.payment_method);
          const customerId = stripeId(session.customer);
          if (paymentMethodId && customerId) {
            await db.batch([
              db
                .prepare(
                  "UPDATE members SET stripe_customer_id = ?, stripe_payment_method_id = ? WHERE id = ? AND team_id = ?",
                )
                .bind(customerId, paymentMethodId, memberId, teamId),
              db
                .prepare(
                  "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'success')",
                )
                .bind(
                  crypto.randomUUID(),
                  teamId,
                  "A teammate authorized Stripe Sandbox automatic contributions.",
                ),
            ]);
          }
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      await completeContribution(
        db,
        event.data.object as Stripe.PaymentIntent,
      );
    }

    if (event.type === "payment_intent.payment_failed") {
      await failContribution(db, event.data.object as Stripe.PaymentIntent);
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await db.batch([
        db
          .prepare(
            "UPDATE teams SET plan = 'free', stripe_subscription_id = NULL WHERE id = ? AND stripe_subscription_id = ?",
          )
          .bind(TEAM_ID, subscription.id),
        db
          .prepare(
            "INSERT INTO activities (id, team_id, body, tone) VALUES (?, ?, ?, 'neutral')",
          )
          .bind(
            crypto.randomUUID(),
            TEAM_ID,
            "The Stripe Sandbox Pro subscription ended.",
          ),
      ]);
    }

    return Response.json({ received: true });
  } catch (error) {
    await db
      .prepare("DELETE FROM webhook_events WHERE id = ?")
      .bind(event.id)
      .run();
    return Response.json(
      { error: error instanceof Error ? error.message : "Webhook failed" },
      { status: 500 },
    );
  }
}
