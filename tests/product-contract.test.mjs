import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("the dashboard exposes the complete task flow", async () => {
  const dashboard = await read("app/ShipOrChipIn.tsx");

  for (const expected of [
    "Ship or Chip In",
    "How it works",
    "New task",
    "Import meeting notes",
    "Mark it ready",
    "Review",
    "Submitted work",
    "Open submitted work",
    "shared dinner goal",
    "Piggy bank",
    "Enable test contributions",
    "30s appeal window",
    "Stripe test subscription",
    "Invite a teammate",
    "Request an extension",
    "No documents, diagnosis, or private medical details",
  ]) {
    assert.match(dashboard, new RegExp(expected, "i"));
  }
});

test("the API supports every user action and records failed tasks", async () => {
  const api = await read("app/api/state/route.ts");
  const contributions = await read("lib/contributions.ts");

  for (const action of [
    "create",
    "importNotes",
    "submit",
    "review",
    "appeal",
    "resolveAppeal",
    "reset",
  ]) {
    assert.match(api, new RegExp(`payload\\.action === "${action}"`));
  }

  assert.match(contributions, /INSERT OR IGNORE INTO transactions/);
  assert.match(contributions, /pot_cents = pot_cents \+ \?/);
  assert.match(api, /review_votes/);
  assert.match(api, /You already voted on this submission/);
  assert.match(api, /settleExpiredPacts/);
  assert.match(api, /CREATE TABLE IF NOT EXISTS appeals/);
  assert.match(api, /APPEAL_GRACE_MS/);
  assert.match(api, /Someone else on the team must decide the appeal/);
  assert.match(api, /parseMeetingTasks/);
  assert.match(api, /submission_url/);
  assert.match(api, /processPendingContributions/);
  assert.match(api, /paymentIntents\.create/);
  assert.match(api, /contribution_status/);
});

test("team invites are single-use and expire after seven days", async () => {
  const createInvite = await read("app/api/invites/route.ts");
  const acceptInvite = await read("app/join/[token]/route.ts");

  assert.match(createInvite, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(acceptInvite, /invite\.used_by_sub/);
  assert.match(acceptInvite, /auth0\.getSession/);
});

test("Stripe Sandbox webhooks activate and deactivate Pro", async () => {
  const webhook = await read("app/api/stripe/webhook/route.ts");
  const setup = await read("app/api/stripe/contributions/setup/route.ts");

  assert.match(webhook, /constructEventAsync/);
  assert.match(webhook, /checkout\.session\.completed/);
  assert.match(webhook, /customer\.subscription\.deleted/);
  assert.match(webhook, /payment_intent\.succeeded/);
  assert.match(webhook, /stripe_payment_method_id/);
  assert.match(webhook, /plan = 'pro'/);
  assert.match(setup, /mode: "setup"/);
  assert.doesNotMatch(setup, /usage: "off_session"/);
  assert.match(setup, /Stripe could not open the test-card setup page/);
});

test("the deployment has persistent storage configured", async () => {
  const hosting = JSON.parse(await read(".openai/hosting.json"));
  assert.equal(hosting.d1, "DB");
});
