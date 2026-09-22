CREATE TABLE `access_grants` (
	`viewer_user_id` text NOT NULL,
	`subject_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`viewer_user_id`, `subject_user_id`),
	FOREIGN KEY (`viewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_grants_subject_idx` ON `access_grants` (`subject_user_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`ip` text NOT NULL,
	`success` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_email_ip_idx` ON `login_attempts` (`email`,`ip`,`created_at`);--> statement-breakpoint
CREATE TABLE `report_items` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`type` text NOT NULL,
	`person_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount` real,
	`unit` text,
	`due_date` text,
	`due_time` text,
	`status` text DEFAULT 'new' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `report_items_report_id_idx` ON `report_items` (`report_id`);--> statement-breakpoint
CREATE INDEX `report_items_type_due_date_idx` ON `report_items` (`type`,`due_date`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`sync_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reports_user_id_created_at_idx` ON `reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_sync_status_idx` ON `reports` (`sync_status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text,
	`password_salt` text,
	`role` text DEFAULT 'reporter' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`can_view_all` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);