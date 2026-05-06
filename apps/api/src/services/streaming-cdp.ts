import { randomUUID } from "node:crypto";

import type { ApiEnv } from "@nuoma/config";

interface CdpTarget {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export interface StreamingSession {
  id: string;
  targetId: string;
  targetUrl: string;
  webSocketDebuggerUrl: string;
  createdAt: string;
  expiresAt: string;
}

export interface StartScreencastResult {
  available: boolean;
  sessionId: string | null;
  image: string | null;
  mimeType: "image/png" | null;
  targetUrl: string | null;
  expiresAt: string | null;
  reason: string | null;
}

export interface DispatchInputResult {
  accepted: boolean;
  type: "click" | "keydown" | "text";
  sessionId: string | null;
  reason: string | null;
}

export interface StreamingCdpService {
  startScreencast(): Promise<StartScreencastResult>;
  dispatchInput(input: {
    sessionId: string;
    type: "click" | "keydown" | "text";
    payload: Record<string, unknown>;
  }): Promise<DispatchInputResult>;
}

export function createStreamingCdpService(input: {
  env: ApiEnv;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  now?: () => Date;
}): StreamingCdpService {
  const fetchImpl = input.fetchImpl ?? fetch;
  const WebSocketImpl = input.WebSocketImpl ?? WebSocket;
  const now = input.now ?? (() => new Date());
  const sessions = new Map<string, StreamingSession>();

  async function startScreencast(): Promise<StartScreencastResult> {
    if (!input.env.API_STREAMING_ENABLED) {
      return unavailable("Screencast relay is disabled by API_STREAMING_ENABLED.");
    }

    const target = await selectTarget({
      env: input.env,
      fetchImpl,
    });
    if (!target?.webSocketDebuggerUrl || !target.url) {
      return unavailable("No matching CDP page target is available.");
    }

    const image = await cdpCall<{ data: string }>({
      webSocketUrl: target.webSocketDebuggerUrl,
      method: "Page.captureScreenshot",
      params: { format: "png", fromSurface: true },
      timeoutMs: input.env.API_STREAMING_TIMEOUT_MS,
      WebSocketImpl,
    });
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + 60_000);
    const session: StreamingSession = {
      id: randomUUID(),
      targetId: target.id,
      targetUrl: target.url,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    sessions.set(session.id, session);

    return {
      available: true,
      sessionId: session.id,
      image: `data:image/png;base64,${image.data}`,
      mimeType: "image/png",
      targetUrl: session.targetUrl,
      expiresAt: session.expiresAt,
      reason: null,
    };
  }

  async function dispatchInput(dispatch: {
    sessionId: string;
    type: "click" | "keydown" | "text";
    payload: Record<string, unknown>;
  }): Promise<DispatchInputResult> {
    if (!input.env.API_STREAMING_ENABLED) {
      return rejected(dispatch.type, dispatch.sessionId, "Screencast relay is disabled.");
    }
    const session = sessions.get(dispatch.sessionId);
    if (!session) {
      return rejected(dispatch.type, dispatch.sessionId, "Screencast session was not found.");
    }
    if (Date.parse(session.expiresAt) <= now().getTime()) {
      sessions.delete(session.id);
      return rejected(dispatch.type, dispatch.sessionId, "Screencast session expired.");
    }

    if (dispatch.type === "click") {
      const x = finiteNumber(dispatch.payload.x);
      const y = finiteNumber(dispatch.payload.y);
      if (x === null || y === null) {
        return rejected(dispatch.type, dispatch.sessionId, "Click input requires numeric x and y.");
      }
      await cdpCall({
        webSocketUrl: session.webSocketDebuggerUrl,
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x, y, button: "left", clickCount: 1 },
        timeoutMs: input.env.API_STREAMING_TIMEOUT_MS,
        WebSocketImpl,
      });
      await cdpCall({
        webSocketUrl: session.webSocketDebuggerUrl,
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseReleased", x, y, button: "left", clickCount: 1 },
        timeoutMs: input.env.API_STREAMING_TIMEOUT_MS,
        WebSocketImpl,
      });
      return accepted(dispatch.type, dispatch.sessionId);
    }

    if (dispatch.type === "keydown") {
      const key = stringValue(dispatch.payload.key);
      if (!key) {
        return rejected(dispatch.type, dispatch.sessionId, "Keydown input requires key.");
      }
      await cdpCall({
        webSocketUrl: session.webSocketDebuggerUrl,
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown", key },
        timeoutMs: input.env.API_STREAMING_TIMEOUT_MS,
        WebSocketImpl,
      });
      await cdpCall({
        webSocketUrl: session.webSocketDebuggerUrl,
        method: "Input.dispatchKeyEvent",
        params: { type: "keyUp", key },
        timeoutMs: input.env.API_STREAMING_TIMEOUT_MS,
        WebSocketImpl,
      });
      return accepted(dispatch.type, dispatch.sessionId);
    }

    const text = stringValue(dispatch.payload.text);
    if (!text) {
      return rejected(dispatch.type, dispatch.sessionId, "Text input requires text.");
    }
    await cdpCall({
      webSocketUrl: session.webSocketDebuggerUrl,
      method: "Input.insertText",
      params: { text },
      timeoutMs: input.env.API_STREAMING_TIMEOUT_MS,
      WebSocketImpl,
    });
    return accepted(dispatch.type, dispatch.sessionId);
  }

  return { startScreencast, dispatchInput };
}

async function selectTarget(input: {
  env: ApiEnv;
  fetchImpl: typeof fetch;
}): Promise<CdpTarget | null> {
  const response = await input.fetchImpl(
    `http://${input.env.API_STREAMING_CDP_HOST}:${input.env.API_STREAMING_CDP_PORT}/json`,
  );
  if (!response.ok) {
    throw new Error(`CDP target list failed: ${response.status}`);
  }
  const targets = (await response.json()) as CdpTarget[];
  return (
    targets.find(
      (target) =>
        target.type === "page" &&
        target.webSocketDebuggerUrl &&
        target.url?.includes(input.env.API_STREAMING_TARGET_URL_MATCH),
    ) ??
    targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) ??
    null
  );
}

async function cdpCall<T = unknown>(input: {
  webSocketUrl: string;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs: number;
  WebSocketImpl: typeof WebSocket;
}): Promise<T> {
  const socket = new input.WebSocketImpl(input.webSocketUrl);
  const id = 1;
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      closeSocket(socket);
      reject(new Error(`CDP call timed out: ${input.method}`));
    }, input.timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id, method: input.method, params: input.params ?? {} }));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      closeSocket(socket);
      reject(new Error(`CDP websocket failed: ${input.method}`));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: T;
        error?: { message?: string };
      };
      if (message.id !== id) return;
      clearTimeout(timeout);
      closeSocket(socket);
      if (message.error) {
        reject(new Error(message.error.message ?? `CDP call failed: ${input.method}`));
        return;
      }
      resolve((message.result ?? {}) as T);
    });
  });
}

function closeSocket(socket: WebSocket): void {
  try {
    socket.close();
  } catch {
    // Ignore close errors; the operation result is already determined.
  }
}

function unavailable(reason: string): StartScreencastResult {
  return {
    available: false,
    sessionId: null,
    image: null,
    mimeType: null,
    targetUrl: null,
    expiresAt: null,
    reason,
  };
}

function accepted(type: DispatchInputResult["type"], sessionId: string): DispatchInputResult {
  return { accepted: true, type, sessionId, reason: null };
}

function rejected(
  type: DispatchInputResult["type"],
  sessionId: string | null,
  reason: string,
): DispatchInputResult {
  return { accepted: false, type, sessionId, reason };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
