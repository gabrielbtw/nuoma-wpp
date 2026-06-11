UPDATE `conversations`
SET `wa_jid` = CASE
  WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (10, 11)
    THEN '55' || replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
  WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (12, 13)
    AND substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1, 2) = '55'
    THEN replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
  ELSE `wa_jid`
END
WHERE `channel` = 'whatsapp'
  AND (
    `wa_jid` IS NULL
    OR trim(`wa_jid`) = ''
    OR lower(`wa_jid`) LIKE '%@c.us'
    OR lower(`wa_jid`) NOT LIKE '%@s.whatsapp.net'
  );--> statement-breakpoint
DROP TRIGGER IF EXISTS `conversations_wa_jid_backfill_after_insert`;--> statement-breakpoint
CREATE TRIGGER `conversations_wa_jid_backfill_after_insert`
AFTER INSERT ON `conversations`
WHEN NEW.`channel` = 'whatsapp'
BEGIN
  UPDATE `conversations`
  SET `wa_jid` = CASE
    WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (10, 11)
      THEN '55' || replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
    WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (12, 13)
      AND substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1, 2) = '55'
      THEN replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
    ELSE NEW.`wa_jid`
  END
  WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
DROP TRIGGER IF EXISTS `conversations_wa_jid_backfill_after_thread_update`;--> statement-breakpoint
CREATE TRIGGER `conversations_wa_jid_backfill_after_thread_update`
AFTER UPDATE OF `external_thread_id` ON `conversations`
WHEN NEW.`channel` = 'whatsapp'
BEGIN
  UPDATE `conversations`
  SET `wa_jid` = CASE
    WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (10, 11)
      THEN '55' || replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
    WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) IN (12, 13)
      AND substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 1, 2) = '55'
      THEN replace(replace(replace(replace(replace(replace(replace(replace(lower(coalesce(NEW.`external_thread_id`, '')), '@s.whatsapp.net', ''), '@c.us', ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') || '@s.whatsapp.net'
    ELSE NEW.`wa_jid`
  END
  WHERE `id` = NEW.`id`;
END;
