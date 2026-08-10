# Component Inventory

Data: 2026-06-12

## Canonico

- `packages/ui/src/**`: componentes compartilhados.
- `apps/web/src/components/**`: componentes especificos da web canonica.
- `apps/web/src/components/ConfirmDangerAction.tsx`: confirmacao textual
  reutilizavel para acoes destrutivas ou de disparo real.
- `apps/web/src/components/charts/ThemedChart.tsx`: graficos devem ler tokens
  via CSS variables.
- `apps/web/src/features/flow-builder/**`: FlowBuilder V2 canonico para
  campanha e automacao, com canvas, inspector, biblioteca de blocos e reducer
  de draft.

## Em Migracao

- `apps/web/src/styles/legacy.css`: ainda importado globalmente para paginas
  operacionais nao migradas (`Jobs`, `Implementation`, `Chatbots`, `Contacts`,
  `Settings`, DEV components e trechos de Inbox).
- `apps/web/src/styles/pages/rebuild.css`: camada final do Signal Room que
  normaliza visualmente as rotas ainda atendidas por CSS de compatibilidade,
  preservando seus contratos enquanto a migracao por rota nao termina.

## Removido

- `apps/web/src/pet-overlay/**`.
- `apps/web/src/shell/NuomaAssistant.tsx`.
- `apps/web/src/flow-builder/FlowBuilder.tsx`.

## Pendencias

- Migrar o restante das paginas que usam `nuoma-compat-*`, `nuoma-glass-*`,
  `nuoma-jobs-*` e `nuoma-implementation-*` para CSS de pagina ou Tailwind com
  tokens `nw-*`.
- Depois da migracao por rota, absorver as regras hoje em `rebuild.css` nos
  estilos de cada superficie e remover aliases, hexadecimais e `!important` do
  layer de compatibilidade.
- Dividir `ContactSidebar`, `Composer` e `MessageTimeline` em hooks/secoes em
  uma fase dedicada de hardening.
