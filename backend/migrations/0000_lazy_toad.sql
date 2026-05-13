CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target` text,
	`target_id` text,
	`payload_json` text,
	`prev_hash` text,
	`hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bridge_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_kind` text NOT NULL,
	`envelope_json` text NOT NULL,
	`hmac` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`enqueued_at` text NOT NULL,
	`delivered_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`sector` text,
	`stage` text,
	`hq` text,
	`website_url` text,
	`description` text,
	`logo_url` text,
	`founded` text,
	`employees` integer
);
--> statement-breakpoint
CREATE TABLE `company_members` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`title` text
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`legal_name` text NOT NULL,
	`display_name` text,
	`email` text,
	`phone` text,
	`region` text,
	`status` text DEFAULT 'active' NOT NULL,
	`verification` text DEFAULT 'unverified' NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`prev_revision_hash` text NOT NULL,
	`revision_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dataroom_files` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mime` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`uploaded_by` text
);
--> statement-breakpoint
CREATE TABLE `email_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`from_name` text NOT NULL,
	`from_email` text NOT NULL,
	`audience_type` text NOT NULL,
	`status` text NOT NULL,
	`html_body` text,
	`text_body` text,
	`scheduled_at` text,
	`sent_at` text,
	`recipient_count` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `formulas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`region` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` text NOT NULL,
	`source_code` text,
	`citation_source` text,
	`citation_url` text,
	`def_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_number` text NOT NULL,
	`company_id` text NOT NULL,
	`plan_label` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`status` text NOT NULL,
	`issued_at` text NOT NULL,
	`paid_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`prev_revision_hash` text NOT NULL,
	`revision_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_unique` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE TABLE `notification_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`audience_type` text NOT NULL,
	`status` text NOT NULL,
	`content_json` text,
	`scheduled_at` text,
	`sent_at` text,
	`recipient_count` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`html_body` text,
	`text_body` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	`error_message` text,
	`campaign_id` text
);
--> statement-breakpoint
CREATE TABLE `platform_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`prev_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	`hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pricing_models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`base_price_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`billing_cycle` text NOT NULL,
	`features_json` text,
	`regional_multipliers_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`prev_revision_hash` text NOT NULL,
	`revision_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `region_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`region_code` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`pricing_multiplier` real DEFAULT 1 NOT NULL,
	`currency_override` text,
	`config_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`revision_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `round_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`investor_email` text NOT NULL,
	`investor_name` text,
	`state` text NOT NULL,
	`expires_at` text,
	`sent_at` text,
	`viewed_at` text
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`state` text NOT NULL,
	`target_amount` real NOT NULL,
	`raised_amount` real DEFAULT 0 NOT NULL,
	`pre_money` real,
	`post_money` real,
	`price_per_share` real,
	`min_ticket` real,
	`close_date` text,
	`terms_summary` text
);
--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`holder_name` text NOT NULL,
	`holder_type` text NOT NULL,
	`instrument` text NOT NULL,
	`series` text,
	`shares` integer DEFAULT 0 NOT NULL,
	`price_per_share` real,
	`investment_amount` real,
	`cap` real,
	`discount` real,
	`issued_at` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent` text,
	`ip` text,
	`revoked` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `soft_circles` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`invitation_id` text,
	`investor_name` text NOT NULL,
	`amount` real NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`company_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`plan` text NOT NULL,
	`annual_amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`renews_on` text NOT NULL,
	`card_last4` text,
	`invoices_count` integer DEFAULT 0 NOT NULL,
	`past_due_minor` integer,
	`trial_ends_on` text,
	`version` integer DEFAULT 1 NOT NULL,
	`prev_revision_hash` text NOT NULL,
	`revision_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions_history` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`version` integer NOT NULL,
	`revision_hash` text NOT NULL,
	`prev_revision_hash` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`envelope_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`handler` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_inbox_event_id_unique` ON `sync_inbox` (`event_id`);--> statement-breakpoint
CREATE TABLE `sync_inbox_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`avatar_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);