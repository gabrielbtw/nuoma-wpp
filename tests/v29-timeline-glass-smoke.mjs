import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-timeline-glass-m5.png";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir("data", { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-message-timeline").waitFor({ state: "visible" });
    await page.getByTestId("inbox-conversation-row").first().waitFor({ state: "visible" });

    const selected = await selectConversationWithBothDirections(page);
    if (!selected) {
      throw new Error("timeline smoke needs one conversation with inbound and outbound bubbles");
    }

    const incoming = page.locator('[data-testid="inbox-message-bubble"][data-direction="inbound"]').first();
    const outgoing = page.locator('[data-testid="inbox-message-bubble"][data-direction="outbound"]').first();
    await incoming.waitFor({ state: "visible", timeout: 10_000 });
    await outgoing.waitFor({ state: "visible", timeout: 10_000 });

    const diagnostics = await page.evaluate(() => {
      const incoming = document.querySelector(
        '[data-testid="inbox-message-bubble"][data-direction="inbound"]',
      );
      const outgoing = document.querySelector(
        '[data-testid="inbox-message-bubble"][data-direction="outbound"]',
      );
      if (!(incoming instanceof HTMLElement) || !(outgoing instanceof HTMLElement)) {
        return null;
      }
      const incomingStyle = getComputedStyle(incoming);
      const outgoingStyle = getComputedStyle(outgoing);
      return {
        incomingBackdrop: incomingStyle.backdropFilter || incomingStyle.webkitBackdropFilter,
        incomingBorderColor: incomingStyle.borderColor,
        outgoingBackground: outgoingStyle.backgroundImage,
        outgoingBoxShadow: outgoingStyle.boxShadow,
        outgoingGradient: outgoing.getAttribute("data-gradient"),
        outgoingMaxWidth: outgoingStyle.maxWidth,
      };
    });

    if (!diagnostics) {
      throw new Error("timeline glass diagnostics did not find bubbles");
    }
    if (!diagnostics.incomingBackdrop.includes("blur")) {
      throw new Error(`incoming bubble is not glass-blurred: ${JSON.stringify(diagnostics)}`);
    }
    if (!diagnostics.outgoingBackground.includes("linear-gradient")) {
      throw new Error(`outgoing bubble did not render gradient: ${JSON.stringify(diagnostics)}`);
    }
    if (diagnostics.outgoingGradient !== "outgoing") {
      throw new Error(`outgoing bubble did not expose gradient marker: ${JSON.stringify(diagnostics)}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v29-timeline-glass|incomingBackdrop=${diagnostics.incomingBackdrop}|outgoingGradient=${diagnostics.outgoingGradient}|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `timeline glass has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function selectConversationWithBothDirections(page) {
  const rows = page.getByTestId("inbox-conversation-row");
  const count = Math.min(await rows.count(), 10);
  for (let index = 0; index < count; index += 1) {
    await rows.nth(index).click();
    await page.waitForTimeout(300);
    const inbound = await page
      .locator('[data-testid="inbox-message-bubble"][data-direction="inbound"]')
      .count();
    const outbound = await page
      .locator('[data-testid="inbox-message-bubble"][data-direction="outbound"]')
      .count();
    if (inbound > 0 && outbound > 0) {
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
