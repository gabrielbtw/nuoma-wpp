CREATE TABLE `worker_send_buckets` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `bucket_key` text NOT NULL,
  `tokens_milli` integer NOT NULL,
  `rate_limit_max` integer NOT NULL,
  `refill_window_ms` integer NOT NULL,
  `refilled_at_ms` integer NOT NULL,
  `last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_worker_send_buckets_user_bucket`
ON `worker_send_buckets` (`user_id`, `bucket_key`);
--> statement-breakpoint
CREATE INDEX `idx_worker_send_buckets_last_seen`
ON `worker_send_buckets` (`last_seen_at`);
