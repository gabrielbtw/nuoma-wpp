import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { WorkerEnv } from "@nuoma/config";
import type { BrowserContext } from "playwright";
import { chromium } from "playwright";
import type { Logger } from "pino";

import { startXvfbIfNeeded, type XvfbRuntime } from "./infra/xvfb.js";

export interface BrowserRuntime {
  connected: boolean;
  close: () => Promise<void>;
  restart: () => Promise<void>;
}

export async function startBrowserRuntime(input: {
  env: WorkerEnv;
  logger: Logger;
}): Promise<BrowserRuntime> {
  if (!input.env.WORKER_BROWSER_ENABLED) {
    input.logger.info("worker browser disabled by WORKER_BROWSER_ENABLED=false");
    return {
      connected: false,
      close: async () => {},
      restart: async () => {},
    };
  }

  let xvfb: XvfbRuntime | null = null;
  let context: BrowserContext | null = null;
  let attachedToExisting = false;

  async function launch() {
    if (
      input.env.WORKER_BROWSER_ATTACH_EXISTING &&
      (await hasExistingCdpBrowser(input.env).catch(() => false))
    ) {
      attachedToExisting = true;
      input.logger.info(
        {
          cdpHost: input.env.CHROMIUM_CDP_HOST,
          cdpPort: input.env.CHROMIUM_CDP_PORT,
        },
        "worker browser attached to existing CDP session",
      );
      return;
    }

    if (input.env.WORKER_KEEP_BROWSER_OPEN) {
      xvfb = await startXvfbIfNeeded({
        enabled: !input.env.WORKER_HEADLESS,
        logger: input.logger,
      });
      await fs.mkdir(input.env.CHROMIUM_PROFILE_DIR, { recursive: true });
      await removeStaleChromiumProfileLocks({
        profileDir: input.env.CHROMIUM_PROFILE_DIR,
        logger: input.logger,
      });
      const args = [
        `--user-data-dir=${input.env.CHROMIUM_PROFILE_DIR}`,
        `--remote-debugging-port=${input.env.CHROMIUM_CDP_PORT}`,
        `--remote-debugging-address=${input.env.CHROMIUM_CDP_BIND_HOST ?? input.env.CHROMIUM_CDP_HOST}`,
        "--window-size=1366,768",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-client-side-phishing-detection",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-features=Translate,BackForwardCache",
        "--disable-popup-blocking",
        "--disable-renderer-backgrounding",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
      ];
      if (input.env.WORKER_HEADLESS) {
        args.push("--headless=new");
      }
      if (input.env.WORKER_SYNC_ENABLED) {
        args.push(input.env.WA_WEB_URL);
      }

      const child = spawn(chromium.executablePath(), args, {
        detached: true,
        env: {
          ...process.env,
          ...(xvfb?.display ? { DISPLAY: xvfb.display } : {}),
        },
        stdio: "ignore",
      });
      child.unref();
      await waitForExistingCdpBrowser(input.env);
      attachedToExisting = true;
      input.logger.info(
        {
          profileDir: input.env.CHROMIUM_PROFILE_DIR,
          cdpHost: input.env.CHROMIUM_CDP_HOST,
          cdpBindHost: input.env.CHROMIUM_CDP_BIND_HOST ?? input.env.CHROMIUM_CDP_HOST,
          cdpPort: input.env.CHROMIUM_CDP_PORT,
          headless: input.env.WORKER_HEADLESS,
          display: xvfb.display,
          pid: child.pid,
        },
        "worker browser launched as detached CDP session",
      );
      return;
    }

    xvfb = await startXvfbIfNeeded({
      enabled: !input.env.WORKER_HEADLESS,
      logger: input.logger,
    });
    await fs.mkdir(input.env.CHROMIUM_PROFILE_DIR, { recursive: true });
    await removeStaleChromiumProfileLocks({
      profileDir: input.env.CHROMIUM_PROFILE_DIR,
      logger: input.logger,
    });
    context = await chromium.launchPersistentContext(input.env.CHROMIUM_PROFILE_DIR, {
      headless: input.env.WORKER_HEADLESS,
      viewport: { width: 1366, height: 768 },
      args: [
        `--remote-debugging-port=${input.env.CHROMIUM_CDP_PORT}`,
        `--remote-debugging-address=${input.env.CHROMIUM_CDP_BIND_HOST ?? input.env.CHROMIUM_CDP_HOST}`,
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-client-side-phishing-detection",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-features=Translate,BackForwardCache",
        "--disable-popup-blocking",
        "--disable-renderer-backgrounding",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
      ],
    });
    if (input.env.WORKER_SYNC_ENABLED) {
      const page = context.pages()[0] ?? (await context.newPage());
      if (!page.url().startsWith(input.env.WA_WEB_URL)) {
        await page.goto(input.env.WA_WEB_URL, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
      }
      input.logger.info({ url: input.env.WA_WEB_URL }, "worker browser opened WhatsApp Web");
    }
    input.logger.info(
      {
        profileDir: input.env.CHROMIUM_PROFILE_DIR,
        cdpHost: input.env.CHROMIUM_CDP_HOST,
        cdpBindHost: input.env.CHROMIUM_CDP_BIND_HOST ?? input.env.CHROMIUM_CDP_HOST,
        cdpPort: input.env.CHROMIUM_CDP_PORT,
        headless: input.env.WORKER_HEADLESS,
        display: xvfb.display,
      },
      "worker browser launched",
    );
  }

  async function close() {
    if (attachedToExisting || input.env.WORKER_KEEP_BROWSER_OPEN) {
      input.logger.info(
        {
          attachedToExisting,
          keepBrowserOpen: input.env.WORKER_KEEP_BROWSER_OPEN,
        },
        "worker browser left open to preserve WhatsApp session",
      );
      return;
    }
    await context?.close().catch((error: unknown) => {
      input.logger.warn({ error }, "browser context close failed");
    });
    context = null;
    await xvfb?.close();
    xvfb = null;
  }

  await launch();

  return {
    get connected() {
      return attachedToExisting || Boolean(context);
    },
    close,
    restart: async () => {
      input.logger.warn("restarting worker browser runtime");
      attachedToExisting = false;
      await close();
      await launch();
    },
  };
}

async function hasExistingCdpBrowser(env: WorkerEnv): Promise<boolean> {
  const response = await fetch(
    `http://${env.CHROMIUM_CDP_HOST}:${env.CHROMIUM_CDP_PORT}/json/version`,
    {
      signal: AbortSignal.timeout(1000),
    },
  );
  return response.ok;
}

async function waitForExistingCdpBrowser(env: WorkerEnv, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await hasExistingCdpBrowser(env)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Chromium CDP did not become ready: ${String(lastError)}`);
}

async function removeStaleChromiumProfileLocks(input: {
  profileDir: string;
  logger: Logger;
}): Promise<void> {
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"];
  const removed: string[] = [];
  for (const fileName of lockFiles) {
    const filePath = `${input.profileDir}/${fileName}`;
    try {
      await fs.unlink(filePath);
      removed.push(fileName);
    } catch (error) {
      if (!isNodeFileNotFoundError(error)) {
        input.logger.warn({ error, filePath }, "failed to remove Chromium profile lock");
      }
    }
  }
  if (removed.length > 0) {
    input.logger.info({ profileDir: input.profileDir, removed }, "removed stale Chromium profile locks");
  }
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
