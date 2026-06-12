# Contexto canônico sob demanda

Use este arquivo quando a tarefa exigir mais detalhe que o bootstrap do
`CLAUDE.md`. Não carregue tudo por padrão.

## Arquitetura

- `apps/api`: Fastify + tRPC/REST, autenticação, routers e serviços HTTP.
- `apps/web`: React 19 + Vite + TanStack Query; Radix vem via `@nuoma/ui`.
- `apps/worker`: Playwright/CDP, sync, envio guardado, overlay e artifacts.
- `packages/contracts`: schemas, tipos e contratos compartilhados.
- `packages/db`: Drizzle/SQLite, migrations e repositórios V2.
- `packages/ui`: componentes e tokens compartilhados.
- `packages/config`: configuração comum.
- `apps/migration`: utilitários V2.15 de migração/cutover.

## Stack legada

`apps/web-app`, `apps/wa-worker`, `apps/scheduler` e `packages/core` existem para
manutenção, comparação, rollback e cutover. Não use como destino padrão de
feature nova.

## Comandos por camada

```bash
npm run typecheck --workspace @nuoma/contracts
npm run typecheck --workspace @nuoma/db
npm run typecheck --workspace @nuoma/api
npm run test --workspace @nuoma/db
npm run test --workspace @nuoma/api

npm run typecheck --workspace @nuoma/ui
npm run typecheck --workspace @nuoma/web
npm run build --workspace @nuoma/web

npm run typecheck --workspace @nuoma/worker
npm run test --workspace @nuoma/worker

npm run legacy:typecheck
```

## Fluxos

- Feature cross-layer: contrato em `apps/api`/`packages/contracts`/`packages/db`
  antes de consumidores.
- Incidente operacional: `apps/worker` para sessão/CDP/envio; `apps/api` para
  contrato/fila/persistência; `apps/web` para feedback de operador.
- Dependências, docs, scripts, PM2, CI e testes compartilhados passam por
  `platform-workspace`.
- V2.15: sempre preflight/dry-run antes de apply; nunca escrever no DB V1.

## Skills consolidadas

- `nuoma-v2-feature`: feature/refactor V2 com ownership e validação por camada.
- `nuoma-worker-observability`: worker/CDP/fila/overlay/sync.
- `wa-session-runbook`: sessão Chromium/WhatsApp/Instagram.
- `v1-to-v2-data-import`: import/backfill de dados com backup e dry-run.
- `nuoma-cutover-checklist`: cutover, rollback e go/no-go V2.15.
- `wa-voice-regression`: IC-1 áudio nativo.
- `nuoma-review`: revisão de diff e risco técnico.
