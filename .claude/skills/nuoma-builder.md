---
name: nuoma-builder
description: Work on the campaign/automation/chatbot builder component. Understands the unified builder architecture and step/condition patterns.
user_invocable: true
---

# /nuoma-builder — Flow Builder Work

You are working on the unified flow builder for Nuoma WPP.

## Context

The builder is being unified across 3 flow types:
- **Campanha**: manual/CSV trigger, finite recipients, evergreen optional
- **Automacao**: tag/event trigger, continuous evaluation, cooldowns
- **Chatbot**: message-received trigger, conversational flow, fallback

All share a single builder UI component with adapted options per type.

## Current state
- Campaign builder: `apps/web-app/src/client/components/campaigns/builder.tsx` (639 lines)
- Campaign page: `apps/web-app/src/client/pages/campaigns.tsx` (1147 lines)
- Campaign utils: `apps/web-app/src/client/lib/campaign-utils.ts` (228 lines)
- Automation editor: `apps/web-app/src/client/components/automations/editor.tsx`

## Step types
Current: `text`, `audio`, `image`, `video`, `wait`, `ADD_TAG`, `REMOVE_TAG`
Planned: `document`, `link`

## Condition types (planned)
- `replied` → action: `skip` or `exit`
- `has_tag` → action: `jump_to_step`
- `channel_is` → action: `skip`
- `outside_window` → action: `wait`

## Template system (planned)
- Templates with variables: `{{nome}}`, `{{telefone}}`, `{{email}}`, `{{instagram}}`, `{{procedimento}}`
- WhatsApp formatting: `*bold*`, `_italic_`, `~strikethrough~`
- Template picker integrated in step editor

## Key libraries
- `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop
- Tailwind + Radix UI for styling
- TanStack Query for data

## Steps for any builder change
1. Read the current builder code
2. Understand the CampaignDraft / CampaignStepDraft types in campaign-utils.ts
3. Make changes following existing drag-and-drop and step editor patterns
4. Validate: `npm run typecheck --workspace @nuoma/web-app`
