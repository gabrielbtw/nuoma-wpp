# ADR 0004 — Feature-Based Folders V2

## Status

Aceita.

## Contexto

V1 usa estrutura por camada (`routes/`, `services/`, `repositories/`). Ao crescer, navegação fica espalhada — adicionar feature toca 4-5 diretórios diferentes.

## Decisão

V2 organiza por **feature** dentro de cada app, com infra/shared em pastas dedicadas:

```
apps/api/src/
├── features/
│   ├── auth/            # tudo de auth aqui
│   ├── contacts/
│   ├── conversations/
│   ├── messages/
│   ├── campaigns/
│   ├── automations/
│   ├── chatbots/
│   ├── tags/
│   ├── attendants/
│   ├── jobs/
│   ├── push/
│   ├── embed/
│   ├── streaming/
│   └── system/
├── infra/               # cross-cutting: db, http, cdp, pubsub
├── shared/              # auth-middleware, error, logger
└── index.ts
```

Cada feature contém: `router.ts` (tRPC procedures), `service.ts` (regra de negócio), `*.test.ts`. Repos ficam em `packages/db/src/repositories/`.

`apps/web/` espelha as features. Componentes específicos de feature ficam dentro dela; primitives compartilhadas vão pra `packages/ui/`.

## Consequências

- **Bom**: Adicionar/remover feature toca 1-2 lugares. Onboarding mais rápido (developer abre `features/contacts/` e vê tudo).
- **Custo**: Disciplina pra não vazar lógica entre features. Se duas features compartilham, extrai pra `shared/` ou `packages/`.

## Alternativas

- Por camada (V1 atual): descartada — vai dar o mesmo problema do V1 conforme crescer.
- DDD bounded contexts puro: descartada — overkill pra single-app de tamanho médio.
