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
    await page.goto(`${webUrl}/campaigns?tab=builder`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("campaign-flow-studio-v2").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    await page.getByTestId("campaign-template-card").first().click();
    await page.getByTestId("campaign-builder-steps").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const diagnostics = await assertCampaignBuilderMobile(page);
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
        `nodes=${diagnostics.visibleNodeCount}`,
        `stageScrollable=${diagnostics.stage?.scrollable ? "true" : "false"}`,
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

async function assertCampaignBuilderMobile(page) {
  await page.getByTestId("campaign-flow-canvas-board").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await page.getByTestId("campaign-xyflow-canvas").waitFor({
    state: "visible",
    timeout: 10_000,
  });

  for (const tab of ["base", "audience", "steps", "preview"]) {
    await page.getByTestId(`campaign-builder-tab-${tab}`).waitFor({
      state: "visible",
      timeout: 5_000,
    });
  }

  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="campaign-xyflow-canvas"] .react-flow__node')
        .length >= 3,
    undefined,
    { timeout: 10_000 },
  );

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

    const studio = document.querySelector('[data-testid="campaign-flow-studio-v2"]');
    const board = document.querySelector('[data-testid="campaign-flow-canvas-board"]');
    const canvas = document.querySelector('[data-testid="campaign-xyflow-canvas"]');
    const stage = canvas?.closest(".nuoma-flow-v2-stage");
    const nodes = Array.from(canvas?.querySelectorAll(".react-flow__node") ?? []).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
    const builderTabs = ["base", "audience", "steps", "preview"].map((tab) => ({
      tab,
      rect: rectData(document.querySelector(`[data-testid="campaign-builder-tab-${tab}"]`)),
    }));

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      documentOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      studio: rectData(studio),
      board: rectData(board),
      canvas: rectData(canvas),
      visibleNodeCount: nodes.filter((node) => node.width > 0 && node.height > 0).length,
      stage: stage
        ? {
            clientWidth: stage.clientWidth,
            scrollWidth: stage.scrollWidth,
            overflowX: getComputedStyle(stage).overflowX,
            scrollable: stage.scrollWidth > stage.clientWidth + 16,
          }
        : null,
      builderTabs,
    };
  });

  if (!diagnostics.studio || diagnostics.studio.width < 320 || diagnostics.studio.height < 640) {
    throw new Error(`mobile flow studio collapsed: ${JSON.stringify(diagnostics)}`);
  }
  if (!diagnostics.board || diagnostics.board.width < 900 || diagnostics.board.height < 500) {
    throw new Error(`mobile canvas board collapsed: ${JSON.stringify(diagnostics)}`);
  }
  if (!diagnostics.canvas || diagnostics.canvas.width < 900 || diagnostics.canvas.height < 420) {
    throw new Error(`mobile react-flow canvas collapsed: ${JSON.stringify(diagnostics)}`);
  }
  if (diagnostics.visibleNodeCount < 3) {
    throw new Error(`mobile canvas rendered too few nodes: ${JSON.stringify(diagnostics)}`);
  }
  if (!diagnostics.stage?.scrollable || !["auto", "scroll"].includes(diagnostics.stage.overflowX)) {
    throw new Error(
      `mobile canvas stage is not internally scrollable: ${JSON.stringify(diagnostics)}`,
    );
  }
  if (diagnostics.documentOverflowPx > 8) {
    throw new Error(`mobile page leaks horizontal overflow: ${JSON.stringify(diagnostics)}`);
  }
  if (
    diagnostics.builderTabs.some((tab) => !tab.rect || tab.rect.width < 120 || tab.rect.height < 48)
  ) {
    throw new Error(`mobile builder tabs are not reachable: ${JSON.stringify(diagnostics)}`);
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
