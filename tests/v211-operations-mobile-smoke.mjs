import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v211-operations-mobile.png";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();

    await login(page);
    await page.goto(`${webUrl}/operations`, { waitUntil: "networkidle" });
    await page.getByTestId("operations-health-page").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const diagnostics = await assertOperationsMobile(page);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const a11y = await analyzeA11y(page);
    if (a11y.blocking.length > 0) {
      throw new Error(
        `operations mobile has blocking a11y violations: ${a11y.blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    console.log(
      [
        "v211-operations-mobile",
        `tiles=${diagnostics.tileCount}`,
        `cards=${diagnostics.visibleCardCount}`,
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

async function assertOperationsMobile(page) {
  const requiredTestIds = [
    "operations-summary-grid",
    "operations-workers-card",
    "operations-jobs-card",
    "operations-readiness-card",
    "operations-audit-card",
    "operations-alerts-card",
  ];

  for (const testId of requiredTestIds) {
    await page.getByTestId(testId).waitFor({ state: "visible", timeout: 10_000 });
  }

  const diagnostics = await page.evaluate((testIds) => {
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

    const pageRoot = document.querySelector('[data-testid="operations-health-page"]');
    const summaryGrid = document.querySelector('[data-testid="operations-summary-grid"]');
    const cards = testIds.map((testId) => ({
      testId,
      rect: rectData(document.querySelector(`[data-testid="${testId}"]`)),
    }));
    const cardOverflows = cards.filter(
      (card) => card.rect && (card.rect.left < -2 || card.rect.right > window.innerWidth + 2),
    );
    const tableScroller = document
      .querySelector('[data-testid="operations-jobs-card"]')
      ?.querySelector(".overflow-x-auto");

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      documentOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      pageRoot: rectData(pageRoot),
      summaryGrid: rectData(summaryGrid),
      tileCount: summaryGrid?.children.length ?? 0,
      visibleCardCount: cards.filter(
        (card) => card.rect && card.rect.width > 300 && card.rect.height > 80,
      ).length,
      cardOverflows,
      tableScroller: tableScroller
        ? {
            clientWidth: tableScroller.clientWidth,
            scrollWidth: tableScroller.scrollWidth,
            overflowX: getComputedStyle(tableScroller).overflowX,
            handlesOverflow:
              tableScroller.scrollWidth <= tableScroller.clientWidth + 2 ||
              ["auto", "scroll"].includes(getComputedStyle(tableScroller).overflowX),
          }
        : null,
    };
  }, requiredTestIds);

  if (
    !diagnostics.pageRoot ||
    diagnostics.pageRoot.width < 340 ||
    diagnostics.pageRoot.height < 640
  ) {
    throw new Error(`operations mobile page collapsed: ${JSON.stringify(diagnostics)}`);
  }
  if (
    !diagnostics.summaryGrid ||
    diagnostics.summaryGrid.width < 340 ||
    diagnostics.tileCount !== 4
  ) {
    throw new Error(`operations mobile summary grid collapsed: ${JSON.stringify(diagnostics)}`);
  }
  if (diagnostics.visibleCardCount !== requiredTestIds.length) {
    throw new Error(`operations mobile cards not all visible: ${JSON.stringify(diagnostics)}`);
  }
  if (diagnostics.cardOverflows.length > 0 || diagnostics.documentOverflowPx > 8) {
    throw new Error(`operations mobile leaks horizontal overflow: ${JSON.stringify(diagnostics)}`);
  }
  if (diagnostics.tableScroller && !diagnostics.tableScroller.handlesOverflow) {
    throw new Error(
      `operations mobile jobs table is not internally scrollable: ${JSON.stringify(diagnostics)}`,
    );
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
