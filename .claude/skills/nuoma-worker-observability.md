---
name: nuoma-worker-observability
description: Investigate worker health — stuck jobs, dedupe key analysis, scheduler heartbeat, DLQ entries, watchdog state. Generates SQL diagnostics, summarizes findings, suggests next actions. Works on V1 immediately; designed to be reusable in V2 with same DB shape.
user_invocable: true
---

# /nuoma-worker-observability — Worker health diagnostics

You are diagnosing the health of the Nuoma worker (V1) — or eventually V2. Generate SQL queries, summarize findings, suggest concrete actions. No mutations without explicit user confirmation.

## Boundaries

- **READ-ONLY by default**. Use `sqlite3` CLI in read-only mode against `storage/database/nuoma.db`.
- **NO writes without explicit user "yes"**. If you propose a fix that mutates DB, show the SQL first, ask for confirmation.
- **Don't restart processes silently**. If `pm2 restart` is suggested, ask first.

## Diagnostic dashboard

Run these in sequence and report each block:

### 1. Job queue status

```sql
SELECT status, COUNT(*) AS n,
       MIN(scheduled_at) AS earliest,
       MAX(scheduled_at) AS latest
FROM jobs
GROUP BY status;
```

Then by type:

```sql
SELECT type, status, COUNT(*) AS n
FROM jobs
GROUP BY type, status
ORDER BY type, status;
```

### 2. Stuck jobs (locked > 5 min)

```sql
SELECT id, type, status, locked_by,
       CAST((julianday('now') - julianday(locked_at)) * 24 * 60 AS INTEGER) AS minutes_locked,
       error_message
FROM jobs
WHERE status = 'processing'
  AND locked_at < datetime('now', '-5 minutes')
ORDER BY locked_at ASC;
```

If found: candidates for `releaseStaleJobLocks` or manual intervention.

### 3. Dedupe keys travadas (V1.1 patch context)

```sql
SELECT dedupe_key,
       COUNT(*) AS n,
       MIN(created_at) AS first_seen,
       GROUP_CONCAT(status) AS statuses
FROM jobs
WHERE dedupe_key IS NOT NULL
  AND status IN ('pending', 'processing')
GROUP BY dedupe_key
HAVING COUNT(*) > 1 OR MIN(created_at) < datetime('now', '-24 hours')
ORDER BY first_seen ASC
LIMIT 20;
```

Flag keys older than 24h — those are the silent block from missing `dedupe_expires_at`.

### 4. Worker state heartbeat

```sql
SELECT key,
       json_extract(value_json, '$.status') AS status,
       json_extract(value_json, '$.consecutive_failures') AS consec_failures,
       updated_at,
       CAST((julianday('now') - julianday(updated_at)) * 24 * 60 * 60 AS INTEGER) AS seconds_since_update
FROM worker_state
ORDER BY updated_at DESC;
```

If `seconds_since_update > 90`: worker is stale. Check process.

### 5. Recent failures

```sql
SELECT type,
       error_message,
       COUNT(*) AS n,
       MAX(updated_at) AS last_seen
FROM jobs
WHERE status = 'failed'
  AND updated_at > datetime('now', '-24 hours')
GROUP BY type, substr(error_message, 1, 80)
ORDER BY n DESC
LIMIT 10;
```

### 6. Scheduler activity

```sql
SELECT origin, severity, COUNT(*) AS n, MAX(created_at) AS last
FROM system_events
WHERE created_at > datetime('now', '-1 hour')
GROUP BY origin, severity
ORDER BY origin, severity;
```

### 7. Campaign progress

```sql
SELECT c.id, c.name, c.status,
       SUM(CASE WHEN cr.status='pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN cr.status='processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN cr.status='sent' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN cr.status='failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN cr.status='skipped' THEN 1 ELSE 0 END) AS skipped
FROM campaigns c
LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
WHERE c.status IN ('active', 'scheduled')
GROUP BY c.id;
```

## Output format

```md
# Worker Observability Report — <timestamp>

## Health summary
- Status: 🟢 healthy / 🟡 degraded / 🔴 broken
- Worker last heartbeat: X seconds ago
- Jobs in queue: N pending / M processing / K failed (24h)
- Stuck jobs (>5min): N

## Findings

1. [SEVERITY] Issue description
   - Affects: <table/feature>
   - Evidence: <SQL output snippet>
   - Suggestion: <concrete next step>

2. ...

## Actions proposed (require user confirmation)

- [ ] `releaseStaleJobLocks(5)` — releases N stuck jobs
- [ ] Cleanup dedupe keys with no `dedupe_expires_at` older than 7 days (V1.1 backfill)
- [ ] Restart worker if heartbeat > 90s

## Trends (if user wants)

- 24h job throughput: chart-able SQL
- Failure rate by type
- Dedupe block growth over time
```

## Common patterns

### Pattern: "campanha travada"

User says campaign isn't progressing. Run blocks 1, 7, 5. If pending recipients > 0 but no jobs in pending: scheduler tick may be paused. If jobs in pending but worker stuck: jobs blocked.

### Pattern: "msg não chega"

User says specific phone didn't receive msg. Run targeted query:

```sql
SELECT j.*, c.phone
FROM jobs j
LEFT JOIN contacts c ON c.id = json_extract(j.payload_json, '$.contactId')
WHERE c.phone = ? AND j.created_at > datetime('now', '-24 hours')
ORDER BY j.created_at DESC;
```

### Pattern: "worker fora do ar"

Block 4. If heartbeat stale: `pm2 list` → check status → consider `pm2 restart wa-worker` (ask first).

## Anti-patterns

- DON'T mutate jobs.status without user permission.
- DON'T DELETE rows.
- DON'T restart processes silently.
- DON'T claim "everything is fine" — always report block 4 worker state.

## Reference files

- V1 job queue: [`packages/core/src/repositories/job-repository.ts`](../../packages/core/src/repositories/job-repository.ts)
- Scheduler: [`apps/scheduler/src/index.ts`](../../apps/scheduler/src/index.ts)
- Existing runbook: [`docs/runbooks/worker-pm2.md`](../../docs/runbooks/worker-pm2.md)
- Roadmap V1.1, V1.5, V1.13, V1.14 (related patches)

## When to invoke

User says: "worker travou", "campanha não envia", "ver saúde do worker", "diagnosticar fila", "queue health", "dedupe stuck", "scheduler parado".
