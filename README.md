# Nuoma WPP V2

Nuoma WPP V2 is the active WhatsApp CRM and operations workspace for Nuoma. It
combines a local-first product UI, a typed API, a durable worker, WhatsApp Web
sync/send automation, campaign execution, operational evidence and optional
browser companions.

This `README.md` is now the single versioned product documentation source for
the repository. Historical product docs were consolidated here and removed.
Prompt/cache markdown under `.codex-pet-runs/**/*.md` is not product
documentation and is intentionally kept outside this consolidation. `MEMORY.md`
is the short operational handoff for agents; it should point back here instead
of duplicating the full product documentation.

## Visao Geral Do Produto

Nuoma is a WhatsApp operations tool for inbox handling, contacts, campaigns,
automations, chatbots, evidence review and guarded real dispatch. The product is
not a landing page or generic marketing surface; it is a dense CRM/ops console.

The current product gate is WhatsApp-only and operationally usable:

- V2.1-V2.6 base is closed: foundations, domain/API/auth, sender runtime and
  sync engine are implemented.
- local and hosted API/Web/Worker flow implemented;
- real WhatsApp text, media and native voice sending implemented through the
  guarded worker runtime;
- inbox, contacts, campaigns, automations, chatbots, jobs, evidence, settings
  and implementation status screens implemented;
- campaign-by-button and overlay-triggered campaign execution implemented
  behind explicit guardrails;
- M30.3 temporary-message proof implemented and enforced for controlled real
  campaign dispatch;
- optional Chrome companion implemented;
- Safari companion pipeline implemented, with real Safari acceptance pending on
  local Xcode converter availability.

## Estado Atual Do Worktree

This README documents the current dirty worktree, not only the last committed
state. As of 2026-05-26, the active local changes are intentionally broad:

- documentation consolidation is in progress: product MDs under `docs/`,
  app-level extension READMEs and `AGENTS.md` were folded into this README;
- `/implementation` now reads this README through the existing Markdown checkbox
  parser, so the `Feito`, `Parcial` and `Falta` sections must remain stable;
- campaign go-live hardening is present across API, scheduler, send policy,
  overlay bridge, worker job handling and focused tests;
- the web app is mid-upgrade around DS Nuoma 2026 surfaces, brand assets,
  PWA metadata, component inventory and operational screen polish;
- the worker/CDP layer has active changes around overlay injection, sync,
  browser handling and send job execution;
- M30.3 proof files under `data/` still exist as operational evidence; the
  retention policy preserves them and any tracked `data/**` files until a human
  explicitly removes them from Git tracking with `git rm --cached`;
- generated docs/build artifacts should stay out of version control.

Treat uncommitted code as part of the current project state when documenting or
testing this checkout. Do not revert unrelated local changes.

## Arquitetura E Apps/Packages

```text
nuoma-wpp-v2/
  apps/
    api/                Fastify + tRPC + REST + Drizzle runtime
    web/                React 19 + Vite + Tailwind product UI
    worker/             Playwright + CDP WhatsApp runtime
    chrome-extension/   MV3 WhatsApp Web companion overlay
    safari-extension/   Safari wrapper pipeline from the Chrome companion
  packages/
    config/             env validation and runtime constants
    contracts/          shared Zod contracts
    db/                 Drizzle schema, repositories and migrations
    ui/                 DS Nuoma 2026 tokens, primitives and components
  infra/
    caddy/              reverse proxy snippets
    docker/             app Dockerfiles
    scripts/            deploy, backup and restore scripts
  data/                 local runtime data, DB, evidence and browser profile
```

Main stack decisions:

- Node 22, npm workspaces and Turborepo monorepo.
- Fastify 5 and tRPC for typed HTTP/API composition.
- SQLite with `better-sqlite3 + Drizzle ORM` for local-first persistence.
- Zod contracts shared between API and web.
- React 19, Vite, Tailwind 3, Radix and `@nuoma/ui`.
- TanStack Query and React Router for client data/routing.
- Playwright plus `chrome-remote-interface` for WhatsApp Web automation.
- Docker Compose and Caddy for hosted operation.

ADR summary consolidated here:

- ADR 0001: Stack choice. Status: Accepted for V2.1 foundations. Decision:
  Node, TypeScript, Fastify, React, Vite, Tailwind, SQLite, better-sqlite3,
  Drizzle ORM, Zod and Playwright/CDP.
- ADR 0002: Monorepo structure. Decision: use a Turborepo monorepo with npm
  workspaces.
- ADR 0003: Feature folders. Decision: keep app features grouped locally while
  shared contracts, config, DB and UI live in packages.
- ADR 0004: SQLite + Drizzle. Decision: keep SQLite and Drizzle for schema and
  typed queries.

## Banco E Dados

Persistence is local-first SQLite through `packages/db`:

- schema and relations live in Drizzle code;
- repositories own typed database access;
- migrations live under `packages/db/src/migrations`;
- local DB files can exist under `data/` and `packages/db/data/`.

Important data rules:

- `data/nuoma-v2.db` is a local runtime DB and must not be deleted casually;
- `packages/db/data/nuoma-v2.db*` are local DB artifacts and should not be
  promoted as product docs;
- M30.3 evidence in `data/` is operational proof and should be preserved
  locally even when removed from Git tracking;
- browser profiles, DBs, screenshots and smoke reports belong in ignored local
  paths unless deliberately summarized here.

## Status Implementado

The `/implementation` screen is derived from this `README.md`. Keep the status
checkboxes below parseable.

## Feito

- [x] **V2.1 Foundations** - Turborepo/npm workspaces, TypeScript configs,
      package graph, root scripts and base README.
- [x] **V2.2-V2.4 Domain/API/Auth** - Contracts, API health, SQLite/Drizzle,
      repositories, auth with Argon2id/JWT/httpOnly cookies and authenticated shell.
- [x] **V2.5 Sender runtime** - Durable queue, DLQ, guarded WhatsApp text,
      media and native voice sending, audit events and safe claim behavior.
- [x] **V2.6 Sync engine** - CDP observer, forced reconcile, bounded history,
      inbound/outbound message persistence and timestamp policy.
- [x] **V2.7 API surface/storage** - Main routers, safe CRUDs, uploads and
      storage surfaces for product screens.
- [x] **V2.8 Base visual** - DS Nuoma 2026, responsive shell, settings and
      component inventory.
- [x] **V2.9 Inbox** - Realtime inbox, timeline, virtualization, media cards,
      composer and sync status.
- [x] **V2.10 Campaigns, automations and chatbots** - Builders, dry-run,
      triggers, safe dispatch preparation and operational UI.
- [x] **V2.11 WhatsApp overlay and real smokes** - Shadow DOM overlay, current
      phone detection, `window.__nuomaApi`, mutation guards and real smoke evidence.
- [x] **V2.12 Minimum remote CDP rendering** - CDP screenshot path, short
      session flow and diagnostics.
- [x] **V2.13 Global stream** - `/api/events` channels for inbox and system
      updates.
- [x] **V2.14 Local-first operation** - SQLite backup, optional browser-profile
      backup, restore/preflight and runtime scripts.
- [x] **V2.14a Optional visual layer** - Appearance toggle for the cartographic
      R3F hero without changing product permissions or send flows.
- [x] **V2.15 V1-to-V2 migration/cutover** - Non-destructive preflight and
      explicitly confirmed cutover tooling.
- [x] **Remarketing seguro** - Strong dry-run, textual confirmation, allowlists,
      status/channel checks, suppression, duplicate checks and audit trail.
- [x] **Remarketing em lote real** - Whole-batch validation before creating
      recipients/jobs, `DISPARAR LOTE <n>` confirmation and M30.3 hard gate.
- [x] **M30.3 Real 24h WhatsApp context** - Worker opens/reuses the correct chat,
      validates temporary-message state and preserves proof evidence.
- [x] **M37 Evidence Center** - `/evidence` lists reports, screenshots and
      `evidence.json` files from local evidence directories.
- [x] **M38 Chrome Extension Companion** - MV3 workspace, content/background
      bridge, overlay API and guarded campaign run for the current WhatsApp phone.
- [x] **M40 Campaign blocking UX** - Campaign screens expose blocking causes
      before real dispatch.
- [x] **P1 Artifact retention policy** - `scripts/artifact-retention.mjs` audits
      generated artifacts by default, preserves runtime DB/profile/evidence paths
      and requires `ARTIFACT_RETENTION_CONFIRM=SIM` before deletion.
- [x] **P2 Product-confidence tests** - Focused API/worker/static smokes cover
      campaign button guardrails, overlay mutation/M30.3 gates, production canary
      allowlists, retention defaults and Safari/go-live external gates.

## Parcial

- [~] **M39 Safari Extension Companion** - Workspace and wrapper pipeline exist,
  generated from the Chrome companion. Real Safari acceptance remains pending
  until full Xcode and `safari-web-extension-converter` are available locally.
- [~] **P0 Hosted go-live confirmation** - Local preflight exists through
  `npm run go-live:canary:preflight` and the guarded proof runner exists through
  `npm run go-live:canary:run`, but the actual hosted canary send and post-send
  proof are still pending.
- [~] **P3 Admin/product backlog** - Contact filtering, overlay empty-contact
  actions and shell runtime badges backed by `system.metrics` are implemented;
  broader non-critical admin reporting/operator polish remains after go-live.
- [~] **P4 Real Safari acceptance gate** - `npm run safari:acceptance:gate`
  records the Xcode/converter/proof blockers, but real Safari acceptance still
  depends on full Xcode and manual Safari enablement.

## Falta

- [ ] **Hosted canary proof** - Run one hosted campaign-by-button canary with
      only the approved phone allowlisted, confirm jobs/audit completion, confirm no
      active campaign-step residue and archive the proof file.
- [ ] **P4 Real Safari acceptance** - Install/activate full Xcode, run converter,
      open generated project, enable extension in Safari and capture proof on
      `https://web.whatsapp.com/`.

## Fluxos Principais

Authentication:

- API uses local credentials, Argon2id password hashing, JWT access/refresh
  cookies and CSRF protection for mutations.
- Web login enters the authenticated shell and then loads product routes.

Inbox and sync:

- Worker attaches to an existing WhatsApp Web CDP session.
- CDP observer reconciles visible chat data and stores contact/message timeline.
- API streams inbox/system events to the web app.
- The app renders contacts, conversations, timeline, media and composer state.

Jobs and worker:

- API enqueues durable jobs for text, media, voice and campaign steps.
- Worker claims jobs safely, applies send policies, verifies the target chat and
  records audit/sender events.
- Failed or blocked jobs land in DLQ/admin surfaces with reason codes.

Campaigns, automations and chatbots:

- Builders create campaign/automation/chatbot definitions.
- Dry-run/readiness surfaces validate configuration before dispatch.
- Real enqueue paths must pass allowlist, status, channel, suppression,
  duplicate, active-runtime and temporary-message gates.

Evidence:

- Evidence artifacts live under ignored local paths such as `data/` or
  `output/`.
- Product evidence is summarized in this README; raw proof files are preserved
  locally unless explicitly backed up and retired.

## Worker E WhatsApp

The worker is the only runtime allowed to touch WhatsApp Web for real send/sync
work. It combines Playwright browser control with direct CDP observers and
send helpers.

Core responsibilities:

- attach to an existing logged-in WhatsApp Web profile when possible;
- observe current chat/sidebar state and persist message/contact timeline;
- claim queued jobs and execute text, media, voice and campaign-step sends;
- verify destination and send policy before any real WhatsApp action;
- emit audit/sender events and move failed jobs to DLQ;
- keep local session state stable across restarts.

Runtime invariants:

- `WORKER_BROWSER_ENABLED=false` and `WORKER_SYNC_ENABLED=false` keep the worker
  safe by default unless explicitly enabled.
- Real sends require API policy and worker policy to allow the target phone.
- Active-chat verification is required before dispatch.
- Open-chat reuse is opt-in and must not bypass destination checks.
- WhatsApp profile state lives at `data/chromium-profile/whatsapp` and is a
  preserved operational asset.

## Extensoes

The browser companions are optional overlays for WhatsApp Web. They do not
replace the API/Web/Worker runtime.

Chrome companion:

- Manifest V3 workspace under `apps/chrome-extension`;
- content/background/page bridge exposes the Nuoma overlay on WhatsApp Web;
- current-phone campaign execution must use the same API guardrails as the web
  app;
- replay/idempotency must prevent duplicated campaign jobs.

Safari companion:

- workspace under `apps/safari-extension`;
- generated from the Chrome companion build output;
- real Safari acceptance is blocked until full Xcode exposes
  `safari-web-extension-converter`;
- build may pass in blocked-converter mode, but that is not a real Safari proof.

## Campanha Por Botao E Guardrails

You can ship with campaign-by-button only if the controlled-send guardrails stay
in force. The intended behavior is narrow and explicit.

Real campaign execution from buttons is allowed only for runnable campaigns:
`running` or `scheduled`. `draft`, `paused`, `archived` and `completed` remain
blocked for real dispatch.

Mandatory API guardrails:

- `production` with empty `API_SEND_ALLOWED_PHONES` is unsafe and must fail.
- `campaigns.execute`, overlay `runCampaignForPhone` and batch dispatch must
  require an allowed phone.
- Overlay/button calls must include mutation guard data such as `nonce`,
  `idempotencyKey` and strong confirmation where applicable.
- Idempotency must prevent replay from creating duplicate jobs.
- M30.3 `temporaryMessages` proof is a hard gate for real campaign batch/send
  paths that depend on 24h/90d context.

Mandatory worker guardrails:

- `production` with empty `WA_SEND_ALLOWED_PHONES` or
  `WA_SEND_ALLOWED_PHONE` is unsafe and must fail.
- Worker must verify the active WhatsApp chat target before sending.
- Real dispatch must be rate-limited and audited.
- `data/chromium-profile/whatsapp` must not be deleted without an explicit
  backup decision, because it may contain the active WhatsApp session.

Operational canary flow:

1. Start API/Web/Worker locally or on the hosted target.
2. Confirm WhatsApp Web is logged in with the preserved browser profile.
3. Configure API and worker send policies in controlled/test mode.
4. Configure allowlists with only the approved canary phone.
5. Open the campaign or overlay for that phone.
6. Click the real run button only after readiness passes.
7. Confirm one recipient and at least one job were created.
8. Confirm audit events such as `campaign.overlay.dispatched` and
   `sender.campaign_step.started`.
9. Capture proof after the send.

## Deploy, Local E Hosted

Local development:

```bash
nvm use
npm install
npm run typecheck
npm run dev
```

Default endpoints:

- API: `http://127.0.0.1:3001`
- Web: `http://127.0.0.1:3002`
- Worker CDP: `127.0.0.1:9223`

Worker scripts:

```bash
npm run worker:status
npm run worker:restart
npm run worker:stop
```

Hosted deployment summary:

- Persistent structure must keep database, uploads, backups and Chromium profile
  outside ephemeral build directories.
- First deploy builds the app images, starts API/Web/Worker behind Caddy and
  verifies `/health`.
- Initial QR/session setup should happen once, then the WhatsApp profile should
  be preserved.
- Smoke without send validates web, API, auth, queue, worker health and sync.
- Smoke with send uses only an approved canary phone and controlled send policy.
- Subsequent deploys must back up DB/profile first, deploy, then run health and
  smoke checks.
- Normal operation must not remove the WhatsApp profile, local DB, evidence or
  backups without an explicit backup/restore decision.

Important environment knobs:

- `DATABASE_URL`
- `JWT_SECRET`
- `API_SEND_POLICY_MODE`
- `API_SEND_ALLOWED_PHONES`
- `WA_SEND_POLICY_MODE`
- `WA_SEND_ALLOWED_PHONES`
- `WA_SEND_ALLOWED_PHONE`
- `WORKER_BROWSER_ENABLED`
- `WORKER_SYNC_ENABLED`
- `WORKER_CDP_URL`

## Testes E Smokes

Core validation:

```bash
npm run typecheck
npm test
npm run build
```

Focused smoke/check scripts may include:

```bash
npm run test:v21-foundations
npm run worker:status
curl -s http://127.0.0.1:3001/health
```

Expected coverage rules:

- Campaign, inbox, auth, settings and worker-facing UI changes require focused
  tests or related smoke updates.
- Real-send guardrail changes require tests proving the intended failure mode.
- Button campaign execution needs coverage for allowed status, blocked status,
  empty production allowlist, mutation guard, idempotency and M30.3 gating.
- Browser/screenshot evidence should be written to ignored paths such as
  `output/` or `data/`, then summarized here if it becomes product policy.

## Design System Nuoma V3

Canonical product visual system: DS Nuoma V3.

Direction:

- dark graphite operational surfaces;
- Geist and Geist Mono typography;
- green/blue palette only: deep green for primary action, petroleum/steel blue
  for structure and command surfaces, muted teal for focus/live/verified state;
- no yellow, gold, bronze, orange, neon glow or purple gradients in product UI;
- compact, scannable CRM layouts;
- tables, filters, pagination, text fields, textareas, number inputs, overlays
  and drawers must come from the shared component system whenever possible;
- no OpenAI/Codex brand colors, logos or typography in Nuoma product UI.

Use repo surfaces before adding styles:

- `packages/ui/src/tokens`
- `packages/ui/src/tailwind/preset.ts`
- `packages/ui/src/primitives`
- `packages/ui/src/controls`
- `packages/ui/src/display`
- `packages/ui/src/display/data-table.tsx`
- `packages/ui/src/display/filter-bar.tsx`
- `packages/ui/src/display/pagination.tsx`
- `apps/web/src/styles.css`

Component policy:

- Prefer `@nuoma/ui` primitives/components over local ad hoc widgets.
- Avoid one-off hex palettes in app screens unless tokens are intentionally
  updated.
- Current V3 visual references live under `data/design-system-v3/concepts/`;
  `04-green-blue-component-board.png` and `05-green-blue-workspace.png` are the
  active references for the green/blue direction.
- Run `npm run test:design-system-v3` after changing tokens or shared UI
  exports. It blocks known neon/yellow/gold legacy literals from returning in
  the central design-system surfaces.
- Optional R3F/cartographic visuals must remain preference-gated and must not
  change permissions, guardrails or core workflow.

## Regras De Agente, React E Figma

Product/brand:

- Treat Nuoma as the product identity.
- This is not an OpenAI-branded UI.
- Operational density and clarity matter more than marketing composition.

React/frontend:

- Follow existing Vite + React + tRPC patterns.
- Keep heavy optional visual surfaces lazy-loaded when practical.
- Keep page components testable; extract local panels/helpers when behavior
  becomes difficult to reason about.
- Prefer established repo components and tokens over new abstractions.

Figma/design-system work:

- Fetch design context/screenshots before implementing from Figma.
- Translate Figma output into Nuoma tokens and existing components.
- If Figma suggests a new component, map it to existing Nuoma primitives before
  creating a new primitive.
- If a visual decision becomes product policy, update this README or a targeted
  code/design artifact in the repo.

Local artifacts:

- Keep generated screenshots/reports in ignored paths.
- Do not commit local databases, Chromium profiles, Playwright caches, logs or
  ad hoc HTML exports unless deliberately promoted into product documentation.

## tRPC/API Surface

Root routers and surfaces consolidated from `V2_TRPC_PROCEDURES`:

- auth/session;
- contacts and contact timeline;
- messages text/media/voice send preparation;
- inbox and realtime event feed;
- jobs, worker status and DLQ;
- campaigns, campaign steps, remarketing batch readiness/dispatch and
  `campaigns.execute`;
- automations and manual safe trigger;
- chatbots and dry-run/test surfaces;
- overlay/extension bridge for current WhatsApp phone context;
- evidence and implementation status.

Security rules:

- Mutation routes require authenticated session and CSRF/mutation guard where
  relevant.
- Send routes apply API policy before enqueueing jobs.
- Worker applies its own send policy before touching WhatsApp.
- Campaign execution paths must preserve audit events and idempotency.

## Pendencias Definitivas

Highest-priority remaining work:

- Run a controlled hosted canary for campaign-by-button.
- Finish Safari real acceptance with full Xcode tooling.
- Keep running `npm run test:product-confidence` and `npm run test:artifact-retention`
  before changing real-send guardrails or artifact cleanup rules.
- Keep product docs in this single README until there is an explicit decision to
  split again.

Do not do now:

- Do not loosen real-send guardrails.
- Do not treat empty production allowlists as safe.
- Do not delete `data/chromium-profile/whatsapp`.
- Do not delete local DB files or real evidence without backup.
- Do not reintroduce product documentation MDs outside this README.

## Limpeza E Retencao De Artefatos

Regenerable/local artifacts should stay ignored and out of version control:

- `output/`
- `.playwright-mcp/*.log`
- `.turbo` logs
- `apps/*/dist`
- `apps/web/dist`
- ad hoc exports such as `nuoma-design-system.html`

Current cleanup tooling:

- audit: `npm run artifacts:retention:audit`
- apply: `ARTIFACT_RETENTION_CONFIRM=SIM npm run artifacts:retention:apply`
- smoke: `npm run test:artifact-retention`

## Go-live Canary Proof

Local readiness can be checked without sending:

```bash
npm run go-live:canary:preflight -- \
  --env-file .env.hosted \
  --canary 5531982066263 \
  --require-hosted-proof
```

The hosted canary runner logs in through tRPC, validates campaign readiness,
runs a dry-run first, and only sends when the exact confirmation phrase is
provided:

```bash
npm run go-live:canary:run -- \
  --env-file .env.hosted \
  --api https://YOUR_HOSTED_API_ORIGIN \
  --email operator@example.com \
  --campaign-id 123 \
  --phone 5531982066263 \
  --require-send \
  --confirm-send "ENVIAR CANARIO 5531982066263"
```

Required hosted variables are documented in `.env.hosted.example` under
`GO_LIVE_*`. Do not broaden `API_SEND_ALLOWED_PHONES` or
`WA_SEND_ALLOWED_PHONES` before this proof passes for one canary phone.

The proof is complete only when the generated JSON shows a completed
`sender.campaign_step.completed` event, no active canary campaign-step jobs, and
the canary recipient in final `completed` state.

Preserve locally:

- `data/chromium-profile/whatsapp`
- `data/nuoma-v2.db`
- DB files under package-local data directories
- M30.3 evidence, smoke screenshots and reports used as real operational proof

Tracked proof files under `data/` should be removed from Git tracking with
`git rm --cached` only after their operational meaning is summarized here and
the files remain preserved locally.

## Fontes Consolidadas

The following historical documentation sources were incorporated into this
single README and should not be recreated as separate product docs unless the
documentation policy changes:

- `AGENTS.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/GO_LIVE_AND_BACKLOG_PLAN_2026-05-21.md`
- `docs/V2_DEVELOPMENT.md`
- `docs/V2_DEPLOYMENT.md`
- `docs/api/V2_TRPC_PROCEDURES.md`
- `docs/architecture/V2_AUTH.md`
- `docs/architecture/V2_DATA_MODEL.md`
- `docs/architecture/V2_JOB_QUEUE.md`
- `docs/architecture/V2_SYNC_ENGINE.md`
- `docs/design-system/README.md`
- `docs/design-system/NUOMA_SCREEN_DESIGN_CONCEPTS.md`
- `docs/runbooks/HOSTED_DEPLOYMENT.md`
- `docs/adr/0001-stack-choice.md`
- `docs/adr/0002-monorepo-structure.md`
- `docs/adr/0003-feature-folders.md`
- `docs/adr/0004-sqlite-drizzle.md`
- `apps/chrome-extension/README.md`
- `apps/safari-extension/README.md`

Validation strings retained for audit tooling: `IMPLEMENTATION_PLAN`,
`V2_TRPC`, `HOSTED_DEPLOYMENT`, `AGENTS`, `Design System`.
