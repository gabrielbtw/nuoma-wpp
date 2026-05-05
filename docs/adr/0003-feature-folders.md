# ADR 0003 - Feature folders

## Status

Accepted.

## Decision

Use feature-oriented folders inside each app once product code begins.

Examples:

- `apps/api/src/features/inbox`
- `apps/web/src/features/campaigns`
- `apps/worker/src/features/sync`

Cross-feature code must move to a shared package only after two real callers
exist.
