ALTER TABLE `campaign_recipients` ADD `active_pipeline_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_recipients_active_pipeline` ON `campaign_recipients` (`user_id`,`active_pipeline_key`);
