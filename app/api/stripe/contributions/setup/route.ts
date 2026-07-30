import { env } from "cloudflare:workers";
import { auth0 } from "../../../../../lib/auth0";
import { getStripe } from "../../../../../lib/stripe";

async function createContributionSetup(request: Request) {
  const session = await auth0.getSession();
  const sub =
    session && typeof session.user.sub === "string" ? session.user.sub : "";
  if (!sub) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const db = env.DB;
  await Promise.allSettled([
    db.prepare("ALTER TABLE members ADD COLUMN stripe_customer_id TEXT").run(),
    db.prepare("ALTER TABLE members ADD COLUMN stripe_payment_method_id TEXT").run(),
  ]);

  const member = await db
    .prepare(
      "SELECT id, team_id, name, email, stripe_customer_id FROM members WHERE auth0_sub = ?",
    )
    .bind(sub)
    .first<{
      id: string;
      team_id: string;
      name: string;
      email: string;
      stripe_customer_id: string | null;
    }>();
  if (!member) {
    return Response.json(
      { error: "Open the team dashboard before connecting a test card." },
      { status: 409 },
    );
  }

  const stripe = getStripe();
  let customerId = member.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: member.name,
      email: member.email || undefined,
      metadata: {
        ship_or_chip_member_id: member.id,
        ship_or_chip_team_id: member.team_id,
      },
    });
    customerId = customer.id;
    await db
      .prepare("UPDATE members SET stripe_customer_id = ? WHERE id = ?")
      .bind(customerId, member.id)
      .run();
  }

  const appBaseUrl =
    process.env.APP_BASE_URL || new URL(request.url).origin;
  const checkout = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: `${appBaseUrl}/?contribution_setup=success`,
    cancel_url: `${appBaseUrl}/?contribution_setup=cancelled`,
    metadata: {
      ship_or_chip_setup: "1",
      member_id: member.id,
      team_id: member.team_id,
    },
    setup_intent_data: {
      metadata: {
        ship_or_chip_setup: "1",
        member_id: member.id,
        team_id: member.team_id,
      },
    },
    custom_text: {
      submit: {
        message:
          "Sandbox only. This card can be charged automatically only for task contributions you explicitly authorize.",
      },
    },
  });

  if (!checkout.url) {
    return Response.json(
      { error: "Stripe did not return a card setup page." },
      { status: 502 },
    );
  }
  return Response.json({ url: checkout.url });
}

export async function POST(request: Request) {
  try {
    return await createContributionSetup(request);
  } catch (error) {
    console.error("Stripe contribution setup failed", error);
    return Response.json(
      {
        error:
          "Stripe could not open the test-card setup page. Please try again.",
      },
      { status: 500 },
    );
  }
}
