import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { chromium, webkit } from "playwright";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = path.join(root, "data", `m39-safari-extension-smoke-${stamp}`);
const fakeConverterPath = path.join(evidenceDir, "fake-safari-web-extension-converter.mjs");
const safariExtensionDir = path.join(root, "apps/safari-extension");
const distDir = path.join(safariExtensionDir, "dist");
const webExtensionDir = path.join(distDir, "web-extension");
const popupScreenshot = path.join(evidenceDir, "01-popup-browser.png");
const overlayScreenshot = path.join(evidenceDir, "02-overlay-browser-fixture.png");
const reportPath = path.join(evidenceDir, "REPORT.md");

await fs.mkdir(evidenceDir, { recursive: true });
await writeFakeConverter(fakeConverterPath);

await execFileAsync(npmBin, ["run", "build:safari-extension"], {
  cwd: root,
  env: {
    ...process.env,
    SAFARI_WEB_EXTENSION_CONVERTER_BIN: fakeConverterPath,
  },
  maxBuffer: 1024 * 1024 * 8,
});

const manifest = JSON.parse(await fs.readFile(path.join(webExtensionDir, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest MV3 ausente");
assert(manifest.content_scripts[0]?.matches?.includes("https://web.whatsapp.com/*"), "match WhatsApp ausente");
assert(manifest.content_scripts[0]?.js?.includes("content.js"), "content script ausente");
assert(manifest.web_accessible_resources[0]?.resources?.includes("page-bridge.js"), "page bridge nao exposto");
await assertFile(path.join(webExtensionDir, "background.js"));
await assertFile(path.join(webExtensionDir, "content.js"));
await assertFile(path.join(webExtensionDir, "page-bridge.js"));
await assertFile(path.join(webExtensionDir, "popup.html"));
await assertFile(path.join(distDir, "Nuoma Safari Companion.xcodeproj", "project.pbxproj"));

const summary = JSON.parse(
  await fs.readFile(path.join(distDir, "M39_SAFARI_EXTENSION_SUMMARY.json"), "utf8"),
);
assert(summary.mode === "safari-extension-companion", "summary M39 invalido");
assert(summary.overlayMountTokenDetected === true, "summary nao detectou overlay");
assert(summary.converter?.usesXcrun === false, "smoke deveria usar converter fake direto");

const { browser, browserEngine, browserFallbackReason } = await launchSmokeBrowser();
try {
  const popup = await browser.newPage({ viewport: { width: 360, height: 520 } });
  await popup.goto(pathToFileURL(path.join(webExtensionDir, "popup.html")).href);
  await popup.waitForSelector("text=Nuoma WPP Companion");
  await popup.screenshot({ path: popupScreenshot, fullPage: true });

  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const fixture = await fs.readFile(path.join(root, "tests/fixtures/wa-web.html"), "utf8");
  await page.setContent(fixture);
  await installFakeExtensionRuntime(page, path.join(webExtensionDir, "page-bridge.js"));
  await page.addScriptTag({ path: path.join(webExtensionDir, "content.js") });
  await page.waitForFunction(() => Boolean(document.getElementById("nuoma-wpp-extension-page-bridge")));
  await page.waitForFunction(() => Boolean(document.getElementById("nuoma-wpp-overlay-root")));
  await page.evaluate(() => {
    const host = document.getElementById("nuoma-wpp-overlay-root");
    const button = host?.shadowRoot?.querySelector('[data-testid="nuoma-overlay-fab"]');
    button?.click();
  });
  await page.waitForFunction(() => {
    const host = document.getElementById("nuoma-wpp-overlay-root");
    return host?.shadowRoot?.textContent?.includes("Neferpeel Safari");
  });
  const state = await page.evaluate(() => {
    const host = document.getElementById("nuoma-wpp-overlay-root");
    const panelText = host?.shadowRoot?.textContent ?? "";
    return {
      bridgeScriptLoaded: Boolean(document.getElementById("nuoma-wpp-extension-page-bridge")),
      contentMessages: window.__m39ContentMessages?.length ?? 0,
      mounted: Boolean(host),
      phone: host?.getAttribute("data-nuoma-thread-phone"),
      apiStatus: host?.getAttribute("data-nuoma-api-status"),
      panelText,
    };
  });
  assert(state.bridgeScriptLoaded, "content script nao carregou page-bridge.js");
  assert(state.contentMessages > 0, "content script nao encaminhou request para runtime");
  assert(state.mounted, "overlay nao montou no fixture de browser");
  assert(state.phone === "5531982066263", `telefone inesperado: ${state.phone}`);
  assert(state.panelText.includes("Neferpeel Safari"), "painel nao hidratou contato");
  assert(state.panelText.includes("online / contactSummary"), "ponte API nao ficou online");
  await page.screenshot({ path: overlayScreenshot, fullPage: true });
} finally {
  await browser.close();
}

await fs.writeFile(
  reportPath,
  [
    "# M39 Safari Extension Smoke",
    "",
    `- teste > Build Safari wrapper com converter fake, manifest convertido, content script e overlay em ${browserEngine}.`,
    `- prints > ${popupScreenshot}`,
    `- prints > ${overlayScreenshot}`,
    "- detalhes > xcodeProject=ok manifest=ok contentScript=ok overlay=ok api=/api/extension/overlay.",
    browserFallbackReason ? `- detalhe > browserFallback=${browserFallbackReason}` : "- detalhe > browserFallback=none",
    "- pendencia > print no Safari real depende de `xcrun safari-web-extension-converter` instalado.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(
  [
    "m39-safari-extension",
    "xcodeProject=ok",
    "manifest=ok",
    "contentScript=ok",
    "overlay=ok",
    "api=extension-overlay",
    `browser=${browserEngine}`,
    "safariReal=blocked_without_xcrun",
    `report=${reportPath}`,
  ].join("|"),
);

async function launchSmokeBrowser() {
  try {
    return {
      browser: await webkit.launch({ headless: true }),
      browserEngine: "webkit",
      browserFallbackReason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Executable doesn't exist")) {
      throw error;
    }
    return {
      browser: await chromium.launch({ headless: true }),
      browserEngine: "chromium-fallback",
      browserFallbackReason: "playwright-webkit-not-installed",
    };
  }
}

async function installFakeExtensionRuntime(page, bridgePath) {
  const bridgeSource = await fs.readFile(bridgePath, "utf8");
  const bridgeUrl = `data:text/javascript;base64,${Buffer.from(bridgeSource).toString("base64")}`;
  await page.evaluate((runtimeBridgeUrl) => {
    window.__m39ContentMessages = [];
    window.chrome = {
      runtime: {
        id: "m39-safari-webkit-fixture",
        lastError: null,
        getURL: (asset) => (asset === "page-bridge.js" ? runtimeBridgeUrl : ""),
        sendMessage: (message, callback) => {
          window.__m39ContentMessages.push(message);
          callback({
            ok: true,
            data: {
              phone: "5531982066263",
              phoneSource: "title-conversation",
              title: "5531982066263",
              contact: {
                name: "Neferpeel Safari",
                status: "active",
                primaryChannel: "whatsapp",
                notes: "Resumo hidratado pela ponte M39.",
              },
              conversations: [
                {
                  id: 39,
                  channel: "whatsapp",
                  lastPreview: "Bridge Safari extension OK",
                  lastMessageAt: "2026-05-07T11:39:00.000Z",
                },
              ],
              latestMessages: [
                {
                  body: "Mensagem fixture M39",
                  direction: "inbound",
                  contentType: "text",
                  observedAtUtc: "2026-05-07T11:39:00.000Z",
                },
              ],
              automations: [],
              notes: "Resumo hidratado pela ponte M39.",
              source: "nuoma-api",
              apiStatus: "online",
              apiLastMethod: "contactSummary",
              apiLastError: null,
              updatedAt: new Date().toISOString(),
            },
          });
        },
      },
      storage: {
        local: {
          get: async () => ({ apiBaseUrl: "http://127.0.0.1:3001" }),
          set: async () => undefined,
        },
      },
      cookies: {
        get: async () => ({ value: "fake-local-token" }),
      },
    };
  }, bridgeUrl);
}

async function writeFakeConverter(filePath) {
  await fs.writeFile(
    filePath,
    [
      "#!/usr/bin/env node",
      'import fs from "node:fs/promises";',
      'import path from "node:path";',
      "const args = process.argv.slice(2);",
      "const valueAfter = (flag) => {",
      "  const index = args.indexOf(flag);",
      "  return index >= 0 ? args[index + 1] : undefined;",
      "};",
      "const sourceDir = args[0];",
      'const projectLocation = valueAfter("--project-location") ?? process.cwd();',
      'const appName = valueAfter("--app-name") ?? "Nuoma Safari Companion";',
      "const projectDir = path.join(projectLocation, `${appName}.xcodeproj`);",
      "await fs.mkdir(projectDir, { recursive: true });",
      "await fs.writeFile(path.join(projectDir, \"project.pbxproj\"), [`// M39 fake Safari project`, `source=${sourceDir}`, `args=${JSON.stringify(args)}`, ``].join(\"\\n\"), \"utf8\");",
      "await fs.writeFile(path.join(projectLocation, \"m39-fake-converter-args.json\"), `${JSON.stringify({ args }, null, 2)}\\n`, \"utf8\");",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(filePath, 0o755);
}

async function assertFile(filePath) {
  const stat = await fs.stat(filePath);
  assert(stat.isFile() && stat.size > 0, `arquivo invalido: ${filePath}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`M39 Safari extension smoke failed: ${message}`);
  }
}
