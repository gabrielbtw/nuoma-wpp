# V2 Development

## Status

V2.1-V2.6 is implemented: foundations, contracts, SQLite persistence,
auth, local login shell, durable job queue, safe worker loop and CDP-native sync
observer.

The worker does not send WhatsApp messages. Send-like jobs are moved to DLQ
until the real sender phases land.

V2.6 sync jobs are receive-only. `sync_conversation`, `sync_history` and
`sync_inbox_force` may navigate/reconcile chats, but they do not touch the
WhatsApp composer.

Only a worker with connected sync runtime can claim sync jobs. Generic local
workers skip `sync_conversation`, `sync_history` and `sync_inbox_force` so the
queue does not route those jobs to a process that cannot reconcile the browser.

The web operations shell includes the first sync controls:

- conversation list from `GET /api/admin/conversations`
- "Ressincronizar" action backed by
  `POST /api/admin/sync/conversations/:id/force`
- recent operational events from `GET /api/admin/system/events`

## Commands

```bash
nvm use
npm install
npm run typecheck
npm test
npm run build
```

Run local processes:

```bash
npm run dev
```

Default ports:

- API: `127.0.0.1:3001`
- Web: `127.0.0.1:3002`
- Worker CDP: `127.0.0.1:9223`

Worker defaults:

- `WORKER_BROWSER_ENABLED=false`
- `WORKER_BROWSER_ATTACH_EXISTING=true`
- `WORKER_KEEP_BROWSER_OPEN=true`
- `WORKER_SYNC_ENABLED=false`
- `WORKER_SYNC_RECONCILE_MS=60000`
- `WORKER_SYNC_MULTI_CHAT_ENABLED=false`
- `WORKER_SYNC_MULTI_CHAT_LIMIT=5`
- `WORKER_SYNC_MULTI_CHAT_DELAY_MS=1200`
- `WORKER_JOB_LOOP_ENABLED=true`
- `CHROMIUM_PROFILE_DIR=../../data/chromium-profile/whatsapp`

## Layer rules

- `apps/api`: HTTP runtime and API composition.
- `apps/web`: React UI only.
- `apps/worker`: WhatsApp Web browser runtime only.
- `packages/contracts`: Zod contracts shared by apps.
- `packages/db`: Drizzle schema, repositories and migrations.
- `packages/config`: env parsing and constants.
- `packages/ui`: design tokens and later UI primitives.

## V1 coexistence

Do not point V2 at V1's database or Chromium profile. V2 uses `data/` and port
9223 so both systems can coexist until cutover.

When running through npm workspaces, `DATABASE_URL=../../data/nuoma-v2.db`
resolves to the repo root `data/` directory from each app/package workspace.
The worker follows the same rule for `CHROMIUM_PROFILE_DIR`.

For real WhatsApp smoke tests, keep `data/chromium-profile/whatsapp` intact and
prefer attaching to the existing CDP browser. Deleting the profile or launching
with a different profile will require a new QR pairing.
