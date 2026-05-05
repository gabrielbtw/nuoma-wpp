CREATE TABLE `attachment_candidates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `conversation_id` integer NOT NULL,
  `message_id` integer,
  `media_asset_id` integer NOT NULL,
  `channel` text NOT NULL,
  `content_type` text NOT NULL,
  `external_message_id` text,
  `caption` text,
  `observed_at` text NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_attachment_candidates_user_conversation_observed` ON `attachment_candidates` (`user_id`,`conversation_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_attachment_candidates_user_media` ON `attachment_candidates` (`user_id`,`media_asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attachment_candidates_user_conversation_external_media` ON `attachment_candidates` (`user_id`,`conversation_id`,`external_message_id`,`media_asset_id`);
