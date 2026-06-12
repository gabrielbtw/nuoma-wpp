# Phase 1 Canonicalization

Data: 2026-06-11
Branch: `feat/rebrand-carvao-cobre`
Objetivo: declarar stack canonica, isolar stack legada, adicionar comandos
oficiais, impedir split-brain de banco e tornar guardrails de custo AI
executaveis.

## Pre-check

Comando:

```bash
git status --short --branch
```

Resumo observado no inicio da implementacao:

- Worktree ja estava sujo desde a Fase 0.
- Alem das trilhas congeladas, havia novas alteracoes locais em `apps/api`,
  `apps/web`, `.env.example` e `tests/v29-reconciliation-smoke.mjs`.
- Estas mudancas foram tratadas como trabalho do usuario e preservadas.

## Decisoes Aplicadas

- Stack canonica V2: `apps/api`, `apps/web`, `apps/worker`, `packages/db`,
  `packages/contracts`, `packages/ui`, `packages/config`.
- Stack legada preservada: `apps/web-app`, `apps/wa-worker`,
  `apps/scheduler`, `packages/core`.
- Apps companion Chrome/Safari ficam como satelites V2.
- `ecosystem.config.cjs` permanece legado; `ecosystem.canonical.config.cjs`
  define `nuoma-api`, `nuoma-web` e `nuoma-worker`.
- OpenAI/Data Lake/Sora live ficam bloqueados sem env explicita.

## Arquivos Da Fase 1

Criados:

- `docs/adr/0013-canonical-runtime-stack.md`
- `docs/maintenance/PHASE_1_CANONICALIZATION.md`
- `ecosystem.canonical.config.cjs`
- `tests/phase1-guards-smoke.ts`

Alterados:

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/maintenance/AI_COST_GUARDRAILS.md`
- `.env.example`
- `.claude/skills/*.md` com banner `LEGACY V1` nos skills que apontam para a
  stack antiga
- `ecosystem.config.cjs`
- `package.json`
- `packages/core/src/config/env.ts`
- `packages/core/src/db/connection.ts`
- `packages/core/src/services/data-lake-service.ts`
- `packages/db/src/index.ts`
- `scripts/sora/nuoma-explainer-ptbr.sh`
- `apps/api/src/services/overlay-quick-actions.ts` (ajuste de type narrowing
  durante validacao canonica)

## Validacoes

| Comando                               | Status | Observacao                                                                                 |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------ | ---------- | ---------- | -------------- | -------------- |
| `npm ci`                              | passou | 662 packages instalados; hooks atualizados                                                 |
| `npm run lint`                        | passou | 10 tarefas Turbo                                                                           |
| `npm run typecheck`                   | passou | 21 tarefas Turbo                                                                           |
| `npm run build`                       | passou | 14 tarefas Turbo; Safari segue `blocked_converter_unavailable` por converter local ausente |
| `npm test`                            | passou | 17 tarefas Turbo                                                                           |
| `npm run lint:canonical`              | passou | 7 tarefas Turbo                                                                            |
| `npm run typecheck:canonical`         | passou | 12 tarefas Turbo apos ajuste de narrowing em `overlay-quick-actions`                       |
| `npm run build:canonical`             | passou | 7 tarefas Turbo                                                                            |
| `npm run test:canonical`              | passou | 12 tarefas Turbo                                                                           |
| `npm run legacy:typecheck`            | passou | 5 tarefas Turbo                                                                            |
| `npm run test:phase1-guards`          | passou | `phase1-guards-smoke                                                                       | status=ok` |
| `npm run test:v215-cutover-preflight` | passou | `v215-cutover-preflight-smoke                                                              | ready=ok   | blocker=ok | status=closed` |
| `npm run test:v215-cutover-apply`     | passou | `v215-cutover-apply-smoke                                                                  | dryRun=ok  | apply=ok   | idempotent=ok  | status=closed` |
| `npm run test:artifact-retention`     | passou | `artifact-retention-policy-smoke                                                           | status=ok` |
| `npm run test:product-confidence`     | passou | `product-confidence-smoke                                                                  | status=ok  | checks=8`  |

`npm run format:check` nao foi executado nesta fase. A Fase 0 ja registrava
divida global de Prettier em 280 arquivos; rodar formatter amplo aqui geraria
churn fora do escopo. A divida foi fechada depois em 2026-06-12; ver
`docs/maintenance/PHASE_2_DEBT_CLOSURE.md`.

## Drift Checks

- Referencias a stack legada em skills receberam banner `LEGACY V1`.
- `docs/README.md` separa links `web-app/core/wa-worker/scheduler` sob
  `Legado V1 / Maintenance`.
- Diagramas e planos historicos com `web-app`, `packages/core`, `wa-worker` ou
  `scheduler` receberam banner historico/legado.
- `git ls-files data storage '**/dist/**' '**/.turbo/**'` continua retornando
  apenas artefatos historicos ja rastreados em `data/`; nenhum novo artefato foi
  promovido por esta fase.

## Falhas E Donos

Falha transitória resolvida:

- `npm run typecheck:canonical` falhou inicialmente em
  `apps/api/src/services/overlay-quick-actions.ts`, porque `...input` carregava
  `status?: string | null` para `auditQuickAction`, que espera
  `ContactStatus | null`.
- Impacto: falha de typecheck no pacote `@nuoma/api`.
- Dono: `core-api`.
- Correcao: passar campos auditados explicitamente e usar apenas o status ja
  validado por `contactStatusSchema`.

## Validacoes Externas

Nao executadas nesta fase:

- WhatsApp real.
- Instagram real.
- Sora live.
- OpenAI/Data Lake remoto.
- Hosted canary.
- PM2 real.
