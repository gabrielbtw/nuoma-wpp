import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-message-actions-m6.png";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir("data", { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: webUrl });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-message-timeline").waitFor({ state: "visible" });
    await page.getByTestId("inbox-conversation-row").first().waitFor({ state: "visible" });

    const selected = await selectConversationWithActions(page);
    if (!selected) {
      throw new Error("message actions smoke needs one conversation with visible message bubbles");
    }

    const bubble = page.locator('[data-testid="inbox-message-bubble"]').first();
    await bubble.hover();
    await bubble.locator('[data-testid="message-actions-toolbar"]').waitFor({
      state: "visible",
      timeout: 10_000,
    });

    await bubble.locator('[data-testid="message-action-copy"]').click();
    await page.waitForFunction(() =>
      Boolean(document.querySelector('[data-testid="message-action-copy"][data-active="true"]')),
    );
    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    if (!copiedText.trim()) {
      throw new Error("copy action did not write non-empty text to clipboard");
    }

    await bubble.locator('[data-testid="message-action-reply"]').click();
    const draft = page.getByTestId("composer-action-draft");
    await draft.waitFor({ state: "visible", timeout: 10_000 });
    const replyKind = await draft.getAttribute("data-action-kind");
    if (replyKind !== "reply") {
      throw new Error(`reply action did not prepare reply draft: ${replyKind}`);
    }

    const textarea = page.getByTestId("composer-textarea");
    await textarea.fill("Resposta visual smoke V2.9.9");
    if ((await textarea.inputValue()).trim().length === 0) {
      throw new Error("reply draft did not keep composer editable");
    }

    await bubble.locator('[data-testid="message-action-forward"]').click();
    const forwardKind = await draft.getAttribute("data-action-kind");
    if (forwardKind !== "forward") {
      throw new Error(`forward action did not prepare forward draft: ${forwardKind}`);
    }
    const forwardText = await textarea.inputValue();
    if (!forwardText.trim()) {
      throw new Error("forward action did not preload composer text");
    }

    const diagnostics = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid="message-actions-toolbar"]');
      const draft = document.querySelector('[data-testid="composer-action-draft"]');
      const textarea = document.querySelector('[data-testid="composer-textarea"]');
      return {
        buttons: toolbar?.querySelectorAll("button").length ?? 0,
        draftKind: draft?.getAttribute("data-action-kind") ?? null,
        textareaLength: textarea instanceof HTMLTextAreaElement ? textarea.value.length : 0,
      };
    });
    if (diagnostics.buttons !== 3 || diagnostics.draftKind !== "forward" || diagnostics.textareaLength === 0) {
      throw new Error(`message actions diagnostics failed: ${JSON.stringify(diagnostics)}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v29-message-actions|buttons=${diagnostics.buttons}|draft=${diagnostics.draftKind}|text=${diagnostics.textareaLength}|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `message actions has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function selectConversationWithActions(page) {
  const rows = page.getByTestId("inbox-conversation-row");
  const count = Math.min(await rows.count(), 10);
  for (let index = 0; index < count; index += 1) {
    await rows.nth(index).click();
    await page.waitForTimeout(300);
    const actions = await page.locator('[data-testid="message-actions-toolbar"]').count();
    if (actions > 0) {
      return true;
    }
  }
  return false;
}

async function assertHttp(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ready: ${response.status} ${url}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
