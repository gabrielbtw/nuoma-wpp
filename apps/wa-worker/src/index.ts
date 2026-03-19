import { createLogger, recordSystemEvent } from "@nuoma/core";
import { WhatsAppWorker } from "./worker.js";

const logger = createLogger("wa-worker");

async function start() {
  const worker = new WhatsAppWorker();
  let shuttingDown = false;

  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "Stopping WhatsApp worker");
    recordSystemEvent("wa-worker", "info", "Stopping WhatsApp worker", {
      signal
    });
    await worker.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await worker.start();
}

start().catch((error) => {
  logger.error({ err: error }, "Failed to start WhatsApp worker");
  recordSystemEvent("wa-worker", "error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
