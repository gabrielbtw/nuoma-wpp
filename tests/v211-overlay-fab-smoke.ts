import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  NUOMA_OVERLAY_FAB_TEST_ID,
  NUOMA_OVERLAY_ROOT_ID,
  createNuomaOverlayScript,
} from "../apps/worker/src/features/overlay/inject.js";

const fixtureScreenshotPath =
  process.env.FIXTURE_SCREENSHOT_PATH ?? "data/v211-overlay-fab-m32-fixture.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v211-overlay-fab-m32-wpp.png";
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
    throw new Error(`overlay smoke changed active send jobs: before=${sendJobsBefore} after=${sendJobsAfter}`);
  }

  console.log(
    [
      "v211-overlay-fab",
      `fixtureMounted=${Number(fixtureResult.mounted)}`,
      `fixturePhone=${fixtureResult.phone}`,
      `fixtureBlocking=${fixtureResult.blocking}`,
      `wppMounted=${Number(wppResult.mounted)}`,
      `wppPhone=${wppResult.phone || "unknown"}`,
      `button=${wppResult.buttonLabel}`,
      `sendJobsDelta=${sendJobsDelta}`,
      `fixture=${fixtureScreenshotPath}`,
      `wpp=${wppScreenshotPath}`,
      `wppMode=${wppResult.mode}`,
      "ig=nao_aplicavel",
      "m=32",
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
    await page.evaluate(createNuomaOverlayScript());
    const state = await readOverlayState(page);
    if (!state.mounted) {
      throw new Error(`fixture overlay did not mount: ${state.reason ?? "unknown"}`);
    }
    if (state.phone !== canaryPhone) {
      throw new Error(`fixture overlay phone mismatch: ${state.phone}`);
    }
    if (state.rootCount !== 1 || !state.parentIsHeader || !state.shadowIsolated) {
      throw new Error(`fixture overlay isolation failed: ${JSON.stringify(state)}`);
    }
    await page.screenshot({ path: fixtureScreenshotPath, fullPage: false });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `fixture overlay has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
    return { mounted: true, phone: state.phone, blocking: blocking.length };
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
    if (!state.mounted) {
      const targetUrl = `${whatsappUrl.replace(/\/$/, "")}/send?phone=${encodeURIComponent(canaryPhone)}`;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(5_000);
      state = await injectAndReadWhatsAppOverlay(page);
    }

    if (!state.mounted) {
      throw new Error(`WhatsApp overlay did not mount: ${state.reason ?? "header-not-found"}`);
    }
    if (state.rootCount !== 1 || !state.shadowIsolated || state.buttonLabel !== "Abrir Nuoma CRM") {
      throw new Error(`WhatsApp overlay invalid state: ${JSON.stringify(state)}`);
    }
    await page.screenshot({ path: wppScreenshotPath, fullPage: false, timeout: 15_000 });
    return {
      mounted: true,
      mode: "cdp",
      phone: state.phone,
      buttonLabel: state.buttonLabel,
    };
  } finally {
    await browser.close();
  }
}

async function injectAndReadWhatsAppOverlay(page: Page) {
  await page.evaluate(createNuomaOverlayScript());
  await page.waitForTimeout(500);
  return readOverlayState(page);
}

async function readOverlayState(page: Page) {
  return page.evaluate(
    ([rootId, testId]) => {
      const header = document.querySelector("#main header");
      const host = document.getElementById(rootId);
      const button = host?.shadowRoot?.querySelector(`[data-testid="${testId}"]`);
      const buttonRect = button?.getBoundingClientRect();
      const headerRect = header?.getBoundingClientRect();
      return {
        mounted: Boolean(host && button),
        reason: host ? null : "host-not-found",
        rootCount: document.querySelectorAll(`#${rootId}`).length,
        parentIsHeader: host?.parentElement === header,
        shadowIsolated: Boolean(host?.shadowRoot),
        buttonLabel: button?.getAttribute("aria-label") ?? "",
        phone: host?.getAttribute("data-nuoma-thread-phone") ?? "",
        title: host?.getAttribute("data-nuoma-thread-title") ?? "",
        buttonWidth: buttonRect?.width ?? 0,
        buttonHeight: buttonRect?.height ?? 0,
        insideHeader:
          Boolean(buttonRect && headerRect) &&
          buttonRect.top >= headerRect.top - 1 &&
          buttonRect.bottom <= headerRect.bottom + 1,
      };
    },
    [NUOMA_OVERLAY_ROOT_ID, NUOMA_OVERLAY_FAB_TEST_ID],
  );
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
