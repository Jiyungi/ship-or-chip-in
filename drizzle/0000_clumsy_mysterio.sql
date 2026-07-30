CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`body` text NOT NULL,
	`tone` text DEFAULT 'neutral' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`initials` text NOT NULL,
	`color` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pacts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`title` text NOT NULL,
	`assignee_id` text NOT NULL,
	`due_label` text NOT NULL,
	`stake_cents` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`criteria` text NOT NULL,
	`submission_note` text,
	`approvals` integer DEFAULT 0 NOT NULL,
	`rejections` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pot_cents` integer DEFAULT 0 NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`pact_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`provider` text DEFAULT 'stripe_test' NOT NULL,
	`status` text DEFAULT 'succeeded' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
