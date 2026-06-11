WITH ranked AS (
  SELECT
    `id`,
    row_number() OVER (
      PARTITION BY `user_id`, `wa_jid`
      ORDER BY coalesce(`last_message_at`, `updated_at`, `created_at`, '') DESC, `id` DESC
    ) AS `rank`
  FROM `conversations`
  WHERE `channel` = 'whatsapp'
    AND `wa_jid` IS NOT NULL
    AND trim(`wa_jid`) != ''
    AND `is_archived` = 0
)
UPDATE `conversations`
SET
  `is_archived` = 1,
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (
  SELECT `id` FROM `ranked` WHERE `rank` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversations_user_wa_jid_active`
ON `conversations` (`user_id`, `wa_jid`)
WHERE `channel` = 'whatsapp'
  AND `wa_jid` IS NOT NULL
  AND trim(`wa_jid`) != ''
  AND `is_archived` = 0;
