import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v25-metrics-m3.png";
const mobileScreenshotPath = process.env.MOBILE_SCREENSHOT_PATH ?? "data/v25-metrics-m3-mobile.png";

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

    await page.goto(`${webUrl}/`, { waitUntil: "networkidle" });
    await assertOperationalMetricsPanel(page, {
      label: "desktop",
      minWidth: 900,
      minHeight: 140,
      maxHorizontalOverflowPx: 2,
    });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const desktopA11y = await analyzeA11y(page, "desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webUrl}/`, { waitUntil: "networkidle" });
    await assertOperationalMetricsPanel(page, {
      label: "mobile",
      minWidth: 320,
      minHeight: 240,
      maxHorizontalOverflowPx: 2,
    });
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
    const mobileA11y = await analyzeA11y(page, "mobile");

    const blocking = [...desktopA11y.blocking, ...mobileA11y.blocking];
    console.log(
      [
        "v25-metrics",
        `desktopViolations=${desktopA11y.violations.length}`,
        `mobileViolations=${mobileA11y.violations.length}`,
        `blocking=${blocking.length}`,
        `desktop=${screenshotPath}`,
        `mobile=${mobileScreenshotPath}`,
      ].join("|"),
    );
    if (blocking.length > 0) {
      throw new Error(
        `dashboard metrics has blocking a11y violations: ${blocking
          .map((violation) => `${violation.viewport}:${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function assertOperationalMetricsPanel(
  page,
  { label, minWidth, minHeight, maxHorizontalOverflowPx },
) {
  const panel = page.getByTestId("operational-metrics-panel");
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  await panel.getByText("Métricas operacionais").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await panel.getByText("Throughput", { exact: true }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await panel.getByText("Falha", { exact: true }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await panel.getByText("Espera média", { exact: true }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await panel.getByText("Execução média", { exact: true }).waitFor({
    state: "visible",
    timeout: 10_000,
  });

  const box = await panel.boundingBox();
  if (!box || box.width < minWidth || box.height < minHeight) {
    throw new Error(`${label} operational metrics panel is visually collapsed`);
  }

  const horizontalOverflowPx = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Math.max(0, -rect.left, rect.right - window.innerWidth);
  });
  if (horizontalOverflowPx > maxHorizontalOverflowPx) {
    throw new Error(
      `${label} operational metrics panel overflows horizontally by ${horizontalOverflowPx}px`,
    );
  }
}

async function analyzeA11y(page, viewport) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({ ...violation, viewport }));
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
