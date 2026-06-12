---
name: nuoma-debug
description: Diagnose Nuoma V2 runtime issues in worker/CDP/session/queue/overlay/observability. Read-only by default; covers old worker-observability, wa-session-runbook and CDP spike guidance.
user_invocable: true
---

# /nuoma-debug

Use for operational/runtime diagnosis.

## Boundaries

- Read-only by default. Show SQL or process mutations before applying them.
- Do not restart PM2, stop workers, reset sessions or send real messages without explicit approval.
- For live-send smoke, verify destination/canal and attach visual evidence; write `IG nao aplicavel` for WhatsApp-only tests.

## Quick triage

- `npm run typecheck --workspace @nuoma/worker`
- `pm2 status`
- `curl -s http://127.0.0.1:9222/json/version`

Check queue/session data through the V2 API/DB for the active stack. Confirm whether the issue is `apps/worker`, `apps/api`, `apps/web`, companion extension or legacy before changing files.

## Common focus areas

- CDP connection, Chromium profile, WhatsApp/Instagram auth state.
- Job queue claiming, stuck locks, DLQ/system events.
- Overlay bridge and quick actions.
- Sync latency, observer parse errors and artifacts.

## Validate

- `npm run typecheck --workspace @nuoma/worker`
- `npm run test --workspace @nuoma/worker`
