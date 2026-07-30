ALTER TABLE `members` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `members` ADD `stripe_payment_method_id` text;--> statement-breakpoint
ALTER TABLE `pacts` ADD `contribution_authorized` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pacts` ADD `contribution_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `pacts` ADD `charge_after_at` text;--> statement-breakpoint
ALTER TABLE `pacts` ADD `stripe_payment_intent_id` text;