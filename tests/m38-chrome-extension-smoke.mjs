import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = path.join(root, "data", `m38-chrome-extension-smoke-${stamp}`);
const extensionDir = path.join(root, "apps/chrome-extension");
const distDir = path.join(extensionDir, "dist");
const popupScreenshot = path.join(evidenceDir, "01-popup.png");
const overlayScreenshot = path.join(evidenceDir, "02-overlay-fixture.png");
const reportPath = path.join(evidenceDir, "REPORT.md");

await fs.mkdir(evidenceDir, { recursive: true });
await execFileAsync(npmBin, ["run", "build:chrome-extension"], { cwd: root });

const manifest = JSON.parse(await fs.readFile(path.join(distDir, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest MV3 ausente");
assert(manifest.permissions.includes("cookies"), "permissao cookies ausente");
assert(manifest.content_scripts[0]?.matches?.includes("https://web.whatsapp.com/*"), "match WhatsApp ausente");
assert(manifest.web_accessible_resources[0]?.resources?.includes("page-bridge.js"), "page bridge nao exposto");
await assertFile(path.join(distDir, "background.js"));
await assertFile(path.join(distDir, "content.js"));
await assertFile(path.join(distDir, "page-bridge.js"));
await assertFile(path.join(distDir, "popup.html"));

const browser = await chromium.launch({ headless: true });
try {
  const popup = await browser.newPage({ viewport: { width: 360, height: 520 } });
  await popup.goto(pathToFileURL(path.join(distDir, "popup.html")).href);
  await popup.waitForSelector("text=Nuoma WPP Companion");
  await popup.waitForSelector("text=Chrome Extension runtime");
  await popup.screenshot({ path: popupScreenshot, fullPage: true });

  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const fixture = await fs.readFile(path.join(root, "tests/fixtures/wa-web.html"), "utf8");
  await page.setContent(fixture);
  await page.evaluate(() => {
    window.addEventListener("message", (event) => {
      const data = event.data || {};
      if (event.source !== window || data.source !== "nuoma-wpp-extension-page") {
        return;
      }
      if (data.type !== "overlay-api-request") {
        return;
      }
      const request = JSON.parse(data.payload);
      window.postMessage(
        {
          source: "nuoma-wpp-extension-content",
          type: "overlay-api-response",
          id: request.id,
          response: {
            ok: true,
            data: {
              phone: "5531982066263",
              phoneSource: "title-conversation",
              title: "5531982066263",
              contact: {
                name: "Neferpeel Extension",
                status: "active",
                primaryChannel: "whatsapp",
                notes: "Resumo hidratado pela ponte M38.",
              },
              conversations: [
                {
                  id: 38,
                  channel: "whatsapp",
                  lastPreview: "Bridge Chrome extension OK",
                  lastMessageAt: "2026-05-07T10:38:00.000Z",
                },
              ],
              latestMessages: [
                {
                  body: "Mensagem fixture M38",
                  direction: "inbound",
                  contentType: "text",
                  observedAtUtc: "2026-05-07T10:38:00.000Z",
                },
              ],
              automations: [],
              notes: "Resumo hidratado pela ponte M38.",
              source: "nuoma-api",
              apiStatus: "online",
              apiLastMethod: "contactSummary",
              apiLastError: null,
              updatedAt: new Date().toISOString(),
            },
          },
        },
        "*",
      );
    });
  });
  await page.addScriptTag({ path: path.join(distDir, "page-bridge.js") });
  await page.waitForFunction(() => Boolean(document.getElementById("nuoma-wpp-overlay-root")));
  await page.evaluate(() => {
    const host = document.getElementById("nuoma-wpp-overlay-root");
    const button = host?.shadowRoot?.querySelector('[data-testid="nuoma-overlay-fab"]');
    button?.click();
  });
  await page.waitForFunction(() => {
    const host = document.getElementById("nuoma-wpp-overlay-root");
    return host?.shadowRoot?.textContent?.includes("Neferpeel Extension");
  });
  const state = await page.evaluate(() => {
    const host = document.getElementById("nuoma-wpp-overlay-root");
    const panelText = host?.shadowRoot?.textContent ?? "";
    return {
      mounted: Boolean(host),
      phone: host?.getAttribute("data-nuoma-thread-phone"),
      apiStatus: host?.getAttribute("data-nuoma-api-status"),
      panelText,
    };
  });
  assert(state.mounted, "overlay nao montou no fixture");
  assert(state.phone === "5531982066263", `telefone inesperado: ${state.phone}`);
  assert(state.panelText.includes("Neferpeel Extension"), "painel nao hidratou contato");
  assert(state.panelText.includes("online / contactSummary"), "ponte API nao ficou online");
  await page.screenshot({ path: overlayScreenshot, fullPage: true });
} finally {
  await browser.close();
}

await fs.writeFile(
  reportPath,
  [
    "# M38 Chrome Extension Smoke",
    "",
    "- teste > Build MV3, manifest, popup e page bridge do overlay.",
    `- prints > ${popupScreenshot}`,
    `- prints > ${overlayScreenshot}`,
    "- detalhes > manifest=ok popup=ok overlay=ok bridge=ok auth=chrome.cookies+Bearer",
    "",
  ].join("\n"),
  "utf8",
);

console.log(
  [
    "m38-chrome-extension",
    "manifest=ok",
    "popup=ok",
    "overlay=ok",
    "bridge=ok",
    `report=${reportPath}`,
  ].join("|"),
);

async function assertFile(filePath) {
  const stat = await fs.stat(filePath);
  assert(stat.isFile() && stat.size > 0, `arquivo invalido: ${filePath}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`M38 Chrome extension smoke failed: ${message}`);
  }
}
