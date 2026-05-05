ALTER TABLE `contacts` ADD `profile_photo_media_asset_id` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `profile_photo_sha256` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `profile_photo_updated_at` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `profile_photo_media_asset_id` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `profile_photo_sha256` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `profile_photo_updated_at` text;--> statement-breakpoint
CREATE INDEX `idx_conversations_user_profile_photo` ON `conversations` (`user_id`,`profile_photo_media_asset_id`);
