import {
  createNuomaOverlayScript,
  NUOMA_OVERLAY_VERSION,
} from "../../worker/src/features/overlay/inject.js";

import { chromeExtensionVersion } from "./manifest.js";

export function createPageBridgeScript(): string {
  const overlaySource = createNuomaOverlayScript({
    version: `${NUOMA_OVERLAY_VERSION}-m38-extension`,
  });
  return `
(() => {
  const pageSource = "nuoma-wpp-extension-page";
  const contentSource = "nuoma-wpp-extension-content";
  if (!window.__nuomaExtensionBridgeInstalled) {
    window.__nuomaExtensionBridgeInstalled = true;
    window.__nuomaExtensionBridgeVersion = ${JSON.stringify(chromeExtensionVersion)};
    const existingWorkerBridge = typeof window.__nuomaApi === "function";
    if (!existingWorkerBridge) {
      window.__nuomaApi = function nuomaChromeExtensionBridge(payload) {
        window.postMessage({ source: pageSource, type: "overlay-api-request", payload }, "*");
      };
    }
    window.addEventListener("message", (event) => {
      if (event.source !== window) {
        return;
      }
      const data = event.data || {};
      if (data.source !== contentSource || data.type !== "overlay-api-response") {
        return;
      }
      if (typeof window.__nuomaApiResolve === "function") {
        window.__nuomaApiResolve(data.id, data.response);
      }
    });
  }
})();

${overlaySource}
`.trim();
}
