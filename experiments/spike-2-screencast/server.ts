import CDP from "chrome-remote-interface";
import { createServer, type IncomingMessage } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { WebSocket, WebSocketServer } from "ws";

const EXPERIMENT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(EXPERIMENT_ROOT, "../..");
const CLIENT_PATH = path.join(EXPERIMENT_ROOT, "client.html");
const METRICS_PATH = path.join(EXPERIMENT_ROOT, "metrics.jsonl");

type Options = {
  host: string;
  port: number;
  cdpHost: string;
  cdpPort: number;
  launch: boolean;
  profileDir: string;
  channel: string;
  headless: boolean;
  waUrl: string;
};

type InputPayload =
  | { type: "mouse"; eventType: "mousePressed" | "mouseReleased" | "mouseMoved"; x: number; y: number; button: "left" | "right"; clickCount: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; eventType: "keyDown" | "keyUp"; key: string; code: string; text?: string };

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function resolveRepoPath(value: string | undefined, fallback: string) {
  const target = value?.trim() || fallback;
  return path.isAbsolute(target) ? target : path.resolve(REPO_ROOT, target);
}

function parseOptions(argv: string[]): Options {
  let host = process.env.SPIKE2_HOST ?? "127.0.0.1";
  let port = Number(process.env.SPIKE2_PORT ?? "9322");
  let cdpHost = process.env.CHROMIUM_CDP_HOST ?? "127.0.0.1";
  let cdpPort = Number(process.env.SPIKE2_CDP_PORT ?? process.env.CHROMIUM_CDP_PORT ?? "9234");
  let launch = false;
  let profileDir = resolveRepoPath(process.env.CHROMIUM_PROFILE_DIR, "storage/chromium-profile/whatsapp");
  let channel = process.env.SPIKE2_CHROMIUM_CHANNEL ?? process.env.CHROMIUM_CHANNEL ?? "chrome";
  let headless = parseBoolean(process.env.CHROMIUM_HEADLESS, false);
  let waUrl = process.env.WA_URL ?? "https://web.whatsapp.com";

  for (const arg of argv) {
    if (arg === "--launch") launch = true;
    else if (arg === "--headless") headless = true;
    else if (arg === "--headed") headless = false;
    else if (arg.startsWith("--host=")) host = arg.slice("--host=".length);
    else if (arg.startsWith("--port=")) port = Number(arg.slice("--port=".length));
    else if (arg.startsWith("--cdp-host=")) cdpHost = arg.slice("--cdp-host=".length);
    else if (arg.startsWith("--cdp-port=")) cdpPort = Number(arg.slice("--cdp-port=".length));
    else if (arg.startsWith("--profile-dir=")) profileDir = resolveRepoPath(arg.slice("--profile-dir=".length), "storage/chromium-profile/whatsapp");
    else if (arg.startsWith("--channel=")) channel = arg.slice("--channel=".length);
    else if (arg.startsWith("--wa-url=")) waUrl = arg.slice("--wa-url=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid HTTP port: ${port}`);
  if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65_535) throw new Error(`Invalid CDP port: ${cdpPort}`);

  return { host, port, cdpHost, cdpPort, launch, profileDir, channel, headless, waUrl };
}

async function appendMetric(event: Record<string, unknown>) {
  await fs.appendFile(METRICS_PATH, `${JSON.stringify({ createdAt: new Date().toISOString(), ...event })}\n`, "utf8").catch(() => null);
}

async function launchChromium(options: Options) {
  await fs.mkdir(options.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(options.profileDir, {
    channel: options.channel,
    headless: options.headless,
    viewport: null,
    args: [
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--window-size=1512,920",
      "--force-device-scale-factor=1",
      `--remote-debugging-address=${options.cdpHost}`,
      `--remote-debugging-port=${options.cdpPort}`
    ]
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(options.waUrl, { waitUntil: "domcontentloaded" });
  return context;
}

async function selectPageTarget(options: Options) {
  const targets = await CDP.List({ host: options.cdpHost, port: options.cdpPort });
  const pageTarget = targets.find((target) => target.type === "page" && !target.url.startsWith("devtools://"));
  if (pageTarget) return pageTarget;
  return CDP.New({ host: options.cdpHost, port: options.cdpPort, url: options.waUrl });
}

function parseJsonMessage(raw: WebSocket.RawData): InputPayload | null {
  try {
    return JSON.parse(raw.toString()) as InputPayload;
  } catch {
    return null;
  }
}

async function dispatchInput(client: any, payload: InputPayload) {
  if (payload.type === "mouse") {
    await client.Input.dispatchMouseEvent({
      type: payload.eventType,
      x: payload.x,
      y: payload.y,
      button: payload.button,
      clickCount: payload.clickCount
    });
    return;
  }

  if (payload.type === "wheel") {
    await client.Input.dispatchMouseEvent({
      type: "mouseWheel",
      x: payload.x,
      y: payload.y,
      deltaX: payload.deltaX,
      deltaY: payload.deltaY
    });
    return;
  }

  await client.Input.dispatchKeyEvent({
    type: payload.eventType,
    key: payload.key,
    code: payload.code,
    text: payload.eventType === "keyDown" ? payload.text : undefined
  });
}

async function startRelay(ws: WebSocket, options: Options) {
  const target = await selectPageTarget(options);
  const client: any = await CDP({ host: options.cdpHost, port: options.cdpPort, target });
  let frames = 0;
  let bytes = 0;
  const startedAt = Date.now();

  await client.Page.enable();
  await client.Runtime.enable();
  await client.Page.bringToFront().catch(() => null);
  await client.Input.setIgnoreInputEvents({ ignore: false }).catch(() => null);

  client.Page.screencastFrame(async (event: { data: string; metadata: Record<string, unknown>; sessionId: number }) => {
    frames += 1;
    bytes += Math.ceil((event.data.length * 3) / 4);
    client.Page.screencastFrameAck({ sessionId: event.sessionId }).catch(() => null);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "frame",
          data: event.data,
          metadata: event.metadata,
          sentAt: Date.now()
        })
      );
    }
  });

  ws.on("message", (raw) => {
    const payload = parseJsonMessage(raw);
    if (!payload) return;
    dispatchInput(client, payload).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      appendMetric({ type: "input-error", message }).catch(() => null);
    });
  });

  ws.on("close", () => {
    const durationMs = Date.now() - startedAt;
    appendMetric({ type: "relay-closed", durationMs, frames, bytes }).catch(() => null);
    client.Page.stopScreencast().catch(() => null);
    client.close().catch(() => null);
  });

  await client.Page.startScreencast({
    format: "jpeg",
    quality: 80,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1
  });

  await appendMetric({
    type: "relay-started",
    targetId: target.id,
    targetUrl: target.url
  });
}

function requestPath(request: IncomingMessage) {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`).pathname;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  let launchedContext: BrowserContext | null = null;

  if (options.launch) {
    launchedContext = await launchChromium(options);
  }

  const server = createServer(async (request, response) => {
    const pathname = requestPath(request);
    if (pathname === "/" || pathname === "/client.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await fs.readFile(CLIENT_PATH, "utf8"));
      return;
    }

    if (pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, cdpHost: options.cdpHost, cdpPort: options.cdpPort }));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => {
    startRelay(ws, options).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message }));
      }
      ws.close();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (requestPath(request) !== "/ws/screencast") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));

  console.log(`spike-2 server listening: http://${options.host}:${options.port}`);
  console.log(`cdp=${options.cdpHost}:${options.cdpPort} launch=${options.launch}`);

  const shutdown = async () => {
    wss.close();
    server.close();
    await launchedContext?.close().catch(() => null);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown().catch(() => process.exit(1));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
