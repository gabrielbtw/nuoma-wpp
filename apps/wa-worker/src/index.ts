import { createLogger, recordSystemEvent } from "@nuoma/core";
import { WhatsAppWorker } from "./worker.js";

const logger = createLogger("wa-worker");

async function start() {
  const worker = new WhatsAppWorker();
  await worker.start();
}

start().catch((error) => {
  logger.error({ err: error }, "Failed to start WhatsApp worker");
  recordSystemEvent("wa-worker", "error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
