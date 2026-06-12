import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v210-campaign-builder-mobile.png";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const page = await context.newPage();

    await login(page);
    await page.goto(`${webUrl}/campaigns/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("campaign-builder").waitFor({ state: "visible", timeout: 10_000 });
    await page
      .getByTestId("builder-small-screen-notice")
      .waitFor({ state: "visible", timeout: 10_000 });

    const diagnostics = await assertCampaignBuilderMobileNotice(page);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const a11y = await analyzeA11y(page);
    if (a11y.blocking.length > 0) {
      throw new Error(
        `campaign builder mobile has blocking a11y violations: ${a11y.blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    console.log(
      [
        "v210-campaign-builder-mobile",
        `smallScreenNotice=${diagnostics.noticeVisible ? "true" : "false"}`,
        `bodyHidden=${diagnostics.bodyHidden ? "true" : "false"}`,
        `documentOverflowPx=${diagnostics.documentOverflowPx}`,
        `a11yViolations=${a11y.violations.length}`,
        `blocking=${a11y.blocking.length}`,
        `screenshot=${screenshotPath}`,
      ].join("|"),
    );

    await context.close();
  } finally {
    await browser.close();
  }
}

async function login(page) {
  await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${webUrl}/`, { timeout: 10_000 });
}

async function assertCampaignBuilderMobileNotice(page) {
  const diagnostics = await page.evaluate(() => {
    const rectData = (element) => {
      const rect = element?.getBoundingClientRect();
      if (!rect) return null;
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const shell = document.querySelector('[data-testid="campaign-builder"]');
    const body = document.querySelector(".nwfb-body");
    const notice = document.querySelector('[data-testid="builder-small-screen-notice"]');
    const noticeStyle = notice ? getComputedStyle(notice) : null;
    const bodyStyle = body ? getComputedStyle(body) : null;

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      documentOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      shell: rectData(shell),
      notice: rectData(notice),
      body: rectData(body),
      noticeVisible: Boolean(notice && noticeStyle && noticeStyle.display !== "none"),
      bodyHidden: Boolean(body && bodyStyle && bodyStyle.display === "none"),
      text: notice?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });

  if (!diagnostics.shell || diagnostics.shell.width < 320 || diagnostics.shell.height < 640) {
    throw new Error(`mobile flow shell collapsed: ${JSON.stringify(diagnostics)}`);
  }
  if (!diagnostics.noticeVisible || !diagnostics.notice || diagnostics.notice.height < 160) {
    throw new Error(`mobile builder notice is not visible: ${JSON.stringify(diagnostics)}`);
  }
  if (!diagnostics.bodyHidden) {
    throw new Error(
      `mobile builder body should be hidden under 900px: ${JSON.stringify(diagnostics)}`,
    );
  }
  if (!diagnostics.text.includes("tela maior")) {
    throw new Error(`mobile builder notice copy mismatch: ${JSON.stringify(diagnostics)}`);
  }
  if (diagnostics.documentOverflowPx > 8) {
    throw new Error(`mobile page leaks horizontal overflow: ${JSON.stringify(diagnostics)}`);
  }

  return diagnostics;
}

async function analyzeA11y(page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  return { violations: result.violations, blocking };
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
