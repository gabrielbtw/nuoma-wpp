# ADR 0002 - Monorepo structure

## Status

Accepted.

## Decision

Use a Turborepo monorepo with npm workspaces.

```text
apps/api
apps/web
apps/worker
packages/contracts
packages/db
packages/ui
packages/config
infra
docs
```

Each app owns its runtime. Shared contracts, DB access, config and UI tokens
live in packages so the apps do not copy schemas or environment rules.
