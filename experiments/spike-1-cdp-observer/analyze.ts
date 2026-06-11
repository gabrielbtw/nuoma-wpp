/**
 * Spike 1 — analyze captured events and produce a verde/amarelo/vermelho verdict.
 *
 * Reads spike.db (populated by run.ts) and computes:
 * - p50, p95, max latency (db_ts - dom_ts) for message-added events
 * - duplicate blocks (lifecycle_events.duplicate-blocked count)
 * - coverage: total unique data_ids vs expected (--expected=50 default)
 * - snapshot/sidebar/backfill coverage added by G.1a
 * - extraction quality for body/direction
 *
 * Usage: tsx analyze.ts [--expected=50]
 */
import Database from "better-sqlite3";
import * as path from "node:path";

const DB_PATH = path.resolve(import.meta.dirname, "spike.db");

const args = process.argv.slice(2);
const expected = (() => {
  const arg = args.find((a) => a.startsWith("--expected="));
  return arg ? Number(arg.split("=")[1]) : 50;
})();
const finalApprovalRun = expected >= 50;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function fmt(n: number) {
  return Number.isFinite(n) ? `${Math.round(n)}ms` : "n/a";
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function count(db: Database.Database, sql: string): number {
  const row = db.prepare(sql).get() as { n: number };
  return row.n;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const hasSidebarEvents = tableExists(db, "sidebar_events");
  const hasObserverEvents = tableExists(db, "observer_events");
  const hasDetailProbes = tableExists(db, "message_detail_probes");
  const hasMessageDate = columnExists(db, "captured", "message_date");
  const hasMessageTime = columnExists(db, "captured", "message_time");
  const hasMessageSecond = columnExists(db, "captured", "message_second");
  const hasMessagePrecision = columnExists(db, "captured", "message_timestamp_precision");

  const messages = db.prepare(`
    SELECT
      data_id,
      direction,
      body,
      ${hasMessageDate ? "message_date" : "NULL AS message_date"},
      ${hasMessageTime ? "message_time" : "NULL AS message_time"},
      ${hasMessageSecond ? "message_second" : "NULL AS message_second"},
      ${hasMessagePrecision ? "message_timestamp_precision" : "NULL AS message_timestamp_precision"},
      dom_ts,
      db_ts,
      (db_ts - dom_ts) AS latency_ms
    FROM captured
    WHERE event_type = 'message-added'
    ORDER BY dom_ts ASC
  `).all() as Array<{
    data_id: string;
    direction: string | null;
    body: string | null;
    message_date: string | null;
    message_time: string | null;
    message_second: number | null;
    message_timestamp_precision: string | null;
    dom_ts: number;
    db_ts: number;
    latency_ms: number;
  }>;

  const snapshots = count(db, `SELECT COUNT(*) AS n FROM captured WHERE event_type='message-snapshot'`);
  const uniqueSnapshots = count(db, `SELECT COUNT(DISTINCT data_id) AS n FROM captured WHERE event_type='message-snapshot'`);
  const snapshotUnknownDirection = count(db, `
    SELECT COUNT(DISTINCT data_id) AS n
    FROM captured
    WHERE event_type='message-snapshot' AND (direction IS NULL OR direction='unknown')
  `);
  const snapshotMissingDate = count(db, `
    SELECT COUNT(DISTINCT data_id) AS n
    FROM captured
    WHERE event_type='message-snapshot' AND message_date IS NULL
  `);
  const snapshotMissingTime = count(db, `
    SELECT COUNT(DISTINCT data_id) AS n
    FROM captured
    WHERE event_type='message-snapshot' AND message_time IS NULL
  `);
  const updates = count(db, `SELECT COUNT(*) AS n FROM captured WHERE event_type='message-updated'`);
  const removed = count(db, `SELECT COUNT(*) AS n FROM captured WHERE event_type='message-removed'`);
  const deliveryChanges = count(db, `SELECT COUNT(*) AS n FROM captured WHERE event_type='delivery-status-changed'`);
  const duplicates = count(db, `SELECT COUNT(*) AS n FROM lifecycle_events WHERE type='duplicate-blocked'`);
  const errors = count(db, `SELECT COUNT(*) AS n FROM lifecycle_events WHERE type IN ('observer-error','observer-failed')`);
  const snapshotCompletes = count(db, `SELECT COUNT(*) AS n FROM lifecycle_events WHERE type='message-snapshot-complete'`);
  const backfillRequested = count(db, `SELECT COUNT(*) AS n FROM lifecycle_events WHERE type='backfill-probe-requested'`);
  const backfillSkipped = count(db, `SELECT COUNT(*) AS n FROM lifecycle_events WHERE type='backfill-probe-skipped'`);

  const sidebarSnapshots = hasSidebarEvents
    ? count(db, `SELECT COUNT(*) AS n FROM sidebar_events WHERE event_type='conversation-row-snapshot'`)
    : 0;
  const sidebarChanges = hasSidebarEvents
    ? count(db, `SELECT COUNT(*) AS n FROM sidebar_events WHERE event_type='conversation-row-changed'`)
    : 0;
  const unreadChanges = hasSidebarEvents
    ? count(db, `SELECT COUNT(*) AS n FROM sidebar_events WHERE event_type='conversation-unread-changed'`)
    : 0;
  const observerEventTotal = hasObserverEvents
    ? count(db, `SELECT COUNT(*) AS n FROM observer_events`)
    : 0;
  const detailProbeCount = hasDetailProbes
    ? count(db, `SELECT COUNT(*) AS n FROM message_detail_probes`)
    : 0;
  const detailProbeWithSeconds = hasDetailProbes
    ? count(db, `SELECT COUNT(*) AS n FROM message_detail_probes WHERE has_seconds=1`)
    : 0;
  const detailProbeOkWithoutSeconds = hasDetailProbes
    ? count(db, `SELECT COUNT(*) AS n FROM message_detail_probes WHERE ok=1 AND has_seconds=0`)
    : 0;
  const lastDetailProbe = hasDetailProbes
    ? db.prepare(`
        SELECT data_id, ok, stage, has_seconds, timestamp_candidates_json, payload_json, probed_at
        FROM message_detail_probes
        ORDER BY id DESC
        LIMIT 1
      `).get() as {
        data_id: string | null;
        ok: number;
        stage: string;
        has_seconds: number;
        timestamp_candidates_json: string | null;
        payload_json: string | null;
        probed_at: number;
      } | undefined
    : undefined;

  const observerReady = db.prepare(`SELECT ts, payload_json FROM lifecycle_events WHERE type='observer-ready' ORDER BY ts ASC LIMIT 1`).get() as { ts: number; payload_json: string } | undefined;

  const latencies = messages.map((m) => m.latency_ms).filter((n) => Number.isFinite(n) && n >= 0);
  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = latencies.at(-1) ?? 0;

  const byDirection = messages.reduce<Record<string, number>>((acc, m) => {
    const k = m.direction ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const missingDirection = messages.filter((m) => !m.direction || m.direction === "unknown").length;
  const missingBody = messages.filter((m) => !m.body || m.body.trim().length === 0).length;
  const missingDate = messages.filter((m) => !m.message_date).length;
  const missingTime = messages.filter((m) => !m.message_time).length;
  const missingSecond = messages.filter((m) => m.message_second == null).length;
  const minutePrecision = messages.filter((m) => m.message_timestamp_precision === "minute").length;
  const extractionTolerance = Math.max(1, Math.floor(messages.length * 0.05));

  const verdict = (() => {
    if (latencies.length < expected) return { color: "amarelo", reason: `only ${latencies.length}/${expected} messages captured` };
    if (p95 > 3000) return { color: "vermelho", reason: `p95 ${fmt(p95)} > 3000ms target` };
    if (p95 > 1500) return { color: "amarelo", reason: `p95 ${fmt(p95)} above 1.5s comfort margin` };
    if (duplicates > 0) return { color: "amarelo", reason: `${duplicates} duplicates detected (need investigation)` };
    if (errors > 0) return { color: "amarelo", reason: `${errors} observer errors logged` };
    if (p50 > 1000) return { color: "amarelo", reason: `p50 ${fmt(p50)} > 1000ms target` };
    if (messages.length > 0 && missingDirection === messages.length) {
      return { color: "amarelo", reason: "all captured messages still have unknown direction" };
    }
    if (messages.length > 0 && missingDirection > extractionTolerance) {
      return { color: "amarelo", reason: `${missingDirection}/${messages.length} messages have unknown direction; harden metadata extraction` };
    }
    if (messages.length > 0 && missingDate > extractionTolerance) {
      return { color: "amarelo", reason: `${missingDate}/${messages.length} messages missing date; harden timestamp extraction` };
    }
    if (messages.length > 0 && missingTime > extractionTolerance) {
      return { color: "amarelo", reason: `${missingTime}/${messages.length} messages missing time; harden timestamp extraction` };
    }
    if (messages.length > 0 && missingSecond > 0) {
      if (detailProbeWithSeconds > 0) {
        return { color: "amarelo", reason: `${missingSecond}/${messages.length} messages missing seconds; implement message details fallback` };
      }
      if (detailProbeOkWithoutSeconds === 0) {
        return { color: "amarelo", reason: `${missingSecond}/${messages.length} messages missing seconds; run message details probe before approving` };
      }
    }
    return {
      color: "verde",
      reason: missingSecond > 0
        ? "latency/dedup targets met; WhatsApp display timestamp is minute-precision, use observed_at_utc per ADR 0012"
        : "all targets met",
    };
  })();

  console.log("\n=== Spike 1 — CDP Observer Analysis ===\n");
  console.log(`Observer ready: ${observerReady ? "yes (" + new Date(observerReady.ts).toISOString() + ")" : "NEVER"}`);
  console.log(`Messages captured: ${messages.length} (expected: ${expected})`);
  console.log(`Visible snapshots captured: ${snapshots} (${uniqueSnapshots} unique data_ids)`);
  console.log(`Snapshot complete events: ${snapshotCompletes}`);
  console.log(`Duplicates blocked: ${duplicates}`);
  console.log(`Observer errors: ${errors}`);
  console.log(`message-updated events: ${updates}`);
  console.log(`message-removed events: ${removed}`);
  console.log(`delivery-status-changed events: ${deliveryChanges}`);
  console.log(`Sidebar row snapshots: ${sidebarSnapshots}`);
  console.log(`Sidebar row changes: ${sidebarChanges}`);
  console.log(`Unread changes: ${unreadChanges}`);
  console.log(`Backfill probes requested/skipped: ${backfillRequested}/${backfillSkipped}`);
  console.log(`Raw observer events: ${observerEventTotal}`);
  console.log(`Message detail probes: ${detailProbeCount} (${detailProbeWithSeconds} with seconds)`);
  if (lastDetailProbe) {
    console.log(`Last detail probe:`, {
      dataId: lastDetailProbe.data_id,
      ok: Boolean(lastDetailProbe.ok),
      stage: lastDetailProbe.stage,
      hasSeconds: Boolean(lastDetailProbe.has_seconds),
      timestampCandidates: JSON.parse(lastDetailProbe.timestamp_candidates_json || "[]"),
      probedAt: new Date(lastDetailProbe.probed_at).toISOString(),
    });
  }
  console.log("");
  console.log(`Latency:`);
  console.log(`  p50: ${fmt(p50)}`);
  console.log(`  p95: ${fmt(p95)}`);
  console.log(`  max: ${fmt(max)}`);
  console.log("");
  console.log(`By direction:`, byDirection);
  console.log(`Extraction quality:`);
  console.log(`  unknown direction: ${missingDirection}/${messages.length}`);
  console.log(`  empty body: ${missingBody}/${messages.length}`);
  console.log(`  missing date: ${missingDate}/${messages.length}`);
  console.log(`  missing time: ${missingTime}/${messages.length}`);
  console.log(`  missing second: ${missingSecond}/${messages.length}`);
  console.log(`  minute precision only: ${minutePrecision}/${messages.length}`);
  console.log(`Snapshot extraction quality:`);
  console.log(`  unknown direction: ${snapshotUnknownDirection}/${uniqueSnapshots}`);
  console.log(`  missing date: ${snapshotMissingDate}/${uniqueSnapshots}`);
  console.log(`  missing time: ${snapshotMissingTime}/${uniqueSnapshots}`);
  if (missingSecond > 0 && detailProbeOkWithoutSeconds > 0 && detailProbeWithSeconds === 0) {
    console.log(`  details fallback: ${detailProbeOkWithoutSeconds} successful probe(s), 0 exposed seconds; ADR 0012 path active`);
  }
  console.log("");
  console.log(`VERDICT: ${verdict.color.toUpperCase()} — ${verdict.reason}`);
  console.log("");

  if (verdict.color === "verde") {
    if (finalApprovalRun) {
      console.log("→ Approve ADR 0007 (sync hybrid Playwright+CDP). Unblocks V2.6 in roadmap.");
    } else {
      console.log("→ Diagnostic/probe run passed. Full G.1 approval still requires a 50-message run.");
    }
  } else if (verdict.color === "amarelo") {
    console.log("→ Investigate the issue above, retest before approving the ADR.");
  } else {
    console.log("→ Recua. Sync engine V2 needs rethinking. Don't create nuoma-wpp-v2/ yet.");
  }

  db.close();
}

main();
