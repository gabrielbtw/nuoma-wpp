# V2 Realtime

Data: 2026-06-12

## Estado Atual

A V2 usa SSE em Fastify para eventos de Inbox/system, com polling controlado no
servidor como fonte de delta. Web Push existe em trilha separada e depende de
VAPID/env para operacao real.

## Rotas

- `GET /api/events?channels=inbox,system`: stream global por canal.
- `GET /api/inbox/events`: stream antigo de Inbox preservado por compatibilidade.

Ambas usam cookies de auth, `text/event-stream`, heartbeat e evento de erro.

## Cliente

- `apps/web/src/inbox/use-inbox-events.ts` consome `/api/events?channels=inbox`.
- O hook reordena cache de conversas, invalida mensagens da conversa ativa e
  mostra estado `connecting`, `live`, `error` ou `unsupported`.

## Limites conhecidos

- O stream global ainda usa polling interno de repositorios, nao event bus
  persistido.
- Metricas de clientes conectados/latencia ainda nao existem.
- Reconnect fica majoritariamente no comportamento nativo de `EventSource`.
- Web Push tem subscribe/test, mas operacao real depende de env VAPID.

## Validação

- `npm run test:v213-global-events`
- `npm run test:v213-global-events-strong`
- `npm run test:v29-inbox`
