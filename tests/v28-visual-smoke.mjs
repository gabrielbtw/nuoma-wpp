import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");

  const browser = await chromium.launch({ headless: true });
  try {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktop = await desktopContext.newPage();
    await desktop.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await screenshotAndAxe(desktop, "login-desktop", "data/v28-smoke-login-desktop.png");
    await desktop.fill("#email", email);
    await desktop.fill("#password", password);
    await desktop.click('button[type="submit"]');
    await desktop.waitForURL(`${webUrl}/`);

    await desktop.goto(`${webUrl}/dev/components`, { waitUntil: "networkidle" });
    await screenshotAndAxe(desktop, "dev-components", "data/v28-smoke-dev-components.png");

    await desktop.goto(`${webUrl}/settings`, { waitUntil: "networkidle" });
    await desktop.getByRole("tab", { name: "Notificações" }).click();
    await screenshotAndAxe(desktop, "settings-notifications", "data/v28-smoke-settings-notifications.png");
    await desktopContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobile = await mobileContext.newPage();
    await mobile.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await mobile.fill("#email", email);
    await mobile.fill("#password", password);
    await mobile.click('button[type="submit"]');
    await mobile.waitForURL(`${webUrl}/`);
    await mobile.getByLabel("Abrir navegação").click();
    await screenshotAndAxe(mobile, "mobile-drawer", "data/v28-smoke-mobile-drawer.png");
    await mobileContext.close();
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

async function screenshotAndAxe(page, label, path) {
  await page.screenshot({ path, fullPage: true });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  console.log(`${label}|violations=${result.violations.length}|blocking=${blocking.length}|${path}`);
  if (blocking.length > 0) {
    throw new Error(
      `${label} has blocking a11y violations: ${blocking
        .map((violation) => `${violation.id}:${violation.impact}`)
        .join(", ")}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
