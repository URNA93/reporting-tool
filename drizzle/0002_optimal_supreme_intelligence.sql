CREATE TABLE `password_reset_uses` (
	`token_id` text PRIMARY KEY NOT NULL,
	`used_by_email` text NOT NULL,
	`used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
