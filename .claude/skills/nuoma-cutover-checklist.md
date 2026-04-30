---
name: nuoma-cutover-checklist
description: Pre-cutover checklist for V1 → V2 transition. Verify backups, V2 soak metrics, primary number readiness, rollback plan, post-cutover monitoring window. Run only when V2 has reached feature parity and team is ready to switch primary number from V1 to V2.
user_invocable: true
---

# /nuoma-cutover-checklist — V1→V2 cutover protocol

You are gating the cutover from V1 to V2. This skill is invoked **only** when V2 is feature-complete, has soaked for at least 2 weeks on a test number, and team confidence is high. Do **NOT** run cutover on a whim.

## Pre-flight gates (ALL must be green)

### Gate 1: Soak period

- [ ] V2 has been running on test chip number for ≥ 14 days continuous.
- [ ] In that period: zero critical bugs in audio (IC-1) or multi-step sender (IC-2).
- [ ] Sync engine `sync_event_latency_ms` p95 < 3s sustained.
- [ ] Job queue throughput ≥ V1 baseline.
- [ ] Worker memory pressure stable (no OOM kills).
- [ ] Web Push delivered for all critical events.
- [ ] Backup S3 daily ran and at least 1 restore test was successful.

Generate report:

```sql
-- V2 metrics over last 14 days
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS events,
  SUM(CASE WHEN severity='error' THEN 1 ELSE 0 END) AS errors
FROM system_events
WHERE created_at > datetime('now', '-14 days')
GROUP BY DATE(created_at)
ORDER BY day;
```

### Gate 2: Feature parity

- [ ] All V1 features available in V2 (verified by manual checklist):
  - Inbox unified WA+IG: ✓
  - Send text/image/video/audio/file: ✓
  - Voice recording (IC-1): ✓
  - Multi-step campaign without reload (IC-2): ✓
  - Automation triggers and actions: ✓
  - Chatbot rules: ✓
  - Tags / Attendants / Reminders: ✓
  - CSV import: ✓
  - Health dashboard: ✓
- [ ] Performance: V2 page load times ≤ V1 (no UX regression).

### Gate 3: Migration dryrun green

- [ ] Run `/v1-to-v2-migration-dryrun` against current V1 DB.
- [ ] Spike 4 results: row counts match, orphans <5%, schema valid.
- [ ] All "Decisões pendentes" from V1_TO_V2_DATA_MAP.md resolved.
- [ ] Migration script tested end-to-end against a clone of V1 DB.

### Gate 4: Backup chain

- [ ] V1 final backup just created (`s3://nuoma-files/nuoma-wpp/v1-frozen-<timestamp>/`).
- [ ] Backup verified by `aws s3 ls` showing expected size.
- [ ] V2 first backup post-migration also planned.

### Gate 5: Rollback plan documented and rehearsed

- [ ] Documented in `docs/runbooks/CUTOVER_ROLLBACK.md`.
- [ ] At least one team member walked through the rollback steps mentally.
- [ ] Rollback time estimate: < 30 minutes.

## Cutover execution

### Phase 1: Preparation (T-1 hour)

```bash
# 1. Final V1 backup
ssh ubuntu@3.149.108.173 'cd ~/nuoma-wpp && ./scripts/backup-now.sh'

# 2. Verify V1 has zero pending campaigns
sqlite3 storage/database/nuoma.db \
  "SELECT id, name FROM campaigns WHERE status='active' AND \
   EXISTS (SELECT 1 FROM campaign_recipients WHERE campaign_id=campaigns.id AND status='pending')"
# If result non-empty: pause campaigns, wait for drain, OR accept that pending will migrate.

# 3. Verify V2 health
curl https://<v2-domain>/api/system/health
```

### Phase 2: Drain (T-30 min)

- [ ] Stop new campaign enqueueing (set scheduler to maintenance mode if available).
- [ ] Wait for processing jobs to complete (max 15 min).
- [ ] Check `jobs WHERE status='processing'` count → should drop to 0.

### Phase 3: Stop V1

```bash
# 1. Stop V1 worker
pm2 stop wa-worker

# 2. Stop V1 scheduler
pm2 stop scheduler

# 3. Web app pode continuar lendo (read-only) durante migration
```

### Phase 4: Run real migration

```bash
ssh ubuntu@3.149.108.173 'cd ~/nuoma-wpp-v2 && \
  bun run migrate:v1-to-v2 --source=/path/to/v1-snapshot.db --target=/data/nuoma-v2.db'
```

Validate:

- Migration log shows expected row counts.
- V2 health check passes.
- Spot check: open V2 inbox, see latest conversations from V1.

### Phase 5: WhatsApp number switch

1. **On primary number phone**: WhatsApp → Settings → Linked Devices → unlink "V1 session".
2. **On V2 hosted UI**: navigate to login → scan QR with primary number.
3. Wait for V2 worker to authenticate (`worker_state.status='authenticated'`).
4. V2 takes over messaging.

### Phase 6: Smoke test (T+0)

- [ ] Send test message from another phone → arrives in V2 inbox in <3s.
- [ ] Send outgoing message from V2 → arrives at recipient.
- [ ] Record voice message from V2 → arrives as native voice.
- [ ] Trigger a small campaign (5 recipients) → completes successfully.
- [ ] Web Push notification fires for a synthetic event.

### Phase 7: Monitoring window (T+24h)

- [ ] Check `system_events` every 4 hours for 24h.
- [ ] Watch memory pressure on host.
- [ ] Confirm S3 backup ran at 02h BRT.
- [ ] No user-reported regressions.

## Rollback (if any phase fails)

1. **Stop V2** (`docker compose stop` on Lightsail).
2. **On primary phone**: unlink V2 session.
3. **Start V1** (`pm2 start wa-worker scheduler` on V1 machine).
4. **Re-scan QR** if needed (V1 may have lost session due to V2 brief takeover).
5. V1 resume operations.
6. Document failure in `system_events` + Slack/Telegram alert.
7. Open RCA ticket. **Don't retry cutover until RCA is published.**

## Post-cutover (T+30 days)

- V1 stays in read-only freeze (DB + profile snapshot in S3).
- After 30 days stable on V2, V1 can be archived offline (cold S3 storage).

## Anti-patterns

- DON'T cutover on Friday afternoon.
- DON'T skip the soak period.
- DON'T rollback halfway — commit to one direction.
- DON'T cutover without final backup confirmed.
- DON'T cutover without rollback rehearsed.

## Reference files

- [`docs/migration/V1_TO_V2_DATA_MAP.md`](../../docs/migration/V1_TO_V2_DATA_MAP.md)
- [`docs/architecture/V2_DECISION.md`](../../docs/architecture/V2_DECISION.md)
- [`docs/runbooks/CUTOVER_ROLLBACK.md`](../../docs/runbooks/CUTOVER_ROLLBACK.md) (a ser criado durante Fase 14a)

## When to invoke

User says: "preparar cutover", "ir pra V2", "migrar produção", "cutover checklist", "trocar de V1 pra V2".
