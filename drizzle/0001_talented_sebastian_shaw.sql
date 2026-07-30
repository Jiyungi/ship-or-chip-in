CREATE TABLE `invitations` (
	`token` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`created_by_sub` text NOT NULL,
	`used_by_sub` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_votes` (
	`pact_id` text NOT NULL,
	`voter_sub` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`pact_id`, `voter_sub`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `members` ADD `auth0_sub` text;--> statement-breakpoint
CREATE UNIQUE INDEX `members_auth0_sub_unique` ON `members` (`auth0_sub`);--> statement-breakpoint
ALTER TABLE `pacts` ADD `due_at` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `stripe_subscription_id` text;