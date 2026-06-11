import { setTimeout as sleep } from "node:timers/promises";

import type { WorkerEnv } from "@nuoma/config";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { assertInstagramUsable } from "./guard.js";

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
    await assertInstagramUsable(page);
    if (mediaPaths.length > 0) {
      await uploadInstagramMedia(page, mediaPaths);
      if (text) {
        await fillInstagramComposer(page, text);
      }
      await assertInstagramUsable(page);
      await clickInstagramSend(page);
    } else {
      await fillInstagramComposer(page, text);
      await assertInstagramUsable(page);
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
  await assertInstagramUsable(page);
  const state = await page.evaluate<{ loginInput: boolean; href: string }>(
    `(() => ({
      loginInput: Boolean(document.querySelector("input[name='username']")),
      href: location.href,
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
    await assertInstagramUsable(page);
    if (
      (await waitForInstagramComposer(page, 10_000, false)) ||
      (await waitForInstagramMediaUploadInput(page, 4_000))
    ) {
      return;
    }
  }

  await page.goto("https://www.instagram.com/direct/new/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1_200);
  await assertInstagramUsable(page);

  const searchInput = page.locator("input[name='searchInput']").last();
  if ((await searchInput.count()) === 0) {
    throw new Error("Instagram assisted composer search input was not found");
  }
  await searchInput.fill(input.username);
  await page.waitForTimeout(1_800);

  const selected = await clickBestInstagramRecipientCandidate(page, input.username);
  await assertInstagramUsable(page);
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

async function hasInstagramMediaUploadInput(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(`(() => Boolean(document.querySelector("input[type='file']")))()`);
}

async function waitForInstagramComposer(
  page: Page,
  timeoutMs = 15_000,
  throwOnTimeout = true,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await assertInstagramUsable(page);
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

async function waitForInstagramMediaUploadInput(page: Page, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await assertInstagramUsable(page);
    if (await hasInstagramMediaUploadInput(page)) {
      return true;
    }
    await sleep(400);
  }
  return false;
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

export async function fillInstagramComposer(page: Page, text: string): Promise<void> {
  await waitForInstagramComposer(page);
  const textarea = page.locator("textarea").last();
  if ((await textarea.count()) > 0) {
    await textarea.fill(text);
    return;
  }

  const richComposer = page.locator("div[contenteditable='true'][role='textbox']").last();
  if ((await richComposer.count()) > 0) {
    await focusInstagramRichComposer(richComposer);
    await page.keyboard.insertText(text);
    await page.waitForTimeout(150);
    if (await instagramComposerContains(page, text)) {
      return;
    }
    if (await replaceInstagramRichComposerText(richComposer, text)) {
      await page.waitForTimeout(150);
      if (await instagramComposerContains(page, text)) {
        return;
      }
    }
    throw new Error("Instagram composer field did not accept text");
  }

  throw new Error("Instagram composer field was not found");
}

async function focusInstagramRichComposer(richComposer: Locator): Promise<void> {
  await richComposer.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  try {
    await richComposer.click({ timeout: 5_000 });
    return;
  } catch {
    // Instagram's rich editor can keep moving while Direct loads. Fall through to stronger focus paths.
  }

  try {
    await richComposer.click({ force: true, timeout: 3_000 });
    return;
  } catch {
    // DOM focus is safer than giving up when Playwright cannot get a stable click target.
  }

  await richComposer.evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    node.scrollIntoView({ block: "center", inline: "nearest" });
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  });
}

async function instagramComposerContains(page: Page, text: string): Promise<boolean> {
  return page.evaluate(
    browserArgFunction<string, boolean>(
      "expectedText",
      `
    const textarea = Array.from(document.querySelectorAll("textarea")).at(-1);
    if (textarea && String(textarea.value ?? "").includes(expectedText)) {
      return true;
    }
    const editors = Array.from(
      document.querySelectorAll("div[contenteditable='true'][role='textbox']"),
    );
    const editor = editors.at(-1);
    if (!editor) {
      return false;
    }
    return String(editor.textContent ?? "").includes(expectedText);
  `,
    ),
    text,
  );
}

async function replaceInstagramRichComposerText(
  richComposer: Locator,
  text: string,
): Promise<boolean> {
  return richComposer.evaluate((node, message) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    node.scrollIntoView({ block: "center", inline: "nearest" });
    node.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, message);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      node.textContent = message;
    }

    try {
      node.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: message,
          inputType: "insertText",
        }),
      );
    } catch {
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, text);
}

async function uploadInstagramMedia(page: Page, mediaPaths: string[]): Promise<void> {
  if (!(await waitForInstagramMediaUploadInput(page, 5_000))) {
    await clickInstagramMediaUploadAffordance(page);
  }
  if (!(await waitForInstagramMediaUploadInput(page, 10_000))) {
    throw new Error("Instagram media upload input was not found");
  }
  const fileInput = page.locator("input[type='file']").last();
  await fileInput.setInputFiles(mediaPaths);
  await page.waitForTimeout(1_600);
}

async function clickInstagramMediaUploadAffordance(page: Page): Promise<void> {
  const clicked = await page.evaluate<boolean>(
    `(() => {
    const labels = [
      "add photo or video",
      "adicionar foto ou vídeo",
      "adicionar foto ou video",
      "photo or video",
      "foto ou vídeo",
      "foto ou video",
      "media",
    ];
    const nodes = Array.from(document.querySelectorAll("button, div[role='button'], svg[aria-label]"))
      .filter((node) => node instanceof HTMLElement || node instanceof SVGElement)
      .reverse();
    const target = nodes.find((node) => {
      const text = String(node.textContent ?? "").replace(/\\s+/g, " ").trim().toLowerCase();
      const aria = String(node.getAttribute("aria-label") ?? "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
      return labels.some((label) => text.includes(label) || aria.includes(label));
    });
    const clickable = target?.closest("button, div[role='button']") ?? target;
    if (!(clickable instanceof HTMLElement || clickable instanceof SVGElement)) {
      return false;
    }
    clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`,
  );
  if (clicked) {
    await page.waitForTimeout(800);
  }
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
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    return;
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
