---
name: wa-cdp-sync-spike
description: Run Spike 1 — connect CDP to running Chromium, inject a MutationObserver into WhatsApp Web, capture real messages with data-id, measure end-to-end latency (DOM event → DB insert), report p50/p95 + duplicate/loss counts. Use when validating sync engine assumption before V2.
user_invocable: true
---

# /wa-cdp-sync-spike — CDP observer latency spike

You are running **Spike 1** from [`docs/architecture/V2_SPIKES.md`](../../docs/architecture/V2_SPIKES.md). Goal: prove a CDP-injected MutationObserver can capture real WhatsApp messages with end-to-end latency p50<1s, p95<3s, zero duplicate, zero loss in a sample of 50 messages.

## Boundaries

- **Read-only against V1 DB**: NEVER write to `storage/database/nuoma.db`. Use a temporary SQLite file in `experiments/spike-1-cdp-observer/`.
- **Don't disable V1 sync polling**: it stays running. The spike runs in parallel.
- **Don't refactor worker.ts**: cherry-pick only what's needed.
- **Don't claim success without 50 messages measured**.

## Workflow

### 1. Setup

```bash
mkdir -p experiments/spike-1-cdp-observer
cd experiments/spike-1-cdp-observer
```

Files to create:
- `package.json` — minimal deps: `chrome-remote-interface`, `better-sqlite3`, `tsx`.
- `observer-script.js` — string injected via CDP, runs in browser context.
- `run.ts` — Node side: connects CDP, injects script, listens to bindings, writes to temp DB + jsonl.
- `analyze.ts` — reads jsonl, computes p50/p95, dup count, loss count.
- `REPORT.md` — final report.

### 2. Verify Chromium is running with CDP

V1 worker exposes CDP on `127.0.0.1:9222`. Confirm:

```bash
curl -s http://127.0.0.1:9222/json/version | jq
```

Should return browser version + `webSocketDebuggerUrl`. If not, ensure V1 worker is up.

### 3. observer-script.js (string injected)

Approach: register `MutationObserver` on `#main` (active conversation) and `#pane-side` (chat list). For each new bubble:

- Read `data-id` attribute (canonical ID — most reliable across re-renders).
- Read `data-pre-plain-text` for direction + timestamp + author.
- Read inner text for body.
- Read `[data-icon]` of the latest status icon (msg-time / msg-check / msg-dblcheck / -ack) for delivery status.
- Push via `window.__nuomaSync(JSON.stringify({ type, payload, ts: Date.now() }))`.

### 4. run.ts (Node side)

Pseudocode:

```ts
import CDP from "chrome-remote-interface";
import Database from "better-sqlite3";
import fs from "fs";

const client = await CDP({ host: "127.0.0.1", port: 9222 });
const { Page, Runtime } = client;

await Page.enable();
await Runtime.enable();

await Runtime.addBinding({ name: "__nuomaSync" });

const observerSrc = fs.readFileSync("./observer-script.js", "utf8");
await Page.addScriptToEvaluateOnNewDocument({ source: observerSrc });

// If the page is already loaded, evaluate the script directly to start observing
await Runtime.evaluate({ expression: observerSrc });

const db = new Database("./spike.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS captured (
    data_id TEXT PRIMARY KEY,
    body TEXT,
    direction TEXT,
    dom_ts INTEGER,
    db_ts INTEGER
  )
`);

const insert = db.prepare(`
  INSERT OR IGNORE INTO captured (data_id, body, direction, dom_ts, db_ts)
  VALUES (?, ?, ?, ?, ?)
`);

const log = fs.createWriteStream("./metrics.jsonl", { flags: "a" });

Runtime.bindingCalled(({ name, payload }) => {
  if (name !== "__nuomaSync") return;
  const data = JSON.parse(payload);
  const dbTs = Date.now();
  const result = insert.run(data.payload.dataId, data.payload.body, data.payload.direction, data.ts, dbTs);
  log.write(JSON.stringify({ ...data, dbTs, inserted: result.changes > 0 }) + "\n");
});

console.log("Spike 1 running. Send messages to your WPP. Press Ctrl+C to stop.");
```

### 5. Run for at least 30 minutes, send/receive at least 50 messages

Manually send messages from another phone to the WhatsApp account, including:

- 10 plain text incoming
- 10 plain text outgoing (sent from V1)
- 5 image messages
- 5 audio messages
- 5 forwarded messages
- 5 messages with same body in same minute (dedup stress)
- 5 edited messages
- 5 deleted-by-sender messages

### 6. analyze.ts

Reads `metrics.jsonl`, computes:

- `latency = dbTs - domTs` per row.
- `p50`, `p95`, `max` of latency.
- Count of `inserted: false` rows (duplicates that hit ON CONFLICT).
- Manual cross-check: count of unique `data-id` in JSONL vs visual count on WhatsApp screen.

### 7. REPORT.md

Template:

```md
# Spike 1 Report — CDP Sync

## Summary
- Verde / Amarelo / Vermelho

## Latency
- p50: X ms
- p95: X ms
- max: X ms

## Coverage
- 50/50 messages captured? Y/N
- Duplicates (ON CONFLICT hits): X
- Losses (visual on WhatsApp but not in JSONL): X

## Edge cases
- Forwarded: ✓/✗
- Edited: ✓/✗
- Deleted: ✓/✗
- Same body same minute: ✓/✗

## Decision
- Verde → aprova ADR 0007, libera V2.6.
- Amarelo → fix edge case X, retest.
- Vermelho → recua sync engine.
```

## Anti-patterns

- DON'T write to V1 DB.
- DON'T modify `apps/wa-worker/src/worker.ts`.
- DON'T claim success based on simulated messages — must be real WhatsApp messages from another phone.
- DON'T extrapolate from 5 messages; need 50.

## Reference files

- [`docs/architecture/V2_SPIKES.md`](../../docs/architecture/V2_SPIKES.md) (Spike 1 spec)
- [`docs/adr/0007-sync-cdp-native-v2.md`](../../docs/adr/0007-sync-cdp-native-v2.md) (gated by this spike)
- V1 sync code: [`apps/wa-worker/src/worker.ts:2305+`](../../apps/wa-worker/src/worker.ts) (`extractVisibleBubbles`)

## When to invoke

User says: "rodar spike 1", "validar CDP sync", "testar latência observer", "spike de mensagem real time".
