export const NUOMA_OVERLAY_VERSION = "v2.11.7-m35";
export const NUOMA_OVERLAY_ROOT_ID = "nuoma-wpp-overlay-root";
export const NUOMA_OVERLAY_FAB_TEST_ID = "nuoma-overlay-fab";
export const NUOMA_OVERLAY_PANEL_TEST_ID = "nuoma-overlay-panel";
export const NUOMA_OVERLAY_API_BINDING_NAME = "__nuomaApi";
export const NUOMA_OVERLAY_NATIVE_BRIDGE_NAME = "__nuomaApiNativeBridge";

export interface NuomaOverlayScriptOptions {
  version?: string;
}

export interface NuomaOverlayData {
  phone?: string;
  waJid?: string;
  phoneSource?: string;
  title?: string;
  contact?: {
    id?: number;
    name?: string | null;
    status?: string | null;
    primaryChannel?: string | null;
    notes?: string | null;
    tagIds?: number[];
  } | null;
  tags?: Array<{
    id?: number;
    name?: string | null;
    color?: string | null;
    description?: string | null;
  }>;
  reminders?: Array<{
    id?: number;
    title?: string | null;
    notes?: string | null;
    dueAt?: string | null;
    status?: string | null;
  }>;
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
    triggerChannel?: string | null;
    actionsCount?: number;
    sendStepsCount?: number;
    overlayEnabled?: boolean;
    eligible?: boolean;
    reasons?: string[];
    wouldEnqueueJobs?: boolean;
    canDispatchReal?: boolean;
  }>;
  campaigns?: Array<{
    id?: number;
    name?: string | null;
    status?: string | null;
    channel?: string | null;
    stepsCount?: number;
    firstStepType?: string | null;
    overlayEnabled?: boolean;
    eligible?: boolean;
    reasons?: string[];
    canDispatchReal?: boolean;
  }>;
  notes?: string | null;
  source?: string;
  syncStatus?: string;
  syncLastResult?: {
    mode?: string;
    conversationId?: number | null;
    phone?: string | null;
    history?: {
      scrollsCompleted?: number;
      syncedWindows?: number;
      stoppedReason?: string;
    } | null;
  } | null;
  apiStatus?: string;
  apiLastMethod?: string;
  apiLastError?: string | null;
  campaignRunStatus?: string;
  campaignRunLastResult?: {
    campaign?: { id?: number; name?: string | null } | null;
    recipientsCreated?: number;
    jobsCreated?: number;
    plannedJobs?: number;
    rejected?: Array<{ reason?: string | null }>;
  } | null;
  campaignRunLastError?: string | null;
  automationRunStatus?: string;
  automationRunLastResult?: {
    automation?: { id?: number; name?: string | null } | null;
    eligible?: boolean;
    jobsCreated?: number;
    actionsApplied?: number;
    plannedActions?: number;
    rejected?: Array<{ reason?: string | null }>;
  } | null;
  automationRunLastError?: string | null;
  automationHistory?: Array<{
    id?: number;
    type?: string | null;
    severity?: string | null;
    automationId?: number | null;
    phone?: string | null;
    eligible?: boolean | null;
    reasons?: string[];
    jobsCreated?: number;
    actionsApplied?: number;
    createdAt?: string | null;
  }>;
  quickActionStatus?: string;
  quickActionLastResult?: {
    action?: string;
    changed?: boolean;
    rejected?: Array<{ reason?: string | null }>;
  } | null;
  quickActionLastError?: string | null;
  updatedAt?: string;
}

const overlayTokens = {
  bg: "var(--nwo-surface-0)",
  bgHover: "var(--nwo-surface-1)",
  fg: "var(--nwo-ink-strong)",
  fgMuted: "var(--nwo-ink-base)",
  fgDim: "var(--nwo-ink-dim)",
  cyan: "var(--nwo-accent)",
  warning: "var(--nwo-status-warn)",
  surface: "var(--nwo-surface-1)",
  elevated: "var(--nwo-surface-2)",
  contour: "var(--nwo-line)",
  contourMuted: "var(--nwo-line-soft)",
  shadow: "0 0 0 1px var(--nwo-line), 0 18px 48px #00000070",
  activeShadow: "0 0 0 1px var(--nwo-accent), 0 12px 24px #00000052",
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

function createNuomaOverlayCss(): string {
  return `
:host {
  all: initial;
  position: absolute;
  inset-block-start: 8px;
  inset-inline-end: var(--nuoma-fab-inline-end, 72px);
  z-index: 2147483646;
  display: block;
  inline-size: 48px;
  block-size: 48px;
  pointer-events: none;
  color-scheme: dark;
	  font-family: ${overlayTokens.fontFamily};
	  letter-spacing: 0;
	  --nwo-surface-0: #0E0D0B;
	  --nwo-surface-1: #151311;
	  --nwo-surface-2: #201D19;
	  --nwo-ink-strong: #F5F2EC;
	  --nwo-ink-base: #B2AB9F;
	  --nwo-ink-dim: #8D867B;
	  --nwo-accent: #E8642C;
	  --nwo-accent-hover: #FF7A45;
	  --nwo-accent-on: #1A0D06;
	  --nwo-line: #2A2621;
	  --nwo-line-soft: #3A352D;
	  --nwo-status-ok: #34C77B;
	  --nwo-status-warn: #E6B01C;
	  --nwo-status-error: #F05A56;
	  --nwo-status-info: #5CA2FA;
	}

* {
  box-sizing: border-box;
}

.nuoma-fab {
  all: unset;
  box-sizing: border-box;
  inline-size: 44px;
  block-size: 44px;
  display: inline-grid;
  place-items: center;
	  border-radius: 14px;
	  color: ${overlayTokens.fg};
	  background: ${overlayTokens.bg};
  border: 1px solid #E8642C70;
  box-shadow:
    0 12px 30px #00000057,
    inset 0 1px 0 #ffffff1f;
  cursor: pointer;
  overflow: visible;
  pointer-events: auto;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 140ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 140ms cubic-bezier(0.22, 1, 0.36, 1),
    background 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.nuoma-fab:hover,
.nuoma-fab:focus-visible {
  transform: translateY(-1px);
	  background: ${overlayTokens.bgHover};
  box-shadow:
    0 0 0 1px #E8642C85,
    0 14px 34px #00000061,
    inset 0 1px 0 #ffffff24;
  outline: none;
}

.nuoma-fab:active {
  transform: translateY(1px) scale(0.98);
}

.nuoma-brand-button {
  position: relative;
  display: inline-grid;
  place-items: center;
  inline-size: 100%;
  block-size: 100%;
  transform-origin: 50% 50%;
  animation: nuoma-brand-breathe 2200ms ease-in-out infinite;
}

.nuoma-brand-mark {
  display: inline-grid;
  inline-size: 30px;
  block-size: 30px;
  place-items: center;
	  border-radius: 10px;
	  color: var(--nwo-ink-strong);
	  background: var(--nwo-surface-2);
  border: 1px solid #E8642C57;
  box-shadow:
    inset 0 1px 0 #ffffff29,
    0 8px 18px #0000004d;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
  text-transform: uppercase;
  user-select: none;
}

.nuoma-brand-status {
  position: absolute;
  inset-block-end: 7px;
  inset-inline-end: 7px;
  inline-size: 9px;
  block-size: 9px;
  border-radius: 999px;
  background: ${overlayTokens.cyan};
	  border: 2px solid var(--nwo-surface-0);
	  box-shadow: 0 0 10px #E8642C57;
	}

	:host([data-nuoma-visual-state="idle"]) .nuoma-brand-status {
	  background: var(--nwo-ink-dim);
	  box-shadow: none;
	}

	:host([data-nuoma-visual-state="waiting"]) .nuoma-brand-status {
	  background: var(--nwo-status-warn);
	  box-shadow: none;
	}

	:host([data-nuoma-visual-state="running"]) .nuoma-brand-status {
	  background: var(--nwo-accent);
	  animation: nuoma-brand-pulse 900ms ease-in-out infinite;
	}

	:host([data-nuoma-visual-state="review"]) .nuoma-brand-status {
	  background: var(--nwo-status-info);
	  box-shadow: 0 0 0 3px #5CA2FA30;
	}

	:host([data-nuoma-visual-state="failed"]) .nuoma-brand-status {
	  background: var(--nwo-status-error);
	  box-shadow: 0 0 0 3px #F05A5630;
	}

.nuoma-sync-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${overlayTokens.cyan};
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.nuoma-sync-live::before {
  content: "";
  inline-size: 8px;
  block-size: 8px;
  border-radius: 999px;
  background: ${overlayTokens.cyan};
  box-shadow: 0 0 12px #E8642C7a;
  animation: nuoma-brand-pulse 850ms ease-in-out infinite;
}

:host([data-nuoma-debug="true"]) [data-nuoma-locator] {
  outline: 1px solid var(--nwo-status-error);
  outline-offset: 2px;
}

:host([data-nuoma-dom-status="changed"]) .nuoma-fab {
  border-color: #E6B01C9e;
  box-shadow:
    0 0 0 1px #E6B01C61,
    0 14px 34px #00000061,
    inset 0 1px 0 #ffffff24;
}

:host([data-nuoma-api-status="offline"]) .nuoma-brand-status {
  background: ${overlayTokens.fgDim};
  box-shadow: none;
}

:host([data-nuoma-api-status="loading"]) .nuoma-brand-status {
  background: ${overlayTokens.cyan};
  animation: nuoma-brand-pulse 900ms ease-in-out infinite;
}

:host([data-nuoma-api-status="error"]) .nuoma-brand-status {
  background: ${overlayTokens.warning};
  box-shadow: 0 0 12px #E6B01C7a;
}

:host([data-nuoma-state="open"]) .nuoma-fab {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px) scale(0.92);
	  box-shadow: ${overlayTokens.activeShadow};
}

:host([data-nuoma-state="open"]) .nuoma-brand-button {
  animation-duration: 1500ms;
}

@keyframes nuoma-brand-breathe {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-1px) scale(1.015);
  }
}

@keyframes nuoma-brand-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.72);
    opacity: 0.72;
  }
}

.nuoma-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483644;
  display: none;
  background: transparent;
  pointer-events: none;
}

.nuoma-panel {
  position: fixed;
  inset-block-start: 64px;
  inset-block-end: 16px;
  inset-inline-end: 16px;
  z-index: 2147483645;
  inline-size: min(384px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 10px;
	  color: ${overlayTokens.fg};
	  background: ${overlayTokens.bg};
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
  padding: 16px 16px 13px;
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
  border-radius: 8px;
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
  color: ${overlayTokens.cyan};
  background: #E8642C14;
  border: 1px solid #E8642C38;
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

.nuoma-action-row {
  display: grid;
  gap: 8px;
}

.nuoma-quick-grid {
  display: grid;
  gap: 8px;
}

.nuoma-quick-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: stretch;
}

.nuoma-select {
  all: unset;
  box-sizing: border-box;
  min-block-size: 34px;
  min-inline-size: 0;
  padding: 8px 28px 8px 10px;
	  border-radius: 8px;
	  color: ${overlayTokens.fg};
	  background: #0E0D0B8f;
  border: 1px solid ${overlayTokens.contourMuted};
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nuoma-select:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.nuoma-select:focus-visible {
  border-color: #E8642Cad;
  outline: none;
}

.nuoma-action {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  min-block-size: 34px;
  align-items: center;
  justify-content: center;
  padding: 8px 10px;
  border-radius: 10px;
  color: ${overlayTokens.fg};
  background: #E8642C24;
  border: 1px solid #E8642C57;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.nuoma-action[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.58;
}

.nuoma-action:hover,
.nuoma-action:focus-visible {
  border-color: #E8642Cad;
  background: #E8642C33;
  outline: none;
}

.nuoma-action:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.nuoma-inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nuoma-small-action {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  min-block-size: 30px;
  align-items: center;
  justify-content: center;
  padding: 7px 9px;
  border-radius: 8px;
  color: ${overlayTokens.fg};
  background: #E8642C1f;
  border: 1px solid #E8642C4d;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.nuoma-small-action:hover,
.nuoma-small-action:focus-visible {
  border-color: #E8642C94;
  outline: none;
}

.nuoma-campaign-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

.nuoma-campaign-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.nuoma-campaign-chip {
  display: inline-flex;
  align-items: center;
  min-block-size: 18px;
  padding: 2px 6px;
  border-radius: 999px;
  color: ${overlayTokens.fgMuted};
  background: #0E0D0B94;
  border: 1px solid ${overlayTokens.contourMuted};
  font-size: 9px;
  font-weight: 700;
  line-height: 1.2;
}

.nuoma-campaign-chip[data-state="ok"] {
  color: ${overlayTokens.cyan};
  border-color: #E8642C4d;
  background: #E8642C14;
}

.nuoma-campaign-chip[data-state="blocked"] {
  color: ${overlayTokens.warning};
  border-color: #E6B01C47;
  background: #E6B01C14;
}

.nuoma-sync-note {
  color: ${overlayTokens.fgDim};
  font-size: 11px;
  line-height: 1.35;
}

.nuoma-stat {
  min-width: 0;
  padding: 8px;
  border-radius: 10px;
  background: #1513116b;
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
  border-radius: 8px;
  background: #15131161;
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

.nuoma-state-card {
  display: grid;
  gap: 4px;
  padding: 11px;
  border-radius: 10px;
  background: #1513117a;
  border: 1px solid ${overlayTokens.contourMuted};
}

.nuoma-state-card strong {
  color: ${overlayTokens.fg};
  font-size: 12px;
  line-height: 1.3;
}

.nuoma-state-card span {
  color: ${overlayTokens.fgMuted};
  font-size: 12px;
  line-height: 1.4;
}

.nuoma-empty-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-block-start: 4px;
}

.nuoma-empty-action {
  all: unset;
  box-sizing: border-box;
  min-block-size: 32px;
  display: inline-grid;
  place-items: center;
  padding: 7px 8px;
  border-radius: 9px;
  color: ${overlayTokens.fgDim};
  background: #0E0D0B8f;
  border: 1px solid ${overlayTokens.contourMuted};
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.nuoma-diagnostics {
  display: grid;
  gap: 4px;
  color: ${overlayTokens.fgDim};
  font-size: 10px;
  line-height: 1.35;
}

.nuoma-warning {
  color: ${overlayTokens.warning};
}

@media (max-width: 780px) {
  :host {
    inset-block-start: 9px;
    inset-inline-end: var(--nuoma-fab-inline-end, 66px);
    inline-size: 46px;
    block-size: 46px;
  }

  .nuoma-fab {
    inline-size: 42px;
    block-size: 42px;
  }

  .nuoma-brand-mark {
    inline-size: 28px;
    block-size: 28px;
    border-radius: 9px;
    font-size: 13px;
  }

  .nuoma-panel {
    inset-block-start: 64px;
    inset-block-end: 12px;
    inset-inline: 12px;
    inline-size: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nuoma-brand-button,
  .nuoma-brand-status {
    animation: none;
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
    apiNativeBridgeName: NUOMA_OVERLAY_NATIVE_BRIDGE_NAME,
    css: createNuomaOverlayCss(),
  };

  return `
(() => {
  const config = ${JSON.stringify(config)};
  const state = window.__nuomaOverlayState || {
    observer: null,
    raf: 0,
    observerTimer: 0,
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
    quickCampaignId: "",
    quickAutomationId: "",
    quickTagId: "",
    quickStatus: "",
    animationRaf: 0,
    animationStartedAt: 0,
    visualState: "idle",
    debugLocators: false,
    domSignature: "",
    domChanged: false,
    hotReloadedAt: "",
    refreshCount: 0,
  };

  if (window.__nuomaOverlayVersion && window.__nuomaOverlayVersion !== config.version) {
    state.hotReloadedAt = new Date().toISOString();
    state.domSignature = "";
    state.apiHydratedPhone = "";
  }

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

  function isCallableBridge(value) {
    return typeof value === "function";
  }

  function storeNativeApiBridge(bridge) {
    if (!isCallableBridge(bridge)) {
      return null;
    }
    const bound = bridge.bind(window);
    state.apiBridge = bound;
    window[config.apiNativeBridgeName] = bound;
    return bound;
  }

  function clearApiBridge(bridge, options) {
    const dropNative = Boolean(options && options.dropNative);
    state.apiBridge = null;
    if (dropNative && (!bridge || window[config.apiNativeBridgeName] === bridge)) {
      delete window[config.apiNativeBridgeName];
    }
    if (
      window.__nuomaApi &&
      typeof window.__nuomaApi === "object" &&
      window.__nuomaApi.__nuomaManaged === true &&
      (!bridge || window.__nuomaApi.__nuomaBridge === bridge)
    ) {
      window.__nuomaApi.__nuomaBridge = isCallableBridge(window[config.apiNativeBridgeName])
        ? window[config.apiNativeBridgeName]
        : null;
    }
  }

  function captureApiBridge() {
    if (isCallableBridge(state.apiBridge)) {
      return state.apiBridge;
    }
    state.apiBridge = null;
    if (isCallableBridge(window[config.apiNativeBridgeName])) {
      state.apiBridge = window[config.apiNativeBridgeName];
      setApiStatus("ready", "", "");
      return state.apiBridge;
    }
    const existingManagedBridge =
      window.__nuomaApi &&
      typeof window.__nuomaApi === "object" &&
      window.__nuomaApi.__nuomaManaged === true &&
      isCallableBridge(window.__nuomaApi.__nuomaBridge)
        ? window.__nuomaApi.__nuomaBridge
        : null;
    if (existingManagedBridge) {
      state.apiBridge = existingManagedBridge;
      window[config.apiNativeBridgeName] = existingManagedBridge;
      setApiStatus("ready", "", "");
      return state.apiBridge;
    }
    if (isCallableBridge(window[config.apiBindingName])) {
      storeNativeApiBridge(window[config.apiBindingName]);
      setApiStatus("ready", "", "");
      return state.apiBridge;
    }
    setApiStatus("offline", "", "Runtime.addBinding indisponível");
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
        dispatchNuomaApiRequestWithRetry(apiMethod, params || mutationIntent.params || {}, {
          ...(options || {}),
          mutation,
        }),
      );
      state.apiMutationQueue = queued.catch(() => undefined);
      return queued;
    }
    return dispatchNuomaApiRequestWithRetry(apiMethod, params, options);
  }

  function isRetryableApiError(response) {
    const code = response && response.error && text(response.error.code);
    return code === "timeout" || code === "binding_unavailable" || code === "binding_failed";
  }

  function dispatchNuomaApiRequestWithRetry(method, params, options) {
    const apiMethod = text(method);
    const maxAttempts = Number(options && options.maxAttempts) || (readOnlyApiMethods.has(apiMethod) ? 2 : 1);
    let attempt = 0;
    const run = () => {
      attempt += 1;
      return dispatchNuomaApiRequest(apiMethod, params, {
        ...(options || {}),
        attempt,
      }).then((response) => {
        if (attempt < maxAttempts && isRetryableApiError(response)) {
          clearApiBridge();
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(run());
            }, Math.min(900, 180 * attempt));
          });
        }
        return response;
      });
    };
    return run();
  }

  function dispatchNuomaApiRequest(method, params, options) {
    const bridge = captureApiBridge();
    const apiMethod = text(method);
    if (!bridge) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "binding_unavailable",
          message: "Runtime.addBinding não registrou window.__nuomaApi",
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
        clearApiBridge(bridge);
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
        clearApiBridge(bridge);
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
    if (isCallableBridge(window[config.apiBindingName]) && !existingManaged) {
      storeNativeApiBridge(window[config.apiBindingName]);
    }
    if (existingManaged) {
      window.__nuomaApiResolve = resolveApiRequest;
      const bridge = captureApiBridge();
      if (bridge) {
        window.__nuomaApi.__nuomaBridge = bridge;
      }
    }
    captureApiBridge();
    window.__nuomaApiResolve = resolveApiRequest;
    window.__nuomaApi = {
      __nuomaManaged: true,
      __nuomaBridge: isCallableBridge(state.apiBridge) ? state.apiBridge : null,
      version: config.version,
      request: requestNuomaApi,
      ping: () => requestNuomaApi("ping", {}),
      contactSummary: (input) => requestNuomaApi("contactSummary", input || {}),
      forceConversationSync: (input) => {
        const intent = prepareMutation("forceConversationSync", input || {});
        return requestNuomaApi("forceConversationSync", input || {}, {
          mutationIntent: intent,
          confirmationText: "Forçar sync da conversa atual",
          confirm: true,
          timeoutMs: 30000,
        }).then((response) => {
          if (response && response.ok && response.data && typeof window.__nuomaOverlaySetData === "function") {
            window.__nuomaOverlaySetData({
              ...(response.data.snapshot || {}),
              syncStatus: "done",
              syncLastResult: response.data.result || null,
              apiStatus: "online",
              apiLastMethod: "forceConversationSync",
              apiLastError: null,
            });
          }
          return response;
        });
      },
      runCampaignForPhone: (input) => {
        const intent = prepareMutation("runCampaignForPhone", input || {});
        return requestNuomaApi("runCampaignForPhone", input || {}, {
          mutationIntent: intent,
          confirmationText: "Rodar campanha no número atual",
          confirm: true,
          timeoutMs: 30000,
        }).then((response) => {
          if (response && response.data && typeof window.__nuomaOverlaySetData === "function") {
            window.__nuomaOverlaySetData({
              ...(response.data.snapshot || {}),
              campaignRunStatus: response.ok ? "done" : "error",
              campaignRunLastResult: response.data.result || null,
              campaignRunLastError:
                response.ok ? null : response.error && response.error.message ? response.error.message : "Campanha bloqueada",
              apiStatus: response.ok ? "online" : "error",
              apiLastMethod: "runCampaignForPhone",
              apiLastError:
                response.ok ? null : response.error && response.error.message ? response.error.message : "Campanha bloqueada",
            });
          }
          return response;
        });
      },
      runAutomationForPhone: (input) => {
        const intent = prepareMutation("runAutomationForPhone", input || {});
        return requestNuomaApi("runAutomationForPhone", input || {}, {
          mutationIntent: intent,
          confirmationText: "Rodar automação no número atual",
          confirm: true,
          timeoutMs: 30000,
        }).then((response) => {
          if (response && response.data && typeof window.__nuomaOverlaySetData === "function") {
            window.__nuomaOverlaySetData({
              ...(response.data.snapshot || {}),
              automationRunStatus: response.ok ? "done" : "error",
              automationRunLastResult: response.data.result || null,
              automationRunLastError:
                response.ok ? null : response.error && response.error.message ? response.error.message : "Automacao bloqueada",
              apiStatus: response.ok ? "online" : "error",
              apiLastMethod: "runAutomationForPhone",
              apiLastError:
                response.ok ? null : response.error && response.error.message ? response.error.message : "Automacao bloqueada",
            });
          }
          return response;
        });
      },
      applyTag: (input) => runQuickActionMutation("applyTag", input || {}, "Aplicar tag no contato"),
      removeTag: (input) =>
        runQuickActionMutation("removeTag", input || {}, "Remover tag do contato"),
      setStatus: (input) =>
        runQuickActionMutation("setStatus", input || {}, "Alterar status do contato"),
      createReminder: (input) =>
        runQuickActionMutation("createReminder", input || {}, "Criar lembrete no contato"),
      automationHistory: (input) => requestNuomaApi("automationHistory", input || {}),
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

  function runQuickActionMutation(method, input, confirmationText) {
    const intent = prepareMutation(method, input || {});
    return requestNuomaApi(method, input || {}, {
      mutationIntent: intent,
      confirmationText,
      confirm: true,
      timeoutMs: 12000,
    }).then((response) => {
      if (response && response.data && typeof window.__nuomaOverlaySetData === "function") {
        window.__nuomaOverlaySetData({
          ...(response.data.snapshot || {}),
          quickActionStatus: response.ok ? "done" : "error",
          quickActionLastResult: response.data.result || null,
          quickActionLastError:
            response.ok ? null : response.error && response.error.message ? response.error.message : "Ação rápida bloqueada",
          apiStatus: response.ok ? "online" : "error",
          apiLastMethod: method,
          apiLastError:
            response.ok ? null : response.error && response.error.message ? response.error.message : "Ação rápida bloqueada",
        });
      }
      return response;
    });
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

  function shouldReduceMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function brandVisualStateForHost(host) {
    const data = state.data || {};
    const apiStatus = text(data.apiStatus) || text(state.apiStatus) || host.getAttribute("data-nuoma-api-status") || "offline";
    const syncStatus = text(data.syncStatus);
    const hasError = apiStatus === "error";
    if (hasError || syncStatus === "error") {
      return "failed";
    }
    if (apiStatus === "loading" || syncStatus === "running" || state.apiInFlight) {
      return "running";
    }
    if (syncStatus === "done") {
      return "jumping";
    }
    if (!host.getAttribute("data-nuoma-thread-phone") && host.getAttribute("data-nuoma-state") !== "open") {
      return "waiting";
    }
    if (host.getAttribute("data-nuoma-state") === "open") {
      return "review";
    }
    return "idle";
  }

  function animateBrand(timestamp) {
    const host = document.getElementById(config.rootId);
    const mark = host?.shadowRoot?.querySelector(".nuoma-brand-mark");
    if (!host || !mark) {
      state.animationRaf = 0;
      return;
    }

    const visualState = brandVisualStateForHost(host);
    if (state.visualState !== visualState || !state.animationStartedAt) {
      state.visualState = visualState;
      state.animationStartedAt = timestamp || performance.now();
      host.setAttribute("data-nuoma-visual-state", visualState);
    }

    const elapsed = shouldReduceMotion() ? 0 : (timestamp || performance.now()) - state.animationStartedAt;
    mark.style.opacity = visualState === "waiting" ? "0.78" : "1";
    mark.style.transform =
      visualState === "running" || visualState === "review"
        ? "rotate(" + Math.sin(elapsed / 480) * 1.2 + "deg)"
        : "rotate(0deg)";

    state.animationRaf = requestAnimationFrame(animateBrand);
  }

  function ensureBrandAnimation() {
    if (!state.animationRaf) {
      animateBrand(performance.now());
    }
  }

  function restartBrandAnimation() {
    if (state.animationRaf) {
      cancelAnimationFrame(state.animationRaf);
      state.animationRaf = 0;
    }
    state.animationStartedAt = 0;
    animateBrand(performance.now());
  }

  function normalizePhone(value) {
    const digits = text(value).replace(/\\D/g, "");
    if (digits.length === 12 && digits.startsWith("55")) {
      const local = digits.slice(4);
      if (/^[6-9]\\d{7}$/.test(local)) {
        return digits.slice(0, 4) + "9" + local;
      }
    }
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
      return digits;
    }
    if (digits.length === 10 || digits.length === 11) {
      return "55" + digits;
    }
    return "";
  }

  function normalizeWaJid(value) {
    const raw = text(value);
    if (!raw || /@g\\.us$/i.test(raw) || /@broadcast$/i.test(raw)) {
      return "";
    }
    const phone = normalizePhone(raw.split("@")[0] || raw);
    return phone ? phone + "@s.whatsapp.net" : "";
  }

  function currentChatJidFromStore() {
    try {
      const req = window.require;
      if (typeof req !== "function") {
        return "";
      }
      const Store = req("WAWebCollections");
      const chats = Store && Store.Chat && (Store.Chat._models || Store.Chat.models || []);
      const chat = Array.from(chats).find((item) => item && item.active) || null;
      const candidates = [
        chat && chat.__x_historyChatId,
        chat && chat.historyChatId,
        chat && chat.__x_contact && chat.__x_contact.__x_phoneNumber,
        chat && chat.contact && chat.contact.__x_phoneNumber,
        chat && chat.id,
      ];
      for (const candidate of candidates) {
        const rawId =
          (candidate &&
            typeof candidate === "object" &&
            (candidate._serialized || candidate.user || String(candidate))) ||
          candidate ||
          "";
        const waJid = normalizeWaJid(rawId);
        if (waJid) {
          return waJid;
        }
      }
      return "";
    } catch {
      return "";
    }
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
    const nodes = Array.from(root.querySelectorAll('[data-id*="@c.us"], [data-id*="@s.whatsapp.net"], [data-pre-plain-text]'));
    for (const node of nodes) {
      const dataId = text(node.getAttribute("data-id")) || text(node.getAttribute("data-pre-plain-text"));
      const match = dataId.match(/(?:^|_|\\D)(\\d{10,16})@(?:c\\.us|s\\.whatsapp\\.net)(?:_|$|\\D)/);
      const phone = normalizePhone((match && match[1]) || firstPhoneFromText(dataId));
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

  function phoneFromContactDetails() {
    const selectors = [
      '[data-testid="contact-info-drawer"]',
      '[data-testid="drawer-right"]',
      '[aria-label*="Dados do contato"]',
      '[aria-label*="Informacoes do contato"]',
      '[aria-label*="Informações do contato"]',
      '[aria-label*="Contact info"]',
      '[role="dialog"]',
      "aside",
    ];
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        const phone = bestPhoneFromElement(element);
        if (phone) {
          return phone;
        }
      }
    }
    return "";
  }

  function phoneFromVisibleLinks() {
    const values = [];
    for (const link of Array.from(document.querySelectorAll('a[href^="tel:"], a[href*="phone="], a[href*="wa.me/"]'))) {
      values.push(link.getAttribute("href"));
      values.push(link.textContent);
      values.push(link.getAttribute("aria-label"));
      values.push(link.getAttribute("title"));
    }
    return bestPhoneFromValues(values);
  }

  function candidatePhoneFromElement(element) {
    const values = [];
    const collect = (node) => {
      if (!node || !node.getAttribute) {
        return;
      }
      values.push(node.getAttribute("data-id"));
      values.push(node.getAttribute("data-pre-plain-text"));
      values.push(node.getAttribute("href"));
    };
    collect(element);
    const descendants = Array.from(
      element.querySelectorAll('[data-id], [data-pre-plain-text], a[href], [href]'),
    );
    for (const node of descendants) {
      collect(node);
    }
    for (const value of values) {
      const waJid = normalizeWaJid(value);
      if (waJid) {
        return normalizePhone(waJid);
      }
    }
    return bestPhoneFromValues(values);
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

  function phoneFromSidebarActive() {
    const sidebar = document.querySelector("#pane-side");
    if (!sidebar) {
      return "";
    }
    const rows = Array.from(
      sidebar.querySelectorAll(
        '[aria-selected="true"], [data-nuoma-active-chat="true"], [data-testid="cell-frame-container"], [role="listitem"]',
      ),
    );
    const activeRows = rows.filter(rowLooksActive);
    const fallbackRows = rows.length === 1 ? rows : [];
    for (const row of [...activeRows, ...fallbackRows]) {
      const phone = candidatePhoneFromElement(row);
      if (phone) {
        return phone;
      }
    }
    return "";
  }

  function elementTitleValue(element) {
    if (!element) {
      return "";
    }
    return (
      text(element.getAttribute && element.getAttribute("title")) ||
      text(element.getAttribute && element.getAttribute("aria-label")) ||
      text(element.textContent)
    );
  }

  function isHeaderControlText(value) {
    const normalized = text(value).toLowerCase();
    if (!normalized) {
      return true;
    }
    return (
      normalized === "dados do perfil" ||
      normalized === "profile details" ||
      normalized === "informacion del perfil" ||
      normalized === "información del perfil" ||
      normalized === "default-contact-refreshed" ||
      normalized.startsWith("ic-") ||
      normalized.startsWith("wds-") ||
      normalized.includes("etiquetar conversa") ||
      normalized.includes("ligação de vídeo") ||
      normalized.includes("video call") ||
      normalized.includes("pesquisar") ||
      normalized.includes("search") ||
      normalized.includes("mais opções") ||
      normalized.includes("more options")
    );
  }

  function conversationTitleFromHeader(header) {
    const explicit =
      header.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
      header.querySelector('[data-testid="conversation-info-header"] span');
    const explicitValue = elementTitleValue(explicit);
    if (explicitValue && !isHeaderControlText(explicitValue)) {
      return explicitValue;
    }

    const candidates = Array.from(header.querySelectorAll("[title], [aria-label], span, div"));
    for (const candidate of candidates) {
      if (candidate.closest && candidate.closest("[data-nuoma-overlay-root]")) {
        continue;
      }
      if (candidate.getAttribute && candidate.getAttribute("role") === "button") {
        continue;
      }
      const value = elementTitleValue(candidate);
      if (value && !isHeaderControlText(value)) {
        return value;
      }
    }

    const fallback = text(header.getAttribute("aria-label")) || text(header.textContent);
    return isHeaderControlText(fallback) ? "" : fallback;
  }

  function findHeader() {
    return (
      document.querySelector("#main header") ||
      document.querySelector('[data-testid="conversation-header"]') ||
      document.querySelector("main header")
    );
  }

  function headerDomSignature(header) {
    if (!header) {
      return "missing-header";
    }
    const controls = Array.from(header.querySelectorAll("button, [role='button'], [data-testid], [aria-label], [title]"))
      .filter((node) => !(node.closest && node.closest("[data-nuoma-overlay-root]")))
      .slice(0, 12)
      .map((node) => {
        const label = text(node.getAttribute && node.getAttribute("aria-label"));
        return [
          node.tagName,
          text(node.getAttribute && node.getAttribute("data-testid")),
          isHeaderControlText(label) ? label : "",
          text(node.getAttribute && node.getAttribute("role")),
        ]
          .filter(Boolean)
          .join(":");
      });
    return controls.join("|") || "header-empty";
  }

  function updateDomGuard(host, header) {
    const signature = headerDomSignature(header);
    if (!state.domSignature) {
      state.domSignature = signature;
    } else if (signature !== state.domSignature && signature !== "missing-header") {
      state.domChanged = true;
      host.setAttribute("data-nuoma-dom-status", "changed");
      host.setAttribute("data-nuoma-dom-signature", signature.slice(0, 180));
      window.dispatchEvent(
        new CustomEvent("nuoma:overlay-dom-changed", {
          detail: {
            previousSignature: state.domSignature,
            currentSignature: signature,
            version: config.version,
            observedAt: new Date().toISOString(),
          },
        }),
      );
    }
    if (!state.domChanged) {
      host.setAttribute("data-nuoma-dom-status", "ok");
    }
    return signature;
  }

  function positionHostByHeaderActions(host, header) {
    if (!header || !header.getBoundingClientRect) {
      host.style.setProperty("--nuoma-fab-inline-end", "72px");
      return;
    }
    const headerRect = header.getBoundingClientRect();
    const actionNodes = Array.from(
      header.querySelectorAll("button, [role='button'], [data-testid], [aria-label]"),
    ).filter((node) => {
      if (node.closest && node.closest("[data-nuoma-overlay-root]")) {
        return false;
      }
      const rect = node.getBoundingClientRect && node.getBoundingClientRect();
      return Boolean(
        rect &&
          rect.width >= 12 &&
          rect.height >= 12 &&
          rect.left > headerRect.left + headerRect.width * 0.42,
      );
    });
    const leftmostAction = actionNodes
      .map((node) => node.getBoundingClientRect().left)
      .sort((a, b) => a - b)[0];
    const offset = Number.isFinite(leftmostAction)
      ? Math.min(190, Math.max(58, Math.round(headerRect.right - leftmostAction + 10)))
      : 72;
    host.style.setProperty("--nuoma-fab-inline-end", offset + "px");
    host.setAttribute("data-nuoma-header-actions", String(actionNodes.length));
  }

  function detectCurrentThread(header) {
    if (!header) {
      return { title: "", phone: "", waJid: "", phoneSource: "missing-header" };
    }

    const title = conversationTitleFromHeader(header);
    const storeWaJid = currentChatJidFromStore();
    if (storeWaJid) {
      return {
        title,
        phone: normalizePhone(storeWaJid),
        waJid: storeWaJid,
        phoneSource: "wa-jid",
      };
    }

    const urlPhone = phoneFromUrl();
    if (urlPhone) {
      return { title, phone: urlPhone, waJid: normalizeWaJid(urlPhone), phoneSource: "url-phone" };
    }

    const messagePhone = phoneFromVisibleMessageIds();
    if (messagePhone) {
      return { title, phone: messagePhone, waJid: normalizeWaJid(messagePhone), phoneSource: "message-data-id" };
    }

    const contactDetailsPhone = phoneFromContactDetails();
    if (contactDetailsPhone) {
      return { title, phone: contactDetailsPhone, waJid: normalizeWaJid(contactDetailsPhone), phoneSource: "contact-details" };
    }

    const sidebarPhone = phoneFromSidebarActive();
    if (sidebarPhone) {
      return { title, phone: sidebarPhone, waJid: normalizeWaJid(sidebarPhone), phoneSource: "sidebar-active" };
    }

    const linkPhone = phoneFromVisibleLinks();
    if (linkPhone) {
      return { title, phone: linkPhone, waJid: normalizeWaJid(linkPhone), phoneSource: "visible-link" };
    }

    return { title, phone: "", waJid: "", phoneSource: "unresolved" };
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

    const brandMarkup =
      '<span class="nuoma-brand-button" aria-hidden="true">' +
      '<span class="nuoma-brand-mark">N</span>' +
      '<span class="nuoma-brand-status"></span>' +
      '</span>';

    let button = shadow.querySelector("[data-nuoma-fab]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "nuoma-fab";
      button.setAttribute("data-nuoma-fab", "");
      button.setAttribute("data-testid", config.fabTestId);
      button.addEventListener("click", () => {
        const nextState = host.getAttribute("data-nuoma-state") === "open" ? "closed" : "open";
        setOpen(host, nextState === "open");
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
    button.setAttribute("aria-label", "Abrir painel Nuoma");
    button.setAttribute("title", "Abrir painel Nuoma");
    if (!button.querySelector(".nuoma-brand-mark") || button.querySelector(".nuoma-octo-art")) {
      button.innerHTML = brandMarkup;
    }
    button.setAttribute("aria-controls", config.panelTestId);
    button.setAttribute("aria-expanded", String(host.getAttribute("data-nuoma-state") === "open"));
    ensureBrandAnimation();

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
      panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(host, false);
          return;
        }
        handleOverlayShortcut(event, host);
      });
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
    restartBrandAnimation();
    if (open) {
      void refreshContactFromApi(host, "panel-open");
      setTimeout(() => {
        host.shadowRoot?.querySelector("[data-nuoma-panel-body]")?.focus();
      }, 0);
    } else {
      host.shadowRoot?.querySelector("[data-nuoma-fab]")?.focus({ preventScroll: true });
      setTimeout(() => {
        host.shadowRoot?.querySelector("[data-nuoma-fab]")?.focus({ preventScroll: true });
      }, 0);
    }
  }

  function reidentifyCurrentThread(host, reason) {
    const header = findHeader();
    if (!header) {
      renderPanel(host);
      return Promise.resolve(null);
    }
    const thread = detectCurrentThread(header);
    const phone = thread.phone || "";
    const waJid = thread.waJid || "";
    if (phone || waJid) {
      state.data = {
        ...(state.data || {}),
        phone,
        waJid,
        phoneSource: thread.phoneSource,
        title: thread.title,
        source: "dom",
        updatedAt: new Date().toISOString(),
      };
      host.setAttribute("data-nuoma-thread-phone", phone);
      host.setAttribute("data-nuoma-wa-jid", waJid);
      host.setAttribute("data-nuoma-phone-source", thread.phoneSource);
      host.setAttribute("data-nuoma-thread-title", thread.title);
      renderPanel(host);
      window.dispatchEvent(
        new CustomEvent("nuoma:overlay-reidentified", {
          detail: { phone, waJid, phoneSource: thread.phoneSource, title: thread.title, reason: reason || "manual" },
        }),
      );
      return Promise.resolve({ ok: true, source: "dom", phone, waJid });
    }
    renderPanel(host);
    return refreshContactFromApi(host, reason || "reidentify");
  }

  function reconnectApiBridge(host) {
    state.apiBridge = null;
    setApiStatus("offline", "", "");
    installNuomaApi();
    renderPanel(host);
    return refreshContactFromApi(host, "reconnect-api");
  }

  function refreshContactFromApi(host, reason) {
    installNuomaApi();
    if (state.apiInFlight || !window.__nuomaApi || typeof window.__nuomaApi.refreshContact !== "function") {
      return Promise.resolve(null);
    }
    const phone = host.getAttribute("data-nuoma-thread-phone") || "";
    const waJid = host.getAttribute("data-nuoma-wa-jid") || "";
    const title = host.getAttribute("data-nuoma-thread-title") || "";
    const hydrateKey = waJid || phone;
    if (!hydrateKey) {
      return Promise.resolve(null);
    }
    state.apiHydratedPhone = hydrateKey;
    state.apiInFlight = true;
    renderPanel(host);
    return window.__nuomaApi
      .refreshContact({
        phone,
        waJid,
        phoneSource: host.getAttribute("data-nuoma-phone-source") || "",
        title,
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

  function forceSyncCurrentConversation(host) {
    installNuomaApi();
    if (state.apiInFlight || !window.__nuomaApi || typeof window.__nuomaApi.forceConversationSync !== "function") {
      return Promise.resolve(null);
    }
    const phone = host.getAttribute("data-nuoma-thread-phone") || "";
    const waJid = host.getAttribute("data-nuoma-wa-jid") || "";
    if (!phone && !waJid) {
      return Promise.resolve(null);
    }
    const currentConversation =
      state.data &&
      Array.isArray(state.data.conversations) &&
      state.data.conversations[0] &&
      typeof state.data.conversations[0].id === "number"
        ? state.data.conversations[0]
        : null;
    state.apiInFlight = true;
    state.data = {
      ...(state.data || {}),
      syncStatus: "running",
      apiStatus: "loading",
      apiLastMethod: "forceConversationSync",
      apiLastError: null,
    };
    renderPanel(host);
    return window.__nuomaApi
      .forceConversationSync({
        phone,
        waJid,
        phoneSource: host.getAttribute("data-nuoma-phone-source") || "",
        title: host.getAttribute("data-nuoma-thread-title") || "",
        conversationId: currentConversation ? currentConversation.id : null,
        reason: "overlay-button",
      })
      .then((response) => {
        if (!response || !response.ok) {
          state.data = {
            ...(state.data || {}),
            syncStatus: "error",
            apiStatus: "error",
            apiLastMethod: "forceConversationSync",
            apiLastError:
              response && response.error && response.error.message
                ? response.error.message
                : "Falha ao forcar sync",
          };
        }
        renderPanel(host);
        return response;
      })
      .finally(() => {
        state.apiInFlight = false;
        renderPanel(host);
      });
  }

  function copyPhoneToClipboard(phone, host) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return Promise.resolve(false);
    }
    const writeText =
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : null;
    const copied = writeText
      ? writeText(normalizedPhone).then(() => true)
      : Promise.resolve(false);
    return copied
      .then((ok) => {
        state.data = {
          ...(state.data || {}),
          apiStatus: ok ? "copied" : state.apiStatus,
          apiLastMethod: "copyPhone",
          apiLastError: ok ? null : "clipboard_indisponivel",
        };
        renderPanel(host);
        return ok;
      })
      .catch((error) => {
        state.data = {
          ...(state.data || {}),
          apiStatus: "error",
          apiLastMethod: "copyPhone",
          apiLastError: error && error.message ? error.message : "clipboard_indisponivel",
        };
        renderPanel(host);
        return false;
      });
  }

  function runCampaignForCurrentPhone(host, campaign) {
    installNuomaApi();
    if (state.apiInFlight || !window.__nuomaApi || typeof window.__nuomaApi.runCampaignForPhone !== "function") {
      return Promise.resolve(null);
    }
    const phone = host.getAttribute("data-nuoma-thread-phone") || (state.data && state.data.phone) || "";
    const waJid = host.getAttribute("data-nuoma-wa-jid") || (state.data && state.data.waJid) || "";
    const campaignId = Number(campaign && campaign.id);
    if ((!phone && !waJid) || !Number.isFinite(campaignId) || campaignId <= 0) {
      return Promise.resolve(null);
    }
    state.apiInFlight = true;
    state.data = {
      ...(state.data || {}),
      campaignRunStatus: "running",
      campaignRunLastError: null,
      apiStatus: "loading",
      apiLastMethod: "runCampaignForPhone",
      apiLastError: null,
    };
    renderPanel(host);
    return window.__nuomaApi
      .runCampaignForPhone({
        campaignId,
        phone,
        waJid,
        phoneSource: host.getAttribute("data-nuoma-phone-source") || "",
        title: host.getAttribute("data-nuoma-thread-title") || "",
        reason: "overlay-campaign-button",
      })
      .then((response) => {
        if (!response || !response.ok) {
          state.data = {
            ...(state.data || {}),
            campaignRunStatus: "error",
            campaignRunLastError:
              response && response.error && response.error.message
                ? response.error.message
                : "Campanha bloqueada",
            apiStatus: "error",
            apiLastMethod: "runCampaignForPhone",
            apiLastError:
              response && response.error && response.error.message
                ? response.error.message
                : "Campanha bloqueada",
          };
        }
        renderPanel(host);
        return response;
      })
      .finally(() => {
        state.apiInFlight = false;
        renderPanel(host);
      });
  }

  function runAutomationForCurrentPhone(host, automation) {
    installNuomaApi();
    if (state.apiInFlight || !window.__nuomaApi || typeof window.__nuomaApi.runAutomationForPhone !== "function") {
      return Promise.resolve(null);
    }
    const phone = host.getAttribute("data-nuoma-thread-phone") || (state.data && state.data.phone) || "";
    const waJid = host.getAttribute("data-nuoma-wa-jid") || (state.data && state.data.waJid) || "";
    const automationId = Number(automation && automation.id);
    if ((!phone && !waJid) || !Number.isFinite(automationId) || automationId <= 0) {
      return Promise.resolve(null);
    }
    state.apiInFlight = true;
    state.data = {
      ...(state.data || {}),
      automationRunStatus: "running",
      automationRunLastError: null,
      apiStatus: "loading",
      apiLastMethod: "runAutomationForPhone",
      apiLastError: null,
    };
    renderPanel(host);
    return window.__nuomaApi
      .runAutomationForPhone({
        automationId,
        phone,
        waJid,
        phoneSource: host.getAttribute("data-nuoma-phone-source") || "",
        title: host.getAttribute("data-nuoma-thread-title") || "",
        reason: "overlay-automation-button",
      })
      .then((response) => {
        if (!response || !response.ok) {
          state.data = {
            ...(state.data || {}),
            automationRunStatus: "error",
            automationRunLastError:
              response && response.error && response.error.message
                ? response.error.message
                : "Automacao bloqueada",
            apiStatus: "error",
            apiLastMethod: "runAutomationForPhone",
            apiLastError:
              response && response.error && response.error.message
                ? response.error.message
                : "Automacao bloqueada",
          };
        }
        renderPanel(host);
        return response;
      })
      .finally(() => {
        state.apiInFlight = false;
        renderPanel(host);
      });
  }

  function overlayIdentityParams(host, extra) {
    return {
      phone: host.getAttribute("data-nuoma-thread-phone") || (state.data && state.data.phone) || "",
      waJid: host.getAttribute("data-nuoma-wa-jid") || (state.data && state.data.waJid) || "",
      phoneSource: host.getAttribute("data-nuoma-phone-source") || "",
      threadTitle: host.getAttribute("data-nuoma-thread-title") || "",
      ...(extra || {}),
    };
  }

  function runQuickActionForCurrentContact(host, method, params) {
    installNuomaApi();
    const api = window.__nuomaApi || {};
    const action = api[method];
    if (state.apiInFlight || typeof action !== "function") {
      return Promise.resolve(null);
    }
    const identity = overlayIdentityParams(host);
    if (!identity.phone && !identity.waJid) {
      return Promise.resolve(null);
    }
    state.apiInFlight = true;
    state.data = {
      ...(state.data || {}),
      quickActionStatus: "running",
      quickActionLastError: null,
      apiStatus: "loading",
      apiLastMethod: method,
      apiLastError: null,
    };
    renderPanel(host);
    return action(overlayIdentityParams(host, params || {}))
      .then((response) => {
        if (!response || !response.ok) {
          state.data = {
            ...(state.data || {}),
            quickActionStatus: "error",
            quickActionLastError:
              response && response.error && response.error.message
                ? response.error.message
                : "Ação rápida bloqueada",
            apiStatus: "error",
            apiLastMethod: method,
            apiLastError:
              response && response.error && response.error.message
                ? response.error.message
                : "Ação rápida bloqueada",
          };
        }
        renderPanel(host);
        return response;
      })
      .finally(() => {
        state.apiInFlight = false;
        renderPanel(host);
      });
  }

  function isTextEntryTarget(target) {
    if (!target || !target.matches) {
      return false;
    }
    return (
      target.matches("input, textarea, select") ||
      target.getAttribute("contenteditable") === "true" ||
      Boolean(target.closest && target.closest("[contenteditable='true']"))
    );
  }

  function toggleDebugLocators(host) {
    state.debugLocators = !state.debugLocators;
    host.setAttribute("data-nuoma-debug", state.debugLocators ? "true" : "false");
    renderPanel(host);
  }

  function handleOverlayShortcut(event, host) {
    if (event.altKey || event.ctrlKey || event.metaKey || isTextEntryTarget(event.target)) {
      return;
    }
    const key = text(event.key).toLowerCase();
    if (key === "r") {
      event.preventDefault();
      void refreshContactFromApi(host, "shortcut-refresh");
    } else if (key === "s") {
      event.preventDefault();
      void forceSyncCurrentConversation(host);
    } else if (key === "c") {
      event.preventDefault();
      void copyPhoneToClipboard(
        host.getAttribute("data-nuoma-thread-phone") || (state.data && state.data.phone) || "",
        host,
      );
    } else if (key === "d") {
      event.preventDefault();
      toggleDebugLocators(host);
    }
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
    const waJid = text(data.waJid) || host.getAttribute("data-nuoma-wa-jid") || "";
    const phoneSource = text(data.phoneSource) || host.getAttribute("data-nuoma-phone-source") || "";
    const contact = data.contact || null;
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const contactTagIds = Array.isArray(contact && contact.tagIds) ? contact.tagIds : [];
    const reminders = Array.isArray(data.reminders) ? data.reminders : [];
    const conversations = Array.isArray(data.conversations) ? data.conversations : [];
    const latestMessages = Array.isArray(data.latestMessages) ? data.latestMessages : [];
    const automations = Array.isArray(data.automations) ? data.automations : [];
    const automationHistory = Array.isArray(data.automationHistory) ? data.automationHistory : [];
    const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    const notes = text(data.notes) || text(contact && contact.notes);
    const apiStatus = text(data.apiStatus) || text(state.apiStatus) || "offline";
    const apiLastMethod = text(data.apiLastMethod) || text(state.apiLastMethod);
    const apiLastError = text(data.apiLastError) || text(state.apiLastError);
    const syncStatus = text(data.syncStatus);
    const syncLastResult = data.syncLastResult || null;
    const campaignRunStatus = text(data.campaignRunStatus);
    const campaignRunLastResult = data.campaignRunLastResult || null;
    const campaignRunLastError = text(data.campaignRunLastError);
    const automationRunStatus = text(data.automationRunStatus);
    const automationRunLastResult = data.automationRunLastResult || null;
    const automationRunLastError = text(data.automationRunLastError);
    const quickActionStatus = text(data.quickActionStatus);
    const quickActionLastResult = data.quickActionLastResult || null;
    const quickActionLastError = text(data.quickActionLastError);
    const isApiLoading =
      apiStatus === "loading" || (state.apiInFlight && apiStatus !== "online" && apiStatus !== "error");
    const hasApiError = apiStatus === "error" || Boolean(apiLastError);
    const hasDispatchTarget = Boolean(phone || waJid);
    const hasNoContact =
      Boolean(phone || waJid) && !isApiLoading && !hasApiError && data.source === "nuoma-api" && contact === null;

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
      phone ? "+" + phone : "Telefone não identificado",
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
    body.setAttribute("data-nuoma-panel-body", "");
    body.setAttribute("data-nuoma-locator", "panel-body");
    body.tabIndex = 0;

    if (isApiLoading) {
      appendPanelState(
        body,
        "Carregando contato",
        "Buscando resumo, automações elegíveis, mensagens recentes e notas pelo bridge seguro.",
        "loading",
      );
    }

    if (hasApiError) {
      const errorCard = appendPanelState(
        body,
        "Erro na ponte API",
        apiLastError || "Não foi possível hidratar este contato agora. O painel continua em modo leitura local.",
        "error",
      );
      const errorActions = document.createElement("div");
      errorActions.className = "nuoma-inline-actions";
      const reconnect = document.createElement("button");
      reconnect.type = "button";
      reconnect.className = "nuoma-small-action";
      reconnect.textContent = "Reconectar ponte";
      reconnect.setAttribute("aria-label", "Reconectar ponte API do overlay");
      reconnect.addEventListener("click", () => {
        void reconnectApiBridge(host);
      });
      errorActions.appendChild(reconnect);
      errorCard.appendChild(errorActions);
    }

    if (hasNoContact) {
      const stateCard = appendPanelState(
        body,
        "Contato não encontrado no CRM",
        "O telefone foi detectado no WhatsApp, mas ainda não existe contato vinculado no Nuoma. Sincronize a conversa ou copie o numero para criar o cadastro na tela de contatos.",
        "empty-contact",
      );
      const actions = document.createElement("div");
      actions.className = "nuoma-empty-actions";
      const syncAction = document.createElement("button");
      syncAction.type = "button";
      syncAction.className = "nuoma-empty-action";
      syncAction.disabled = !hasDispatchTarget || state.apiInFlight;
      syncAction.setAttribute("aria-label", "Sincronizar conversa para criar resumo do contato");
      syncAction.textContent = state.apiInFlight ? "Sincronizando..." : "Sincronizar conversa";
      syncAction.addEventListener("click", () => {
        void forceSyncCurrentConversation(host);
      });
      actions.appendChild(syncAction);
      const copyAction = document.createElement("button");
      copyAction.type = "button";
      copyAction.className = "nuoma-empty-action";
      copyAction.disabled = !phone;
      copyAction.setAttribute("aria-label", "Copiar telefone detectado");
      copyAction.textContent = "Copiar telefone";
      copyAction.addEventListener("click", () => {
        void copyPhoneToClipboard(phone, host);
      });
      actions.appendChild(copyAction);
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

    const syncSection = section(
      "Sync",
      syncStatus === "running" ? "ativo" : syncStatus === "done" ? "atualizado" : syncStatus === "error" ? "erro" : "manual",
    );
    const syncActions = document.createElement("div");
    syncActions.className = "nuoma-action-row";
    if (syncStatus === "running") {
      const live = appendText(syncActions, "div", "nuoma-sync-live", "Sync ativo");
      live.setAttribute("data-nuoma-sync-indicator", "running");
    }
    const syncButton = document.createElement("button");
    syncButton.type = "button";
    syncButton.className = "nuoma-action";
    syncButton.textContent = state.apiInFlight ? "Sincronizando..." : "Forçar sync";
    syncButton.disabled = !hasDispatchTarget || state.apiInFlight;
    syncButton.setAttribute(
      "aria-label",
      hasDispatchTarget ? "Forçar sync da conversa atual" : "Sync bloqueado sem identidade identificada",
    );
    syncButton.title = hasDispatchTarget
      ? "Rele a conversa atual pelo WhatsApp Web"
      : "Identifique o telefone ou JID para liberar o sync manual";
    syncButton.addEventListener("click", () => {
      void forceSyncCurrentConversation(host);
    });
    syncActions.appendChild(syncButton);
    const syncNote = document.createElement("div");
    syncNote.className = "nuoma-sync-note";
    if (syncLastResult && syncStatus === "done") {
      const history = syncLastResult.history || null;
      syncNote.textContent = [
        syncLastResult.mode || "sync",
        syncLastResult.phone ? "+" + syncLastResult.phone : "",
        history ? "janelas " + (history.syncedWindows || 0) : "",
        history && history.stoppedReason ? history.stoppedReason : "",
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      syncNote.textContent = hasDispatchTarget
        ? "Rele a conversa atual pelo WhatsApp Web e grava mensagens por ID unico."
        : "Abra uma conversa individual para liberar o sync manual.";
    }
    syncActions.appendChild(syncNote);
    syncSection.appendChild(syncActions);
    body.appendChild(syncSection);

    const quickSection = section("Ação rápida", hasDispatchTarget ? "número atual" : "sem número");
    const quickGrid = document.createElement("div");
    quickGrid.className = "nuoma-quick-grid";

    const selectedCampaign =
      campaigns.find((campaign) => String(campaign.id || "") === text(state.quickCampaignId)) ||
      campaigns.find((campaign) => campaign.eligible) ||
      campaigns[0] ||
      null;
    if (selectedCampaign && selectedCampaign.id) {
      state.quickCampaignId = String(selectedCampaign.id);
    }
    const campaignQuickRow = document.createElement("div");
    campaignQuickRow.className = "nuoma-quick-row";
    const campaignSelect = document.createElement("select");
    campaignSelect.className = "nuoma-select";
    campaignSelect.setAttribute("aria-label", "Selecionar campanha para disparar no número atual");
    campaignSelect.setAttribute("data-nuoma-quick-campaign", "true");
    campaignSelect.disabled = campaigns.length === 0 || state.apiInFlight;
    for (const campaign of campaigns.slice(0, 5)) {
      const option = document.createElement("option");
      option.value = String(campaign.id || "");
      option.textContent = text(campaign.name) || "Campanha sem nome";
      option.disabled = !campaign.eligible;
      option.selected = selectedCampaign && campaign.id === selectedCampaign.id;
      campaignSelect.appendChild(option);
    }
    campaignSelect.addEventListener("change", () => {
      state.quickCampaignId = campaignSelect.value;
      renderPanel(host);
    });
    campaignQuickRow.appendChild(campaignSelect);
    const campaignQuickButton = document.createElement("button");
    campaignQuickButton.type = "button";
    campaignQuickButton.className = "nuoma-action";
    campaignQuickButton.textContent =
      state.apiInFlight && campaignRunStatus === "running" ? "Rodando..." : "Disparar campanha";
    campaignQuickButton.disabled =
      !hasDispatchTarget || !selectedCampaign || !selectedCampaign.eligible || state.apiInFlight;
    campaignQuickButton.setAttribute("data-nuoma-quick-run-campaign", "true");
    campaignQuickButton.title = !hasDispatchTarget
      ? "Identifique o telefone para disparar campanha"
      : selectedCampaign && !selectedCampaign.eligible
        ? (selectedCampaign.reasons || [])[0] || "Campanha bloqueada para este contato"
        : "Enfileira a campanha selecionada somente para o número atual";
    campaignQuickButton.addEventListener("click", () => {
      const campaign =
        campaigns.find((candidate) => String(candidate.id || "") === text(state.quickCampaignId)) ||
        selectedCampaign;
      void runCampaignForCurrentPhone(host, campaign);
    });
    campaignQuickRow.appendChild(campaignQuickButton);
    quickGrid.appendChild(campaignQuickRow);

    const selectedAutomation =
      automations.find((automation) => String(automation.id || "") === text(state.quickAutomationId)) ||
      automations.find((automation) => automation.eligible) ||
      automations[0] ||
      null;
    if (selectedAutomation && selectedAutomation.id) {
      state.quickAutomationId = String(selectedAutomation.id);
    }
    const automationQuickRow = document.createElement("div");
    automationQuickRow.className = "nuoma-quick-row";
    const automationSelect = document.createElement("select");
    automationSelect.className = "nuoma-select";
    automationSelect.setAttribute("aria-label", "Selecionar automação para disparar no número atual");
    automationSelect.setAttribute("data-nuoma-quick-automation", "true");
    automationSelect.disabled = automations.length === 0 || state.apiInFlight;
    for (const automation of automations.slice(0, 5)) {
      const option = document.createElement("option");
      option.value = String(automation.id || "");
      option.textContent = text(automation.name) || "Automacao sem nome";
      option.disabled = !automation.eligible;
      option.selected = selectedAutomation && automation.id === selectedAutomation.id;
      automationSelect.appendChild(option);
    }
    automationSelect.addEventListener("change", () => {
      state.quickAutomationId = automationSelect.value;
      renderPanel(host);
    });
    automationQuickRow.appendChild(automationSelect);
    const automationQuickButton = document.createElement("button");
    automationQuickButton.type = "button";
    automationQuickButton.className = "nuoma-action";
    automationQuickButton.textContent =
      state.apiInFlight && automationRunStatus === "running" ? "Rodando..." : "Disparar automação";
    automationQuickButton.disabled =
      !hasDispatchTarget || !selectedAutomation || !selectedAutomation.eligible || state.apiInFlight;
    automationQuickButton.setAttribute("data-nuoma-quick-run-automation", "true");
    automationQuickButton.title = !hasDispatchTarget
      ? "Identifique o telefone para disparar automação"
      : selectedAutomation && !selectedAutomation.eligible
        ? (selectedAutomation.reasons || [])[0] || "Automacao bloqueada para este contato"
        : "Executa a automação selecionada somente no número atual";
    automationQuickButton.addEventListener("click", () => {
      const automation =
        automations.find((candidate) => String(candidate.id || "") === text(state.quickAutomationId)) ||
        selectedAutomation;
      void runAutomationForCurrentPhone(host, automation);
    });
    automationQuickRow.appendChild(automationQuickButton);
    quickGrid.appendChild(automationQuickRow);

    const selectedTag =
      tags.find((tag) => String(tag.id || "") === text(state.quickTagId)) || tags[0] || null;
    if (selectedTag && selectedTag.id) {
      state.quickTagId = String(selectedTag.id);
    }
    const tagQuickRow = document.createElement("div");
    tagQuickRow.className = "nuoma-quick-row";
    tagQuickRow.setAttribute("data-nuoma-locator", "quick-tag");
    const tagSelect = document.createElement("select");
    tagSelect.className = "nuoma-select";
    tagSelect.setAttribute("aria-label", "Selecionar tag para aplicar ou remover");
    tagSelect.setAttribute("data-nuoma-quick-tag", "true");
    tagSelect.disabled = tags.length === 0 || state.apiInFlight || !contact;
    for (const tag of tags.slice(0, 8)) {
      const option = document.createElement("option");
      option.value = String(tag.id || "");
      option.textContent = text(tag.name) || "Tag sem nome";
      option.selected = selectedTag && tag.id === selectedTag.id;
      tagSelect.appendChild(option);
    }
    tagSelect.addEventListener("change", () => {
      state.quickTagId = tagSelect.value;
      renderPanel(host);
    });
    tagQuickRow.appendChild(tagSelect);
    const tagButtons = document.createElement("div");
    tagButtons.className = "nuoma-inline-actions";
    const applyTagButton = document.createElement("button");
    applyTagButton.type = "button";
    applyTagButton.className = "nuoma-small-action";
    applyTagButton.textContent = "Aplicar";
    applyTagButton.disabled = !hasDispatchTarget || !contact || !selectedTag || state.apiInFlight;
    applyTagButton.setAttribute("data-nuoma-quick-apply-tag", "true");
    applyTagButton.addEventListener("click", () => {
      void runQuickActionForCurrentContact(host, "applyTag", {
        tagId: Number(state.quickTagId),
      });
    });
    tagButtons.appendChild(applyTagButton);
    const removeTagButton = document.createElement("button");
    removeTagButton.type = "button";
    removeTagButton.className = "nuoma-small-action";
    removeTagButton.textContent = "Remover";
    removeTagButton.disabled =
      !hasDispatchTarget ||
      !contact ||
      !selectedTag ||
      !contactTagIds.includes(Number(selectedTag.id)) ||
      state.apiInFlight;
    removeTagButton.setAttribute("data-nuoma-quick-remove-tag", "true");
    removeTagButton.addEventListener("click", () => {
      void runQuickActionForCurrentContact(host, "removeTag", {
        tagId: Number(state.quickTagId),
      });
    });
    tagButtons.appendChild(removeTagButton);
    tagQuickRow.appendChild(tagButtons);
    quickGrid.appendChild(tagQuickRow);

    const statuses = ["lead", "active", "inactive", "blocked", "archived"];
    const statusQuickRow = document.createElement("div");
    statusQuickRow.className = "nuoma-quick-row";
    statusQuickRow.setAttribute("data-nuoma-locator", "quick-status");
    const statusSelect = document.createElement("select");
    statusSelect.className = "nuoma-select";
    statusSelect.setAttribute("aria-label", "Selecionar status do contato");
    statusSelect.setAttribute("data-nuoma-quick-status", "true");
    statusSelect.disabled = !contact || state.apiInFlight;
    const selectedStatus = text(state.quickStatus) || text(contact && contact.status) || "lead";
    for (const status of statuses) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      option.selected = status === selectedStatus;
      statusSelect.appendChild(option);
    }
    statusSelect.addEventListener("change", () => {
      state.quickStatus = statusSelect.value;
      renderPanel(host);
    });
    statusQuickRow.appendChild(statusSelect);
    const statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.className = "nuoma-action";
    statusButton.textContent = "Salvar status";
    statusButton.disabled = !hasDispatchTarget || !contact || state.apiInFlight;
    statusButton.setAttribute("data-nuoma-quick-set-status", "true");
    statusButton.addEventListener("click", () => {
      void runQuickActionForCurrentContact(host, "setStatus", {
        status: statusSelect.value,
      });
    });
    statusQuickRow.appendChild(statusButton);
    quickGrid.appendChild(statusQuickRow);

    const reminderQuickRow = document.createElement("div");
    reminderQuickRow.className = "nuoma-quick-row";
    reminderQuickRow.setAttribute("data-nuoma-locator", "quick-reminder");
    appendText(
      reminderQuickRow,
      "div",
      "nuoma-sync-note",
      reminders.length
        ? [text(reminders[0].title) || "Lembrete aberto", shortDate(reminders[0].dueAt)].filter(Boolean).join(" · ")
        : "Sem lembrete aberto",
    );
    const reminderButton = document.createElement("button");
    reminderButton.type = "button";
    reminderButton.className = "nuoma-action";
    reminderButton.textContent = "Lembrar amanha";
    reminderButton.disabled = !hasDispatchTarget || !contact || state.apiInFlight;
    reminderButton.setAttribute("data-nuoma-quick-create-reminder", "true");
    reminderButton.addEventListener("click", () => {
      void runQuickActionForCurrentContact(host, "createReminder", {
        title: "Retornar pelo WhatsApp",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        notes: "Criado pelo overlay Nuoma no WhatsApp Web.",
      });
    });
    reminderQuickRow.appendChild(reminderButton);
    quickGrid.appendChild(reminderQuickRow);

    if (quickActionStatus || quickActionLastResult || quickActionLastError) {
      appendText(
        quickGrid,
        "div",
        "nuoma-empty" + (quickActionStatus === "error" ? " nuoma-warning" : ""),
        quickActionStatus === "running"
          ? "Aplicando acao rapida."
          : quickActionStatus === "done"
            ? "Ação rápida aplicada" +
              (quickActionLastResult && quickActionLastResult.changed === false ? " sem alteracao." : ".")
            : quickActionLastError || "Ação rápida bloqueada.",
      );
    }
    quickSection.appendChild(quickGrid);
    body.appendChild(quickSection);

    const campaignSection = section("Campanhas", campaigns.length ? String(campaigns.length) : "0");
    const campaignList = document.createElement("div");
    campaignList.className = "nuoma-list";
    if (campaigns.length === 0) {
      appendText(
        campaignList,
        "div",
        "nuoma-empty",
        phone ? "Nenhuma campanha elegível para este numero." : "Identifique o telefone para listar campanhas.",
      );
    } else {
      for (const campaign of campaigns.slice(0, 5)) {
        const item = document.createElement("div");
        item.className = "nuoma-list-item";
        const title = appendText(item, "strong", "", text(campaign.name) || "Campanha sem nome");
        title.title = text(campaign.name) || "";
        const actions = document.createElement("div");
        actions.className = "nuoma-campaign-actions";
        const meta = document.createElement("div");
        meta.className = "nuoma-campaign-meta";
        meta.appendChild(campaignChip(campaign.eligible ? "elegível" : "bloqueada", campaign.eligible ? "ok" : "blocked"));
        meta.appendChild(campaignChip(campaign.overlayEnabled ? "overlay sim" : "overlay não", campaign.overlayEnabled ? "ok" : "blocked"));
        meta.appendChild(campaignChip(text(campaign.status) || "status", ""));
        meta.appendChild(campaignChip(String(campaign.stepsCount || 0) + " step(s)", ""));
        if (campaign.firstStepType) {
          meta.appendChild(campaignChip(text(campaign.firstStepType), ""));
        }
        actions.appendChild(meta);
        const reasons = Array.isArray(campaign.reasons) ? campaign.reasons.filter(Boolean) : [];
        const runButton = document.createElement("button");
        runButton.type = "button";
        runButton.className = "nuoma-action";
        runButton.textContent = state.apiInFlight && campaignRunStatus === "running" ? "Rodando..." : "Rodar campanha";
        runButton.disabled = !hasDispatchTarget || !campaign.eligible || state.apiInFlight;
        runButton.setAttribute(
          "aria-label",
          "Rodar campanha " + (text(campaign.name) || String(campaign.id || "")) + " para o número atual",
        );
        runButton.title = !hasDispatchTarget
          ? "Identifique o telefone para rodar campanha"
          : !campaign.eligible
            ? reasons[0] || "Campanha bloqueada para este contato"
            : "Enfileira esta campanha para o número detectado";
        runButton.setAttribute("data-nuoma-campaign-run", String(campaign.id || ""));
        runButton.addEventListener("click", () => {
          void runCampaignForCurrentPhone(host, campaign);
        });
        actions.appendChild(runButton);
        item.appendChild(actions);
        if (reasons.length > 0) {
          const reasonList = document.createElement("div");
          reasonList.className = "nuoma-diagnostics";
          for (const reason of reasons.slice(0, 3)) {
            appendText(reasonList, "span", "", "Bloqueio: " + text(reason));
          }
          item.appendChild(reasonList);
        }
        campaignList.appendChild(item);
      }
    }
    campaignSection.appendChild(campaignList);
    if (campaignRunStatus || campaignRunLastResult || campaignRunLastError) {
      const resultText =
        campaignRunStatus === "running"
          ? "Enfileirando campanha agora."
          : campaignRunStatus === "done" && campaignRunLastResult
            ? "Criou " +
              (campaignRunLastResult.recipientsCreated || 0) +
              " recipient(s) e " +
              (campaignRunLastResult.jobsCreated || 0) +
              " job(s)."
            : campaignRunLastError || "Campanha bloqueada.";
      appendText(
        campaignSection,
        "div",
        "nuoma-empty" + (campaignRunStatus === "error" ? " nuoma-warning" : ""),
        resultText,
      );
    }
    body.appendChild(campaignSection);

    const automationSection = section("Automacoes", automations.length ? String(automations.length) : "0");
    const automationList = document.createElement("div");
    automationList.className = "nuoma-list";
    if (automations.length === 0) {
      appendText(automationList, "div", "nuoma-empty", "Nenhuma automação elegível para este contato.");
    } else {
      for (const automation of automations.slice(0, 5)) {
        const item = document.createElement("div");
        item.className = "nuoma-list-item";
        appendText(item, "strong", "", text(automation.name) || "Automacao sem nome");
        const actions = document.createElement("div");
        actions.className = "nuoma-campaign-actions";
        const meta = document.createElement("div");
        meta.className = "nuoma-campaign-meta";
        meta.appendChild(campaignChip(automation.eligible ? "elegível" : "bloqueada", automation.eligible ? "ok" : "blocked"));
        meta.appendChild(campaignChip(automation.overlayEnabled ? "overlay sim" : "overlay não", automation.overlayEnabled ? "ok" : "blocked"));
        meta.appendChild(campaignChip(text(automation.status) || "status", ""));
        meta.appendChild(campaignChip(String(automation.actionsCount || 0) + " acao(oes)", ""));
        if (automation.wouldEnqueueJobs) {
          meta.appendChild(campaignChip(String(automation.sendStepsCount || 0) + " envio(s)", ""));
        }
        actions.appendChild(meta);
        const reasons = Array.isArray(automation.reasons) ? automation.reasons.filter(Boolean) : [];
        const runButton = document.createElement("button");
        runButton.type = "button";
        runButton.className = "nuoma-action";
        runButton.textContent = state.apiInFlight && automationRunStatus === "running" ? "Rodando..." : "Rodar automação";
        runButton.disabled = !hasDispatchTarget || !automation.eligible || state.apiInFlight;
        runButton.setAttribute(
          "aria-label",
          "Rodar automação " + (text(automation.name) || String(automation.id || "")) + " para o número atual",
        );
        runButton.title = !hasDispatchTarget
          ? "Identifique o telefone para rodar automação"
          : !automation.eligible
            ? reasons[0] || "Automacao bloqueada para este contato"
            : "Executa esta automação para o número detectado";
        runButton.setAttribute("data-nuoma-automation-run", String(automation.id || ""));
        runButton.addEventListener("click", () => {
          void runAutomationForCurrentPhone(host, automation);
        });
        actions.appendChild(runButton);
        item.appendChild(actions);
        appendText(
          item,
          "span",
          "",
          [automation.category, automation.triggerChannel || "whatsapp"].filter(Boolean).join(" · ") || "ativa",
        );
        if (reasons.length > 0) {
          const reasonList = document.createElement("div");
          reasonList.className = "nuoma-diagnostics";
          for (const reason of reasons.slice(0, 3)) {
            appendText(reasonList, "span", "", "Bloqueio: " + text(reason));
          }
          item.appendChild(reasonList);
        }
        automationList.appendChild(item);
      }
    }
    automationSection.appendChild(automationList);
    if (automationRunStatus || automationRunLastResult || automationRunLastError) {
      const resultText =
        automationRunStatus === "running"
          ? "Executando automação agora."
          : automationRunStatus === "done" && automationRunLastResult
            ? "Criou " +
              (automationRunLastResult.jobsCreated || 0) +
              " job(s) e aplicou " +
              (automationRunLastResult.actionsApplied || 0) +
              " acao(oes)."
            : automationRunLastError || "Automacao bloqueada.";
      appendText(
        automationSection,
        "div",
        "nuoma-empty" + (automationRunStatus === "error" ? " nuoma-warning" : ""),
        resultText,
      );
    }
    body.appendChild(automationSection);

    const historySection = section(
      "Histórico automações",
      automationHistory.length ? String(automationHistory.length) : "0",
    );
    const historyList = document.createElement("div");
    historyList.className = "nuoma-list";
    historyList.setAttribute("data-nuoma-automation-history", "true");
    if (automationHistory.length === 0) {
      appendText(historyList, "div", "nuoma-empty", "Nenhuma automação disparada por overlay para este contato.");
    } else {
      for (const item of automationHistory.slice(0, 5)) {
        const row = document.createElement("div");
        row.className = "nuoma-list-item";
        row.setAttribute("data-nuoma-locator", "automation-history-item");
        appendText(
          row,
          "strong",
          "",
          "Automation #" + (item.automationId || "?") + (item.eligible === false ? " bloqueada" : " disparada"),
        );
        appendText(
          row,
          "span",
          "",
          [
            shortDate(item.createdAt),
            (item.jobsCreated || 0) + " job(s)",
            (item.actionsApplied || 0) + " acao(oes)",
          ]
            .filter(Boolean)
            .join(" · "),
        );
        const reasons = Array.isArray(item.reasons) ? item.reasons.filter(Boolean) : [];
        if (reasons.length > 0) {
          appendText(row, "span", "nuoma-warning", reasons.slice(0, 2).join(" · "));
        }
        historyList.appendChild(row);
      }
    }
    historySection.appendChild(historyList);
    body.appendChild(historySection);

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
      const unresolved = appendPanelState(
        body,
        "Telefone não identificado",
        "Abra uma conversa individual, carregue os detalhes do contato ou tente reidentificar pelo bridge antes de rodar sync ou campanha.",
        "unresolved-phone",
      );
      const unresolvedActions = document.createElement("div");
      unresolvedActions.className = "nuoma-inline-actions";
      const reidentify = document.createElement("button");
      reidentify.type = "button";
      reidentify.className = "nuoma-small-action";
      reidentify.textContent = "Reidentificar telefone";
      reidentify.setAttribute("aria-label", "Reidentificar telefone da conversa atual");
      reidentify.addEventListener("click", () => {
        void reidentifyCurrentThread(host, "panel-action");
      });
      unresolvedActions.appendChild(reidentify);
      unresolved.appendChild(unresolvedActions);
    }
    const debugSection = section("Debug", state.debugLocators ? "locators on" : "locators off");
    const debugActions = document.createElement("div");
    debugActions.className = "nuoma-inline-actions";
    const debugButton = document.createElement("button");
    debugButton.type = "button";
    debugButton.className = "nuoma-small-action";
    debugButton.setAttribute("data-nuoma-debug-toggle", "true");
    debugButton.textContent = state.debugLocators ? "Ocultar bordas" : "Mostrar bordas";
    debugButton.addEventListener("click", () => toggleDebugLocators(host));
    debugActions.appendChild(debugButton);
    appendText(
      debugActions,
      "div",
      "nuoma-sync-note",
      "Atalhos: R atualizar · S sync · C copiar · D debug",
    );
    debugSection.appendChild(debugActions);
    if (state.domChanged) {
      appendText(
        debugSection,
        "div",
        "nuoma-empty nuoma-warning",
        "DOM do WhatsApp mudou desde a injecao. Revalidar locators antes de acao sensivel.",
      );
    }
    body.appendChild(debugSection);
    if (apiLastError) {
      appendText(body, "div", "nuoma-empty nuoma-warning", "Ponte API: " + apiLastError);
    }

    panel.appendChild(body);
    if (host.getAttribute("data-nuoma-state") === "open") {
      setTimeout(() => {
        body.focus({ preventScroll: true });
      }, 0);
    }
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
    wrapper.setAttribute("data-nuoma-section", text(title).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    wrapper.setAttribute("data-nuoma-locator", "section");
    const heading = document.createElement("div");
    heading.className = "nuoma-section-title";
    heading.setAttribute("data-nuoma-locator", "section-title");
    appendText(heading, "span", "", title);
    appendText(heading, "span", "nuoma-pill", pill);
    wrapper.appendChild(heading);
    return wrapper;
  }

  function campaignChip(label, stateValue) {
    const chip = document.createElement("span");
    chip.className = "nuoma-campaign-chip";
    if (stateValue) {
      chip.setAttribute("data-state", stateValue);
    }
    chip.textContent = label;
    return chip;
  }

  function stat(label, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "nuoma-stat";
    appendText(wrapper, "div", "nuoma-stat-label", label);
    appendText(wrapper, "div", "nuoma-stat-value", value);
    return wrapper;
  }

  function refresh() {
    state.refreshCount = (state.refreshCount || 0) + 1;
    const header = findHeader();
    if (!header) {
      return { mounted: false, reason: "header-not-found", version: config.version };
    }

    installNuomaApi();
    const thread = detectCurrentThread(header);
    const existingHost = document.getElementById(config.rootId);
    const existingPhone = normalizePhone(existingHost?.getAttribute("data-nuoma-thread-phone"));
    const existingWaJid = normalizeWaJid(existingHost?.getAttribute("data-nuoma-wa-jid"));
    const existingPhoneSource = text(existingHost?.getAttribute("data-nuoma-phone-source"));
    const host = ensureHost(header);
    updateDomGuard(host, header);
    positionHostByHeaderActions(host, header);
    const dataPhone = text(state.data && state.data.phone);
    const dataWaJid = text(state.data && state.data.waJid);
    const dataPhoneSource = text(state.data && state.data.phoneSource);
    const sameAsDataWaJid = Boolean(thread.waJid && normalizeWaJid(dataWaJid) === thread.waJid);
    const sameAsExistingWaJid = Boolean(thread.waJid && existingWaJid === thread.waJid);
    const sameAsDataPhone = Boolean(thread.phone && normalizePhone(dataPhone) === thread.phone);
    const retainedPhone = !thread.phone
      ? (sameAsDataWaJid && normalizePhone(dataPhone)) ||
        (sameAsExistingWaJid && existingPhone) ||
        ""
      : "";
    const retainedPhoneSource = retainedPhone
      ? sameAsDataWaJid && normalizePhone(dataPhone)
        ? dataPhoneSource || "wa-jid"
        : sameAsExistingWaJid && existingPhone
          ? existingPhoneSource || "wa-jid"
          : "wa-jid"
      : "";
    const hydratedPhone = (sameAsDataWaJid || sameAsDataPhone) ? normalizePhone(dataPhone) : "";
    const hydratedWaJid = sameAsDataWaJid ? normalizeWaJid(dataWaJid) : "";
    const hasCanonicalThreadIdentity = Boolean(thread.phone || thread.waJid);
    const threadChanged =
      !state.data ||
      (thread.waJid && dataWaJid && normalizeWaJid(dataWaJid) !== thread.waJid) ||
      (thread.phone && dataPhone && dataPhone !== thread.phone) ||
      (!hasCanonicalThreadIdentity &&
        Boolean(dataPhone || dataWaJid || (state.data && state.data.source !== "dom")));
    if (threadChanged) {
      state.data = {
        phone: thread.phone || retainedPhone,
        waJid: thread.waJid || normalizeWaJid(thread.phone || retainedPhone),
        phoneSource: thread.phone ? thread.phoneSource : retainedPhoneSource || thread.phoneSource,
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
    const displayPhone = thread.phone || hydratedPhone || retainedPhone;
    const displayWaJid = thread.waJid || hydratedWaJid || normalizeWaJid(displayPhone);
    const displayPhoneSource = thread.phone
      ? thread.phoneSource
      : hydratedPhone
        ? dataPhoneSource || "wa-jid"
        : retainedPhone
          ? retainedPhoneSource || "retained"
          : thread.phoneSource;
    const displayTitle =
      thread.title || (displayPhone || displayWaJid ? text(state.data && state.data.title) : "");
    if ((displayPhone || displayWaJid) && displayTitle) {
      if (state.data && !state.data.phone) {
        state.data.phone = displayPhone;
        state.data.phoneSource = displayPhoneSource;
      }
      if (state.data && !state.data.waJid) {
        state.data.waJid = displayWaJid;
      }
    }
    host.setAttribute("data-nuoma-version", config.version);
    host.setAttribute("data-nuoma-thread-title", displayTitle);
    host.setAttribute("data-nuoma-thread-phone", displayPhone);
    host.setAttribute("data-nuoma-wa-jid", displayWaJid);
    host.setAttribute("data-nuoma-phone-source", displayPhoneSource);
    host.setAttribute("data-nuoma-api-status", state.apiStatus || "offline");
    host.setAttribute("data-nuoma-debug", state.debugLocators ? "true" : "false");
    if (state.hotReloadedAt) {
      host.setAttribute("data-nuoma-hot-reloaded-at", state.hotReloadedAt);
    }
    const button = ensureShadow(host);
    button.setAttribute("data-nuoma-thread-phone", displayPhone);
    button.setAttribute("data-nuoma-wa-jid", displayWaJid);
    button.setAttribute("data-nuoma-thread-title", displayTitle);
    button.setAttribute("data-nuoma-phone-source", displayPhoneSource);
    renderPanel(host);
    const refreshIdentity = displayWaJid || displayPhone;
    if (
      host.getAttribute("data-nuoma-state") === "open" &&
      refreshIdentity &&
      state.apiHydratedPhone !== refreshIdentity
    ) {
      void refreshContactFromApi(host, "open-refresh");
    }

    return {
      mounted: true,
      phone: displayPhone,
      waJid: displayWaJid,
      phoneSource: displayPhoneSource,
      title: displayTitle,
      apiStatus: state.apiStatus || "offline",
      apiLastMethod: state.apiLastMethod || "",
      apiLastError: state.apiLastError || "",
      version: config.version,
    };
  }

  function scheduleRefresh() {
    if (state.observerTimer) {
      clearTimeout(state.observerTimer);
    }
    state.observerTimer = setTimeout(() => {
      state.observerTimer = 0;
      if (state.raf) {
        cancelAnimationFrame(state.raf);
      }
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        refresh();
      });
    }, 50);
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
      if (text(data.apiStatus) !== "loading") {
        state.apiInFlight = false;
      }
      setApiStatus(data.apiStatus, data.apiLastMethod, data.apiLastError);
    }
    const hydratedIdentity = text(state.data.waJid) || text(state.data.phone);
    if (hydratedIdentity && text(data && data.apiStatus) !== "loading") {
      state.apiHydratedPhone = hydratedIdentity;
    }
    const host = document.getElementById(config.rootId);
    if (host) {
      if (state.data.title) {
        host.setAttribute("data-nuoma-thread-title", state.data.title);
      }
      if (state.data.phone) {
        host.setAttribute("data-nuoma-thread-phone", state.data.phone);
      }
      if (state.data.waJid) {
        host.setAttribute("data-nuoma-wa-jid", state.data.waJid);
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
    if (state.observerTimer) {
      clearTimeout(state.observerTimer);
      state.observerTimer = 0;
    }
    if (state.animationRaf) {
      cancelAnimationFrame(state.animationRaf);
      state.animationRaf = 0;
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
