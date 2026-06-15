CREATE TABLE `user_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`password_hash` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
