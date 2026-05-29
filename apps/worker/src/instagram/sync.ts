import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { CONSTANTS, type WorkerEnv } from "@nuoma/config";
import type {
  MessageContentType,
  MessageDirection,
  TimestampPrecision,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Logger } from "pino";

import { normalizeInstagramHandle } from "./assisted.js";
import { assertInstagramUsable, detectInstagramGuard } from "./guard.js";

export interface InstagramSessionState {
  mode: "shared-cdp";
  status: "connected" | "assisted" | "challenge" | "not_open" | "error";
  authenticated: boolean;
  username: string | null;
  pageUrl: string | null;
  browserEndpoint: string;
  lastCheckedAt: string;
  lastSyncAt: string | null;
  threadCount: number;
  messageCount: number;
  errorMessage: string | null;
}

export interface InstagramRuntimeMetrics {
  connected: boolean;
  syncRuns: number;
  syncErrors: number;
  importedMessages: number;
  importedIncomingMessages: number;
  syncedThreads: number;
  lastSyncAt: string | null;
  lastError: string | null;
  session: InstagramSessionState | null;
}

export interface InstagramRuntime {
  metrics: InstagramRuntimeMetrics;
  getSessionState: (input?: { openPage?: boolean }) => Promise<InstagramSessionState>;
  syncInbox: (input?: InstagramSyncOptions) => Promise<InstagramSyncResult>;
  syncConversation: (input: InstagramConversationSyncInput) => Promise<InstagramSyncResult>;
  close: () => Promise<void>;
}

export interface InstagramSyncOptions {
  userId?: number;
  threadLimit?: number;
  messagesLimit?: number;
  scrollPasses?: number;
  scrollStartPass?: number;
  openPage?: boolean;
  reason?: string;
}

export interface InstagramConversationSyncInput {
  userId?: number;
  threadId: string;
  instagramHandle?: string | null;
  title?: string | null;
  messagesLimit?: number;
  reason?: string;
}

export interface InstagramSyncResult {
  session: InstagramSessionState;
  syncedThreads: number;
  createdContacts: number;
  linkedContacts: number;
  importedMessages: number;
  importedIncomingMessages: number;
  skippedThreads: number;
  threadIds: string[];
}

interface InstagramThreadSnapshot {
  threadId: string;
  username: string;
  title: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string | null;
  messages: InstagramThreadMessageSnapshot[];
}

export interface InstagramThreadMessageSnapshot {
  externalId: string | null;
  direction: "incoming" | "outgoing";
  body: string;
  contentType: Extract<MessageContentType, "text" | "image" | "video" | "audio">;
  sentAt: string | null;
  sentAtText?: string | null;
  timestampPrecision?: TimestampPrecision;
}

function browserArgFunction<TArg, TResult>(
  argumentName: string,
  body: string,
): (arg: TArg) => TResult {
  return new Function(argumentName, body) as (arg: TArg) => TResult;
}

export async function startInstagramRuntime(input: {
  env: WorkerEnv;
  repos: Repositories;
  logger: Logger;
}): Promise<InstagramRuntime> {
  const metrics: InstagramRuntimeMetrics = {
    connected: false,
    syncRuns: 0,
    syncErrors: 0,
    importedMessages: 0,
    importedIncomingMessages: 0,
    syncedThreads: 0,
    lastSyncAt: null,
    lastError: null,
    session: null,
  };
  let timer: NodeJS.Timeout | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  async function getSessionState(options?: { openPage?: boolean }): Promise<InstagramSessionState> {
    return runExclusive(async () => {
      const session = await readInstagramSessionViaCdp({
        env: input.env,
        openPage: options?.openPage ?? false,
      });
      metrics.session = session;
      metrics.connected = session.authenticated;
      metrics.lastError = session.errorMessage;
      return session;
    });
  }

  async function syncInbox(options?: InstagramSyncOptions): Promise<InstagramSyncResult> {
    return runExclusive(async () => {
      try {
        const result = await syncInstagramInboxViaCdp({
          env: input.env,
          repos: input.repos,
          logger: input.logger,
          options,
        });
        metrics.syncRuns += 1;
        metrics.importedMessages += result.importedMessages;
        metrics.importedIncomingMessages += result.importedIncomingMessages;
        metrics.syncedThreads = result.syncedThreads;
        metrics.lastSyncAt = result.session.lastSyncAt;
        metrics.session = result.session;
        metrics.connected = result.session.authenticated;
        metrics.lastError = null;
        return result;
      } catch (error) {
        metrics.syncErrors += 1;
        metrics.connected = false;
        metrics.lastError = serializeError(error);
        throw error;
      }
    });
  }

  async function syncConversation(
    options: InstagramConversationSyncInput,
  ): Promise<InstagramSyncResult> {
    return runExclusive(async () => {
      try {
        const result = await syncInstagramConversationViaCdp({
          env: input.env,
          repos: input.repos,
          logger: input.logger,
          options,
        });
        metrics.syncRuns += 1;
        metrics.importedMessages += result.importedMessages;
        metrics.importedIncomingMessages += result.importedIncomingMessages;
        metrics.syncedThreads = result.syncedThreads;
        metrics.lastSyncAt = result.session.lastSyncAt;
        metrics.session = result.session;
        metrics.connected = result.session.authenticated;
        metrics.lastError = null;
        return result;
      } catch (error) {
        metrics.syncErrors += 1;
        metrics.connected = false;
        metrics.lastError = serializeError(error);
        throw error;
      }
    });
  }

  if (input.env.WORKER_INSTAGRAM_SYNC_ENABLED) {
    timer = setInterval(() => {
      void syncInbox({
        userId: CONSTANTS.defaultUserId,
        threadLimit: input.env.WORKER_INSTAGRAM_SYNC_THREAD_LIMIT,
        messagesLimit: input.env.WORKER_INSTAGRAM_SYNC_MESSAGE_LIMIT,
        scrollPasses: input.env.WORKER_INSTAGRAM_SYNC_SCROLL_PASSES,
        reason: "interval",
      }).catch((error: unknown) => {
        input.logger.warn({ error }, "Instagram inbox interval sync failed");
      });
    }, input.env.WORKER_INSTAGRAM_SYNC_INTERVAL_MS);
  }

  void getSessionState({ openPage: false }).catch(() => undefined);

  return {
    metrics,
    getSessionState,
    syncInbox,
    syncConversation,
    close: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await queue.catch(() => undefined);
    },
  };
}

export async function readInstagramSessionViaCdp(input: {
  env: WorkerEnv;
  openPage?: boolean;
}): Promise<InstagramSessionState> {
  const endpoint = browserEndpoint(input.env);
  const checkedAt = new Date().toISOString();
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await resolveInstagramPage(context, {
      env: input.env,
      openPage: input.openPage ?? false,
    });
    if (!page) {
      return {
        mode: "shared-cdp",
        status: "not_open",
        authenticated: false,
        username: null,
        pageUrl: null,
        browserEndpoint: endpoint,
        lastCheckedAt: checkedAt,
        lastSyncAt: null,
        threadCount: 0,
        messageCount: 0,
        errorMessage: null,
      };
    }
    const guard = await detectInstagramGuard(page);
    if (guard.blocked) {
      return {
        mode: "shared-cdp",
        status: guard.reason === "login_required" ? "assisted" : "challenge",
        authenticated: false,
        username: null,
        pageUrl: page.url(),
        browserEndpoint: endpoint,
        lastCheckedAt: checkedAt,
        lastSyncAt: null,
        threadCount: 0,
        messageCount: 0,
        errorMessage: guard.reason === "login_required" ? null : guard.message,
      };
    }
    const authenticated = await detectInstagramAuthenticated(page);
    const username = authenticated ? await detectOwnInstagramUsername(page) : null;
    return {
      mode: "shared-cdp",
      status: authenticated ? "connected" : "assisted",
      authenticated,
      username,
      pageUrl: page.url(),
      browserEndpoint: endpoint,
      lastCheckedAt: checkedAt,
      lastSyncAt: null,
      threadCount: 0,
      messageCount: 0,
      errorMessage: null,
    };
  } catch (error) {
    return {
      mode: "shared-cdp",
      status: "error",
      authenticated: false,
      username: null,
      pageUrl: null,
      browserEndpoint: endpoint,
      lastCheckedAt: checkedAt,
      lastSyncAt: null,
      threadCount: 0,
      messageCount: 0,
      errorMessage: serializeError(error),
    };
  } finally {
    await safeDisconnect(browser);
  }
}

async function syncInstagramInboxViaCdp(input: {
  env: WorkerEnv;
  repos: Repositories;
  logger: Logger;
  options?: InstagramSyncOptions;
}): Promise<InstagramSyncResult> {
  const endpoint = browserEndpoint(input.env);
  const browser = await chromium.connectOverCDP(endpoint);
  let page: Page | null = null;
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    page = await resolveInstagramPage(context, {
      env: input.env,
      openPage: input.options?.openPage ?? true,
    });
    if (!page) {
      throw new Error("Instagram shared tab is not open");
    }
    await assertInstagramAuthenticated(page);
    const threads = await scrapeInstagramInbox(page, input.env, input.options);
    return persistInstagramThreads({
      repos: input.repos,
      logger: input.logger,
      userId: input.options?.userId ?? CONSTANTS.defaultUserId,
      sessionPage: page,
      browserEndpoint: endpoint,
      threads,
      reason: input.options?.reason ?? "sync_inbox_force",
    });
  } catch (error) {
    await writeInstagramFailureArtifact(page, {
      logger: input.logger,
      reason: input.options?.reason ?? "sync_inbox_force",
      error,
    });
    throw error;
  } finally {
    await safeDisconnect(browser);
  }
}

async function syncInstagramConversationViaCdp(input: {
  env: WorkerEnv;
  repos: Repositories;
  logger: Logger;
  options: InstagramConversationSyncInput;
}): Promise<InstagramSyncResult> {
  const endpoint = browserEndpoint(input.env);
  const browser = await chromium.connectOverCDP(endpoint);
  let page: Page | null = null;
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    page = await resolveInstagramPage(context, {
      env: input.env,
      openPage: true,
    });
    if (!page) {
      throw new Error("Instagram shared tab is not open");
    }
    await assertInstagramAuthenticated(page);
    await page.goto(
      `https://www.instagram.com/direct/t/${encodeURIComponent(input.options.threadId)}/`,
      {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      },
    );
    await page.waitForTimeout(1_200);
    const thread = await scrapeOpenInstagramThread(page, {
      threadId: input.options.threadId,
      username: input.options.instagramHandle ?? null,
      title: input.options.title ?? null,
      messagesLimit: input.options.messagesLimit ?? input.env.WORKER_INSTAGRAM_SYNC_MESSAGE_LIMIT,
    });
    return persistInstagramThreads({
      repos: input.repos,
      logger: input.logger,
      userId: input.options.userId ?? CONSTANTS.defaultUserId,
      sessionPage: page,
      browserEndpoint: endpoint,
      threads: [thread],
      reason: input.options.reason ?? "sync_conversation",
    });
  } catch (error) {
    await writeInstagramFailureArtifact(page, {
      logger: input.logger,
      reason: input.options.reason ?? "sync_conversation",
      error,
    });
    throw error;
  } finally {
    await safeDisconnect(browser);
  }
}

async function persistInstagramThreads(input: {
  repos: Repositories;
  logger: Logger;
  userId: number;
  sessionPage: Page;
  browserEndpoint: string;
  threads: InstagramThreadSnapshot[];
  reason: string;
}): Promise<InstagramSyncResult> {
  let createdContacts = 0;
  let linkedContacts = 0;
  let importedMessages = 0;
  let importedIncomingMessages = 0;
  let skippedThreads = 0;
  const threadIds: string[] = [];
  const syncedAt = new Date().toISOString();

  for (const thread of normalizeThreadSnapshots(input.threads)) {
    const instagramHandle = normalizeInstagramHandle(thread.username);
    if (!instagramHandle || !thread.threadId.trim()) {
      skippedThreads += 1;
      continue;
    }
    threadIds.push(thread.threadId);

    let contact = await input.repos.contacts.findByIdentity({
      userId: input.userId,
      instagramHandle,
    });
    if (contact) {
      linkedContacts += 1;
      if (contact.instagramHandle !== instagramHandle) {
        contact =
          (await input.repos.contacts.update({
            id: contact.id,
            userId: input.userId,
            instagramHandle,
            primaryChannel:
              contact.primaryChannel === "system" ? "instagram" : contact.primaryChannel,
          })) ?? contact;
      }
    } else {
      contact = await input.repos.contacts.create({
        userId: input.userId,
        name: thread.title || `@${instagramHandle}`,
        phone: null,
        waJid: null,
        email: null,
        primaryChannel: "instagram",
        instagramHandle,
        status: "lead",
        notes: null,
      });
      createdContacts += 1;
    }

    const conversation = await input.repos.conversations.upsertObserved({
      userId: input.userId,
      channel: "instagram",
      externalThreadId: thread.threadId,
      title: thread.title || `@${instagramHandle}`,
      contactId: contact.id,
      lastMessageAt: thread.lastMessageAt ?? syncedAt,
      lastPreview: thread.lastMessagePreview || null,
      unreadCount: thread.unreadCount,
    });

    const recentMessages = await input.repos.messages.listByConversation({
      userId: input.userId,
      conversationId: conversation.id,
      limit: 200,
      includeDeleted: false,
    });

    for (const [index, message] of thread.messages.entries()) {
      if (
        shouldSkipInstagramSyncedOutgoingDuplicate({
          message,
          existingMessages: recentMessages,
          syncedAt,
        })
      ) {
        continue;
      }
      const externalId = stableInstagramMessageExternalId(thread, index, message);
      const inserted = await input.repos.messages.insertOrIgnore({
        userId: input.userId,
        conversationId: conversation.id,
        contactId: contact.id,
        externalId,
        direction: instagramDirection(message.direction),
        contentType: message.contentType,
        status: message.direction === "outgoing" ? "sent" : "received",
        body: message.body,
        mediaAssetId: null,
        media: null,
        observedAtUtc: message.sentAt ?? syncedAt,
        timestampPrecision: message.timestampPrecision ?? (message.sentAt ? "second" : "unknown"),
        messageSecond: null,
        waInferredSecond: null,
        waDisplayedAt: null,
        raw: {
          source: "instagram-assisted-sync",
          syncReason: input.reason,
          instagramHandle,
          threadId: thread.threadId,
          originalExternalId: message.externalId,
          sentAtText: message.sentAtText ?? null,
        },
      });
      if (inserted) {
        recentMessages.unshift(inserted);
        importedMessages += 1;
        if (message.direction === "incoming") {
          importedIncomingMessages += 1;
        }
      }
    }
  }

  const username = await detectOwnInstagramUsername(input.sessionPage).catch(() => null);
  const session: InstagramSessionState = {
    mode: "shared-cdp",
    status: "connected",
    authenticated: true,
    username,
    pageUrl: input.sessionPage.url(),
    browserEndpoint: input.browserEndpoint,
    lastCheckedAt: syncedAt,
    lastSyncAt: syncedAt,
    threadCount: threadIds.length,
    messageCount: input.threads.reduce((total, thread) => total + thread.messages.length, 0),
    errorMessage: null,
  };

  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "sync.instagram_inbox.completed",
    severity: "info",
    payload: JSON.stringify({
      reason: input.reason,
      syncedThreads: threadIds.length,
      importedMessages,
      importedIncomingMessages,
      createdContacts,
      linkedContacts,
      skippedThreads,
      threadIds,
    }),
  });

  input.logger.info(
    { syncedThreads: threadIds.length, importedMessages, importedIncomingMessages },
    "Instagram inbox synchronized",
  );

  return {
    session,
    syncedThreads: threadIds.length,
    createdContacts,
    linkedContacts,
    importedMessages,
    importedIncomingMessages,
    skippedThreads,
    threadIds,
  };
}

async function resolveInstagramPage(
  context: BrowserContext,
  input: { env: WorkerEnv; openPage: boolean },
): Promise<Page | null> {
  const pages = context.pages().filter((page) => !page.isClosed());
  const existing =
    pages.find((page) => page.url().includes("instagram.com/direct/")) ??
    pages.find((page) => page.url().includes("instagram.com"));
  if (existing) {
    return existing;
  }
  if (!input.openPage) {
    return null;
  }
  const page = await context.newPage();
  await page.goto(input.env.IG_WEB_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_200);
  return page;
}

async function detectInstagramAuthenticated(page: Page): Promise<boolean> {
  const guard = await detectInstagramGuard(page);
  if (guard.blocked) {
    return false;
  }
  const state = await page.evaluate<{ loginInput: boolean; href: string }>(
    `(() => ({
      loginInput: Boolean(document.querySelector("input[name='username']")),
      href: location.href,
    }))()`,
  );
  return !state.loginInput && !state.href.includes("/accounts/login");
}

async function assertInstagramAuthenticated(page: Page): Promise<void> {
  await assertInstagramUsable(page);
  if (!(await detectInstagramAuthenticated(page))) {
    throw new Error("Instagram is not authenticated in the shared Chromium profile");
  }
}

async function detectOwnInstagramUsername(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `(() => {
    const blocked = new Set(["accounts", "direct", "explore", "reels", "stories", "about", "legal"]);
    const normalize = (value) => {
      const cleaned = String(value ?? "")
        .replace(/^@+/, "")
        .replace(/^\\/+|\\/+$/g, "")
        .trim()
        .toLowerCase();
      return cleaned && /^[a-z0-9._]+$/i.test(cleaned) && !blocked.has(cleaned) ? cleaned : null;
    };
    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => normalize(anchor.getAttribute("href")?.match(/^\\/([a-z0-9._]+)\\/?$/i)?.[1]))
      .filter(Boolean);
    return anchors[0] ?? null;
  })()`,
  );
}

async function scrapeInstagramInbox(
  page: Page,
  env: WorkerEnv,
  options?: InstagramSyncOptions,
): Promise<InstagramThreadSnapshot[]> {
  const threadLimit = clampInt(
    options?.threadLimit ?? env.WORKER_INSTAGRAM_SYNC_THREAD_LIMIT,
    1,
    50,
  );
  const messagesLimit = clampInt(
    options?.messagesLimit ?? env.WORKER_INSTAGRAM_SYNC_MESSAGE_LIMIT,
    1,
    100,
  );
  const scrollPasses = clampInt(
    options?.scrollPasses ?? env.WORKER_INSTAGRAM_SYNC_SCROLL_PASSES,
    1,
    50,
  );
  const scrollStartPass = clampInt(options?.scrollStartPass ?? 0, 0, 50);
  const ownUsername = await detectOwnInstagramUsername(page).catch(() => null);
  const processedThreadIds = new Set<string>();
  const processedRows = new Set<string>();
  const threads: InstagramThreadSnapshot[] = [];

  for (let pass = 0; pass < scrollPasses && threads.length < threadLimit; pass += 1) {
    await restoreInboxViewport(page, env.IG_WEB_URL, scrollStartPass + pass);
    const rows = await visibleInstagramInboxRows(page);
    for (const row of rows) {
      if (threads.length >= threadLimit) {
        break;
      }
      const rowKey = `${row.title}::${row.label}`;
      if (processedRows.has(rowKey)) {
        continue;
      }
      processedRows.add(rowKey);
      const clicked = await clickInstagramInboxRow(page, row.index);
      if (!clicked) {
        continue;
      }
      await page.waitForTimeout(1_600);
      const threadId = page.url().match(/\/direct\/t\/([^/?#]+)/)?.[1] ?? null;
      if (!threadId || processedThreadIds.has(threadId)) {
        continue;
      }
      processedThreadIds.add(threadId);
      const snapshot = await scrapeOpenInstagramThread(page, {
        threadId,
        title: row.title,
        username: null,
        ownUsername,
        messagesLimit,
      });
      threads.push(snapshot);
    }
  }

  await page
    .goto(env.IG_WEB_URL, { waitUntil: "domcontentloaded", timeout: 45_000 })
    .catch(() => undefined);
  return threads;
}

async function restoreInboxViewport(
  page: Page,
  inboxUrl: string,
  passIndex: number,
): Promise<void> {
  if (page.url().includes("/direct/t/")) {
    await page
      .goto(inboxUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => undefined);
  } else if (!page.url().includes("/direct/inbox")) {
    await page
      .goto(inboxUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(700);
  await page.evaluate(
    browserArgFunction<number, void>(
      "index",
      `
    const nav =
      document.querySelector("[aria-label='Lista de tópicos']") ??
      document.querySelector("[aria-label='Threads']") ??
      document.querySelector("[aria-label='Chats']") ??
      document.querySelector("main");
    if (!nav) return;
    const scrollables = [nav, ...Array.from(nav.querySelectorAll("div"))].filter((element) => {
      const item = element;
      return item.scrollHeight > item.clientHeight + 40;
    });
    const container = scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!container) return;
    const desiredTop = Math.min(
      Math.max(0, container.scrollHeight - container.clientHeight),
      Math.round(index * container.clientHeight * 0.82),
    );
    container.scrollTo({ top: desiredTop, behavior: "auto" });
  `,
    ),
    passIndex,
  );
  await page.waitForTimeout(400);
}

async function visibleInstagramInboxRows(
  page: Page,
): Promise<Array<{ index: number; label: string; title: string }>> {
  return page.evaluate<Array<{ index: number; label: string; title: string }>>(
    `(() => {
    const nav =
      document.querySelector("[aria-label='Lista de tópicos']") ??
      document.querySelector("[aria-label='Threads']") ??
      document.querySelector("[aria-label='Chats']") ??
      document.querySelector("main");
    if (!nav) return [];
    const noise = [/nova mensagem/i, /new message/i, /^primary$/i, /^general$/i, /^pedidos$/i, /^requests$/i];
    return Array.from(nav.querySelectorAll("div[role='button'], button, a"))
      .map((element, index) => {
        const node = element;
        const label = String(node.textContent ?? "").replace(/\\s+/g, " ").trim();
        const rect = node.getBoundingClientRect();
        if (!label || rect.width < 120 || rect.height < 22 || rect.bottom <= 80 || rect.top >= window.innerHeight - 12) {
          return null;
        }
        if (noise.some((pattern) => pattern.test(label))) return null;
        const titleCandidates = Array.from(
          node.querySelectorAll("h1, h2, h3, h4, span[dir='auto'], div[dir='auto']"),
        )
          .map((child) => String(child.textContent ?? "").replace(/\\s+/g, " ").trim())
          .filter(Boolean);
        const title =
          titleCandidates.find((candidate) => candidate.length <= 80 && !/[·•]/.test(candidate)) ??
          titleCandidates[0] ??
          label;
        return { index, label, title };
      })
      .filter(Boolean);
  })()`,
  );
}

async function clickInstagramInboxRow(page: Page, index: number): Promise<boolean> {
  return page.evaluate(
    browserArgFunction<number, boolean>(
      "targetIndex",
      `
    const nav =
      document.querySelector("[aria-label='Lista de tópicos']") ??
      document.querySelector("[aria-label='Threads']") ??
      document.querySelector("[aria-label='Chats']") ??
      document.querySelector("main");
    if (!nav) return false;
    const rows = Array.from(nav.querySelectorAll("div[role='button'], button, a"));
    const row = rows[targetIndex];
    if (!row) return false;
    row.click();
    return true;
  `,
    ),
    index,
  );
}

async function scrapeOpenInstagramThread(
  page: Page,
  input: {
    threadId: string;
    username?: string | null;
    title?: string | null;
    ownUsername?: string | null;
    messagesLimit: number;
  },
): Promise<InstagramThreadSnapshot> {
  const snapshot = await page.evaluate(
    browserArgFunction<
      number,
      {
        title: string;
        profileLinks: Array<{ href: string; text: string }>;
        messages: InstagramThreadMessageSnapshot[];
        unreadCount: number;
        lastMessagePreview: string;
        lastMessageAt: string | null;
      }
    >(
      "limit",
      `
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const titleCandidates = Array.from(
      document.querySelectorAll("main h1, main h2, header h1, header h2, main span[dir='auto'], header span[dir='auto']"),
    )
      .map((node) => clean(node.textContent))
      .filter(Boolean);
    const title =
      titleCandidates.find((candidate) => candidate.length <= 80 && !candidate.startsWith("@") && !/^(mensagens|messages)$/i.test(candidate)) ??
      titleCandidates[0] ??
      clean(document.title);
    const profileLinks = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => ({
        href: anchor.getAttribute("href") ?? "",
        text: clean(anchor.textContent),
      }))
      .filter((entry) => entry.href);
    const sidebar =
      document.querySelector("[aria-label='Lista de tópicos']") ??
      document.querySelector("[aria-label='Threads']") ??
      document.querySelector("[aria-label='Chats']");
    const sidebarRect = sidebar?.getBoundingClientRect();
    const chatLeft =
      sidebarRect && sidebarRect.width > 0 ? sidebarRect.right - 4 : window.innerWidth * 0.35;
    const isThreadPaneRect = (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > chatLeft &&
      rect.left >= chatLeft - 12;
    const relativeTimePattern = /^(há\\s*)?(\\d+\\s*(s|min|m|h|d|sem|w|hr|hrs|days?|weeks?|months?|meses?|mês|hora|horas|dia|dias|semana|semanas|minuto|minutos|segundo|segundos)|hoje|ontem|yesterday|today|just now|agora)$/i;
    const receiptStatusPattern = /^(visto|seen|enviado|sent|entregue|delivered|visualizado|read)(:|\\b)/i;
    const isReceiptOrTime = (text) => {
      const normalized = clean(text);
      return !normalized || relativeTimePattern.test(normalized) || receiptStatusPattern.test(normalized);
    };
    const contentTypeFor = (element) => {
      const container = element.closest("div[role='row'], div[role='listitem'], article, div") || element;
      const label = clean([
        container.getAttribute("aria-label"),
        container.textContent,
        ...Array.from(container.querySelectorAll("[aria-label]")).map((node) => node.getAttribute("aria-label")),
      ].filter(Boolean).join(" "));
      if (container.querySelector("video")) return "video";
      if (container.querySelector("audio") || /\\b(audio|áudio|voice|voz)\\b/i.test(label)) return "audio";
      const images = Array.from(container.querySelectorAll("img")).filter((image) => {
        const rect = image.getBoundingClientRect();
        const alt = clean(image.getAttribute("alt"));
        return rect.width >= 80 && rect.height >= 80 && !/profile|perfil|avatar/i.test(alt);
      });
      if (images.length > 0) return "image";
      return "text";
    };
    const timeNodes = Array.from(document.querySelectorAll("main time, main span[dir='auto'], main div[dir='auto']"))
      .map((node) => {
        const element = node;
        const text = clean(element.getAttribute("datetime") || element.textContent);
        const rect = element.getBoundingClientRect();
        if (!text || !isThreadPaneRect(rect) || !relativeTimePattern.test(text)) {
          return null;
        }
        return { text, top: rect.top };
      })
      .filter(Boolean);
    const nearestTimeText = (top) => {
      let best = null;
      for (const time of timeNodes) {
        const distance = Math.abs(top - time.top);
        if (distance > 180) continue;
        if (!best || distance < best.distance || (distance === best.distance && time.top <= top)) {
          best = { text: time.text, distance };
        }
      }
      return best?.text ?? null;
    };
    const textNodes = Array.from(document.querySelectorAll("main div[dir='auto'], main span[dir='auto'], main div[role='row']"))
      .map((node) => {
        const element = node;
        const text = clean(element.textContent);
        const rect = element.getBoundingClientRect();
        if (!text || !isThreadPaneRect(rect) || rect.top < 70 || isReceiptOrTime(text)) {
          return null;
        }
        return {
          text,
          left: rect.left,
          top: rect.top,
          contentType: contentTypeFor(element),
          sentAtText: nearestTimeText(rect.top),
        };
      })
      .filter(Boolean);
    const mediaNodes = Array.from(document.querySelectorAll("main video, main audio, main img"))
      .map((node) => {
        const element = node;
        const rect = element.getBoundingClientRect();
        if (!isThreadPaneRect(rect) || rect.width < 80 || rect.height < 40) {
          return null;
        }
        const alt = clean(element.getAttribute("alt"));
        if (/profile|perfil|avatar/i.test(alt)) {
          return null;
        }
        const contentType =
          element.tagName.toLowerCase() === "video"
            ? "video"
            : element.tagName.toLowerCase() === "audio"
              ? "audio"
              : "image";
        return {
          text: alt && !isReceiptOrTime(alt) ? alt : "",
          left: rect.left,
          top: rect.top,
          contentType,
          sentAtText: nearestTimeText(rect.top),
        };
      })
      .filter(Boolean);
    const deduped = [];
    for (const node of [...textNodes, ...mediaNodes]) {
      if (
        !deduped.some(
          (seen) =>
            seen.text === node.text &&
            seen.contentType === node.contentType &&
            Math.abs(seen.top - node.top) <= 4,
        )
      ) {
        deduped.push(node);
      }
    }
    const messages = deduped
      .sort((a, b) => a.top - b.top)
      .slice(-limit)
      .map((item) => ({
        externalId: null,
        direction: item.left > window.innerWidth * 0.5 ? "outgoing" : "incoming",
        body: item.text,
        contentType: item.contentType,
        sentAt: null,
        sentAtText: item.sentAtText,
        timestampPrecision: "unknown",
      }));
    const lastMessage = messages[messages.length - 1] ?? null;
    return {
      title,
      profileLinks,
      messages,
      unreadCount: 0,
      lastMessagePreview: lastMessage?.body ?? "",
      lastMessageAt: null,
    };
  `,
    ),
    input.messagesLimit,
  );
  const participant = resolveInstagramThreadParticipant({
    profileLinks: snapshot.profileLinks,
    ownUsername: input.ownUsername,
    fallbackTitle: input.username ?? input.title ?? snapshot.title,
  });
  const username = normalizeInstagramHandle(input.username) ?? participant.username ?? "";
  const observedAtUtc = new Date().toISOString();
  const messages = snapshot.messages.map((message) => {
    const parsedTimestamp = parseInstagramDisplayedTimestamp(message.sentAtText, observedAtUtc);
    return {
      ...message,
      sentAt: message.sentAt ?? parsedTimestamp?.sentAt ?? null,
      timestampPrecision:
        message.timestampPrecision && message.timestampPrecision !== "unknown"
          ? message.timestampPrecision
          : (parsedTimestamp?.timestampPrecision ?? "unknown"),
    };
  });
  return {
    threadId: input.threadId,
    username,
    title:
      participant.displayName ??
      input.title ??
      snapshot.title ??
      (username ? `@${username}` : input.threadId),
    unreadCount: snapshot.unreadCount,
    lastMessagePreview: snapshot.lastMessagePreview,
    lastMessageAt: snapshot.lastMessageAt,
    messages,
  };
}

function resolveInstagramThreadParticipant(input: {
  profileLinks: Array<{ href: string; text: string }>;
  ownUsername?: string | null;
  fallbackTitle?: string | null;
}): { username: string | null; displayName: string | null } {
  const ownUsername = normalizeInstagramHandle(input.ownUsername);
  const blocked = new Set(["accounts", "direct", "explore", "reels", "stories", "about", "legal"]);
  const candidates = new Map<string, { score: number; displayName: string | null }>();
  for (const link of input.profileLinks) {
    const username = normalizeInstagramHandle(link.href.match(/^\/([a-z0-9._]+)\/?$/i)?.[1]);
    if (!username || username === ownUsername || blocked.has(username)) continue;
    const text = link.text.replace(/\s+/g, " ").trim();
    const displayName =
      text
        .replace(/\b(ver perfil|view profile|perfil|instagram)\b/gi, "")
        .replace(new RegExp(`\\b@?${escapeRegExp(username)}\\b`, "gi"), "")
        .replace(/\s+/g, " ")
        .trim() || null;
    const current = candidates.get(username) ?? { score: 0, displayName: null };
    current.score += 10 + (displayName ? 4 : 0);
    current.displayName ??= displayName;
    candidates.set(username, current);
  }
  const sorted = [...candidates.entries()].sort((a, b) => b[1].score - a[1].score);
  const best = sorted[0];
  if (best) return { username: best[0], displayName: best[1].displayName };
  const fallback = normalizeInstagramHandle(input.fallbackTitle);
  return {
    username: fallback,
    displayName: fallback ? null : input.fallbackTitle?.trim() || null,
  };
}

export function shouldSkipInstagramSyncedOutgoingDuplicate(input: {
  message: Pick<InstagramThreadMessageSnapshot, "direction" | "body" | "contentType" | "sentAt">;
  existingMessages: Array<{
    direction: MessageDirection;
    status: string;
    body: string | null;
    contentType: MessageContentType;
    mediaAssetId?: number | null;
    observedAtUtc: string;
  }>;
  syncedAt: string;
}): boolean {
  if (input.message.direction !== "outgoing") {
    return false;
  }
  const body = input.message.body.replace(/\s+/g, " ").trim();
  const messageMs = Date.parse(input.message.sentAt ?? input.syncedAt);
  for (const existing of input.existingMessages) {
    if (existing.direction !== "outbound" || existing.status === "failed") {
      continue;
    }
    const existingMs = Date.parse(existing.observedAtUtc);
    if (
      Number.isFinite(messageMs) &&
      Number.isFinite(existingMs) &&
      Math.abs(existingMs - messageMs) > 36 * 60 * 60 * 1000
    ) {
      continue;
    }
    const existingBody = String(existing.body ?? "").replace(/\s+/g, " ").trim();
    if (body && existingBody === body) {
      return true;
    }
    if (
      !body &&
      input.message.contentType !== "text" &&
      existing.contentType === input.message.contentType &&
      existing.mediaAssetId !== null
    ) {
      return true;
    }
  }
  return false;
}

export function parseInstagramDisplayedTimestamp(
  value: string | null | undefined,
  observedAtUtc = new Date().toISOString(),
): { sentAt: string; timestampPrecision: TimestampPrecision } | null {
  const observedMs = Date.parse(observedAtUtc);
  if (!Number.isFinite(observedMs)) {
    return null;
  }
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const absoluteMs = Date.parse(raw);
    return Number.isFinite(absoluteMs)
      ? { sentAt: new Date(absoluteMs).toISOString(), timestampPrecision: "second" }
      : null;
  }

  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^ha\s+/, "")
    .replace(/^about\s+/, "")
    .replace(/^cerca de\s+/, "")
    .trim();

  if (normalized === "agora" || normalized === "just now") {
    return { sentAt: new Date(observedMs).toISOString(), timestampPrecision: "second" };
  }
  if (normalized === "hoje" || normalized === "today") {
    return { sentAt: new Date(observedMs).toISOString(), timestampPrecision: "date" };
  }
  if (normalized === "ontem" || normalized === "yesterday") {
    return {
      sentAt: new Date(observedMs - 24 * 60 * 60 * 1000).toISOString(),
      timestampPrecision: "date",
    };
  }

  const match = normalized.match(
    /^(\d{1,4})\s*(s|sec|secs|second|seconds|segundo|segundos|min|m|minute|minutes|minuto|minutos|h|hr|hrs|hour|hours|hora|horas|d|day|days|dia|dias|w|week|weeks|sem|semana|semanas|mes|meses|month|months)$/i,
  );
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const unit = match[2]!.toLowerCase();
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (["s", "sec", "secs", "second", "seconds", "segundo", "segundos"].includes(unit)) {
    return {
      sentAt: new Date(observedMs - amount * 1000).toISOString(),
      timestampPrecision: "second",
    };
  }
  if (["min", "m", "minute", "minutes", "minuto", "minutos"].includes(unit)) {
    return {
      sentAt: new Date(observedMs - amount * minuteMs).toISOString(),
      timestampPrecision: "minute",
    };
  }
  if (["h", "hr", "hrs", "hour", "hours", "hora", "horas"].includes(unit)) {
    return {
      sentAt: new Date(observedMs - amount * hourMs).toISOString(),
      timestampPrecision: "minute",
    };
  }
  if (["d", "day", "days", "dia", "dias"].includes(unit)) {
    return {
      sentAt: new Date(observedMs - amount * dayMs).toISOString(),
      timestampPrecision: "date",
    };
  }
  if (["w", "week", "weeks", "sem", "semana", "semanas"].includes(unit)) {
    return {
      sentAt: new Date(observedMs - amount * 7 * dayMs).toISOString(),
      timestampPrecision: "date",
    };
  }
  if (["mes", "meses", "month", "months"].includes(unit)) {
    return {
      sentAt: new Date(observedMs - amount * 30 * dayMs).toISOString(),
      timestampPrecision: "date",
    };
  }
  return null;
}

function normalizeThreadSnapshots(threads: InstagramThreadSnapshot[]): InstagramThreadSnapshot[] {
  return threads.map((thread) => {
    const messages = thread.messages
      .map((message) => ({
        ...message,
        body: message.body.replace(/\s+/g, " ").trim(),
      }))
      .filter((message) => message.body || message.contentType !== "text");
    const lastMessage = messages[messages.length - 1] ?? null;
    return {
      ...thread,
      title: thread.title.replace(/\s+/g, " ").trim() || `@${thread.username}`,
      lastMessagePreview:
        thread.lastMessagePreview.replace(/\s+/g, " ").trim() || lastMessage?.body || "",
      lastMessageAt: thread.lastMessageAt ?? lastMessage?.sentAt ?? null,
      messages,
    };
  });
}

export function stableInstagramMessageExternalId(
  thread: Pick<InstagramThreadSnapshot, "threadId" | "messages">,
  messageIndex: number,
  message: Pick<InstagramThreadMessageSnapshot, "externalId" | "direction" | "body">,
): string {
  if (
    message.externalId &&
    !message.externalId.startsWith("ig-browser-") &&
    !message.externalId.startsWith("ig-fixture-")
  ) {
    return message.externalId;
  }
  const posFromEnd = thread.messages.length - 1 - messageIndex;
  const bodyHash = createHash("sha256").update(message.body).digest("base64url").slice(0, 40);
  return `ig:${thread.threadId}:e${posFromEnd}:${message.direction}:${bodyHash}`;
}

function instagramDirection(direction: "incoming" | "outgoing"): MessageDirection {
  return direction === "incoming" ? "inbound" : "outbound";
}

function browserEndpoint(env: WorkerEnv): string {
  return `http://${env.CHROMIUM_CDP_HOST}:${env.CHROMIUM_CDP_PORT}`;
}

async function writeInstagramFailureArtifact(
  page: Page | null,
  input: { logger: Logger; reason: string; error: unknown },
): Promise<void> {
  if (!page) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeReason = input.reason.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48) || "sync";
  const dir = path.resolve(process.cwd(), "data", "instagram-sync-failures");
  const base = `${stamp}-${safeReason}`;
  const screenshotPath = path.join(dir, `${base}.png`);
  const htmlPath = path.join(dir, `${base}.html`);
  const metaPath = path.join(dir, `${base}.json`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const html = await page.content().catch(() => null);
    await Promise.allSettled([
      page.screenshot({ path: screenshotPath, fullPage: true }),
      html ? fs.writeFile(htmlPath, html) : Promise.resolve(),
      fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            reason: input.reason,
            error: serializeError(input.error),
            url: page.url(),
            capturedAt: new Date().toISOString(),
            screenshotPath,
            htmlPath: html ? htmlPath : null,
          },
          null,
          2,
        ),
      ),
    ]);
    input.logger.warn(
      { reason: input.reason, error: input.error, screenshotPath, htmlPath, metaPath },
      "Instagram sync failure artifact captured",
    );
  } catch (artifactError) {
    input.logger.warn(
      { reason: input.reason, error: input.error, artifactError },
      "Instagram sync failure artifact capture failed",
    );
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeDisconnect(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // CDP browser is owned by the local worker process; ignore disconnect races.
  }
}
