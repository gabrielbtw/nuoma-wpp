import { loadApiEnv } from "@nuoma/config";

import { buildApiApp } from "./app.js";

const env = loadApiEnv();
const app = await buildApiApp({ env });

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error({ error }, "api startup failed");
  process.exit(1);
}
