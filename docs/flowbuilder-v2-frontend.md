# Flow Builder V2 — Frontend Rebuild

> Status: implementation document. The frontend rebuild is present in the
> worktree on 2026-06-11 and this file now records the shipped structure,
> constraints, known limits and validation evidence. Update it when decisions
> change.
>
> Branch: `feat/rebrand-carvao-cobre` · Owner decision on record: full rebuild of
> the Flow Builder / Campaigns / Automations frontend (scenario B), Carvão &
> Cobre direction. See `~/.claude/plans/nuoma-web-rebrand-audit-2026-06-11.md`.

---

## 1. Product goal

Nuoma WPP is a single-tenant WhatsApp + Instagram messaging hub. The Flow
Builder is where Gabriel (advanced business user, non-developer) designs:

- **Campaigns** — ordered message sequences (text, voice, image, video,
  document, link, temporary-messages toggle) sent to an audience, with
  per-step delays and conditions (replied / has tag / channel / 24h-window →
  exit / branch / skip / wait).
- **Automations** — event-driven flows (message received, campaign completed,
  tag applied/removed) that run a list of actions (send step, delay, branch,
  apply/remove tag, set status, create reminder, notify attendant, trigger
  another automation), optionally gated by a segment and the 24h window.

The previous UI was a 3,288-line monolith (`src/flow-builder/FlowBuilder.tsx`)
with form-tab UX and a read-only canvas. It is **disposable**: the rebuild
replaces the entire editing experience with a ManyChat-style canvas editor,
plus new Campaigns and Automations screens. The backend is the source of
truth; no contract changes are required (and none were made).

## 2. UX/UI direction

Premium dark "command center" SaaS. References mined for patterns (not
copied):

| Reference        | Pattern taken                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------- |
| ManyChat         | Vertical flow spine, block cards with config summary, right-side inspector, chat preview |
| Zapier canvas    | "+" affordance between steps, clear step numbering, validation surfaced inline           |
| Typebot/Botpress | Block library grouped by category, drag-to-canvas                                        |
| Linear           | Quiet chrome, keyboard-friendly, hairline separators, restrained motion                  |
| Vercel dashboard | Card grids with status chips, empty states with a single CTA                             |

Hard rules (from the Carvão & Cobre rebrand, phase 1 already merged):

- Dark only. Warm charcoal surfaces, off-white warm ink, **one** copper accent
  reserved for action/focus/live state. No glass, no glow, no gradients behind
  dense data, no neon.
- Channel identity is shown with small chips/icons (`ChannelIcon`), WhatsApp
  green `--nw-channel-wa` and Instagram pink `--nw-channel-ig`, used sparingly.
- Motion: framer-motion for panel slide/fade and node mount; 150–250 ms,
  ease-out; nothing bouncy. Canvas interactions must feel instant.
- All user-facing text in pt-BR. Code and docs in English.

## 3. Main screens & routes

| Route                             | Screen                                                                          | File                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `/campaigns`                      | Campaigns hub: card list + KPIs + operational consoles (Disparo, Destinatários) | `features/campaigns/CampaignsScreen.tsx`                    |
| `/campaigns/new`                  | Campaign builder (create)                                                       | `features/flow-builder/screens/CampaignBuilderScreen.tsx`   |
| `/campaigns/$campaignId/edit`     | Campaign builder (edit)                                                         | same screen, loads `campaigns.get`                          |
| `/automations`                    | Automations hub: card list + KPIs + safe manual test                            | `features/automations/AutomationsScreen.tsx`                |
| `/automations/new`                | Automation builder (create)                                                     | `features/flow-builder/screens/AutomationBuilderScreen.tsx` |
| `/automations/$automationId/edit` | Automation builder (edit)                                                       | same screen, loads `automations.get`                        |

The builder screens render **full-bleed** (own grid, no shell page padding),
with a top bar that links back to the hub. The Chatbots page is out of scope
for this rebuild (its rules editor is a different interaction model); it keeps
working untouched.

### Create campaign inspector UX

The `/campaigns/new` flow settings state was reworked after visual review with
the `ux-ui-design` checklist. The right inspector is only ~359px wide inside the
real shell, so campaign creation is intentionally compact:

- **Essenciais**: campaign name + channel in one compact panel.
- **Envio**: two radio-card choices, Evergreen vs Manual, with the optional
  datetime input shown only in manual mode.
- **Audiência**: summary-first segment switch; disabled state is one dashed
  informational row, enabled state uses compact rule rows.
- **Prontidão**: readiness checks are chips (`Nome`, `Blocos`, `Canal`,
  `Público`) instead of a tall checklist.

Measured evidence after the change: 359px inspector width,
`scrollHeight=clientHeight=806` at 1440x900, so the full create panel fits
without clipping or hidden controls.

### Builder layout (both modes)

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar: ← voltar · nome (inline edit) · canal · status ·     │
│         unsaved dot · [Prévia] [Salvar] [Publicar]           │
├──────────┬───────────────────────────────┬───────────────────┤
│ Block    │  Canvas (XYFlow)              │ Inspector         │
│ library  │  - vertical spine, auto-layout│ - flow settings   │
│ (left,   │  - custom node cards          │   when nothing    │
│ grouped, │  - "+" button on edges        │   selected        │
│ search,  │  - branch edges (curved,      │ - block editor    │
│ drag or  │    distinct color)            │   when selected   │
│ click)   │  - zoom/pan/minimap           │ (right, 360px)    │
├──────────┴───────────────────────────────┴───────────────────┤
│ PreviewPanel (slide-over from the right, chat simulator)     │
└──────────────────────────────────────────────────────────────┘
```

## 4. Component architecture & folder structure

New code lives under `apps/web/src/features/`. The pure domain logic that was
already extracted and unit-tested stays in `apps/web/src/flow-builder/lib/`
(drafts, validation, contract mapping, templates, segments, CSV preview) and
is treated as the **flow domain module** — the rebuild consumes it, the old
monolith UI that consumed it is deleted.

```
src/
  features/
    flow-builder/
      config/
        test-identities.ts     # default test destinations (single source)
        step-registry.tsx      # campaign step types → UI definition
        action-registry.tsx    # automation action types → UI definition
      state/
        campaign-store.tsx     # provider + reducer for the campaign draft
        automation-store.tsx   # provider + reducer for the automation draft
      canvas/
        FlowCanvas.tsx         # XYFlow wrapper (controls, background, DnD)
        FlowNodeCard.tsx       # the single custom node renderer
        SequenceEdge.tsx       # custom edge with "+" insert button
        layout.ts              # deterministic vertical auto-layout
        graph.ts               # draft state → nodes/edges
      library/
        BlockLibrary.tsx       # left sidebar, grouped + searchable
      inspector/
        InspectorShell.tsx     # frame + animated panel switch
        CampaignFlowSettings.tsx
        AutomationFlowSettings.tsx
        StepFields.tsx         # per campaign-step-type fields
        ActionInspector.tsx    # per automation-action-type fields
        fields/
          MediaPicker.tsx      # media.list-backed asset select
          ConditionsEditor.tsx # campaign step conditions
          SegmentEditor.tsx    # segment rule rows (and/or)
          TagSelect.tsx        # tags.list-backed select
      preview/
        PreviewPanel.tsx       # slide-over: simulator + real test controls
        ChatSimulator.tsx      # WhatsApp/Instagram-styled conversation
      shell/
        BuilderTopBar.tsx
      screens/
        CampaignBuilderScreen.tsx
        AutomationBuilderScreen.tsx
    campaigns/
      CampaignsScreen.tsx      # hub: cards, filters, ops tabs
      CampaignCard.tsx
    automations/
      AutomationsScreen.tsx
      AutomationCard.tsx
  flow-builder/lib/            # (pre-existing, kept) pure domain logic + tests
  campaigns/                   # (pre-existing, kept) operational consoles:
                               # CampaignsDispatchPanel, CampaignsRecipientsPanel,
                               # SafeRemarketingConsole — wired into CampaignsScreen
  styles/pages/flow-builder.css# XYFlow theming + builder/chat CSS (nw-* vocabulary)
```

Conventions:

- Components are small and typed; no file should approach 400 lines.
- No raw hex/rgb in TSX or page CSS — only `--nw-*` tokens / Tailwind
  vocabulary (`surface-N`, `ink-*`, `accent`, `line-*`, `status-*`,
  `channel-*`) from `@nuoma/ui/tailwind-preset`.
- Shared primitives come from `@nuoma/ui` (Button, IconButton, Input, Field,
  Select, Switch, SegmentedControl, Badge, Tabs, Dialog, Sheet, Tooltip,
  Empty/Error/LoadingState, Skeleton, ChannelIcon, toast). Do not fork them.

## 5. Design system & theme tokens

Phase 1 of the rebrand already shipped the token layer; the builder consumes
it, it does not define new colors.

- Source of truth: `apps/web/src/styles/tokens.css` (`--nw-*` RGB triplets) +
  `packages/ui/src/tailwind/preset.ts` + `packages/ui/src/tokens/index.ts`
  (radius, spacing, motion, type scale).
- Typography: Inter Variable (body), Space Grotesk Variable (display),
  JetBrains Mono Variable (data/ids). Already loaded in `styles.css`.
- Flow-specific tokens already exist and are used by the canvas:
  `--nw-flow-edge`, `--nw-flow-branch`, `--nw-flow-exit`, `--nw-flow-grid`,
  `--nw-flow-wa`, `--nw-flow-ig`, `--nw-flow-accent`, `--nw-flow-danger`,
  `--nw-flow-neutral`, `--nw-flow-label`.
- Depth: hairline rings + low shadows (`--nw-shadow-flat/raised/lifted`); the
  selected node uses a copper ring, never a glow.
- Motion durations/easings come from the preset (`motion` tokens); panels use
  framer-motion with 0.18–0.24 s ease-out.

## 6. Backend integration strategy

Transport: tRPC v11 over `@tanstack/react-query` (`src/lib/trpc.ts`,
`RouterInput`/`RouterOutput` helpers in `src/lib/api-types.ts`). All API body
schemas omit `userId` (injected from session context). CSRF-protected
mutations already handled by the shared client.

Endpoints used by the rebuild (all pre-existing — **no backend changes**):

| Domain      | Procedures                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaigns   | `list`, `get`, `create`, `update`, `pause`, `resume`, `ready`, `tick` (dry/real), `execute` (dry/real, allowlist), `remarketingBatchReady/Dispatch` (kept in ops consoles) |
| Automations | `list`, `get`, `create`, `update`, `test`, `trigger` (dry/real, allowlist)                                                                                                 |
| Support     | `tags.list`, `media.list` (type-filtered, for media steps), `attendants` (notify action uses free id input for now)                                                        |

Persistence model — the backend stores **ordered arrays**, not node positions:

- Campaign: `steps: CampaignStep[]` (order = execution order, branch via
  `conditions[].targetStepId`).
- Automation: `trigger + condition + actions: AutomationAction[]` (order =
  execution order, branch via `branch.targetActionId`).

The builder therefore keeps the array as the canonical draft state and
**derives** the canvas (see §8). Saving maps drafts → contracts via the tested
`buildSteps` / `buildActions` in `flow-builder/lib/build-steps.ts`. Campaign
`metadata` keys already in use elsewhere (`overlayEnabled`, A/B metadata via
`buildAbVariantsMetadata`) are preserved on update (spread existing metadata).

Publishing semantics:

- Campaign "Publicar" sets `status: "scheduled"` (confirm dialog). Real
  dispatch still goes through the Disparo console guardrails (`ready` →
  `tick` with textual confirmation), which the campaign hub keeps.
- Automation "Publicar" sets `status: "active"` (confirm dialog) — automations
  react to live events immediately, the dialog says so.

## 7. Step/block mapping strategy (registry)

Two registries, one per backend discriminated union, each **exhaustively
keyed** by the contract type so adding a backend variant fails typecheck until
the frontend maps it:

```ts
// config/step-registry.tsx
export const stepRegistry: Record<CampaignStep["type"], StepDefinition> = { ... }
// config/action-registry.tsx
export const actionRegistry: Record<AutomationAction["type"], ActionDefinition> = { ... }
```

A definition provides: `label` (pt-BR), `description`, `icon` (lucide),
`tone` (canvas accent), `category` (library grouping), `channels`
(whatsapp/instagram support, sourced from
`flow-builder/lib/validation.ts#instagramSupportedStepTypes`), `createDraft`,
`summarize(draft)` (node card summary), and the inspector is dispatched by
type inside `StepInspector`/`ActionInspector`.

Current coverage (complete backend inventory as of 2026-06-11):

- Campaign steps (7): `text`, `voice`, `image`, `video`, `document`, `link`,
  `temporary_messages`.
- Automation actions (9): `send_step` (embeds a campaign step), `delay`,
  `branch`, `apply_tag`, `remove_tag`, `set_status`, `create_reminder`,
  `notify_attendant`, `trigger_automation`.
- Automation triggers (4): `message_received`, `campaign_completed`,
  `tag_applied`, `tag_removed` (edited in flow settings, rendered as the
  canvas trigger node).

**Adding a new step type in the future:**

1. Backend adds the variant to the contract union (`@nuoma/contracts`).
2. Typecheck fails on the registry `Record` — add an entry (label, icon,
   category, createDraft, summarize).
3. Extend the draft model + `buildStep`/`buildActions` mapping in
   `flow-builder/lib/build-steps.ts` (tested).
4. Add the editor case in `StepInspector`/`ActionInspector` (exhaustive
   `switch` — compiler enforces).
5. Add a bubble case in `ChatSimulator` if it renders in conversation.
   Unknown/unhandled types fall back to a safe generic card ("Tipo sem editor
   dedicado") that exposes label/delay and preserves data untouched.

## 8. Canvas strategy

- Library: `@xyflow/react` v12 (already a dependency, locked product decision).
- The canvas is a **projection** of the ordered draft arrays. `graph.ts`
  builds nodes/edges; `layout.ts` assigns deterministic positions on a
  vertical spine (entry node → blocks → end node). Positions are **derived,
  not persisted** — this guarantees no overlapping/broken layouts and matches
  the sequential execution model honestly (a free-form canvas would imply a
  graph the backend doesn't store).
- Interactions:
  - Click node → select → inspector edits it (copper ring on node).
  - Drag node vertically → on drop, reorder the array by Y order, then
    re-layout (snap). Horizontal drags snap back.
  - "+" button on sequence edges → insert a text step/action at that position
    (then select it for immediate editing in the inspector).
  - Drag a block from the library onto the canvas → append/insert near drop Y.
  - Connect from a node's branch handle to another node → creates/updates a
    `branch` condition (campaign) or sets `targetActionId` (automation branch
    action). Branch edges render in `--nw-flow-branch`, exit edges in
    `--nw-flow-exit`.
  - Zoom/pan/minimap/fit-view; `Delete` removes selection; Esc deselects.
- Validation states render on the node (warning chip) sourced from
  `flow-builder/lib/validation.ts`; the topbar shows an aggregate readiness
  pill; saving with errors is blocked with a toast listing the first issues.

## 9. State management strategy

React context + `useReducer` per builder mode (`campaign-store.tsx`,
`automation-store.tsx`). Rationale: flows are tens of nodes, not thousands;
a reducer gives typed, testable transitions without adding a dependency
(Zustand was considered and rejected — nothing here needs external-store
performance semantics). Store shape:

- `meta` (name, channel, status, evergreen/startsAt or trigger/condition).
- `items` (StepDraft[] / ActionDraft[] from the domain lib).
- `selection` (`{ kind: "flow" } | { kind: "item", id } | entry/end nodes`).
- `dirty` flag (set by every edit, cleared on save; `beforeunload` guard).
- Server sync stays in TanStack Query mutations at the screen level; the
  store is purely client draft state, hydrated from `campaigns.get` /
  `automations.get` via `loadFromCampaign`/`loadFromAutomation` mappers.

## 10. Preview & test strategy

Default test identities (single source `config/test-identities.ts`, mandated
by product — do not scatter literals):

```
WhatsApp : 5531982066263
Instagram: gabriell_braga
```

The PreviewPanel slides over the inspector and has two layers:

1. **Simulation (always available, fully client-side).** `ChatSimulator`
   walks the draft sequentially and renders a WhatsApp- or Instagram-styled
   conversation (bubbles per message step, delay chips between bubbles,
   condition/branch annotations, CRM/system actions as event rows). Clearly
   labeled "Simulação — nada foi enviado".
2. **Real/dry execution against the backend (existing endpoints only):**
   - Campaign: `campaigns.execute` with `dryRun` toggle, `phones`,
     `allowedPhone` set to the WhatsApp test identity (server-side allowlist),
     `maxRecipients: 1`. The current backend procedure does not accept
     Instagram handles, so the PreviewPanel blocks Instagram backend tests and
     points the operator to simulation / dispatch guardrails instead of faking
     support.
   - Automation: `automations.trigger` with `dryRun` toggle + `phone` +
     `allowedPhone` (WhatsApp-shaped only; for Instagram the panel offers
     simulation only and says why).
   - Errors from the API render in an inline error block with the message.

What is mocked vs real: the conversation rendering is always a simulation
(the backend has no transcript-producing test endpoint); the dry-run calls
are real backend validations (no sends); non-dry calls create real jobs for
the allowlisted destination only.

## 11. Campaigns & Automations hub screens

- Card grids (not 2009 admin tables): name, channel chip, status chip
  (copper=running/active, neutral=draft, warn=paused…), step/action count,
  trigger summary (automations), evergreen tag, `updatedAt` via `TimeAgo`,
  primary CTA "Abrir no builder", secondary quick actions (pausar/retomar,
  duplicar → builder prefilled).
- Search input + status/channel filter chips (client-side; lists are small).
- KPI strip (total, ativas, rascunhos) using `StatCard`.
- Empty state with a single CTA "Criar campanha/automação"; loading uses
  skeleton cards; error uses `ErrorState` with retry.
- The campaigns hub keeps the operational consoles as tabs ("Disparo",
  "Destinatários") reusing the existing, working panels
  (`CampaignsDispatchPanel`, `CampaignsRecipientsPanel`) and their guardrail
  wiring (ready → confirm text → tick). These consoles are send-critical
  (IC-1/IC-2 adjacent) and were rebuilt visually by the rebrand wave already;
  replacing their logic is explicitly out of scope.

## 12. Testing strategy

- Domain logic is covered by `apps/web/src/flow-builder/lib/*.test.ts`
  (drafts, validation, build mapping, CSV).
- Feature tests live under `apps/web/src/features/flow-builder/**`:
  - `config/registries.test.ts` checks contract coverage for campaign steps
    and automation actions.
  - `canvas/graph.test.ts` checks derived graph/layout behavior.
  - `preview/simulate.test.ts` checks draft → simulated transcript mapping.
- Product smokes are Playwright scripts in `tests/`:
  - `test:v210-campaigns`: campaign hub, `/campaigns/new`, validation,
    preview, recipients virtualization, dry-run without `campaign_step` jobs,
    WhatsApp print through CDP.
  - `test:v210-campaign-builder-mobile`: <900px graceful desktop notice,
    no body overflow, Axe.
  - `test:v210-flow-builders`: automation builder creation/persistence,
    chatbot dry-run with explicit canary phone, no send jobs, Axe, WhatsApp
    print through CDP.
- Repo gates used in this wave: `npm run typecheck --workspace @nuoma/web`,
  `npm run lint --workspace @nuoma/web`, targeted Vitest, the three V2.10
  smokes above and `npm run build --workspace @nuoma/web`.

## 13. Known assumptions

1. Node positions are not persisted; auto-layout is canonical (see §8). If
   free positioning is ever wanted, persist under `metadata.builderLayout`
   without contract changes.
2. `attendants` picker: `notify_attendant` keeps a numeric attendant id field
   (nullable) — no dedicated attendant directory UI in this wave.
3. Media steps select from existing `media.list` assets; uploading new media
   from inside the builder is deferred (upload exists in Inbox composer).
4. Real Instagram test sends are not exposed by `automations.trigger` (phone
   only); campaign IG real execution is blocked server-side. The preview
   panel states this instead of hiding Instagram.
5. Campaign A/B metadata (`buildAbVariantsMetadata`) and `overlayEnabled` are
   preserved on edit but A/B authoring UI is deferred to the Chatbots/AB
   wave; existing metadata round-trips untouched.
6. The Chatbots page (rule-based, different model) is untouched by this wave.
7. `temporary_messages` is modeled as a step type in the contract, so it
   appears in the library under "Lógica" with an explanatory editor.
8. Legacy CSS blocks for the deleted monolith (`nuoma-automation-*`,
   `nuoma-campaign-immersive`, builder-specific classes in
   `styles/legacy.css`) are removed only when grep shows zero remaining
   consumers; shared ops-console classes stay until those panels migrate.

## 14. Libraries

**No new dependencies were added.** Everything needed was already installed
and justified by prior decisions:

| Library                          | Why                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `@xyflow/react` 12               | Canvas/nodes/edges/minimap — locked product decision (ManyChat-style canvas) |
| `framer-motion`                  | Panel slide-overs, inspector switches, node mount transitions                |
| Radix primitives via `@nuoma/ui` | Accessible dialogs, selects, switches, tabs, tooltips                        |
| `lucide-react`                   | Icon set (step/action icons)                                                 |
| `@tanstack/react-query` + `trpc` | Server state, mutations, invalidation                                        |
| `@tanstack/react-router`         | New builder routes with params                                               |
| Tailwind 3 + `@nuoma/ui` preset  | Token-driven styling (Carvão & Cobre)                                        |

Explicitly rejected: Zustand (reducer suffices, §9), DnD Kit (XYFlow's own
DnD covers library→canvas and node drag), React Hook Form/Zod-on-client
(inspector forms are small controlled fields; contract validation already
runs through the domain lib + server zod), Sonner (`@nuoma/ui` toast exists).

## 15. Manual smoke checklist (post-implementation)

1. `/campaigns` renders cards for seeded campaigns; filters work; empty/error
   states reachable (filter to zero / kill API).
2. Create campaign: add text + image + delay-conditioned steps via library
   click, drag-insert via edge "+", reorder by dragging, branch by connecting
   handles; inspector validates required fields; save creates draft; reload →
   edit round-trips identical contract payload.
3. Preview: WhatsApp simulation shows bubbles + delay chips with default
   number 5531982066263; dry execute returns plan; real execute only when
   scheduled/running and confirms.
4. Automation: trigger/condition editing, all 9 action types creatable and
   savable; dry trigger with default phone works; publish confirm sets
   active.
5. Responsive: ≥1280px full three-column; 1024–1279 library collapses to icon
   rail; <900px builder shows a graceful "use desktop" notice; hub screens
   stack to single column without breakage.
6. IC-1/IC-2 untouched: no worker/audio code in the diff; send paths only
   called through pre-existing endpoints.
