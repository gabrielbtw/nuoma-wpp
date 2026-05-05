CREATE VIRTUAL TABLE `contacts_fts` USING fts5(
  `name`,
  `phone`,
  `email`,
  `instagram_handle`,
  `notes`,
  `contact_id` UNINDEXED,
  `user_id` UNINDEXED,
  `deleted_at` UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);--> statement-breakpoint
INSERT INTO `contacts_fts`(
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
SELECT
  `id`,
  coalesce(`name`, ''),
  coalesce(`phone`, ''),
  coalesce(`email`, ''),
  coalesce(`instagram_handle`, ''),
  coalesce(`notes`, ''),
  `id`,
  `user_id`,
  `deleted_at`
FROM `contacts`;--> statement-breakpoint
CREATE TRIGGER `contacts_fts_ai` AFTER INSERT ON `contacts` BEGIN
  INSERT INTO `contacts_fts`(
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
CREATE TRIGGER `contacts_fts_au` AFTER UPDATE ON `contacts` BEGIN
  DELETE FROM `contacts_fts` WHERE `rowid` = old.`id`;
  INSERT INTO `contacts_fts`(
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
CREATE TRIGGER `contacts_fts_ad` AFTER DELETE ON `contacts` BEGIN
  DELETE FROM `contacts_fts` WHERE `rowid` = old.`id`;
END;
