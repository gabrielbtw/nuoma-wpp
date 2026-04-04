import { randomUUID } from "node:crypto";
import { getDb, withSqliteBusyRetry } from "../db/connection.js";
import type { JobType } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
}

export function enqueueJob(input: {
  type: JobType;
  payload: Record<string, unknown>;
  scheduledAt?: string;
  dedupeKey?: string | null;
  maxAttempts?: number;
}) {
  const db = getDb();
  return withSqliteBusyRetry(() => {
    const id = randomUUID();
    const timestamp = nowIso();

    // Atomic deduplication: check + insert in single transaction
    const transaction = db.transaction(() => {
      if (input.dedupeKey) {
        const existing = db
          .prepare("SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('pending', 'processing')")
          .get(input.dedupeKey) as { id: string } | undefined;
        if (existing) return existing.id;
      }

      db.prepare(
        `INSERT INTO jobs (
          id, type, status, dedupe_key, payload_json, scheduled_at, attempts, max_attempts, created_at, updated_at
        ) VALUES (?, ?, 'pending', ?, ?, ?, 0, ?, ?, ?)`
      ).run(
        id, input.type, input.dedupeKey ?? null, JSON.stringify(input.payload),
        input.scheduledAt ?? timestamp, input.maxAttempts ?? 3, timestamp, timestamp
      );
      return id;
    });

    return transaction();
  });
}

export function claimDueJob(workerId: string) {
  return claimDueJobForTypes(workerId, null);
}

export function claimDueJobForTypes(workerId: string, allowedTypes: JobType[] | null) {
  const db = getDb();
  const timestamp = nowIso();
  const typeFilter =
    allowedTypes && allowedTypes.length > 0 ? `AND type IN (${allowedTypes.map(() => "?").join(", ")})` : "";

  return withSqliteBusyRetry(() => {
    const row = db
      .prepare(
        `
          WITH next_job AS (
            SELECT id
            FROM jobs
            WHERE status = 'pending'
              AND datetime(scheduled_at) <= datetime('now')
              ${typeFilter}
            ORDER BY datetime(scheduled_at) ASC, created_at ASC
            LIMIT 1
          )
          UPDATE jobs
          SET status = 'processing', locked_at = ?, locked_by = ?, attempts = attempts + 1, updated_at = ?
          WHERE id = (SELECT id FROM next_job)
          RETURNING *
        `
      )
      .get(...(allowedTypes ?? []), timestamp, workerId, timestamp) as Record<string, unknown> | undefined;

    return row ?? null;
  });
}

export function completeJob(jobId: string) {
  const db = getDb();
  const timestamp = nowIso();
  withSqliteBusyRetry(() => {
    db.prepare(
      `
        UPDATE jobs
        SET status = 'done', error_message = NULL, finished_at = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(timestamp, timestamp, jobId);
  });
}

export function failJob(jobId: string, errorMessage: string) {
  const db = getDb();
  const timestamp = nowIso();
  withSqliteBusyRetry(() => {
    const row = db.prepare("SELECT attempts, max_attempts FROM jobs WHERE id = ?").get(jobId) as
      | { attempts: number; max_attempts: number }
      | undefined;

    if (!row) {
      return;
    }

    const shouldRetry = row.attempts < row.max_attempts;
    db.prepare(
      `
        UPDATE jobs
        SET
          status = ?,
          error_message = ?,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = ?,
          scheduled_at = CASE
            WHEN ? = 1 THEN datetime('now', '+' || (? * 2) || ' minutes')
            ELSE scheduled_at
          END,
          finished_at = CASE
            WHEN ? = 1 THEN NULL
            ELSE ?
          END
        WHERE id = ?
      `
    ).run(shouldRetry ? "pending" : "failed", errorMessage, timestamp, shouldRetry ? 1 : 0, row.attempts, shouldRetry ? 1 : 0, timestamp, jobId);
  });
}

export function failJobPermanently(jobId: string, errorMessage: string) {
  const db = getDb();
  const timestamp = nowIso();
  withSqliteBusyRetry(() => {
    db.prepare(
      `
        UPDATE jobs
        SET
          status = 'failed',
          error_message = ?,
          locked_at = NULL,
          locked_by = NULL,
          finished_at = ?,
          updated_at = ?
        WHERE id = ?
      `
    ).run(errorMessage, timestamp, timestamp, jobId);
  });
}

/**
 * Release stale job locks older than the given minutes threshold.
 * Called by the scheduler watchdog to prevent jobs from being stuck forever.
 */
export function releaseStaleJobLocks(staleMinutes = 5) {
  const db = getDb();
  return withSqliteBusyRetry(() => {
    const result = db.prepare(
      `UPDATE jobs
       SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = ?
       WHERE status = 'processing'
         AND locked_at IS NOT NULL
         AND datetime(locked_at) < datetime('now', '-' || ? || ' minutes')`
    ).run(nowIso(), staleMinutes);
    return result.changes;
  });
}

export function listRecentJobs(limit = 50, offset = 0) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM jobs ORDER BY datetime(updated_at) DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Array<Record<string, unknown>>;
}
