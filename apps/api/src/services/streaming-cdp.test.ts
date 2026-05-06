import { describe, expect, it } from "vitest";

import { loadApiEnv } from "@nuoma/config";

import { createStreamingCdpService } from "./streaming-cdp.js";

class FakeWebSocket extends EventTarget {
  static sent: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(readonly url: string) {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }

  send(data: string): void {
    const message = JSON.parse(data) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    FakeWebSocket.sent.push({ method: message.method, params: message.params ?? {} });
    const result =
      message.method === "Page.captureScreenshot"
        ? { data: Buffer.from("png-bytes").toString("base64") }
        : {};
    queueMicrotask(() => {
      const event = new Event("message") as MessageEvent;
      Object.defineProperty(event, "data", {
        value: JSON.stringify({ id: message.id, result }),
      });
      this.dispatchEvent(event);
    });
  }

  close(): void {
    // Test double.
  }
}

describe("streaming CDP service", () => {
  it("stays unavailable while API streaming is disabled", async () => {
    const service = createStreamingCdpService({
      env: loadApiEnv({ NODE_ENV: "test" }),
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });

    await expect(service.startScreencast()).resolves.toMatchObject({
      available: false,
      sessionId: null,
      image: null,
    });
  });

  it("captures a CDP screenshot and relays click/key/text input for the session", async () => {
    FakeWebSocket.sent = [];
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "target-1",
            type: "page",
            url: "https://web.whatsapp.com/",
            webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/target-1",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const service = createStreamingCdpService({
      env: loadApiEnv({
        NODE_ENV: "test",
        API_STREAMING_ENABLED: "true",
        API_STREAMING_CDP_HOST: "127.0.0.1",
        API_STREAMING_CDP_PORT: "9223",
        API_STREAMING_TARGET_URL_MATCH: "web.whatsapp.com",
      }),
      fetchImpl,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
    });

    const started = await service.startScreencast();
    expect(started).toMatchObject({
      available: true,
      image: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
      mimeType: "image/png",
      targetUrl: "https://web.whatsapp.com/",
      expiresAt: "2026-05-06T12:01:00.000Z",
    });
    expect(started.sessionId).toEqual(expect.any(String));

    await expect(
      service.dispatchInput({
        sessionId: started.sessionId!,
        type: "click",
        payload: { x: 12, y: 34 },
      }),
    ).resolves.toMatchObject({ accepted: true, type: "click" });
    await expect(
      service.dispatchInput({
        sessionId: started.sessionId!,
        type: "keydown",
        payload: { key: "Enter" },
      }),
    ).resolves.toMatchObject({ accepted: true, type: "keydown" });
    await expect(
      service.dispatchInput({
        sessionId: started.sessionId!,
        type: "text",
        payload: { text: "oi" },
      }),
    ).resolves.toMatchObject({ accepted: true, type: "text" });

    expect(FakeWebSocket.sent.map((call) => call.method)).toEqual([
      "Page.captureScreenshot",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchKeyEvent",
      "Input.dispatchKeyEvent",
      "Input.insertText",
    ]);
  });
});
