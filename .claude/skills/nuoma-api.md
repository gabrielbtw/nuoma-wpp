---
name: nuoma-api
description: Work on Nuoma V2 API contracts, tRPC/REST routers, services, repositories and SQLite/Drizzle persistence in apps/api, packages/contracts and packages/db.
user_invocable: true
---

# /nuoma-api

Use for core-api work.

## Scope

- Owns `apps/api/src/**`, `packages/contracts/src/**`, `packages/db/src/**`.
- Defines schemas, DTOs, tRPC/REST contracts, job payloads, migrations and repository behavior.
- Consumers (`apps/web`, `apps/worker`, companions) adapt after the contract is stable.

## Workflow

1. Read `AGENTS.md` and the current router/service/repository before editing.
2. Update contracts first when payloads or response shapes change.
3. Keep routers thin; put business rules in services and persistence in `packages/db`.
4. Use parameterized queries/Drizzle helpers; do not let frontend/worker infer DB internals.
5. Document architecture or operational changes in `docs/**` when behavior changes.

## Validate

- `npm run typecheck --workspace @nuoma/contracts`
- `npm run typecheck --workspace @nuoma/db`
- `npm run typecheck --workspace @nuoma/api`
- `npm run test --workspace @nuoma/db`
- `npm run test --workspace @nuoma/api`
