// Injected via CDP Page.addScriptToEvaluateOnNewDocument (and Runtime.evaluate
// for the already-loaded page). Runs in browser context (window/DOM available).
//
// Captures WhatsApp Web message bubbles and pushes events to Node via the
// `__nuomaSync` binding (registered server-side by run.ts).
//
// G.1a scope:
// - Snapshot visible bubbles when a chat opens.
// - Reattach observers when WhatsApp replaces #main or #pane-side.
// - Track sidebar fingerprints, not only unread badges.
// - Attempt a small older-message probe when visible bubbles are already known.

(function nuomaInstallObserver() {
  if (typeof window.__nuomaCleanupObserver === "function") {
    try {
      window.__nuomaCleanupObserver("reinstall");
    } catch {
      /* best effort cleanup */
    }
  }

  if (window.__nuomaInstalled) {
    return;
  }
  window.__nuomaInstalled = true;

  const VERSION = "spike-1-0.1.0";
  const MAX_BACKFILL_PROBES_PER_CHAT = 3;
  const ENABLE_BACKFILL_PROBES = window.__nuomaEnableBackfillProbes === true;

  const state = {
    mainTarget: null,
    paneTarget: null,
    mainObserver: null,
    paneObserver: null,
    rootObserver: null,
    readyEmitted: false,
    attachScheduled: false,
    paneScanTimer: null,
    visibleSnapshotTimer: null,
    initialSnapshotDone: false,
    bootstrapTimer: null,
  };

  const seenDataIds = new Set();
  const rowStates = new Map();
  const backfillProbeCounts = new Map();
  const selfAuthorNames = new Set(["voce", "você", "you", "nuoma"]);

  window.__nuomaInstalledVersion = VERSION;
  window.__nuomaCleanupObserver = function nuomaCleanupObserver(reason) {
    try {
      if (state.mainObserver) state.mainObserver.disconnect();
      if (state.paneObserver) state.paneObserver.disconnect();
      if (state.rootObserver) state.rootObserver.disconnect();
      if (state.paneScanTimer) window.clearTimeout(state.paneScanTimer);
      if (state.visibleSnapshotTimer) window.clearTimeout(state.visibleSnapshotTimer);
      if (state.bootstrapTimer) window.clearInterval(state.bootstrapTimer);
      post("observer-cleaned-up", { reason: reason || "manual", version: VERSION });
    } finally {
      window.__nuomaInstalled = false;
      window.__nuomaInstalledVersion = null;
      window.__nuomaCleanupObserver = null;
    }
  };

  function post(type, payload) {
    try {
      if (typeof window.__nuomaSync !== "function") return;
      window.__nuomaSync(JSON.stringify({ type, payload, ts: Date.now(), v: VERSION }));
    } catch (err) {
      try {
        window.__nuomaSync(
          JSON.stringify({
            type: "observer-error",
            payload: { message: String(err && err.message ? err.message : err) },
            ts: Date.now(),
            v: VERSION,
          })
        );
      } catch {
        /* binding not yet ready */
      }
    }
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u200e/g, "")
      .replace(/\u200f/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortHash(value) {
    const str = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function uniqueBy(items, keyFn) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
      const key = keyFn(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function queryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function pickDataId(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.getAttribute) {
      const direct = el.getAttribute("data-id");
      if (direct) return direct;
    }
    const inner = el.querySelector?.("[data-id]");
    if (inner && inner.getAttribute) return inner.getAttribute("data-id");
    return null;
  }

  function findDataElements(root) {
    if (!root || root.nodeType !== 1) return [];
    const elements = [];
    if (root.matches?.("[data-id]")) elements.push(root);
    elements.push(...queryAll(root, "[data-id]"));
    return uniqueBy(elements, (el) => el.getAttribute?.("data-id"));
  }

  function findDataElementForMutation(target) {
    if (!target || target.nodeType !== 1) return null;
    if (target.matches?.("[data-id]")) return target;
    return target.closest?.("[data-id]") || target.querySelector?.("[data-id]") || null;
  }

  function findBubbleRoot(dataEl) {
    if (!dataEl || dataEl.nodeType !== 1) return dataEl;
    return (
      dataEl.closest?.(
        "[class*='message-in'], [class*='message-out'], [data-testid='msg-container'], [role='row']"
      ) || dataEl
    );
  }

  function readPrePlainTextAuthor(preText) {
    const match = normalizeText(preText).match(/^\[[^\]]+\]\s*([^:]+):/);
    return match ? normalizeText(match[1]) : null;
  }

  function normalizeAuthorKey(author) {
    return normalizeText(author).toLowerCase();
  }

  function readDirection(dataId, bubbleRoot, dataEl, preText, deliveryStatus) {
    if (dataId && typeof dataId === "string") {
      const head = dataId.split("_")[0];
      if (head === "true") return "outgoing";
      if (head === "false") return "incoming";
      if (/"fromMe"\s*:\s*true/.test(dataId)) return "outgoing";
      if (/"fromMe"\s*:\s*false/.test(dataId)) return "incoming";
    }

    if (deliveryStatus) return "outgoing";
    if (
      bubbleRoot?.querySelector?.(
        "[data-icon='msg-time'], [data-icon='msg-check'], [data-icon='msg-dblcheck'], [data-icon='msg-dblcheck-ack']"
      )
    ) {
      return "outgoing";
    }

    const classRoot =
      dataEl?.closest?.("[class*='message-in'], [class*='message-out']") ||
      bubbleRoot?.closest?.("[class*='message-in'], [class*='message-out']");
    const className = normalizeText(classRoot?.className || bubbleRoot?.className || "");
    if (/\bmessage-out\b/.test(className)) return "outgoing";
    if (/\bmessage-in\b/.test(className)) return "incoming";

    const author = readPrePlainTextAuthor(preText || readPrePlainText(bubbleRoot || dataEl));
    const authorKey = normalizeAuthorKey(author);
    if (authorKey && selfAuthorNames.has(authorKey)) return "outgoing";
    if (authorKey) return "incoming";

    // In 1:1 WhatsApp Web bubbles, outgoing messages expose delivery icons.
    // If no outgoing evidence exists but the node is still a message bubble, treat it as incoming.
    return dataId ? "incoming" : "unknown";
  }

  function readChatId(dataId) {
    if (!dataId || typeof dataId !== "string") return null;
    const split = dataId.split("_");
    if ((split[0] === "true" || split[0] === "false") && split[1]) return split[1];
    const match = dataId.match(/(\d+@(?:c\.us|g\.us))/);
    return match ? match[1] : null;
  }

  function readPrePlainText(el) {
    if (!el || el.nodeType !== 1) return null;
    const direct = el.getAttribute?.("data-pre-plain-text");
    if (direct) return direct;
    const node = el.querySelector?.("[data-pre-plain-text]");
    return node ? node.getAttribute("data-pre-plain-text") : null;
  }

  function resolveRelativeDateLabel(dateLabel) {
    const label = normalizeText(dateLabel).toLowerCase();
    const today = new Date();
    if (label === "hoje" || label === "today") {
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    }
    if (label === "ontem" || label === "yesterday") {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    return null;
  }

  function parseMessageTimestamp(preText) {
    const raw = normalizeText(preText);
    if (!raw) {
      return {
        messageTimestampRaw: null,
        messageTime: null,
        messageHour: null,
        messageMinute: null,
        messageSecond: null,
        messageDate: null,
        messageDayOfWeek: null,
        messageTimestampPrecision: "missing",
        messageTimestampSource: "missing",
      };
    }

    const match = raw.match(/\[\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*,\s*([^\]]+?)\s*\]/);
    if (!match) {
      return {
        messageTimestampRaw: raw,
        messageTime: null,
        messageHour: null,
        messageMinute: null,
        messageSecond: null,
        messageDate: null,
        messageDayOfWeek: null,
        messageTimestampPrecision: "missing",
        messageTimestampSource: "unparsed-pre-plain-text",
      };
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = match[3] == null ? null : Number(match[3]);
    const time =
      second == null
        ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
        : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
    const dateLabel = normalizeText(match[4]);
    const relativeDate = resolveRelativeDateLabel(dateLabel);
    if (relativeDate) {
      return {
        messageTimestampRaw: raw,
        messageTime: time,
        messageHour: hour,
        messageMinute: minute,
        messageSecond: second,
        messageDate: relativeDate,
        messageDayOfWeek: dateLabel,
        messageTimestampPrecision: second == null ? "minute" : "second",
        messageTimestampSource: "relative-date-pre-plain-text",
      };
    }

    const numericDate = dateLabel.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (!numericDate) {
      return {
        messageTimestampRaw: raw,
        messageTime: time,
        messageHour: hour,
        messageMinute: minute,
        messageSecond: second,
        messageDate: dateLabel,
        messageDayOfWeek: null,
        messageTimestampPrecision: second == null ? "minute" : "second",
        messageTimestampSource: "date-label-pre-plain-text",
      };
    }

    const day = Number(numericDate[1]);
    const month = Number(numericDate[2]);
    const yearRaw = Number(numericDate[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const date = new Date(year, month - 1, day);
    const valid =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;
    const isoDate = valid
      ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : dateLabel;
    const dayOfWeek = valid
      ? new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(date)
      : null;

    return {
      messageTimestampRaw: raw,
      messageTime: time,
      messageHour: hour,
      messageMinute: minute,
      messageSecond: second,
      messageDate: isoDate,
      messageDayOfWeek: dayOfWeek,
      messageTimestampPrecision: second == null ? "minute" : "second",
      messageTimestampSource: "pre-plain-text",
    };
  }

  function isDateSeparatorText(text) {
    return /^(hoje|ontem|today|yesterday|domingo|segunda-feira|terça-feira|terca-feira|quarta-feira|quinta-feira|sexta-feira|sábado|sabado|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})$/i.test(
      normalizeText(text)
    );
  }

  function readNearestDateLabel(dataEl) {
    const main = state.mainTarget || document.querySelector("#main");
    if (!main || !dataEl?.getBoundingClientRect) return null;
    const targetRect = dataEl.getBoundingClientRect();
    const candidates = queryAll(main, "span, div")
      .map((el) => {
        const text = normalizeText(el.textContent);
        const rect = el.getBoundingClientRect();
        return { text, rect };
      })
      .filter((item) => (
        item.text &&
        item.text.length <= 24 &&
        isDateSeparatorText(item.text) &&
        item.rect.width > 0 &&
        item.rect.height > 0 &&
        item.rect.y <= targetRect.y
      ))
      .sort((a, b) => b.rect.y - a.rect.y);
    return candidates[0]?.text || null;
  }

  function parseDomTimestampFallback(bubbleRoot, dataEl) {
    const rawText = normalizeText(bubbleRoot?.textContent || dataEl?.textContent || "");
    const times = rawText.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || [];
    if (times.length === 0) return parseMessageTimestamp(null);
    const dateLabel = readNearestDateLabel(dataEl) || "Hoje";
    const fallbackPreText = `[${times[times.length - 1]}, ${dateLabel}]`;
    const parsed = parseMessageTimestamp(fallbackPreText);
    return {
      ...parsed,
      messageTimestampSource:
        parsed.messageTimestampPrecision === "missing"
          ? "missing"
          : "visible-time-and-nearest-date-separator",
    };
  }

  function cleanFallbackBody(text) {
    return normalizeText(text)
      .replace(/(?:[01]?\d|2[0-3]):[0-5]\d/g, "")
      .replace(/\bmsg-(?:time|check|dblcheck|dblcheck-ack)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readBodyText(bubbleRoot) {
    if (!bubbleRoot || bubbleRoot.nodeType !== 1) return "";

    const selectable = uniqueBy(
      queryAll(bubbleRoot, "span.selectable-text"),
      (node) => normalizeText(node.textContent)
    )
      .map((node) => normalizeText(node.textContent))
      .filter(Boolean);
    if (selectable.length > 0) return selectable.join("\n").slice(0, 1000);

    const copyable = uniqueBy(
      queryAll(bubbleRoot, "[data-pre-plain-text] [dir='ltr'], [data-pre-plain-text] [dir='auto']"),
      (node) => normalizeText(node.textContent)
    )
      .map((node) => normalizeText(node.textContent))
      .filter(Boolean);
    if (copyable.length > 0) return copyable.join("\n").slice(0, 1000);

    const mediaLabel =
      bubbleRoot.querySelector?.("img[alt]")?.getAttribute("alt") ||
      bubbleRoot.querySelector?.("video[aria-label], audio[aria-label], canvas[aria-label]")?.getAttribute("aria-label") ||
      null;
    if (mediaLabel) return normalizeText(mediaLabel).slice(0, 1000);

    const clone = bubbleRoot.cloneNode(true);
    queryAll(clone, "svg, [data-icon], time, [aria-hidden='true']").forEach((node) => node.remove());
    return cleanFallbackBody(clone.textContent).slice(0, 1000);
  }

  function readDeliveryStatus(bubbleRoot) {
    const iconNode = bubbleRoot?.querySelector?.(
      "[data-icon='msg-time'], [data-icon='msg-check'], [data-icon='msg-dblcheck'], [data-icon='msg-dblcheck-ack']"
    );
    if (!iconNode) return null;
    const icon = iconNode.getAttribute("data-icon");
    if (icon === "msg-time") return "pending";
    if (icon === "msg-check") return "sent";
    if (icon === "msg-dblcheck") return "delivered";
    if (icon === "msg-dblcheck-ack") return "read";
    return null;
  }

  function readActiveChat() {
    const header = document.querySelector("#main header");
    if (!header) return { activeChatHeaderId: null, activeChatTitle: null };
    const titleNode = header.querySelector("[title]");
    const title =
      normalizeText(titleNode?.getAttribute("title")) ||
      normalizeText(header.getAttribute("aria-label")) ||
      normalizeText(header.textContent).slice(0, 180) ||
      null;
    return {
      activeChatHeaderId: header.getAttribute("data-id") || null,
      activeChatTitle: title,
    };
  }

  function emitForDataElement(dataEl, eventType, extra) {
    const dataId = pickDataId(dataEl);
    if (!dataId) return;
    const bubbleRoot = findBubbleRoot(dataEl);
    const activeChat = readActiveChat();
    const preText = readPrePlainText(bubbleRoot) || readPrePlainText(dataEl);
    const preTextTimestamp = parseMessageTimestamp(preText);
    const timestamp =
      preTextTimestamp.messageTimestampPrecision === "missing"
        ? parseDomTimestampFallback(bubbleRoot, dataEl)
        : preTextTimestamp;
    const deliveryStatus = readDeliveryStatus(bubbleRoot);
    const direction = readDirection(dataId, bubbleRoot, dataEl, preText, deliveryStatus);
    const preTextAuthor = readPrePlainTextAuthor(preText);
    if (direction === "outgoing" && preTextAuthor) {
      selfAuthorNames.add(normalizeAuthorKey(preTextAuthor));
    }

    post(eventType, {
      dataId,
      chatId: readChatId(dataId),
      direction,
      preText,
      body: readBodyText(bubbleRoot),
      deliveryStatus,
      activeChatHeaderId: activeChat.activeChatHeaderId,
      activeChatTitle: activeChat.activeChatTitle,
      ...timestamp,
      ...(extra || {}),
    });
  }

  function emitVisibleSnapshot(source) {
    const target = state.mainTarget || document.querySelector("#main");
    if (!target) return { total: 0, knownBefore: 0, newInObserver: 0 };

    const dataElements = findDataElements(target);
    let knownBefore = 0;
    let newInObserver = 0;
    const isInitialSnapshot = !state.initialSnapshotDone;

    dataElements.forEach((dataEl, index) => {
      const dataId = pickDataId(dataEl);
      if (!dataId) return;
      const alreadyKnown = seenDataIds.has(dataId);
      if (alreadyKnown) knownBefore += 1;
      else {
        seenDataIds.add(dataId);
        newInObserver += 1;
      }
      const eventType = !isInitialSnapshot && !alreadyKnown ? "message-added" : "message-snapshot";
      emitForDataElement(dataEl, eventType, {
        source,
        snapshotIndex: index,
        snapshotTotal: dataElements.length,
        alreadyKnownInObserver: alreadyKnown,
      });
    });

    state.initialSnapshotDone = true;
    const stats = { source, total: dataElements.length, knownBefore, newInObserver };
    post("message-snapshot-complete", stats);

    if (ENABLE_BACKFILL_PROBES && dataElements.length > 0 && newInObserver === 0) {
      requestBackfillProbe(source, stats);
    }

    return stats;
  }

  function scheduleVisibleSnapshot(source, delayMs) {
    if (state.visibleSnapshotTimer) window.clearTimeout(state.visibleSnapshotTimer);
    state.visibleSnapshotTimer = window.setTimeout(() => {
      state.visibleSnapshotTimer = null;
      emitVisibleSnapshot(source);
    }, delayMs ?? 250);
  }

  function findScrollableMessagePane() {
    const main = state.mainTarget || document.querySelector("#main");
    if (!main) return null;
    const candidates = queryAll(main, "div")
      .filter((el) => el.scrollHeight > el.clientHeight + 100)
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
    return candidates[0] || null;
  }

  function requestBackfillProbe(source, snapshotStats) {
    const activeChat = readActiveChat();
    const chatKey =
      activeChat.activeChatHeaderId ||
      activeChat.activeChatTitle ||
      pickDataId((state.mainTarget || document).querySelector?.("[data-id]")) ||
      "unknown-chat";
    const current = backfillProbeCounts.get(chatKey) || 0;
    if (current >= MAX_BACKFILL_PROBES_PER_CHAT) {
      post("backfill-probe-skipped", {
        source,
        reason: "probe limit reached",
        chatKey,
        count: current,
        snapshotStats,
      });
      return;
    }

    const scroller = findScrollableMessagePane();
    if (!scroller) {
      post("backfill-probe-skipped", {
        source,
        reason: "message scroller not found",
        chatKey,
        count: current,
        snapshotStats,
      });
      return;
    }

    const before = scroller.scrollTop;
    const delta = Math.max(320, Math.floor(scroller.clientHeight * 0.85));
    scroller.scrollTop = Math.max(0, before - delta);
    backfillProbeCounts.set(chatKey, current + 1);

    post("backfill-probe-requested", {
      source,
      chatKey,
      count: current + 1,
      beforeScrollTop: before,
      afterScrollTop: scroller.scrollTop,
      delta,
      snapshotStats,
    });

    window.setTimeout(() => emitVisibleSnapshot("backfill-after-scroll"), 1200);
  }

  function processAddedNode(node) {
    for (const dataEl of findDataElements(node)) {
      const dataId = pickDataId(dataEl);
      if (!dataId) continue;
      if (seenDataIds.has(dataId)) {
        emitForDataElement(dataEl, "message-updated", { source: "mutation-rerender" });
        continue;
      }
      seenDataIds.add(dataId);
      emitForDataElement(dataEl, "message-added", { source: "mutation" });
    }
  }

  function processRemovedNode(node) {
    for (const dataEl of findDataElements(node)) {
      const dataId = pickDataId(dataEl);
      if (!dataId) continue;
      post("message-removed", { dataId, chatId: readChatId(dataId) });
    }
  }

  function attachMainObserver() {
    const target =
      document.querySelector("#main") ||
      document.querySelector("[data-testid='conversation-panel-messages']");
    if (!target) return false;
    if (state.mainTarget === target && state.mainObserver) return true;

    if (state.mainObserver) state.mainObserver.disconnect();
    state.mainTarget = target;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(processAddedNode);
          mutation.removedNodes.forEach(processRemovedNode);
          scheduleVisibleSnapshot("main-mutation-scan", 350);
        } else if (mutation.type === "attributes") {
          const dataEl = findDataElementForMutation(mutation.target);
          if (dataEl) {
            if (mutation.attributeName === "data-id") {
              processAddedNode(dataEl);
            } else {
              emitForDataElement(dataEl, "delivery-status-changed", { source: "attribute" });
            }
          }
        }
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-id", "data-icon", "aria-label", "data-pre-plain-text", "class"],
    });

    state.mainObserver = observer;
    post("main-observer-attached", {
      visibleDataIds: findDataElements(target).length,
      activeChat: readActiveChat(),
    });
    window.setTimeout(() => emitVisibleSnapshot("main-attached"), 250);
    return true;
  }

  function readUnreadCount(row) {
    const ariaValues = [row.getAttribute?.("aria-label")]
      .concat(queryAll(row, "[aria-label]").map((node) => node.getAttribute("aria-label")))
      .filter(Boolean)
      .map(normalizeText);
    const unreadAria = ariaValues.find((value) => /unread|n[aã]o lida|nao lida/i.test(value));
    if (unreadAria) {
      const match = unreadAria.match(/(\d+)/);
      return match ? Number(match[1]) : 1;
    }

    const numericBadge = queryAll(row, "span, div")
      .map((node) => normalizeText(node.textContent))
      .find((value) => /^\d{1,3}$/.test(value));
    return numericBadge ? Number(numericBadge) : 0;
  }

  function readConversationRow(row, rowIndex) {
    const titleNode = queryAll(row, "[title]")
      .map((node) => normalizeText(node.getAttribute("title")))
      .find((value) => value && !/^\d{1,2}:\d{2}$/.test(value));
    const aria = normalizeText(row.getAttribute?.("aria-label"));
    const text = normalizeText(row.textContent).slice(0, 500);
    const sidebarTime = (text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/) || [null])[0];
    const unreadCount = readUnreadCount(row);
    const title = titleNode || aria.split(",")[0] || null;
    const preview = text
      .replace(title || "", "")
      .replace(sidebarTime || "", "")
      .replace(String(unreadCount || ""), "")
      .trim()
      .slice(0, 220);
    const rowKey = title || aria || text.slice(0, 120) || `row-${rowIndex}`;
    const fingerprintSource = JSON.stringify({
      title,
      preview,
      sidebarTime,
      unreadCount,
      aria,
    });

    return {
      rowKey: shortHash(rowKey),
      rowIndex,
      title,
      preview,
      sidebarTime,
      unreadCount,
      aria,
      fingerprint: shortHash(fingerprintSource),
      textHash: shortHash(text),
    };
  }

  function findConversationRows(target) {
    const candidates = [
      ...queryAll(target, "[role='row']"),
      ...queryAll(target, "[role='listitem']"),
      ...queryAll(target, "[data-testid='cell-frame-container']"),
    ];
    const rows = candidates.length > 0 ? candidates : Array.from(target.children || []);
    return uniqueBy(
      rows.filter((row) => normalizeText(row.textContent).length > 0),
      (row) => row
    ).slice(0, 80);
  }

  function scanPaneRows(source) {
    const target = state.paneTarget || document.querySelector("#pane-side");
    if (!target) return;

    const rows = findConversationRows(target);
    let changed = 0;
    rows.forEach((row, rowIndex) => {
      const rowPayload = readConversationRow(row, rowIndex);
      const previous = rowStates.get(rowPayload.rowKey);
      const isInitial = !previous;
      const hasChanged = !previous || previous.fingerprint !== rowPayload.fingerprint;
      if (!hasChanged) return;

      rowStates.set(rowPayload.rowKey, rowPayload);
      changed += 1;

      post(isInitial ? "conversation-row-snapshot" : "conversation-row-changed", {
        ...rowPayload,
        previousFingerprint: previous?.fingerprint || null,
        previousUnreadCount: previous?.unreadCount ?? null,
        source,
      });

      if (previous && previous.unreadCount !== rowPayload.unreadCount) {
        post("conversation-unread-changed", {
          ...rowPayload,
          previousUnreadCount: previous.unreadCount,
          source,
        });
      }
    });

    post("conversation-sidebar-scan-complete", {
      source,
      rows: rows.length,
      changed,
    });
  }

  function schedulePaneScan(source, delayMs) {
    if (state.paneScanTimer) window.clearTimeout(state.paneScanTimer);
    state.paneScanTimer = window.setTimeout(() => {
      state.paneScanTimer = null;
      scanPaneRows(source);
    }, delayMs ?? 250);
  }

  function attachPaneObserver() {
    const target = document.querySelector("#pane-side");
    if (!target) return false;
    if (state.paneTarget === target && state.paneObserver) return true;

    if (state.paneObserver) state.paneObserver.disconnect();
    state.paneTarget = target;

    const observer = new MutationObserver(() => {
      schedulePaneScan("mutation", 250);
    });
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "class"],
      characterData: true,
    });

    state.paneObserver = observer;
    post("pane-observer-attached", { rows: findConversationRows(target).length });
    schedulePaneScan("pane-attached", 0);
    return true;
  }

  function maybeEmitReady(mainOk, paneOk, startedAt) {
    if (!mainOk || !paneOk || state.readyEmitted) return;
    state.readyEmitted = true;
    if (state.bootstrapTimer) window.clearInterval(state.bootstrapTimer);
    post("observer-ready", {
      mainOk,
      paneOk,
      elapsedMs: Date.now() - startedAt,
      version: VERSION,
    });
  }

  function attachAll(startedAt) {
    const mainOk = attachMainObserver();
    const paneOk = attachPaneObserver();
    maybeEmitReady(mainOk, paneOk, startedAt);
    return { mainOk, paneOk };
  }

  function scheduleAttach(startedAt) {
    if (state.attachScheduled) return;
    state.attachScheduled = true;
    window.setTimeout(() => {
      state.attachScheduled = false;
      attachAll(startedAt);
    }, 150);
  }

  const startedAt = Date.now();
  state.rootObserver = new MutationObserver(() => scheduleAttach(startedAt));
  const rootTarget = document.documentElement || document.body;
  if (rootTarget) {
    state.rootObserver.observe(rootTarget, {
      childList: true,
      subtree: true,
    });
  }

  state.bootstrapTimer = window.setInterval(() => {
    const result = attachAll(startedAt);
    if (!state.readyEmitted && Date.now() - startedAt > 60_000) {
      window.clearInterval(state.bootstrapTimer);
      post("observer-failed", {
        mainOk: result.mainOk,
        paneOk: result.paneOk,
        reason: "selectors not found within 60s",
        version: VERSION,
      });
    }
  }, 500);

  attachAll(startedAt);
  post("observer-installing", { version: VERSION });
})();
