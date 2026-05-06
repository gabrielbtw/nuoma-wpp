import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import argon2 from "argon2";

import { loadApiEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";

import { buildApiApp } from "../apps/api/src/app.js";

interface TrpcResult<T> {
  data?: T;
  setCookie?: string | string[];
}

interface ScreencastResult {
  available: boolean;
  sessionId: string | null;
  image: string | null;
  mimeType: string | null;
  targetUrl: string | null;
  reason: string | null;
}

interface DispatchResult {
  accepted: boolean;
  reason: string | null;
}

async function main() {
  const cdpPort = Number(process.env.API_STREAMING_CDP_PORT ?? process.env.CHROMIUM_CDP_PORT ?? 9223);
  const cdpHost = process.env.API_STREAMING_CDP_HOST ?? "127.0.0.1";
  const targetMatch = process.env.API_STREAMING_TARGET_URL_MATCH ?? "web.whatsapp.com";
  await assertCdpHasTarget(cdpHost, cdpPort, targetMatch);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v212-streaming-"));
  const dbPath = path.join(tempDir, "api.db");
  const db = openDb(dbPath);
  const screenshotPath = path.resolve("data", "v212-streaming-cdp-strong.png");

  try {
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });

    const env = loadApiEnv({
      API_LOG_LEVEL: "silent",
      NODE_ENV: "test",
      API_JWT_SECRET: "test-secret-with-more-than-16-chars",
      DATABASE_URL: dbPath,
      API_STREAMING_ENABLED: "true",
      API_STREAMING_CDP_HOST: cdpHost,
      API_STREAMING_CDP_PORT: String(cdpPort),
      API_STREAMING_TARGET_URL_MATCH: targetMatch,
      API_STREAMING_TIMEOUT_MS: "10000",
    });

    const app = await buildApiApp({ env, db, migrate: false });
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected API TCP address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const login = await trpcPost<{ csrfToken: string }>(baseUrl, "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);
      const csrfToken = login.data?.csrfToken;
      if (!cookies.includes("nuoma_access=") || !csrfToken) {
        throw new Error("Login did not return access cookie/csrf token");
      }

      const screencast = await trpcGet<ScreencastResult>(
        baseUrl,
        "streaming.startScreencast",
        cookies,
      );
      if (!screencast.data?.available || !screencast.data.sessionId || !screencast.data.image) {
        throw new Error(`Streaming unavailable: ${screencast.data?.reason ?? "unknown"}`);
      }
      if (!screencast.data.targetUrl?.includes(targetMatch)) {
        throw new Error(`Unexpected streaming target: ${screencast.data.targetUrl}`);
      }
      const png = decodePngDataUrl(screencast.data.image);
      if (png.byteLength < 10_000) {
        throw new Error(`Screenshot too small: ${png.byteLength} bytes`);
      }
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await fs.writeFile(screenshotPath, png);

      const click = await trpcPost<DispatchResult>(
        baseUrl,
        "streaming.dispatchInput",
        {
          sessionId: screencast.data.sessionId,
          type: "click",
          payload: { x: 2, y: 2 },
        },
        { cookie: cookies, csrfToken },
      );
      const key = await trpcPost<DispatchResult>(
        baseUrl,
        "streaming.dispatchInput",
        {
          sessionId: screencast.data.sessionId,
          type: "keydown",
          payload: { key: "Escape" },
        },
        { cookie: cookies, csrfToken },
      );
      if (!click.data?.accepted || !key.data?.accepted) {
        throw new Error(
          `Input relay failed: click=${click.data?.reason ?? "unknown"} key=${key.data?.reason ?? "unknown"}`,
        );
      }

      console.log(
        [
          "v212-streaming-cdp-strong",
          `target=${screencast.data.targetUrl}`,
          `bytes=${png.byteLength}`,
          `screenshot=${screenshotPath}`,
          "click=accepted",
          "keydown=accepted",
          "status=passed",
        ].join("|"),
      );
    } finally {
      await app.close();
    }
  } finally {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function assertCdpHasTarget(host: string, port: number, targetMatch: string): Promise<void> {
  const response = await fetch(`http://${host}:${port}/json`);
  if (!response.ok) {
    throw new Error(`CDP /json failed: ${response.status}`);
  }
  const targets = (await response.json()) as Array<{ type?: string; url?: string }>;
  if (!targets.some((target) => target.type === "page" && target.url?.includes(targetMatch))) {
    throw new Error(`CDP has no page target matching ${targetMatch}`);
  }
}

async function trpcGet<T>(
  baseUrl: string,
  procedure: string,
  cookie: string,
): Promise<TrpcResult<T>> {
  const response = await fetch(`${baseUrl}/trpc/${procedure}`, {
    headers: { cookie },
  });
  const bodyJson = (await response.json()) as { result?: { data?: { json?: T } } };
  return { data: bodyJson.result?.data?.json };
}

async function trpcPost<T>(
  baseUrl: string,
  procedure: string,
  input: unknown,
  options: { cookie?: string; csrfToken?: string } = {},
): Promise<TrpcResult<T>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrfToken) headers["x-csrf-token"] = options.csrfToken;
  const response = await fetch(`${baseUrl}/trpc/${procedure}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ json: input }),
  });
  const bodyJson = (await response.json()) as { result?: { data?: { json?: T } } };
  return {
    data: bodyJson.result?.data?.json,
    setCookie: response.headers.getSetCookie?.() ?? response.headers.get("set-cookie") ?? undefined,
  };
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((cookie) => cookie.split(";")[0]).join("; ");
}

function decodePngDataUrl(dataUrl: string): Buffer {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) {
    throw new Error("Screencast image is not a PNG data URL");
  }
  const png = Buffer.from(dataUrl.slice(prefix.length), "base64");
  if (png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
    throw new Error("Screencast image is not a PNG");
  }
  return png;
}

await main();
