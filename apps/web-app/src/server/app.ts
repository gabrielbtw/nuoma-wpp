import path from "node:path";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import middie from "@fastify/middie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { createLogger, ensureRuntimeDirectories, isInputError, loadEnv, recordSystemEvent } from "@nuoma/core";
import { registerRoutes } from "./routes/index.js";

export async function createApp() {
  const env = loadEnv();
  ensureRuntimeDirectories();
  const logger = createLogger("web-app");
  const app = Fastify({
    logger: false,
    bodyLimit: env.MAX_UPLOAD_MB * 1024 * 1024
  });

  await app.register(cors, { origin: true });
  await app.register(middie);
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
      files: 2
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const isValidationError = error instanceof ZodError;
    const isInputValidationError = isInputError(error);
    const message = isValidationError
      ? error.issues[0]?.message || "Dados inválidos"
      : error instanceof Error
        ? error.message
        : "Erro interno";
    logger.error({ err: error }, "Request error");
    recordSystemEvent("web-app", "error", message, {
      stack: error instanceof Error ? error.stack : undefined
    });
    reply.code(isValidationError || isInputValidationError ? 400 : 500).send({
      message
    });
  });

  await registerRoutes(app);

  if (env.NODE_ENV === "development") {
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: path.join(env.PROJECT_ROOT, "apps/web-app/vite.config.ts"),
      server: {
        middlewareMode: true
      },
      appType: "custom"
    });
    app.use(vite.middlewares as any);
    app.get("/", async (_request, reply) => {
      const html = await readFile(path.join(env.PROJECT_ROOT, "apps/web-app/index.html"), "utf8");
      const transformed = await vite.transformIndexHtml("/", html);
      reply.type("text/html").send(transformed);
    });
  } else {
    const clientRoot = path.join(env.PROJECT_ROOT, "apps/web-app/dist/client");
    await app.register(fastifyStatic, {
      root: clientRoot
    });
    app.get("/", async (_request, reply) => {
      const html = await readFile(path.join(clientRoot, "index.html"), "utf8");
      reply.type("text/html").send(html);
    });
  }

  return app;
}
