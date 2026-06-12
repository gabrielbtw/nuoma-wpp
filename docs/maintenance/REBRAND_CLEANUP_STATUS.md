# Rebrand Cleanup Status

Data: 2026-06-11

## Removido

- `output-worker-*.log` da raiz.
- `apps/web/src/pet-overlay/**`.
- `apps/web/src/shell/NuomaAssistant.tsx`.
- `apps/worker/src/sync/instagram-observer-script.ts`.

## Preservado

- `apps/worker/src/sync/observer-script.ts`, usado por `apps/worker/src/sync/cdp.ts`
  e `apps/worker/src/sync/observer-script.test.ts`.
- Stack legada, sem alteracoes nesta retomada.
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
- `rg -n "brand-" apps/web/src --glob "*.tsx" --glob "!apps/web/src/pages/DevComponentsPage.tsx" --glob "!apps/web/src/pages/EvidencePage.tsx"`
  nao encontrou ocorrencias em TSX de produto apos a Fase 1.
- `npm run typecheck --workspace @nuoma/web`: passou.
- `npm run typecheck --workspace @nuoma/worker`: passou.
- `npm run test --workspace @nuoma/worker`: passou.
- `npm run build --workspace @nuoma/web`: passou.
- `npm run typecheck --workspace @nuoma/ui`: passou.
- `npm run test --workspace @nuoma/web -- --run`: passou.
- `npm run test:design-system-v3`: passou.

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

## Pendente

- Reduzir `legacy.css` ate a meta de 70% nas proximas ondas por pagina.
- Corrigir duplicacoes/aliases de tokens `brand-*` quando a camada compat puder
  morrer sem afetar paginas legadas/DEV.
- Envio real IG/WhatsApp deve continuar em smoke dedicado com allowlist,
  evidencia visual e registro de campanha quando solicitado.
