ALTER TABLE `contact_tags` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `contact_tags`
SET `sort_order` = (
  SELECT COUNT(*)
  FROM `contact_tags` AS earlier
  WHERE earlier.`contact_id` = `contact_tags`.`contact_id`
    AND (
      earlier.`created_at` < `contact_tags`.`created_at`
      OR (
        earlier.`created_at` = `contact_tags`.`created_at`
        AND earlier.`tag_id` <= `contact_tags`.`tag_id`
      )
    )
) - 1;
