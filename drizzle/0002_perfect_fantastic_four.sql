CREATE TABLE `appeals` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`pact_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`category` text NOT NULL,
	`note` text,
	`requested_due_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_by_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text
);
