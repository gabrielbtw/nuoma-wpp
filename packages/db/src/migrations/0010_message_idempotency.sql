ALTER TABLE `messages` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `dispatched_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `dispatch_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_idempotency` ON `messages` (`idempotency_key`) WHERE "messages"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `message_dispatch_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idempotency_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`worker_id` text NOT NULL,
	`phase` text NOT NULL,
	`message_id` integer,
	`external_id` text,
	`error` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_mda_key_phase` ON `message_dispatch_attempts` (`idempotency_key`,`phase`);--> statement-breakpoint
CREATE INDEX `idx_mda_job` ON `message_dispatch_attempts` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_mda_user_started` ON `message_dispatch_attempts` (`user_id`,`started_at`);
