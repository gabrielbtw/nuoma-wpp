---
name: nuoma-api
description: Create or modify API routes (Fastify) with proper repository/service integration. Handles the full core-api layer.
user_invocable: true
---

# /nuoma-api — API Route Work

You are creating or modifying API routes in Nuoma WPP.

## Context
- Routes live in `apps/web-app/src/server/routes/`
- Route registration in `apps/web-app/src/server/routes/index.ts`
- Repositories in `packages/core/src/repositories/`
- Services in `packages/core/src/services/`
- Types/schemas in `packages/core/src/types/domain.ts`

## Architecture pattern

```
Route Handler → Service (business logic) → Repository (DB access)
     ↓                    ↓                        ↓
  Validates input    Orchestrates logic      SQL queries
  Returns response   Calls repos             Returns records
```

## Steps

### 1. Define the contract
- What HTTP method and path?
- What request body/query params?
- What response shape?
- Add Zod schema in `domain.ts` if new input

### 2. Create/update repository
If new data access is needed:
- Add functions to existing repository or create new one in `packages/core/src/repositories/`
- Follow pattern: parameterized SQL, `withSqliteBusyRetry` for writes
- Return typed records

### 3. Create/update service (if business logic needed)
- Services in `packages/core/src/services/`
- Import from repositories
- Handle validation, coordination, side effects

### 4. Create/update route handler
```typescript
app.get("/endpoint", async (req, reply) => {
  const result = await someService.doSomething();
  return reply.send(result);
});

app.post("/endpoint", async (req, reply) => {
  const input = someSchema.parse(req.body);
  const result = await someService.create(input);
  return reply.status(201).send(result);
});
```

### 5. Register route
Add to `apps/web-app/src/server/routes/index.ts` if new route file.

### 6. Validate
```bash
npm run typecheck --workspace @nuoma/core
npm run typecheck --workspace @nuoma/web-app
```
