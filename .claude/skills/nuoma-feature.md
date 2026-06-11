---
name: nuoma-feature
description: Plan and implement a new feature following the Nuoma agent ownership model. Handles cross-layer coordination (core-api → frontend-web → scheduler/worker).
user_invocable: true
---

# /nuoma-feature — New Feature Implementation

You are implementing a new feature in the Nuoma WPP monorepo. Follow the agent ownership model strictly.

## Steps

### 1. Understand the request
- Read the user's feature description
- Identify which layers are affected (core, frontend, worker, scheduler)
- Check CLAUDE.md and AGENTS.md for ownership rules

### 2. Plan the implementation
- Enter plan mode
- For each affected layer, list the files to modify and the changes needed
- Respect ownership: core-api defines contracts first, then consumers adapt
- Identify if a new migration is needed (`packages/core/src/db/migrations.ts`)
- Identify if new types/schemas are needed (`packages/core/src/types/domain.ts`)

### 3. Implement in order
Follow the standard feature flow from AGENTS.md:

1. **core-api first**: schema, migration, repository, service, routes
2. **platform-workspace**: if deps/configs change
3. **Consumer layers**: frontend-web, wa-worker, or scheduler-runtime
4. **Validate each layer** before moving to the next:
   - `npm run typecheck --workspace @nuoma/core`
   - `npm run typecheck --workspace @nuoma/web-app`
   - etc.

### 4. Final validation
```bash
npm run typecheck
npm run hygiene
npm test
```

### 5. Summary
Provide a concise summary of:
- Files created/modified per layer
- New contracts (routes, types, schemas)
- Migration changes
- How to test the feature
