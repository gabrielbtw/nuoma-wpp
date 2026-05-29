ALTER TABLE `contacts` ADD `wa_jid` text;--> statement-breakpoint
CREATE INDEX `idx_contacts_user_wa_jid` ON `contacts` (`user_id`,`wa_jid`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `wa_jid` text;--> statement-breakpoint
CREATE INDEX `idx_conversations_user_wa_jid` ON `conversations` (`user_id`,`wa_jid`);--> statement-breakpoint
DROP TRIGGER IF EXISTS `contacts_fts_ai`;--> statement-breakpoint
CREATE TRIGGER `contacts_fts_ai` AFTER INSERT ON `contacts` BEGIN
  INSERT OR REPLACE INTO `contacts_fts`(
    `rowid`,
    `name`,
    `phone`,
    `email`,
    `instagram_handle`,
    `notes`,
    `contact_id`,
    `user_id`,
    `deleted_at`
  )
  VALUES (
    new.`id`,
    coalesce(new.`name`, ''),
    coalesce(new.`phone`, ''),
    coalesce(new.`email`, ''),
    coalesce(new.`instagram_handle`, ''),
    coalesce(new.`notes`, ''),
    new.`id`,
    new.`user_id`,
    new.`deleted_at`
  );
END;--> statement-breakpoint
DROP TRIGGER IF EXISTS `contacts_fts_au`;--> statement-breakpoint
CREATE TRIGGER `contacts_fts_au` AFTER UPDATE ON `contacts` BEGIN
  DELETE FROM `contacts_fts` WHERE `rowid` = old.`id`;
  INSERT OR REPLACE INTO `contacts_fts`(
    `rowid`,
    `name`,
    `phone`,
    `email`,
    `instagram_handle`,
    `notes`,
    `contact_id`,
    `user_id`,
    `deleted_at`
  )
  VALUES (
    new.`id`,
    coalesce(new.`name`, ''),
    coalesce(new.`phone`, ''),
    coalesce(new.`email`, ''),
    coalesce(new.`instagram_handle`, ''),
    coalesce(new.`notes`, ''),
    new.`id`,
    new.`user_id`,
    new.`deleted_at`
  );
END;--> statement-breakpoint
CREATE TRIGGER `contacts_identity_backfill_after_insert`
AFTER INSERT ON `contacts`
WHEN NEW.`phone` IS NOT NULL
BEGIN
  UPDATE `contacts`
  SET
    `phone_e164` = COALESCE(
      NEW.`phone_e164`,
      CASE
        WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (10, 11)
          THEN '+' || '55' || replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')
        WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (12, 13)
          AND substr(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1, 2) = '55'
          THEN '+' || replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')
        ELSE NEW.`phone_e164`
      END
    ),
    `wa_jid` = COALESCE(
      NEW.`wa_jid`,
      CASE
        WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (10, 11)
          THEN '55' || replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
        WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (12, 13)
          AND substr(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1, 2) = '55'
          THEN replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
        ELSE NEW.`wa_jid`
      END
    )
  WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `contacts_identity_backfill_after_phone_update`
AFTER UPDATE OF `phone` ON `contacts`
WHEN NEW.`phone` IS NOT NULL
BEGIN
  UPDATE `contacts`
  SET
    `phone_e164` = CASE
      WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (10, 11)
        THEN '+' || '55' || replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')
      WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (12, 13)
        AND substr(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1, 2) = '55'
        THEN '+' || replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')
      ELSE NEW.`phone_e164`
    END,
    `wa_jid` = CASE
      WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (10, 11)
        THEN '55' || replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
      WHEN length(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (12, 13)
        AND substr(replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1, 2) = '55'
        THEN replace(replace(replace(replace(replace(replace(NEW.`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
      ELSE NEW.`wa_jid`
    END
  WHERE `id` = NEW.`id`;
END;
