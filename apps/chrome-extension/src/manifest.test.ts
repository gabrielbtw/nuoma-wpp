import { describe, expect, it } from "vitest";

import { createManifest } from "./manifest.js";
import { createPageBridgeScript } from "./page-bridge.js";

describe("M38 Chrome extension companion", () => {
  it("declares a strict MV3 manifest for WhatsApp and the local API", () => {
    const manifest = createManifest();

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["cookies", "storage"]);
    expect(manifest.host_permissions).toContain("https://web.whatsapp.com/*");
    expect(manifest.host_permissions).toContain("http://127.0.0.1:3001/*");
    expect(manifest.content_scripts[0]).toMatchObject({
      matches: ["https://web.whatsapp.com/*"],
      js: ["content.js"],
      run_at: "document_idle",
    });
    expect(manifest.web_accessible_resources[0]?.resources).toEqual(["page-bridge.js"]);
  });

  it("generates the page bridge with the V2.11 overlay and extension response channel", () => {
    const source = createPageBridgeScript();

    expect(source).toContain("nuoma-wpp-extension-page");
    expect(source).toContain("nuoma-wpp-extension-content");
    expect(source).toContain("window.__nuomaApiResolve");
    expect(source).toContain("nuoma-wpp-overlay-root");
    expect(source).toContain("m38-extension");
  });
});
