# ADR 0013 - Canonical Runtime Stack

## Status

Aceita na Fase 1.

## Contexto

A Fase 0 congelou o worktree e registrou duas linhas vivas no repositorio:

- `runtime-v2-active-candidate`: `apps/api`, `apps/web`, `apps/worker`,
  `packages/db`, `packages/contracts`, `packages/ui`, `packages/config`.
- `legacy-maintenance`: `apps/web-app`, `apps/wa-worker`, `apps/scheduler`,
  `packages/core`.

O README atual ja descreve a linha V2 como produto ativo, enquanto parte do
ownership e das skills ainda apontava para a stack legada. Isso criava risco de
split-brain operacional: editar a camada errada, abrir o banco errado ou
validar o runtime errado.

## Decisao

A stack canonica para novas features, refactors, validacoes padrao e operacao
V2 passa a ser:

- `apps/api`: Fastify, tRPC e rotas REST V2.
- `apps/web`: React/Vite product UI.
- `apps/worker`: runtime Playwright/CDP de canal.
- `packages/db`: schema Drizzle, migrations e repositorios V2.
- `packages/contracts`: contratos Zod compartilhados.
- `packages/ui`: design system e componentes compartilhados.
- `packages/config`: env validation e constantes de runtime V2.

Os apps `apps/chrome-extension` e `apps/safari-extension` sao satelites da
linha V2. Eles podem acompanhar validacoes da stack canonica quando o escopo
envolver companion/overlay, mas nao definem a stack central.

A stack legada fica preservada como `legacy-maintenance`:

- `apps/web-app`
- `apps/wa-worker`
- `apps/scheduler`
- `packages/core`

Novas features e refactors devem iniciar na stack canonica. A stack legada so
deve receber hotfix, leitura comparativa, rollback/cutover ou suporte de
migracao com justificativa explicita.

## Guardrails

- `packages/db` deve falhar cedo quando `DATABASE_URL` apontar para schema
  legado.
- `packages/core` deve falhar cedo quando `DATABASE_PATH` apontar para schema
  Drizzle/V2.
- Chamadas OpenAI/Data Lake/Sora ficam bloqueadas por padrao e exigem
  aprovacao por env explicita.
- PM2 canonico vive em `ecosystem.canonical.config.cjs`; o
  `ecosystem.config.cjs` original permanece como mapa legado.

## Consequencias

- Handoff fica mais claro: cada arquivo tem dono canonico ou legado.
- Validacao local pode mirar a stack V2 sem executar toda a superficie legada.
- Setups locais com env apontando para banco errado passam a quebrar cedo.
- A remocao da stack legada, migracao real de dados e troca operacional de PM2
  ficam para fases posteriores.
