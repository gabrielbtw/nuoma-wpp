---
name: nuoma-segment
description: Build or modify the reusable segmentation/filter builder component (AND/OR filters for contacts, campaigns, automations).
user_invocable: true
---

# /nuoma-segment — Segmentation Builder

You are working on the reusable segmentation builder for Nuoma WPP.

## Architecture decision
- AND/OR filter builder component
- Reusable across: contacts page, campaign recipient selector, automation trigger criteria
- Component: `apps/web-app/src/client/components/shared/segment-builder.tsx`

## Filter criteria
- `tag` — has_tag / not_has_tag
- `status` — equals (novo, aguardando_resposta, em_atendimento, cliente, sem_retorno, perdido)
- `channel` — has_channel (whatsapp / instagram)
- `created_at` — before / after date
- `last_interaction_at` — before / after date
- `procedure_status` — equals (yes / no / unknown)
- `instagram_relationship` — follows_me / followed_by_me / mutual / none

## Backend
- Dynamic SQL query builder in `packages/core/src/repositories/contact-repository.ts`
- Parameterized queries to prevent SQL injection
- Operators: equals, not_equals, contains, before, after, has_tag, not_has_tag, has_channel

## UI pattern
```
[Field ▾] [Operator ▾] [Value ▾]  [× remove]
          [AND / OR]
[Field ▾] [Operator ▾] [Value ▾]  [× remove]
                              [+ Add filter]
```

## Usage contexts
1. Contacts page: filter contact list
2. Campaign creation: select recipients by criteria (alternative to CSV)
3. Automation trigger: define which contacts match the rule
4. Evergreen campaigns: criteria for auto-adding new contacts
