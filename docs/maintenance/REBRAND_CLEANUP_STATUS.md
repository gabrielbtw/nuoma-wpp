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
- `npm run typecheck --workspace @nuoma/web`: passou.
- `npm run typecheck --workspace @nuoma/worker`: passou.
- `npm run test --workspace @nuoma/worker`: passou.
- `npm run build --workspace @nuoma/web`: passou.

## Pendente

- Reduzir `legacy.css` ou migrar seus blocos para `styles/pages/**`.
- Remover classes `nuoma-flow-v2-*` somente depois de separar Campaign Builder
  e Automation Builder.
- Corrigir duplicacoes/aliases de tokens `brand-*` quando a UI estiver migrada.
