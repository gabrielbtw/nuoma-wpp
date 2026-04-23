import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import {
  addMessage,
  claimDueJobForTypes,
  completeJob,
  createLogger,
  deactivateContactChannel,
  ensureRuntimeDirectories,
  failJobPermanently,
  failJob,
  findMessageByMinute,
  getDb,
  getWorkerState,
  handleAutomationJobFailure,
  handleAutomationJobSuccess,
  handleCampaignJobFailure,
  handleCampaignJobSuccess,
  hasPendingJobsForTypes,
  type InstagramAssistedSessionState,
  isSqliteBusyError,
  loadEnv,
  getAttendantById,
  getAttendantSamplesDir,
  markCampaignRecipientFailed,
  markCampaignRecipientValidated,
  recordSystemEvent,
  saveConversationSnapshot,
  sendJobPayloadSchema,
  setWorkerState,
  updateMessageStatus,
  upsertConversation,
  getConversationByChatId
} from "@nuoma/core";

type WorkerStatus = "starting" | "authenticated" | "disconnected" | "restarting" | "degraded" | "error";

function nowIso() {
  return new Date().toISOString();
}

/** Maps send job content types to message storage content types */
function toMessageContentType(ct: string): "text" | "audio" | "image" | "video" | "file" | "summary" {
  if (ct === "document") return "file";
  if (ct === "link") return "text";
  return ct as "text" | "audio" | "image" | "video";
}

/** Maps send job content types to Instagram send content types */
function toInstagramContentType(ct: string): "text" | "audio" | "image" | "video" {
  if (ct === "document") return "video"; // fallback, IG doesn't support doc
  if (ct === "link") return "text";
  return ct as "text" | "audio" | "image" | "video";
}

function rssMb() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes("locator") || message.includes("timeout")) {
    return "locator_failure";
  }
  if (message.includes("auth") || message.includes("qr") || message.includes("session")) {
    return "authentication_failure";
  }
  if (message.includes("upload") || message.includes("file")) {
    return "upload_failure";
  }
  if (message.includes("voice_conversion") || message.includes("xtts") || message.includes("synthesis failed")) {
    return "voice_conversion_failure";
  }
  if (message.includes("browser") || message.includes("target closed")) {
    return "browser_failure";
  }
  return "send_failure";
}

function shouldDeactivateInstagramChannel(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("nao esta disponivel") ||
    message.includes("usuario nao encontrado") ||
    message.includes("user not found") ||
    message.includes("page isn't available") ||
    message.includes("page isnt available")
  );
}

function parseUnreadCountFromText(text: string) {
  // Only parse short text that looks like a badge (1-3 digits, nothing else)
  const trimmed = text.trim();
  if (/^\d{1,3}$/.test(trimmed)) {
    return Number(trimmed);
  }
  // Fallback: look for unread count patterns in aria-labels like "3 mensagens não lidas"
  const ariaMatch = trimmed.match(/^(\d{1,3})\s+(mensage[nm]|unread|não lida)/i);
  if (ariaMatch) {
    return Number(ariaMatch[1]);
  }
  return 0;
}

const execFileAsync = promisify(execFile);

type BrowserSessionManifest = {
  version: 1;
  sessionKey: string;
  profileDir: string;
  browserEndpoint: string;
  lastUpdatedAt: string;
  tabs: Array<{
    role: "whatsapp" | "instagram" | "webapp";
    url: string | null;
  }>;
  whatsapp: {
    status: "authenticated" | "disconnected";
    sessionPhone: string | null;
    pageUrl: string | null;
    lastCheckedAt: string | null;
  };
  instagram: {
    status: InstagramAssistedSessionState["status"];
    authenticated: boolean;
    username: string | null;
    pageUrl: string | null;
    lastCheckedAt: string | null;
  };
};

export class WhatsAppWorker {
  private env = loadEnv();
  private logger = createLogger("wa-worker");
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private instagramPage: Page | null = null;
  private webAppPage: Page | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private instagramSyncTimer: NodeJS.Timeout | null = null;
  private jobTimer: NodeJS.Timeout | null = null;
  private browserTask: "idle" | "job" | "sync" = "idle";
  private browserTaskStartedAt = 0;
  private processJobInFlight = false;
  private browserSessionKey: string | null = null;
  private lastOpenPhone: string | null = null;
  /**
   * Cooperative cancel token consumed by the sync walk. When a higher-priority
   * job arrives mid-sync (e.g. send-message), `processJob` flips `cancelled` to
   * true so the walk aborts at its next safe checkpoint, freeing the browser.
   */
  private syncCancelToken: { cancelled: boolean } | null = null;
  private pendingBackfill: Array<{ title: string; phone: string | null; conversationId: string }> = [];
  private sessionManifestCache = "";
  private state: {
    status: WorkerStatus;
    authStatus: "authenticated" | "disconnected";
    sessionPhone: string | null;
    lastActivityAt: string | null;
    lastSyncAt: string | null;
    lastFailureAt: string | null;
    lastFailureSummary: string | null;
    lastErrorType: string | null;
    consecutiveFailures: number;
    memoryMb: number;
  } = {
    status: "starting",
    authStatus: "disconnected",
    sessionPhone: null,
    lastActivityAt: null,
    lastSyncAt: null,
    lastFailureAt: null,
    lastFailureSummary: null,
    lastErrorType: null,
    consecutiveFailures: 0,
    memoryMb: rssMb()
  };

  async start() {
    ensureRuntimeDirectories();
    getDb();
    await this.launchBrowser();
    await this.refreshAuthState();
    await this.refreshInstagramSessionState({
      openPage: this.env.IG_ENABLE_INBOX_SYNC && this.env.IG_USE_SHARED_BROWSER && this.env.IG_OPEN_ON_STARTUP,
      reason: "startup"
    });
    await this.focusPreferredStartupTab();

    this.heartbeatTimer = setInterval(() => {
      void this.runLoopTask("heartbeat", async () => {
        await this.refreshAuthState();
        await this.publishState();
        if (this.env.IG_ENABLE_INBOX_SYNC) {
          await this.refreshInstagramSessionState({
            openPage: false,
            reason: "heartbeat"
          });
        }
        await this.restartIfNeeded();
        // Note: processJob() removed from heartbeat — dedicated jobTimer (3s) handles it
      });
    }, this.env.WORKER_HEARTBEAT_SEC * 1000);

    this.syncTimer = setInterval(() => {
      void this.runLoopTask("sync-whatsapp", async () => {
        await this.syncInbox("interval");
      });
    }, this.env.WA_SYNC_INTERVAL_SEC * 1000);

    if (this.env.IG_ENABLE_INBOX_SYNC) {
      this.instagramSyncTimer = setInterval(() => {
        void this.runLoopTask("sync-instagram", async () => {
          await this.syncInstagramInbox("interval");
        });
      }, this.env.IG_SYNC_INTERVAL_SEC * 1000);
    }

    this.jobTimer = setInterval(() => {
      void this.runLoopTask("process-job", async () => {
        await this.processJob();
      });
    }, 3000);

    await this.publishState();
    void this.runLoopTask("sync-whatsapp-startup", async () => {
      await this.syncInbox("startup");
    });
    if (this.env.IG_ENABLE_INBOX_SYNC) {
      void this.runLoopTask("sync-instagram-startup", async () => {
        await this.syncInstagramInbox("startup");
      });
    }
  }

  async stop() {
    for (const timer of [this.heartbeatTimer, this.syncTimer, this.instagramSyncTimer, this.jobTimer]) {
      if (timer) {
        clearInterval(timer);
      }
    }

    this.heartbeatTimer = null;
    this.syncTimer = null;
    this.instagramSyncTimer = null;
    this.jobTimer = null;

    await this.context?.close().catch(() => null);
    this.context = null;
    this.page = null;
    this.instagramPage = null;
    this.webAppPage = null;
  }

  private async runLoopTask(label: string, task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isSqliteBusyError(error)) {
        this.logger.warn({ label, message }, "SQLite busy during worker loop");
        recordSystemEvent("wa-worker", "warn", "SQLite busy during worker loop", {
          label,
          message
        });
        return;
      }

      this.logger.error({ label, err: error }, "Unexpected worker loop failure");
      recordSystemEvent("wa-worker", "error", "Unexpected worker loop failure", {
        label,
        message
      });
    }
  }

  private async launchBrowser(audioCapturePath?: string | null) {
    this.updateState({
      status: "starting"
    });

    const existingManifest = await this.readSessionManifest();
    this.browserSessionKey = existingManifest?.sessionKey?.trim() || this.browserSessionKey;
    this.sessionManifestCache = existingManifest ? JSON.stringify(existingManifest, null, 2) : "";

    if (this.context) {
      await this.context.close().catch(() => null);
    }
    this.page = null;
    this.instagramPage = null;
    this.webAppPage = null;

    const extraArgs = [
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--window-position=-2000,-2000",
      "--window-size=1512,920",
      "--force-device-scale-factor=1",
      `--remote-debugging-address=${this.env.CHROMIUM_CDP_HOST}`,
      `--remote-debugging-port=${this.env.CHROMIUM_CDP_PORT}`
    ];

    if (audioCapturePath === "__fake_mic_only__") {
      // Auto-accept mic permission + fake device (no file) — audio injected via JS getUserMedia override
      extraArgs.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
    } else if (audioCapturePath) {
      extraArgs.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${audioCapturePath}`);
    }

    this.context = await chromium.launchPersistentContext(this.env.CHROMIUM_PROFILE_DIR, {
      channel: this.env.CHROMIUM_CHANNEL,
      headless: this.env.CHROMIUM_HEADLESS,
      slowMo: this.env.PLAYWRIGHT_SLOW_MO,
      viewport: null,
      permissions: audioCapturePath ? ["microphone"] : [],
      args: extraArgs
    });
    await this.context.grantPermissions(["microphone"], {
      origin: this.env.WA_URL
    }).catch(() => null);

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.page.goto(this.env.WA_URL, {
      waitUntil: "domcontentloaded"
    });
    await this.ensureWorkspaceTabs();
    await this.persistSessionManifest().catch(() => null);

    recordSystemEvent("wa-worker", "info", "Chromium context launched", {
      profileDir: this.env.CHROMIUM_PROFILE_DIR,
      sessionKey: this.browserSessionKey
    });
  }

  private async relaunchBrowser(audioCapturePath?: string | null) {
    await this.launchBrowser(audioCapturePath ?? null);
    await this.refreshAuthState();
    // Skip Instagram session refresh when relaunching for audio capture
    // to minimize delay between browser launch and mic click (timing-critical)
    if (!audioCapturePath) {
      await this.refreshInstagramSessionState({
        openPage: this.env.IG_ENABLE_INBOX_SYNC && this.env.IG_USE_SHARED_BROWSER && this.env.IG_OPEN_ON_STARTUP,
        reason: "relaunch"
      });
    }
    await this.focusPreferredStartupTab();
    await this.publishState();
  }

  private updateState(partial: Partial<typeof this.state>) {
    this.state = {
      ...this.state,
      ...partial,
      memoryMb: rssMb()
    };
  }

  private async publishState(extra?: Record<string, unknown>) {
    setWorkerState("wa-worker", {
      ...this.state,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: rssMb(),
      browserSessionKey: this.browserSessionKey,
      browserCdpEndpoint: this.buildCdpEndpoint(),
      browserProfileDir: this.env.CHROMIUM_PROFILE_DIR,
      browserTabs: {
        whatsapp: this.page?.url() ?? null,
        instagram: this.instagramPage?.url() ?? null,
        webapp: this.webAppPage?.url() ?? null
      },
      updatedAt: nowIso(),
      ...extra
    });
  }

  private buildCdpEndpoint() {
    return `http://${this.env.CHROMIUM_CDP_HOST}:${this.env.CHROMIUM_CDP_PORT}`;
  }

  private resolveWebAppUrl() {
    const configured = this.env.WEB_APP_URL.trim();
    if (configured) {
      return configured;
    }

    const host = this.env.APP_HOST && this.env.APP_HOST !== "0.0.0.0" ? this.env.APP_HOST : "127.0.0.1";
    return `http://${host}:${this.env.APP_PORT}`;
  }

  private resolveOrigin(value?: string | null) {
    try {
      return new URL(String(value ?? "").trim()).origin;
    } catch {
      return null;
    }
  }

  private isPageOpen(page?: Page | null): page is Page {
    return Boolean(page && !page.isClosed());
  }

  private resolveWebAppPage() {
    if (!this.context) {
      return null;
    }

    const webAppOrigin = this.resolveOrigin(this.resolveWebAppUrl());
    if (!webAppOrigin) {
      return null;
    }

    return (
      this.context
        .pages()
        .find((candidate) => candidate !== this.page && candidate !== this.instagramPage && !candidate.isClosed() && this.resolveOrigin(candidate.url()) === webAppOrigin) ??
      null
    );
  }

  private getSessionManifestPath() {
    return path.join(this.env.CHROMIUM_PROFILE_DIR, "nuoma-session.json");
  }

  private async readSessionManifest() {
    try {
      const raw = await fs.readFile(this.getSessionManifestPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<BrowserSessionManifest>;
      if (!parsed || typeof parsed !== "object" || typeof parsed.sessionKey !== "string" || !parsed.sessionKey.trim()) {
        return null;
      }

      return parsed as BrowserSessionManifest;
    } catch {
      return null;
    }
  }

  private buildSessionManifest(existing?: BrowserSessionManifest | null): BrowserSessionManifest {
    const instagramState = this.readInstagramSessionState();
    const sessionKey = existing?.sessionKey?.trim() || this.browserSessionKey || randomUUID();
    this.browserSessionKey = sessionKey;

    return {
      version: 1,
      sessionKey,
      profileDir: this.env.CHROMIUM_PROFILE_DIR,
      browserEndpoint: this.buildCdpEndpoint(),
      lastUpdatedAt: nowIso(),
      tabs: [
        {
          role: "whatsapp",
          url: this.page?.url() ?? null
        },
        {
          role: "instagram",
          url: this.instagramPage?.url() ?? null
        },
        {
          role: "webapp",
          url: this.webAppPage?.url() ?? null
        }
      ],
      whatsapp: {
        status: this.state.authStatus,
        sessionPhone: this.state.sessionPhone,
        pageUrl: this.page?.url() ?? null,
        lastCheckedAt: this.state.lastActivityAt
      },
      instagram: {
        status: instagramState.status,
        authenticated: instagramState.authenticated,
        username: instagramState.username ?? null,
        pageUrl: this.instagramPage?.url() ?? instagramState.pageUrl ?? null,
        lastCheckedAt: instagramState.lastCheckedAt ?? null
      }
    };
  }

  private async persistSessionManifest() {
    const existing = await this.readSessionManifest();
    const nextManifest = this.buildSessionManifest(existing);
    const serialized = JSON.stringify(nextManifest, null, 2);

    if (serialized === this.sessionManifestCache) {
      return;
    }

    await fs.writeFile(this.getSessionManifestPath(), serialized, "utf8");
    this.sessionManifestCache = serialized;
  }

  private async ensureWorkspaceTabs() {
    if (!this.context || this.env.CHROMIUM_HEADLESS) {
      return;
    }

    if (this.env.WEB_APP_OPEN_ON_STARTUP) {
      const existingWebAppPage = this.isPageOpen(this.webAppPage) ? this.webAppPage : this.resolveWebAppPage();
      if (existingWebAppPage) {
        this.webAppPage = existingWebAppPage;
      } else {
        const webAppPage = await this.context.newPage();
        await webAppPage.goto(this.resolveWebAppUrl(), {
          waitUntil: "domcontentloaded"
        }).catch(() => null);
        this.webAppPage = webAppPage;
      }
    } else {
      this.webAppPage = null;
    }

    if (this.env.IG_USE_SHARED_BROWSER && this.env.IG_OPEN_ON_STARTUP) {
      await this.ensureInstagramPage(true);
    }

    await this.persistSessionManifest().catch(() => null);
  }

  private async focusPreferredStartupTab() {
    if (this.env.CHROMIUM_HEADLESS) {
      return;
    }

    const instagramState = this.readInstagramSessionState();
    if (!instagramState.authenticated && this.isPageOpen(this.instagramPage)) {
      // bringToFront removed - keep browser in background
      return;
    }

    if (this.state.authStatus !== "authenticated" && this.isPageOpen(this.page)) {
      // bringToFront removed - keep browser in background
      return;
    }

    if (this.isPageOpen(this.webAppPage)) {
      // bringToFront removed - keep browser in background
    }
  }

  private readInstagramSessionState(): InstagramAssistedSessionState {
    const stored = getWorkerState("instagram-assisted");
    const fallback: InstagramAssistedSessionState = {
      mode: "browser",
      status: "assisted",
      authenticated: false,
      profileDir: this.env.IG_USE_SHARED_BROWSER ? this.env.CHROMIUM_PROFILE_DIR : this.env.IG_CHROMIUM_PROFILE_DIR,
      username: null,
      lastSyncAt: null,
      threadCount: 0,
      messageCount: 0,
      errorMessage: null,
      sharedBrowser: this.env.IG_USE_SHARED_BROWSER,
      browserEndpoint: this.env.IG_USE_SHARED_BROWSER ? this.buildCdpEndpoint() : null,
      pageUrl: null,
      lastCheckedAt: null
    };

    if (!stored?.value || typeof stored.value !== "object") {
      return fallback;
    }

    return {
      ...fallback,
      ...(stored.value as Partial<InstagramAssistedSessionState>)
    };
  }

  private resolveInstagramPage() {
    if (!this.context) {
      return null;
    }

    const pages = this.context.pages();
    return (
      pages.find((candidate) => candidate !== this.page && candidate.url().includes("instagram.com/direct/")) ??
      pages.find((candidate) => candidate !== this.page && candidate.url().includes("instagram.com")) ??
      null
    );
  }

  private async ensureInstagramPage(openPage: boolean) {
    const existingPage = this.instagramPage && !this.instagramPage.isClosed() ? this.instagramPage : this.resolveInstagramPage();
    if (existingPage) {
      this.instagramPage = existingPage;
      return existingPage;
    }

    if (!this.context || !openPage) {
      this.instagramPage = null;
      return null;
    }

    const page = await this.context.newPage();
    await page.goto(this.env.IG_URL, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(1200);
    this.instagramPage = page;
    // bringToFront removed - keep browser in background
    return page;
  }

  private async detectInstagramAuthenticated(page: Page) {
    const loginFieldCount = await page.locator("input[name='username']").count().catch(() => 0);
    return loginFieldCount === 0 && !page.url().includes("/accounts/login");
  }

  private async detectInstagramUsername(page: Page) {
    try {
      const username = await page.evaluate(() => {
        const blockedRoots = new Set(["accounts", "direct", "explore", "reels", "stories", "about", "legal"]);
        const normalizeCandidate = (value?: string | null) => {
          const normalized = String(value ?? "")
            .replace(/^@+/, "")
            .replace(/^\/+|\/+$/g, "")
            .trim()
            .toLowerCase();

          if (!normalized || blockedRoots.has(normalized)) {
            return null;
          }

          return /^[a-z0-9._]+$/i.test(normalized) ? normalized : null;
        };

        const browserGlobal = globalThis as unknown as {
          document?: {
            querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null }>;
          };
        };

        const anchors = Array.from(browserGlobal.document?.querySelectorAll("a[href]") ?? [])
          .map((anchor) => anchor.getAttribute("href") ?? "")
          .map((href) => {
            const match = href.match(/^\/([a-z0-9._]+)\/?$/i);
            return normalizeCandidate(match?.[1] ?? null);
          })
          .filter(Boolean) as string[];

        return anchors.find(Boolean) ?? null;
      });

      return typeof username === "string" && username.trim() ? username.trim().toLowerCase() : null;
    } catch {
      return null;
    }
  }

  private async refreshInstagramSessionState(options: {
    openPage: boolean;
    reason: "startup" | "heartbeat" | "relaunch";
  }) {
    const currentState = this.readInstagramSessionState();

    if (!this.env.IG_USE_SHARED_BROWSER) {
      setWorkerState("instagram-assisted", {
        ...currentState,
        status: "assisted",
        authenticated: false,
        profileDir: this.env.IG_CHROMIUM_PROFILE_DIR,
        sharedBrowser: false,
        browserEndpoint: null,
        pageUrl: null,
        lastCheckedAt: nowIso(),
        errorMessage: null
      });
      await this.persistSessionManifest().catch(() => null);
      return;
    }

    try {
      const page = await this.ensureInstagramPage(options.openPage);
      if (!page) {
        setWorkerState("instagram-assisted", {
          ...currentState,
          profileDir: this.env.CHROMIUM_PROFILE_DIR,
          sharedBrowser: true,
          browserEndpoint: this.buildCdpEndpoint(),
          pageUrl: null,
          lastCheckedAt: nowIso(),
          errorMessage: null
        });
        await this.persistSessionManifest().catch(() => null);
        return;
      }

      const authenticated = await this.detectInstagramAuthenticated(page);
      const username = authenticated ? await this.detectInstagramUsername(page) : null;
      const nextState: InstagramAssistedSessionState = {
        ...currentState,
        mode: "browser",
        status: authenticated ? "connected" : "assisted",
        authenticated,
        profileDir: this.env.CHROMIUM_PROFILE_DIR,
        username: username ?? currentState.username ?? null,
        errorMessage: null,
        sharedBrowser: true,
        browserEndpoint: this.buildCdpEndpoint(),
        pageUrl: page.url(),
        lastCheckedAt: nowIso()
      };
      setWorkerState("instagram-assisted", nextState);
      await this.persistSessionManifest().catch(() => null);

      if (options.reason !== "heartbeat" && options.openPage) {
        recordSystemEvent("instagram-assisted", authenticated ? "info" : "warn", "Instagram shared tab ready", {
          authenticated,
          browserEndpoint: nextState.browserEndpoint,
          pageUrl: nextState.pageUrl,
          profileDir: nextState.profileDir
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkerState("instagram-assisted", {
        ...currentState,
        mode: "browser",
        status: "error",
        authenticated: false,
        profileDir: this.env.CHROMIUM_PROFILE_DIR,
        errorMessage: message,
        sharedBrowser: true,
        browserEndpoint: this.buildCdpEndpoint(),
        pageUrl: null,
        lastCheckedAt: nowIso()
      });
      await this.persistSessionManifest().catch(() => null);
      if (options.reason !== "heartbeat") {
        recordSystemEvent("instagram-assisted", "error", "Instagram shared tab failed", {
          reason: options.reason,
          message
        });
      }
    }
  }

  private async captureArtifacts(correlationId: string, kind: string, error: unknown) {
    if (!this.page) {
      return { screenshotPath: null, htmlPath: null };
    }

    const timestamp = Date.now();
    const screenshotPath = path.join(this.env.SCREENSHOTS_DIR, `${timestamp}-${kind}-${correlationId}.png`);
    const htmlPath = path.join(this.env.SCREENSHOTS_DIR, `${timestamp}-${kind}-${correlationId}.html`);

    await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
    if (this.env.SAVE_HTML_ON_CRITICAL_ERROR) {
      const html = await this.page.content().catch(() => "");
      if (html) {
        await fs.writeFile(htmlPath, html, "utf8");
      }
    }

    recordSystemEvent("wa-worker", "error", "Critical browser artifact captured", {
      correlationId,
      kind,
      message: error instanceof Error ? error.message : String(error),
      screenshotPath,
      htmlPath: this.env.SAVE_HTML_ON_CRITICAL_ERROR ? htmlPath : null
    });

    return {
      screenshotPath,
      htmlPath: this.env.SAVE_HTML_ON_CRITICAL_ERROR ? htmlPath : null
    };
  }

  private async refreshAuthState() {
    if (!this.page) {
      return;
    }

    try {
      if (!this.page.url().startsWith(this.env.WA_URL)) {
        await this.page.goto(this.env.WA_URL, {
          waitUntil: "domcontentloaded"
        });
      }

      const paneSide = this.page.locator("#pane-side");
      const qrMarkers = this.page.locator("canvas[aria-label*='QR'], [data-ref] canvas, [aria-label*='código QR']");
      const loadingText = this.page.locator("text=Não feche esta janela. Suas mensagens estão sendo baixadas.");

      try {
        await Promise.race([
          paneSide.waitFor({ timeout: 45_000 }),
          loadingText.waitFor({ timeout: 45_000 }),
          qrMarkers.first().waitFor({ timeout: 45_000 })
        ]);
      } catch {
        // Fall through to DOM inspection below.
      }

      if ((await paneSide.count()) > 0) {
        const sessionPhone = await this.resolveOwnWhatsAppPhone();
        this.updateState({
          status: this.state.status === "degraded" ? "degraded" : "authenticated",
          authStatus: "authenticated",
          sessionPhone: sessionPhone ?? this.state.sessionPhone,
          lastActivityAt: nowIso()
        });
        await this.persistSessionManifest().catch(() => null);
        return;
      }

      if ((await qrMarkers.count()) > 0) {
        this.updateState({
          status: "disconnected",
          authStatus: "disconnected",
          sessionPhone: null
        });
        await this.persistSessionManifest().catch(() => null);
        return;
      }

      if ((await loadingText.count()) > 0) {
        const sessionPhone = await this.resolveOwnWhatsAppPhone();
        this.updateState({
          status: this.state.status === "degraded" ? "degraded" : "authenticated",
          authStatus: "authenticated",
          sessionPhone: sessionPhone ?? this.state.sessionPhone,
          lastActivityAt: nowIso()
        });
        await this.persistSessionManifest().catch(() => null);
        return;
      }

      this.updateState({
        status: "disconnected",
        authStatus: "disconnected",
        sessionPhone: null
      });
      await this.persistSessionManifest().catch(() => null);
    } catch (error) {
      this.updateState({
        status: "error",
        authStatus: "disconnected",
        sessionPhone: null,
        lastFailureAt: nowIso(),
        lastFailureSummary: error instanceof Error ? error.message : String(error),
        lastErrorType: classifyError(error)
      });
      await this.persistSessionManifest().catch(() => null);
    }
  }

  private async ensureAuthenticated() {
    await this.refreshAuthState();
    if (this.state.authStatus !== "authenticated" || !this.page) {
      throw new Error("authentication_failure: WhatsApp Web not authenticated");
    }
  }

  private async resolveOwnWhatsAppPhone() {
    if (!this.page) {
      return null;
    }

    try {
      return await this.page.evaluate(() => {
        const normalize = (value: unknown) => {
          const raw = String(value ?? "")
            .replace(/^"+|"+$/g, "")
            .trim();
          if (!raw) {
            return null;
          }

          const widMatch = raw.match(/([1-9]\d{9,14})(?=[:@])/);
          if (widMatch?.[1]) {
            return widMatch[1];
          }

          const digits = raw.replace(/\D/g, "");
          if (!digits) {
            return null;
          }

          if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 15) {
            return digits;
          }

          if (digits.length >= 10 && digits.length <= 13) {
            return digits;
          }

          return null;
        };

        const win = globalThis as {
          Store?: {
            Conn?: {
              wid?: {
                user?: string;
                _serialized?: string;
              };
            };
            User?: {
              getMaybeMePnUser?: () => {
                user?: string;
                _serialized?: string;
              } | null;
            };
          };
          localStorage?: Storage;
        };

        const localStorageValues = ["last-wid-md", "last-wid", "last-wid-md-user"]
          .map((key) => {
            try {
              return win.localStorage?.getItem(key) ?? "";
            } catch {
              return "";
            }
          })
          .filter(Boolean);

        const maybeMe = win.Store?.User?.getMaybeMePnUser?.() ?? null;
        const candidates = [
          win.Store?.Conn?.wid?.user,
          win.Store?.Conn?.wid?._serialized,
          maybeMe?.user,
          maybeMe?._serialized,
          ...localStorageValues
        ];

        for (const candidate of candidates) {
          const normalized = normalize(candidate);
          if (normalized) {
            return normalized;
          }
        }

        return null;
      });
    } catch {
      return null;
    }
  }

  private async restartIfNeeded() {
    if (rssMb() < this.env.WORKER_MAX_RSS_MB) {
      return;
    }

    const correlationId = randomUUID();
    this.logger.warn({ correlationId, rssMb: rssMb() }, "Worker restarting because of memory threshold");
    this.updateState({
      status: "restarting",
      lastActivityAt: nowIso()
    });
    await this.publishState();
    await this.launchBrowser();
    await this.refreshAuthState();
    await this.publishState({
      correlationId
    });
  }

  private async processJob() {
    if (this.processJobInFlight) {
      return;
    }

    this.processJobInFlight = true;
    try {
      if (this.state.status === "degraded" || this.state.status === "error") {
        return;
      }
      // Cooperative cancel: if a sync is running and a higher-priority job is
      // due, flip the cancel flag so the walk aborts at its next safe
      // checkpoint. The job itself will be claimed on a subsequent tick once
      // syncInbox has released browserTask.
      if (this.browserTask === "sync" && this.syncCancelToken && !this.syncCancelToken.cancelled) {
        if (hasPendingJobsForTypes(["send-message", "send-assisted-message", "validate-recipient"])) {
          recordSystemEvent("wa-worker", "info", "Sync cancellation requested by pending job", {
            runningForMs: this.browserTaskStartedAt ? Date.now() - this.browserTaskStartedAt : 0
          });
          this.syncCancelToken.cancelled = true;
        }
      }
      // Stuck-sync guard: release only if the sync clearly exceeded its full
      // budget (forward + backfill + margin). Stricter threshold causes the
      // guard to fire during legitimate cold-start syncs and corrupt
      // durationMs calculations.
      const syncStuckThresholdMs = this.env.WA_SYNC_FORWARD_BUDGET_MS + this.env.WA_SYNC_BACKFILL_BUDGET_MS + 60_000;
      if (this.browserTask === "sync" && this.browserTaskStartedAt > 0 && Date.now() - this.browserTaskStartedAt > syncStuckThresholdMs) {
        recordSystemEvent("wa-worker", "warn", "Stuck inbox sync released for pending job", {
          browserTask: this.browserTask,
          runningForMs: Date.now() - this.browserTaskStartedAt,
          thresholdMs: syncStuckThresholdMs
        });
        this.browserTask = "idle";
        this.browserTaskStartedAt = 0;
      }
      if (this.browserTask !== "idle") {
        return;
      }

      let job: Record<string, unknown> | null = null;
      try {
        job = claimDueJobForTypes(`${os.hostname()}-${process.pid}`, ["send-message", "send-assisted-message", "validate-recipient", "sync-inbox"]);
      } catch (error) {
        if (isSqliteBusyError(error)) {
          this.logger.warn({ message: error instanceof Error ? error.message : String(error) }, "Skipping job claim because database is busy");
          recordSystemEvent("wa-worker", "warn", "Job claim skipped because database is busy", {
            message: error instanceof Error ? error.message : String(error)
          });
          return;
        }

        throw error;
      }

      if (!job) {
        return;
      }

      this.browserTask = "job";
      this.browserTaskStartedAt = Date.now();
      const correlationId = randomUUID();
      const logger = this.logger.child({
        correlationId,
        jobId: String(job.id),
        type: String(job.type)
      });

      try {
      if (String(job.type) === "validate-recipient") {
        const payload = JSON.parse(String(job.payload_json)) as {
          campaignId?: string;
          recipientId?: string;
          phone?: string;
        };

        if (!payload.recipientId || !payload.phone) {
          throw new Error("validation_failure: invalid recipient validation payload");
        }

        logger.info({ payload }, "Processing WhatsApp recipient validation");
        await this.ensureAuthenticated();
        const validation = await this.validateRecipientPhone(payload.phone, correlationId);

        if (!validation.valid) {
          markCampaignRecipientFailed(payload.recipientId, validation.reason, "blocked_by_rule");
          completeJob(String(job.id));
          recordSystemEvent("wa-worker", "warn", "Recipient blocked during WhatsApp validation", {
            correlationId,
            jobId: String(job.id),
            recipientId: payload.recipientId,
            phone: payload.phone,
            reason: validation.reason
          });
        } else {
          markCampaignRecipientValidated(payload.recipientId);
          completeJob(String(job.id));
          recordSystemEvent("wa-worker", "info", "Recipient validated on WhatsApp", {
            correlationId,
            jobId: String(job.id),
            recipientId: payload.recipientId,
            phone: payload.phone
          });
        }

        this.updateState({
          status: "authenticated",
          authStatus: "authenticated",
          lastActivityAt: nowIso(),
          consecutiveFailures: 0
        });
        await this.publishState({
          lastCorrelationId: correlationId
        });
        return;
      }

      if (String(job.type) === "send-assisted-message") {
        const payload = sendJobPayloadSchema.parse(JSON.parse(String(job.payload_json)));
        if (payload.channel !== "instagram") {
          throw new Error(`unsupported_channel: ${payload.channel}`);
        }

        const { getInstagramAssistedService } = await import("../../web-app/src/server/lib/instagram-assisted.js");
        const instagramService = getInstagramAssistedService();
        const sent = await instagramService.sendMessage({
          threadId: payload.externalThreadId,
          username: payload.recipientNormalizedValue ?? payload.recipientDisplayValue ?? null,
          text: payload.text,
          mediaPath: payload.mediaPath,
          contentType: toInstagramContentType(payload.contentType),
          caption: payload.caption
        });

        const conversationExternalThreadId =
          sent.threadId ?? payload.externalThreadId ?? payload.recipientNormalizedValue ?? payload.recipientDisplayValue ?? String(job.id);
        const conversation = upsertConversation({
          channel: "instagram",
          channelAccountId: payload.channelAccountId,
          externalThreadId: conversationExternalThreadId,
          title: payload.recipientDisplayValue || payload.recipientNormalizedValue || "Instagram",
          contactId: payload.contactId,
          contactInstagram: payload.recipientNormalizedValue,
          unreadCount: 0,
          inboxCategory: "primary",
          internalStatus: "open"
        });

        if (conversation) {
          addMessage({
            conversationId: conversation.id,
            contactId: conversation.contactId,
            direction: "outgoing",
            contentType: toMessageContentType(payload.contentType),
            body: payload.text || payload.caption || "",
            sentAt: sent.sentAt,
            externalId: sent.externalId,
            mediaPath: payload.mediaPath ?? null,
            meta: {
              source: payload.source,
              correlationId,
              mediaPath: payload.mediaPath ?? null
            }
          });
        }

        if (payload.source === "campaign" && payload.recipientId && payload.campaignId) {
          handleCampaignJobSuccess({
            recipientId: payload.recipientId,
            campaignId: payload.campaignId
          });
        }

        if ((payload.source === "automation" || payload.source === "rule") && payload.runId && payload.automationId && payload.contactId) {
          handleAutomationJobSuccess({
            runId: payload.runId,
            automationId: payload.automationId,
            contactId: payload.contactId,
            jobId: String(job.id)
          });
        }

        completeJob(String(job.id));
        this.updateState({
          status: "authenticated",
          authStatus: "authenticated",
          lastActivityAt: nowIso(),
          consecutiveFailures: 0
        });
        await this.publishState({
          lastCorrelationId: correlationId
        });
        recordSystemEvent("instagram-assisted", "info", "Instagram assisted job completed", {
          correlationId,
          jobId: String(job.id),
          source: payload.source,
          contentType: payload.contentType
        });
        return;
      }

      if (String(job.type) === "sync-inbox") {
        const syncPayload = JSON.parse(String(job.payload_json)) as { full?: boolean };
        completeJob(String(job.id));
        const syncReason = syncPayload.full ? "full" : "interval";
        this.logger.info({ syncReason }, "Processing sync-inbox job");
        recordSystemEvent("wa-worker", "info", `Sync-inbox job triggered (${syncReason})`);
        await this.syncInbox(syncReason);
        return;
      }

      if (String(job.type) !== "send-message") {
        completeJob(String(job.id));
        return;
      }

      const payload = sendJobPayloadSchema.parse(JSON.parse(String(job.payload_json)));
      if (payload.channel !== "whatsapp") {
        throw new Error(`unsupported_channel: ${payload.channel}`);
      }
      if (!payload.phone) {
        throw new Error("validation_failure: WhatsApp payload missing phone");
      }
      const phone = payload.phone;
      logger.info({ payload }, "Processing WhatsApp send job");
      await this.ensureAuthenticated();
      await this.sendPayload(payload, correlationId);

      const conversation = upsertConversation({
        channel: "whatsapp",
        channelAccountId: payload.channelAccountId,
        externalThreadId: payload.externalThreadId ?? phone,
        waChatId: phone,
        title: payload.recipientDisplayValue || phone,
        contactPhone: phone,
        unreadCount: 0
      });

      if (conversation) {
        if (payload.pendingMessageId) {
          // Update the pending message that was pre-stored by the API
          updateMessageStatus(payload.pendingMessageId, {
            status: "sent",
            sentAt: nowIso()
          });
        } else {
          // Fallback: create message if no pending message exists (e.g. campaign/automation sends)
          addMessage({
            conversationId: conversation.id,
            contactId: conversation.contactId,
            direction: "outgoing",
            contentType: toMessageContentType(payload.contentType),
            body: payload.text || payload.caption || "",
            sentAt: nowIso(),
            mediaPath: payload.mediaPath ?? null,
            meta: {
              source: payload.source,
              correlationId,
              mediaPath: payload.mediaPath ?? null
            }
          });
        }
      }

      if (payload.source === "campaign" && payload.recipientId && payload.campaignId) {
        handleCampaignJobSuccess({
          recipientId: payload.recipientId,
          campaignId: payload.campaignId
        });
      }

      if ((payload.source === "automation" || payload.source === "rule") && payload.runId && payload.automationId && payload.contactId) {
        handleAutomationJobSuccess({
          runId: payload.runId,
          automationId: payload.automationId,
          contactId: payload.contactId,
          jobId: String(job.id)
        });
      }

      completeJob(String(job.id));
      this.updateState({
        status: "authenticated",
        authStatus: "authenticated",
        lastActivityAt: nowIso(),
        consecutiveFailures: 0
      });
      await this.publishState({
        lastCorrelationId: correlationId
      });
      recordSystemEvent("wa-worker", "info", "WhatsApp job completed", {
        correlationId,
        jobId: String(job.id),
        source: payload.source
      });
    } catch (error) {
      this.lastOpenPhone = null; // page state unknown after failure
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = classifyError(error);
      const artifacts = await this.captureArtifacts(correlationId, errorType, error);
      if (errorType === "authentication_failure") {
        failJobPermanently(String(job.id), errorMessage);
      } else {
        failJob(String(job.id), errorMessage);
      }

      const nextFailures = this.state.consecutiveFailures + 1;
      this.updateState({
        status:
          errorType === "authentication_failure"
            ? "disconnected"
            : nextFailures >= this.env.WORKER_FAILURE_THRESHOLD && errorType === "locator_failure"
              ? "degraded"
              : "error",
        authStatus: errorType === "authentication_failure" ? "disconnected" : this.state.authStatus,
        lastFailureAt: nowIso(),
        lastFailureSummary: errorMessage,
        lastErrorType: errorType,
        consecutiveFailures: nextFailures
      });

      const payloadRaw = JSON.parse(String(job.payload_json)) as Record<string, unknown>;
      if (payloadRaw.channel === "instagram" && payloadRaw.contactId && shouldDeactivateInstagramChannel(error)) {
        try {
          const recipientDisplayValue = typeof payloadRaw.recipientDisplayValue === "string" ? payloadRaw.recipientDisplayValue : null;
          const recipientNormalizedValue = typeof payloadRaw.recipientNormalizedValue === "string" ? payloadRaw.recipientNormalizedValue : null;
          const channel = deactivateContactChannel({
            contactId: String(payloadRaw.contactId),
            type: "instagram",
            displayValue: recipientDisplayValue,
            normalizedValue: recipientNormalizedValue,
            externalId: recipientNormalizedValue,
            reason: errorMessage,
            source: "instagram-profile-validation"
          });

          if (channel) {
            recordSystemEvent("instagram-assisted", "warn", "Instagram contact channel marked inactive", {
              correlationId,
              jobId: String(job.id),
              contactId: String(payloadRaw.contactId),
              instagram: channel.normalizedValue,
              reason: errorMessage
            });
          }
        } catch (deactivateError) {
          logger.error(
            {
              error: deactivateError instanceof Error ? deactivateError.message : String(deactivateError),
              contactId: payloadRaw.contactId
            },
            "Failed to mark Instagram contact channel inactive"
          );
        }
      }
      if ((payloadRaw.source === "campaign" || payloadRaw.source === "automation" || payloadRaw.source === "rule") && payloadRaw.recipientId) {
        handleCampaignJobFailure(String(payloadRaw.recipientId), errorMessage);
      }
      if ((payloadRaw.source === "automation" || payloadRaw.source === "rule") && payloadRaw.runId) {
        handleAutomationJobFailure(String(payloadRaw.runId), errorMessage);
      }

      logger.error(
        {
          errorType,
          artifacts,
          error: errorMessage
        },
        "WhatsApp job failed"
      );

      recordSystemEvent("wa-worker", "error", "WhatsApp job failed", {
        correlationId,
        jobId: String(job.id),
        errorType,
        screenshotPath: artifacts.screenshotPath,
        htmlPath: artifacts.htmlPath,
        summary: errorMessage
      });
      await this.publishState({
        lastCorrelationId: correlationId
      });
      } finally {
        this.browserTask = "idle";
        this.browserTaskStartedAt = 0;
        // NOTE: lastOpenPhone is intentionally NOT reset here on success.
        // It is reset in syncInbox() and on audio sends so the next send to
        // the same phone can skip page.goto() and reuse the open conversation.
      }
    } finally {
      this.processJobInFlight = false;
    }
  }

  private async sendPayload(payload: ReturnType<typeof sendJobPayloadSchema.parse>, correlationId: string) {
    if (!this.page) {
      throw new Error("browser_failure: page not initialized");
    }

    if (payload.channel !== "whatsapp") {
      throw new Error(`unsupported_channel: ${payload.channel}`);
    }
    if (!payload.phone) {
      throw new Error("validation_failure: WhatsApp payload missing phone");
    }
    const phone = payload.phone;

    // Audio: send as document attachment (no browser relaunch needed)
    // This avoids closing/reopening Chrome which steals window focus from the user

    const targetUrl = `${this.env.WA_URL}/send?phone=${encodeURIComponent(phone)}`;

    if (this.lastOpenPhone !== phone) {
      await this.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await this.waitForChatReady();
      this.lastOpenPhone = phone;
    } else {
      // Already on correct conversation — verify composer is visible, navigate only if not
      const composerVisible = await this.page.locator("footer [contenteditable='true']").isVisible().catch(() => false);
      if (!composerVisible) {
        await this.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        await this.waitForChatReady();
      }
    }

    const textSendButton = this.page.locator("footer button[aria-label='Enviar'], footer div[aria-label='Enviar'], footer span[data-icon='send'], footer button span[data-icon='send']").last();
    const mediaSendButton = this.page.locator("div[role='button'][aria-label*='Enviar'], div[aria-label*='Enviar'], span[data-icon='send'], button[aria-label*='Enviar']").last();
    const composer = this.page.locator("footer [contenteditable='true']").first();

    const isMultiImage = payload.contentType === "images" && Array.isArray(payload.mediaPaths) && payload.mediaPaths.length > 0;
    let uploadedMediaPath = payload.mediaPath;
    if (isMultiImage || payload.mediaPath) {
      let filesToUpload: string | string[];
      if (isMultiImage) {
        filesToUpload = await Promise.all(
          (payload.mediaPaths as string[]).map((p) => this.prepareMediaForUpload(p, "image", correlationId))
        );
      } else {
        uploadedMediaPath = await this.prepareMediaForUpload(payload.mediaPath!, payload.contentType, correlationId);
        filesToUpload = uploadedMediaPath;
      }

      const attachmentButton = this.page
        .locator("button[title='Anexar'], div[title='Anexar'], span[data-icon='plus-rounded'], span[data-icon='attach-menu-plus']")
        .first();
      await attachmentButton.waitFor({ timeout: 15_000 });
      const fileChooserPromise = this.page.waitForEvent("filechooser", { timeout: 15_000 });
      await attachmentButton.click();

      // For document types use "Documento", for image/video use "Fotos e videos"
      const ct = payload.contentType as string;
      const isDocType = ct === "audio" || ct === "document" || ct === "file";
      const pickerLabel = isDocType
        ? this.page.getByText(/documento/i).first()
        : this.page.getByText(/fotos e vídeos|fotos e videos/i).first();
      await pickerLabel.waitFor({ timeout: 10_000 });
      await pickerLabel.click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(filesToUpload);
      // Multi-image needs more time for WA to load all previews
      await this.page.waitForTimeout(isMultiImage ? 3000 : 1500);

      if (payload.caption) {
        const captionBox = this.page
          .locator("[contenteditable='true'][role='textbox'][aria-label='Digite uma mensagem']")
          .first();
        await captionBox.fill(payload.caption).catch(async () => {
          await captionBox.type(payload.caption);
        });
      }

      await this.page.waitForTimeout(1500);
    } else if (payload.text) {
      await composer.waitFor({ timeout: 15_000 }).catch(() => null);
      // Type the text into composer
      await composer.fill(payload.text).catch(async () => {
        await composer.click();
        await composer.type(payload.text);
      });
      await this.page.waitForTimeout(500);
    }

    const hasMedia = Boolean(payload.mediaPath) || isMultiImage;
    await this.triggerSendAction(hasMedia ? mediaSendButton : textSendButton, hasMedia);

    recordSystemEvent("wa-worker", "info", "Send action completed", {
      correlationId,
      phone: payload.phone,
      contentType: payload.contentType
    });
  }

  private async sendVoiceRecording(phone: string, audioPath: string, correlationId: string) {
    // Get exact audio duration using ffprobe (try multiple paths)
    let durationSecs = 8;
    const ffprobePaths = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];
    for (const ffprobeBin of ffprobePaths) {
      try {
        const { stdout } = await execFileAsync(ffprobeBin, [
          "-i", audioPath,
          "-show_entries", "format=duration",
          "-v", "quiet",
          "-of", "csv=p=0"
        ]);
        const parsed = parseFloat(stdout.trim());
        if (!isNaN(parsed) && parsed > 0) {
          durationSecs = parsed;
          break;
        }
      } catch { /* try next path */ }
    }
    if (durationSecs === 8) {
      // Fallback: try afinfo (macOS built-in)
      try {
        const { stdout } = await execFileAsync("afinfo", [audioPath]);
        const match = stdout.match(/estimated duration:\s*([\d.]+)/i);
        if (match) {
          const parsed = parseFloat(match[1]);
          if (!isNaN(parsed) && parsed > 0) durationSecs = parsed;
        }
      } catch {
        // Last resort: file size estimate (very rough for compressed formats)
        try {
          const stat = await fs.stat(audioPath);
          durationSecs = Math.max(8, stat.size / 1024 / 4);
        } catch { /* use default */ }
      }
    }

    // Convert audio to WAV for Web Audio API decoding
    await fs.mkdir(this.env.TEMP_DIR, { recursive: true });
    let wavPath = audioPath;
    const ext = path.extname(audioPath).toLowerCase();
    if (ext !== ".wav") {
      try {
        wavPath = path.join(this.env.TEMP_DIR, `${Date.now()}-voice-${randomUUID()}.wav`);
        await execFileAsync("/opt/homebrew/bin/ffmpeg", [
          "-y", "-i", audioPath,
          "-ar", "48000", "-ac", "1",
          wavPath
        ], { timeout: 30_000 });
      } catch {
        try {
          wavPath = path.join(this.env.TEMP_DIR, `${Date.now()}-voice-${randomUUID()}.wav`);
          await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", "-c", "1", audioPath, wavPath]);
        } catch {
          wavPath = audioPath;
        }
      }
    }

    // Read WAV as base64 for injection into the page
    const wavBuffer = await fs.readFile(wavPath);
    const wavBase64 = wavBuffer.toString("base64");

    const recordingMs = Math.round(durationSecs * 1000) + 2000;
    this.logger.info({ durationSecs: Math.round(durationSecs * 10) / 10, recordingMs, wavPath }, "Voice recording: starting with getUserMedia override");

    // Relaunch browser with fake-ui flag so mic permission is auto-accepted,
    // but WITHOUT --use-file-for-fake-audio-capture (we inject audio via JS).
    await this.relaunchBrowser("__fake_mic_only__");

    if (!this.page) {
      throw new Error("browser_failure: page not initialized");
    }

    // Inject getUserMedia override BEFORE WhatsApp scripts load via addInitScript.
    // This ensures WhatsApp captures our overridden version, not the original.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (this.page as any).addInitScript((b64: string) => {
      const w = globalThis as any;
      w.__pttAudioBase64 = b64;

      const origGUM = w.navigator.mediaDevices.getUserMedia.bind(w.navigator.mediaDevices);
      w.navigator.mediaDevices.getUserMedia = async (constraints: any) => {
        const b64Data = w.__pttAudioBase64;
        if (constraints?.audio && b64Data) {
          w.__pttAudioBase64 = null;
          w.navigator.mediaDevices.getUserMedia = origGUM;

          const binaryStr = w.atob(b64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const AudioCtx = w.AudioContext || w.webkitAudioContext;
          const audioCtx = new AudioCtx({ sampleRate: 48000 });
          // Resume AudioContext (Chrome suspends it by default, producing silence)
          if (audioCtx.state === "suspended") {
            await audioCtx.resume();
          }
          const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);

          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          source.start(0);
          return dest.stream;
        }
        return origGUM(constraints);
      };
    }, wavBase64);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    this.logger.info("Voice recording: addInitScript override registered, navigating to chat");

    // Force a full page reload so addInitScript runs before WhatsApp's JS.
    // Without this, SPA navigation (same origin) won't create a new document
    // and addInitScript won't execute.
    await this.page.goto("about:blank");
    await this.page.waitForTimeout(500);
    await this.page.goto(`${this.env.WA_URL}/send?phone=${encodeURIComponent(phone)}`, {
      waitUntil: "domcontentloaded"
    });
    await this.waitForChatReady();
    await this.page.waitForTimeout(2_000);

    // Verify the override is active
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const overrideActive = await this.page.evaluate(() => {
      return !!(globalThis as any).__pttAudioBase64;
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    this.logger.info({ overrideActive }, "Voice recording: chat ready, override status checked");

    // Screenshot: before mic click
    const ssDir = this.env.SCREENSHOTS_DIR;
    await this.page.screenshot({ path: path.join(ssDir, "voice-01-before-mic-click.png") }).catch(() => null);

    // Click mic button to START recording
    const micButton = this.page.getByRole("button", { name: /mensagem de voz/i }).last();
    await micButton.waitFor({ timeout: 20_000 });
    await micButton.click({ force: true });

    // Wait briefly for recording UI to appear
    await this.page.waitForTimeout(2_000);

    // Screenshot: after mic click
    await this.page.screenshot({ path: path.join(ssDir, "voice-02-after-mic-click.png") }).catch(() => null);

    // Detect recording UI — WhatsApp Web shows a recording bar with timer, pause and delete buttons.
    // DO NOT retry mic click — a second click would CANCEL the active recording.
    const hasRecordingUI = await this.page.locator(
      "button[aria-label='Pausar'], button[aria-label='Pause'], span[data-icon='audio-cancel'], span[data-icon='delete'], [data-testid='ptt-cancel']"
    ).first().isVisible().catch(() => false);
    this.logger.info({ hasRecordingUI }, "Voice recording: recording UI check (no retry — second click cancels)");

    this.logger.info({ recordingMs }, "Voice recording: started, waiting for duration...");

    // Wait for the full audio to play through the injected stream
    await this.page.waitForTimeout(recordingMs);

    // Screenshot: before send click
    await this.page.screenshot({ path: path.join(ssDir, "voice-03-before-send.png") }).catch(() => null);

    // Click send button
    const sendButton = this.page
      .locator("button[aria-label*='Enviar'], span[data-icon='send'], div[role='button'][aria-label*='Enviar']")
      .last();
    await sendButton.waitFor({ timeout: 10_000 });
    await sendButton.click({ force: true });

    this.logger.info("Voice recording: send clicked, waiting for delivery...");

    // Wait for the voice message to be delivered (✓✓) before relaunching browser.
    // Without this, the browser closes mid-upload and the message never reaches the server.
    // Poll for msg-dblcheck icon in the last outgoing message (up to 30s).
    let delivered = false;
    for (let poll = 0; poll < 15; poll++) {
      await this.page.waitForTimeout(2_000);
      const status = await this.page.evaluate(() => {
        const doc = (globalThis as any).document; // eslint-disable-line @typescript-eslint/no-explicit-any
        const msgs = doc.querySelectorAll(".message-out");
        const last = msgs[msgs.length - 1];
        if (!last) return "no-message";
        if (last.querySelector("span[data-icon='msg-dblcheck']")) return "delivered";
        if (last.querySelector("span[data-icon='msg-check']")) return "sent";
        if (last.querySelector("span[data-icon='msg-time']")) return "pending";
        return "unknown";
      }).catch(() => "error");
      this.logger.info({ poll, status }, "Voice recording: delivery poll");
      if (status === "delivered") {
        delivered = true;
        break;
      }
    }

    // Screenshot: after delivery wait
    await this.page.screenshot({ path: path.join(ssDir, "voice-04-after-send.png") }).catch(() => null);

    if (!delivered) {
      this.logger.warn("Voice recording: message not confirmed delivered after 30s, proceeding anyway");
    }

    // Get bubble info for logging
    const bubbleInfo = await this.page.evaluate(() => {
      const doc = (globalThis as any).document; // eslint-disable-line @typescript-eslint/no-explicit-any
      const msgs = doc.querySelectorAll(".message-out");
      const last = msgs[msgs.length - 1];
      if (!last) return { found: false, text: "" };
      return { found: true, text: (last.textContent || "").trim().slice(0, 100) };
    }).catch(() => ({ found: false, text: "evaluate-failed" }));
    this.logger.info({ bubbleInfo, delivered, expectedDurationSecs: durationSecs }, "Voice recording: bubble verification");

    // Screenshot: final state
    await this.page.screenshot({ path: path.join(ssDir, "voice-05-final.png") }).catch(() => null);

    // Relaunch browser to clear the addInitScript override so it doesn't
    // affect future page navigations
    await this.relaunchBrowser();

    recordSystemEvent("wa-worker", "info", "Voice recording sent through WhatsApp recorder", {
      correlationId,
      phone,
      audioPath,
      recordingMs,
      durationSecs: Math.round(durationSecs * 10) / 10
    });
  }

  private async waitForChatReady() {
    if (!this.page) return;
    // WhatsApp shows "Iniciando conversa" modal when opening via deep link.
    // We must wait for it to disappear before interacting with the chat.
    try {
      const modal = this.page.getByText(/iniciando conversa/i).first();
      await modal.waitFor({ state: "hidden", timeout: 15_000 });
    } catch {
      // Modal already gone or never appeared
    }
    // Ensure the composer is ready
    const composer = this.page.locator("footer [contenteditable='true']").first();
    await composer.waitFor({ timeout: 10_000 }).catch(() => null);
    await this.page.waitForTimeout(500);
  }

  private async triggerSendAction(sendButton: Locator, isMedia: boolean) {
    if (!this.page) {
      throw new Error("browser_failure: page not initialized");
    }

    // Try to find send button, fallback to Enter key if not found
    try {
      await sendButton.waitFor({ timeout: 10_000 });
    } catch {
      // Button not found - try pressing Enter as fallback
      if (!isMedia) {
        await this.page.keyboard.press("Enter");
        return;
      }
      // For media, try broader selectors — use last() as send button may be in preview modal
      // Note: for multi-file, WA shows "Enviar N arquivos" so use contains (*=)
      const fallbackBtn = this.page.locator("span[data-icon='send'], [aria-label*='Enviar'], [data-testid='send']").last();
      await fallbackBtn.waitFor({ timeout: 15_000 });
      await fallbackBtn.click({ force: true });
      return;
    }

    const attempts: Array<() => Promise<void>> = [
      async () => {
        await sendButton.click({ force: true });
      },
      async () => {
        await sendButton.dispatchEvent("click");
      },
      async () => {
        await sendButton.evaluate((element) => {
          (element as { click?: () => void }).click?.();
        });
      },
      async () => {
        await sendButton.focus();
        await this.page?.keyboard.press("Enter");
      }
    ];

    let lastError: unknown = null;

    for (const attempt of attempts) {
      try {
        await attempt();
        if (!isMedia) {
          return;
        }

        const sendLocator = this.page.locator("button[aria-label*='Enviar'], div[aria-label*='Enviar']").last();
        try {
          await sendLocator.waitFor({ state: "detached", timeout: 5_000 });
        } catch {
          try {
            await sendLocator.waitFor({ state: "hidden", timeout: 2_000 });
          } catch {
            // The modal may keep the button mounted briefly while still sending; continue to next confirmation.
          }
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("locator_failure: unable to trigger WhatsApp send action");
  }

  private async convertVoiceWithAttendant(
    originalPath: string,
    attendantId: string,
    correlationId: string
  ): Promise<string> {
    const attendant = getAttendantById(attendantId);
    if (!attendant || attendant.voiceSamples.length === 0) {
      recordSystemEvent("wa-worker", "warn", "Attendant not found or has no voice samples — using original audio", {
        correlationId,
        attendantId
      });
      return originalPath;
    }

    const samplesDir = getAttendantSamplesDir(attendantId);
    const outputPath = path.join(this.env.TEMP_DIR, `${Date.now()}-xtts-${randomUUID()}.wav`);
    const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), "scripts", "voice_convert.py");
    const pythonBin = this.env.PYTHON_BIN;
    const timeoutMs = this.env.XTTS_TIMEOUT_SECONDS * 1000;

    recordSystemEvent("wa-worker", "info", "Starting voice conversion with XTTS v2", {
      correlationId,
      attendantId,
      attendantName: attendant.name,
      originalPath,
      outputPath
    });

    await execFileAsync(
      pythonBin,
      [
        scriptPath,
        "--input", originalPath,
        "--samples-dir", samplesDir,
        "--output", outputPath,
        "--whisper-model", this.env.WHISPER_MODEL_PATH
      ],
      {
        timeout: timeoutMs,
        env: {
          ...process.env,
          WHISPER_BIN: this.env.WHISPER_BIN,
          WHISPER_MODEL_PATH: this.env.WHISPER_MODEL_PATH
        }
      }
    );

    recordSystemEvent("wa-worker", "info", "Voice conversion complete", {
      correlationId,
      attendantName: attendant.name,
      outputPath
    });

    return outputPath;
  }

  private async prepareMediaForUpload(filePath: string, contentType: string, correlationId: string) {
    // Resolve relative media paths against known storage directories
    if (!path.isAbsolute(filePath)) {
      const candidates = [
        path.join(this.env.UPLOADS_DIR, "media", filePath),
        path.join(this.env.MEDIA_DIR, filePath),
        path.join(this.env.UPLOADS_DIR, filePath)
      ];
      let resolved = false;
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          this.logger.info({ original: filePath, resolved: candidate }, "Resolved relative media path");
          filePath = candidate;
          resolved = true;
          break;
        } catch { /* try next */ }
      }
      if (!resolved) {
        throw new Error(`upload_failure: media file not found at any known path (${filePath})`);
      }
    }

    // Audio: sendVoiceRecording handles its own WAV conversion internally.
    // Here we just resolve the path — no format conversion needed.
    if (contentType === "audio") {
      return filePath;
    }

    if (contentType !== "image") {
      return filePath;
    }

    const extension = path.extname(filePath).toLowerCase();
    if ([".jpg", ".jpeg"].includes(extension)) {
      return filePath;
    }

    try {
      const outputPath = path.join(this.env.TEMP_DIR, `${Date.now()}-${randomUUID()}.jpg`);
      await fs.mkdir(this.env.TEMP_DIR, { recursive: true });
      await execFileAsync("sips", ["-s", "format", "jpeg", filePath, "--out", outputPath]);
      recordSystemEvent("wa-worker", "info", "Image converted to jpeg before WhatsApp upload", {
        correlationId,
        sourcePath: filePath,
        outputPath
      });
      return outputPath;
    } catch (error) {
      recordSystemEvent("wa-worker", "warn", "Image conversion failed, keeping original upload", {
        correlationId,
        sourcePath: filePath,
        error: error instanceof Error ? error.message : String(error)
      });
      return filePath;
    }
  }

  private async validateRecipientPhone(phone: string, correlationId: string) {
    if (!this.page) {
      throw new Error("browser_failure: page not initialized");
    }

    await this.page.goto(`${this.env.WA_URL}/send?phone=${encodeURIComponent(phone)}`, {
      waitUntil: "domcontentloaded"
    });

    const composer = this.page.locator("footer [contenteditable='true']").first();
    const sendButton = this.page.locator("button span[data-icon='send'], button[aria-label*='Enviar'], div[aria-label*='Enviar']").first();
    const attachmentButton = this.page
      .locator("button[title='Anexar'], div[title='Anexar'], span[data-icon='plus-rounded']")
      .first();
    const invalidFragments = [
      "o número de telefone compartilhado através de url é inválido",
      "phone number shared via url is invalid",
      "número de telefone inválido",
      "invalid phone number",
      "não está no whatsapp",
      "isn't on whatsapp",
      "não existe no whatsapp",
      "not on whatsapp",
      "o número não está no whatsapp"
    ];

    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      if ((await composer.count().catch(() => 0)) > 0 || (await sendButton.count().catch(() => 0)) > 0 || (await attachmentButton.count().catch(() => 0)) > 0) {
        recordSystemEvent("wa-worker", "debug", "Recipient validation passed", {
          correlationId,
          phone
        });
        return { valid: true as const, reason: null };
      }

      const bodyText = ((await this.page.locator("body").innerText().catch(() => "")) || "").toLowerCase();
      const invalidText = invalidFragments.find((fragment) => bodyText.includes(fragment));
      if (invalidText) {
        return {
          valid: false as const,
          reason: `Número sem WhatsApp ativo: ${phone}`
        };
      }

      await this.page.waitForTimeout(500);
    }

    throw new Error(`locator_failure: timeout validating WhatsApp recipient ${phone}`);
  }

  private async extractUnreadCount(row: Locator) {
    // Try the actual unread badge element — WhatsApp uses a specific green circle with a number
    const badgeSelectors = [
      "[data-testid='icon-unread-count']",
      "[aria-label*='não lida']",
      "[aria-label*='não lidas']",
      "[aria-label*='unread']"
    ];

    for (const selector of badgeSelectors) {
      const candidate = row.locator(selector).last();
      if (!await candidate.isVisible({ timeout: 500 }).catch(() => false)) continue;
      const text = ((await candidate.innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
      const parsed = parseUnreadCountFromText(text);
      if (parsed > 0) {
        return parsed;
      }
    }

    // Fallback: check row aria-label for unread pattern (e.g. "3 mensagens não lidas")
    const rowLabel = ((await row.getAttribute("aria-label").catch(() => "")) || "").trim();
    return parseUnreadCountFromText(rowLabel);
  }

  private async resolveChatRows() {
    if (!this.page) {
      return null;
    }

    const selectors = [
      "#pane-side [role='row']",
      "#pane-side [role='grid'] > [role='row']",
      "#pane-side [role='gridcell'][tabindex='0']",
      "#pane-side [data-testid='cell-frame-container']",
      "#pane-side [data-testid='cell-frame-title']",
      "#pane-side div[aria-selected]",
      "#pane-side div[tabindex='-1']"
    ];

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const locator = this.page.locator(selector);
        const count = await locator.count().catch(() => 0);
        if (count > 0) {
          return locator;
        }
      }
      await this.page.waitForTimeout(750);
    }

    return null;
  }

  /**
   * Searches the sidebar for a row whose title matches the given string.
   * Scrolls back to top first, then scans down. Returns the Locator or null.
   * Used by Tier 2 processing for non-phone conversations after sidebar may have reordered.
   */
  private async findSidebarRowByTitle(title: string, isCancelled?: () => boolean): Promise<Locator | null> {
    if (!this.page) return null;
    const pane = this.page.locator("#pane-side").first();
    // Scroll sidebar to top so we always start from the beginning
    await pane.evaluate((el) => { el.scrollTop = 0; }).catch(() => null);
    await this.page.waitForTimeout(500);

    // Up to 300 attempts × 70% screen height each = covers thousands of conversations
    for (let attempt = 0; attempt < 300; attempt++) {
      if (isCancelled?.()) return null; // stop if Tier-2 timeout already fired
      const rows = await this.resolveChatRows();
      if (!rows) break;
      const count = await rows.count().catch(() => 0);
      if (count === 0) break;
      for (let i = 0; i < count; i++) {
        if (isCancelled?.()) return null;
        const row = rows.nth(i);
        const text = (await row.innerText({ timeout: 2000 }).catch(() => "")) || "";
        let parts = text.split("\n").map((p) => p.trim()).filter(Boolean);
        while (parts.length > 1 && (/^\d+\s+mensage/i.test(parts[0] ?? "") || /^\d+\s+unread/i.test(parts[0] ?? ""))) {
          parts = parts.slice(1);
        }
        if (parts[0] === title) return row;
        // Phone-number titles (e.g. "557194133275") may appear formatted in DOM
        // as "+55 71 9413 3275". Normalize both sides before comparing.
        if (/^\d{7,}$/.test(title) && parts[0].replace(/\D/g, "") === title) return row;
      }
      // Scroll down a bit and search again
      if (isCancelled?.()) return null;
      const prevTop = await pane.evaluate((el) => el.scrollTop).catch(() => 0);
      await pane.evaluate((el) => el.scrollBy(0, Math.floor(el.clientHeight * 0.7))).catch(() => null);
      await this.page.waitForTimeout(350);
      const newTop = await pane.evaluate((el) => el.scrollTop).catch(() => 0);
      // If scroll didn't move, we've reached the bottom — conversation not found
      if (newTop === prevTop) break;
    }
    return null;
  }

  /**
   * After a named contact's conversation is open, clicks the header to open
   * the Details panel and extracts the phone number shown there.
   * Returns digits-only string or null if not found.
   */
  private async extractPhoneFromContactDetails(): Promise<string | null> {
    if (!this.page) return null;
    try {
      // Click the conversation header to open contact details panel
      await this.page.locator("#main header").first().click({ timeout: 3000 });
      await this.page.waitForTimeout(1200);

      // Extract phone from the details drawer — look for text matching Brazilian/intl phone pattern
      const phone = await this.page.evaluate(() => {
        const doc = (globalThis as any).document;
        // WA Web renders the details drawer as a right panel / aside
        // Phone numbers appear as copyable-text spans
        const phoneRegex = /^[\+\d][\d\s\-\(\)]{7,20}$/;
        // Try multiple panel containers WA uses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const containers: any[] = Array.from(doc.querySelectorAll(
          "aside, [data-testid='contact-info-drawer'], [data-testid='contact-info']," +
          " #app div[style*='transform'] > div, div[role='complementary']"
        ));
        for (const container of containers) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const spans: any[] = Array.from(container.querySelectorAll("span, div"));
          for (const el of spans) {
            const t = ((el.innerText as string) || "").trim();
            if (phoneRegex.test(t)) {
              const digits = t.replace(/\D/g, "");
              if (digits.length >= 8) return digits;
            }
          }
        }
        // Fallback: scan full page for phone-shaped text next to a phone icon
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const phoneIcons: any[] = Array.from(doc.querySelectorAll(
          "[data-icon='cell'], [data-icon='phone'], [data-icon='cel']"
        ));
        for (const icon of phoneIcons) {
          const section = icon.closest("div")?.parentElement;
          if (!section) continue;
          const t = ((section.innerText as string) || "").trim();
          const m = t.match(/[\+\d][\d\s\-\(\)]{7,20}/);
          if (m) {
            const digits = m[0].replace(/\D/g, "");
            if (digits.length >= 8) return digits;
          }
        }
        return null;
      }).catch(() => null);

      // Close the details panel
      await this.page.keyboard.press("Escape").catch(() => null);
      await this.page.waitForTimeout(500);

      return phone;
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Sync walk helpers — forward/backward boundary-driven algorithm.
  //
  // The walk opens chats in sidebar order (newest-first, pinned ignored), reads
  // the last bubble, and compares it to the DB by minute + direction + body.
  // As soon as a match is found the walk stops (boundary). Then we backfill
  // each visited chat + the boundary by scrolling up inside the chat and
  // inserting bubbles that don't exist in the DB.
  // ═══════════════════════════════════════════════════════════════════

  private async scrollSidebarToTop(): Promise<void> {
    if (!this.page) return;
    const pane = this.page.locator("#pane-side").first();
    await pane.evaluate((el) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = (el.ownerDocument as any).defaultView;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findScrollable = (root: any): any => {
        const style = win.getComputedStyle(root);
        const ov = style.overflowY;
        if ((ov === "scroll" || ov === "auto") && root.scrollHeight > root.clientHeight + 50) return root;
        for (const child of Array.from(root.children)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const found = findScrollable(child as any);
          if (found) return found;
        }
        return null;
      };
      const target = findScrollable(el) || el;
      target.scrollTop = 0;
    }).catch(() => null);
  }

  private async scrollSidebarDown(ratio: number): Promise<boolean> {
    if (!this.page) return false;
    const pane = this.page.locator("#pane-side").first();
    const result = await pane.evaluate((el, r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = (el.ownerDocument as any).defaultView;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findScrollable = (root: any): any => {
        const style = win.getComputedStyle(root);
        const ov = style.overflowY;
        if ((ov === "scroll" || ov === "auto") && root.scrollHeight > root.clientHeight + 50) return root;
        for (const child of Array.from(root.children)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const found = findScrollable(child as any);
          if (found) return found;
        }
        return null;
      };
      const target = findScrollable(el) || el;
      const before = target.scrollTop;
      target.scrollTop += Math.floor(target.clientHeight * r);
      return { before, after: target.scrollTop };
    }, ratio).catch(() => ({ before: 0, after: 0 }));
    return result.after > result.before;
  }

  private async isPinnedRow(row: Locator): Promise<boolean> {
    // Match any data-icon whose name contains 'pin' (pinned, pinned2,
    // pinned-filled, pin-chat, etc.) plus Portuguese/English aria labels.
    const pinned = await row.evaluate((el) => {
      const icons = el.querySelectorAll("[data-icon]");
      for (let i = 0; i < icons.length; i++) {
        const v = (icons[i].getAttribute("data-icon") || "").toLowerCase();
        if (v.includes("pin")) return true;
      }
      const aria = el.querySelectorAll("[aria-label]");
      for (let i = 0; i < aria.length; i++) {
        const v = (aria[i].getAttribute("aria-label") || "").toLowerCase();
        if (v.includes("fixad") || v.includes("pinned")) return true;
      }
      return false;
    }).catch(() => false);
    return pinned;
  }

  private isSpecialRowTitle(title: string): boolean {
    return (
      /^(Status|Atualizações|Transmissão|Broadcast|Não lida|Não lidas|Unread)$/i.test(title)
      || /^arquivad/i.test(title)
      || /^archived/i.test(title)
    );
  }

  private parseSidebarTime(raw: string): string | null {
    const sidebarTime = (raw ?? "").trim();
    if (!sidebarTime) return null;

    const todayTimeMatch = sidebarTime.match(/^(\d{1,2}):(\d{2})$/);
    if (todayTimeMatch) {
      const [, hh, mm] = todayTimeMatch;
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hh), Number(mm), 0).toISOString();
    }
    if (/^ontem$/i.test(sidebarTime) || /^yesterday$/i.test(sidebarTime)) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      y.setHours(12, 0, 0, 0);
      return y.toISOString();
    }
    const dayMap: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, "sáb": 6 };
    if (/^(dom|seg|ter|qua|qui|sex|s[áa]b)\./i.test(sidebarTime)) {
      const abbr = sidebarTime.slice(0, 3).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const targetDay = dayMap[abbr];
      if (targetDay !== undefined) {
        const now = new Date();
        let diff = now.getDay() - targetDay;
        if (diff <= 0) diff += 7;
        const d = new Date(now);
        d.setDate(d.getDate() - diff);
        d.setHours(12, 0, 0, 0);
        return d.toISOString();
      }
    }
    const dateMatch = sidebarTime.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (dateMatch) {
      const [, dd, mo, yyOrYyyy] = dateMatch;
      const now = new Date();
      const yyyy = yyOrYyyy ? (yyOrYyyy.length === 2 ? 2000 + Number(yyOrYyyy) : Number(yyOrYyyy)) : now.getFullYear();
      return new Date(yyyy, Number(mo) - 1, Number(dd), 12, 0, 0).toISOString();
    }
    return null;
  }

  private async readRowMeta(row: Locator): Promise<{
    title: string;
    phone: string | null;
    chatKey: string;
    preview: string;
    sidebarTime: string;
    sidebarLastMsgAt: string | null;
    unreadCount: number;
  } | null> {
    const rawText = (await row.innerText({ timeout: 3000 }).catch(() => "")) || "";
    if (!rawText) return null;
    let parts = rawText.split("\n").map((p) => p.trim()).filter(Boolean);
    while (parts.length > 1 && (/^\d+\s+mensage/i.test(parts[0] ?? "") || /^\d+\s+unread/i.test(parts[0] ?? ""))) {
      parts = parts.slice(1);
    }
    const title = (parts[0] ?? "").trim();
    if (!title || this.isSpecialRowTitle(title)) return null;

    const sidebarTime = (parts[1] ?? "").trim();
    const sidebarLastMsgAt = this.parseSidebarTime(sidebarTime);

    let previewIdx = parts.length - 1;
    while (previewIdx > 1 && /^\d+$/.test(parts[previewIdx] ?? "")) previewIdx--;
    const rawPreview = parts[previewIdx] ?? "";
    const preview = /^\d+:\d{2}$/.test(rawPreview) ? "🎤 Áudio" : rawPreview;

    const digits = title.replace(/\D/g, "");
    const phone = digits.length >= 8 ? digits : null;
    const chatKey = phone ?? `title:${title}`;

    const unreadCount = await this.extractUnreadCount(row);

    return { title, phone, chatKey, preview, sidebarTime, sidebarLastMsgAt, unreadCount };
  }

  private async openChatFromRow(row: Locator, isCancelled: () => boolean): Promise<boolean> {
    if (!this.page) return false;
    if (isCancelled()) return false;

    const headerBefore = ((await this.page.locator("#main header").first().innerText({ timeout: 1000 }).catch(() => "")) || "").trim();

    await row.click({ timeout: 4000 }).catch(() => null);
    if (isCancelled()) return false;

    await this.page.waitForFunction(
      (prev) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (globalThis as any).document;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const header = (doc.querySelector("#main header") as any);
        const h = ((header?.innerText as string) || "").trim();
        const bubbles = doc.querySelectorAll("#main [data-pre-plain-text]").length;
        if (!prev && bubbles > 0) return true;
        if (prev && h && h !== prev) return true;
        return bubbles > 0;
      },
      headerBefore,
      { timeout: 10_000 }
    ).catch(() => null);
    if (isCancelled()) return false;

    await this.page.locator("#main [data-pre-plain-text]").first()
      .waitFor({ state: "attached", timeout: 8_000 }).catch(() => null);
    return true;
  }

  private async extractVisibleBubbles(isCancelled: () => boolean): Promise<Array<{
    body: string;
    direction: "incoming" | "outgoing";
    contentType: "text" | "audio" | "image" | "video" | "file";
    sentAt: string | null;
    fingerprint: string;
  }> | null> {
    if (!this.page) return null;
    if (isCancelled()) return null;

    const raw = await this.page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      const main = doc.querySelector("#main") ?? doc;
      const bubbles = main.querySelectorAll("[data-pre-plain-text]");
      const results: Array<{ body: string; preText: string | null; outgoing: boolean; mediaType: string | null }> = [];

      for (const el of bubbles) {
        const preText = el.getAttribute("data-pre-plain-text");
        const msgContainer = el.closest(".message-out, .message-in");
        const outgoing = msgContainer?.classList.contains("message-out") ?? false;

        let mediaType: string | null = null;
        if (el.querySelector("[data-icon='audio-play'], [data-icon='ptt'], [data-testid='audio-play'], [data-testid='ptt']")) {
          mediaType = "audio";
        } else if (el.querySelector("img[src*='blob:'], img[src*='media'], [data-testid='image-thumb']")) {
          mediaType = "image";
        } else if (el.querySelector("video, [data-testid='video-thumb'], [data-icon='video-pip']")) {
          mediaType = "video";
        } else if (el.querySelector("[data-icon='audio-download'], [data-icon='document'], [data-testid='document-thumb']")) {
          mediaType = "file";
        } else if (
          el.querySelector("[data-icon='call'], [data-icon='video-call'], [data-icon='phone-missed'], [data-testid='call-log']") ||
          el.closest("[data-testid='call-log']")
        ) {
          mediaType = "call";
        }

        let body = "";
        const copyable = el.querySelector(".copyable-text [class*='selectable']");
        if (copyable) {
          body = ((copyable.textContent ?? "").trim()).replace(/\s*\d{1,2}:\d{2}\s*$/, "").trim();
        }
        if (!body) {
          const selectables = el.querySelectorAll("[class*='selectable']");
          for (const s of selectables) {
            const t = ((s.textContent ?? "").trim()).replace(/\s*\d{1,2}:\d{2}\s*$/, "").trim();
            if (t) { body = t; break; }
          }
        }
        if (!body && !mediaType) {
          body = ((el.textContent ?? "").trim()).replace(/\s*\d{1,2}:\d{2}\s*$/, "").trim();
        }

        if (!body && !mediaType) continue;

        if (!body && mediaType) {
          const labels: Record<string, string> = {
            audio: "🎤 Áudio",
            image: "📷 Foto",
            video: "🎥 Vídeo",
            file: "📎 Arquivo",
            call: "📞 Ligação"
          };
          body = labels[mediaType] ?? "Mídia";
        }

        results.push({ body, preText, outgoing, mediaType });
      }
      return results;
    }).catch(() => null);

    if (!raw) return null;

    const out: Array<{
      body: string;
      direction: "incoming" | "outgoing";
      contentType: "text" | "audio" | "image" | "video" | "file";
      sentAt: string | null;
      fingerprint: string;
    }> = [];
    const validContentTypes = new Set(["text", "audio", "image", "video", "file"]);

    for (const r of raw) {
      let sentAt: string | null = null;
      if (r.preText) {
        const tsMatch = r.preText.match(/\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/);
        if (tsMatch) {
          const [, hh, mm, dd, mo, yyOrYyyy] = tsMatch;
          const yyyy = yyOrYyyy.length === 2 ? `20${yyOrYyyy}` : yyOrYyyy;
          const pad = (n: string) => n.padStart(2, "0");
          // Build ISO-8601 local-time (no Z) so V8 parses in system local
          // timezone — matches what WA Web shows on screen. Prevents off-by-one
          // day errors around midnight when converting BRT → UTC.
          sentAt = new Date(`${yyyy}-${pad(mo)}-${pad(dd)}T${pad(hh)}:${pad(mm)}:00`).toISOString();
        }
      }
      const contentType: "text" | "audio" | "image" | "video" | "file" =
        (r.mediaType && r.mediaType !== "call" && validContentTypes.has(r.mediaType))
          ? (r.mediaType as "audio" | "image" | "video" | "file")
          : "text";
      const direction: "incoming" | "outgoing" = r.outgoing ? "outgoing" : "incoming";
      const fingerprint = `${r.preText ?? ""}|${direction}|${r.body.slice(0, 40)}`;
      out.push({ body: r.body, direction, contentType, sentAt, fingerprint });
    }
    return out;
  }

  private async readLastBubble(isCancelled: () => boolean): Promise<{
    body: string;
    direction: "incoming" | "outgoing";
    contentType: "text" | "audio" | "image" | "video" | "file";
    sentAt: string | null;
    fingerprint: string;
  } | null> {
    const bubbles = await this.extractVisibleBubbles(isCancelled);
    if (!bubbles || bubbles.length === 0) return null;
    return bubbles[bubbles.length - 1] ?? null;
  }

  private async scrollChatUp(isCancelled: () => boolean): Promise<boolean> {
    if (!this.page) return false;
    if (isCancelled()) return false;
    const prevCount = await this.page.locator("#main [data-pre-plain-text]").count().catch(() => 0);
    await this.page.mouse.wheel(0, -3000).catch(() => null);
    await this.page.waitForTimeout(900);
    const newCount = await this.page.locator("#main [data-pre-plain-text]").count().catch(() => prevCount);
    return newCount > prevCount;
  }

  private async backfillChat(
    target: { title: string; phone: string | null; conversationId: string },
    isCancelled: () => boolean,
    budgetExceeded?: () => boolean
  ): Promise<number> {
    if (!this.page) return 0;
    if (isCancelled()) return 0;

    const row = await this.findSidebarRowByTitle(target.title, isCancelled);
    if (!row) {
      this.logger.warn({ title: target.title }, "backfill: sidebar row not found");
      return 0;
    }

    const opened = await this.openChatFromRow(row, isCancelled);
    if (!opened) return 0;
    if (isCancelled()) return 0;

    const bubblesSeen = new Set<string>();
    type Bubble = {
      body: string;
      direction: "incoming" | "outgoing";
      contentType: "text" | "audio" | "image" | "video" | "file";
      sentAt: string | null;
      fingerprint: string;
    };
    const pending: Bubble[] = [];
    const scrollCap = this.env.WA_SYNC_BACKFILL_SCROLL_CAP;
    let foundOverlap = false;
    let passes = 0;
    let stopReason: "overlap" | "top" | "cap" | "cancelled" | "budget" | "empty" = "cap";

    for (let pass = 0; pass <= scrollCap; pass++) {
      passes = pass + 1;
      if (isCancelled()) { stopReason = "cancelled"; break; }
      if (budgetExceeded?.()) { stopReason = "budget"; break; }

      let bubbles = await this.extractVisibleBubbles(isCancelled);
      // On first pass, WA may still be rendering; give it one retry window.
      if (pass === 0 && (!bubbles || bubbles.length === 0)) {
        await this.page?.waitForTimeout(1500);
        bubbles = await this.extractVisibleBubbles(isCancelled);
      }
      if (!bubbles || bubbles.length === 0) { stopReason = "empty"; break; }

      const fresh: Bubble[] = [];
      for (const b of bubbles) {
        if (bubblesSeen.has(b.fingerprint)) continue;
        bubblesSeen.add(b.fingerprint);
        fresh.push(b);
      }
      if (fresh.length === 0) {
        const scrolled = await this.scrollChatUp(isCancelled);
        if (!scrolled) { stopReason = "top"; break; }
        continue;
      }

      // Walk newest → oldest among fresh bubbles. Break as soon as we find a
      // match (everything older is assumed already in DB).
      const reversed = fresh.slice().reverse();
      const batchReverseChrono: Bubble[] = [];
      for (const bubble of reversed) {
        if (isCancelled()) break;
        if (!bubble.sentAt) {
          batchReverseChrono.push(bubble);
          continue;
        }
        const minuteKey = bubble.sentAt.slice(0, 16);
        const mediaType = bubble.contentType === "text" ? null : bubble.contentType;
        const hit = findMessageByMinute(target.conversationId, {
          minuteKey,
          direction: bubble.direction,
          body: bubble.body,
          mediaType
        });
        if (hit) {
          foundOverlap = true;
          break;
        }
        batchReverseChrono.push(bubble);
      }

      // batchReverseChrono is newest→oldest. Reverse to chronological, then
      // prepend so final `pending` stays oldest→newest overall.
      const chronological = batchReverseChrono.slice().reverse();
      pending.unshift(...chronological);

      if (foundOverlap) { stopReason = "overlap"; break; }

      const scrolled = await this.scrollChatUp(isCancelled);
      if (!scrolled) { stopReason = "top"; break; }
    }

    // Persist whatever we collected even on cancel/budget — losing scraped
    // work defeats the point of the budget check. addMessage is idempotent by
    // (minuteKey, direction, body) via findMessageByMinute on re-sync.
    let inserted = 0;
    for (const b of pending) {
      try {
        addMessage({
          conversationId: target.conversationId,
          direction: b.direction,
          contentType: b.contentType,
          body: b.body,
          sentAt: b.sentAt ?? nowIso(),
          meta: { source: "snapshot" }
        });
        inserted++;
      } catch (err) {
        this.logger.warn({
          title: target.title,
          error: err instanceof Error ? err.message : String(err)
        }, "backfill: addMessage failed");
      }
    }

    this.logger.info({
      title: target.title,
      passes,
      bubblesSeen: bubblesSeen.size,
      inserted,
      stopReason
    }, "Backfill chat complete");

    return inserted;
  }

  async syncInbox(reason: "startup" | "interval" | "full") {
    if (this.browserTask !== "idle") {
      this.logger.debug({ browserTask: this.browserTask }, "Sync skipped — browser busy");
      return;
    }

    this.browserTask = "sync";
    this.browserTaskStartedAt = Date.now();
    this.lastOpenPhone = null;

    const correlationId = randomUUID();
    const token = { cancelled: false };
    this.syncCancelToken = token;
    const forwardBudgetMs = this.env.WA_SYNC_FORWARD_BUDGET_MS;
    const backfillBudgetMs = this.env.WA_SYNC_BACKFILL_BUDGET_MS;
    const startTs = Date.now();
    const isCancelled = () => token.cancelled;
    let forwardStartedAt = startTs;
    let backfillStartedAt = startTs;
    const forwardBudgetExceeded = () => Date.now() - forwardStartedAt > forwardBudgetMs;
    const backfillBudgetExceeded = () => Date.now() - backfillStartedAt > backfillBudgetMs;

    let forwardVisited = 0;
    let boundaryFound = false;
    let backfilledChats = 0;
    let insertedMsgs = 0;
    let pinnedSkipped = 0;
    let specialSkipped = 0;
    let openFailures = 0;

    try {
      if (this.env.DEBUG_MODE && this.page) {
        await this.page.screenshot({ path: path.join(this.env.SCREENSHOTS_DIR, `sync-sidebar-${reason}.png`) }).catch(() => null);
      }
      await this.ensureAuthenticated();
      if (!this.page) return;

      if (!this.page.url().startsWith(this.env.WA_URL)) {
        await this.page.goto(this.env.WA_URL, { waitUntil: "domcontentloaded" });
      }

      // ─── FORWARD WALK ─────────────────────────────────────────────────
      const visited: Array<{ title: string; phone: string | null; conversationId: string }> = [];
      let boundary: { title: string; phone: string | null; conversationId: string } | null = null;
      const visitedTitles = new Set<string>();

      // Resume from prior cycle: if we have pending backfill targets left over
      // from a budget-exceeded cycle, skip forward walk and drain them first.
      // This makes cold-start converge across cycles instead of forever
      // re-detecting chat #1 as boundary and orphaning #4..#N.
      const resuming = this.pendingBackfill.length > 0;
      if (resuming) {
        this.logger.info({ pending: this.pendingBackfill.length }, "Sync resuming pending backfill");
      }

      await this.scrollSidebarToTop();
      await this.page.waitForTimeout(400);

      let rows = await this.resolveChatRows();
      if (!rows) {
        this.logger.warn("Sidebar not ready — 0 chat rows detected");
        this.updateState({
          status: "authenticated",
          authStatus: "authenticated",
          lastActivityAt: nowIso(),
          lastSyncAt: nowIso()
        });
        await this.publishState({ lastSyncReason: reason, note: "WhatsApp chat list not found yet" });
        return;
      }

      forwardStartedAt = Date.now();
      let cursor = 0;
      let stallScrolls = 0;
      let forwardStopReason: "boundary" | "cancelled" | "budget" | "bottom" | "no-rows" | "skipped-resume" = "bottom";

      while (!resuming) {
        if (isCancelled()) { forwardStopReason = "cancelled"; break; }
        if (forwardBudgetExceeded()) { forwardStopReason = "budget"; break; }

        const count = await rows.count().catch(() => 0);
        if (cursor >= count) {
          const advanced = await this.scrollSidebarDown(0.85);
          if (!advanced) {
            stallScrolls++;
            if (stallScrolls >= 3) { forwardStopReason = "bottom"; break; }
            await this.page.waitForTimeout(1200);
          } else {
            stallScrolls = 0;
            await this.page.waitForTimeout(500);
          }
          rows = await this.resolveChatRows();
          if (!rows) { forwardStopReason = "no-rows"; break; }
          continue;
        }

        const row = rows.nth(cursor);
        cursor++;

        if (await this.isPinnedRow(row)) {
          pinnedSkipped++;
          continue;
        }

        const meta = await this.readRowMeta(row).catch(() => null);
        if (!meta) {
          specialSkipped++;
          continue;
        }
        if (visitedTitles.has(meta.title)) continue; // already processed higher up

        const opened = await this.openChatFromRow(row, isCancelled);
        if (isCancelled()) { forwardStopReason = "cancelled"; break; }
        if (forwardBudgetExceeded()) { forwardStopReason = "budget"; break; }
        if (!opened) {
          openFailures++;
          this.logger.debug({ title: meta.title }, "forward: open failed, skipping");
          continue;
        }

        // Upsert conversation so we have a stable ID for matching
        const convo = upsertConversation({
          waChatId: meta.chatKey,
          title: meta.title,
          unreadCount: meta.unreadCount,
          lastMessagePreview: meta.preview,
          lastMessageAt: meta.sidebarLastMsgAt,
          lastMessageDirection: null,
          contactPhone: meta.phone
        });
        if (!convo) continue;

        const last = await this.readLastBubble(isCancelled);
        if (isCancelled()) { forwardStopReason = "cancelled"; break; }
        if (forwardBudgetExceeded()) { forwardStopReason = "budget"; break; }

        let matched = false;
        if (last && last.sentAt) {
          const minuteKey = last.sentAt.slice(0, 16);
          const mediaType = last.contentType === "text" ? null : last.contentType;
          const hit = findMessageByMinute(convo.id, {
            minuteKey,
            direction: last.direction,
            body: last.body,
            mediaType
          });
          if (hit) matched = true;
        }

        this.logger[matched ? "info" : "debug"]({
          title: meta.title,
          convId: convo.id,
          hasLastBubble: !!last,
          bubbleSentAt: last?.sentAt ?? null,
          bubbleDirection: last?.direction ?? null,
          bubbleContentType: last?.contentType ?? null,
          bubbleBodyPrefix: last?.body?.slice(0, 40) ?? null,
          matched
        }, "forward: chat probed");

        if (matched) {
          boundary = { title: meta.title, phone: meta.phone, conversationId: convo.id };
          boundaryFound = true;
          visitedTitles.add(meta.title);
          forwardStopReason = "boundary";
          break;
        }

        visited.push({ title: meta.title, phone: meta.phone, conversationId: convo.id });
        visitedTitles.add(meta.title);
        forwardVisited++;
      }

      if (resuming) {
        forwardStopReason = "skipped-resume";
      }

      const forwardDurationMs = Date.now() - forwardStartedAt;
      this.logger.info({
        reason,
        forwardVisited,
        boundaryFound,
        pinnedSkipped,
        specialSkipped,
        openFailures,
        forwardDurationMs,
        forwardStopReason
      }, "Forward walk complete");

      // ─── BACKWARD BACKFILL ────────────────────────────────────────────
      // Boundary first (oldest target), then visited reversed so the most
      // recent conversation is processed LAST. Final addMessage in that chat
      // will set conversation.last_message_at to the newest bubble.
      const backfillTargets = resuming
        ? this.pendingBackfill.slice()
        : (boundary ? [boundary, ...visited.slice().reverse()] : visited.slice().reverse());

      backfillStartedAt = Date.now();
      let backfillStopReason: "done" | "cancelled" | "budget" = "done";

      let idx = 0;
      for (; idx < backfillTargets.length; idx++) {
        const target = backfillTargets[idx];
        if (isCancelled()) { backfillStopReason = "cancelled"; break; }
        if (backfillBudgetExceeded()) { backfillStopReason = "budget"; break; }
        try {
          const added = await this.backfillChat(target, isCancelled, backfillBudgetExceeded);
          insertedMsgs += added;
          backfilledChats++;
        } catch (err) {
          this.logger.warn({
            title: target.title,
            error: err instanceof Error ? err.message : String(err)
          }, "Backfill failed for chat");
        }
      }

      // Persist remaining targets for next cycle if we bailed early.
      if (backfillStopReason === "done") {
        this.pendingBackfill = [];
      } else {
        this.pendingBackfill = backfillTargets.slice(idx);
        this.logger.info({ remaining: this.pendingBackfill.length, reason: backfillStopReason }, "Sync saved pending backfill for next cycle");
      }

      const backfillDurationMs = Date.now() - backfillStartedAt;
      const syncDurationMs = Date.now() - startTs;
      const cancelled = isCancelled();

      this.logger.info({
        reason,
        forwardVisited,
        boundaryFound,
        backfilledChats,
        insertedMsgs,
        forwardDurationMs,
        backfillDurationMs,
        durationMs: syncDurationMs,
        cancelled,
        forwardStopReason,
        backfillStopReason
      }, "Sync cycle complete");

      this.updateState({
        status: this.state.status === "degraded" ? "degraded" : "authenticated",
        authStatus: "authenticated",
        lastActivityAt: nowIso(),
        // Advance lastSyncAt on any cycle that completed its forward walk and
        // wasn't cancelled mid-flight. "Budget exceeded" is expected during
        // cold-start and shouldn't block the timestamp from advancing.
        ...(cancelled ? {} : { lastSyncAt: nowIso() })
      });
      await this.publishState({ lastSyncReason: reason });
      recordSystemEvent("wa-worker", "info", "Inbox synchronized", {
        correlationId,
        reason,
        forwardVisited,
        boundaryFound,
        backfilledChats,
        insertedMsgs,
        cancelled,
        forwardStopReason,
        backfillStopReason,
        durationMs: syncDurationMs
      });
    } catch (error) {
      const errorType = classifyError(error);
      const nextFailures = this.state.consecutiveFailures + 1;
      this.updateState({
        status: errorType === "authentication_failure"
          ? "disconnected"
          : nextFailures >= this.env.WORKER_FAILURE_THRESHOLD ? "degraded" : "error",
        authStatus: errorType === "authentication_failure" ? "disconnected" : this.state.authStatus,
        lastFailureAt: nowIso(),
        lastFailureSummary: error instanceof Error ? error.message : String(error),
        lastErrorType: errorType,
        consecutiveFailures: nextFailures
      });
      await this.publishState({ lastCorrelationId: correlationId });
    } finally {
      this.syncCancelToken = null;
      this.browserTask = "idle";
      this.browserTaskStartedAt = 0;
    }
  }

  private async syncInstagramInbox(reason: "startup" | "interval") {
    if (!this.env.IG_ENABLE_INBOX_SYNC) {
      return;
    }

    if (!this.env.IG_USE_SHARED_BROWSER || this.browserTask !== "idle") {
      return;
    }

    const instagramState = this.readInstagramSessionState();
    if (!instagramState.authenticated && instagramState.status !== "connected") {
      return;
    }

    this.browserTask = "sync";
    this.browserTaskStartedAt = Date.now();
    this.lastOpenPhone = null;
    const correlationId = randomUUID();

    try {
      const { syncInstagramInboxToDatabase } = await import("../../web-app/src/server/lib/instagram-sync.js");
      const result = await syncInstagramInboxToDatabase({
        threadLimit: this.env.IG_SYNC_THREADS_LIMIT,
        messagesLimit: this.env.IG_SYNC_MESSAGES_LIMIT,
        scrollPasses: this.env.IG_SYNC_SCROLL_PASSES
      });

      recordSystemEvent("instagram-assisted", "info", "Instagram inbox synchronized", {
        correlationId,
        reason,
        syncedThreads: result.syncedThreads,
        importedMessages: result.importedMessages,
        automationsQueued: result.automationsQueued
      });
    } catch (error) {
      recordSystemEvent("instagram-assisted", "error", "Instagram inbox sync failed", {
        correlationId,
        reason,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.browserTask = "idle";
      this.browserTaskStartedAt = 0;
    }
  }
}
