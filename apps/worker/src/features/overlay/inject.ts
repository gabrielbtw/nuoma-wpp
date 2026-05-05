export const NUOMA_OVERLAY_VERSION = "v2.11.7-m35";
export const NUOMA_OVERLAY_ROOT_ID = "nuoma-wpp-overlay-root";
export const NUOMA_OVERLAY_FAB_TEST_ID = "nuoma-overlay-fab";
export const NUOMA_OVERLAY_PANEL_TEST_ID = "nuoma-overlay-panel";
export const NUOMA_OVERLAY_API_BINDING_NAME = "__nuomaApi";

export interface NuomaOverlayScriptOptions {
  version?: string;
}

export interface NuomaOverlayData {
  phone?: string;
  phoneSource?: string;
  title?: string;
  contact?: {
    name?: string | null;
    status?: string | null;
    primaryChannel?: string | null;
    notes?: string | null;
  } | null;
  conversations?: Array<{
    id?: number;
    channel?: string | null;
    lastPreview?: string | null;
    lastMessageAt?: string | null;
  }>;
  latestMessages?: Array<{
    body?: string | null;
    direction?: string | null;
    contentType?: string | null;
    observedAtUtc?: string | null;
  }>;
  automations?: Array<{
    id?: number;
    name?: string | null;
    category?: string | null;
    status?: string | null;
  }>;
  notes?: string | null;
  source?: string;
  apiStatus?: string;
  apiLastMethod?: string;
  apiLastError?: string | null;
  updatedAt?: string;
}

const overlayTokens = {
  bg: "oklch(0.19 0.024 198 / 0.92)",
  bgHover: "oklch(0.25 0.030 192 / 0.96)",
  fg: "oklch(0.94 0.010 175)",
  fgMuted: "oklch(0.72 0.018 182)",
  fgDim: "oklch(0.66 0.018 188)",
  cyan: "oklch(0.74 0.12 202)",
  lime: "oklch(0.80 0.15 146)",
  warning: "oklch(0.78 0.15 74)",
  surface: "oklch(0.22 0.026 196 / 0.88)",
  elevated: "oklch(0.25 0.030 192 / 0.92)",
  contour: "oklch(0.58 0.040 188 / 0.42)",
  contourMuted: "oklch(0.31 0.026 190 / 0.42)",
  shadow: "0 0 0 1px oklch(0.58 0.040 188 / 0.42), 0 18px 48px oklch(0.06 0.020 205 / 0.44)",
  glow: "0 0 0 1px oklch(0.74 0.12 202 / 0.78), 0 0 24px oklch(0.74 0.12 202 / 0.18)",
  fontFamily:
    '"Geist Variable", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

function createNuomaOverlayCss(): string {
  return `
:host {
  all: initial;
  position: absolute;
  inset-block-start: calc(50% - 22px);
  inset-inline-end: 132px;
  z-index: 2147483646;
  display: block;
  inline-size: 44px;
  block-size: 44px;
  pointer-events: none;
  color-scheme: dark;
  font-family: ${overlayTokens.fontFamily};
  letter-spacing: 0;
}

* {
  box-sizing: border-box;
}

.nuoma-fab {
  all: unset;
  box-sizing: border-box;
  inline-size: 42px;
  block-size: 42px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  color: ${overlayTokens.fg};
  background:
    radial-gradient(circle at 32% 24%, oklch(0.74 0.12 202 / 0.30), transparent 42%),
    linear-gradient(145deg, ${overlayTokens.bgHover}, ${overlayTokens.bg});
  box-shadow: ${overlayTokens.shadow};
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 140ms cubic-bezier(0.22, 1, 0.36, 1),
    background 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.nuoma-fab:hover,
.nuoma-fab:focus-visible {
  transform: translateY(-1px);
  box-shadow: ${overlayTokens.glow};
  outline: none;
}

.nuoma-fab:active {
  transform: translateY(1px) scale(0.98);
}

.nuoma-mark {
  position: relative;
  display: inline-grid;
  place-items: center;
  inline-size: 24px;
  block-size: 24px;
  border-radius: 999px;
  border: 1px solid ${overlayTokens.contour};
  color: ${overlayTokens.fg};
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}

.nuoma-mark::after {
  content: "";
  position: absolute;
  inset-block-end: -2px;
  inset-inline-end: -2px;
  inline-size: 8px;
  block-size: 8px;
  border-radius: 999px;
  background: ${overlayTokens.lime};
  box-shadow: 0 0 12px oklch(0.80 0.15 146 / 0.48);
}

:host([data-nuoma-state="open"]) .nuoma-fab {
  box-shadow: ${overlayTokens.glow};
}

.nuoma-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483644;
  display: none;
  background: transparent;
  pointer-events: auto;
}

.nuoma-panel {
  position: fixed;
  inset-block-start: 72px;
  inset-block-end: 18px;
  inset-inline-end: 18px;
  z-index: 2147483645;
  inline-size: min(392px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  color: ${overlayTokens.fg};
  background:
    radial-gradient(circle at 16% 8%, oklch(0.74 0.12 202 / 0.22), transparent 34%),
    linear-gradient(160deg, ${overlayTokens.elevated}, ${overlayTokens.bg});
  border: 1px solid ${overlayTokens.contour};
  box-shadow: ${overlayTokens.shadow};
  opacity: 0;
  transform: translateX(18px) scale(0.985);
  pointer-events: none;
  transition:
    opacity 180ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

:host([data-nuoma-state="open"]) .nuoma-backdrop {
  display: block;
}

:host([data-nuoma-state="open"]) .nuoma-panel {
  opacity: 1;
  transform: translateX(0) scale(1);
  pointer-events: auto;
}

.nuoma-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid ${overlayTokens.contourMuted};
}

.nuoma-title-wrap {
  min-width: 0;
}

.nuoma-eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${overlayTokens.cyan};
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  text-transform: uppercase;
}

.nuoma-panel-title {
  margin-block-start: 6px;
  overflow: hidden;
  color: ${overlayTokens.fg};
  font-size: 15px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nuoma-panel-subtitle {
  margin-block-start: 4px;
  color: ${overlayTokens.fgMuted};
  font-size: 12px;
  line-height: 1.35;
}

.nuoma-close {
  all: unset;
  inline-size: 34px;
  block-size: 34px;
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 999px;
  color: ${overlayTokens.fgMuted};
  background: ${overlayTokens.surface};
  border: 1px solid ${overlayTokens.contourMuted};
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.nuoma-close:hover,
.nuoma-close:focus-visible {
  color: ${overlayTokens.fg};
  border-color: ${overlayTokens.contour};
  outline: none;
}

.nuoma-panel-body {
  display: grid;
  gap: 12px;
  overflow: auto;
  padding: 14px 16px 16px;
}

.nuoma-section {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  background: ${overlayTokens.surface};
  border: 1px solid ${overlayTokens.contourMuted};
}

.nuoma-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: ${overlayTokens.fgMuted};
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  text-transform: uppercase;
}

.nuoma-pill {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  max-inline-size: 160px;
  padding: 3px 8px;
  border-radius: 999px;
  color: ${overlayTokens.lime};
  background: oklch(0.80 0.15 146 / 0.08);
  border: 1px solid oklch(0.80 0.15 146 / 0.22);
  font-size: 10px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nuoma-summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.nuoma-stat {
  min-width: 0;
  padding: 8px;
  border-radius: 10px;
  background: oklch(0.15 0.024 205 / 0.42);
  border: 1px solid ${overlayTokens.contourMuted};
}

.nuoma-stat-label {
  color: ${overlayTokens.fgDim};
  font-size: 10px;
  line-height: 1.2;
}

.nuoma-stat-value {
  margin-block-start: 4px;
  overflow: hidden;
  color: ${overlayTokens.fg};
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nuoma-list {
  display: grid;
  gap: 8px;
}

.nuoma-list-item {
  display: grid;
  gap: 4px;
  padding: 9px;
  border-radius: 11px;
  background: oklch(0.15 0.024 205 / 0.38);
  border: 1px solid ${overlayTokens.contourMuted};
}

.nuoma-list-item strong {
  overflow: hidden;
  color: ${overlayTokens.fg};
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nuoma-list-item span {
  color: ${overlayTokens.fgMuted};
  font-size: 11px;
  line-height: 1.35;
}

.nuoma-notes {
  max-block-size: 136px;
  overflow: auto;
  white-space: pre-wrap;
  color: ${overlayTokens.fg};
  font-size: 12px;
  line-height: 1.45;
}

.nuoma-empty {
  color: ${overlayTokens.fgDim};
  font-size: 12px;
  line-height: 1.45;
}

.nuoma-warning {
  color: ${overlayTokens.warning};
}

@media (max-width: 780px) {
  :host {
    inset-inline-end: 98px;
    inline-size: 40px;
    block-size: 40px;
  }

  .nuoma-fab {
    inline-size: 38px;
    block-size: 38px;
  }

  .nuoma-panel {
    inset-block-start: 64px;
    inset-block-end: 12px;
    inset-inline: 12px;
    inline-size: auto;
  }
}
`.trim();
}

export function createNuomaOverlayScript(options: NuomaOverlayScriptOptions = {}): string {
  const config = {
    version: options.version ?? NUOMA_OVERLAY_VERSION,
    rootId: NUOMA_OVERLAY_ROOT_ID,
    fabTestId: NUOMA_OVERLAY_FAB_TEST_ID,
    panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID,
    apiBindingName: NUOMA_OVERLAY_API_BINDING_NAME,
    css: createNuomaOverlayCss(),
  };

  return `
(() => {
  const config = ${JSON.stringify(config)};
  const state = window.__nuomaOverlayState || {
    observer: null,
    raf: 0,
    data: null,
    apiBridge: null,
    apiPending: {},
    apiRequestSeq: 0,
    apiNonceSeq: 0,
    apiMutationQueue: Promise.resolve(),
    apiInFlight: false,
    apiHydratedPhone: "",
    apiStatus: "offline",
    apiLastMethod: "",
    apiLastError: "",
  };

  const readOnlyApiMethods = new Set(["ping", "contactSummary"]);

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function setApiStatus(status, method, error) {
    state.apiStatus = text(status) || "offline";
    if (method !== undefined) {
      state.apiLastMethod = text(method);
    }
    if (error !== undefined) {
      state.apiLastError = text(error);
    }
    const host = document.getElementById(config.rootId);
    if (host) {
      host.setAttribute("data-nuoma-api-status", state.apiStatus);
      if (state.apiLastMethod) {
        host.setAttribute("data-nuoma-api-method", state.apiLastMethod);
      }
      if (state.apiLastError) {
        host.setAttribute("data-nuoma-api-error", state.apiLastError);
      } else {
        host.removeAttribute("data-nuoma-api-error");
      }
    }
  }

  function captureApiBridge() {
    if (state.apiBridge) {
      return state.apiBridge;
    }
    if (typeof window[config.apiBindingName] === "function") {
      state.apiBridge = window[config.apiBindingName].bind(window);
      setApiStatus("ready", "", "");
      return state.apiBridge;
    }
    setApiStatus("offline", "", "Runtime.addBinding indisponivel");
    return null;
  }

  function resolveApiRequest(id, response) {
    const requestId = text(id);
    const pending = state.apiPending && state.apiPending[requestId];
    if (!pending) {
      return false;
    }
    clearTimeout(pending.timeout);
    delete state.apiPending[requestId];
    pending.resolve(response);
    return true;
  }

  function createApiNonce(method) {
    return "m35-sec-" + Date.now() + "-" + (++state.apiNonceSeq) + "-" + text(method || "mutation");
  }

  function requiresMutationGuard(method) {
    return !readOnlyApiMethods.has(text(method));
  }

  function prepareMutation(method, params) {
    const apiMethod = text(method);
    return {
      method: apiMethod,
      params: params || {},
      nonce: createApiNonce(apiMethod),
      idempotencyKey: createApiNonce(apiMethod + "-idem"),
      confirmationRequired: true,
      preparedAt: new Date().toISOString(),
    };
  }

  function mutationGuardError(method) {
    const apiMethod = text(method);
    setApiStatus("error", apiMethod, "mutation_guard_required");
    return Promise.resolve({
      ok: false,
      error: {
        code: "mutation_guard_required",
        message: "Metodo sensivel exige prepareMutation + confirmMutation.",
      },
    });
  }

  function requestNuomaApi(method, params, options) {
    const apiMethod = text(method);
    if (requiresMutationGuard(apiMethod)) {
      const mutationIntent = options && options.mutationIntent;
      if (
        !mutationIntent ||
        mutationIntent.method !== apiMethod ||
        !text(mutationIntent.nonce) ||
        !text(mutationIntent.idempotencyKey) ||
        options.confirm !== true
      ) {
        return mutationGuardError(apiMethod);
      }
      const mutation = {
        nonce: text(mutationIntent.nonce),
        idempotencyKey: text(mutationIntent.idempotencyKey),
        confirmed: true,
        confirmationText: text(options.confirmationText),
        preparedAt: text(mutationIntent.preparedAt),
        queuedAt: new Date().toISOString(),
      };
      const queued = state.apiMutationQueue.then(() =>
        dispatchNuomaApiRequest(apiMethod, params || mutationIntent.params || {}, {
          ...(options || {}),
          mutation,
        }),
      );
      state.apiMutationQueue = queued.catch(() => undefined);
      return queued;
    }
    return dispatchNuomaApiRequest(apiMethod, params, options);
  }

  function dispatchNuomaApiRequest(method, params, options) {
    const bridge = captureApiBridge();
    const apiMethod = text(method);
    if (!bridge) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "binding_unavailable",
          message: "Runtime.addBinding nao registrou window.__nuomaApi",
        },
      });
    }
    const requestId = "m35-" + Date.now() + "-" + (++state.apiRequestSeq);
    const timeoutMs = Math.max(1000, Number(options && options.timeoutMs) || 8000);
    const payload = {
      id: requestId,
      method: apiMethod,
      params: params || {},
      mutation: options && options.mutation ? options.mutation : null,
      version: config.version,
      requestedAt: new Date().toISOString(),
    };
    state.apiLastMethod = apiMethod;
    setApiStatus("loading", apiMethod, "");
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        delete state.apiPending[requestId];
        setApiStatus("error", apiMethod, "timeout");
        resolve({
          ok: false,
          error: { code: "timeout", message: "Nuoma API binding timeout" },
        });
      }, timeoutMs);
      state.apiPending[requestId] = { resolve, timeout };
      try {
        bridge(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timeout);
        delete state.apiPending[requestId];
        setApiStatus("error", apiMethod, error && error.message ? error.message : "binding_failed");
        resolve({
          ok: false,
          error: { code: "binding_failed", message: error && error.message ? error.message : "binding failed" },
        });
      }
    }).then((response) => {
      if (response && response.ok) {
        setApiStatus("online", apiMethod, "");
      } else {
        setApiStatus("error", apiMethod, response && response.error && response.error.message);
      }
      return response;
    });
  }

  function installNuomaApi() {
    const existingManaged =
      window.__nuomaApi &&
      typeof window.__nuomaApi === "object" &&
      window.__nuomaApi.__nuomaManaged === true;
    if (existingManaged) {
      window.__nuomaApiResolve = resolveApiRequest;
      captureApiBridge();
      return;
    }
    captureApiBridge();
    window.__nuomaApiResolve = resolveApiRequest;
    window.__nuomaApi = {
      __nuomaManaged: true,
      version: config.version,
      request: requestNuomaApi,
      ping: () => requestNuomaApi("ping", {}),
      contactSummary: (input) => requestNuomaApi("contactSummary", input || {}),
      prepareMutation,
      confirmMutation: (intent, confirmationText) =>
        requestNuomaApi(intent && intent.method, intent && intent.params, {
          mutationIntent: intent,
          confirmationText,
          confirm: true,
        }),
      refreshContact: (input) =>
        requestNuomaApi("contactSummary", input || {}).then((response) => {
          if (response && response.ok && response.data && typeof window.__nuomaOverlaySetData === "function") {
            window.__nuomaOverlaySetData({
              ...response.data,
              apiStatus: "online",
              apiLastMethod: "contactSummary",
              apiLastError: null,
            });
          }
          return response;
        }),
    };
  }

  function shortDate(value) {
    if (!value) {
      return "";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return text(value);
    }
    return parsed.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function clear(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function appendText(parent, tagName, className, value) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  function normalizePhone(value) {
    const digits = text(value).replace(/\\D/g, "");
    return digits.length >= 10 && digits.length <= 16 ? digits : "";
  }

  function phoneScore(phone) {
    if (!phone) {
      return 0;
    }
    let score = 1;
    if (phone.startsWith("55")) {
      score += 6;
    }
    if (phone.length === 12 || phone.length === 13) {
      score += 4;
    }
    if (phone.length === 10 || phone.length === 11) {
      score += 2;
    }
    return score;
  }

  function phoneCandidatesFromText(value) {
    const source = text(value);
    if (!source) {
      return [];
    }
    const candidates = [];
    const addCandidate = (raw) => {
      const phone = normalizePhone(raw);
      if (phone && !candidates.includes(phone)) {
        candidates.push(phone);
      }
    };
    const explicitPlusMatches = source.match(/\\+\\d[\\d\\s().-]{8,}\\d/g) || [];
    for (const match of explicitPlusMatches) {
      addCandidate(match);
    }
    const brFormattedMatches =
      source.match(/(?:^|\\D)(55\\s?\\d{2}\\s?\\d{4,5}[-\\s]?\\d{4})(?=\\D|$)/g) || [];
    for (const match of brFormattedMatches) {
      addCandidate(match);
    }
    const contiguousMatches = source.match(/(?:^|\\D)(\\d{10,16})(?=\\D|$)/g) || [];
    for (const match of contiguousMatches) {
      addCandidate(match);
    }
    return candidates.sort((a, b) => phoneScore(b) - phoneScore(a));
  }

  function firstPhoneFromText(value) {
    return phoneCandidatesFromText(value)[0] || "";
  }

  function bestPhoneFromValues(values) {
    const candidates = [];
    for (const value of values) {
      for (const phone of phoneCandidatesFromText(value)) {
        if (!candidates.includes(phone)) {
          candidates.push(phone);
        }
      }
    }
    return candidates.sort((a, b) => phoneScore(b) - phoneScore(a))[0] || "";
  }

  function bestPhoneFromElement(element) {
    const values = [];
    if (element.getAttribute) {
      values.push(element.getAttribute("title"));
      values.push(element.getAttribute("aria-label"));
    }
    values.push(element.textContent);
    const descendants = Array.from(element.querySelectorAll("[title], [aria-label], span, div"));
    for (const node of descendants) {
      if (node.getAttribute) {
        values.push(node.getAttribute("title"));
        values.push(node.getAttribute("aria-label"));
      }
      values.push(node.textContent);
    }
    return bestPhoneFromValues(values);
  }

  function directPhoneFromText(value) {
    const phone = normalizePhone(value);
    if (phone) {
      return phone;
    }
    return phoneCandidatesFromText(value)[0] || "";
  }

  function phoneFromUrl() {
    try {
      const currentUrl = new URL(window.location.href);
      const phoneParam = currentUrl.searchParams.get("phone");
      const fromParam = normalizePhone(phoneParam);
      if (fromParam) {
        return fromParam;
      }
      return firstPhoneFromText(currentUrl.pathname);
    } catch {
      return "";
    }
  }

  function phoneFromVisibleMessageIds() {
    const root = document.querySelector("#main") || document;
    const counts = new Map();
    const nodes = Array.from(root.querySelectorAll('[data-id*="@c.us"]'));
    for (const node of nodes) {
      const dataId = text(node.getAttribute("data-id"));
      const match = dataId.match(/(?:^|_)(\\d{10,16})@c\\.us(?:_|$)/);
      const phone = normalizePhone(match && match[1]);
      if (!phone) {
        continue;
      }
      counts.set(phone, (counts.get(phone) || 0) + 1);
    }
    return (
      Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map((entry) => entry[0])[0] || ""
    );
  }

  function candidatePhoneFromElement(element) {
    return bestPhoneFromElement(element);
  }

  function rowLooksActive(row) {
    if (!row) {
      return false;
    }
    return (
      row.getAttribute("aria-selected") === "true" ||
      row.getAttribute("data-nuoma-active-chat") === "true" ||
      Boolean(row.querySelector('[aria-selected="true"], [data-testid="cell-frame-selected"]'))
    );
  }

  function phoneFromSidebarActive(title) {
    const sidebar = document.querySelector("#pane-side");
    if (!sidebar) {
      return "";
    }
    const rows = Array.from(
      sidebar.querySelectorAll(
        '[aria-selected="true"], [data-nuoma-active-chat="true"], [data-testid="cell-frame-container"], [role="listitem"]',
      ),
    );
    const normalizedTitle = text(title).toLowerCase();
    const activeRows = rows.filter(rowLooksActive);
    const titleRows = normalizedTitle
      ? rows.filter((row) => text(row.textContent).toLowerCase().includes(normalizedTitle))
      : [];
    const fallbackRows = rows.length === 1 ? rows : [];
    for (const row of [...activeRows, ...titleRows, ...fallbackRows]) {
      const phone = candidatePhoneFromElement(row);
      if (phone) {
        return phone;
      }
    }
    return "";
  }

  function findHeader() {
    return (
      document.querySelector("#main header") ||
      document.querySelector('[data-testid="conversation-header"]') ||
      document.querySelector("main header")
    );
  }

  function detectCurrentThread(header) {
    if (!header) {
      return { title: "", phone: "", phoneSource: "missing-header" };
    }

    const titleCandidate =
      header.querySelector("[title]") ||
      header.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
      header.querySelector("span");
    const title =
      text(titleCandidate && titleCandidate.getAttribute && titleCandidate.getAttribute("title")) ||
      text(titleCandidate && titleCandidate.textContent) ||
      text(header.getAttribute("aria-label")) ||
      text(header.textContent);

    const headerPhone = directPhoneFromText(title);
    if (headerPhone) {
      return { title, phone: headerPhone, phoneSource: "header-title" };
    }

    const urlPhone = phoneFromUrl();
    if (urlPhone) {
      return { title, phone: urlPhone, phoneSource: "url-phone" };
    }

    const messagePhone = phoneFromVisibleMessageIds();
    if (messagePhone) {
      return { title, phone: messagePhone, phoneSource: "message-data-id" };
    }

    const sidebarPhone = phoneFromSidebarActive(title);
    if (sidebarPhone) {
      return { title, phone: sidebarPhone, phoneSource: "sidebar-active" };
    }

    return { title, phone: "", phoneSource: "unresolved" };
  }

  function ensureHost(header) {
    let host = document.getElementById(config.rootId);
    if (!host) {
      host = document.createElement("div");
      host.id = config.rootId;
      host.setAttribute("data-nuoma-overlay-root", "");
      host.attachShadow({ mode: "open" });
    }

    if (host.parentElement !== header) {
      header.appendChild(host);
    }

    const computed = window.getComputedStyle(header);
    if (computed.position === "static") {
      header.style.position = "relative";
    }

    return host;
  }

  function ensureShadow(host) {
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    let style = shadow.querySelector("style[data-nuoma-overlay-style]");
    if (!style) {
      style = document.createElement("style");
      style.setAttribute("data-nuoma-overlay-style", "");
      shadow.appendChild(style);
    }
    style.textContent = config.css;

    let button = shadow.querySelector("[data-nuoma-fab]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "nuoma-fab";
      button.setAttribute("data-nuoma-fab", "");
      button.setAttribute("data-testid", config.fabTestId);
      button.setAttribute("aria-label", "Abrir Nuoma CRM");
      button.setAttribute("title", "Abrir Nuoma CRM");
      button.innerHTML = '<span class="nuoma-mark" aria-hidden="true">N</span>';
      button.addEventListener("click", () => {
        const nextState = host.getAttribute("data-nuoma-state") === "open" ? "closed" : "open";
        host.setAttribute("data-nuoma-state", nextState);
        button.setAttribute("aria-expanded", String(nextState === "open"));
        renderPanel(host);
        if (nextState === "open") {
          void refreshContactFromApi(host, "fab-open");
        }
        window.dispatchEvent(
          new CustomEvent("nuoma:overlay-fab-click", {
            detail: {
              state: nextState,
              phone: host.getAttribute("data-nuoma-thread-phone") || "",
              title: host.getAttribute("data-nuoma-thread-title") || "",
              phoneSource: host.getAttribute("data-nuoma-phone-source") || "",
              version: config.version,
            },
          }),
        );
      });
      shadow.appendChild(button);
    }
    button.setAttribute("aria-controls", config.panelTestId);
    button.setAttribute("aria-expanded", String(host.getAttribute("data-nuoma-state") === "open"));

    let backdrop = shadow.querySelector("[data-nuoma-backdrop]");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "nuoma-backdrop";
      backdrop.setAttribute("data-nuoma-backdrop", "");
      backdrop.addEventListener("click", () => setOpen(host, false));
      shadow.appendChild(backdrop);
    }

    let panel = shadow.querySelector("[data-nuoma-panel]");
    if (!panel) {
      panel = document.createElement("aside");
      panel.className = "nuoma-panel";
      panel.setAttribute("data-nuoma-panel", "");
      panel.setAttribute("data-testid", config.panelTestId);
      panel.setAttribute("id", config.panelTestId);
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", "Nuoma CRM");
      shadow.appendChild(panel);
    }

    return button;
  }

  function setOpen(host, open) {
    host.setAttribute("data-nuoma-state", open ? "open" : "closed");
    const button = host.shadowRoot?.querySelector("[data-nuoma-fab]");
    if (button) {
      button.setAttribute("aria-expanded", String(open));
    }
    renderPanel(host);
    if (open) {
      void refreshContactFromApi(host, "panel-open");
    }
  }

  function refreshContactFromApi(host, reason) {
    installNuomaApi();
    if (state.apiInFlight || !window.__nuomaApi || typeof window.__nuomaApi.refreshContact !== "function") {
      return Promise.resolve(null);
    }
    const phone = host.getAttribute("data-nuoma-thread-phone") || "";
    if (!phone) {
      return Promise.resolve(null);
    }
    state.apiHydratedPhone = phone;
    state.apiInFlight = true;
    renderPanel(host);
    return window.__nuomaApi
      .refreshContact({
        phone,
        phoneSource: host.getAttribute("data-nuoma-phone-source") || "",
        title: host.getAttribute("data-nuoma-thread-title") || "",
        reason,
      })
      .then((response) => {
        renderPanel(host);
        return response;
      })
      .finally(() => {
        state.apiInFlight = false;
        renderPanel(host);
      });
  }

  function renderPanel(host) {
    const panel = host.shadowRoot?.querySelector("[data-nuoma-panel]");
    if (!panel) {
      return;
    }
    clear(panel);

    const data = state.data || {};
    const threadTitle = text(data.title) || host.getAttribute("data-nuoma-thread-title") || "Conversa";
    const phone = text(data.phone) || host.getAttribute("data-nuoma-thread-phone") || "";
    const phoneSource = text(data.phoneSource) || host.getAttribute("data-nuoma-phone-source") || "";
    const contact = data.contact || null;
    const conversations = Array.isArray(data.conversations) ? data.conversations : [];
    const latestMessages = Array.isArray(data.latestMessages) ? data.latestMessages : [];
    const automations = Array.isArray(data.automations) ? data.automations : [];
    const notes = text(data.notes) || text(contact && contact.notes);
    const apiStatus = text(data.apiStatus) || text(state.apiStatus) || "offline";
    const apiLastMethod = text(data.apiLastMethod) || text(state.apiLastMethod);
    const apiLastError = text(data.apiLastError) || text(state.apiLastError);
    const isApiLoading =
      apiStatus === "loading" || (state.apiInFlight && apiStatus !== "online" && apiStatus !== "error");
    const hasApiError = apiStatus === "error" || Boolean(apiLastError);
    const hasNoContact =
      Boolean(phone) && !isApiLoading && !hasApiError && data.source === "nuoma-api" && contact === null;

    const header = document.createElement("div");
    header.className = "nuoma-panel-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "nuoma-title-wrap";
    appendText(titleWrap, "div", "nuoma-eyebrow", "Nuoma CRM");
    appendText(titleWrap, "div", "nuoma-panel-title", text(contact && contact.name) || threadTitle);
    appendText(
      titleWrap,
      "div",
      "nuoma-panel-subtitle",
      phone ? "+" + phone : "Telefone nao identificado",
    );
    header.appendChild(titleWrap);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "nuoma-close";
    close.setAttribute("aria-label", "Fechar painel Nuoma");
    close.textContent = "×";
    close.addEventListener("click", () => setOpen(host, false));
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement("div");
    body.className = "nuoma-panel-body";
    body.tabIndex = 0;

    if (isApiLoading) {
      appendPanelState(
        body,
        "Carregando contato",
        "Buscando resumo, automacoes elegiveis, mensagens recentes e notas pelo bridge seguro.",
        "loading",
      );
    }

    if (hasApiError) {
      appendPanelState(
        body,
        "Erro na ponte API",
        apiLastError || "Nao foi possivel hidratar este contato agora. O painel continua em modo leitura local.",
        "error",
      );
    }

    if (hasNoContact) {
      const stateCard = appendPanelState(
        body,
        "Contato nao encontrado no CRM",
        "O telefone foi detectado no WhatsApp, mas ainda nao existe contato vinculado no Nuoma.",
        "empty-contact",
      );
      const actions = document.createElement("div");
      actions.className = "nuoma-empty-actions";
      for (const label of ["Criar contato", "Vincular contato"]) {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "nuoma-empty-action";
        action.disabled = true;
        action.textContent = label + " (em breve)";
        actions.appendChild(action);
      }
      stateCard.appendChild(actions);
    }

    const summary = section("Resumo", contact?.status || "sem contato");
    const grid = document.createElement("div");
    grid.className = "nuoma-summary-grid";
    grid.appendChild(stat("Canal", contact?.primaryChannel || "WhatsApp"));
    grid.appendChild(stat("Conversas", String(conversations.length)));
    grid.appendChild(stat("Ultima msg", shortDate(conversations[0]?.lastMessageAt) || "agora"));
    grid.appendChild(stat("Origem", data.source || "overlay"));
    grid.appendChild(stat("Detector", phoneSource || "sem fonte"));
    grid.appendChild(stat("Ponte API", apiStatus + (apiLastMethod ? " / " + apiLastMethod : "")));
    summary.appendChild(grid);
    body.appendChild(summary);

    const automationSection = section("Automacoes", automations.length ? String(automations.length) : "0");
    const automationList = document.createElement("div");
    automationList.className = "nuoma-list";
    if (automations.length === 0) {
      appendText(automationList, "div", "nuoma-empty", "Nenhuma automacao elegivel para este contato.");
    } else {
      for (const automation of automations.slice(0, 4)) {
        const item = document.createElement("div");
        item.className = "nuoma-list-item";
        appendText(item, "strong", "", text(automation.name) || "Automacao sem nome");
        appendText(
          item,
          "span",
          "",
          [automation.category, automation.status].filter(Boolean).join(" · ") || "ativa",
        );
        automationList.appendChild(item);
      }
    }
    automationSection.appendChild(automationList);
    body.appendChild(automationSection);

    const messageSection = section("Ultimas mensagens", latestMessages.length ? String(latestMessages.length) : "0");
    const messageList = document.createElement("div");
    messageList.className = "nuoma-list";
    if (latestMessages.length === 0) {
      appendText(messageList, "div", "nuoma-empty", "Sem mensagens recentes sincronizadas.");
    } else {
      for (const message of latestMessages.slice(0, 3)) {
        const item = document.createElement("div");
        item.className = "nuoma-list-item";
        appendText(item, "strong", "", text(message.body) || "[" + (message.contentType || "midia") + "]");
        appendText(
          item,
          "span",
          "",
          [message.direction, shortDate(message.observedAtUtc)].filter(Boolean).join(" · "),
        );
        messageList.appendChild(item);
      }
    }
    messageSection.appendChild(messageList);
    body.appendChild(messageSection);

    const noteSection = section("Notas", notes ? "salvas" : "vazio");
    if (notes) {
      const notesNode = appendText(noteSection, "div", "nuoma-notes", notes);
      notesNode.tabIndex = 0;
    } else {
      appendText(noteSection, "div", "nuoma-empty", "Nenhuma nota salva para este contato.");
    }
    body.appendChild(noteSection);

    if (!phone) {
      appendText(body, "div", "nuoma-empty nuoma-warning", "Telefone nao identificado neste DOM. Abra uma conversa individual ou aguarde sync de detalhes do contato.");
    }
    if (apiLastError) {
      appendText(body, "div", "nuoma-empty nuoma-warning", "Ponte API: " + apiLastError);
    }

    panel.appendChild(body);
  }

  function appendPanelState(parent, title, description, variant) {
    const wrapper = document.createElement("div");
    wrapper.className = "nuoma-empty nuoma-state-card nuoma-state-" + text(variant || "info");
    appendText(wrapper, "strong", "", title);
    appendText(wrapper, "span", "", description);
    parent.appendChild(wrapper);
    return wrapper;
  }

  function section(title, pill) {
    const wrapper = document.createElement("section");
    wrapper.className = "nuoma-section";
    const heading = document.createElement("div");
    heading.className = "nuoma-section-title";
    appendText(heading, "span", "", title);
    appendText(heading, "span", "nuoma-pill", pill);
    wrapper.appendChild(heading);
    return wrapper;
  }

  function stat(label, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "nuoma-stat";
    appendText(wrapper, "div", "nuoma-stat-label", label);
    appendText(wrapper, "div", "nuoma-stat-value", value);
    return wrapper;
  }

  function refresh() {
    const header = findHeader();
    if (!header) {
      return { mounted: false, reason: "header-not-found", version: config.version };
    }

    installNuomaApi();
    const thread = detectCurrentThread(header);
    const host = ensureHost(header);
    const button = ensureShadow(host);
    host.setAttribute("data-nuoma-version", config.version);
    host.setAttribute("data-nuoma-thread-title", thread.title);
    host.setAttribute("data-nuoma-thread-phone", thread.phone);
    host.setAttribute("data-nuoma-phone-source", thread.phoneSource);
    host.setAttribute("data-nuoma-api-status", state.apiStatus || "offline");
    button.setAttribute("data-nuoma-thread-phone", thread.phone);
    button.setAttribute("data-nuoma-thread-title", thread.title);
    button.setAttribute("data-nuoma-phone-source", thread.phoneSource);
    const dataPhone = text(state.data && state.data.phone);
    const dataTitle = text(state.data && state.data.title);
    const threadChanged =
      !state.data ||
      (thread.phone && dataPhone && dataPhone !== thread.phone) ||
      (!thread.phone && thread.title && dataTitle !== thread.title);
    if (threadChanged) {
      state.data = {
        phone: thread.phone,
        phoneSource: thread.phoneSource,
        title: thread.title,
        contact: null,
        conversations: [],
        latestMessages: [],
        automations: [],
        notes: null,
        source: "dom",
        updatedAt: new Date().toISOString(),
      };
    }
    renderPanel(host);
    if (
      host.getAttribute("data-nuoma-state") === "open" &&
      thread.phone &&
      state.apiHydratedPhone !== thread.phone
    ) {
      void refreshContactFromApi(host, "open-refresh");
    }

    return {
      mounted: true,
      phone: thread.phone,
      phoneSource: thread.phoneSource,
      title: thread.title,
      apiStatus: state.apiStatus || "offline",
      apiLastMethod: state.apiLastMethod || "",
      apiLastError: state.apiLastError || "",
      version: config.version,
    };
  }

  function scheduleRefresh() {
    if (state.raf) {
      cancelAnimationFrame(state.raf);
    }
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      refresh();
    });
  }

  function installObserver() {
    if (state.observer) {
      state.observer.disconnect();
    }
    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title", "aria-label", "data-testid"],
    });
  }

  window.__nuomaOverlayInstalled = true;
  window.__nuomaOverlayVersion = config.version;
  window.__nuomaOverlayState = state;
  window.__nuomaOverlayRefresh = refresh;
  window.__nuomaOverlayRefreshFromApi = (reason) => {
    const host = document.getElementById(config.rootId);
    return host ? refreshContactFromApi(host, reason || "manual") : Promise.resolve(null);
  };
  window.__nuomaOverlaySetData = (data) => {
    state.data = {
      ...(state.data || {}),
      ...(data || {}),
      updatedAt: (data && data.updatedAt) || new Date().toISOString(),
    };
    if (data && data.apiStatus) {
      setApiStatus(data.apiStatus, data.apiLastMethod, data.apiLastError);
    }
    const host = document.getElementById(config.rootId);
    if (host) {
      if (state.data.title) {
        host.setAttribute("data-nuoma-thread-title", state.data.title);
      }
      if (state.data.phone) {
        host.setAttribute("data-nuoma-thread-phone", state.data.phone);
      }
      if (state.data.phoneSource) {
        host.setAttribute("data-nuoma-phone-source", state.data.phoneSource);
      }
      renderPanel(host);
    }
    return state.data;
  };
  window.__nuomaOverlayRemove = () => {
    if (state.observer) {
      state.observer.disconnect();
    }
    if (state.raf) {
      cancelAnimationFrame(state.raf);
    }
    document.getElementById(config.rootId)?.remove();
    window.__nuomaOverlayInstalled = false;
  };

  installObserver();
  installNuomaApi();
  refresh();
})();
`.trim();
}
