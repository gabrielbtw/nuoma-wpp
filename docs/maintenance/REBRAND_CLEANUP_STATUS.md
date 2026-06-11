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

## Pendente

- Reduzir `legacy.css` ate a meta de 70% nas proximas ondas por pagina.
- Corrigir duplicacoes/aliases de tokens `brand-*` quando a camada compat puder
  morrer sem afetar paginas legadas/DEV.
