export const chromeExtensionVersion = "0.38.0";
export const defaultApiBaseUrl = "http://127.0.0.1:3001";

export interface ChromeExtensionManifest {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  host_permissions: string[];
  action: {
    default_title: string;
    default_popup: string;
  };
  background: {
    service_worker: string;
    type: "module";
  };
  content_scripts: Array<{
    matches: string[];
    js: string[];
    run_at: "document_idle";
  }>;
  web_accessible_resources: Array<{
    resources: string[];
    matches: string[];
  }>;
}

export function createManifest(): ChromeExtensionManifest {
  return {
    manifest_version: 3,
    name: "Nuoma WPP Companion",
    version: chromeExtensionVersion,
    description: "Nuoma companion local para overlay seguro no WhatsApp Web.",
    permissions: ["cookies", "storage"],
    host_permissions: [
      "https://web.whatsapp.com/*",
      "http://127.0.0.1:3001/*",
      "http://localhost:3001/*",
    ],
    action: {
      default_title: "Nuoma WPP Companion",
      default_popup: "popup.html",
    },
    background: {
      service_worker: "background.js",
      type: "module",
    },
    content_scripts: [
      {
        matches: ["https://web.whatsapp.com/*"],
        js: ["content.js"],
        run_at: "document_idle",
      },
    ],
    web_accessible_resources: [
      {
        resources: ["page-bridge.js"],
        matches: ["https://web.whatsapp.com/*"],
      },
    ],
  };
}
