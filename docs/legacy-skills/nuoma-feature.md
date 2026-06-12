---
name: nuoma-feature
description: Plan or implement Nuoma V2 web/product features, pages, components, builder, inbox, segmentation and focused frontend refactors using the ownership model.
user_invocable: true
---

# /nuoma-feature

Consolidates the old page/component/builder/inbox/segment/refactor skills.

## Scope

- Frontend/UI: `apps/web/src/**`, `apps/web/index.html`, `packages/ui/src/**`.
- Cross-layer feature: start with `nuoma-api` for contracts, then adapt the UI.
- Do not change DB/schema/API responses from frontend files.

## Workflow

1. Identify affected layer and owner from `AGENTS.md`.
2. Reuse existing components, tokens and page patterns before adding abstractions.
3. Keep large pages moving toward small panels/hooks, but avoid broad rewrites unless requested.
4. For builder/inbox/segment work, preserve user workflows and loading/error states.
5. Update docs when UX changes operational setup, roadmap or validation.

## Validate

- `npm run typecheck --workspace @nuoma/ui`
- `npm run typecheck --workspace @nuoma/web`
- `npm run build --workspace @nuoma/web`
