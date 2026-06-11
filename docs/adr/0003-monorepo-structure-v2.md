# ADR 0003 — Monorepo Structure V2

## Status

Aceita.

## Contexto

V2 tem 3 apps (api, web, worker) + pacotes shared (contracts, db, ui, config). Precisa build paralelo, hot reload em dev, isolamento de boundaries.

## Decisão

**Turborepo + npm workspaces**.

Estrutura raiz:

```
nuoma-wpp-v2/
├── apps/
│   ├── api/        # Fastify + REST/Zod + Drizzle
│   ├── web/        # React + Vite
│   └── worker/     # Playwright + CDP sync
├── packages/
│   ├── contracts/  # Zod schemas shared by api/web/worker
│   ├── db/         # Drizzle schema + repos
│   ├── ui/         # Liquid Glass + Cartographic primitives
│   └── config/     # env validation, constants
├── infra/
│   ├── docker/
│   ├── caddy/
│   └── scripts/
├── docs/
├── .claude/
├── turbo.json
├── package.json
└── tsconfig.json
```

Pipelines turbo: `build`, `dev`, `test`, `typecheck`, `lint`. Cache distribuído opcional (Vercel Remote Cache via `TURBO_TOKEN`) — desativado por padrão (local-first).

## Consequências

- **Bom**: Builds incrementais, dev paralelo via `npm run dev`, isolamento explícito por app/package.
- **Custo**: Curva de Turborepo, cache local em `.turbo/`.
- **Risco baixo**: Turborepo é estável e amplamente adotado.

## Alternativas

- Sem monorepo (3 repos separados): descartada — sincronização de tipos vira pesadelo.
- Nx: descartada — mais opinionado, footprint maior.
- pnpm workspaces: viável, mas npm workspaces mantém o V2 alinhado ao V1 e reduz troca simultânea.
