ALTER TABLE `soft_circles` ADD `tenant_id` text;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `company_id` text;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `investor_user_id` text;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `investor_email` text;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `amount_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `collective_visible` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `soft_circles` ADD `deleted_at` text;