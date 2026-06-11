---
name: nuoma-inbox
description: Work on the unified inbox (WhatsApp + Instagram in single timeline per contact). Understands the omnichannel conversation model.
user_invocable: true
---

# /nuoma-inbox — Unified Inbox Work

You are working on the unified inbox for Nuoma WPP.

## Architecture decision
- Single timeline per contact mixing WhatsApp and Instagram messages chronologically
- Channel indicator (WA green / IG purple icon) on each message
- Manual channel selector in composer (dropdown/toggle)
- Filter by channel maintained (all / whatsapp / instagram)

## Quick actions in inbox
- Apply/remove tag
- Change contact status
- Create reminder
- Enroll in campaign
- Add note

## Current state
- Inbox page: `apps/web-app/src/client/pages/inbox.tsx` (388 lines)
- Conversations are currently per-channel (not unified per contact)
- Conversation repo: `packages/core/src/repositories/conversation-repository.ts`
- Contact channels: `packages/core/src/repositories/contact-channel-repository.ts`

## Key tables
- `conversations` — has `channel` and `channel_account_id` columns
- `messages` — has `channel` column
- `contact_channels` — maps contact to channels (whatsapp/instagram)
- `contacts` — has both `phone` and `instagram` fields

## Implementation approach
1. Backend: new endpoint that aggregates conversations by contact_id across channels
2. Frontend: refactor inbox.tsx to group by contact, show mixed timeline
3. Composer: add channel selector showing only available channels for the contact
4. Quick actions: sidebar panel with tag/status/reminder/campaign/notes controls
