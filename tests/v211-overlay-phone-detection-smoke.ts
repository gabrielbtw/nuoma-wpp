import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  NUOMA_OVERLAY_FAB_TEST_ID,
  NUOMA_OVERLAY_PANEL_TEST_ID,
  NUOMA_OVERLAY_ROOT_ID,
  createNuomaOverlayScript,
  type NuomaOverlayData,
} from "../apps/worker/src/features/overlay/inject.js";

const fixtureScreenshotPath =
  process.env.FIXTURE_SCREENSHOT_PATH ?? "data/v211-overlay-phone-m34-fixture.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v211-overlay-phone-m34-wpp.png";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const canaryPhone = "5531982066263";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");

async function main() {
  await fs.mkdir(path.dirname(fixtureScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const sendJobsBefore = await countActiveSendJobs();
  const fixtureResult = await validateFixture();
  const wppResult = await validateWhatsAppWeb();
  const sendJobsAfter = await countActiveSendJobs();
  const sendJobsDelta = sendJobsAfter - sendJobsBefore;

  if (sendJobsDelta !== 0) {
    throw new Error(
      `overlay phone smoke changed active send jobs: before=${sendJobsBefore} after=${sendJobsAfter}`,
    );
  }

  console.log(
    [
      "v211-overlay-phone",
      `fixturePhone=${fixtureResult.phone}`,
      `fixtureSource=${fixtureResult.phoneSource}`,
      `fixturePanel=${Number(fixtureResult.panelVisible)}`,
      `fixtureBlocking=${fixtureResult.blocking}`,
      `wppPhone=${wppResult.phone}`,
      `wppSource=${wppResult.phoneSource}`,
      `wppPanel=${Number(wppResult.panelVisible)}`,
      `sendJobsDelta=${sendJobsDelta}`,
      `fixture=${fixtureScreenshotPath}`,
      `wpp=${wppScreenshotPath}`,
      `wppMode=${wppResult.mode}`,
      "ig=nao_aplicavel",
      "m=34",
    ].join("|"),
  );
}

async function validateFixture() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.setContent(savedContactFixture(), { waitUntil: "domcontentloaded" });
    await page.evaluate(createNuomaOverlayScript());
    const state = await readOverlayState(page);
    assertDetectedPhone(state, "fixture");
    await hydrateAndOpenPanel(page, state, "Fixture M34");
    const panel = await readPanelState(page);
    assertPanel(panel, "fixture");
    await page.screenshot({ path: fixtureScreenshotPath, fullPage: false });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `overlay phone fixture has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
    return { ...state, ...panel, blocking: blocking.length };
  } finally {
    await browser.close();
  }
}

async function validateWhatsAppWeb() {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    let page = context.pages().find((candidate) => candidate.url().startsWith(whatsappUrl));
    page ??= context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 1366, height: 768 });

    if (!page.url().startsWith(whatsappUrl)) {
      await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }

    let state = await injectAndReadWhatsAppOverlay(page);
    if (!state.mounted || state.phone !== canaryPhone) {
      const targetUrl = `${whatsappUrl.replace(/\/$/, "")}/send?phone=${encodeURIComponent(canaryPhone)}`;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(7_000);
      state = await injectAndReadWhatsAppOverlay(page);
    }

    assertDetectedPhone(state, "wpp");
    await hydrateAndOpenPanel(page, state, "WhatsApp Web M34");
    const panel = await readPanelState(page);
    assertPanel(panel, "wpp");
    await page.screenshot({ path: wppScreenshotPath, fullPage: false, timeout: 15_000 });
    return { ...state, ...panel, mode: "cdp" };
  } finally {
    await browser.close();
  }
}

async function injectAndReadWhatsAppOverlay(page: Page) {
  await page.evaluate((rootId) => {
    document.getElementById(rootId)?.remove();
    delete (window as unknown as { __nuomaOverlayState?: unknown }).__nuomaOverlayState;
    delete (window as unknown as { __nuomaOverlayInstalled?: unknown }).__nuomaOverlayInstalled;
    delete (window as unknown as { __nuomaOverlayRefresh?: unknown }).__nuomaOverlayRefresh;
    delete (window as unknown as { __nuomaOverlaySetData?: unknown }).__nuomaOverlaySetData;
    delete (window as unknown as { __nuomaOverlayRefreshFromApi?: unknown }).__nuomaOverlayRefreshFromApi;
    delete (window as unknown as { __nuomaApi?: unknown }).__nuomaApi;
    delete (window as unknown as { __nuomaApiResolve?: unknown }).__nuomaApiResolve;
  }, NUOMA_OVERLAY_ROOT_ID);
  await page.evaluate(createNuomaOverlayScript());
  await page.waitForTimeout(700);
  return readOverlayState(page);
}

async function hydrateAndOpenPanel(page: Page, state: OverlayState, label: string) {
  const data: NuomaOverlayData = {
    phone: state.phone,
    phoneSource: state.phoneSource,
    title: state.title,
    contact: {
      name: label,
      status: "lead",
      primaryChannel: "whatsapp",
      notes: "Telefone detectado pelo observer M34.",
    },
    conversations: [
      {
        id: 3401,
        channel: "whatsapp",
        lastPreview: "Deteccao de telefone ativa",
        lastMessageAt: new Date().toISOString(),
      },
    ],
    latestMessages: [
      {
        body: "Contato salvo sem numero no titulo.",
        direction: "inbound",
        contentType: "text",
        observedAtUtc: new Date().toISOString(),
      },
    ],
    automations: [{ id: 34, name: "Overlay phone detection", category: "Embed", status: "active" }],
    notes: "Telefone detectado pelo observer M34.",
    source: "smoke",
  };
  await page.evaluate(
    ({ rootId, fabTestId, data: overlayData }) => {
      const host = document.getElementById(rootId);
      host?.setAttribute("data-nuoma-state", "open");
      host?.shadowRoot
        ?.querySelector<HTMLButtonElement>(`[data-testid="${fabTestId}"]`)
        ?.setAttribute("aria-expanded", "true");
      (
        window as unknown as {
          __nuomaOverlaySetData: (value: unknown) => unknown;
        }
      ).__nuomaOverlaySetData(overlayData);
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID, fabTestId: NUOMA_OVERLAY_FAB_TEST_ID, data },
  );
  await page.waitForTimeout(400);
}

async function readOverlayState(page: Page): Promise<OverlayState> {
  return page.evaluate(
    ({ rootId }) => {
      const refreshState =
        typeof (
          window as unknown as {
            __nuomaOverlayRefresh?: () => unknown;
          }
        ).__nuomaOverlayRefresh === "function"
          ? (window as unknown as { __nuomaOverlayRefresh: () => unknown }).__nuomaOverlayRefresh()
          : {};
      const state = refreshState as {
        mounted?: unknown;
        reason?: unknown;
        phone?: unknown;
        phoneSource?: unknown;
        title?: unknown;
      };
      const host = document.getElementById(rootId);
      return {
        mounted: Boolean(state.mounted),
        reason: typeof state.reason === "string" ? state.reason : null,
        phone: typeof state.phone === "string" ? state.phone : "",
        phoneSource: typeof state.phoneSource === "string" ? state.phoneSource : "",
        title: typeof state.title === "string" ? state.title : "",
        hostPhone: host?.getAttribute("data-nuoma-thread-phone") ?? "",
        hostPhoneSource: host?.getAttribute("data-nuoma-phone-source") ?? "",
      };
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID },
  );
}

async function readPanelState(page: Page) {
  return page.evaluate(
    ({ rootId, panelTestId }) => {
      const host = document.getElementById(rootId);
      const panel = host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`);
      const text = panel?.textContent ?? "";
      const rect = panel?.getBoundingClientRect();
      return {
        panelVisible: Boolean(panel && rect && rect.width > 300 && rect.height > 300),
        hasPhone: text.includes("+5531982066263"),
        hasDetector: text.includes("Detector") && text.includes("message-data-id"),
        hasSummary: text.includes("Resumo") && text.includes("Overlay phone detection"),
        text,
      };
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
  );
}

function assertDetectedPhone(state: OverlayState, label: string) {
  if (!state.mounted) {
    throw new Error(`${label} overlay did not mount: ${state.reason ?? "unknown"}`);
  }
  if (state.phone !== canaryPhone || state.hostPhone !== canaryPhone) {
    throw new Error(`${label} overlay phone mismatch: ${JSON.stringify(state)}`);
  }
  if (!["message-data-id", "url-phone", "sidebar-active", "header-title"].includes(state.phoneSource)) {
    throw new Error(`${label} overlay phone source mismatch: ${JSON.stringify(state)}`);
  }
}

function assertPanel(panel: Awaited<ReturnType<typeof readPanelState>>, label: string) {
  if (!panel.panelVisible || !panel.hasPhone || !panel.hasSummary) {
    throw new Error(`${label} overlay panel did not render detected phone: ${JSON.stringify(panel)}`);
  }
}

async function countActiveSendJobs() {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const row = db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM jobs
          WHERE type IN (
            'send_message',
            'send_instagram_message',
            'send_voice',
            'send_document',
            'campaign_step',
            'chatbot_reply'
          )
          AND status IN ('queued', 'claimed', 'running')
        `,
      )
      .get() as { total: number };
    return row.total;
  } finally {
    db.close();
  }
}

function savedContactFixture() {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <title>V2.11.6 Overlay Phone Fixture</title>
        <style>
          body {
            margin: 0;
            background: #071b18;
            color: #e9fffb;
            font-family: system-ui, sans-serif;
          }
          #app {
            display: grid;
            grid-template-columns: 360px 1fr;
            min-height: 100vh;
          }
          #pane-side {
            border-right: 1px solid rgba(120, 220, 210, 0.24);
            padding: 16px;
          }
          [data-testid="cell-frame-container"] {
            display: grid;
            gap: 4px;
            padding: 12px;
            border-radius: 12px;
            background: rgba(20, 70, 62, 0.72);
          }
          #main header {
            position: relative;
            min-height: 64px;
            display: flex;
            align-items: center;
            padding: 0 24px;
            border-bottom: 1px solid rgba(120, 220, 210, 0.20);
          }
          .messages {
            display: grid;
            gap: 12px;
            padding: 32px;
          }
          [data-id] {
            max-width: 560px;
            padding: 12px 14px;
            border-radius: 14px;
            background: rgba(30, 96, 82, 0.76);
          }
        </style>
      </head>
      <body>
        <main id="app">
          <section id="pane-side" role="list" aria-label="Conversas">
            <div role="listitem" data-nuoma-active-chat="true" data-testid="cell-frame-container">
              <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
              <span title="+55 31 98206-6263">+55 31 98206-6263</span>
            </div>
          </section>
          <section id="main">
            <header><span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span></header>
            <div class="messages">
              <div data-id="false_5531982066263@c.us_M34">
                <span class="selectable-text">Mensagem inbound usada para detectar o telefone.</span>
              </div>
              <div data-id="true_5531982066263@c.us_M34_2">
                <span class="selectable-text">Resposta outbound no mesmo chat salvo.</span>
              </div>
            </div>
          </section>
        </main>
      </body>
    </html>
  `;
}

interface OverlayState {
  mounted: boolean;
  reason: string | null;
  phone: string;
  phoneSource: string;
  title: string;
  hostPhone: string;
  hostPhoneSource: string;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
