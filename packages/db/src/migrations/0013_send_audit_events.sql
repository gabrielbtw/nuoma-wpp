CREATE TABLE `send_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`user_id` integer NOT NULL,
	`campaign_id` integer,
	`contact_id` integer,
	`conversation_id` integer,
	`message_id` integer,
	`job_id` integer,
	`channel` text NOT NULL,
	`phase` text NOT NULL,
	`latency_ms` integer,
	`error_code` text,
	`error_message` text,
	`payload_hash` text,
	`worker_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_send_audit_campaign_occurred` ON `send_audit_events` (`campaign_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_send_audit_contact_occurred` ON `send_audit_events` (`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_send_audit_user_phase_occurred` ON `send_audit_events` (`user_id`,`phase`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_send_audit_job` ON `send_audit_events` (`job_id`);
