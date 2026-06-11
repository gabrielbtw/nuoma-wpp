# ADR 0005 — SQLite + Drizzle ORM V2

## Status

Aceita.

## Contexto

V1 usa SQL puro via `better-sqlite3` com migrations em `array<{id, sql}>`. Funciona mas: (1) sem type-safety nas queries, (2) refactor de schema requer `find/replace` em strings SQL, (3) sem detecção de drift.

## Decisão

V2 mantém **SQLite** como engine (local-first preservado, até 50k contatos sem pressão) + adota **Drizzle ORM** como camada de schema/queries.

- Schema declarado em TypeScript (`packages/db/src/schema.ts`).
- Migrations geradas via `drizzle-kit generate`.
- Queries type-safe via inferência (`db.select().from(contacts).where(eq(contacts.userId, 1))`).
- Driver: `better-sqlite3` (mesmo do V1) com WAL mode + busy_timeout.

Multi-user desde dia 1: `user_id NOT NULL` em todas tabelas operacionais. Single-user inicial = `user_id=1` seeded.

## Consequências

- **Bom**: Type safety completa, migrations versionadas, refactor seguro, IDE autocomplete em queries.
- **Custo**: Aprender Drizzle DSL (curto, intuitivo).
- **Bind**: `drizzle-orm` + `drizzle-kit` dependencies. Lock-in moderado mas saída pra SQL puro é viável (queries Drizzle têm equivalente SQL direto).

## Alternativas

- SQL puro continua (V1 model): descartada — falta type safety.
- Prisma: descartada — heavyweight, prisma-client gerado é grande e aumenta a complexidade operacional.
- Kysely: viável mas Drizzle tem ecossistema mais ativo.
- Postgres: descartada — local-first é valor central; user nunca pediu mover pra Postgres.

## Migration path

V1.10 (backup) usa `.backup` API do better-sqlite3 (sem Drizzle envolvido). V2.15 (migração) lê DB V1 com better-sqlite3 puro, escreve no V2 via Drizzle.
