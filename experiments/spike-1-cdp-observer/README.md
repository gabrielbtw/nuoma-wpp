# Spike 1 — CDP Observer Latency

Validate that a CDP-injected `MutationObserver` can capture real WhatsApp Web messages with end-to-end latency p50<1s, p95<3s, zero loss/duplicate in a sample of 50 messages.

Spec: [`docs/architecture/V2_SPIKES.md#spike-1`](../../docs/architecture/V2_SPIKES.md).

## Files

- `package.json` — npm scripts (`smoke`, `run`, `analyze`, `typecheck`).
- `tsconfig.json` — strict TS, ESM.
- `observer-script.js` — injected into the WhatsApp tab via CDP; captures message mutations, visible snapshots, sidebar fingerprints, complete timestamp fields and backfill probes.
- `run.ts` — Node side: connects CDP, registers `__nuomaSync` binding, persists events to `spike.db` + `metrics.jsonl`.
- `analyze.ts` — reads `spike.db`, computes p50/p95/duplicates/coverage plus snapshot/sidebar/backfill counters, prints verdict.
- `spike.db` — local SQLite (gitignored). **Never touches the V1 production DB.**
- `metrics.jsonl` — raw event stream, append-only (gitignored).

## Prerequisites

1. V1 worker running with CDP exposed (default `127.0.0.1:9222`):
   ```bash
   pm2 status wa-worker     # should be online
   curl -s http://127.0.0.1:9222/json/version | jq .Browser
   ```
2. WhatsApp Web authenticated (you can see chats in the controlled Chromium).
3. Node 22 + `tsx` available (or run with Bun if installed).

## Run procedure

### Smoke test (handshake only, ~30s)

Confirms the spike can find the WA tab, attach CDP, register the binding, inject the observer, receive `observer-ready`, emit one visible-message snapshot cycle and scan the sidebar. No real messages required.

```bash
cd experiments/spike-1-cdp-observer
npm install
npm run smoke
```

Expected output ends with `smoke success — observer, snapshot and sidebar scan are live`. Exit code 0.

If you see `cannot reach CDP` → V1 worker is not running. Start it.
If you see `no web.whatsapp.com tab open` → open WhatsApp Web in the controlled Chromium.
If you see `smoke timeout — observer never reported ready` → DOM selectors moved; inspect `metrics.jsonl` for `observer-failed` payload.

### Full capture (3-30 minutes, real messages)

```bash
cd experiments/spike-1-cdp-observer
TARGET_PHONE=5531982066263 npm run run
```

While the harness runs, **manually generate outbound test messages only in the target WhatsApp conversation (`5531982066263`)**. Passive capture from other numbers is allowed and should remain enabled; the restriction is only about not sending active test messages to other contacts.

Backfill probes are disabled by default during live-message tests so the harness does not scroll away from the bottom of the conversation. To test the historical probe path explicitly:

```bash
ENABLE_BACKFILL_PROBE=1 TARGET_PHONE=5531982066263 npm run run
```

G.1a behavior expected during the run:

- when a chat is open, the harness emits `message-snapshot` for visible bubbles before relying on new mutations;
- if WhatsApp replaces `#main`, the observer reattaches and emits another visible snapshot;
- `#pane-side` emits `conversation-row-snapshot` / `conversation-row-changed` based on row fingerprint, even when unread stays zero;
- if `ENABLE_BACKFILL_PROBE=1` and all visible bubbles are already known in the observer session, the harness emits `backfill-probe-requested` and scrolls one short window upward;
- each message event includes timestamp fields when available: `messageDate`, `messageTime`, `messageHour`, `messageMinute`, `messageSecond`, `messageDayOfWeek`;
- if `messageSecond` is missing, run/consult the message-details probe. If details also exposes only minute precision, V2 follows ADR 0012: keep `messageSecond` empty, store `observed_at_utc`, and derive a synthetic intra-minute timeline second from DOM order;
- unread is only a priority signal. It is never used as proof that a conversation is complete.

For approval, capture at least 50 message events, with the controlled outbound sample distributed across:

- 10 plain text incoming (from another phone)
- 10 plain text outgoing (sent from V1 UI)
- 5 image messages
- 5 audio messages
- 5 forwarded messages
- 5 messages with same body in same minute (dedup stress)
- 5 edited messages
- 5 deleted-by-sender messages

Press `Ctrl+C` when done. Events are flushed to `spike.db`.

### Analyze

```bash
npm run analyze            # default expects 50 messages
npm run analyze -- --expected=80
```

Output ends with a verdict:

- **VERDE** — approves ADR 0007, unblocks V2.6 in roadmap.
- **AMARELO** — investigate before approving.
- **VERMELHO** — sync engine V2 needs rethinking; don't create `nuoma-wpp-v2/`.

### Message details timestamp probe

Use this when `analyze` shows `missing second > 0`. It opens the target chat, picks the last visible bubble, tries to open the message menu/details panel, and records the visible detail text.

```bash
TARGET_PHONE=5531982066263 npm run inspect-details
npm run analyze -- --expected=1
```

Expected result:

- If `Message detail probes` shows at least one probe with seconds, implement details fallback in the sync path.
- If the menu/details text only exposes `HH:mm`, document the limitation and use `observed_at_utc` for second-level capture time.
- This probe does not send messages and does not modify chat settings.

Observed on 2026-04-30 against `5531982066263`: the real `Dados da mensagem` drawer exposed `Hoje às 11:21` and `data-pre-plain-text` exposed `[11:21, 30/04/2026]`, with no seconds. Current V2 decision: keep WhatsApp display time with explicit minute precision, store `observed_at_utc` for second-level audit/capture time, and derive `wa_inferred_second` for timeline sorting inside the same minute: newest message `59`, previous `58`, previous `57`, etc.

## Fail-safe guarantees

- The harness opens the V1 SQLite **only via** the read-only path mentioned in the migration spike — actually this spike doesn't touch any production DB.
- All writes go to `experiments/spike-1-cdp-observer/spike.db` (gitignored).
- The observer script is feature-detected: if WA's DOM changes, it emits `observer-failed` instead of crashing.
- `Ctrl+C` flushes JSONL and DB cleanly.

## Cleanup

```bash
rm -f spike.db spike.db-shm spike.db-wal metrics.jsonl
```

## Reporting

After analyzing, write the conclusion to `REPORT.md` (template below) and include the file in the PR for the V2 decision.

```md
# Spike 1 — Report

## Verdict
verde | amarelo | vermelho

## Numbers
- Messages captured: X / 50
- Latency p50: X ms
- Latency p95: X ms
- Duplicates: X
- Observer errors: X
- Visible snapshots: X
- Sidebar row changes: X
- Backfill probes requested/skipped: X/Y
- Unknown direction: X/Y
- Empty body: X/Y
- Missing date/time/second: X/Y

## Edge cases
| Edge case | Captured? |
|---|---|
| Forwarded | yes/no |
| Edited | yes/no |
| Deleted | yes/no |
| Same body same minute | yes/no |

## Notes
…
```
