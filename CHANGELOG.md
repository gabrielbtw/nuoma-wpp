# Changelog

## 2026-04-04 - Omnichannel Evolution (Phases 1-12)

### Phase 1: Campaign Builder Robusto
- Migration 0008: message_templates, campaign step conditions, evergreen fields
- Template system with variable substitution ({{nome}}, {{telefone}}, etc.)
- New step types: document (PDF), link (URL)
- Condition editor: replied->exit, has_tag->branch, channel->adapt, window->wait
- Evergreen campaigns with auto-evaluation criteria
- Campaign stats badges (duration, step count, conditions)

### Phase 2: Builder Unificado
- FlowStepCard shared component (used by campaigns + automations)
- Automation editor refactored with drag-and-drop, conditions, media upload

### Phase 3: Inbox Unificada
- listUnifiedInbox: conversations grouped by contact across WA+IG
- listMessagesForContact: mixed chronological timeline
- Inbox UI rewrite: contact list, channel indicators, manual channel selector in composer

### Phase 4: Contact Narrative Ledger
- contact-detail.tsx redesigned as timeline with date separators
- Messages from all channels grouped by date with channel icons

### Phase 5: Advanced Segmentation
- queryContactsBySegment: dynamic AND/OR SQL query builder (10 filter criteria)
- SegmentBuilder component: reusable across contacts, campaigns, automations
- POST /contacts/query endpoint

### Phase 6: Event-based Automations
- Migration 0009: trigger_type, trigger_event, trigger_conditions_json, custom_category
- AutomationRuleRecord extended with event trigger fields
- Support for: message_received, campaign_completed, tag changes, conversation events

### Phase 7: Chatbot Entity
- chatbots + chatbot_rules tables
- ChatbotRepository: CRUD, keyword matching (contains, exact, starts_with, regex)
- Chatbot routes: GET/POST/PATCH/DELETE /chatbots
- ChatbotPage: split panel UI with rule editor + conversation preview/test

### Phase 8: Dashboard Error Badge
- Dashboard summary includes failure data (failed jobs, failed recipients)
- Error badge with red alert panel, job details, timestamps

### Phase 9-10: Design System Foundation
- Skeleton component (Skeleton, SkeletonCard, SkeletonList)
- EmptyState component (icon + title + description + CTA)
- Toast system (success, error, warning, info) with global toast() function
- DataTable component (columns, pagination, row selection)
- ToastContainer added to app root

### Phase 11: Project Analysis
- 24 tech debt items documented (9 HIGH, 13 MEDIUM, 2 LOW)
- 25 frontend design findings (3 CRITICAL, 9 MAJOR, 12 MINOR)
- 18 architecture risks (6 HIGH, 10 MEDIUM, 2 LOW)
- Impact vs Cost matrix with sprint recommendations

### Phase 12: Architecture Fixes + Performance
- Job lock auto-release (releaseStaleJobLocks in scheduler watchdog)
- Atomic deduplication (transaction-wrapped check+insert)
- Campaign pre-fetch cache (Map of campaigns to avoid N+1)
- Unified inbox N+1 fix (subquery instead of per-contact query)
- Worker state freshness check (120s threshold)
- Chatbot navigation added to sidebar

### Files Created (18)
- packages/core/src/repositories/template-repository.ts
- packages/core/src/repositories/chatbot-repository.ts
- packages/core/src/utils/template-vars.ts
- apps/web-app/src/server/routes/templates.ts
- apps/web-app/src/server/routes/chatbots.ts
- apps/web-app/src/client/components/shared/flow-step-editor.tsx
- apps/web-app/src/client/components/shared/segment-builder.tsx
- apps/web-app/src/client/components/campaigns/workflow-viewer.tsx
- apps/web-app/src/client/components/ui/skeleton.tsx
- apps/web-app/src/client/components/ui/empty-state.tsx
- apps/web-app/src/client/components/ui/toast.tsx
- apps/web-app/src/client/components/ui/data-table.tsx
- apps/web-app/src/client/pages/chatbot.tsx
- docs/PHASE-11-ANALYSIS.md
- CHANGELOG.md
- CLAUDE.md
- .claude/skills/ (10 skill files)
- .claude/settings.json

### Files Modified (20+)
- packages/core/src/db/migrations.ts (migrations 0008, 0009)
- packages/core/src/types/domain.ts (templates, conditions, chatbot, events)
- packages/core/src/repositories/campaign-repository.ts (evergreen, conditions, manual recipients, step stats)
- packages/core/src/repositories/conversation-repository.ts (unified inbox, contact messages)
- packages/core/src/repositories/automation-repository.ts (event trigger fields)
- packages/core/src/repositories/job-repository.ts (atomic dedupe, stale lock release)
- packages/core/src/services/campaign-service.ts (campaign cache, freshness check)
- packages/core/src/services/dashboard-service.ts (failure data)
- packages/core/src/index.ts (new exports)
- apps/web-app/src/server/routes/index.ts (chatbot + template routes)
- apps/web-app/src/server/routes/campaigns.ts (step stats, manual recipients)
- apps/web-app/src/server/routes/contacts.ts (segment query)
- apps/web-app/src/server/routes/conversations.ts (unified inbox endpoints)
- apps/web-app/src/client/app.tsx (chatbot route, toast container)
- apps/web-app/src/client/pages/campaigns.tsx (manual input, workflow viewer)
- apps/web-app/src/client/pages/inbox.tsx (unified inbox rewrite)
- apps/web-app/src/client/pages/contact-detail.tsx (narrative ledger rewrite)
- apps/web-app/src/client/pages/dashboard.tsx (error badge)
- apps/web-app/src/client/components/campaigns/builder.tsx (conditions, new steps, stats)
- apps/web-app/src/client/components/automations/editor.tsx (shared FlowStepCard)
- apps/web-app/src/client/components/layout/shell.tsx (chatbot nav)
- apps/web-app/src/client/lib/campaign-utils.ts (conditions, evergreen, duration)
- apps/web-app/src/client/lib/system-types.ts (failure types)
- apps/wa-worker/src/worker.ts (content type mapping)
- apps/scheduler/src/index.ts (stale lock release)
- AGENTS.md (architecture decisions)
