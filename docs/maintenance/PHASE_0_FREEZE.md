# Phase 0 Freeze Inventory

Data: 2026-06-11
Branch inicial: `feat/rebrand-carvao-cobre`
Objetivo: preservar o estado atual antes de qualquer refactor estrutural.

## Regra de congelamento

Nenhum arquivo listado neste inventario deve ser revertido, sobrescrito ou
normalizado sem aprovacao explicita do dono da trilha. Esta fase nao escolhe a
stack canonica, nao altera fluxo real de envio, nao altera schema e nao mexe em
PM2/worker/API/banco.

## Trilhas

### `rebrand-ui`

Arquivos modificados no inicio da Fase 0:

- `apps/web/src/main.tsx`
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/web/src/pages/LoginPage.tsx`
- `apps/web/src/shell/CommandPalette.tsx`
- `apps/web/src/shell/ShellLayout.tsx`
- `apps/web/src/shell/Sidebar.tsx`
- `apps/web/src/styles/pages/dashboard.css`
- `apps/web/src/styles/pages/login.css`
- `apps/web/src/styles/pages/shell.css`
- `packages/ui/src/brand/nuoma-logo.tsx`
- `packages/ui/src/controls/ai-command-bar.tsx`
- `packages/ui/src/controls/button.tsx`
- `packages/ui/src/controls/checkbox.tsx`
- `packages/ui/src/controls/field.tsx`
- `packages/ui/src/controls/input.tsx`
- `packages/ui/src/controls/number-input.tsx`
- `packages/ui/src/controls/radio.tsx`
- `packages/ui/src/controls/segmented-control.tsx`
- `packages/ui/src/controls/select.tsx`
- `packages/ui/src/controls/switch.tsx`
- `packages/ui/src/display/accordion.tsx`
- `packages/ui/src/display/avatar.tsx`
- `packages/ui/src/display/badge.tsx`
- `packages/ui/src/display/card.tsx`
- `packages/ui/src/display/channel-icon.tsx`
- `packages/ui/src/display/data-table.tsx`
- `packages/ui/src/display/filter-bar.tsx`
- `packages/ui/src/display/pagination.tsx`
- `packages/ui/src/display/stat-card.tsx`
- `packages/ui/src/display/states.tsx`
- `packages/ui/src/display/tabs.tsx`
- `packages/ui/src/display/time-ago.tsx`
- `packages/ui/src/feedback/toast.tsx`
- `packages/ui/src/index.ts`
- `packages/ui/src/overlays/dialog.tsx`
- `packages/ui/src/overlays/dropdown-menu.tsx`
- `packages/ui/src/overlays/popover.tsx`
- `packages/ui/src/overlays/sheet.tsx`
- `packages/ui/src/overlays/tooltip.tsx`
- `packages/ui/src/primitives/bento-grid.tsx`
- `packages/ui/src/primitives/contour.tsx`
- `packages/ui/src/primitives/micro-grid.tsx`
- `packages/ui/src/primitives/signal-dot.tsx`
- `packages/ui/src/primitives/surface.tsx`
- `packages/ui/src/theme/provider.tsx`
- `packages/ui/src/utils/keyboard-shortcut.tsx`

Arquivos nao rastreados no inicio da Fase 0:

- `apps/web/src/components/ErrorBoundary.tsx`

### `migration-v215`

Arquivos modificados no inicio da Fase 0:

- `docs/migration/V1_TO_V2_DATA_MAP.md`
- `scripts/v215-cutover-apply.mjs`
- `scripts/v215-cutover-preflight.mjs`
- `tests/v215-cutover-apply-smoke.ts`

Arquivos nao rastreados no inicio da Fase 0:

- `apps/migration/package.json`
- `apps/migration/src/index.ts`
- `apps/migration/tsconfig.json`
- `docs/migration/CUTOVER_PLAN.md`
- `docs/runbooks/CUTOVER_ROLLBACK.md`

Observacao: `package-lock.json` ja contem entradas para `apps/migration` e
`node_modules/@nuoma/migration`; a validacao da fase deve confirmar isso via
`npm ci`.

### `agent-docs`

Arquivos modificados no inicio da Fase 0:

- `.claude/skills/nuoma-cutover-checklist.md`
- `docs/IMPROVEMENTS_ROADMAP.md`

Arquivos nao rastreados no inicio da Fase 0:

- `.claude/skills/v1-to-v2-data-import.md`

### `platform`

Arquivos modificados no inicio da Fase 0:

- `package.json`
- `package-lock.json`

Arquivos criados pela Fase 0:

- `docs/maintenance/PHASE_0_FREEZE.md`
- `docs/maintenance/PHASE_0_VALIDATION.md`
- `docs/maintenance/AI_COST_GUARDRAILS.md`

## Resultado esperado

Este inventario e a fonte de verdade para handoff da Fase 0. Qualquer fase
seguinte deve comecar comparando `git status --short --branch` com esta lista e
registrando diferencas antes de editar codigo.

## Status Apos Aplicacao Da Fase 0

A Fase 0 adicionou a trilha `docs/maintenance/**` e fez correcoes documentais
pontuais em ownership, env vars, comandos de validacao e guardrails de custo.
As mudancas preexistentes de `rebrand-ui`, `migration-v215`, `agent-docs` e
`platform` continuam preservadas.

Novos arquivos da Fase 0:

- `docs/maintenance/README.md`
- `docs/maintenance/PHASE_0_FREEZE.md`
- `docs/maintenance/PHASE_0_VALIDATION.md`
- `docs/maintenance/AI_COST_GUARDRAILS.md`

Arquivos alterados pela Fase 0:

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/MAINTENANCE-PLAN.md`
- `docs/executive/notion-structure.md`
- `docs/runbooks/worker-pm2.md`
- `docs/sora/nuoma-explainer-ptbr/README.md`
- `.claude/settings.json`
- `.claude/skills/nuoma-feature.md`
- `.claude/skills/nuoma-refactor.md`
- `.claude/skills/nuoma-review.md`
