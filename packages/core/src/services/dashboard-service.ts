import { getDb } from "../db/connection.js";
import { listSystemEvents } from "../repositories/system-repository.js";

export function getDashboardSummary() {
  const db = getDb();
  const counts = {
    contacts: Number((db.prepare("SELECT COUNT(*) AS count FROM contacts WHERE deleted_at IS NULL").get() as { count: number }).count),
    tags: Number((db.prepare("SELECT COUNT(*) AS count FROM tags").get() as { count: number }).count),
    conversations: Number((db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as { count: number }).count),
    unreadConversations: Number(
      (db.prepare("SELECT COUNT(*) AS count FROM conversations WHERE unread_count > 0").get() as { count: number }).count
    ),
    activeAutomations: Number(
      (db.prepare("SELECT COUNT(*) AS count FROM automations WHERE enabled = 1").get() as { count: number }).count
    ),
    campaignsRunning: Number(
      (db.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE status IN ('ready', 'active', 'paused')").get() as { count: number }).count
    ),
    pendingJobs: Number(
      (db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('pending', 'processing')").get() as { count: number }).count
    )
  };

  const recentConversations = db
    .prepare(
      `
        SELECT conv.*, c.name AS contact_name
        FROM conversations conv
        LEFT JOIN contacts c ON c.id = conv.contact_id
        ORDER BY datetime(COALESCE(conv.last_message_at, conv.updated_at)) DESC
        LIMIT 8
      `
    )
    .all() as Array<Record<string, unknown>>;

  return {
    counts,
    recentConversations,
    recentEvents: listSystemEvents(20)
  };
}
