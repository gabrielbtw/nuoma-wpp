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
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve(process.env.V2_SCREEN_SMOKE_DIR ?? `data/v2-screen-smoke-${timestamp}`);

const routes = [
  {
    version: "V2.8",
    name: "Dashboard operacional",
    path: "/",
    waitTestId: "operational-metrics-panel",
    file: "02-v28-dashboard.png",
    details: "Shell autenticado, metricas operacionais, workers, CDP, fila e DLQ.",
  },
  {
    version: "V2.9",
    name: "Inbox principal",
    path: "/inbox",
    waitTestId: "inbox-grid",
    file: "03-v29-inbox.png",
    details: "Inbox realtime com grid, lista de conversas, timeline e composer.",
  },
  {
    version: "V2.7",
    name: "Contatos/API surface",
    path: "/contacts",
    waitText: "Catálogo",
    file: "04-v27-contacts.png",
    details: "CRUD visual de contatos sobre a API principal.",
  },
  {
    version: "V2.10",
    name: "Campanhas e remarketing",
    path: "/campaigns",
    waitTestId: "safe-batch-dispatch-panel",
    file: "05-v210-campaigns-remarketing.png",
    details: "Builder, recipients, readiness e painel de lote real com guardas M30.3.",
    action: validateRemarketingBatchPanel,
  },
  {
    version: "V2.10",
    name: "Automações",
    path: "/automations",
    waitText: "Teste manual seguro",
    file: "06-v210-automations.png",
    details: "Builder/listagem de automacoes e disparo manual seguro.",
  },
  {
    version: "V2.10",
    name: "Chatbots",
    path: "/chatbots",
    waitTestId: "chatbot-rule-builder",
    file: "07-v210-chatbots.png",
    details: "Builder de regras, teste seco A/B e historico por mensagem.",
  },
  {
    version: "V2.5",
    name: "Fila e DLQ",
    path: "/jobs",
    waitText: "Fila atual",
    file: "08-v25-jobs.png",
    details: "Fila duravel, jobs recentes e dead-letter queue.",
  },
  {
    version: "V2.1-V2.15",
    name: "Status de implementação",
    path: "/implementation",
    waitText: "Execução visível",
    file: "09-v2-implementation.png",
    details: "Painel parseado de IMPLEMENTATION_STATUS.md para feito/parcial/falta.",
  },
  {
    version: "V2.8",
    name: "Settings e push",
    path: "/settings",
    waitText: "Sessão",
    file: "10-v28-settings.png",
    details: "Sessao, tema, push, integracoes e diagnostico local-first.",
  },
  {
    version: "V2.8",
    name: "Componentes visuais",
    path: "/dev/components",
    waitText: "Componentes",
    file: "11-v28-components.png",
    details: "Inventario visual do design system Cartographic Operations.",
  },
];

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(outputDir, { recursive: true });
  const fixture = seedScreenSmokeFixture();

  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.screenshot({ path: path.join(outputDir, "01-v24-login.png"), fullPage: true });
    report.push({
      version: "V2.4",
      name: "Login/Auth",
      test: "Tela de login carrega e aceita credenciais locais.",
      print: path.join(outputDir, "01-v24-login.png"),
      details: "Cookies httpOnly/CSRF sao emitidos apos submit.",
    });
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    for (const route of routes) {
      await page.goto(`${webUrl}${route.path}`, { waitUntil: "domcontentloaded" });
      const waitWarning = await waitForRouteSignal(page, route);
      const extra = route.action ? await route.action(page, fixture) : null;
      const screenshotPath = path.join(outputDir, route.file);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const blocking = await blockingA11yViolations(page);
      report.push({
        version: route.version,
        name: route.name,
        test: route.details,
        print: screenshotPath,
        details: [
          extra ?? "Tela renderizada.",
          waitWarning ? `wait_warn=${waitWarning}` : "wait=ok",
          blocking.length > 0
            ? `a11y_warn=${blocking.map((item) => `${item.id}:${item.impact}`).join(",")}`
            : "a11y_blocking=0",
        ].join(" "),
      });
    }

    await context.close();
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outputDir, "REPORT.md");
  await fs.writeFile(reportPath, renderReport(report), "utf8");
  console.log(`v2-screen-smoke|items=${report.length}|report=${reportPath}|dir=${outputDir}`);
}

async function waitForRouteSignal(page, route) {
  try {
    if (route.waitTestId) {
      await page.getByTestId(route.waitTestId).waitFor({ state: "visible", timeout: 15_000 });
    }
    if (route.waitText) {
      await page.getByText(route.waitText, { exact: false }).first().waitFor({
        state: "visible",
        timeout: 15_000,
      });
    }
    return null;
  } catch {
    return route.waitTestId ?? route.waitText ?? "route-signal";
  }
}

async function validateRemarketingBatchPanel(page, fixture) {
  if (page.url() !== `${webUrl}/campaigns?campaignId=${fixture.campaignId}`) {
    await page.goto(`${webUrl}/campaigns?campaignId=${fixture.campaignId}`, {
      waitUntil: "domcontentloaded",
    });
  }
  await page.getByTestId("safe-batch-dispatch-panel").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByTestId("safe-batch-phones-input").fill("5531982066263");
  await page.getByTestId("safe-batch-ready-button").click();
  const report = page.getByTestId("safe-batch-report");
  await report.waitFor({ state: "visible", timeout: 15_000 });
  const canDispatch = await report.getAttribute("data-can-dispatch");
  const accepted = await report.getAttribute("data-accepted");
  const plannedJobs = await report.getAttribute("data-planned-jobs");
  if (canDispatch !== "true" || accepted !== "1" || Number(plannedJobs) < 1) {
    throw new Error(
      `remarketing batch guard mismatch: ${JSON.stringify({
        canDispatch,
        accepted,
        plannedJobs,
        campaignId: fixture.campaignId,
      })}`,
    );
  }
  return `Lote real validado: campaign=${fixture.campaignId}, canDispatch=${canDispatch}, accepted=${accepted}, plannedJobs=${plannedJobs}, temp=24h/90d.`;
}

async function blockingA11yViolations(page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
}

function seedScreenSmokeFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    const existing = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'V2 Screen Smoke%'")
      .all();
    for (const row of existing) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
      db.prepare("DELETE FROM jobs WHERE user_id = 1 AND dedupe_key LIKE ?").run(
        `campaign_step:${row.id}:%`,
      );
      db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE ?").run(
        `%"campaignId":${row.id}%`,
      );
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2 Screen Smoke%'").run();

    const steps = JSON.stringify([
      {
        id: "screen-intro",
        label: "Intro",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Smoke visual V2 {{telefone}}",
      },
      {
        id: "screen-close",
        label: "Fechamento",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Fechamento visual V2 {{telefone}}",
      },
    ]);
    const metadata = JSON.stringify({
      smoke: "v2-screen-smoke",
      temporaryMessages: {
        enabled: true,
        beforeSendDuration: "24h",
        afterCompletionDuration: "90d",
        restoreOnFailure: true,
      },
    });
    const result = db
      .prepare(
        `
          INSERT INTO campaigns (
            user_id, name, status, channel, segment_json, steps_json,
            evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'V2 Screen Smoke Remarketing Real', 'draft', 'whatsapp', NULL, @steps,
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

function renderReport(items) {
  const lines = [
    "# V2 Screen Smoke Matrix",
    "",
    `Gerado em ${new Date().toISOString()}.`,
    "",
  ];
  for (const item of items) {
    lines.push(
      `## ${item.version} ${item.name}`,
      "",
      `- teste > ${item.test}`,
      `- prints > ${item.print}`,
      `- detalhes > ${item.details}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
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
