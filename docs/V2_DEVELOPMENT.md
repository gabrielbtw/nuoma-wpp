# V2 Development

## Status

V2.1-V2.15 is implemented through the local-first path: foundations, contracts,
SQLite persistence, auth, local login shell, durable job queue, safe worker loop,
CDP-native sync observer, sender runtime, campaigns, automations, chatbots,
WhatsApp overlay, authenticated stream endpoints, backup/restore operations and
guarded V1 -> V2 cutover tooling. `V2.14a` adds an opt-in cartographic/R3F
dashboard visual that is disabled until the local appearance preference enables
it. M39 adds a Safari extension wrapper pipeline from the Chrome companion; real
Safari acceptance still needs the local Xcode web extension converter.

The worker can send real WhatsApp messages only through the connected browser
runtime and current guardrails: allowlist, destination checks, chat reuse,
audit events, DLQ on blocked targets and the M30.3 temporary-message proof path
when campaign payloads require it.

Sync jobs still require the connected runtime. `sync_conversation`,
`sync_history` and `sync_inbox_force` navigate/reconcile chats; send jobs use
the sender runtime and must not be claimed by a worker without browser/CDP
capability.

Only a worker with connected sync runtime can claim sync jobs. Generic local
workers skip `sync_conversation`, `sync_history` and `sync_inbox_force` so the
queue does not route those jobs to a process that cannot reconcile the browser.

The web operations shell includes the first sync controls:

- conversation list from `GET /api/admin/conversations`
- "Ressincronizar" action backed by
  `POST /api/admin/sync/conversations/:id/force`
- recent operational events from `GET /api/admin/system/events`

Current directed milestone smokes:

- `npm run test:v211-overlay-suite`
- `npm run test:m38-chrome-extension`
- `npm run test:m39-safari-extension`
- `npm run test:m40-campaign-blocking-ux`
- `npm run test:v212-streaming-cdp`
- `npm run test:v214a-visual`
- `npm run test:v213-v215-suite`
- `npm run test:v24-api-auth`
- `npm run test:v25-sender-runtime`
- `V215_ALLOW_BLOCKERS=1 node scripts/v215-cutover-preflight.mjs`

Operational commands:

- `node scripts/v214-backup-restore.mjs --mode=backup`
- `node scripts/v214-backup-restore.mjs --mode=verify`
- `node scripts/v214-backup-restore.mjs --mode=restore-dry-run`
- `V214_CONFIRM_RESTORE=SIM V214_RESTORE_SOURCE=/abs/path/backup.db node scripts/v214-backup-restore.mjs --mode=restore`
- `node scripts/v215-cutover-apply.mjs --mode=dry-run`
- `V215_CONFIRM_CUTOVER=SIM node scripts/v215-cutover-apply.mjs --mode=apply`

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
- `apps/chrome-extension`: MV3 companion local para overlay no Chrome do usuario.
- `apps/safari-extension`: wrapper Safari gerado a partir do build Chrome M38/M39.
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
