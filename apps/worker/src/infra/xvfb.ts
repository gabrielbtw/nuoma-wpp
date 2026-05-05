import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import type { Logger } from "pino";

export interface XvfbRuntime {
  display: string | null;
  close: () => Promise<void>;
}

export async function startXvfbIfNeeded(input: {
  enabled: boolean;
  logger: Logger;
  display?: string;
}): Promise<XvfbRuntime> {
  if (!input.enabled || process.env.DISPLAY) {
    return {
      display: process.env.DISPLAY ?? null,
      close: async () => {},
    };
  }

  const display = input.display ?? ":99";
  let child: ChildProcess | null = null;

  try {
    child = spawn("Xvfb", [display, "-screen", "0", "1366x768x24"], {
      stdio: "ignore",
    });
  } catch (error) {
    input.logger.warn({ error }, "Xvfb unavailable; browser launch may require headless=true");
    return { display: null, close: async () => {} };
  }

  let failed = false;
  child.once("error", (error) => {
    failed = true;
    input.logger.warn({ error }, "Xvfb process failed to start");
  });

  await sleep(250);
  if (failed) {
    return { display: null, close: async () => {} };
  }

  process.env.DISPLAY = display;
  input.logger.info({ display }, "Xvfb started for worker browser");

  return {
    display,
    close: async () => {
      if (!child || child.killed) {
        return;
      }
      child.kill("SIGTERM");
      await sleep(100);
    },
  };
}
