import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const storageKey = "nuoma:v214a-visual";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve(process.env.V214A_VISUAL_DIR ?? `data/v214a-visual-${timestamp}`);

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    results.push(
      await runDesktopToggleSmoke(browser, {
        name: "desktop",
        viewport: { width: 1440, height: 920 },
        screenshot: path.join(outputDir, "01-v214a-dashboard-desktop.png"),
      }),
    );
    results.push(
      await runEnabledSmoke(browser, {
        name: "mobile",
        viewport: { width: 390, height: 844 },
        screenshot: path.join(outputDir, "02-v214a-dashboard-mobile.png"),
      }),
    );
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outputDir, "REPORT.md");
  await fs.writeFile(reportPath, renderReport(results), "utf8");
  console.log(
    [
      "v214a-visual",
      `desktop=${results[0].status}`,
      `mobile=${results[1].status}`,
      `desktop_nonblank=${results[0].canvas.nonBlank}`,
      `mobile_nonblank=${results[1].canvas.nonBlank}`,
      `report=${reportPath}`,
    ].join("|"),
  );
}

async function runDesktopToggleSmoke(browser, target) {
  const context = await browser.newContext({ viewport: target.viewport });
  try {
    const page = await context.newPage();
    await login(page);
    await page.goto(`${webUrl}/settings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Aparência" }).click();
    await page.getByTestId("v214a-visual-settings-card").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.evaluate((key) => window.localStorage.setItem(key, "disabled"), storageKey);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Aparência" }).click();
    await page.getByTestId("v214a-visual-toggle").click();
    await expectStorageEnabled(page);
    await page.goto(`${webUrl}/`, { waitUntil: "domcontentloaded" });
    return await validateHero(page, target);
  } finally {
    await context.close();
  }
}

async function runEnabledSmoke(browser, target) {
  const context = await browser.newContext({ viewport: target.viewport });
  await context.addInitScript((key) => {
    window.localStorage.setItem(key, "enabled");
  }, storageKey);
  try {
    const page = await context.newPage();
    await login(page);
    return await validateHero(page, target);
  } finally {
    await context.close();
  }
}

async function login(page) {
  await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${webUrl}/`);
}

async function expectStorageEnabled(page) {
  const value = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  if (value !== "enabled") {
    throw new Error(`V2.14a visual toggle did not persist enabled state: ${value}`);
  }
}

async function validateHero(page, target) {
  const hero = page.getByTestId("v214a-cartographic-hero");
  await hero.waitFor({ state: "visible", timeout: 20_000 });
  await page.locator('[data-testid="v214a-cartographic-canvas"] canvas').waitFor({
    state: "visible",
    timeout: 20_000,
  });
  const status = await hero.getAttribute("data-status");
  if (!status) {
    throw new Error(`V2.14a hero missing operational status on ${target.name}`);
  }

  await page.waitForTimeout(500);
  const before = await canvasStats(page);
  await page.mouse.move(Math.round(target.viewport.width * 0.74), Math.round(target.viewport.height * 0.28));
  await page.waitForTimeout(750);
  const after = await canvasStats(page);

  if (!before.nonBlank || !after.nonBlank) {
    throw new Error(`V2.14a canvas blank on ${target.name}: ${JSON.stringify({ before, after })}`);
  }
  if (before.width < 300 || before.height < 170) {
    throw new Error(`V2.14a canvas collapsed on ${target.name}: ${JSON.stringify(before)}`);
  }
  if (before.checksum === after.checksum) {
    throw new Error(`V2.14a canvas did not move on ${target.name}: ${JSON.stringify({ before, after })}`);
  }

  await page.screenshot({ path: target.screenshot, fullPage: true });
  const blocking = await blockingA11yViolations(page);
  if (blocking.length > 0) {
    throw new Error(
      `V2.14a visual has blocking a11y violations on ${target.name}: ${blocking
        .map((violation) => `${violation.id}:${violation.impact}`)
        .join(", ")}`,
    );
  }

  return {
    name: target.name,
    status,
    screenshot: target.screenshot,
    canvas: {
      width: before.width,
      height: before.height,
      nonBlank: before.nonBlank && after.nonBlank,
      movementDelta: Math.abs(after.checksum - before.checksum),
      variance: Math.round(before.variance),
    },
  };
}

async function canvasStats(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="v214a-cartographic-canvas"] canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("V2.14a canvas element not found");
    }
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
      throw new Error("V2.14a WebGL context unavailable");
    }
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const stepX = Math.max(1, Math.floor(width / 96));
    const stepY = Math.max(1, Math.floor(height / 56));
    let samples = 0;
    let bright = 0;
    let sum = 0;
    let sumSq = 0;
    let checksum = 0;
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const index = (y * width + x) * 4;
        const value = pixels[index] + pixels[index + 1] + pixels[index + 2];
        if (value > 48) bright += 1;
        sum += value;
        sumSq += value * value;
        checksum = (checksum + value * ((x + 3) * 17 + (y + 5) * 31)) % 1_000_000_007;
        samples += 1;
      }
    }
    const mean = sum / Math.max(1, samples);
    const variance = sumSq / Math.max(1, samples) - mean * mean;
    return {
      width,
      height,
      samples,
      bright,
      variance,
      checksum,
      nonBlank: bright > 80 && variance > 8,
    };
  });
}

async function blockingA11yViolations(page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
}

async function assertHttp(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ready: ${response.status} ${url}`);
  }
}

function renderReport(results) {
  return [
    "# V2.14a Visual Opcional Smoke",
    "",
    ...results.flatMap((result) => [
      `## ${result.name}`,
      "",
      "- teste > Toggle/persistência do visual opcional e hero cartográfico R3F no dashboard.",
      `- prints > ${result.screenshot}`,
      `- detalhes > status=${result.status} canvas=${result.canvas.width}x${result.canvas.height} nonblank=${result.canvas.nonBlank} movement_delta=${result.canvas.movementDelta} variance=${result.canvas.variance} a11y_blocking=0`,
      "",
    ]),
  ].join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
