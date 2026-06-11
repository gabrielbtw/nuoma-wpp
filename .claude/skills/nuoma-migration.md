---
name: nuoma-migration
description: Run or change Nuoma V2.15 migration/cutover workflows: preflight, dry-run, apply, validation, backup, restore and rollback gates. Never writes V1 DB.
user_invocable: true
---

# /nuoma-migration

Consolidates the old migration dry-run, data import and cutover checklist skills.

## Boundaries

- Never write to V1 DB.
- Always run preflight before apply.
- Real apply requires explicit confirmation and `V215_CONFIRM_CUTOVER=SIM`.
- Do not start worker/scheduler against migrated data until validate and smoke pass.
- Cutover details live in `docs/migration/CUTOVER_PLAN.md` and `docs/runbooks/CUTOVER_ROLLBACK.md`.

## Commands

- `npm run migration:v215:preflight -- --report=data/reports/v215-preflight.json`
- `npm run migration:v215:dry-run -- --report=data/reports/v215-dry-run.json`
- `V215_CONFIRM_CUTOVER=SIM npm run migration:v215:apply -- --report=data/reports/v215-apply.json`
- `npm run migration:v215:validate -- --report=data/reports/v215-validate.json`
- `npm run test:v215-cutover-preflight`
- `npm run test:v215-cutover-apply`

## Checklist

1. Confirm DB/storage paths and backup targets.
2. Run preflight and block on blockers.
3. Review dry-run counts, orphans and missing media.
4. Apply only to clone first, validate, then rehearse rollback.
5. Apply real only in approved window, then smoke and monitor 24h.
