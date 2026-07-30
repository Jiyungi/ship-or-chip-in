import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  potCents: integer("pot_cents").notNull().default(0),
  plan: text("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  initials: text("initials").notNull(),
  color: text("color").notNull(),
  role: text("role").notNull().default("member"),
  auth0Sub: text("auth0_sub").unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
});

export const pacts = sqliteTable("pacts", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  title: text("title").notNull(),
  assigneeId: text("assignee_id").notNull(),
  dueLabel: text("due_label").notNull(),
  dueAt: text("due_at"),
  stakeCents: integer("stake_cents").notNull(),
  status: text("status").notNull().default("active"),
  criteria: text("criteria").notNull(),
  submissionNote: text("submission_note"),
  submissionUrl: text("submission_url"),
  contributionAuthorized: integer("contribution_authorized").notNull().default(0),
  contributionStatus: text("contribution_status").notNull().default("none"),
  chargeAfterAt: text("charge_after_at"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  approvals: integer("approvals").notNull().default(0),
  rejections: integer("rejections").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  body: text("body").notNull(),
  tone: text("tone").notNull().default("neutral"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  pactId: text("pact_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  provider: text("provider").notNull().default("stripe_test"),
  status: text("status").notNull().default("succeeded"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reviewVotes = sqliteTable(
  "review_votes",
  {
    pactId: text("pact_id").notNull(),
    voterSub: text("voter_sub").notNull(),
    decision: text("decision").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.pactId, table.voterSub] })],
);

export const appeals = sqliteTable("appeals", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  pactId: text("pact_id").notNull(),
  requesterId: text("requester_id").notNull(),
  category: text("category").notNull(),
  note: text("note"),
  requestedDueAt: text("requested_due_at").notNull(),
  status: text("status").notNull().default("pending"),
  resolvedById: text("resolved_by_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
});

export const invitations = sqliteTable("invitations", {
  token: text("token").primaryKey(),
  teamId: text("team_id").notNull(),
  createdBySub: text("created_by_sub").notNull(),
  usedBySub: text("used_by_sub"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: text("processed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
