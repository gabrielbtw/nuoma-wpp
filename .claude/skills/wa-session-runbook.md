---
name: wa-session-runbook
description: Operational runbook for Chromium WhatsApp session lifecycle — QR code scan, profile dir persistence, memory pressure, reconnect strategy, primary number vs test number coordination during V1+V2 coexistence. Use when WPP session is broken, expired, or migrating.
user_invocable: true
---

# /wa-session-runbook — WhatsApp Session Operations

You are managing the Chromium WhatsApp session lifecycle. Common scenarios: QR rescan, profile dir corruption, memory OOM kill, V1+V2 number coordination, session migration.

## Context

WhatsApp Web allows **only 1 active session per phone number**. If V1 and V2 use the same number simultaneously, they will disconnect each other. Strategy during build phase: V1 uses primary number, V2 uses test chip.

## Scenarios

### Scenario A: V1 worker shows status `disconnected` and QR is needed

**Symptoms**:

- `worker_state` table shows `status='disconnected'`, `auth_status='disconnected'`.
- Channel session strip in UI is red.
- Logs show `qrCodeDetected` events.

**Steps**:

1. Confirm Chromium is running:
   ```bash
   ps aux | grep -i chromium | grep -v grep
   ```
2. Check profile dir exists and isn't locked:
   ```bash
   ls -la storage/chromium-profile/whatsapp/
   ```
3. Open Chromium window (it's offscreen at `--window-position=-2000,-2000`). On macOS:
   ```bash
   osascript -e 'tell application "System Events" to tell (first process whose name contains "Chromium") to set position of front window to {0, 0}'
   ```
4. Scan QR with phone (WhatsApp app → Linked Devices → Link a Device).
5. Wait for `#pane-side` to appear (worker auto-detects).
6. Confirm worker status flipped to `authenticated` in DB.

**If QR doesn't appear or session refuses**:

- Try `npm run worker:reset-session` (if exists) or manually:
  ```bash
  pm2 stop wa-worker
  rm -rf storage/chromium-profile/whatsapp/Default/Service\ Worker/
  pm2 start wa-worker
  ```
- Last resort: delete entire profile dir, accept full re-auth.

### Scenario B: Worker keeps OOM-killed (RSS > 1500MB)

**Symptoms**:

- PM2 logs show frequent restarts.
- `system_events` shows `memory-pressure` warnings.
- Browser becomes unresponsive intermittently.

**Steps**:

1. Check current memory:
   ```bash
   ps aux --sort=-rss | head -10
   ```
2. Confirm swap is available (V2 uses 8GB swap on host):
   ```bash
   swapon --show
   free -m
   ```
3. If too many tabs open in Chromium: close unused (worker only needs WhatsApp tab + maybe Instagram).
4. Restart worker gracefully:
   ```bash
   pm2 restart wa-worker
   ```
5. Long-term: if recurring, raise `WORKER_MAX_RSS_MB` env from 700 to 1200 (already in V1.9 patch list).

### Scenario C: V1 → V2 number transition (cutover)

**Pre-cutover state**:

- V1 logged in with primary number.
- V2 logged in with test chip.

**Cutover steps**:

1. Snapshot V1: backup DB + profile dir to `s3://nuoma-files/nuoma-wpp/v1-frozen-<timestamp>/`.
2. Stop V1 worker (`pm2 stop wa-worker` on V1 machine). V1 still readable, just not sending.
3. On test chip phone: open WhatsApp → Linked Devices → unlink "V2 test session".
4. On primary number phone: open WhatsApp → Linked Devices → unlink "V1 session".
5. On V2 hosted app: navigate to login → scan QR → primary number authenticates V2.
6. V2 takes over. V1 stays read-only.

**Rollback** (if V2 broken in cutover):

1. On V2: stop worker container, signal "rollback".
2. On primary phone: unlink V2 session.
3. On V1 machine: `pm2 start wa-worker`. Worker re-detects session (may need QR rescan).
4. V1 resume operations.

### Scenario D: Profile dir corruption (rare)

**Symptoms**:

- Chromium fails to start.
- Logs show `Database disk image is malformed` or similar SQLite errors inside profile.

**Steps**:

1. Stop worker.
2. Move `storage/chromium-profile/whatsapp/` to `whatsapp.broken-<date>/`.
3. Start worker — it'll create new empty profile.
4. Scan QR fresh.
5. Lose: cookies, conversation drafts, undeliverable cached attachments. Don't lose: messages (those live in DB, not profile).

### Scenario E: Multi-attendant pattern decision (V2 future)

V1 is single-user. V2 schema preparado for multi-user (`user_id` everywhere). But WhatsApp session is **per number**, not per user. Two valid approaches:

1. **Shared inbox model**: 1 number, N attendants share one inbox. Audit logs trace who answered. Simplest. Default for V2 V1.
2. **Multi-tenant model**: each "tenant" has own number, own Chromium session, own profile dir. Complex. Defer to V2 fase 11.

**Decision pending until product validates**.

## Reference files

- V1 worker session code: [`apps/wa-worker/src/worker.ts:777+`](../../apps/wa-worker/src/worker.ts) (refreshAuthState)
- Existing runbook: [`docs/runbooks/worker-pm2.md`](../../docs/runbooks/worker-pm2.md)
- Migration plan: [`docs/migration/V1_TO_V2_DATA_MAP.md`](../../docs/migration/V1_TO_V2_DATA_MAP.md)

## When to invoke

User says: "WhatsApp desconectou", "preciso escanear QR", "worker matando memória", "fazer cutover", "como migrar número", "profile corrompido".
