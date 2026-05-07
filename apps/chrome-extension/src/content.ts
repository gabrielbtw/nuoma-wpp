{
  const pageBridgeScriptId = "nuoma-wpp-extension-page-bridge";
  const pageSource = "nuoma-wpp-extension-page";
  const contentSource = "nuoma-wpp-extension-content";

  installPageBridge();
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isRecord(event.data)) {
      return;
    }
    if (event.data.source !== pageSource || event.data.type !== "overlay-api-request") {
      return;
    }
    void handleOverlayApiRequest(event.data.payload);
  });

  function installPageBridge(): void {
    if (document.getElementById(pageBridgeScriptId)) {
      return;
    }
    const install = () => {
      if (document.getElementById(pageBridgeScriptId)) {
        return;
      }
      const script = document.createElement("script");
      script.id = pageBridgeScriptId;
      script.src = chrome.runtime.getURL("page-bridge.js");
      script.async = false;
      (document.documentElement || document.head || document.body).appendChild(script);
    };
    if (document.documentElement || document.head || document.body) {
      install();
      return;
    }
    document.addEventListener("DOMContentLoaded", install, { once: true });
  }

  async function handleOverlayApiRequest(payload: unknown): Promise<void> {
    const request = parseOverlayRequest(payload);
    if (!request) {
      return;
    }
    const response = await sendRuntimeMessage({
      source: contentSource,
      type: "overlay-api-request",
      request,
    });
    window.postMessage(
      {
        source: contentSource,
        type: "overlay-api-response",
        id: request.id,
        response,
      },
      "*",
    );
  }

  function sendRuntimeMessage(message: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({
            ok: false,
            error: {
              code: "runtime_message_failed",
              message: error.message ?? "Chrome runtime message failed",
            },
          });
          return;
        }
        resolve(
          response ?? {
            ok: false,
            error: { code: "empty_response", message: "Chrome runtime returned no response" },
          },
        );
      });
    });
  }

  function parseOverlayRequest(payload: unknown): ({ id: string } & Record<string, unknown>) | null {
    if (typeof payload !== "string") {
      return null;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!isRecord(parsed) || typeof parsed.id !== "string" || !parsed.id) {
        return null;
      }
      return parsed as { id: string } & Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
}
