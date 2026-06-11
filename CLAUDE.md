# Nuoma WPP - Claude Code Context

> **Status (Abril 2026)**: V1 em modo **manutenção** (só patches críticos). V2 em **Fase 0 de Prova** (4 spikes técnicos antes de criar `nuoma-wpp-v2/`). Documentação completa: [`docs/architecture/V2_DECISION.md`](docs/architecture/V2_DECISION.md), [`docs/architecture/V2_SPIKES.md`](docs/architecture/V2_SPIKES.md), [`docs/IMPROVEMENTS_ROADMAP.md`](docs/IMPROVEMENTS_ROADMAP.md).

## ⚠️ Invariantes não-negociáveis (NÃO REGREDIR EM V1 NEM V2)

<critical>

### IC-1 — Áudio (voice recording)

A implementação atual em [`apps/wa-worker/src/worker.ts:1474+`](apps/wa-worker/src/worker.ts) está **PERFEITA** (palavra do owner). Resolvida nos commits `25c075c` (voice recording), `73d4322` (ffprobe + WAV 48kHz), `910615f` (perf), `f344094` (focus).

**NÃO TOCAR**:
- Web Audio API injection via `addInitScript`
- Encoding WAV 48kHz mono 16-bit
- ffprobe pra duração exata
- MediaSource feed pro WhatsApp aceitar como voice **nativa** (não anexo)
- Sem `bringToFront()` durante gravação
- Sem relaunch de browser pra mandar voice

Detalhe completo: [`docs/adr/0010-preserve-v1-audio-and-multistep-sender.md`](docs/adr/0010-preserve-v1-audio-and-multistep-sender.md).

### IC-2 — Multi-step sender sem reload entre steps

Otimização introduzida no commit `910615f` ("speed up photo send after audio - skip re-navigation"). Quando uma campanha tem múltiplos steps pro mesmo destinatário (foto → áudio → texto), o worker mantém a conversa aberta entre steps, sem re-navegar.

**NÃO TOCAR**:
- Lógica de reaproveitamento de conversa em `processJob`
- Estado em memória `currentConversationId + lastInteractionAt` (se já existir; senão IC-2 está implícito na sequência)
- Não voltar pra home do WhatsApp entre destinatários

Smoke test mensal manual (item V1.17): enviar áudio + foto + texto pra contato de teste; cronometrar tempo total; revert se regredir vs baseline.

</critical>

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

**Fonte canônica do roadmap**: [`docs/IMPROVEMENTS_ROADMAP.md`](docs/IMPROVEMENTS_ROADMAP.md) (402 itens em V1 patches + V2 fases + R3F + 4 spikes gate).

### V1 (congelado, sem patches planejados agora)

Decisão do owner em 2026-04-30: **não executar V1.1-V1.17 agora**. Os patches V1 permanecem no roadmap apenas como referência técnica para incidentes/hotfixes inevitáveis.

Continuam obrigatórios:
- Não tocar no áudio [IC-1].
- Não regredir multi-step sender sem reload [IC-2].
- Não criar refactor estrutural no V1 enquanto a prova do V2 estiver ativa.

### V2 (Fase 0 de Prova ativa antes de qualquer outra coisa)

Antes de criar `nuoma-wpp-v2/`, executar 4 spikes técnicos:

1. **Spike 1** — CDP observer captura msg real <3s (skill `/wa-cdp-sync-spike`)
2. **Spike 2** — Page.startScreencast latência <300ms
3. **Spike 3** — Áudio do V1 portado literal funciona em container [IC-1] (skill `/wa-voice-regression`)
4. **Spike 4** — Migration dryrun lê SQLite V1 + schema Drizzle válido (skill `/v1-to-v2-migration-dryrun`)

Sem 4 verdes, **NÃO** criar V2. Spec completa em [`docs/architecture/V2_SPIKES.md`](docs/architecture/V2_SPIKES.md).

See `PLANS.md` for the hygiene/refactoring backlog (legacy).

## Skills customizadas pro projeto

Em `.claude/skills/`. Invocação via `/<skill-name>`:

- `/nuoma-debug`, `/nuoma-review`, `/nuoma-api`, `/nuoma-migration` — operacionais V1 (existentes).
- `/nuoma-builder`, `/nuoma-inbox`, `/nuoma-segment`, `/nuoma-component`, `/nuoma-feature`, `/nuoma-page`, `/nuoma-refactor` — features (existentes).
- `/wa-cdp-sync-spike` — Spike 1: CDP observer + latency measurement.
- `/wa-voice-regression` — Spike 3: validar áudio (IC-1) em container.
- `/wa-session-runbook` — operações de sessão WhatsApp (QR, profile, OOM, cutover).
- `/v1-to-v2-migration-dryrun` — Spike 4: ler V1 SQLite + schema Drizzle candidato.
- `/nuoma-worker-observability` — diagnóstico de jobs travados, dedupe, DLQ, scheduler heartbeat.
- `/nuoma-cutover-checklist` — protocolo V1→V2 cutover (gate 1-5 + execução em 7 phases + rollback).

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
