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
  getDb,
  getWorkerState,
  handleAutomationJobFailure,
  handleAutomationJobSuccess,
  handleCampaignJobFailure,
  handleCampaignJobSuccess,
  type InstagramAssistedSessionState,
  isSqliteBusyError,
  loadEnv,
  markCampaignRecipientFailed,
  markCampaignRecipientValidated,
  recordSystemEvent,
  saveConversationSnapshot,
  sendJobPayloadSchema,
  setWorkerState,
  upsertConversation
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
  const matches = text.match(/\b\d+\b/g) ?? [];
  const candidates = matches
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 1000);

  return candidates.at(-1) ?? 0;
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
      openPage: this.env.IG_USE_SHARED_BROWSER && this.env.IG_OPEN_ON_STARTUP,
      reason: "startup"
    });
    await this.focusPreferredStartupTab();

    this.heartbeatTimer = setInterval(() => {
      void this.runLoopTask("heartbeat", async () => {
        await this.refreshAuthState();
        await this.publishState();
        await this.refreshInstagramSessionState({
          openPage: this.env.IG_USE_SHARED_BROWSER && this.env.IG_OPEN_ON_STARTUP,
          reason: "heartbeat"
        });
        await this.restartIfNeeded();
        await this.processJob();
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
      "--start-maximized",
      "--window-size=1512,920",
      "--force-device-scale-factor=1",
      `--remote-debugging-address=${this.env.CHROMIUM_CDP_HOST}`,
      `--remote-debugging-port=${this.env.CHROMIUM_CDP_PORT}`
    ];

    if (audioCapturePath) {
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
    await this.refreshInstagramSessionState({
      openPage: this.env.IG_USE_SHARED_BROWSER && this.env.IG_OPEN_ON_STARTUP,
      reason: "relaunch"
    });
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
      await this.instagramPage.bringToFront().catch(() => null);
      return;
    }

    if (this.state.authStatus !== "authenticated" && this.isPageOpen(this.page)) {
      await this.page.bringToFront().catch(() => null);
      return;
    }

    if (this.isPageOpen(this.webAppPage)) {
      await this.webAppPage.bringToFront().catch(() => null);
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
    await this.page?.bringToFront().catch(() => null);
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
      if (this.browserTask === "sync" && this.browserTaskStartedAt > 0 && Date.now() - this.browserTaskStartedAt > 30_000) {
        recordSystemEvent("wa-worker", "warn", "Stuck inbox sync released for pending job", {
          browserTask: this.browserTask,
          runningForMs: Date.now() - this.browserTaskStartedAt
        });
        this.browserTask = "idle";
        this.browserTaskStartedAt = 0;
      }
      if (this.browserTask !== "idle") {
        return;
      }

      let job: Record<string, unknown> | null = null;
      try {
        job = claimDueJobForTypes(`${os.hostname()}-${process.pid}`, ["send-message", "send-assisted-message", "validate-recipient"]);
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
            meta: {
              source: payload.source,
              correlationId
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
        addMessage({
          conversationId: conversation.id,
          contactId: conversation.contactId,
          direction: "outgoing",
          contentType: toMessageContentType(payload.contentType),
          body: payload.text || payload.caption || "",
          sentAt: nowIso(),
          meta: {
            source: payload.source,
            correlationId
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
      recordSystemEvent("wa-worker", "info", "WhatsApp job completed", {
        correlationId,
        jobId: String(job.id),
        source: payload.source
      });
    } catch (error) {
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

    if (payload.contentType === "audio") {
      if (!payload.mediaPath) {
        throw new Error("upload_failure: audio step requires mediaPath");
      }

      const uploadedAudioPath = await this.prepareMediaForUpload(payload.mediaPath, payload.contentType, correlationId);
      await this.sendVoiceRecording(phone, uploadedAudioPath, correlationId);
      return;
    }

    const targetUrl =
      payload.contentType === "text"
        ? `${this.env.WA_URL}/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(payload.text)}`
        : `${this.env.WA_URL}/send?phone=${encodeURIComponent(phone)}`;

    await this.page.goto(targetUrl, {
      waitUntil: "domcontentloaded"
    });

    const textSendButton = this.page.locator("footer button[aria-label='Enviar'], footer div[aria-label='Enviar']").last();
    const mediaSendButton = this.page.locator("div[role='button'][aria-label='Enviar'], div[aria-label='Enviar']").first();
    const composer = this.page.locator("footer [contenteditable='true']").first();

    let uploadedMediaPath = payload.mediaPath;
    if (payload.mediaPath) {
      uploadedMediaPath = await this.prepareMediaForUpload(payload.mediaPath, payload.contentType, correlationId);
      const attachmentButton = this.page
        .locator("button[title='Anexar'], div[title='Anexar'], span[data-icon='plus-rounded']")
        .first();
      await attachmentButton.waitFor({ timeout: 15_000 });
      const fileChooserPromise = this.page.waitForEvent("filechooser", { timeout: 15_000 });
      await attachmentButton.click();
      const pickerLabel = this.page.getByText(/fotos e vídeos|fotos e videos/i).first();
      await pickerLabel.waitFor({ timeout: 10_000 });
      await pickerLabel.click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(uploadedMediaPath);

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
    }

    await this.triggerSendAction(payload.mediaPath ? mediaSendButton : textSendButton, Boolean(payload.mediaPath));

    recordSystemEvent("wa-worker", "info", "Send action completed", {
      correlationId,
      phone: payload.phone,
      contentType: payload.contentType
    });
  }

  private async sendVoiceRecording(phone: string, audioPath: string, correlationId: string) {
    await this.relaunchBrowser(audioPath);

    if (!this.page) {
      throw new Error("browser_failure: page not initialized");
    }

    await this.page.goto(`${this.env.WA_URL}/send?phone=${encodeURIComponent(phone)}`, {
      waitUntil: "domcontentloaded"
    });
    await this.page.waitForTimeout(8_000);

    const micButton = this.page.getByRole("button", { name: /mensagem de voz/i }).last();
    await micButton.waitFor({ timeout: 20_000 });
    await micButton.click({ force: true });
    await this.page.waitForTimeout(1_500);

    const sendButton = this.page
      .locator("button[aria-label='Enviar'], div[aria-label='Enviar'], div[role='button'][aria-label='Enviar']")
      .last();
    await sendButton.waitFor({ timeout: 20_000 });
    await sendButton.click({ force: true });
    await micButton.waitFor({ timeout: 20_000 });

    recordSystemEvent("wa-worker", "info", "Voice recording sent through WhatsApp recorder", {
      correlationId,
      phone,
      audioPath
    });
  }

  private async triggerSendAction(sendButton: Locator, isMedia: boolean) {
    if (!this.page) {
      throw new Error("browser_failure: page not initialized");
    }

    await sendButton.waitFor({ timeout: 30_000 });

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

        const sendLocator = this.page.locator("button[aria-label='Enviar'], div[aria-label='Enviar']").last();
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

  private async prepareMediaForUpload(filePath: string, contentType: string, correlationId: string) {
    if (contentType === "audio") {
      const extension = path.extname(filePath).toLowerCase();
      if (extension === ".wav") {
        return filePath;
      }

      try {
        const outputPath = path.join(this.env.TEMP_DIR, `${Date.now()}-${randomUUID()}.wav`);
        await fs.mkdir(this.env.TEMP_DIR, { recursive: true });
        await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", filePath, outputPath]);
        recordSystemEvent("wa-worker", "info", "Audio converted to wav for WhatsApp voice capture", {
          correlationId,
          sourcePath: filePath,
          outputPath
        });
        return outputPath;
      } catch (error) {
        throw new Error(
          `upload_failure: unable to convert audio to wav (${error instanceof Error ? error.message : String(error)})`
        );
      }
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
    const sendButton = this.page.locator("button span[data-icon='send'], button[aria-label='Enviar'], div[aria-label='Enviar']").first();
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
    const badgeSelectors = [
      "[aria-label*='não lida']",
      "[aria-label*='não lidas']",
      "[aria-label*='unread']",
      "[data-testid='icon-unread-count']",
      "[data-testid='cell-frame-title'] + * span",
      "span[dir='auto']"
    ];

    for (const selector of badgeSelectors) {
      const candidate = row.locator(selector).last();
      const text = ((await candidate.innerText().catch(() => "")) || "").trim();
      const parsed = parseUnreadCountFromText(text);
      if (parsed > 0) {
        return parsed;
      }
    }

    const rowLabel = ((await row.getAttribute("aria-label").catch(() => "")) || "").trim();
    const rowText = ((await row.innerText().catch(() => "")) || "").trim();
    return parseUnreadCountFromText(`${rowLabel}\n${rowText}`);
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

  async syncInbox(reason: "startup" | "interval") {
    if (this.browserTask !== "idle") {
      return;
    }

    this.browserTask = "sync";
    this.browserTaskStartedAt = Date.now();
    const correlationId = randomUUID();
    try {
      await this.ensureAuthenticated();
      if (!this.page) {
        return;
      }

      if (!this.page.url().startsWith(this.env.WA_URL)) {
        await this.page.goto(this.env.WA_URL, {
          waitUntil: "domcontentloaded"
        });
      }

      const rows = await this.resolveChatRows();
      const listContainer = this.page.locator("#pane-side").first();
      let count = Math.min(await rows?.count().catch(() => 0) ?? 0, this.env.WA_SYNC_CHATS_LIMIT);

      if (count === 0) {
        this.updateState({
          status: "authenticated",
          authStatus: "authenticated",
          lastActivityAt: nowIso(),
          lastSyncAt: nowIso()
        });
        await this.publishState({
          lastSyncReason: reason,
          note: "WhatsApp chat list not found yet"
        });
        return;
      }

      if (!rows) {
        return;
      }

      const seenTitles = new Set<string>();

      for (let pass = 0; pass < 4 && seenTitles.size < this.env.WA_SYNC_CHATS_LIMIT; pass += 1) {
        const visibleCount = Math.min(await rows.count().catch(() => 0), this.env.WA_SYNC_CHATS_LIMIT);

        for (let rowIndex = 0; rowIndex < visibleCount && seenTitles.size < this.env.WA_SYNC_CHATS_LIMIT; rowIndex += 1) {
          const row = rows.nth(rowIndex);
          const rawText = (await row.innerText().catch(() => "")) || "";
          if (!rawText) {
            continue;
          }

          const parts = rawText.split("\n").map((part) => part.trim()).filter(Boolean);
          const title = parts[0] ?? `Chat ${pass + 1}-${rowIndex + 1}`;
          if (seenTitles.has(title)) {
            continue;
          }
          seenTitles.add(title);

          const preview = parts[parts.length - 1] ?? "";
          const phone = title.replace(/\D/g, "").length >= 8 ? title.replace(/\D/g, "") : null;

          await row.click().catch(() => null);
          const bubbles = this.page.locator("[data-pre-plain-text]");
          const messageCount = Math.min(await bubbles.count().catch(() => 0), this.env.WA_SYNC_MESSAGES_LIMIT);
          const messages: Array<{ direction: "incoming" | "outgoing"; body: string; contentType: "text"; sentAt: string | null }> = [];

          const startIndex = Math.max(0, messageCount - this.env.WA_SYNC_MESSAGES_LIMIT);
          for (let bubbleIndex = startIndex; bubbleIndex < messageCount; bubbleIndex += 1) {
            const bubble = bubbles.nth(bubbleIndex);
            const body = (await bubble.innerText().catch(() => "")).trim();
            if (!body) {
              continue;
            }
            const html = await bubble.innerHTML().catch(() => "");
            messages.push({
              direction: html.includes("message-out") ? "outgoing" : "incoming",
              body,
              contentType: "text",
              sentAt: null
            });
          }

          const unreadCount = await this.extractUnreadCount(row);

          saveConversationSnapshot({
            waChatId: phone ?? title,
            title,
            unreadCount,
            lastMessagePreview: preview,
            lastMessageAt: nowIso(),
            lastMessageDirection: messages.at(-1)?.direction ?? null,
            contactPhone: phone,
            messages
          });
        }

        await listContainer
          .evaluate((element) => {
            element.scrollBy(0, Math.floor(element.clientHeight * 0.85));
          })
          .catch(() => null);
        await this.page.waitForTimeout(450);
      }

      this.updateState({
        status: this.state.status === "degraded" ? "degraded" : "authenticated",
        authStatus: "authenticated",
        lastSyncAt: nowIso(),
        lastActivityAt: nowIso()
      });
      await this.publishState({
        lastSyncReason: reason
      });
      recordSystemEvent("wa-worker", "info", "Inbox synchronized", {
        correlationId,
        reason
      });
    } catch (error) {
      const errorType = classifyError(error);
      const nextFailures = this.state.consecutiveFailures + 1;
      this.updateState({
        status: errorType === "authentication_failure" ? "disconnected" : nextFailures >= this.env.WORKER_FAILURE_THRESHOLD ? "degraded" : "error",
        authStatus: errorType === "authentication_failure" ? "disconnected" : this.state.authStatus,
        lastFailureAt: nowIso(),
        lastFailureSummary: error instanceof Error ? error.message : String(error),
        lastErrorType: errorType,
        consecutiveFailures: nextFailures
      });
      await this.publishState({
        lastCorrelationId: correlationId
      });
    } finally {
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
    const correlationId = randomUUID();

    try {
      const { syncInstagramInboxToDatabase } = await import("../../web-app/src/server/lib/instagram-sync.js");
      const result = await syncInstagramInboxToDatabase({
        threadLimit: this.env.IG_SYNC_THREADS_LIMIT,
        messagesLimit: this.env.IG_SYNC_MESSAGES_LIMIT
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
