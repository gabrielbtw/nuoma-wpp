import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v25-media-m1.png";

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

    await page.goto(`${webUrl}/implementation`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /execução visível/i }).waitFor({
      state: "visible",
    });
    const mediaCards = page.locator("li").filter({ hasText: "V2.5.23 Media sender base" });
    const mediaCardCount = await mediaCards.count();
    if (mediaCardCount < 1) {
      throw new Error("V2.5.23 implementation card not found");
    }
    const mediaCard = mediaCards.first();
    await mediaCard.waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await mediaCard.getByText("múltiplas imagens por step").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    const rawMarkdown = page.locator("pre").filter({ hasText: "M1.1" });
    await rawMarkdown.waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await rawMarkdown.getByText("M1.2").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const doneColumn = page.getByRole("heading", { name: "Feito" }).locator("..").locator("..");
    const [doneBox, mediaBox] = await Promise.all([
      doneColumn.boundingBox(),
      mediaCard.boundingBox(),
    ]);
    if (!doneBox || !mediaBox) {
      throw new Error("V2.5.23 implementation card did not render measurable boxes");
    }
    if (mediaBox.width < 260 || mediaBox.height < 80) {
      throw new Error("V2.5.23 implementation card is visually collapsed");
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v25-media|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `implementation page has blocking a11y violations: ${blocking
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
