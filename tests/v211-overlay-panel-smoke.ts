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
  process.env.FIXTURE_SCREENSHOT_PATH ?? "data/v211-overlay-panel-m33-fixture.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v211-overlay-panel-m33-wpp.png";
const fixtureStateScreenshotPath =
  process.env.FIXTURE_STATE_SCREENSHOT_PATH ?? "data/v211-overlay-panel-states-m36-fixture.png";
const wppStateScreenshotPath =
  process.env.WPP_STATE_SCREENSHOT_PATH ?? "data/v211-overlay-panel-states-m36-wpp.png";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const canaryPhone = "5531982066263";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");

const panelData: NuomaOverlayData = {
  phone: canaryPhone,
  title: canaryPhone,
  contact: {
    name: "V2.11.5 Painel Smoke",
    status: "lead",
    primaryChannel: "whatsapp",
    notes: "Nota M33 exibida no overlay dentro do WhatsApp.",
  },
  conversations: [
    {
      id: 3301,
      channel: "whatsapp",
      lastPreview: "Resumo do contato no overlay",
      lastMessageAt: new Date().toISOString(),
    },
  ],
  latestMessages: [
    {
      body: "Mensagem sincronizada exibida no painel.",
      direction: "inbound",
      contentType: "text",
      observedAtUtc: new Date().toISOString(),
    },
    {
      body: "Resposta outbound recente.",
      direction: "outbound",
      contentType: "text",
      observedAtUtc: new Date().toISOString(),
    },
  ],
  automations: [
    { id: 1, name: "Boas-vindas", category: "Atendimento", status: "active" },
    { id: 2, name: "Retorno orcamento", category: "Comercial", status: "active" },
  ],
  notes: "Nota M33 exibida no overlay dentro do WhatsApp.",
  source: "smoke",
};

async function main() {
  await fs.mkdir(path.dirname(fixtureScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(fixtureStateScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppStateScreenshotPath), { recursive: true });

  const sendJobsBefore = await countActiveSendJobs();
  const fixtureResult = await validateFixture();
  const wppResult = await validateWhatsAppWeb();
  const sendJobsAfter = await countActiveSendJobs();
  const sendJobsDelta = sendJobsAfter - sendJobsBefore;

  if (sendJobsDelta !== 0) {
    throw new Error(`overlay panel smoke changed active send jobs: before=${sendJobsBefore} after=${sendJobsAfter}`);
  }

  console.log(
    [
      "v211-overlay-panel",
      `fixturePanel=${Number(fixtureResult.panelVisible)}`,
      `fixtureSections=${fixtureResult.sections}`,
      `fixtureBlocking=${fixtureResult.blocking}`,
      `wppPanel=${Number(wppResult.panelVisible)}`,
      `wppSections=${wppResult.sections}`,
      `summary=${Number(wppResult.hasSummary)}`,
      `automations=${Number(wppResult.hasAutomations)}`,
      `notes=${Number(wppResult.hasNotes)}`,
      `fixtureStates=${Number(fixtureResult.hasStateFeedback)}`,
      `wppStates=${Number(wppResult.hasStateFeedback)}`,
      `sendJobsDelta=${sendJobsDelta}`,
      `fixture=${fixtureScreenshotPath}`,
      `fixtureStatesShot=${fixtureStateScreenshotPath}`,
      `wpp=${wppScreenshotPath}`,
      `wppStatesShot=${wppStateScreenshotPath}`,
      `wppMode=${wppResult.mode}`,
      "ig=nao_aplicavel",
      "m=36",
    ].join("|"),
  );
}

async function validateFixture() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    const fixture = await fs.readFile("tests/fixtures/wa-web.html", "utf8");
    await page.setContent(fixture, { waitUntil: "domcontentloaded" });
    await mountAndOpenPanel(page);
    const panel = await readPanelState(page);
    assertPanel(panel, "fixture");
    await page.screenshot({ path: fixtureScreenshotPath, fullPage: false });
    const statePanel = await validatePanelStateFeedback(page);
    assertPanelStateFeedback(statePanel, "fixture");
    await page.screenshot({ path: fixtureStateScreenshotPath, fullPage: false });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `overlay panel fixture has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
    return { ...panel, ...statePanel, blocking: blocking.length };
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
    await mountAndOpenPanel(page);
    const panel = await readPanelState(page);
    assertPanel(panel, "wpp");
    await page.screenshot({ path: wppScreenshotPath, fullPage: false, timeout: 15_000 });
    const statePanel = await validatePanelStateFeedback(page);
    assertPanelStateFeedback(statePanel, "wpp");
    await page.screenshot({ path: wppStateScreenshotPath, fullPage: false, timeout: 15_000 });
    return { ...panel, ...statePanel, mode: "cdp" };
  } finally {
    await browser.close();
  }
}

async function validatePanelStateFeedback(page: Page) {
  return page.evaluate(
    ({ rootId, panelTestId, canaryPhone }) => {
      const host = document.getElementById(rootId);
      const setData = (
        window as unknown as {
          __nuomaOverlaySetData: (value: unknown) => unknown;
        }
      ).__nuomaOverlaySetData;

      setData({
        phone: canaryPhone,
        phoneSource: "header-title",
        title: canaryPhone,
        contact: null,
        source: "nuoma-api",
        apiStatus: "loading",
        apiLastMethod: "contactSummary",
      });
      const loadingText =
        host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";

      setData({
        phone: canaryPhone,
        phoneSource: "header-title",
        title: canaryPhone,
        contact: null,
        source: "nuoma-api",
        apiStatus: "error",
        apiLastMethod: "contactSummary",
        apiLastError: "bridge offline smoke",
      });
      const errorText =
        host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";

      setData({
        phone: canaryPhone,
        phoneSource: "header-title",
        title: canaryPhone,
        contact: null,
        conversations: [],
        latestMessages: [],
        automations: [],
        notes: null,
        source: "nuoma-api",
        apiStatus: "online",
        apiLastMethod: "contactSummary",
        apiLastError: "",
      });
      const noContactText =
        host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";
      const buttons = host?.shadowRoot?.querySelectorAll<HTMLButtonElement>(".nuoma-empty-action") ?? [];
      const disabledActions: Array<{ text: string; disabled: boolean }> = [];
      for (const button of buttons) {
        disabledActions.push({ text: button.textContent ?? "", disabled: button.disabled });
      }
      let allActionsDisabled = disabledActions.length === 2;
      for (const action of disabledActions) {
        if (!action.disabled) {
          allActionsDisabled = false;
        }
      }

      return {
        hasStateFeedback:
          loadingText.includes("Carregando contato") &&
          errorText.includes("Erro na ponte API") &&
          errorText.includes("bridge offline smoke") &&
          noContactText.includes("Contato nao encontrado no CRM") &&
          allActionsDisabled,
        loadingText,
        errorText,
        noContactText,
        disabledActions,
      };
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID, canaryPhone },
  );
}

async function mountAndOpenPanel(page: Page) {
  await page.evaluate((rootId) => {
    document.getElementById(rootId)?.remove();
    delete (window as unknown as { __nuomaOverlayState?: unknown }).__nuomaOverlayState;
    delete (window as unknown as { __nuomaOverlayInstalled?: unknown }).__nuomaOverlayInstalled;
    delete (window as unknown as { __nuomaOverlayRefresh?: unknown }).__nuomaOverlayRefresh;
    delete (window as unknown as { __nuomaOverlaySetData?: unknown }).__nuomaOverlaySetData;
    delete (window as unknown as { __nuomaOverlayRefreshFromApi?: unknown }).__nuomaOverlayRefreshFromApi;
    delete (window as unknown as { __nuomaApiResolve?: unknown }).__nuomaApiResolve;
  }, NUOMA_OVERLAY_ROOT_ID);
  await page.evaluate(createNuomaOverlayScript());
  await page.evaluate(({ data, rootId, fabTestId }) => {
    const host = document.getElementById(rootId);
    host?.setAttribute("data-nuoma-state", "open");
    host?.shadowRoot
      ?.querySelector<HTMLButtonElement>(`[data-testid="${fabTestId}"]`)
      ?.setAttribute("aria-expanded", "true");
    (
      window as unknown as {
        __nuomaOverlaySetData: (value: unknown) => unknown;
      }
    ).__nuomaOverlaySetData(data);
  }, { data: panelData, rootId: NUOMA_OVERLAY_ROOT_ID, fabTestId: NUOMA_OVERLAY_FAB_TEST_ID });
  await page.waitForTimeout(400);
}

async function readPanelState(page: Page) {
  return page.evaluate(
    ({ rootId, panelTestId }) => {
      const host = document.getElementById(rootId);
      const panel = host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`);
      const text = panel?.textContent ?? "";
      const rect = panel?.getBoundingClientRect();
      const sectionTexts: string[] = [];
      for (const section of Array.from(panel?.querySelectorAll(".nuoma-section") ?? [])) {
        sectionTexts.push(section.textContent ?? "");
      }
      let summaryText = "";
      let automationText = "";
      let messagesText = "";
      let notesText = "";
      for (const sectionText of sectionTexts) {
        if (!summaryText && sectionText.includes("Resumo")) {
          summaryText = sectionText;
        }
        if (!automationText && sectionText.includes("Automacoes")) {
          automationText = sectionText;
        }
        if (!messagesText && sectionText.includes("Ultimas mensagens")) {
          messagesText = sectionText;
        }
        if (!notesText && sectionText.includes("Notas")) {
          notesText = sectionText;
        }
      }
      return {
        panelVisible: Boolean(panel && rect && rect.width > 300 && rect.height > 300),
        sections: sectionTexts.length,
        hasSummary:
          summaryText.includes("Canal") &&
          summaryText.includes("Conversas") &&
          summaryText.includes("Detector") &&
          summaryText.includes("Ponte API"),
        hasAutomations: Boolean(automationText),
        hasMessages: Boolean(messagesText),
        hasNotes: Boolean(notesText),
        hasFixtureSummary: text.includes("Resumo") && text.includes("V2.11.5 Painel Smoke"),
        hasFixtureAutomations: text.includes("Automacoes") && text.includes("Boas-vindas"),
        hasFixtureNotes: text.includes("Notas") && text.includes("Nota M33"),
        sectionTexts,
        text,
      };
    },
    { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
  );
}

function assertPanel(
  panel: Awaited<ReturnType<typeof readPanelState>>,
  label: string,
) {
  if (!panel.panelVisible || panel.sections < 4) {
    throw new Error(`${label} overlay panel did not render expected sections: ${JSON.stringify(panel)}`);
  }
  if (label === "fixture" && (!panel.hasFixtureSummary || !panel.hasFixtureAutomations || !panel.hasFixtureNotes)) {
    throw new Error(`${label} overlay panel missing fixture content: ${JSON.stringify(panel)}`);
  }
  if (!panel.hasSummary || !panel.hasAutomations || !panel.hasMessages || !panel.hasNotes) {
    throw new Error(`${label} overlay panel missing required content: ${JSON.stringify(panel)}`);
  }
}

function assertPanelStateFeedback(
  panel: Awaited<ReturnType<typeof validatePanelStateFeedback>>,
  label: string,
) {
  if (!panel.hasStateFeedback) {
    throw new Error(`${label} overlay panel missing state feedback: ${JSON.stringify(panel)}`);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
