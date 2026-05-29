import { setTimeout as sleep } from "node:timers/promises";

import type { WorkerEnv } from "@nuoma/config";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface InstagramTextSendInput {
  env: WorkerEnv;
  username: string;
  threadId?: string | null;
  text: string;
  mediaPaths?: string[] | null;
  contentType?: "text" | "image" | "video";
  reason: string;
}

export interface InstagramTextSendResult {
  mode: "instagram-text-message" | "instagram-media-message";
  username: string;
  threadId: string | null;
  reason: string;
  externalId: string;
  pageUrl: string;
  contentType: "text" | "image" | "video";
  mediaCount: number;
}

function browserArgFunction<TArg, TResult>(
  argumentName: string,
  body: string,
): (arg: TArg) => TResult {
  return new Function(argumentName, body) as (arg: TArg) => TResult;
}

export async function sendInstagramTextViaCdp(
  input: InstagramTextSendInput,
): Promise<InstagramTextSendResult> {
  const username = normalizeInstagramHandle(input.username);
  if (!username) {
    throw new Error("send_instagram_message requires an Instagram username");
  }
  const text = input.text.trim();
  const mediaPaths = uniqueMediaPaths(input.mediaPaths);
  const contentType = input.contentType ?? (mediaPaths.length > 0 ? "image" : "text");
  if (!text && mediaPaths.length === 0) {
    throw new Error("send_instagram_message requires text or media");
  }
  if (contentType !== "text" && contentType !== "image" && contentType !== "video") {
    throw new Error(`send_instagram_message unsupported content type: ${contentType}`);
  }

  const browser = await chromium.connectOverCDP(
    `http://${input.env.CHROMIUM_CDP_HOST}:${input.env.CHROMIUM_CDP_PORT}`,
  );
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await ensureInstagramPage(context);
    await assertInstagramAuthenticated(page);
    await openInstagramThreadOrComposer(page, {
      threadId: input.threadId ?? null,
      username,
    });
    if (mediaPaths.length > 0) {
      await uploadInstagramMedia(page, mediaPaths);
      if (text) {
        await fillInstagramComposer(page, text);
      }
      await clickInstagramSend(page);
    } else {
      await fillInstagramComposer(page, text);
      await clickInstagramSend(page);
    }
    await waitForInstagramSendEvidence(page, text, input.env.IG_SEND_CONFIRMATION_TIMEOUT_MS);

    const threadId = page.url().match(/\/direct\/t\/([^/?#]+)/)?.[1] ?? null;
    return {
      mode: mediaPaths.length > 0 ? "instagram-media-message" : "instagram-text-message",
      username,
      threadId,
      reason: input.reason,
      externalId: `ig-cdp-${Date.now()}`,
      pageUrl: page.url(),
      contentType,
      mediaCount: mediaPaths.length,
    };
  } finally {
    await safeDisconnect(browser);
  }
}

export function normalizeInstagramHandle(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^ig:/i, "")
    .replace(/^@+/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}

async function ensureInstagramPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages().filter((page) => !page.isClosed());
  const existing =
    pages.find((page) => page.url().includes("instagram.com/direct/")) ??
    pages.find((page) => page.url().includes("instagram.com"));
  const page = existing ?? (await context.newPage());
  if (!page.url().includes("instagram.com/direct/")) {
    await page.goto("https://www.instagram.com/direct/inbox/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(1_200);
  }
  return page;
}

async function assertInstagramAuthenticated(page: Page): Promise<void> {
  const state = await page.evaluate<{ loginInput: boolean; href: string; body: string }>(
    `(() => ({
      loginInput: Boolean(document.querySelector("input[name='username']")),
      href: location.href,
      body: String(document.body?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 500),
    }))()`,
  );
  if (state.loginInput || state.href.includes("/accounts/login")) {
    throw new Error("Instagram is not authenticated in the shared Chromium profile");
  }
}

async function openInstagramThreadOrComposer(
  page: Page,
  input: { threadId: string | null; username: string },
): Promise<void> {
  const explicitThreadId =
    input.threadId && !input.threadId.startsWith("ig:") && input.threadId !== input.username
      ? input.threadId
      : null;
  if (explicitThreadId) {
    await page.goto(`https://www.instagram.com/direct/t/${encodeURIComponent(explicitThreadId)}/`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(1_200);
    if (await hasInstagramComposer(page)) {
      return;
    }
  }

  await page.goto("https://www.instagram.com/direct/new/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1_200);

  const searchInput = page.locator("input[name='searchInput']").last();
  if ((await searchInput.count()) === 0) {
    throw new Error("Instagram assisted composer search input was not found");
  }
  await searchInput.fill(input.username);
  await page.waitForTimeout(1_800);

  const selected = await clickBestInstagramRecipientCandidate(page, input.username);
  if (!selected) {
    throw new Error(`Instagram recipient @${input.username} was not found in composer search`);
  }
  await waitForInstagramComposer(page, 5_000, false);
  if (!(await hasInstagramComposer(page))) {
    await clickInstagramStartMessage(page);
  }
  await waitForInstagramComposer(page);
}

async function hasInstagramComposer(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(
    `(() => {
    return Boolean(
      document.querySelector("textarea") ||
        document.querySelector("div[contenteditable='true'][role='textbox']"),
    );
  })()`,
  );
}

async function waitForInstagramComposer(
  page: Page,
  timeoutMs = 15_000,
  throwOnTimeout = true,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasInstagramComposer(page)) {
      return true;
    }
    await sleep(400);
  }
  if (!throwOnTimeout) {
    return false;
  }
  throw new Error("Instagram composer did not open for selected recipient");
}

async function clickBestInstagramRecipientCandidate(
  page: Page,
  username: string,
): Promise<boolean> {
  return page.evaluate(
    browserArgFunction<string, boolean>(
      "targetUsername",
      `
    const normalizedTarget = targetUsername.toLowerCase();
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
      "pedidos",
    ]);
    const nodes = Array.from(document.querySelectorAll("div[role='button'], button, a")).filter(
      (node) => node instanceof HTMLElement,
    );
    const candidates = nodes
      .map((node) => {
        const text = String(node.textContent ?? "").replace(/\\s+/g, " ").trim();
        const aria = String(node.getAttribute("aria-label") ?? "").replace(/\\s+/g, " ").trim();
        const descendants = Array.from(node.querySelectorAll("span, div"))
          .map((child) => String(child.textContent ?? "").replace(/\\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 12);
        const searchable = [text, aria, ...descendants]
          .map((value) => value.toLowerCase())
          .filter(Boolean);
        if (searchable.length === 0) {
          return null;
        }
        if (
          ignoredLabels.has(searchable[0] ?? "") ||
          ignoredLabels.has(searchable[1] ?? "") ||
          searchable.some((value) => value.includes("você:") || value.includes("voce:")) ||
          searchable.some((value) => /(^| )· ?\\d/.test(value))
        ) {
          return null;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        const exact = searchable.some((value) => value === normalizedTarget);
        const contains = searchable.some((value) => value.includes(normalizedTarget));
        if (!exact && !contains) {
          return null;
        }
        let score = exact ? 300 : 120;
        if (descendants.some((value) => value.toLowerCase() === normalizedTarget)) {
          score += 80;
        }
        if (searchable.some((value) => value.includes("@" + normalizedTarget))) {
          score += 25;
        }
        if (searchable.some((value) => value.includes("seguir") || value.includes("follow"))) {
          score -= 15;
        }
        if (node.querySelector("img")) {
          score += 2;
        }
        return { node, score };
      })
      .filter((item) => Boolean(item))
      .sort((a, b) => b.score - a.score);

    const target = candidates[0]?.node;
    if (!target) return false;
    target.click();
    return true;
  `,
    ),
    username,
  );
}

async function clickInstagramStartMessage(page: Page): Promise<void> {
  const clicked = await page.evaluate<boolean>(
    `(() => {
    const labels = ["enviar mensagem", "send message", "chat"];
    const nodes = Array.from(document.querySelectorAll("button, div[role='button']"))
      .filter((node) => node instanceof HTMLElement)
      .reverse();
    const target = nodes.find((node) => {
      const text = String(node.textContent ?? "").replace(/\\s+/g, " ").trim().toLowerCase();
      const aria = String(node.getAttribute("aria-label") ?? "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
      return labels.some((label) => text === label || aria === label);
    });
    if (!target) {
      return false;
    }
    target.click();
    return true;
  })()`,
  );
  if (!clicked && !(await hasInstagramComposer(page))) {
    throw new Error("Instagram send-message start action was not found");
  }
}

async function fillInstagramComposer(page: Page, text: string): Promise<void> {
  await waitForInstagramComposer(page);
  const textarea = page.locator("textarea").last();
  if ((await textarea.count()) > 0) {
    await textarea.fill(text);
    return;
  }

  const richComposer = page.locator("div[contenteditable='true'][role='textbox']").last();
  if ((await richComposer.count()) > 0) {
    await richComposer.click();
    await page.keyboard.insertText(text);
    return;
  }

  throw new Error("Instagram composer field was not found");
}

async function uploadInstagramMedia(page: Page, mediaPaths: string[]): Promise<void> {
  const fileInput = page.locator("input[type='file']").last();
  if ((await fileInput.count()) === 0) {
    throw new Error("Instagram media upload input was not found");
  }
  await fileInput.setInputFiles(mediaPaths);
  await page.waitForTimeout(1_600);
}

async function clickInstagramSend(page: Page): Promise<void> {
  const textarea = page.locator("textarea").last();
  if ((await textarea.count()) > 0) {
    await textarea.press("Enter");
    await page.waitForTimeout(700);
    return;
  }

  const clicked = await page.evaluate<boolean>(
    `(() => {
    const labels = ["send", "enviar"];
    const nodes = Array.from(document.querySelectorAll("button, div[role='button']"))
      .filter((node) => node instanceof HTMLElement)
      .reverse();
    const target = nodes.find((node) => {
      const text = String(node.textContent ?? "").replace(/\\s+/g, " ").trim().toLowerCase();
      const aria = String(node.getAttribute("aria-label") ?? "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
      return labels.some((label) => text === label || aria.includes(label));
    });
    if (!target) {
      return false;
    }
    target.click();
    return true;
  })()`,
  );
  if (!clicked) {
    throw new Error("Instagram send button was not found");
  }
  await page.waitForTimeout(700);
}

async function waitForInstagramSendEvidence(
  page: Page,
  text: string,
  timeoutMs: number,
): Promise<void> {
  if (!text) {
    await page.waitForTimeout(Math.min(Math.max(timeoutMs, 1_500), 4_000));
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      browserArgFunction<string, boolean>(
        "expected",
        `
      return String(document.body?.innerText ?? "").includes(expected);
    `,
      ),
      text,
    );
    if (found) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Instagram send confirmation timed out");
}

function uniqueMediaPaths(paths: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of paths ?? []) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

async function safeDisconnect(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // connectOverCDP close can race with a manually managed browser; ignore disconnect noise.
  }
}
