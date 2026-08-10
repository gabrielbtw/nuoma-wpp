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
const outputDir = path.resolve(
  process.env.V2_SCREEN_SMOKE_DIR ??
    path.join("/tmp", "nuoma-full-audit", "menu-matrix", timestamp),
);

const viewports = [
  { id: "desktop", label: "Desktop 1440x980", width: 1440, height: 980 },
  { id: "mobile", label: "Mobile 390x844", width: 390, height: 844 },
];

const routes = [
  {
    version: "V2.8",
    name: "Dashboard operacional",
    path: "/",
    waitTestId: "dashboard-operational-metrics",
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
    waitText: "Fluxos de saída",
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
    version: "V2.11",
    name: "Operações",
    path: "/operations",
    waitTestId: "operations-health-page",
    file: "08b-v211-operations.png",
    details: "Worker, CDP, fila, readiness e send_audit_events em tela operacional dedicada.",
  },
  {
    version: "V2.1-V2.15",
    name: "Status de implementação",
    path: "/implementation",
    waitText: "Execução visível",
    file: "09-v2-implementation.png",
    details: "Painel parseado do README.md para feito/parcial/falta.",
  },
  {
    version: "M37",
    name: "Evidence Center",
    path: "/evidence",
    waitTestId: "evidence-center-grid",
    file: "10-m37-evidence-center.png",
    details: "Reports, prints e evidence.json navegáveis a partir do diretório data.",
  },
  {
    version: "V2.8",
    name: "Settings e push",
    path: "/settings",
    waitTestId: "settings-page",
    file: "11-v28-settings.png",
    details: "Sessao, tema, push, integracoes e diagnostico local-first.",
  },
  {
    version: "V2.8",
    name: "Componentes visuais",
    path: "/dev/components",
    waitTestId: "dev-components-page",
    file: "12-v28-components.png",
    details: "Inventario visual do design system Carvao & Cobre.",
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
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const runtimeIssues = [];
      page.on("pageerror", (error) => {
        runtimeIssues.push(`pageerror:${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          runtimeIssues.push(`console:${message.text()}`);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 400) {
          runtimeIssues.push(`response:${response.status()}:${response.url()}`);
        }
      });

      await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
      await fillLogin(page);
      const loginPath = path.join(outputDir, `${viewport.id}-01-v24-login.png`);
      await assertNoVisibleAppErrors(page, "Login/Auth");
      await page.screenshot({ path: loginPath, fullPage: true });
      report.push({
        version: "V2.4",
        name: `Login/Auth (${viewport.label})`,
        test: "Tela de login carrega e aceita credenciais locais.",
        print: loginPath,
        details: "Campos renderizados; sessao da matriz autenticada pela API local.",
      });
      await loginViaApi(context);
      await page.goto(`${webUrl}/`, { waitUntil: "domcontentloaded" });

      for (const route of routes) {
        const issueStart = runtimeIssues.length;
        await navigateWithinApp(page, route.path);
        let waitWarning = await waitForRouteSignal(page, route);
        if (await isLoginScreen(page)) {
          await loginViaApi(context);
          await navigateWithinApp(page, route.path);
          waitWarning = await waitForRouteSignal(page, route);
        }
        const extra =
          route.action && viewport.id === "desktop" ? await route.action(page, fixture) : null;
        const screenshotPath = path.join(outputDir, `${viewport.id}-${route.file}`);
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(700);
        await assertNoVisibleAppErrors(page, `${route.name} ${viewport.label}`);
        const blocking = await blockingA11yViolations(page);
        const routeIssues = runtimeIssues.slice(issueStart).filter(isBlockingRuntimeIssue);
        if (routeIssues.length > 0) {
          throw new Error(
            `${route.name} ${viewport.label} emitted runtime issue(s): ${routeIssues.join(" | ")}`,
          );
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        report.push({
          version: route.version,
          name: `${route.name} (${viewport.label})`,
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
    }
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

async function navigateWithinApp(page, targetPath) {
  await page.goto(`${webUrl}${targetPath}`, { waitUntil: "domcontentloaded" });
}

async function assertNoVisibleAppErrors(page, label) {
  const forbiddenTexts = [
    "Algo deu errado",
    "Unable to transform response from server",
    "Internal Server Error",
    "Failed to fetch",
  ];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => "");
    const forbidden = forbiddenTexts.filter((text) => bodyText.includes(text));
    const viteOverlay = await page.locator("vite-error-overlay").count();
    if (forbidden.length === 0 && viteOverlay === 0) return;
    if (attempt === 3) {
      if (viteOverlay > 0) {
        throw new Error(`${label} rendered Vite error overlay`);
      }
      throw new Error(`${label} rendered visible app error(s): ${forbidden.join(", ")}`);
    }
    await page.waitForTimeout(attempt * 5_000);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
}

function isBlockingRuntimeIssue(issue) {
  if (/401 \\(Unauthorized\\)|favicon|ResizeObserver loop/i.test(issue)) return false;
  if (/^response:429:.*\/trpc\/(auth\.me|auth\.refresh|system\.metrics)\b/i.test(issue)) {
    return false;
  }
  if (/^console:Failed to load resource/i.test(issue)) return false;
  if (/Download the React DevTools/i.test(issue)) return false;
  return true;
}

async function fillLogin(page) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
}

async function submitLogin(page) {
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname !== "/login", null, {
    timeout: 30_000,
  });
}

async function loginViaApi(context) {
  let response = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    response = await fetch(`${apiUrl}/trpc/auth.login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { email, password } }),
    });
    if (response.status !== 429) break;
    const retryAfterSeconds = Number(response.headers.get("retry-after") ?? 0);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(retryAfterSeconds * 1000, attempt * 5_000)),
    );
  }
  if (!response.ok) {
    throw new Error(`auth.login failed for screen smoke: ${response.status}`);
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const cookies = setCookies
    .map((item) => item.split(";")[0])
    .map((pair) => {
      const [name, ...rest] = pair.split("=");
      return { name, value: rest.join("="), url: webUrl };
    })
    .filter((cookie) => cookie.name && cookie.value);
  if (cookies.length === 0) {
    throw new Error("auth.login did not return cookies for screen smoke");
  }
  await context.addCookies(cookies);
}

async function isLoginScreen(page) {
  if (new URL(page.url()).pathname === "/login") return true;
  return await page
    .getByRole("heading", { name: "Entrar" })
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

async function validateRemarketingBatchPanel(page, fixture) {
  const targetPath = `/campaigns?campaignId=${fixture.campaignId}`;
  if (`${new URL(page.url()).pathname}${new URL(page.url()).search}` !== targetPath) {
    await page.goto(`${webUrl}${targetPath}`, { waitUntil: "domcontentloaded" });
  }
  await openCampaignDispatchTab(page);
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
  const issueCodes = await page.getByTestId("campaign-blocking-issue").evaluateAll((nodes) =>
    nodes.map((node) => ({
      code: node.getAttribute("data-code"),
      severity: node.getAttribute("data-severity"),
    })),
  );
  const blockingCodes = issueCodes
    .filter((item) => item.severity === "error" && item.code !== "accepted_recipients")
    .map((item) => item.code);
  const onlyExistingRuntimeBlocks =
    canDispatch === "false" &&
    blockingCodes.length > 0 &&
    blockingCodes.every(
      (code) => code === "active_campaign_step_jobs" || code === "active_campaign_recipients",
    );
  if (
    (canDispatch !== "true" && !onlyExistingRuntimeBlocks) ||
    accepted !== "1" ||
    Number(plannedJobs) < 1
  ) {
    throw new Error(
      `remarketing batch guard mismatch: ${JSON.stringify({
        canDispatch,
        accepted,
        plannedJobs,
        issueCodes,
        campaignId: fixture.campaignId,
      })}`,
    );
  }
  return `Lote real validado: campaign=${fixture.campaignId}, canDispatch=${canDispatch}, accepted=${accepted}, plannedJobs=${plannedJobs}, temp=24h/90d${onlyExistingRuntimeBlocks ? `, runtime_block=${blockingCodes.join("+")}` : ""}.`;
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
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(
        row.id,
      );
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
            1, 'V2 Screen Smoke Remarketing Real', 'running', 'whatsapp', NULL, @steps,
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
  const lines = ["# V2 Screen Smoke Matrix", "", `Gerado em ${new Date().toISOString()}.`, ""];
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

async function openCampaignDispatchTab(page) {
  const tab = page.getByRole("tab", { name: /disparo/i });
  await tab.waitFor({ state: "visible", timeout: 15_000 });
  await tab.click();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
