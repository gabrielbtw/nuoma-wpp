---
name: nuoma-refactor
description: Refactor code in Nuoma WPP following the phased plan (PLANS.md). Ensures small, reversible, safe changes.
user_invocable: true
---

# /nuoma-refactor — Safe Refactoring

You are refactoring code in Nuoma WPP following the stability-first philosophy.

## Principles (from PLANS.md)
- Stability first
- Small, reversible, testable changes
- Preserve contracts, behavior, and integrations
- No new libraries without strong justification
- Simplification over abstraction

## Current phases (from PLANS.md)
- Phase 0: DONE (baseline hygiene)
- Phase 1: Consistency (enums, types, labels)
- Phase 2: Readability (break large files, extract helpers)
- Phase 3: Dependencies (review ownership)
- Phase 4: Layer boundaries (reduce coupling)
- Phase 5: Operational maintenance (hotspots)
- Phase 6: Documentation

## Known hotspots
- `apps/web-app/src/client/pages/campaigns.tsx` (1147 lines)
- `apps/web-app/src/client/components/campaigns/builder.tsx` (639 lines)
- `apps/wa-worker/src/worker.ts` (~500 lines)
- `packages/core/src/services/automation-service.ts` (415 lines)
- `packages/core/src/services/campaign-service.ts` (444 lines)
- `packages/core/src/repositories/contact-repository.ts` (~700 lines)
- `packages/core/src/repositories/conversation-repository.ts` (~500 lines)

## Steps
1. Identify the refactoring target and which phase it belongs to
2. Read the current code thoroughly
3. Plan the change — ensure it's small and reversible
4. Check ownership (AGENTS.md) — stay within your layer
5. Implement the change
6. Validate immediately:
   ```bash
   npm run typecheck
   npm run hygiene
   npm test
   ```
7. If anything breaks, revert and try a smaller change
8. Summarize: what changed, what improved, what's next

## Cut rule
If a change stops being small, reversible, or clearly safe — stop. Move it to a future phase.
