{
  const defaultApiBaseUrl = "http://127.0.0.1:3001";
  const contentSource = "nuoma-wpp-extension-content";
  const accessCookieName = "nuoma_access";

  chrome.runtime.onInstalled?.addListener(() => {
    void chrome.storage?.local?.set({ apiBaseUrl: defaultApiBaseUrl });
  });

  chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
    if (!isRecord(message) || message.source !== contentSource || message.type !== "overlay-api-request") {
      return false;
    }
    void handleOverlayRequest(message.request).then(sendResponse);
    return true;
  });

  async function handleOverlayRequest(request: unknown): Promise<unknown> {
    if (!isOverlayRequest(request)) {
      return {
        ok: false,
        error: { code: "invalid_payload", message: "Invalid Nuoma overlay request" },
      };
    }

    if (request.method === "ping") {
      const apiBaseUrl = await readApiBaseUrl();
      return {
        ok: true,
        data: {
          pong: true,
          source: "chrome-extension",
          apiBaseUrl,
          version: request.version ?? null,
          observedAtUtc: new Date().toISOString(),
        },
      };
    }

    if (request.method !== "contactSummary") {
      return {
        ok: false,
        error: {
          code: "unsupported_method",
          message: "Mutacoes do overlay continuam restritas ao worker/CDP.",
        },
      };
    }

    return postLocalOverlayRequest(request);
  }

  async function postLocalOverlayRequest(request: OverlayRequest): Promise<unknown> {
    const apiBaseUrl = await readApiBaseUrl();
    const token = await readAccessToken(apiBaseUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/extension/overlay`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(request),
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: `http_${response.status}`,
            message: response.status === 401 ? "Login local Nuoma nao encontrado." : response.statusText,
          },
        };
      }
      return body;
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "api_unreachable",
          message: error instanceof Error ? error.message : "API local indisponivel",
        },
      };
    }
  }

  async function readApiBaseUrl(): Promise<string> {
    const stored = await chrome.storage?.local?.get({ apiBaseUrl: defaultApiBaseUrl });
    const value = stored?.apiBaseUrl;
    return typeof value === "string" && value.startsWith("http")
      ? trimTrailingSlash(value)
      : defaultApiBaseUrl;
  }

  async function readAccessToken(apiBaseUrl: string): Promise<string | null> {
    const cookie = await chrome.cookies?.get({ url: apiBaseUrl, name: accessCookieName });
    return cookie?.value ?? null;
  }

  function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
  }

  interface OverlayRequest extends Record<string, unknown> {
    id: string;
    method: string;
    version?: string;
  }

  function isOverlayRequest(value: unknown): value is OverlayRequest {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      typeof value.method === "string" &&
      value.method.length > 0
    );
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
}
