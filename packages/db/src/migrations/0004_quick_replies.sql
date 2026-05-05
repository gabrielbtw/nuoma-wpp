CREATE TABLE `quick_replies` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `shortcut` text,
  `category` text,
  `is_active` integer DEFAULT true NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `usage_count` integer DEFAULT 0 NOT NULL,
  `last_used_at` text,
  `deleted_at` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_quick_replies_user_active_sort` ON `quick_replies` (`user_id`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_quick_replies_user_category` ON `quick_replies` (`user_id`,`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quick_replies_user_shortcut` ON `quick_replies` (`user_id`,`shortcut`);
