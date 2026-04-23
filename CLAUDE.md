# Nuoma WPP - Claude Code Context

## What is this project

Local-first operational CRM with omnichannel automation for WhatsApp and Instagram.
Monorepo with 3 processes + 1 shared package. No cloud dependencies. SQLite + Playwright.

## Architecture (quick reference)

```
apps/web-app/     → Fastify API + React SPA (port 3000)
apps/wa-worker/   → Playwright browser automation (WhatsApp + Instagram)
apps/scheduler/   → Periodic dispatch, watchdog, campaign/automation ticks
packages/core/    → Shared: DB, migrations, repos, services, types, config
```

## Tech stack

- Node.js 22+, TypeScript ESM, npm workspaces
- Backend: Fastify 5, SQLite (better-sqlite3), Zod, Pino
- Frontend: React 19, Vite 7, Tailwind 3, Radix UI, TanStack Query, React Router 7
- Worker: Playwright + persistent Chromium profile
- Process: PM2 (production), concurrently (dev)

## Essential commands

```bash
npm run dev          # Start all 3 processes (web-app, wa-worker, scheduler)
npm run typecheck    # TypeScript check across all workspaces
npm run hygiene      # Stricter typecheck (noUnusedLocals, noUnusedParameters)
npm test             # Run tests (node:test + tsx)
npm run build        # Build all workspaces
npm run db:migrate   # Run database migrations
```

## Workspace-specific commands

```bash
npm run typecheck --workspace @nuoma/core
npm run typecheck --workspace @nuoma/web-app
npm run typecheck --workspace @nuoma/wa-worker
npm run typecheck --workspace @nuoma/scheduler
npm run build --workspace @nuoma/web-app
```

## Agent ownership model

This project uses exclusive file ownership. See AGENTS.md for full details.

| Agent | Owns | Boundary |
|-------|------|----------|
| core-api | `packages/core/**`, `apps/web-app/src/server/**` | Business rules, DB, repos, services, routes |
| frontend-web | `apps/web-app/src/client/**` | Pages, components, styles, API consumption |
| wa-worker | `apps/wa-worker/src/**` | Browser automation, session, sync, sending |
| scheduler-runtime | `apps/scheduler/src/**` | Periodic cycles, watchdog, cleanup |
| platform-workspace | Root configs, manifests, scripts, docs | Build, deps, PM2, shared tests |

**Rule**: Never edit files outside the agent's ownership boundary in a single change. If cross-layer changes are needed, handle them as separate steps respecting ownership.

## Key patterns

### Database
- SQLite with WAL mode, foreign keys enforced
- Migrations in `packages/core/src/db/migrations.ts` (array of {id, sql} objects)
- Connection singleton in `packages/core/src/db/connection.ts`
- Busy retry: `withSqliteBusyRetry()` wraps transactions

### Job queue
- Jobs table in SQLite: `pending → processing → done/failed`
- Types: `send-message`, `send-assisted-message`, `sync-inbox`, `restart-worker`, `validate-recipient`
- Deduplication via `dedupe_key`, locking via `locked_by`
- wa-worker claims and processes jobs every 3s

### Campaign flow
Operator creates → Scheduler ticks → Jobs enqueued → Worker sends → State updated

### Automation flow
Rules defined → Scheduler evaluates eligibility per contact → Runs created → Worker executes actions

### Frontend API pattern
- `useQuery()` for reads (with refetch intervals)
- `useMutation()` + `useQueryClient().invalidateQueries()` for writes
- `apiFetch<T>()` wrapper in `apps/web-app/src/client/lib/api.ts`

## What NOT to do

- Do NOT add external cloud services (local-first philosophy)
- Do NOT use AI/LLM for core functionality (minimum AI policy)
- Do NOT create new abstractions for one-time operations
- Do NOT add dependencies without strong justification
- Do NOT edit files in `storage/`, `node_modules/`, or `dist/`
- Do NOT change public contracts (routes, payloads, tables) without explicit approval
- Do NOT skip typecheck validation after changes

## Data lake / AI

Data lake (tables `data_lake_*`) and AI integrations (OpenAI, Ollama, Whisper) exist but are on a **separate track**. Do not modify unless explicitly requested.

## Current roadmap priorities

1. **Campaign builder** - templates, conditions, preview, evergreen campaigns
2. **Builder unificado** - shared component for campaigns, automations, chatbot
3. **Inbox unificada** - single timeline per contact (WA+IG mixed)
4. **Contact narrative ledger** - timeline view of contact journey
5. **Segmentacao avancada** - reusable AND/OR filter builder
6. **Automacoes com eventos** - event-based triggers + compound conditions
7. **Chatbot** - keyword rules first, visual builder later
8. **Dashboard errors** - failure badge with details

See `PLANS.md` for the hygiene/refactoring backlog.

## Active remarketing campaigns

### rmkt-manchas (ativa desde 2026-04-17)

- **Objetivo**: remarketing pra leads pré-CSV com oferta de 30% off + foto antes/depois.
- **Foto**: `storage/uploads/media/campaign/image/teste-manchas/antes-depois.jpg`
- **Caption**: começa com `🚨 *MANCHAS NO ROSTO?*`, termina com `👇🏼👇🏼 Me mande: *EU QUERO*` (fonte canônica: prompt da scheduled task `rmkt-manchas-refill`).
- **Pool targeting**: `phone LIKE '5531%'` ou `phone LIKE '5511%'`, `length(phone) >= 12`, sem tags `nao_insistir`/`neferpeel-lead-bh`, sem jobs prévios com mesmo `mediaPath`. Ordem: pré-CSV (`created_at < '2026-04-16'`) → CSV.
- **Split por bloco**: 180 DDD 31 + 20 DDD 11 (fallback 200 × 31).
- **Delay intra-bloco**: 8s.
- **Frequência**: scheduled task `rmkt-manchas-refill` roda a cada 30min, enfileira bloco quando `pending < 10` e hora BRT em 8-22.
- **Identificação canônica**: `json_extract(payload_json,'$.mediaPath') = 'campaign/image/teste-manchas/antes-depois.jpg'`.
- **Como pausar**: `mcp__scheduled-tasks__update_scheduled_task` com status=paused, ou delete.
- **Como monitorar**:
  ```sh
  sqlite3 storage/database/nuoma.db "SELECT status, COUNT(*) FROM jobs \
    WHERE type='send-message' \
    AND json_extract(payload_json,'\$.mediaPath')='campaign/image/teste-manchas/antes-depois.jpg' \
    GROUP BY status;"
  ```

### Histórico de disparos manuais anteriores à cron

- 2026-04-17 13:25-18:00 BRT — 624 envios manuais em 6 lotes (DDD 31 pré-CSV). Status no momento da ativação da cron: 485 done, 137 pending, 1 fail (timeout Anexar).
