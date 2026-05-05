CREATE TABLE `jobs_dead` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`original_job_id` integer,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`final_status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`failed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_dead_user_failed` ON `jobs_dead` (`user_id`,`failed_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_dead_original` ON `jobs_dead` (`original_job_id`);--> statement-breakpoint
CREATE TABLE `scheduler_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`acquired_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scheduler_locks_expires` ON `scheduler_locks` (`expires_at`);--> statement-breakpoint
CREATE TABLE `worker_state` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`heartbeat_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`current_job_id` integer,
	`pid` integer,
	`rss_mb` integer,
	`browser_connected` integer DEFAULT false NOT NULL,
	`last_error` text,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_worker_state_heartbeat` ON `worker_state` (`heartbeat_at`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_jobs_due`;--> statement-breakpoint
ALTER TABLE `jobs` ADD `priority` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_jobs_due` ON `jobs` (`status`,`priority`,`scheduled_at`);