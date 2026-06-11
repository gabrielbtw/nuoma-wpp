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

  const failedJobs = db.prepare(
    `SELECT j.id, j.type, j.error_message, j.updated_at, j.payload_json
     FROM jobs j
     WHERE j.status = 'failed'
     ORDER BY datetime(j.updated_at) DESC
     LIMIT 20`
  ).all() as Array<Record<string, unknown>>;

  const failedJobsCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'failed' AND datetime(updated_at) >= datetime('now', '-24 hours')").get() as { count: number }).count
  );

  const failedCampaignRecipients = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM campaign_recipients WHERE status = 'failed'").get() as { count: number }).count
  );

  return {
    counts,
    recentConversations,
    recentEvents: listSystemEvents(20),
    failures: {
      recentFailedJobs: failedJobsCount,
      totalFailedRecipients: failedCampaignRecipients,
      failedJobs: failedJobs.map((j) => ({
        id: String(j.id),
        type: String(j.type),
        error: String(j.error_message ?? ""),
        updatedAt: String(j.updated_at)
      }))
    }
  };
}
