# Component Inventory

Data: 2026-06-11

## Canonico

- `packages/ui/src/**`: componentes compartilhados.
- `apps/web/src/components/**`: componentes especificos da web canonica.
- `apps/web/src/components/ConfirmDangerAction.tsx`: confirmacao textual
  reutilizavel para acoes destrutivas ou de disparo real.
- `apps/web/src/components/charts/ThemedChart.tsx`: graficos devem ler tokens
  via CSS variables.

## Em Migracao

- `apps/web/src/flow-builder/FlowBuilder.tsx`: ainda contem Campaign Builder e
  Automation Builder no mesmo arquivo. Helpers puros ja foram extraidos para
  `apps/web/src/flow-builder/lib/**`.
- `apps/web/src/styles/legacy.css`: ainda importado globalmente e principal
  fonte de classes legadas.

## Removido

- `apps/web/src/pet-overlay/**`.
- `apps/web/src/shell/NuomaAssistant.tsx`.

## Pendencias

- Criar componentes compartilhados reais do FlowBuilder:
  - `NodeCard`
  - `NodeDock`
  - `CanvasChrome`
  - `SaveStatus`
- Dividir `ContactSidebar`, `Composer` e `MessageTimeline` em hooks/secoes apos
  fechar a dieta de tokens.
