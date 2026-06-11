import path from "node:path";
import pino from "pino";
import { loadEnv } from "../config/env.js";
import { ensureRuntimeDirectories } from "./fs.js";

const loggerCache = new Map<string, pino.Logger>();

export function createLogger(processName: string) {
  if (loggerCache.has(processName)) {
    return loggerCache.get(processName)!;
  }

  const env = loadEnv();
  ensureRuntimeDirectories();

  const destination = pino.destination({
    dest: path.join(env.LOG_DIR, `${processName}.log`),
    mkdir: true,
    sync: false
  });

  const logger = pino(
    {
      name: processName,
      level: env.LOG_LEVEL,
      base: {
        process: processName
      },
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.multistream([
      { stream: process.stdout },
      { stream: destination }
    ])
  );

  loggerCache.set(processName, logger);
  return logger;
}
