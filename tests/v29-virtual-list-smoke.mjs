import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-virtual-list-m2.png";

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
    const virtualScroll = page.getByTestId("inbox-conversation-virtual-scroll");
    await virtualScroll.waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("inbox-conversation-virtual-spacer").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const diagnostics = await virtualScroll.evaluate((element) => {
      const rows = element.querySelectorAll('[data-testid="inbox-conversation-row"]');
      const totalCount = Number(element.getAttribute("data-total-count") ?? "0");
      const visibleCount = Number(element.getAttribute("data-visible-count") ?? "0");
      const indices = Array.from(rows).map((row) =>
        Number(row.getAttribute("data-virtual-index") ?? "-1"),
      );
      return {
        virtualized: element.getAttribute("data-virtualized"),
        totalCount,
        visibleCount,
        renderedRows: rows.length,
        minIndex: indices.length ? Math.min(...indices) : null,
        maxIndex: indices.length ? Math.max(...indices) : null,
      };
    });

    if (diagnostics.virtualized !== "true") {
      throw new Error("conversation list did not expose virtualized=true");
    }
    if (diagnostics.totalCount <= 0) {
      throw new Error("virtualized conversation list needs at least one conversation in the smoke DB");
    }
    if (diagnostics.renderedRows <= 0) {
      throw new Error("virtualized conversation list rendered no visible rows");
    }
    if (diagnostics.renderedRows !== diagnostics.visibleCount) {
      throw new Error(
        `virtualized row count mismatch: rendered=${diagnostics.renderedRows} visible=${diagnostics.visibleCount}`,
      );
    }
    if (diagnostics.minIndex !== 0) {
      throw new Error(`virtualized list should start at index 0, got ${diagnostics.minIndex}`);
    }

    const hoverTargetCount = Math.min(6, diagnostics.renderedRows);
    for (let index = 0; index < hoverTargetCount; index += 1) {
      await page.getByTestId("inbox-conversation-row").nth(index).hover();
    }
    const hoverDiagnostics = await virtualScroll.evaluate((element) => {
      const rows = Array.from(element.querySelectorAll('[data-testid="inbox-conversation-row"]'))
        .slice(0, 8)
        .map((row) => {
          const rect = row.getBoundingClientRect();
          return {
            index: Number(row.getAttribute("data-virtual-index") ?? "-1"),
            top: Math.round(rect.top),
            height: Math.round(rect.height),
          };
        });
      const gaps = rows.slice(1).map((row, index) => row.top - rows[index].top);
      return {
        rows,
        minGap: gaps.length ? Math.min(...gaps) : null,
      };
    });
    if (hoverDiagnostics.rows.length > 1 && (hoverDiagnostics.minGap ?? 0) < 40) {
      throw new Error(
        `conversation rows collapsed on hover: ${JSON.stringify(hoverDiagnostics.rows)}`,
      );
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v29-virtual-list|total=${diagnostics.totalCount}|rendered=${diagnostics.renderedRows}|range=${diagnostics.minIndex}-${diagnostics.maxIndex}|hoverMinGap=${hoverDiagnostics.minGap}|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `inbox virtual list has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
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
