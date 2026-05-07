import { createReadStream } from "node:fs";
import * as path from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ApiEnv } from "@nuoma/config";

import { resolveEvidenceFile } from "../services/evidence-center.js";
import { verifyAccessToken } from "../trpc/auth.js";
import { ACCESS_COOKIE, readCookie } from "../trpc/cookies.js";

export async function registerEvidenceFileRoutes(
  app: FastifyInstance,
  deps: { env: ApiEnv },
): Promise<void> {
  app.get("/api/evidence/file", async (request, reply) => {
    const user = await authenticateRequest(request, reply, deps.env);
    if (!user) {
      return reply;
    }

    const encodedPath = String((request.query as { path?: string }).path ?? "");
    if (!encodedPath) {
      return reply.code(400).send({ error: "Missing evidence path" });
    }

    try {
      const file = await resolveEvidenceFile(encodedPath);
      reply
        .header("content-type", file.contentType)
        .header("cache-control", "private, max-age=120")
        .header("content-length", String(file.sizeBytes))
        .header(
          "content-disposition",
          `inline; filename="${path.basename(file.relativePath).replaceAll('"', "")}"`,
        );
      return reply.send(createReadStream(file.absolutePath));
    } catch {
      return reply.code(404).send({ error: "Evidence file not found" });
    }
  });
}

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ApiEnv,
): Promise<{ id: number } | null> {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  try {
    return await verifyAccessToken(env, token);
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
}
