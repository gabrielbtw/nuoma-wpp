# Rebrand Cleanup Status

Data: 2026-06-12

## Removido

- `output-worker-*.log` da raiz.
- `apps/web/src/pet-overlay/**`.
- `apps/web/src/shell/NuomaAssistant.tsx`.
- `apps/worker/src/sync/instagram-observer-script.ts`.
- Seletores CSS mortos sem uso fora de `legacy.css`:
  - `nuoma-flow-*`
  - `nuoma-signal-*`
  - `nuoma-glass-modal`
  - `botforge-grid`
  - `botforge-title`

## Preservado

- `apps/worker/src/sync/observer-script.ts`, usado por `apps/worker/src/sync/cdp.ts`
  e `apps/worker/src/sync/observer-script.test.ts`.
- Stack legada, sem alteracoes nesta retomada.
- Demais classes compat ainda usadas por paginas nao migradas:
  - `nuoma-compat-*`
  - `nuoma-glass-panel`
  - `nuoma-glass-elevated`
  - `nuoma-jobs-*`
  - `nuoma-implementation-*`
- Test ids e bindings do overlay:
  - `nuoma-wpp-overlay-root`
  - `nuoma-overlay-fab`
  - `nuoma-overlay-panel`
  - `__nuomaApi`
  - `__nuomaApiNativeBridge`

## Validacao

- `rg -n "pet-overlay|OctoPet|NuomaAssistant|instagram-observer-script"` nao
  encontrou usos ativos em `apps`, `packages`, `tests` ou docs operacionais.
- `rg -n "orielo|botforge|flow-v2|nuoma-flow-v2" apps/web/src packages/ui/src`
  nao encontrou ocorrencias apos a Fase 1.
- `rg -n "nuoma-flow-|nuoma-signal-|nuoma-glass-modal|botforge-grid|botforge-title" apps/web/src packages/ui/src`
  nao encontrou ocorrencias ativas apos a Fase 6.
- `rg -n "brand-" apps/web/src --glob "*.tsx" --glob "!apps/web/src/pages/DevComponentsPage.tsx" --glob "!apps/web/src/pages/EvidencePage.tsx"`
  nao encontrou ocorrencias em TSX de produto apos a Fase 1.
- `npm run typecheck --workspace @nuoma/web`: passou.
- `npm run typecheck --workspace @nuoma/worker`: passou.
- `npm run test --workspace @nuoma/worker`: passou.
- `npm run build --workspace @nuoma/web`: passou.
- `npm run typecheck --workspace @nuoma/ui`: passou.
- `npm run test --workspace @nuoma/ui`: passou sem arquivos de teste.
- `npm run test --workspace @nuoma/web`: passou.
- `npm run test:design-system-v3`: passou.
- `npm run lint`: passou.

## Fase 4 — FlowBuilder V2

- Nova arquitetura ativa em `apps/web/src/features/flow-builder/**`.
- Rotas dedicadas:
  - `/campaigns/new`
  - `/campaigns/$campaignId/edit`
  - `/automations/new`
  - `/automations/$automationId/edit`
- Builder antigo `apps/web/src/flow-builder/FlowBuilder.tsx` removido.
- Painel `Criar campanha` reimaginado para caber na coluna real do inspector
  (~359px) e validado com print final sem clipping.
- Evidencia detalhada: `docs/maintenance/REBRAND_PHASE_4_FLOWBUILDER_V2_STATUS.md`.
- Smokes de Fase 4 passaram com WhatsApp via CDP ativo:
  - `npm run test:v210-campaigns`
  - `npm run test:v210-campaign-builder-mobile`
  - `npm run test:v210-flow-builders`

## Fase 5 — Overlay HUD WhatsApp

- Overlay retematizado em `apps/worker/src/features/overlay/inject.ts` com
  Carvao & Cobre via tokens locais `--nwo-*`.
- Contratos preservados: root id, test ids, bindings globais, classes
  `.nuoma-brand-*`, `.nuoma-panel-body`, `.nuoma-action`, `.nuoma-section`,
  z-index e Shadow DOM isolado.
- Header do painel mostra `NUOMA CRM`, nome/titulo e telefone mono sempre
  visivel quando detectado.
- Microcopy acentuada no painel: `Automações`, `Últimas mensagens`, `número`,
  `ação`, `ID único`, `Lembrar amanhã`.
- Evidencia detalhada: `docs/maintenance/REBRAND_PHASE_5_OVERLAY_HUD_STATUS.md`.
- Smokes de Fase 5 passaram com WhatsApp via CDP ativo:
  - `npm run test:v211-overlay-unit`
  - `npm run test:v211-overlay-contracts`
  - `npm run test:v211-overlay-suite`

## Fase 6 — Clean Code e Lixo

- `apps/web/src/pet-overlay/**`, `apps/web/src/shell/NuomaAssistant.tsx` e
  `apps/worker/src/sync/instagram-observer-script.ts` ja estavam ausentes no
  checkout e foram reconfirmados por inventario.
- Logs `output-worker-*.log` nao existem na raiz; `.gitignore` agora tambem
  bloqueia esse padrao explicitamente, alem de `*.log`.
- Dependencias Radix usadas apenas por `packages/ui/src/**` foram removidas de
  `apps/web/package.json` e movidas para `dependencies` de `@nuoma/ui`.
- `legacy.css` foi reduzido de 4264 para 2112 linhas, removendo seletores sem
  uso ativo fora do proprio CSS.
- Evidencia detalhada: `docs/maintenance/REBRAND_PHASE_6_CLEAN_CODE_STATUS.md`.

## Pendente

- Reduzir `legacy.css` ate a meta de 70% nas proximas ondas por pagina; a Fase
  6 removeu o bloco morto comprovado, mas paginas operacionais ainda usam
  classes compat.
- Corrigir duplicacoes/aliases de tokens `brand-*` quando a camada compat puder
  morrer sem afetar paginas legadas/DEV.
- Envio real IG/WhatsApp deve continuar em smoke dedicado com allowlist,
  evidencia visual e registro de campanha quando solicitado.
