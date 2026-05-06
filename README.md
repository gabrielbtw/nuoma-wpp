# Nuoma WPP V2

Greenfield rebuild of [Nuoma WPP](../nuoma-wpp) following [V2_DECISION.md](../nuoma-wpp/docs/architecture/V2_DECISION.md).

V1 stays on production until V2 reaches feature parity. See [HOSTED_REMOTE_APP](../nuoma-wpp/docs/architecture/V2_DECISION.md) for the cutover strategy.

## What's here today

V2.1-V2.6 base: directory layout, config files, package skeletons, API health
check, domain contracts, Drizzle/SQLite persistence, auth/login shell, durable
job queue, DLQ admin endpoints, safe worker loop and CDP-native sync observer
base.

The worker is intentionally safe by default: `WORKER_BROWSER_ENABLED=false` and
`WORKER_SYNC_ENABLED=false`. Real WhatsApp text/voice sending is only enabled
when a connected CDP sync runtime is available and `WA_SEND_ALLOWED_PHONE`
matches the target phone.

For real WhatsApp smoke tests, the session lives in
`data/chromium-profile/whatsapp`. The worker defaults to attach to an existing
CDP browser and leave Chromium open on shutdown so a smoke restart does not ask
for QR again.

Gate decision: Spike 1, Spike 2 and Spike 4 are green. Spike 3 is green for
local IC-1 plus Docker dry-run; the hosted `--send` procedure remains required
before V2 worker/deploy can own production audio sends. That does not block
V2.1 foundations.

## Layout

```
nuoma-wpp-v2/
├── apps/
│   ├── api/        # Fastify HTTP + REST + Drizzle
│   ├── web/        # React 19 + Vite + Tailwind + Radix
│   └── worker/     # Playwright + chrome-remote-interface (CDP observer)
├── packages/
│   ├── contracts/  # Zod schemas shared between api ↔ web
│   ├── db/         # Drizzle schema + repositories + migrations
│   ├── ui/         # Cartographic Operations DS + selective Liquid Glass
│   └── config/     # env validation, runtime constants
├── infra/
│   ├── docker/     # Dockerfiles per app
│   ├── caddy/      # reverse proxy snippet
│   └── scripts/    # deploy, backup, restore
└── docs/           # ADRs, architecture, runbooks (mirrors V1 conventions)
```

## Stack (conservative, gated by 4 spikes)

| Layer          | Tool                                       | Why                                                                   |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Runtime        | Node 22                                    | Same as V1, no surprise                                               |
| HTTP           | Fastify 5                                  | Same as V1, stable                                                    |
| DB             | better-sqlite3 + Drizzle ORM               | Type-safe schema, migrations as code                                  |
| Validation     | Zod                                        | Same as V1                                                            |
| Frontend       | React 19 + Vite + Tailwind 3 + Radix       | Same as V1                                                            |
| State (web)    | TanStack Query + React Router 7            | Same as V1                                                            |
| Logger         | Pino                                       | Same as V1                                                            |
| Worker browser | Playwright + chrome-remote-interface       | Hybrid: Playwright drives navigation, CDP drives observers/screencast |
| Auth           | Argon2id + JWT (httpOnly cookie) + refresh | New (V1 had no auth)                                                  |
| Tests          | Vitest + Playwright E2E                    | Vitest replacing node:test                                            |
| Container      | Docker + docker-compose                    | Aligned with hosted target                                            |

Why this stack vs the original aggressive proposal (Bun + Hono + tRPC + Tailwind 4 + TanStack Router + shadcn): the real risk in this product is WhatsApp Web/Chromium stability, not HTTP server speed. We change only what gives concrete benefit (Drizzle for type-safe schema). See [ADR 0002](../nuoma-wpp/docs/adr/0002-stack-v2.md).

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
- Worker CDP: `127.0.0.1:9223` (different from V1 `9222` to avoid clash)

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

- **IC-1**: voice recording = native WhatsApp voice (V2.5.21). Port literal of V1.
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

## Coexistence with V1

| Resource         | V1                                   | V2                                |
| ---------------- | ------------------------------------ | --------------------------------- |
| Path             | `../nuoma-wpp/`                      | `../nuoma-wpp-v2/`                |
| API port         | 3000                                 | 3001                              |
| Web port         | (bundled w/ API)                     | 3002                              |
| Worker CDP port  | 9222                                 | 9223                              |
| DB               | `storage/database/nuoma.db`          | `data/nuoma-v2.db`                |
| Chromium profile | `storage/chromium-profile/whatsapp/` | `data/chromium-profile/whatsapp/` |
| WhatsApp number  | primary                              | secondary chip until cutover      |

V1 never starts a Chromium with V2's profile and vice-versa.

## Documentation

- Strategic blueprint: [`../nuoma-wpp/docs/architecture/V2_DECISION.md`](../nuoma-wpp/docs/architecture/V2_DECISION.md)
- Spike specs + outcomes: [`../nuoma-wpp/docs/architecture/V2_SPIKES.md`](../nuoma-wpp/docs/architecture/V2_SPIKES.md)
- Roadmap (~402 items): [`../nuoma-wpp/docs/IMPROVEMENTS_ROADMAP.md`](../nuoma-wpp/docs/IMPROVEMENTS_ROADMAP.md)
- Migration mapping: [`../nuoma-wpp/docs/migration/V1_TO_V2_DATA_MAP.md`](../nuoma-wpp/docs/migration/V1_TO_V2_DATA_MAP.md)
- ADRs: [`../nuoma-wpp/docs/adr/`](../nuoma-wpp/docs/adr/)
- V2 onboarding: [`docs/V2_DEVELOPMENT.md`](docs/V2_DEVELOPMENT.md)
- V2 deployment skeleton: [`docs/V2_DEPLOYMENT.md`](docs/V2_DEPLOYMENT.md)
- V2 data model: [`docs/architecture/V2_DATA_MODEL.md`](docs/architecture/V2_DATA_MODEL.md)
- V2 auth: [`docs/architecture/V2_AUTH.md`](docs/architecture/V2_AUTH.md)
- V2 job queue: [`docs/architecture/V2_JOB_QUEUE.md`](docs/architecture/V2_JOB_QUEUE.md)
- V2 sync engine: [`docs/architecture/V2_SYNC_ENGINE.md`](docs/architecture/V2_SYNC_ENGINE.md)

V2-specific docs will land in `nuoma-wpp-v2/docs/` as features ship.
