import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import multipart, { type MultipartFields } from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ApiEnv } from "@nuoma/config";
import { mediaAssetTypeSchema, normalizePhone, type MediaAssetType } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { resolveCrmReadableFile, storeCrmFile } from "../services/crm-file-storage.js";
import { verifyMediaReadToken } from "../services/media-read-token.js";
import { optimizeMediaForStorage } from "../services/media-optimizer.js";
import { checkCsrf, verifyAccessToken } from "../trpc/auth.js";
import { ACCESS_COOKIE, readCookie } from "../trpc/cookies.js";

const maxUploadBytes = 100 * 1024 * 1024;

export async function registerMediaUploadRoutes(
  app: FastifyInstance,
  deps: { env: ApiEnv; repos: Repositories },
): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: maxUploadBytes,
      files: 1,
      fields: 8,
    },
  });

  app.post("/api/media/upload", async (request, reply) => {
    if (!checkCsrf(request)) {
      return reply.code(403).send({ error: "Invalid CSRF token" });
    }

    const user = await authenticateRequest(request, reply, deps.env);
    if (!user) {
      return reply;
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "Missing multipart file" });
    }

    const originalBuffer = await file.toBuffer();
    const type = inferMediaType(file.mimetype, fieldValue(file.fields, "type"));
    const durationMs = parseOptionalInteger(fieldValue(file.fields, "durationMs"));
    const sourceUrl = emptyToNull(fieldValue(file.fields, "sourceUrl"));
    const optimized = await optimizeMediaForStorage({
      env: deps.env,
      buffer: originalBuffer,
      fileName: file.filename,
      mimeType: file.mimetype || "application/octet-stream",
      type,
    });
    const sha256 = createHash("sha256").update(optimized.buffer).digest("hex");
    const existing = await deps.repos.mediaAssets.findBySha(user.id, sha256);
    if (existing) {
      return reply.send({
        asset: existing,
        deduped: true,
        optimization: optimized.optimization,
      });
    }

    const crmOwnerKey = await resolveCrmOwnerKey({
      repos: deps.repos,
      userId: user.id,
      fields: file.fields,
    });
    const crmStorage = crmOwnerKey
      ? await storeCrmFile({
          env: deps.env,
          ownerKey: crmOwnerKey,
          fileName: optimized.fileName,
          mimeType: optimized.mimeType,
          buffer: optimized.buffer,
        })
      : null;
    const storagePath =
      crmStorage?.storagePath ??
      (await writeMediaFile({
        env: deps.env,
        userId: user.id,
        sha256,
        fileName: optimized.fileName,
        buffer: optimized.buffer,
      }));

    const asset = await deps.repos.mediaAssets.create({
      userId: user.id,
      type,
      fileName: optimized.fileName || `${sha256}.bin`,
      mimeType: optimized.mimeType,
      sha256,
      sizeBytes: optimized.buffer.byteLength,
      durationMs,
      storagePath,
      sourceUrl,
      deletedAt: null,
    });
    await deps.repos.systemEvents.create({
      userId: user.id,
      type: "media.asset.write",
      severity: optimized.optimization.applied ? "info" : "debug",
      payload: JSON.stringify({
        assetId: asset.id,
        mediaType: asset.type,
        provider: crmStorage?.provider ?? "local",
        sizeBytes: asset.sizeBytes,
        optimization: optimized.optimization,
        source: "api.media.upload",
      }),
    });

    return reply.code(201).send({
      asset,
      deduped: false,
      optimization: optimized.optimization,
      storage: crmStorage
        ? {
            provider: crmStorage.provider,
            namespace: crmStorage.namespace,
            objectKey: crmStorage.objectKey,
            bucket: crmStorage.bucket,
          }
        : null,
    });
  });

  app.get("/api/media/assets/:id", async (request, reply) => {
    const mediaAssetId = Number((request.params as { id?: string }).id);
    if (!Number.isInteger(mediaAssetId) || mediaAssetId <= 0) {
      return reply.code(400).send({ error: "Invalid media asset id" });
    }
    const user = await authenticateMediaReadRequest(request, reply, deps.env, mediaAssetId);
    if (!user) {
      return reply;
    }

    const asset = await deps.repos.mediaAssets.findById({
      userId: user.id,
      id: mediaAssetId,
    });
    if (!asset || asset.deletedAt) {
      return reply.code(404).send({ error: "Media asset not found" });
    }
    if (asset.sourceUrl) {
      return reply.redirect(asset.sourceUrl);
    }
    if (asset.storagePath.startsWith("wa-visible://")) {
      return reply.code(404).send({ error: "Media asset is not locally readable" });
    }

    let resolvedPath: string;
    let cacheStatus: "hit" | "miss" | null = null;
    let resolvedProvider: "local" | "s3" = "local";
    try {
      const readable = await resolveCrmReadableFile({
        env: deps.env,
        storagePath: asset.storagePath,
      });
      resolvedPath = readable.localPath;
      resolvedProvider = readable.provider;
      cacheStatus = readable.provider === "s3" ? (readable.cached ? "hit" : "miss") : null;
    } catch {
      return reply.code(404).send({ error: "Media asset file not found" });
    }

    try {
      await fs.access(resolvedPath);
      reply
        .header("content-type", asset.mimeType)
        .header("cache-control", "private, max-age=300")
        .header("content-length", String(asset.sizeBytes));
      if (cacheStatus) {
        reply.header("x-nuoma-storage-cache", cacheStatus);
      }
      await deps.repos.systemEvents.create({
        userId: user.id,
        type: "media.asset.read",
        severity: "debug",
        payload: JSON.stringify({
          assetId: asset.id,
          mediaType: asset.type,
          provider: resolvedProvider,
          cacheStatus,
          source: "api.media.assets.read",
        }),
      });
      return reply.send(createReadStream(resolvedPath));
    } catch {
      return reply.code(404).send({ error: "Media asset file not found" });
    }
  });
}

async function authenticateMediaReadRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ApiEnv,
  mediaAssetId: number,
): Promise<{ id: number } | null> {
  const user = await authenticateRequest(request, reply, env, { silent: true });
  if (user) {
    return user;
  }

  const token = tokenFromQuery(request);
  if (token) {
    const verified = verifyMediaReadToken({ env, token, assetId: mediaAssetId });
    if (verified) {
      return { id: verified.userId };
    }
  }

  reply.code(401).send({ error: "Unauthorized" });
  return null;
}

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ApiEnv,
  options?: { silent?: boolean },
): Promise<{ id: number } | null> {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token) {
    if (!options?.silent) {
      reply.code(401).send({ error: "Unauthorized" });
    }
    return null;
  }
  try {
    return await verifyAccessToken(env, token);
  } catch {
    if (!options?.silent) {
      reply.code(401).send({ error: "Unauthorized" });
    }
    return null;
  }
}

function tokenFromQuery(request: FastifyRequest): string | null {
  const query = request.query as { token?: unknown };
  return typeof query.token === "string" && query.token.trim() ? query.token : null;
}

function inferMediaType(mimeType: string, explicitType?: string): MediaAssetType {
  const parsedType = mediaAssetTypeSchema.safeParse(explicitType);
  if (parsedType.success) {
    return parsedType.data;
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function fieldValue(fields: MultipartFields, name: string): string | undefined {
  const field = fields[name];
  const value = Array.isArray(field) ? field[0] : field;
  if (!value || value.type !== "field") {
    return undefined;
  }
  return typeof value.value === "string" ? value.value : String(value.value);
}

function parseOptionalInteger(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function emptyToNull(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function resolveCrmOwnerKey(input: {
  repos: Repositories;
  userId: number;
  fields: MultipartFields;
}): Promise<string | null> {
  const explicitOwnerKey = emptyToNull(fieldValue(input.fields, "crmOwnerKey"));
  if (explicitOwnerKey) {
    return explicitOwnerKey;
  }

  const conversationId = parseOptionalInteger(fieldValue(input.fields, "conversationId"));
  if (!conversationId) {
    return null;
  }

  const conversation = await input.repos.conversations.findById({
    userId: input.userId,
    id: conversationId,
  });
  if (!conversation) {
    return null;
  }
  const phone =
    normalizePhone(conversation.waJid) ?? normalizePhone(conversation.externalThreadId) ?? "";
  if (phone.length >= 8) {
    return phone;
  }
  return conversation.contactId
    ? `contact-${conversation.contactId}`
    : `conversation-${conversation.id}`;
}

async function writeMediaFile(input: {
  env: ApiEnv;
  userId: number;
  sha256: string;
  fileName: string;
  buffer: Buffer;
}): Promise<string> {
  const root = mediaStorageRoot(input.env);
  const userDir = path.join(root, String(input.userId));
  await fs.mkdir(userDir, { recursive: true });
  const extension = safeExtension(input.fileName);
  const targetPath = path.join(userDir, `${input.sha256}${extension}`);
  await fs.writeFile(targetPath, input.buffer);
  return targetPath;
}

function mediaStorageRoot(env: ApiEnv): string {
  if (env.DATABASE_URL !== ":memory:") {
    return path.resolve(path.dirname(env.DATABASE_URL), "media-assets");
  }
  return path.resolve(process.cwd(), "data", "media-assets");
}

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return /^[a-z0-9.]{1,16}$/.test(extension) ? extension : "";
}
