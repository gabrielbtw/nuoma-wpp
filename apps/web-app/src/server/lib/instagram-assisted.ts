import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  InputError,
  getWorkerState,
  loadEnv,
  recordSystemEvent,
  setWorkerState,
  type InstagramAssistedSessionState,
  type InstagramAssistedThreadSnapshot
} from "@nuoma/core";

declare const document: any;
declare const window: any;

type BrowserLike = {
  contexts(): BrowserContextLike[];
};

type BrowserContextLike = {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
};

type LocatorLike = {
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  click(options?: Record<string, unknown>): Promise<void>;
  setInputFiles(paths: string | string[]): Promise<void>;
  waitFor(options?: Record<string, unknown>): Promise<void>;
  first(): LocatorLike;
  last(): LocatorLike;
};

type PageLike = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  locator(selector: string): LocatorLike;
  evaluate<T, Arg = void>(handler: (arg: Arg) => T | Promise<T>, arg?: Arg): Promise<T>;
  isClosed?(): boolean;
  bringToFront?(): Promise<void>;
  url(): string;
};

type InstagramFixturePayload = {
  session?: Partial<InstagramAssistedSessionState>;
  threads?: InstagramAssistedThreadSnapshot[];
};

type InstagramProfileSnapshot = {
  currentPath: string;
  canonicalPath: string | null;
  title: string;
  bodyText: string;
  hasHeader: boolean;
  hasActionBar: boolean;
};

const WORKER_KEY = "instagram-assisted";

function resolveInstagramProfileDir(env = loadEnv()) {
  return env.IG_USE_SHARED_BROWSER ? env.CHROMIUM_PROFILE_DIR : env.IG_CHROMIUM_PROFILE_DIR;
}

function resolveSharedBrowserEndpoint(env = loadEnv()) {
  const workerState = getWorkerState("wa-worker");
  const endpoint =
    workerState?.value && typeof workerState.value === "object" && typeof (workerState.value as { browserCdpEndpoint?: unknown }).browserCdpEndpoint === "string"
      ? String((workerState.value as { browserCdpEndpoint: string }).browserCdpEndpoint)
      : null;
  return endpoint ?? `http://${env.CHROMIUM_CDP_HOST}:${env.CHROMIUM_CDP_PORT}`;
}

function defaultSessionState(): InstagramAssistedSessionState {
  const env = loadEnv();
  return {
    mode: env.IG_ASSISTED_FIXTURE_PATH ? "fixture" : "browser",
    status: env.IG_ASSISTED_FIXTURE_PATH ? "connected" : "assisted",
    authenticated: false,
    profileDir: resolveInstagramProfileDir(env),
    username: null,
    lastSyncAt: null,
    threadCount: 0,
    messageCount: 0,
    errorMessage: null,
    sharedBrowser: env.IG_USE_SHARED_BROWSER,
    browserEndpoint: env.IG_USE_SHARED_BROWSER ? resolveSharedBrowserEndpoint(env) : null,
    pageUrl: null,
    lastCheckedAt: null
  };
}

function readStoredSessionState() {
  const stored = getWorkerState(WORKER_KEY);
  if (!stored?.value || typeof stored.value !== "object") {
    return defaultSessionState();
  }

  return {
    ...defaultSessionState(),
    ...(stored.value as Partial<InstagramAssistedSessionState>)
  } satisfies InstagramAssistedSessionState;
}

function persistSessionState(partial: Partial<InstagramAssistedSessionState>) {
  const nextState = {
    ...readStoredSessionState(),
    ...partial
  } satisfies InstagramAssistedSessionState;
  setWorkerState(WORKER_KEY, nextState);
  return nextState;
}

function collapseWhitespace(input?: string | null) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeThreads(threads: InstagramAssistedThreadSnapshot[] = []) {
  return threads.map((thread) => {
    const messages = (thread.messages ?? [])
      .map((message) => ({
        externalId: message.externalId ?? null,
        direction: message.direction,
        body: collapseWhitespace(message.body),
        contentType: message.contentType ?? "text",
        sentAt: message.sentAt ?? null
      }))
      .filter((message) => message.body.length > 0 || message.contentType !== "text");
    const lastMessage = messages[messages.length - 1] ?? null;

    return {
      threadId: String(thread.threadId),
      username: String(thread.username),
      title: collapseWhitespace(thread.title) || `@${thread.username}`,
      unreadCount: Number(thread.unreadCount ?? 0),
      lastMessagePreview: collapseWhitespace(thread.lastMessagePreview) || lastMessage?.body || "",
      lastMessageAt: thread.lastMessageAt ?? lastMessage?.sentAt ?? null,
      lastMessageDirection: thread.lastMessageDirection ?? lastMessage?.direction ?? null,
      messages
    } satisfies InstagramAssistedThreadSnapshot;
  });
}

function sanitizeInstagramUsername(value?: string | null) {
  const normalized = String(value ?? "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();

  return normalized || null;
}

function normalizeInstagramPathname(value?: string | null) {
  return String(value ?? "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+|\/+$/g, "")
    .trim()
    .toLowerCase();
}

function normalizeSearchableText(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeInstagramHandleCandidate(value?: string | null) {
  const normalized = sanitizeInstagramUsername(value);
  return normalized && /^[a-z0-9._]+$/i.test(normalized) ? normalized : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveDisplayNameFromProfileLink(text: string, username: string) {
  const cleaned = collapseWhitespace(text)
    .replace(/\b(?:ver perfil|view profile|perfil|instagram)\b/gi, "")
    .replace(new RegExp(`\\b@?${escapeRegExp(username)}\\b`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.startsWith("@") || /^https?:\/\//i.test(cleaned) || normalizeSearchableText(cleaned) === username) {
    return null;
  }

  return cleaned;
}

export function resolveInstagramThreadParticipant(input: {
  profileLinks?: Array<{
    href?: string | null;
    text?: string | null;
  }>;
  ownUsername?: string | null;
  fallbackTitle?: string | null;
}) {
  const blockedRoots = new Set(["accounts", "direct", "explore", "reels", "stories", "about", "legal"]);
  const ownUsername = normalizeInstagramHandleCandidate(input.ownUsername);
  const candidates = new Map<string, { score: number; hits: number; displayName: string | null }>();

  for (const candidate of input.profileLinks ?? []) {
    const href = String(candidate.href ?? "").trim();
    const match = href.match(/^\/([a-z0-9._]+)\/?$/i);
    const username = normalizeInstagramHandleCandidate(match?.[1] ?? null);
    if (!username || blockedRoots.has(username) || username === ownUsername) {
      continue;
    }

    const text = collapseWhitespace(candidate.text);
    const normalizedText = normalizeSearchableText(text);
    const displayName = deriveDisplayNameFromProfileLink(text, username);
    const score =
      10 +
      (normalizedText.includes(username) ? 6 : 0) +
      (normalizedText.includes("ver perfil") || normalizedText.includes("view profile") ? 2 : 0) +
      (normalizedText.includes("instagram") ? 1 : 0) +
      (displayName ? 4 : 0);

    const current = candidates.get(username) ?? {
      score: 0,
      hits: 0,
      displayName: null
    };

    current.score += score;
    current.hits += 1;
    if (!current.displayName && displayName) {
      current.displayName = displayName;
    }
    candidates.set(username, current);
  }

  let resolvedUsername: string | null = null;
  let resolvedDisplayName: string | null = null;
  let bestScore = -1;

  for (const [username, candidate] of candidates.entries()) {
    const score = candidate.score + candidate.hits * 3;
    if (score > bestScore) {
      bestScore = score;
      resolvedUsername = username;
      resolvedDisplayName = candidate.displayName;
    }
  }

  const fallbackTitle = collapseWhitespace(input.fallbackTitle);
  const fallbackUsername = normalizeInstagramHandleCandidate(fallbackTitle);
  if (!resolvedUsername && fallbackUsername) {
    resolvedUsername = fallbackUsername;
  }
  if (!resolvedDisplayName && fallbackTitle && fallbackTitle !== `@${resolvedUsername}` && !fallbackUsername) {
    resolvedDisplayName = fallbackTitle;
  }

  return {
    username: resolvedUsername,
    displayName: resolvedDisplayName
  };
}

export function isInstagramComposerSurfaceReady(input: {
  url?: string | null;
  hasTextarea?: boolean;
  hasRichTextbox?: boolean;
}) {
  const normalizedPath = normalizeInstagramPathname(input.url);
  if (normalizedPath.startsWith("direct/t/")) {
    return true;
  }

  return Boolean(input.hasTextarea || input.hasRichTextbox);
}

export function pickInstagramComposerRecipientCandidate(input: {
  targetUsername: string;
  targetDisplayName?: string | null;
  candidates?: Array<{
    text?: string | null;
    aria?: string | null;
    descendantTexts?: Array<string | null> | null;
  }> | null;
}) {
  const normalizedUsername = sanitizeInstagramUsername(input.targetUsername);
  if (!normalizedUsername) {
    return null;
  }

  const normalizedDisplayName = normalizeSearchableText(input.targetDisplayName);
  const ignoredLabels = new Set([
    "back",
    "voltar",
    "clear search",
    "limpar pesquisa",
    "send message",
    "enviar mensagem",
    "messages",
    "mensagens",
    "new message",
    "nova mensagem",
    "primary",
    "general",
    "requests",
    "pedidos"
  ]);
  let bestIndex: number | null = null;
  let bestScore = -1;

  for (const [index, candidate] of (input.candidates ?? []).entries()) {
    const normalizedText = normalizeSearchableText(candidate.text);
    const normalizedAria = normalizeSearchableText(candidate.aria);
    const descendantTexts = (candidate.descendantTexts ?? [])
      .map((entry) => normalizeSearchableText(entry))
      .filter(Boolean);
    const searchable = [normalizedText, normalizedAria, ...descendantTexts].filter(Boolean);
    if (searchable.length === 0) {
      continue;
    }

    if (
      ignoredLabels.has(normalizedText) ||
      ignoredLabels.has(normalizedAria) ||
      normalizedText.includes("voce:") ||
      normalizedText.includes("você:") ||
      normalizedText.includes(" online") ||
      /(^| )· ?\d/.test(normalizedText)
    ) {
      continue;
    }

    const hasExactUsername =
      normalizedText === normalizedUsername ||
      normalizedAria === normalizedUsername ||
      descendantTexts.includes(normalizedUsername);
    const hasUsername = searchable.some((entry) => entry.includes(normalizedUsername));
    if (!hasExactUsername && !hasUsername) {
      continue;
    }

    const hasDisplayName = normalizedDisplayName
      ? normalizedText.includes(normalizedDisplayName) || descendantTexts.includes(normalizedDisplayName)
      : false;
    let score = 0;
    if (hasExactUsername) {
      score += 300;
    } else if (hasUsername) {
      score += 120;
    }
    if (descendantTexts.some((entry) => entry === normalizedUsername)) {
      score += 80;
    }
    if (normalizedText.includes(`@${normalizedUsername}`)) {
      score += 25;
    }
    if (hasDisplayName) {
      score += 50;
    }
    if (normalizedText.includes("seguir") || normalizedText.includes("follow")) {
      score -= 15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function assessInstagramProfileSnapshot(snapshot: InstagramProfileSnapshot, username: string) {
  const normalizedUsername = sanitizeInstagramUsername(username);
  const currentPath = normalizeInstagramPathname(snapshot.currentPath);
  const canonicalPath = normalizeInstagramPathname(snapshot.canonicalPath);
  const bodyText = normalizeSearchableText(snapshot.bodyText);
  const title = normalizeSearchableText(snapshot.title);
  const invalidPhrases = [
    "sorry, this page isn't available",
    "sorry, this page isnt available",
    "page isn't available",
    "page isnt available",
    "page not found",
    "the link you followed may be broken",
    "esta pagina nao esta disponivel",
    "esta pagina nao esta disponivel.",
    "pagina nao encontrada",
    "o link que voce acessou pode estar quebrado",
    "o link que voce seguiu pode estar quebrado",
    "usuario nao encontrado",
    "user not found"
  ];

  if (!normalizedUsername) {
    return {
      valid: false,
      reason: "Username do Instagram ausente."
    };
  }

  if (currentPath && currentPath !== normalizedUsername) {
    return {
      valid: false,
      reason: `Perfil redirecionado para ${currentPath || "rota desconhecida"}.`
    };
  }

  if (canonicalPath && canonicalPath !== normalizedUsername) {
    return {
      valid: false,
      reason: `Canonical do perfil nao corresponde a @${normalizedUsername}.`
    };
  }

  if (invalidPhrases.some((entry) => bodyText.includes(entry) || title.includes(entry))) {
    return {
      valid: false,
      reason: `Perfil @${normalizedUsername} nao esta disponivel.`
    };
  }

  if (!snapshot.hasHeader && !snapshot.hasActionBar) {
    return {
      valid: false,
      reason: `Perfil @${normalizedUsername} nao exibiu cabecalho nem acoes do perfil.`
    };
  }

  return {
    valid: true,
    reason: null
  };
}

function resolveAssistantSendText(input: {
  text?: string | null;
  caption?: string | null;
  contentType?: "text" | "audio" | "image" | "video";
}) {
  if (input.contentType === "text") {
    return input.text?.trim() ?? "";
  }

  return input.caption?.trim() || input.text?.trim() || "";
}

class InstagramAssistedService {
  private browserPromise: Promise<BrowserLike> | null = null;
  private contextPromise: Promise<BrowserContextLike> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  private async runExclusive<T>(operation: "open-session" | "sync-inbox" | "send-message", task: () => Promise<T>) {
    const previous = this.operationQueue;
    let release: () => void = () => {};
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => null);

    try {
      return await task();
    } finally {
      release();
      recordSystemEvent("instagram-assisted", "debug", "Instagram assisted operation released", {
        operation
      });
    }
  }

  private resetBrowserConnection() {
    this.browserPromise = null;
    this.contextPromise = null;
  }

  private persistLiveSessionState(partial: Partial<InstagramAssistedSessionState>) {
    const env = loadEnv();
    return persistSessionState({
      mode: "browser",
      profileDir: resolveInstagramProfileDir(env),
      sharedBrowser: env.IG_USE_SHARED_BROWSER,
      browserEndpoint: env.IG_USE_SHARED_BROWSER ? resolveSharedBrowserEndpoint(env) : null,
      username: sanitizeInstagramUsername(partial.username) ?? readStoredSessionState().username,
      ...partial
    });
  }

  private async detectOwnUsername(page: PageLike) {
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

        const win = window as {
          _sharedData?: { config?: { viewer?: { username?: string } } };
          __additionalData?: { viewer?: { username?: string } };
          __initialData?: { data?: { user?: { username?: string } } };
          localStorage?: Storage;
        };

        const candidates = [
          normalizeCandidate(win._sharedData?.config?.viewer?.username),
          normalizeCandidate(win.__additionalData?.viewer?.username),
          normalizeCandidate(win.__initialData?.data?.user?.username)
        ];

        const anchors = Array.from(document.querySelectorAll("a[href]") as Array<{ getAttribute(name: string): string | null }>)
          .map((anchor) => anchor.getAttribute("href") ?? "")
          .map((href) => {
            const match = href.match(/^\/([a-z0-9._]+)\/?$/i);
            return normalizeCandidate(match?.[1] ?? null);
          })
          .filter(Boolean) as string[];

        candidates.push(...anchors);

        try {
          const storageBlob = Object.keys(win.localStorage ?? {})
            .slice(0, 80)
            .map((key) => win.localStorage?.getItem(key) ?? "")
            .join(" ");
          const inlineMatch = storageBlob.match(/\"username\":\"([a-z0-9._]+)\"/i);
          candidates.push(normalizeCandidate(inlineMatch?.[1] ?? null));
        } catch {
          // Ignore storage issues.
        }

        return candidates.find(Boolean) ?? null;
      });

      return sanitizeInstagramUsername(username);
    } catch {
      return null;
    }
  }

  private handleBrowserError(error: unknown, fallbackMessage: string) {
    this.resetBrowserConnection();
    const message = error instanceof Error ? error.message : fallbackMessage;
    this.persistLiveSessionState({
      status: "error",
      authenticated: false,
      errorMessage: message,
      pageUrl: null,
      lastCheckedAt: new Date().toISOString()
    });
    return message;
  }

  private async readFixture() {
    const env = loadEnv();
    if (!env.IG_ASSISTED_FIXTURE_PATH) {
      return null;
    }

    const raw = await readFile(env.IG_ASSISTED_FIXTURE_PATH, "utf8");
    const parsed = JSON.parse(raw) as InstagramFixturePayload;
    const threads = normalizeThreads(parsed.threads ?? []);
    const session = {
      ...defaultSessionState(),
      ...(parsed.session ?? {}),
      mode: "fixture",
      status: (parsed.session?.status as InstagramAssistedSessionState["status"] | undefined) ?? "connected",
      authenticated: parsed.session?.authenticated ?? true,
      threadCount: threads.length,
      messageCount: threads.reduce((total, thread) => total + thread.messages.length, 0),
      errorMessage: null
    } satisfies InstagramAssistedSessionState;

    return {
      session,
      threads
    };
  }

  private async ensureContext() {
    const env = loadEnv();
    if (env.IG_ASSISTED_FIXTURE_PATH) {
      return null;
    }

    if (!this.contextPromise) {
      this.contextPromise = (async () => {
        const { chromium } = await import("playwright");

        if (env.IG_USE_SHARED_BROWSER) {
          if (!this.browserPromise) {
            this.browserPromise = chromium.connectOverCDP(resolveSharedBrowserEndpoint(env)) as Promise<BrowserLike>;
          }

          const browser = await this.browserPromise;
          const context = browser.contexts()[0];
          if (!context) {
            throw new InputError("Navegador compartilhado do WhatsApp indisponível.");
          }
          return context;
        }

        return chromium.launchPersistentContext(env.IG_CHROMIUM_PROFILE_DIR, {
          headless: false,
          viewport: { width: 1440, height: 960 }
        }) as Promise<BrowserContextLike>;
      })().catch((error) => {
        this.resetBrowserConnection();
        throw error;
      });
    }

    return this.contextPromise;
  }

  private findInstagramPage(context: BrowserContextLike) {
    const pages = context.pages().filter((page) => !(page.isClosed?.() ?? false));
    return pages.find((page) => page.url().includes("instagram.com/direct/")) ?? pages.find((page) => page.url().includes("instagram.com")) ?? null;
  }

  private async ensurePage(options?: { navigateToInbox?: boolean }) {
    const env = loadEnv();
    const context = await this.ensureContext();
    if (!context) {
      return null;
    }

    const navigateToInbox = options?.navigateToInbox ?? true;
    const page = this.findInstagramPage(context) ?? (await context.newPage());
    if (navigateToInbox && !page.url().includes("instagram.com/direct/")) {
      await page.goto(env.IG_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
    }
    return page;
  }

  private async detectAuthenticated(page: PageLike) {
    const loginFieldCount = await page.locator("input[name='username']").count();
    return loginFieldCount === 0 && !page.url().includes("/accounts/login");
  }

  private async collectProfileSnapshot(page: PageLike) {
    return page.evaluate<InstagramProfileSnapshot>(() => {
      const canonicalHref = document.querySelector("link[rel='canonical']")?.getAttribute("href") ?? null;
      const actionLabels = new Set([
        "message",
        "mensagem",
        "enviar mensagem",
        "follow",
        "seguir",
        "following",
        "seguindo",
        "options",
        "opcoes",
        "opções",
        "mais opcoes",
        "mais opções",
        "more options"
      ]);
      const hasActionBar = (Array.from(document.querySelectorAll("button, a, div[role='button']")) as any[]).some((element) => {
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const aria = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        return actionLabels.has(text) || [...actionLabels].some((label) => aria.includes(label));
      });

      return {
        currentPath: window.location.pathname ?? "",
        canonicalPath: canonicalHref,
        title: document.title ?? "",
        bodyText: document.body?.innerText ?? "",
        hasHeader: Boolean(document.querySelector("header")),
        hasActionBar
      };
    });
  }

  private async assertValidProfilePage(page: PageLike, username: string) {
    const snapshot = await this.collectProfileSnapshot(page);
    const assessment = assessInstagramProfileSnapshot(snapshot, username);
    if (!assessment.valid) {
      throw new InputError(assessment.reason ?? `Perfil do Instagram @${username} nao encontrado.`);
    }

    return snapshot;
  }

  private async readProfileDisplayName(page: PageLike, username: string) {
    return page.evaluate((targetUsername) => {
      const candidates = Array.from(document.querySelectorAll("header h1, header h2, main h1, main h2, section h1, section h2, main span, header span")) as any[];
      for (const node of candidates) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        const normalizedText = text.toLowerCase();
        if (!text || normalizedText === targetUsername || normalizedText.startsWith("@")) {
          continue;
        }
        if (/\d/.test(text) || text.length > 80) {
          continue;
        }
        return text;
      }
      return "";
    }, username);
  }

  private async isComposerOpen(page: PageLike) {
    const snapshot = await page.evaluate(() => ({
      url: window.location.pathname ?? "",
      hasTextarea: Boolean(document.querySelector("textarea")),
      hasRichTextbox: Boolean(document.querySelector("div[contenteditable='true'][role='textbox']"))
    }));
    return isInstagramComposerSurfaceReady(snapshot);
  }

  private async readCurrentThreadParticipant(page: PageLike) {
    const ownUsername = await this.detectOwnUsername(page);
    const snapshot = await page.evaluate(() => {
      const titleCandidates = Array.from(document.querySelectorAll("main h1, main h2, header h1, header h2, main span[dir='auto'], header span[dir='auto']"))
        .map((node) => (((node as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim()))
        .filter(Boolean);
      const fallbackTitle =
        titleCandidates.find((candidate) => candidate.length <= 80 && !candidate.startsWith("@") && !/^(?:mensagens|messages|primary|general|pedidos)$/i.test(candidate)) ??
        titleCandidates[0] ??
        document.title.replace(/\s+/g, " ").trim();
      const profileLinks = Array.from(document.querySelectorAll("main a[href], header a[href]"))
        .map((anchor) => ({
          href: (anchor as { getAttribute(name: string): string | null }).getAttribute("href") ?? "",
          text: (((anchor as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim())
        }))
        .filter((entry) => Boolean(entry.href));

      return {
        fallbackTitle,
        profileLinks
      };
    });

    return resolveInstagramThreadParticipant({
      profileLinks: snapshot.profileLinks,
      ownUsername,
      fallbackTitle: snapshot.fallbackTitle
    });
  }

  private async isExpectedThreadOpen(page: PageLike, username?: string | null) {
    const normalizedUsername = sanitizeInstagramUsername(username);
    if (!normalizedUsername) {
      return this.isComposerOpen(page);
    }

    if (!page.url().includes("/direct/t/")) {
      return false;
    }

    const participant = await this.readCurrentThreadParticipant(page);
    return participant.username === normalizedUsername;
  }

  private async waitForComposerTarget(page: PageLike, username?: string | null, attempts = 6, delayMs = 700) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await this.isExpectedThreadOpen(page, username)) {
        return true;
      }

      if (!page.url().includes("/direct/t/") && (await this.isComposerOpen(page))) {
        return true;
      }

      if (attempt < attempts - 1) {
        await page.waitForTimeout(delayMs);
      }
    }

    return false;
  }

  private async collectComposerRecipientCandidates(page: PageLike) {
    return page.evaluate(() => {
      const searchInput = document.querySelector("input[name='searchInput']");
      let scope: any = document.body;
      let current = searchInput?.parentElement ?? null;

      while (current) {
        const actions = Array.from(current.querySelectorAll("button, div[role='button']"))
          .map((element) => String((element as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (actions.length >= 3 && actions.length <= 40 && actions.some((value) => /^(?:enviar mensagem|send message|chat|bate-papo)$/i.test(value))) {
          scope = current;
          break;
        }
        current = current.parentElement;
      }

      const candidates = Array.from(scope.querySelectorAll("div[role='button'], button"));
      return candidates.map((element) => ({
        text: String((element as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim(),
        aria: String((element as { getAttribute(name: string): string | null }).getAttribute?.("aria-label") ?? "").replace(/\s+/g, " ").trim(),
        descendantTexts: Array.from((element as any).querySelectorAll("span, div"))
          .map((node) => String((node as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 12)
      }));
    });
  }

  private async clickComposerRecipientCandidate(page: PageLike, index: number) {
    return page.evaluate((candidateIndex) => {
      const searchInput = document.querySelector("input[name='searchInput']");
      let scope: any = document.body;
      let current = searchInput?.parentElement ?? null;

      while (current) {
        const actions = Array.from(current.querySelectorAll("button, div[role='button']"))
          .map((element) => String((element as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (actions.length >= 3 && actions.length <= 40 && actions.some((value) => /^(?:enviar mensagem|send message|chat|bate-papo)$/i.test(value))) {
          scope = current;
          break;
        }
        current = current.parentElement;
      }

      const candidates = Array.from(scope.querySelectorAll("div[role='button'], button"));
      const target = candidates[candidateIndex] as { click?: () => void } | undefined;
      if (!target || typeof target.click !== "function") {
        return false;
      }
      target.click();
      return true;
    }, index);
  }

  private async clickComposerStartAction(page: PageLike) {
    const clicked = await page.evaluate(() => {
      const searchInput = document.querySelector("input[name='searchInput']");
      let scope: any = document.body;
      let current = searchInput?.parentElement ?? null;

      while (current) {
        const actions = Array.from(current.querySelectorAll("button, div[role='button']"))
          .map((element) => String((element as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase())
          .filter(Boolean);
        if (actions.length >= 2 && actions.length <= 40 && actions.some((value) => /^(?:enviar mensagem|send message|chat|bate-papo)$/i.test(value))) {
          scope = current;
          break;
        }
        current = current.parentElement;
      }

      const target = Array.from(scope.querySelectorAll("button, div[role='button']")).find((element) => {
        const text = String((element as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const aria = String((element as { getAttribute(name: string): string | null }).getAttribute?.("aria-label") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        return text === "enviar mensagem" || text === "send message" || text === "chat" || text === "bate-papo" || aria === "enviar mensagem" || aria === "send message";
      }) as { click?: () => void } | undefined;

      if (!target || typeof target.click !== "function") {
        return false;
      }
      target.click();
      return true;
    });

    if (clicked) {
      await page.waitForTimeout(1200);
    }

    return clicked;
  }

  private async clickDirectProfileMessageAction(page: PageLike, username?: string | null) {
    const clicked = await page.evaluate(() => {
      const labels = ["message", "mensagem", "enviar mensagem"];
      const candidates = Array.from(document.querySelectorAll("header button, header a, header div[role='button'], main header button, main header a, main header div[role='button']")) as any[];
      const target = candidates.find((element: any) => {
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const aria = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        return labels.includes(text) || labels.some((label) => aria === label || aria.includes(label));
      });

      if (!target) {
        return false;
      }

      target.click();
      return true;
    });

    if (!clicked) {
      return false;
    }

    await page.waitForTimeout(1200);
    return this.waitForComposerTarget(page, username);
  }

  private async clickOverflowProfileMessageAction(page: PageLike, username?: string | null) {
    const openedMenu = await page.evaluate(() => {
      const labels = ["options", "opcoes", "opções", "mais opcoes", "mais opções", "more options"];
      const candidates = Array.from(document.querySelectorAll("header button, header a, header div[role='button'], main header button, main header a, main header div[role='button']")) as any[];
      const target = candidates.find((element: any) => {
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const aria = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        return labels.includes(text) || labels.some((label) => aria.includes(label));
      });

      if (!target) {
        return false;
      }

      target.click();
      return true;
    });

    if (!openedMenu) {
      return false;
    }

    await page.waitForTimeout(800);

    const clickedSendMessage = await page.evaluate(() => {
      const overlays = Array.from(document.querySelectorAll("div, section")) as any[];
      const scope =
        overlays.reverse().find((element) => {
          const labels = Array.from(element.querySelectorAll("button, div[role='button']"))
            .map((node: any) => String(node.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase())
            .filter(Boolean);
          return labels.includes("enviar mensagem") && (labels.includes("bloquear") || labels.includes("restringir") || labels.includes("denunciar"));
        }) ?? document.body;
      const candidates = Array.from(scope.querySelectorAll("button, div[role='button']")) as any[];
      const target = candidates.find((element: any) => {
        const text = String(element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const aria = String(element.getAttribute?.("aria-label") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        return text === "enviar mensagem" || text === "send message" || aria === "enviar mensagem" || aria === "send message";
      });

      if (!target || typeof target.click !== "function") {
        return false;
      }

      target.click();
      return true;
    });

    if (!clickedSendMessage) {
      return false;
    }

    await page.waitForTimeout(1200);
    return this.waitForComposerTarget(page, username);
  }

  private async openThreadOrComposer(
    page: PageLike,
    input: {
      threadId?: string | null;
      username?: string | null;
    }
  ) {
    if (input.threadId?.trim()) {
      const threadUrl = new URL(`/direct/t/${input.threadId}/`, "https://www.instagram.com").toString();
      await page.goto(threadUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      return;
    }

      if (input.username?.trim()) {
        const username = input.username.replace(/^@+/, "").trim().toLowerCase();
        await page.goto(resolveInstagramProfileUrl(username), { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);
        await this.assertValidProfilePage(page, username);
        const profileDisplayName = await this.readProfileDisplayName(page, username);
        let openedComposer = await this.clickDirectProfileMessageAction(page, username);

        if (!openedComposer) {
          openedComposer = await this.clickOverflowProfileMessageAction(page, username);
        }

        if (!openedComposer) {
          await page.goto("https://www.instagram.com/direct/new/", { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1200);

        const searchInput = page.locator("input[name='searchInput']").last();
        if ((await searchInput.count()) === 0) {
          throw new InputError("Nao foi possivel abrir o composer assistido do Instagram.");
        }

          await searchInput.fill(username);
          await page.waitForTimeout(1600);

          const composerCandidates = await this.collectComposerRecipientCandidates(page);
          const selectedRecipientIndex = pickInstagramComposerRecipientCandidate({
            targetUsername: username,
            targetDisplayName: profileDisplayName,
            candidates: composerCandidates
          });
          const selectedRecipient =
            selectedRecipientIndex !== null ? await this.clickComposerRecipientCandidate(page, selectedRecipientIndex) : false;

          if (!selectedRecipient) {
            throw new InputError("Nao foi possivel localizar o destinatario no composer assistido do Instagram.");
          }

          await page.waitForTimeout(1200);

          if (!(await this.isExpectedThreadOpen(page, username))) {
            await this.clickComposerStartAction(page);
          }

          if (!(await this.waitForComposerTarget(page, username))) {
            throw new InputError(`Nao foi possivel abrir a conversa do Instagram para @${username}.`);
          }
        }

        await page.waitForTimeout(1400);
        return;
    }

    throw new InputError("Informe a thread ou o username do Instagram para envio assistido.");
  }

  private async uploadMedia(page: PageLike, mediaPath: string) {
    const inputLocator = page.locator("input[type='file']").last();
    if ((await inputLocator.count()) === 0) {
      throw new InputError("Campo de upload do Instagram não encontrado.");
    }

    await inputLocator.setInputFiles(mediaPath);
    await page.waitForTimeout(1600);
  }

  private async fillComposer(page: PageLike, value: string) {
    if (!value.trim()) {
      return;
    }

    const textarea = page.locator("textarea").last();
    if ((await textarea.count()) > 0) {
      await textarea.fill(value);
      return;
    }

    const richComposer = page.locator("div[contenteditable='true'][role='textbox']").last();
    if ((await richComposer.count()) > 0) {
      await richComposer.fill(value);
      return;
    }

    throw new InputError("Campo de mensagem do Instagram não encontrado.");
  }

  private async clickSendButton(page: PageLike) {
    const clicked = await page.evaluate(() => {
      const labels = ["send", "enviar"];
      const nodes = Array.from(document.querySelectorAll("button, div[role='button']")) as any[];
      const target = nodes.find((element: any) => {
        const aria = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        return labels.some((label) => aria.includes(label) || text === label);
      });

      if (!target) {
        return false;
      }

      (target as any).click();
      return true;
    });

    if (!clicked) {
      const sendButton = page.locator("button[aria-label*='Send'], button[aria-label*='Enviar'], div[role='button'][aria-label*='Send'], div[role='button'][aria-label*='Enviar']").last();
      if ((await sendButton.count()) === 0) {
        throw new InputError("Botão de envio do Instagram não encontrado.");
      }

      await sendButton.click();
    }

    await page.waitForTimeout(900);
  }

  private async scrapeThreads(
    page: PageLike,
    options?: {
      threadLimit?: number;
      messagesLimit?: number;
      scrollPasses?: number;
      scrollStartPass?: number;
    }
  ) {
    const env = loadEnv();
    const threadLimit = Math.max(1, options?.threadLimit ?? env.IG_SYNC_THREADS_LIMIT);
    const messagesLimit = Math.max(1, options?.messagesLimit ?? env.IG_SYNC_MESSAGES_LIMIT);
    const scrollPasses = Math.max(1, options?.scrollPasses ?? Math.max(6, Math.ceil(threadLimit / 4) * 3));
    const scrollStartPass = Math.max(0, options?.scrollStartPass ?? 0);
    const inboxUrl = env.IG_URL;
    const ownUsername = await this.detectOwnUsername(page);
    const processedThreadIds = new Set<string>();
    const processedRowLabels = new Set<string>();
    const threads: InstagramAssistedThreadSnapshot[] = [];

    const restoreInboxViewport = async (passIndex: number) => {
      if (page.url().includes("/direct/t/")) {
        await page.evaluate(() => {
          window.history?.back?.();
        });
        await page.waitForTimeout(900);
      } else if (!page.url().includes("/direct/inbox")) {
        await page.goto(inboxUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
      }

      await page.evaluate(() => {
        const root = document.documentElement as { style?: { zoom?: string } } | null;
        const body = document.body as { style?: { zoom?: string } } | null;
        if (root?.style) {
          root.style.zoom = "0.67";
        }
        if (body?.style) {
          body.style.zoom = "0.67";
        }
      });
      await page.waitForTimeout(250);
      await page.evaluate((index) => {
        const nav = document.querySelector("[aria-label='Lista de tópicos']");
        if (!nav) {
          return;
        }

        const scrollables = [nav, ...Array.from(nav.querySelectorAll("div"))].filter((element) => {
          const htmlElement = element as {
            scrollHeight?: number;
            clientHeight?: number;
          };
          return Number(htmlElement.scrollHeight ?? 0) > Number(htmlElement.clientHeight ?? 0) + 40;
        });
        const container = scrollables.sort((left, right) => {
          const leftElement = left as { scrollHeight?: number };
          const rightElement = right as { scrollHeight?: number };
          return Number(rightElement.scrollHeight ?? 0) - Number(leftElement.scrollHeight ?? 0);
        })[0] as
          | {
              scrollHeight: number;
              clientHeight: number;
              scrollTo(options: { top: number; behavior: string }): void;
            }
          | undefined;
        if (!container) {
          return;
        }

        const desiredTop = Math.min(
          Math.max(0, container.scrollHeight - container.clientHeight),
          Math.round(index * container.clientHeight * 0.82)
        );
        container.scrollTo({
          top: desiredTop,
          behavior: "auto"
        });
      }, passIndex);
      await page.waitForTimeout(650);
    };

    await restoreInboxViewport(0);

    for (let pass = 0; pass < scrollPasses && threads.length < threadLimit; pass += 1) {
      const viewportPass = scrollStartPass + pass;
      await restoreInboxViewport(viewportPass);

      const visibleRows = await page.evaluate(() => {
        const nav = document.querySelector("[aria-label='Lista de tópicos']");
        if (!nav) {
          return [] as Array<{ index: number; label: string; title: string }>;
        }

        const noisePatterns = [
          /nova mensagem/i,
          /ícone de seta para baixo/i,
          /^primary$/i,
          /^general$/i,
          /^pedidos$/i
        ];
        const candidateRows = Array.from(nav.querySelectorAll("div[role='button'], button")) as Array<{
          textContent?: string | null;
          querySelectorAll(selector: string): Iterable<unknown>;
          getBoundingClientRect(): { width: number; height: number; bottom: number; top: number };
        }>;
        const rows = candidateRows
          .map((element, index) => {
            const label = (element.textContent ?? "").replace(/\s+/g, " ").trim();
            const rect = element.getBoundingClientRect();
            if (!label || rect.width < 150 || rect.height < 24 || rect.bottom <= 90 || rect.top >= window.innerHeight - 12) {
              return null;
            }
            if (noisePatterns.some((pattern) => pattern.test(label))) {
              return null;
            }

            const titleCandidates = Array.from(element.querySelectorAll("h1, h2, h3, h4, span[dir='auto'], div[dir='auto']"))
              .map((node) => ((node as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim())
              .filter(Boolean);
            const title =
              titleCandidates.find((candidate) => candidate.length <= 80 && !/[·•]/.test(candidate)) ??
              titleCandidates[0] ??
              label;

            return {
              index,
              label,
              title
            };
          })
          .filter(Boolean) as Array<{ index: number; label: string; title: string }>;

        return rows;
      });

      if (visibleRows.length === 0) {
        continue;
      }

      for (const row of visibleRows) {
        if (threads.length >= threadLimit) {
          break;
        }

        const rowKey = `${row.title}::${row.label}`;
        if (processedRowLabels.has(rowKey)) {
          continue;
        }
        processedRowLabels.add(rowKey);

        const clicked = await page.evaluate((targetIndex) => {
          const nav = document.querySelector("[aria-label='Lista de tópicos']");
          if (!nav) {
            return false;
          }

          const candidateRows = Array.from(nav.querySelectorAll("div[role='button'], button")) as Array<{ click(): void }>;
          const element = candidateRows[targetIndex];
          if (!element) {
            return false;
          }

          element.click();
          return true;
        }, row.index);

        if (!clicked) {
          await restoreInboxViewport(viewportPass);
          continue;
        }

        await page.waitForTimeout(1800);

        const openedThreadId = page.url().match(/\/direct\/t\/([^/?#]+)/)?.[1] ?? null;
        if (!openedThreadId || processedThreadIds.has(openedThreadId)) {
          await restoreInboxViewport(viewportPass);
          continue;
        }

        const snapshot = await page.evaluate<
          {
            title: string;
            profileLinks: Array<{ href: string; text: string }>;
            messages: Array<{
              externalId: string;
              direction: "incoming" | "outgoing";
              body: string;
              contentType: "text";
              sentAt: null;
            }>;
            unreadCount: number;
            lastMessagePreview: string;
            lastMessageDirection: "incoming" | "outgoing" | null;
            lastMessageAt: string | null;
          },
          number
        >((limit) => {
          const titleCandidates = Array.from(document.querySelectorAll("main h1, main h2, header h1, header h2, main span[dir='auto'], header span[dir='auto']"))
            .map((node) => (((node as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim()))
            .filter(Boolean);
          const title =
            titleCandidates.find((candidate) => candidate.length <= 80 && !candidate.startsWith("@") && !/^(?:mensagens|messages)$/i.test(candidate)) ??
            titleCandidates[0] ??
            document.title.replace(/\s+/g, " ").trim();

          const profileLinks = Array.from(document.querySelectorAll("a[href]"))
            .map((anchor) => ({
              href: (anchor as { getAttribute(name: string): string | null }).getAttribute("href") ?? "",
              text: (((anchor as { textContent?: string | null }).textContent ?? "").replace(/\s+/g, " ").trim())
            }))
            .filter((entry) => Boolean(entry.href));

          const textNodes = (Array.from(document.querySelectorAll("main div[dir='auto'], main span")) as Array<{
            textContent?: string | null;
            getBoundingClientRect(): { width: number; height: number; left: number; top: number };
          }>)
            .map((node) => {
              const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
              if (!text) {
                return null;
              }

              const rect = node.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) {
                return null;
              }

              return {
                text,
                left: rect.left,
                top: rect.top
              };
            })
            .filter(Boolean) as Array<{ text: string; left: number; top: number }>;

          const ordered = textNodes
            .sort((left, right) => left.top - right.top)
            .slice(-limit)
            .map((item, index) => ({
              externalId: `ig-browser-${index}-${item.top}`,
              direction: (item.left > window.innerWidth * 0.5 ? "outgoing" : "incoming") as "incoming" | "outgoing",
              body: item.text,
              contentType: "text" as const,
              sentAt: null
            }));
          const lastMessage = ordered[ordered.length - 1] ?? null;

          return {
            title,
            profileLinks,
            messages: ordered,
            unreadCount: 0,
            lastMessagePreview: lastMessage?.body ?? "",
            lastMessageDirection: lastMessage?.direction ?? null,
            lastMessageAt: null
          };
        }, messagesLimit);

        const participant = resolveInstagramThreadParticipant({
          profileLinks: snapshot.profileLinks,
          ownUsername,
          fallbackTitle: row.title
        });
        processedThreadIds.add(openedThreadId);

        threads.push({
          threadId: openedThreadId,
          username: participant.username ?? "",
          title: participant.displayName ?? row.title ?? snapshot.title ?? `@${openedThreadId}`,
          unreadCount: snapshot.unreadCount,
          lastMessagePreview: snapshot.lastMessagePreview,
          lastMessageAt: snapshot.lastMessageAt,
          lastMessageDirection: snapshot.lastMessageDirection,
          messages: snapshot.messages
        });

        await restoreInboxViewport(viewportPass);
      }
    }

    await page.goto(inboxUrl, { waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForTimeout(800);

    return normalizeThreads(threads);
  }

  async getSessionState() {
    const fixture = await this.readFixture();
    if (fixture) {
      const state = persistSessionState(fixture.session);
      return state;
    }

    return readStoredSessionState();
  }

  async openSession() {
    return this.runExclusive("open-session", async () => {
      const fixture = await this.readFixture();
      if (fixture) {
        recordSystemEvent("instagram-assisted", "info", "Instagram fixture session ready", {
          fixturePath: loadEnv().IG_ASSISTED_FIXTURE_PATH
        });
        return persistSessionState(fixture.session);
      }

      try {
        const page = await this.ensurePage();
        if (!page) {
          throw new InputError("Não foi possível iniciar a sessão assistida do Instagram.");
        }

        const authenticated = await this.detectAuthenticated(page);
        const username = authenticated ? await this.detectOwnUsername(page) : null;
        const state = this.persistLiveSessionState({
          status: authenticated ? "connected" : "assisted",
          authenticated,
          username,
          errorMessage: null,
          pageUrl: page.url(),
          lastCheckedAt: new Date().toISOString()
        });

        recordSystemEvent("instagram-assisted", authenticated ? "info" : "warn", "Instagram session checked", {
          authenticated,
          browserEndpoint: state.browserEndpoint,
          profileDir: state.profileDir
        });

        return state;
      } catch (error) {
        const message = this.handleBrowserError(error, "Falha ao abrir sessão do Instagram");
        const state = readStoredSessionState();
        recordSystemEvent("instagram-assisted", "error", message);
        return state;
      }
    });
  }

  async syncInbox(options?: {
    threadLimit?: number;
    messagesLimit?: number;
    scrollPasses?: number;
    scrollStartPass?: number;
  }) {
    return this.runExclusive("sync-inbox", async () => {
      const fixture = await this.readFixture();
      if (fixture) {
        const session = persistSessionState({
          ...fixture.session,
          authenticated: true,
          lastSyncAt: new Date().toISOString()
        });
        return {
          session,
          threads: fixture.threads
        };
      }

      try {
        const page = await this.ensurePage();
        if (!page) {
          throw new InputError("Sessão assistida do Instagram indisponível.");
        }

        const authenticated = await this.detectAuthenticated(page);
        if (!authenticated) {
          throw new InputError("Instagram não autenticado no perfil assistido configurado.");
        }

        const threads = await this.scrapeThreads(page, options);
        const username = await this.detectOwnUsername(page);
        const session = this.persistLiveSessionState({
          status: "connected",
          authenticated: true,
          username,
          lastSyncAt: new Date().toISOString(),
          threadCount: threads.length,
          messageCount: threads.reduce((total, thread) => total + thread.messages.length, 0),
          errorMessage: null,
          pageUrl: page.url(),
          lastCheckedAt: new Date().toISOString()
        });
        recordSystemEvent("instagram-assisted", "info", "Instagram inbox synced", {
          threadCount: threads.length
        });

        return {
          session,
          threads
        };
      } catch (error) {
        this.handleBrowserError(error, "Falha ao sincronizar inbox do Instagram");
        throw error;
      }
    });
  }

  async sendMessage(input: {
    threadId?: string | null;
    username?: string | null;
    text?: string | null;
    mediaPath?: string | null;
    contentType?: "text" | "audio" | "image" | "video";
    caption?: string | null;
  }) {
    return this.runExclusive("send-message", async () => {
      const fixture = await this.readFixture();
      if (fixture) {
        const sentAt = new Date().toISOString();
        recordSystemEvent("instagram-assisted", "info", "Instagram fixture message sent", {
          threadId: input.threadId ?? null,
          username: input.username ?? null,
          contentType: input.contentType ?? "text"
        });
        persistSessionState({
          ...fixture.session,
          authenticated: true,
          status: "connected",
          lastSyncAt: sentAt
        });
        return {
          externalId: `ig-fixture-${randomUUID()}`,
          sentAt,
          threadId: input.threadId ?? input.username?.replace(/^@+/, "").toLowerCase() ?? null
        };
      }

      try {
        const page = await this.ensurePage();
        if (!page) {
          throw new InputError("Sessão assistida do Instagram indisponível.");
        }

        const authenticated = await this.detectAuthenticated(page);
        if (!authenticated) {
          throw new InputError("Instagram não autenticado no perfil assistido configurado.");
        }

        await this.openThreadOrComposer(page, input);

        const sendText = resolveAssistantSendText(input);

        if (input.mediaPath) {
          await this.uploadMedia(page, input.mediaPath);
          if (sendText) {
            await this.fillComposer(page, sendText);
          }
          await this.clickSendButton(page);
        } else if (sendText) {
          await this.fillComposer(page, sendText);
          const textarea = page.locator("textarea").last();
          if ((await textarea.count()) > 0) {
            await textarea.press("Enter");
          } else {
            await this.clickSendButton(page);
          }
        } else {
          throw new InputError("Informe texto, legenda ou mídia para o envio assistido do Instagram.");
        }

        const sentAt = new Date().toISOString();
        const username = await this.detectOwnUsername(page);
        this.persistLiveSessionState({
          status: "connected",
          authenticated: true,
          username,
          lastSyncAt: sentAt,
          errorMessage: null,
          pageUrl: page.url(),
          lastCheckedAt: sentAt
        });

        const resolvedThreadId = page.url().match(/\/direct\/t\/([^/?#]+)/)?.[1] ?? input.threadId ?? null;
        recordSystemEvent("instagram-assisted", "info", "Instagram message sent", {
          threadId: resolvedThreadId,
          username: input.username ?? null,
          contentType: input.contentType ?? (input.mediaPath ? "image" : "text")
        });

        return {
          externalId: `ig-browser-${randomUUID()}`,
          sentAt,
          threadId: resolvedThreadId
        };
      } catch (error) {
        this.handleBrowserError(error, "Falha ao enviar mensagem assistida do Instagram");
        throw error;
      }
    });
  }

  async sendMessageToThread(input: { threadId: string; text: string }) {
    return this.sendMessage(input);
  }
}

let instagramAssistedService: InstagramAssistedService | null = null;

export function getInstagramAssistedService() {
  if (!instagramAssistedService) {
    instagramAssistedService = new InstagramAssistedService();
  }

  return instagramAssistedService;
}

export function resolveInstagramThreadUrl(threadId: string) {
  return new URL(`/direct/t/${threadId}/`, "https://www.instagram.com").toString();
}

export function resolveInstagramProfileUrl(username: string) {
  return new URL(path.posix.join("/", username.replace(/^@+/, ""), "/"), "https://www.instagram.com").toString();
}
