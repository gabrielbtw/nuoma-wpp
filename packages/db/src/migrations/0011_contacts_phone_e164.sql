ALTER TABLE `contacts` ADD `phone_e164` text;--> statement-breakpoint
CREATE INDEX `idx_contacts_user_phone_e164` ON `contacts` (`user_id`,`phone_e164`);
