CREATE TABLE `chatbot_variant_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `chatbot_id` integer NOT NULL,
  `rule_id` integer NOT NULL,
  `variant_id` text NOT NULL,
  `variant_label` text,
  `event_type` text NOT NULL,
  `channel` text NOT NULL,
  `contact_id` integer,
  `conversation_id` integer,
  `message_id` integer,
  `exposure_id` integer,
  `source_event_id` text,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`chatbot_id`) REFERENCES `chatbots`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`rule_id`) REFERENCES `chatbot_rules`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_chatbot_variant_events_rule` ON `chatbot_variant_events` (`user_id`,`chatbot_id`,`rule_id`);
--> statement-breakpoint
CREATE INDEX `idx_chatbot_variant_events_variant_type` ON `chatbot_variant_events` (`user_id`,`rule_id`,`variant_id`,`event_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chatbot_variant_events_source` ON `chatbot_variant_events` (`user_id`,`source_event_id`);
