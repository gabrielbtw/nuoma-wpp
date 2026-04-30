# ADR 0002 — Stack V2

## Status

**Provisória** (escopo: V2 greenfield em `nuoma-wpp-v2/`).
**Gating**: depende dos 4 spikes em [`V2_SPIKES.md`](../architecture/V2_SPIKES.md) passarem antes de virar definitiva. Sem spikes verdes, recuamos pra stack atual do V1 (Node 22 + Fastify + better-sqlite3).

## Contexto

V1 usa Node 22 + Fastify 5 + better-sqlite3 + Vite 7 + React 19 + Tailwind 3 + Radix UI. Funcional, mas algumas escolhas legacy (sem ORM type-safe, sem RPC end-to-end, schemas Zod duplicados entre back e front). V2 é greenfield — não há custo de migração herdado.

## Decisão (versão conservadora pós-crítica)

A crítica do owner foi: "o maior risco do produto é WhatsApp Web/Chromium, não HTTP server. Trocar runtime, framework, ORM, router, design stack tudo de uma vez aumenta o risco sem reduzir o problema central." Aceita. Stack revisada:

### Camadas de baixo risco (mantém V1, evita troca)

- **Runtime**: **Node 22** (mesmo do V1). Bun fica como possível upgrade futuro se DX justificar — não no V2 inicial.
- **HTTP**: **Fastify 5** (mesmo do V1). Se ao longo do V2 aparecer ganho concreto pra trocar, abre ADR específica.
- **Frontend**: **React 19 + Vite 7 + Tailwind 3 + Radix UI** (mesmo do V1). Tailwind 4 e shadcn entram só se trouxerem ganho mensurável. TanStack Router NÃO substitui React Router 7 a menos que sirva pra solucionar problema concreto.
- **Logs**: Pino estruturado (mesmo).

### Camadas onde o ganho compensa a troca

- **DB driver**: continua `better-sqlite3` (mesmo do V1).
- **DB schema layer**: **Drizzle ORM** (mudança real do V1). Justificativa: schema-as-code TypeScript reduz drift e dá migrations versionadas; ganho diretamente compensa o custo. Decisão: **vai pra spike de migração** (Spike 4) — se dryrun do V1→Drizzle for limpo, mantém. Se quebrar coisas inesperadas, recua pra SQL puro com helpers de tipo.
- **Validation**: **Zod v3** (mesmo do V1).
- **Auth**: **Argon2id + JWT cookie httpOnly + refresh** (novo no V2). V1 não tinha auth — não há herança a quebrar.
- **Tests**: Vitest (unit) + Playwright (E2E) — Vitest substituindo `node:test` é ganho pequeno mas ergonomia razoável.

### Camadas que dependem de spike

- **API layer**: tRPC v11 ou continuar REST + Zod compartilhado? **Decisão: spike interno (Spike 4 estendido)** valida o ganho. Se contracts compartilhadas via package + REST resolverem a dor de drift sem tRPC, fica REST.
- **Real-time**: SSE via Fastify Server-Sent-Events plugin (novo no V2). Polling fallback. WebSocket apenas pra streaming Chromium remoto (Spike 2).
- **Worker**: **híbrido Playwright + CDP**, não CDP-only. Playwright continua dono de navegação (clique, navegação, file upload, fechamento). CDP entra para: (a) `MutationObserver` injection via `Page.addScriptToEvaluateOnNewDocument`, (b) `Page.startScreencast` pro stream remoto, (c) `Runtime.addBinding` pro push de eventos. Validação: **Spike 1** prova o observer; **Spike 2** prova o screencast.
- **Container**: Docker + docker-compose (mesmo padrão V1 com PM2 dentro do container, ou trocar PM2 por systemd inside container).

## Consequências

- **Bom**: Reduz superfície de mudança simultânea. Foca o esforço V2 onde está o risco real (sync, streaming, áudio, migração).
- **Custo**: Perde alguns ganhos teóricos de DX (Bun startup, Hono speed). Aceitável dado que o gargalo do produto é Chromium, não HTTP.
- **Lock-in**: Drizzle se confirmar é o único bind significativo; saída pra SQL puro continua viável.

## Alternativas consideradas

- **Salto completo Bun + Hono + tRPC + Tailwind 4 + TanStack Router**: descartada após crítica do owner — risco/benefício ruim quando o real risco é browser stateful, não framework HTTP.
- **V1 puro sem mudança nenhuma**: descartada — V2 precisa de Auth real, multi-user schema, sync rebuild. Esses justificam um repo separado.
- **Postgres em vez de SQLite**: descartada — local-first ainda é valor.
- **Next.js full-stack**: descartada — overkill.

## Spikes que validam essa ADR

1. [Spike 1 — CDP observer <3s](../architecture/V2_SPIKES.md#spike-1)
2. [Spike 2 — Page.startScreencast latency](../architecture/V2_SPIKES.md#spike-2)
3. [Spike 3 — Áudio porta literal V1→V2 (IC-1)](../architecture/V2_SPIKES.md#spike-3)
4. [Spike 4 — Migration dryrun + Drizzle schema válido](../architecture/V2_SPIKES.md#spike-4)

Sem os 4 spikes verdes, esta ADR não é aprovada para execução — fica como visão.

## Referências

- Plano V2: [`/Users/gabrielbraga/.claude/plans/eu-quero-que-voc-cryptic-lobster.md`](../../.claude/plans/eu-quero-que-voc-cryptic-lobster.md)
- Roadmap: [`docs/IMPROVEMENTS_ROADMAP.md`](../IMPROVEMENTS_ROADMAP.md)
