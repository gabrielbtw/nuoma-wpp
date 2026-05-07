# Nuoma WPP V2

Standalone V2 workspace for the Nuoma WhatsApp/CRM runtime. This repo is the
active source of truth for V2 code, docs, smokes and operational planning.

## What's here today

V2.1-V2.6 base: Turborepo/npm workspaces, directory layout, config files,
package skeletons, API health check, domain contracts, Drizzle/SQLite
persistence, auth/login shell, durable job queue, DLQ admin endpoints, safe
worker loop and CDP-native sync observer base.

The worker is intentionally safe by default: `WORKER_BROWSER_ENABLED=false` and
`WORKER_SYNC_ENABLED=false`. Real WhatsApp text/voice sending is only enabled
when a connected CDP sync runtime is available and `WA_SEND_ALLOWED_PHONE`
matches the target phone.

For real WhatsApp smoke tests, the session lives in
`data/chromium-profile/whatsapp`. The worker defaults to attach to an existing
CDP browser and leave Chromium open on shutdown so a smoke restart does not ask
for QR again.

Current gate: all core V2 tracks are implemented for the local/hosted
WhatsApp-only flow. `M30.3` is closed with real WhatsApp 24h temporary-message
proof, remarketing in real batch is closed, and cutover tooling is implemented
behind explicit confirmation. `M38` adds an optional Chrome extension companion
for the WhatsApp overlay without replacing the worker/CDP runtime, and `M40`
adds explicit blocking UX to campaign dispatch screens.

## Versioning

| Marker | Meaning | Example |
| --- | --- | --- |
| `V2.x` | Product release train | `V2.11 Overlay WhatsApp` |
| `V2.x.y` | Incremental delivery inside the release train | `V2.11.7 Overlay API binding` |
| `M<n>` | Operational milestone/smoke marker | `M35` |
| `M<n>.<m>` | Hotfix or subversion for a specific gap/hardening | `M30.3`, `M35.2` |

Current counts from [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md):

- `40` main M markers: `M0` through `M38`, plus `M40`.
- `109` total M/sub-M IDs when `M0.1`, `M35.2`, etc. are included.
- `0` open corrective hotfixes after `M30.3` closure.

## Current Plan

The short operational plan lives in
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). Status/checkboxes
for the `/implementation` page live in
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Layout

```
nuoma-wpp-v2/
├── apps/
│   ├── api/        # Fastify HTTP + REST + Drizzle
│   ├── web/        # React 19 + Vite + Tailwind + Radix
│   ├── worker/     # Playwright + chrome-remote-interface (CDP observer)
│   └── chrome-extension/ # MV3 companion for WhatsApp Web overlay
├── packages/
│   ├── contracts/  # Zod schemas shared between api ↔ web
│   ├── db/         # Drizzle schema + repositories + migrations
│   ├── ui/         # Cartographic Operations DS + selective Liquid Glass
│   └── config/     # env validation, runtime constants
├── infra/
│   ├── docker/     # Dockerfiles per app
│   ├── caddy/      # reverse proxy snippet
│   └── scripts/    # deploy, backup, restore
└── docs/           # ADRs, architecture, runbooks, plan and status
```

## Stack

| Layer          | Tool                                       | Reason                                                                |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Runtime        | Node 22                                    | Stable local/hosted runtime                                           |
| Monorepo       | Turborepo + npm workspaces                 | Shared scripts and package graph for apps/packages                    |
| HTTP           | Fastify 5                                  | Small, fast API surface                                               |
| DB             | better-sqlite3 + Drizzle ORM               | Type-safe schema, migrations as code                                  |
| Validation     | Zod                                        | Shared runtime validation                                             |
| Frontend       | React 19 + Vite + Tailwind 3 + Radix       | Product UI with fast local feedback                                   |
| State (web)    | TanStack Query + React Router 7            | Client cache and typed routing                                        |
| Logger         | Pino                                       | Structured logs                                                       |
| Worker browser | Playwright + chrome-remote-interface       | Hybrid: Playwright drives navigation, CDP drives observers/screencast |
| Chrome extension | Manifest V3 companion                    | Optional user Chrome overlay with local API bridge                    |
| Auth           | Argon2id + JWT (httpOnly cookie) + refresh | Local auth with httpOnly sessions                                     |
| Tests          | Vitest + Playwright E2E                    | Unit/integration plus browser smokes                                  |
| Container      | Docker + docker-compose                    | Hosted target parity                                                  |

The main technical risk is WhatsApp Web/Chromium stability, not HTTP server
speed. The stack stays conservative and changes only what gives concrete
benefit. See local ADRs in [`docs/adr/`](docs/adr/).

## Getting started (dev)

```bash
# Node 22+
nvm use                       # uses .nvmrc

# Install workspaces
npm install

# Type-check everything via Turbo
npm run typecheck

# Run dev (concurrent api + web + worker)
npm run dev
```

Defaults:

- API: `http://127.0.0.1:3001`
- Web: `http://127.0.0.1:3002`
- Worker CDP: `127.0.0.1:9223`

## Local worker operation

Use the root worker scripts for real WhatsApp smokes. They stop duplicate local
worker/screens before starting a single `worker-local-1` instance on CDP
`127.0.0.1:9223`, with the persistent WhatsApp profile in
`data/chromium-profile/whatsapp`.

```bash
npm run worker:status
npm run worker:restart
npm run worker:stop
```

The log stays at `data/worker-screen.log`. Keep API/Web running separately on
ports `3001`/`3002` before running real send/inbound smoke tests.

## Smoke check

```bash
# After npm install
npm run start --workspace @nuoma/api
# In another terminal
curl -s http://127.0.0.1:3001/health | jq
# → { "ok": true, "version": "0.1.0", "service": "nuoma-wpp-v2-api" }
```

## Invariants (do not regress)

- **IC-1**: voice recording = native WhatsApp voice (V2.5.21).
- **IC-2**: multi-step sender has an opt-in open-chat reuse path for controlled
  regression tests (V2.5.22). Default real sends re-navigate to the job phone.

IC-2 text sending was smoke-tested against `5531982066263` on 2026-05-04 with
jobs `15` and `16`; the second send reused the already-open chat. After a later
media-batch safety report, reuse is now gated by
`WORKER_SEND_REUSE_OPEN_CHAT_ENABLED=false` by default. IC-1 voice
sending was smoke-tested on the same date and number with 3s, 30s and 120s WAV
fixtures plus `/Users/gabrielbraga/Desktop/Rebote.ogg` converted from Ogg/Opus
to WAV before native WhatsApp voice recording.

Final V2.5 closure on 2026-05-04 revalidated the user's 9-file batch with
active-target guards enabled: jobs `46`, `47`, `48`, `40`, `44`, `45`, `41`,
`42` and `43` sent 3 voice notes, 1 video and 5 images to `5531982066263`.
Images persisted as `content_type=image`, not stickers; final audit had zero
queued/active jobs, zero grouped media wrapper rows and zero completed sender
events outside the allowlist.

## Documentation

- V2 docs index: [`docs/README.md`](docs/README.md)
- Implementation plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- Implementation status: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)
- V2 onboarding: [`docs/V2_DEVELOPMENT.md`](docs/V2_DEVELOPMENT.md)
- V2 deployment skeleton: [`docs/V2_DEPLOYMENT.md`](docs/V2_DEPLOYMENT.md)
- V2 data model: [`docs/architecture/V2_DATA_MODEL.md`](docs/architecture/V2_DATA_MODEL.md)
- V2 auth: [`docs/architecture/V2_AUTH.md`](docs/architecture/V2_AUTH.md)
- V2 job queue: [`docs/architecture/V2_JOB_QUEUE.md`](docs/architecture/V2_JOB_QUEUE.md)
- V2 sync engine: [`docs/architecture/V2_SYNC_ENGINE.md`](docs/architecture/V2_SYNC_ENGINE.md)
