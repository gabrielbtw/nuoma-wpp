import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-inbox-m0.png";

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
    await page.getByTestId("inbox-realtime-header").waitFor({ state: "visible" });
    await page.getByText("Tempo real ativo").waitFor({ state: "visible", timeout: 10_000 });

    const list = page.getByTestId("inbox-conversation-list");
    const timeline = page.getByTestId("inbox-message-timeline");
    const sidebar = page.getByTestId("inbox-contact-sidebar");
    await list.waitFor({ state: "visible" });
    await timeline.waitFor({ state: "visible" });
    await sidebar.waitFor({ state: "visible" });

    const [listBox, timelineBox, sidebarBox] = await Promise.all([
      list.boundingBox(),
      timeline.boundingBox(),
      sidebar.boundingBox(),
    ]);
    if (!listBox || !timelineBox || !sidebarBox) {
      throw new Error("inbox columns did not render measurable boxes");
    }
    if (!(listBox.x < timelineBox.x && timelineBox.x < sidebarBox.x)) {
      throw new Error("inbox columns are not ordered as list | timeline | sidebar");
    }
    if (Math.min(listBox.height, timelineBox.height, sidebarBox.height) < 520) {
      throw new Error("inbox columns are too short for the desktop workspace");
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v29-inbox|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `inbox has blocking a11y violations: ${blocking
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
