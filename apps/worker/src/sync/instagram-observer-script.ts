import { SYNC_BINDING_NAME } from "./events.js";

export function createInstagramObserverScript(bindingName = SYNC_BINDING_NAME): string {
  return `
(() => {
  const bindingName = ${JSON.stringify(bindingName)};
  const observerVersion = "2026-04-30.1";
  const source = "instagram-web";
  const channel = "instagram";
  const seen = new Set();

  if (window.__nuomaInstagramSyncObserverInstalled) {
    return;
  }
  window.__nuomaInstagramSyncObserverInstalled = true;

  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function emit(event) {
    const binding = window[bindingName];
    if (typeof binding !== "function") {
      return;
    }
    binding(JSON.stringify({
      source,
      observedAtUtc: nowIso(),
      ...event,
    }));
  }

  function activeThread() {
    const title =
      cleanText(document.querySelector("header a[role='link']") && document.querySelector("header a[role='link']").textContent) ||
      cleanText(location.pathname.split("/").filter(Boolean).pop()) ||
      "instagram";
    return {
      channel,
      externalThreadId: title,
      title,
      phone: null,
      unreadCount: 0,
      fingerprint: null,
    };
  }

  function collectMessages() {
    const thread = activeThread();
    return Array.from(document.querySelectorAll("[role='row'], [data-visualcompletion='ignore-dynamic']"))
      .filter((node) => node instanceof HTMLElement)
      .map((node, index) => {
        const body = cleanText(node.textContent);
        if (!body) {
          return null;
        }
        const externalId = node.getAttribute("data-id") || "ig-" + thread.externalThreadId + "-" + index + "-" + body.slice(0, 32);
        return {
          thread,
          message: {
            externalId,
            direction: "inbound",
            contentType: "text",
            status: "received",
            body,
            displayedAtText: null,
            waDisplayedAt: null,
            timestampPrecision: "unknown",
            messageSecond: null,
            waInferredSecond: null,
            observedAtUtc: nowIso(),
            raw: {
              domIndex: index,
              observerVersion,
            },
          },
        };
      })
      .filter(Boolean);
  }

  function scan() {
    for (const entry of collectMessages()) {
      if (seen.has(entry.message.externalId)) {
        continue;
      }
      seen.add(entry.message.externalId);
      emit({
        type: "message-added",
        thread: entry.thread,
        message: entry.message,
      });
    }
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__nuomaInstagramSyncObserverVersion = observerVersion;
  window.__nuomaInstagramSyncScan = scan;
  queueMicrotask(scan);
})();
`;
}
