import AxeBuilder from "@axe-core/playwright";
import { chromium, type CDPSession, type Page } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  NUOMA_OVERLAY_API_BINDING_NAME,
  NUOMA_OVERLAY_FAB_TEST_ID,
  NUOMA_OVERLAY_PANEL_TEST_ID,
  NUOMA_OVERLAY_ROOT_ID,
  createNuomaOverlayScript,
  type NuomaOverlayData,
} from "../apps/worker/src/features/overlay/inject.js";

const fixtureScreenshotPath =
  process.env.FIXTURE_SCREENSHOT_PATH ?? "data/v211-overlay-api-m35-fixture.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v211-overlay-api-m35-wpp.png";
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
      `overlay api smoke changed active send jobs: before=${sendJobsBefore} after=${sendJobsAfter}`,
    );
  }

  console.log(
    [
      "v211-overlay-api",
      `fixtureApi=${fixtureResult.apiStatus}`,
      `fixtureMethod=${fixtureResult.method}`,
      `fixturePanel=${Number(fixtureResult.panelVisible)}`,
      `fixtureBlocking=${fixtureResult.blocking}`,
      `wppApi=${wppResult.apiStatus}`,
      `wppMethod=${wppResult.method}`,
      `wppPanel=${Number(wppResult.panelVisible)}`,
      `wppPhone=${wppResult.phone}`,
      `sendJobsDelta=${sendJobsDelta}`,
      `fixture=${fixtureScreenshotPath}`,
      `wpp=${wppScreenshotPath}`,
      `wppMode=${wppResult.mode}`,
      "ig=nao_aplicavel",
      "m=35",
    ].join("|"),
  );
}

async function validateFixture() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.setContent(savedContactFixture(), { waitUntil: "domcontentloaded" });
	    const bridge = await installApiBinding(page, "Fixture API M35");
    await mountOpenAndWaitForApi(page);
    const panel = await readPanelState(page);
    assertPanel(panel, "fixture");
    if (bridge.requests[0]?.method !== "contactSummary") {
      throw new Error(`fixture bridge did not receive contactSummary: ${JSON.stringify(bridge.requests)}`);
    }
    await page.screenshot({ path: fixtureScreenshotPath, fullPage: false });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `overlay api fixture has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await bridge.cdp.detach().catch(() => undefined);
    await context.close();
    return { ...panel, method: bridge.requests[0]?.method ?? "missing", blocking: blocking.length };
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

	    let bridge = await installApiBinding(page, "WhatsApp Web API M35", {
	      reloadWhenNativeMissing: true,
	    });
    let state = await injectAndReadState(page);
    if (!state.mounted || state.phone !== canaryPhone) {
      const targetUrl = `${whatsappUrl.replace(/\/$/, "")}/send?phone=${encodeURIComponent(canaryPhone)}`;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(7_000);
	      bridge = await installApiBinding(page, "WhatsApp Web API M35", {
	        reloadWhenNativeMissing: true,
	      });
      state = await injectAndReadState(page);
    }
    if (!state.mounted || state.phone !== canaryPhone) {
      throw new Error(`wpp overlay did not detect canary phone: ${JSON.stringify(state)}`);
    }
    await openAndWaitForApi(page);
    const panel = await readPanelState(page);
    assertPanel(panel, "wpp");
    if (!bridge.requests.some((request) => request.method === "contactSummary")) {
      throw new Error(`wpp bridge did not receive contactSummary: ${JSON.stringify(bridge.requests)}`);
    }
    await page.screenshot({ path: wppScreenshotPath, fullPage: false, timeout: 15_000 });
    await bridge.cdp.detach().catch(() => undefined);
    return {
      ...panel,
      phone: state.phone,
      method: bridge.requests.find((request) => request.method === "contactSummary")?.method ?? "missing",
      mode: "cdp-binding",
    };
  } finally {
    await browser.close();
  }
}

	async function installApiBinding(
	  page: Page,
	  label: string,
	  options: { reloadWhenNativeMissing?: boolean } = {},
	) {
	  const cdp = await page.context().newCDPSession(page);
	  const requests: Array<{ id: string; method: string; params: Record<string, unknown> }> = [];
	  await cdp.send("Runtime.enable");
	  cdp.on("Runtime.bindingCalled", (event: { name: string; payload: string }) => {
	    if (event.name !== NUOMA_OVERLAY_API_BINDING_NAME) {
	      return;
	    }
	    void (async () => {
	      const request = JSON.parse(event.payload) as {
	        id: string;
	        method: string;
	        params?: Record<string, unknown>;
	      };
	      requests.push({ id: request.id, method: request.method, params: request.params ?? {} });
	      const response =
	        request.method === "contactSummary"
	          ? {
	              ok: true,
	              data: overlayData(label, request.params ?? {}),
	            }
	          : {
	              ok: true,
	              data: {
	                pong: true,
	                source: "smoke-binding",
	                observedAtUtc: new Date().toISOString(),
	              },
	            };
	      await cdp.send("Runtime.evaluate", {
	        expression: `
	          (() => window.__nuomaApiResolve(
	            ${JSON.stringify(request.id)},
	            ${JSON.stringify(response)}
	          ))()
	        `,
	        awaitPromise: false,
	        returnByValue: true,
	      });
	    })();
	  });
	  await cdp
	    .send("Runtime.evaluate", {
	      expression: `
	        (() => {
	          document.getElementById(${JSON.stringify(NUOMA_OVERLAY_ROOT_ID)})?.remove();
          delete window.__nuomaOverlayState;
          delete window.__nuomaOverlayInstalled;
	          delete window.__nuomaOverlayRefresh;
	          delete window.__nuomaOverlaySetData;
	          delete window.__nuomaApiResolve;
	          return true;
	        })()
	      `,
      awaitPromise: false,
      returnByValue: true,
    })
    .catch(() => undefined);
  await cdp
    .send("Runtime.addBinding", { name: NUOMA_OVERLAY_API_BINDING_NAME })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("already exists")) {
        throw error;
	      }
	    });
	  let bindingState = await readApiBindingState(page);
	  if (bindingState.type !== "function") {
	    await recreateNativeApiBinding(cdp);
	    await cdp
	      .send("Runtime.evaluate", {
	        expression: `(() => { delete window.${NUOMA_OVERLAY_API_BINDING_NAME}; return true; })()`,
	        awaitPromise: false,
	        returnByValue: true,
	      })
	      .catch(() => undefined);
	    await cdp
	      .send("Runtime.addBinding", { name: NUOMA_OVERLAY_API_BINDING_NAME })
	      .catch((error: unknown) => {
	        const message = error instanceof Error ? error.message : String(error);
	        if (!message.includes("already exists")) {
	          throw error;
	        }
	      });
	    bindingState = await readApiBindingState(page);
	  }
	  if (bindingState.type !== "function" && options.reloadWhenNativeMissing) {
	    await page.evaluate(() => window.location.reload()).catch(() => undefined);
	    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
	    await page.waitForTimeout(5_000);
	    await cdp.send("Runtime.enable").catch(() => undefined);
	    await cdp
	      .send("Runtime.addBinding", { name: NUOMA_OVERLAY_API_BINDING_NAME })
	      .catch((error: unknown) => {
	        const message = error instanceof Error ? error.message : String(error);
	        if (!message.includes("already exists")) {
	          throw error;
	        }
	      });
	    bindingState = await readApiBindingState(page);
	  }
	  if (bindingState.type !== "function") {
	    throw new Error(`native api binding unavailable before overlay install: ${JSON.stringify(bindingState)}`);
	  }
	  return { cdp, requests };
	}

	async function recreateNativeApiBinding(cdp: CDPSession) {
	  await cdp.send("Runtime.removeBinding", { name: NUOMA_OVERLAY_API_BINDING_NAME }).catch(() => undefined);
	}

	async function readApiBindingState(page: Page) {
	  return page.evaluate((bindingName) => {
	    const api = (window as unknown as Record<string, unknown>)[bindingName] as
	      | { __nuomaManaged?: boolean }
	      | unknown;
	    return {
	      type: typeof api,
	      managed: Boolean(api && typeof api === "object" && "__nuomaManaged" in api && api.__nuomaManaged),
	    };
	  }, NUOMA_OVERLAY_API_BINDING_NAME);
	}

async function mountOpenAndWaitForApi(page: Page) {
  await page.evaluate(createNuomaOverlayScript());
  await openAndWaitForApi(page);
}

async function injectAndReadState(page: Page) {
  await page.evaluate(createNuomaOverlayScript());
  await page.waitForTimeout(700);
  return page.evaluate(
    ({ rootId }) => {
      const state = (
        window as unknown as {
          __nuomaOverlayRefresh?: () => {
            mounted: boolean;
            phone: string;
            phoneSource: string;
            title: string;
            apiStatus: string;
          };
        }
      ).__nuomaOverlayRefresh?.();
      const host = document.getElementById(rootId);
      return {
        mounted: Boolean(state?.mounted),
        phone: state?.phone ?? "",
        phoneSource: state?.phoneSource ?? "",
        title: state?.title ?? "",
        apiStatus: state?.apiStatus ?? host?.getAttribute("data-nuoma-api-status") ?? "",
      };
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID },
  );
}

async function openAndWaitForApi(page: Page) {
  await page.evaluate(
    ({ rootId, fabTestId }) => {
      const host = document.getElementById(rootId);
      if (host?.getAttribute("data-nuoma-state") !== "open") {
        host?.setAttribute("data-nuoma-state", "open");
        host?.shadowRoot
          ?.querySelector<HTMLButtonElement>(`[data-testid="${fabTestId}"]`)
          ?.setAttribute("aria-expanded", "true");
      }
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID, fabTestId: NUOMA_OVERLAY_FAB_TEST_ID },
  );
  await page.evaluate(() =>
    (
      window as unknown as {
        __nuomaOverlayRefreshFromApi?: (reason: string) => Promise<unknown>;
      }
    ).__nuomaOverlayRefreshFromApi?.("smoke-open"),
  );
  await page.waitForFunction(
    ({ rootId, panelTestId }) => {
      const host = document.getElementById(rootId);
      const panel = host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`);
      const text = panel?.textContent ?? "";
      return text.includes("Ponte API") && text.includes("online / contactSummary");
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
    { timeout: 10_000 },
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
        apiStatus: host?.getAttribute("data-nuoma-api-status") ?? "",
        hasApi: text.includes("Ponte API") && text.includes("online / contactSummary"),
        hasSummary: text.includes("Overlay API binding"),
        hasPhone: text.includes("+5531982066263"),
        text,
      };
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
  );
}

function assertPanel(panel: Awaited<ReturnType<typeof readPanelState>>, label: string) {
  if (!panel.panelVisible || !panel.hasApi || !panel.hasSummary || !panel.hasPhone) {
    throw new Error(`${label} overlay api panel invalid: ${JSON.stringify(panel)}`);
  }
}

function overlayData(label: string, params: Record<string, unknown>): NuomaOverlayData {
  return {
    phone: typeof params.phone === "string" ? params.phone : canaryPhone,
    phoneSource: typeof params.phoneSource === "string" ? params.phoneSource : "smoke-binding",
    title: typeof params.title === "string" ? params.title : canaryPhone,
    contact: {
      name: label,
      status: "lead",
      primaryChannel: "whatsapp",
      notes: "Ponte Runtime.addBinding validada no overlay.",
    },
    conversations: [
      {
        id: 3501,
        channel: "whatsapp",
        lastPreview: "Overlay API binding",
        lastMessageAt: new Date().toISOString(),
      },
    ],
    latestMessages: [
      {
        body: "Resumo hidratado por window.__nuomaApi.",
        direction: "inbound",
        contentType: "text",
        observedAtUtc: new Date().toISOString(),
      },
    ],
    automations: [{ id: 35, name: "Overlay API binding", category: "Embed", status: "active" }],
    notes: "Ponte Runtime.addBinding validada no overlay.",
    source: "nuoma-api",
    apiStatus: "online",
    apiLastMethod: "contactSummary",
    apiLastError: null,
    updatedAt: new Date().toISOString(),
  };
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
        <title>V2.11.7 Overlay API Fixture</title>
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
              <div data-id="false_5531982066263@c.us_M35">
                <span class="selectable-text">Mensagem inbound usada para API binding.</span>
              </div>
            </div>
          </section>
        </main>
      </body>
    </html>
  `;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
