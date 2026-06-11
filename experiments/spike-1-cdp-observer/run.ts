/**
 * Spike 1 — CDP observer harness.
 *
 * Connects to the V1 worker's Chromium via CDP at 127.0.0.1:9222, attaches
 * to the WhatsApp Web target, registers a `__nuomaSync` Runtime binding,
 * and injects observer-script.js. All events arrive via Runtime.bindingCalled.
 *
 * Each event is appended to metrics.jsonl AND mirrored into spike.db so we
 * can query latency stats with SQL afterwards.
 *
 * Usage:
 *   bun run run.ts          # full run, blocks until SIGINT
 *   bun run run.ts --smoke  # smoke test: handshake + observer-ready, then exit
 *
 * Read-only against V1: we never write to ../../storage/database/nuoma.db.
 */
import CDP from "chrome-remote-interface";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const HOST = process.env.CDP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.CDP_PORT ?? 9222);
const TARGET_PHONE = process.env.TARGET_PHONE?.replace(/\D/g, "") ?? "";
const ENABLE_BACKFILL_PROBE = process.env.ENABLE_BACKFILL_PROBE === "1";
const DETAIL_PROBE_DIRECTION = process.env.DETAIL_PROBE_DIRECTION ?? "outgoing";
const WA_HOST_PATTERN = /web\.whatsapp\.com/;
const SMOKE = process.argv.includes("--smoke");
const INSPECT_DETAILS = process.argv.includes("--inspect-details");
const SMOKE_TIMEOUT_MS = 30_000;

const DB_PATH = path.resolve(import.meta.dirname, "spike.db");
const JSONL_PATH = path.resolve(import.meta.dirname, "metrics.jsonl");
const SCRIPT_PATH = path.resolve(import.meta.dirname, "observer-script.js");

interface ObserverEnvelope {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  v?: string;
}

interface MessagePayload {
  dataId?: string;
  chatId?: string | null;
  direction?: string;
  body?: string;
  preText?: string | null;
  deliveryStatus?: string | null;
  activeChatHeaderId?: string | null;
  activeChatTitle?: string | null;
  messageTimestampRaw?: string | null;
  messageTime?: string | null;
  messageHour?: number | null;
  messageMinute?: number | null;
  messageSecond?: number | null;
  messageDate?: string | null;
  messageDayOfWeek?: string | null;
  messageTimestampPrecision?: string | null;
  messageTimestampSource?: string | null;
}

interface SidebarPayload {
  rowKey?: string;
  title?: string | null;
  preview?: string | null;
  sidebarTime?: string | null;
  unreadCount?: number | null;
  fingerprint?: string | null;
}

interface DetailProbeResult {
  ok: boolean;
  stage: string;
  dataId?: string | null;
  bubbleText?: string | null;
  preText?: string | null;
  detailText?: string | null;
  detailRows?: Array<{ title: string | null; secondary: string | null; text: string }>;
  detailPanels?: Array<{ testid: string | null; text: string }>;
  menuText?: string | null;
  timestampCandidates?: string[];
  hasSeconds?: boolean;
  probeDirection?: string;
  reason?: string;
}

const MESSAGE_EVENT_TYPES = new Set([
  "message-added",
  "message-snapshot",
  "message-updated",
  "message-removed",
  "delivery-status-changed",
]);

const SIDEBAR_EVENT_TYPES = new Set([
  "conversation-row-snapshot",
  "conversation-row-changed",
  "conversation-unread-changed",
  "conversation-sidebar-scan-complete",
]);

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...extra, at: new Date().toISOString() });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS captured (
      data_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      direction TEXT,
      body TEXT,
      pre_text TEXT,
      delivery_status TEXT,
      chat_id TEXT,
      active_chat_header_id TEXT,
      active_chat_title TEXT,
      message_timestamp_raw TEXT,
      message_time TEXT,
      message_hour INTEGER,
      message_minute INTEGER,
      message_second INTEGER,
      message_date TEXT,
      message_day_of_week TEXT,
      message_timestamp_precision TEXT,
      message_timestamp_source TEXT,
      dom_ts INTEGER NOT NULL,
      db_ts INTEGER NOT NULL,
      payload_json TEXT,
      PRIMARY KEY (data_id, event_type, dom_ts)
    );
    CREATE INDEX IF NOT EXISTS idx_captured_db_ts ON captured(db_ts);
    CREATE INDEX IF NOT EXISTS idx_captured_event ON captured(event_type);

    CREATE TABLE IF NOT EXISTS lifecycle_events (
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS observer_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      dom_ts INTEGER NOT NULL,
      db_ts INTEGER NOT NULL,
      payload_json TEXT,
      version TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_observer_events_type ON observer_events(type);
    CREATE INDEX IF NOT EXISTS idx_observer_events_db_ts ON observer_events(db_ts);

    CREATE TABLE IF NOT EXISTS sidebar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      row_key TEXT,
      title TEXT,
      preview TEXT,
      sidebar_time TEXT,
      unread_count INTEGER,
      fingerprint TEXT,
      dom_ts INTEGER NOT NULL,
      db_ts INTEGER NOT NULL,
      payload_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sidebar_events_type ON sidebar_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_sidebar_events_row ON sidebar_events(row_key);

    CREATE TABLE IF NOT EXISTS message_detail_probes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_id TEXT,
      ok INTEGER NOT NULL,
      stage TEXT NOT NULL,
      has_seconds INTEGER NOT NULL,
      bubble_text TEXT,
      pre_text TEXT,
      detail_text TEXT,
      menu_text TEXT,
      timestamp_candidates_json TEXT,
      payload_json TEXT,
      probed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_detail_probes_data_id ON message_detail_probes(data_id);
  `);
  ensureColumn(db, "captured", "chat_id", "TEXT");
  ensureColumn(db, "captured", "active_chat_title", "TEXT");
  ensureColumn(db, "captured", "message_timestamp_raw", "TEXT");
  ensureColumn(db, "captured", "message_time", "TEXT");
  ensureColumn(db, "captured", "message_hour", "INTEGER");
  ensureColumn(db, "captured", "message_minute", "INTEGER");
  ensureColumn(db, "captured", "message_second", "INTEGER");
  ensureColumn(db, "captured", "message_date", "TEXT");
  ensureColumn(db, "captured", "message_day_of_week", "TEXT");
  ensureColumn(db, "captured", "message_timestamp_precision", "TEXT");
  ensureColumn(db, "captured", "message_timestamp_source", "TEXT");
  return db;
}

async function findWhatsAppTarget() {
  const targets = await CDP.List({ host: HOST, port: PORT });
  return targets.find(
    (t) => t.type === "page" && WA_HOST_PATTERN.test(t.url)
  );
}

async function readOpenChatState(Runtime: CDP.Client["Runtime"]) {
  const opened = await Runtime.evaluate({
    expression: `(() => ({
      url: location.href,
      header: document.querySelector('#main header')?.textContent?.replace(/\\s+/g, ' ').slice(0, 160) || null,
      bubbleCount: document.querySelectorAll('#main [data-id]').length,
      paneOk: Boolean(document.querySelector('#pane-side'))
    }))()`,
    returnByValue: true,
  });
  return opened.result.value as Record<string, unknown>;
}

async function waitForOpenChat(Runtime: CDP.Client["Runtime"], timeoutMs: number) {
  const startedAt = Date.now();
  let lastState: Record<string, unknown> = {};
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readOpenChatState(Runtime);
    if (lastState.paneOk && (lastState.header || Number(lastState.bubbleCount ?? 0) > 0)) {
      return lastState;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return lastState;
}

async function scrollOpenChatToBottom(Runtime: CDP.Client["Runtime"]) {
  await Runtime.evaluate({
    expression: `(() => {
      const main = document.querySelector('#main');
      if (!main) return { scrolled: false, reason: 'no-main' };
      const scroller = Array.from(main.querySelectorAll('div'))
        .filter((el) => el.scrollHeight > el.clientHeight + 100)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!scroller) return { scrolled: false, reason: 'no-scroller' };
      scroller.scrollTop = scroller.scrollHeight;
      return { scrolled: true, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
    })()`,
    returnByValue: true,
  });
}

async function waitForMessageHydration(Runtime: CDP.Client["Runtime"], minCount: number, timeoutMs: number) {
  const startedAt = Date.now();
  let lastCount = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluateJson<{ count: number }>(
      Runtime,
      `(() => ({ count: document.querySelectorAll('#main [data-id]').length }))()`,
    );
    lastCount = state.count;
    if (state.count >= minCount) return state.count;
    await sleep(750);
  }
  return lastCount;
}

async function evaluateJson<T>(Runtime: CDP.Client["Runtime"], expression: string): Promise<T> {
  const result = await Runtime.evaluate({
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value as T;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function findTimestampCandidates(text: string | null | undefined): string[] {
  const value = String(text || "");
  return Array.from(
    new Set(
      value.match(/\b\d{1,2}:\d{2}:\d{2}\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g) || []
    )
  );
}

function hasSecondPrecision(text: string | null | undefined): boolean {
  return /\b\d{1,2}:\d{2}:\d{2}\b/.test(String(text || ""));
}

async function dispatchEscape(Input: CDP.Client["Input"]) {
  await Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}

async function clickPoint(Input: CDP.Client["Input"], x: number, y: number, button: "left" | "right" = "left") {
  const buttons = button === "right" ? 2 : 1;
  await Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
  await Input.dispatchMouseEvent({ type: "mousePressed", x, y, button, buttons, clickCount: 1 });
  await Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
}

async function inspectMessageDetails(
  Runtime: CDP.Client["Runtime"],
  Input: CDP.Client["Input"],
): Promise<DetailProbeResult> {
  await Runtime.evaluate({
    expression: `document.querySelector('[data-testid="drawer-right"] button[aria-label="Fechar"]')?.click()`,
    awaitPromise: false,
  });
  await sleep(350);

  const base = await evaluateJson<DetailProbeResult & { rect?: { x: number; y: number; width: number; height: number } }>(
    Runtime,
    `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const nodes = Array.from(document.querySelectorAll('#main [data-id]'))
        .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
      const candidates = nodes.map((node) => {
        const bubble = node.closest("[class*='message-in'], [class*='message-out'], [data-testid='msg-container']") || node;
        const text = normalize(bubble.textContent);
        const className = normalize(bubble.className);
        const outgoing = Boolean(
          bubble.querySelector("[data-icon='msg-time'], [data-icon='msg-check'], [data-icon='msg-dblcheck'], [data-icon='msg-dblcheck-ack']")
        ) || /message-out|msg-time|msg-check|msg-dblcheck|msg-dblcheck-ack/i.test(className + ' ' + text);
        return { node, bubble, outgoing };
      });
      const reversed = candidates.slice().reverse();
      const probeDirection = ${JSON.stringify(DETAIL_PROBE_DIRECTION)};
      const picked =
        probeDirection === 'outgoing'
          ? reversed.find((item) => item.outgoing)
          : probeDirection === 'incoming'
            ? reversed.find((item) => !item.outgoing)
            : reversed[0];
      const node = picked ? picked.node : null;
      if (!node) return { ok: false, stage: 'find-message', reason: 'no visible matching #main [data-id]', probeDirection };
      const bubble = node.closest("[class*='message-in'], [class*='message-out'], [data-testid='msg-container']") || node;
      const clickTarget = bubble.querySelector("[data-testid='msg-container']") || bubble;
      const preNode = bubble.querySelector('[data-pre-plain-text]') || node.querySelector('[data-pre-plain-text]');
      const rect = clickTarget.getBoundingClientRect();
      return {
        ok: true,
        stage: 'found-message',
        dataId: node.getAttribute('data-id'),
        bubbleText: normalize(bubble.textContent).slice(0, 1200),
        preText: preNode ? preNode.getAttribute('data-pre-plain-text') : null,
        probeDirection,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    })()`
  );

  if (!base.ok || !base.rect) {
    return base;
  }

  const centerX = Math.round(base.rect.x + base.rect.width / 2);
  const centerY = Math.round(base.rect.y + base.rect.height / 2);
  await Input.dispatchMouseEvent({ type: "mouseMoved", x: centerX, y: centerY });
  await sleep(350);

  const menuButton = await evaluateJson<{ ok: boolean; label?: string | null; reason?: string; x?: number; y?: number }>(
    Runtime,
    `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const targetDataId = ${JSON.stringify(base.dataId ?? null)};
      const nodes = Array.from(document.querySelectorAll('#main [data-id]'))
        .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
      const node = targetDataId
        ? nodes.find((item) => item.getAttribute('data-id') === targetDataId)
        : nodes[nodes.length - 1];
      const bubble = node?.closest("[class*='message-in'], [class*='message-out'], [data-testid='msg-container']") || node;
      const clickTarget = bubble?.querySelector("[data-testid='msg-container']") || bubble;
      if (!bubble) return { ok: false, reason: 'bubble gone' };
      const selectors = [
        "[data-testid='down-context']",
        "[data-icon='down-context']",
        "[data-testid='msg-down']",
        "[aria-label*='Menu']",
        "[aria-label*='menu']",
        "button"
      ];
      const candidates = selectors.flatMap((selector) => Array.from(clickTarget.querySelectorAll(selector)));
      const visible = candidates
        .map((el) => ({ el, rect: el.getBoundingClientRect(), label: normalize(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent) }))
        .filter((item) => item.rect.width > 0 && item.rect.height > 0);
      const target = visible.find((item) => /menu|mais|more|opções|opcoes|down/i.test(item.label)) || visible[visible.length - 1];
      if (!target) return { ok: false, reason: 'no visible menu button' };
      return {
        ok: true,
        label: target.label || null,
        x: Math.round(target.rect.x + target.rect.width / 2),
        y: Math.round(target.rect.y + target.rect.height / 2)
      };
    })()`
  );

  if (menuButton.ok && typeof menuButton.x === "number" && typeof menuButton.y === "number") {
    await clickPoint(Input, menuButton.x, menuButton.y, "left");
  } else {
    await clickPoint(Input, centerX, centerY, "right");
  }

  await sleep(500);

  const menuState = await evaluateJson<{ menuText: string | null; clicked: boolean; clickedText?: string | null }>(
    Runtime,
    `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const menuRoots = Array.from(document.querySelectorAll("[role='application'] [role='menu'], [role='menu'], [data-testid*='menu'], div[aria-label*='Menu'], div[aria-label*='menu']"))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && normalize(el.textContent).length > 0;
        });
      const menu = menuRoots[menuRoots.length - 1] || null;
      const menuText = menu ? normalize(menu.textContent).slice(0, 2000) : null;
      const items = Array.from(document.querySelectorAll("[role='menuitem'], li, button, div[aria-label], span"))
        .map((el) => ({ el, rect: el.getBoundingClientRect(), text: normalize(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent) }))
        .filter((item) => item.rect.width > 0 && item.rect.height > 0 && item.text);
      const target = items.find((item) => /dados da mensagem|informações da mensagem|informacoes da mensagem|message info/i.test(item.text));
      if (!target) return { menuText, clicked: false };
      target.el.click();
      return { menuText, clicked: true, clickedText: target.text };
    })()`
  );

  await sleep(menuState.clicked ? 900 : 250);

  const detailState = await evaluateJson<{
    detailText: string | null;
    detailRows: Array<{ title: string | null; secondary: string | null; text: string }>;
    detailPanels: Array<{ testid: string | null; text: string }>;
    activeText: string;
  }>(
    Runtime,
    `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const attrText = (root) => Array.from(root.querySelectorAll('[title], [aria-label], [data-pre-plain-text], time, [datetime]'))
        .flatMap((el) => [
          el.getAttribute('title'),
          el.getAttribute('aria-label'),
          el.getAttribute('data-pre-plain-text'),
          el.getAttribute('datetime'),
        ])
        .filter(Boolean)
        .map(normalize)
        .join(' ');
      const visibleRoots = Array.from(document.querySelectorAll("[data-testid='drawer-right'], [role='dialog'], aside, [data-testid*='msg-info'], [data-testid*='message-info']"))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const exactDrawer = visibleRoots.find((el) => (
        el.getAttribute('data-testid') === 'drawer-right' &&
        /dados da mensagem|message info/i.test(normalize(el.textContent))
      ));
      const root = exactDrawer || visibleRoots.find((el) => /lida|entregue|enviada|recebida|read|delivered|sent|message info|dados/i.test(normalize(el.textContent))) || null;
      const rows = root
        ? Array.from(root.querySelectorAll("[data-testid='kept-by-info'], [data-testid='msg-info-title'], [data-testid='cell-frame-secondary']"))
          .map((el) => {
            const container = el.closest("[data-testid='kept-by-info']") || el;
            return {
              title: normalize(container.querySelector("[data-testid='msg-info-title']")?.textContent) || null,
              secondary: normalize(container.querySelector("[data-testid='cell-frame-secondary']")?.textContent) || null,
              text: normalize(container.textContent),
            };
          })
          .filter((row, index, items) => row.text && items.findIndex((item) => item.text === row.text) === index)
        : [];
      const detailPanels = visibleRoots
        .map((el) => ({ testid: el.getAttribute('data-testid'), text: normalize(el.textContent).slice(0, 1200) }))
        .filter((item) => item.text)
        .slice(-5);
      const detailText = root ? normalize([root.textContent, attrText(root)].join(' ')) : null;
      return {
        detailText: detailText ? detailText.slice(0, 4000) : null,
        detailRows: rows,
        detailPanels,
        activeText: normalize(document.body.textContent).slice(0, 4000)
      };
    })()`
  );

  const combined = [base.preText, base.bubbleText, menuState.menuText, detailState.detailText].filter(Boolean).join("\n");
  return {
    ok: true,
    stage: menuState.clicked ? "details-clicked" : "menu-opened-no-details-item",
    dataId: base.dataId ?? null,
    bubbleText: base.bubbleText ?? null,
    preText: base.preText ?? null,
    menuText: menuState.menuText ?? null,
    detailText: detailState.detailText ?? null,
    detailRows: detailState.detailRows,
    detailPanels: detailState.detailPanels,
    timestampCandidates: findTimestampCandidates(combined),
    hasSeconds: hasSecondPrecision(combined),
    probeDirection: base.probeDirection ?? DETAIL_PROBE_DIRECTION,
    reason: menuState.clicked ? undefined : "no details/message info menu item found",
  };
}

async function main() {
  log("info", "spike-1 starting", {
    host: HOST,
    port: PORT,
    smoke: SMOKE,
    inspectDetails: INSPECT_DETAILS,
    detailProbeDirection: DETAIL_PROBE_DIRECTION,
    targetPhone: TARGET_PHONE || null,
    enableBackfillProbe: ENABLE_BACKFILL_PROBE,
  });

  // 1. Discover WhatsApp tab
  let target;
  try {
    target = await findWhatsAppTarget();
  } catch (err) {
    log("error", "cannot reach CDP — is the V1 worker running?", {
      detail: String((err as Error).message),
    });
    process.exit(2);
  }
  if (!target) {
    log("error", "no web.whatsapp.com tab open in the controlled Chromium", {
      hint: "Ensure V1 wa-worker is running and authenticated",
    });
    process.exit(3);
  }
  log("info", "found WhatsApp target", { id: target.id, url: target.url });

  // 2. Connect to the page target
  const client = await CDP({ host: HOST, port: PORT, target });
  const { Input, Page, Runtime } = client;

  await Runtime.enable();
  await Page.enable();

  if (TARGET_PHONE) {
    const targetUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(TARGET_PHONE)}`;
    log("info", "opening target chat", { targetPhone: TARGET_PHONE, targetUrl });
    await Page.navigate({ url: targetUrl });
    const opened = await waitForOpenChat(Runtime, 20_000);
    await scrollOpenChatToBottom(Runtime);
    const hydratedBubbles = await waitForMessageHydration(Runtime, INSPECT_DETAILS ? 5 : 1, INSPECT_DETAILS ? 8_000 : 2_000);
    log("info", "target chat open check", { ...opened, hydratedBubbles });
  }

  // 3. Open DB + JSONL
  const db = ensureDb();
  const insertCaptured = db.prepare(`
    INSERT OR IGNORE INTO captured
      (data_id, event_type, direction, body, pre_text, delivery_status,
       chat_id, active_chat_header_id, active_chat_title, message_timestamp_raw,
       message_time, message_hour, message_minute, message_second, message_date,
       message_day_of_week, message_timestamp_precision, message_timestamp_source,
       dom_ts, db_ts, payload_json)
    VALUES (@dataId, @eventType, @direction, @body, @preText, @deliveryStatus,
            @chatId, @activeChatHeaderId, @activeChatTitle, @messageTimestampRaw,
            @messageTime, @messageHour, @messageMinute, @messageSecond, @messageDate,
            @messageDayOfWeek, @messageTimestampPrecision, @messageTimestampSource,
            @domTs, @dbTs, @payloadJson)
  `);
  const insertLifecycle = db.prepare(`
    INSERT INTO lifecycle_events (ts, type, payload_json) VALUES (?, ?, ?)
  `);
  const insertObserverEvent = db.prepare(`
    INSERT INTO observer_events (type, dom_ts, db_ts, payload_json, version)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertSidebarEvent = db.prepare(`
    INSERT INTO sidebar_events
      (event_type, row_key, title, preview, sidebar_time, unread_count,
       fingerprint, dom_ts, db_ts, payload_json)
    VALUES (@eventType, @rowKey, @title, @preview, @sidebarTime, @unreadCount,
            @fingerprint, @domTs, @dbTs, @payloadJson)
  `);
  const insertDetailProbe = db.prepare(`
    INSERT INTO message_detail_probes
      (data_id, ok, stage, has_seconds, bubble_text, pre_text, detail_text,
       menu_text, timestamp_candidates_json, payload_json, probed_at)
    VALUES (@dataId, @ok, @stage, @hasSeconds, @bubbleText, @preText,
            @detailText, @menuText, @timestampCandidatesJson, @payloadJson, @probedAt)
  `);
  const jsonl = fs.createWriteStream(JSONL_PATH, { flags: "a" });

  let observerReady = false;
  const smokeState = {
    mainAttached: false,
    paneAttached: false,
    snapshotComplete: false,
    sidebarScanComplete: false,
  };
  let smokeTimer: NodeJS.Timeout | undefined;

  function cleanup(code: number) {
    try {
      if (smokeTimer) clearTimeout(smokeTimer);
      jsonl.end();
      db.close();
      void client.close();
    } finally {
      process.exit(code);
    }
  }

  if (INSPECT_DETAILS) {
    const probedAt = Date.now();
    const result = await inspectMessageDetails(Runtime, Input);
    const payloadJson = JSON.stringify(result);
    jsonl.write(JSON.stringify({
      type: "message-detail-probe",
      payload: result,
      ts: probedAt,
      dbTs: Date.now(),
      v: "spike-1-0.1.0",
    }) + "\n");
    insertObserverEvent.run("message-detail-probe", probedAt, Date.now(), payloadJson, "spike-1-0.1.0");
    insertLifecycle.run(probedAt, "message-detail-probe", payloadJson);
    insertDetailProbe.run({
      dataId: result.dataId ?? null,
      ok: result.ok ? 1 : 0,
      stage: result.stage,
      hasSeconds: result.hasSeconds ? 1 : 0,
      bubbleText: result.bubbleText ?? null,
      preText: result.preText ?? null,
      detailText: result.detailText ?? null,
      menuText: result.menuText ?? null,
      timestampCandidatesJson: JSON.stringify(result.timestampCandidates ?? []),
      payloadJson,
      probedAt,
    });
    log(result.ok ? "info" : "warn", "message-detail-probe", {
      stage: result.stage,
      dataId: result.dataId ?? null,
      hasSeconds: result.hasSeconds ?? false,
      probeDirection: result.probeDirection ?? DETAIL_PROBE_DIRECTION,
      timestampCandidates: result.timestampCandidates ?? [],
      reason: result.reason ?? null,
    });
    cleanup(result.ok ? 0 : 6);
    return;
  }

  // 4. Register __nuomaSync binding
  await Runtime.addBinding({ name: "__nuomaSync" });

  function maybeFinishSmoke() {
    if (!SMOKE || !observerReady) return;
    if (
      smokeState.mainAttached &&
      smokeState.paneAttached &&
      smokeState.snapshotComplete &&
      smokeState.sidebarScanComplete
    ) {
      log("info", "smoke success — observer, snapshot and sidebar scan are live");
      cleanup(0);
    }
  }

  Runtime.bindingCalled(({ name, payload }) => {
    if (name !== "__nuomaSync") return;
    let env: ObserverEnvelope;
    try {
      env = JSON.parse(payload);
    } catch (err) {
      log("warn", "invalid observer envelope", { payload });
      return;
    }
    const dbTs = Date.now();
    const payloadJson = JSON.stringify(env.payload);

    // Mirror to JSONL (canonical raw stream)
    jsonl.write(JSON.stringify({ ...env, dbTs }) + "\n");
    insertObserverEvent.run(env.type, env.ts, dbTs, payloadJson, env.v ?? null);

    if (env.type === "observer-ready") {
      observerReady = true;
      log("info", "observer-ready", env.payload);
      insertLifecycle.run(env.ts, env.type, payloadJson);
      maybeFinishSmoke();
      return;
    }
    if (
      env.type === "observer-installing" ||
      env.type === "observer-failed" ||
      env.type === "observer-error"
    ) {
      insertLifecycle.run(env.ts, env.type, payloadJson);
      log(env.type === "observer-installing" ? "info" : "warn", env.type, env.payload);
      return;
    }

    if (env.type === "main-observer-attached" || env.type === "pane-observer-attached") {
      if (env.type === "main-observer-attached") smokeState.mainAttached = true;
      if (env.type === "pane-observer-attached") smokeState.paneAttached = true;
      insertLifecycle.run(env.ts, env.type, payloadJson);
      log("info", env.type, env.payload);
      maybeFinishSmoke();
      return;
    }

    if (env.type === "message-snapshot-complete") {
      smokeState.snapshotComplete = true;
      insertLifecycle.run(env.ts, env.type, payloadJson);
      maybeFinishSmoke();
      return;
    }

    if (env.type === "backfill-probe-requested" || env.type === "backfill-probe-skipped") {
      insertLifecycle.run(env.ts, env.type, payloadJson);
      log(env.type === "backfill-probe-requested" ? "info" : "warn", env.type, env.payload);
      return;
    }

    if (SIDEBAR_EVENT_TYPES.has(env.type)) {
      const p = env.payload as SidebarPayload;
      insertSidebarEvent.run({
        eventType: env.type,
        rowKey: p.rowKey ?? null,
        title: p.title ?? null,
        preview: p.preview ?? null,
        sidebarTime: p.sidebarTime ?? null,
        unreadCount: typeof p.unreadCount === "number" ? p.unreadCount : null,
        fingerprint: p.fingerprint ?? null,
        domTs: env.ts,
        dbTs,
        payloadJson,
      });
      if (env.type === "conversation-unread-changed" || env.type === "conversation-row-changed") {
        log("info", env.type, env.payload);
      }
      if (env.type === "conversation-sidebar-scan-complete") {
        smokeState.sidebarScanComplete = true;
        maybeFinishSmoke();
      }
      return;
    }

    if (!MESSAGE_EVENT_TYPES.has(env.type)) return;

    const p = env.payload as MessagePayload;
    if (!p.dataId) return;
    const result = insertCaptured.run({
      dataId: p.dataId,
      eventType: env.type,
      direction: p.direction ?? null,
      body: p.body ?? null,
      preText: p.preText ?? null,
      deliveryStatus: p.deliveryStatus ?? null,
      chatId: p.chatId ?? null,
      activeChatHeaderId: p.activeChatHeaderId ?? null,
      activeChatTitle: p.activeChatTitle ?? null,
      messageTimestampRaw: p.messageTimestampRaw ?? null,
      messageTime: p.messageTime ?? null,
      messageHour: typeof p.messageHour === "number" ? p.messageHour : null,
      messageMinute: typeof p.messageMinute === "number" ? p.messageMinute : null,
      messageSecond: typeof p.messageSecond === "number" ? p.messageSecond : null,
      messageDate: p.messageDate ?? null,
      messageDayOfWeek: p.messageDayOfWeek ?? null,
      messageTimestampPrecision: p.messageTimestampPrecision ?? null,
      messageTimestampSource: p.messageTimestampSource ?? null,
      domTs: env.ts,
      dbTs,
      payloadJson,
    });
    if (result.changes === 0 && env.type === "message-added") {
      // duplicate — increments a counter via lifecycle log
      insertLifecycle.run(dbTs, "duplicate-blocked", JSON.stringify({ dataId: p.dataId }));
    }
  });

  // 5. Inject script
  const observerSrc = fs.readFileSync(SCRIPT_PATH, "utf8");
  await Page.addScriptToEvaluateOnNewDocument({ source: observerSrc });
  await Runtime.evaluate({
    expression: `(() => {
      try {
        if (typeof window.__nuomaCleanupObserver === "function") {
          window.__nuomaCleanupObserver("runner reinject");
        }
      } catch {}
      window.__nuomaInstalled = false;
      window.__nuomaInstalledVersion = null;
      window.__nuomaEnableBackfillProbes = ${ENABLE_BACKFILL_PROBE ? "true" : "false"};
    })()`,
    awaitPromise: false,
  });
  // Page may already be loaded; evaluate immediately too.
  const evalRes = await Runtime.evaluate({ expression: observerSrc, awaitPromise: false });
  if (evalRes.exceptionDetails) {
    log("error", "failed to inject observer", {
      detail: evalRes.exceptionDetails.text,
    });
    cleanup(4);
    return;
  }
  log("info", "observer injected, waiting for ready…");

  // Smoke timeout: if no observer-ready within 30s, fail.
  if (SMOKE) {
    smokeTimer = setTimeout(() => {
      log("error", "smoke timeout — observer never reported ready", {
        timeoutMs: SMOKE_TIMEOUT_MS,
      });
      cleanup(5);
    }, SMOKE_TIMEOUT_MS);
  }

  process.on("SIGINT", () => {
    log("info", "SIGINT — flushing and exiting");
    cleanup(0);
  });
  process.on("SIGTERM", () => {
    log("info", "SIGTERM — flushing and exiting");
    cleanup(0);
  });

  if (!SMOKE) {
    log("info", "spike-1 capture running. Send messages to your WPP. Ctrl+C to stop.");
  }
}

main().catch((err) => {
  log("error", "fatal", { detail: String((err as Error)?.stack ?? err) });
  process.exit(1);
});
