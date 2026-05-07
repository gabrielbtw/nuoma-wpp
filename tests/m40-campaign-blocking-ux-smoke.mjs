import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve(process.env.M40_CAMPAIGN_BLOCKING_UX_DIR ?? `data/m40-campaign-blocking-ux-${stamp}`);
const campaignScreenshot = path.join(outputDir, "01-campaign-blocked.png");
const reportPath = path.join(outputDir, "REPORT.md");

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(outputDir, { recursive: true });
  const fixture = seedFixture();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/campaigns?campaignId=${fixture.campaignId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("safe-batch-dispatch-panel").waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.getByTestId("safe-batch-phones-input").fill("5531999999999\nabc");
    await page.getByTestId("safe-batch-ready-button").click();

    const blockingPanel = page.getByTestId("safe-batch-blocking-ux");
    await blockingPanel.waitFor({ state: "visible", timeout: 15_000 });
    const diagnostics = await blockingPanel.evaluate((element) => ({
      status: element.getAttribute("data-status"),
      errors: Number(element.getAttribute("data-errors") ?? "0"),
      rejected: Number(element.getAttribute("data-rejected") ?? "0"),
      text: element.textContent ?? "",
      rejectedReasons: Array.from(element.querySelectorAll('[data-testid="campaign-rejected-reason"]')).map(
        (node) => ({
          reason: node.getAttribute("data-reason"),
          count: Number(node.getAttribute("data-count") ?? "0"),
          text: node.textContent ?? "",
        }),
      ),
    }));
    if (diagnostics.status !== "blocked" || diagnostics.errors < 2 || diagnostics.rejected < 2) {
      throw new Error(`M40 blocking summary mismatch: ${JSON.stringify(diagnostics)}`);
    }
    if (!diagnostics.text.includes("Corrija todos os rejeitados")) {
      throw new Error(`M40 next action missing: ${diagnostics.text}`);
    }
    if (!diagnostics.text.includes("Configure temporaryMessages")) {
      throw new Error(`M40 temporary messages guidance missing: ${diagnostics.text}`);
    }
    if (
      !diagnostics.rejectedReasons.some((item) => item.reason === "not_allowlisted_for_test_execution") ||
      !diagnostics.rejectedReasons.some((item) => item.reason === "invalid_phone")
    ) {
      throw new Error(`M40 rejected reason grouping mismatch: ${JSON.stringify(diagnostics.rejectedReasons)}`);
    }

    const disabledReason = await page.getByTestId("safe-batch-disabled-reason").textContent();
    if (!disabledReason?.includes("Lote travado")) {
      throw new Error(`M40 disabled reason missing: ${disabledReason}`);
    }

    await page.screenshot({ path: campaignScreenshot, fullPage: true });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `M40 campaign blocking UX has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await fs.writeFile(
      reportPath,
      [
        "# M40 Campaign Blocking UX Smoke",
        "",
        "- teste > Lote bloqueado mostra resumo M40, próxima ação, motivos agrupados e motivo do botão desabilitado.",
        `- prints > ${campaignScreenshot}`,
        `- detalhes > campaign=${fixture.campaignId} status=${diagnostics.status} errors=${diagnostics.errors} rejected=${diagnostics.rejected} a11y_blocking=0`,
        "",
      ].join("\n"),
      "utf8",
    );
    console.log(
      [
        "m40-campaign-blocking-ux",
        `campaign=${fixture.campaignId}`,
        `status=${diagnostics.status}`,
        `errors=${diagnostics.errors}`,
        `rejected=${diagnostics.rejected}`,
        `report=${reportPath}`,
      ].join("|"),
    );
  } finally {
    await browser.close();
  }
}

function seedFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const existing = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'M40 Blocking UX Smoke%'")
      .all();
    for (const row of existing) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
      db.prepare("DELETE FROM jobs WHERE user_id = 1 AND dedupe_key LIKE ?").run(
        `campaign_step:${row.id}:%`,
      );
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'M40 Blocking UX Smoke%'").run();

    const now = new Date().toISOString();
    const steps = JSON.stringify([
      {
        id: "m40-step-1",
        type: "text",
        label: "Bloqueio UX",
        delaySeconds: 0,
        conditions: [],
        template: "Teste M40 {{telefone}}",
      },
    ]);
    const metadata = JSON.stringify({
      smoke: "m40-campaign-blocking-ux",
    });
    const result = db
      .prepare(
        `
          INSERT INTO campaigns (
            user_id, name, status, channel, segment_json, steps_json,
            evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'M40 Blocking UX Smoke', 'draft', 'whatsapp', NULL, @steps,
            0, NULL, NULL, @metadata, @now, @now
          )
        `,
      )
      .run({ steps, metadata, now });
    return { campaignId: Number(result.lastInsertRowid) };
  } finally {
    db.close();
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
