import { createLogger, getDb, loadEnv, recordSystemEvent, setWorkerState } from "@nuoma/core";
import { createApp } from "./app.js";

const env = loadEnv();
const logger = createLogger("web-app");

async function start() {
  getDb();
  setWorkerState("web-app", {
    status: "online",
    startedAt: new Date().toISOString()
  });

  const app = await createApp();
  await app.listen({
    host: env.APP_HOST,
    port: env.APP_PORT
  });

  recordSystemEvent("web-app", "info", "Web app started", {
    host: env.APP_HOST,
    port: env.APP_PORT
  });
  logger.info({ host: env.APP_HOST, port: env.APP_PORT }, "Web app listening");
}

start().catch((error) => {
  logger.error({ err: error }, "Failed to start web app");
  recordSystemEvent("web-app", "error", error.message, {
    stack: error.stack
  });
  process.exit(1);
});
