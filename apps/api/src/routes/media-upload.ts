import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import multipart, { type MultipartFields } from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ApiEnv } from "@nuoma/config";
import { mediaAssetTypeSchema, type MediaAssetType } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { resolveCrmReadableFile, storeCrmFile } from "../services/crm-file-storage.js";
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

    const buffer = await file.toBuffer();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const existing = await deps.repos.mediaAssets.findBySha(user.id, sha256);
    if (existing) {
      return reply.send({ asset: existing, deduped: true });
    }

    const type = inferMediaType(file.mimetype, fieldValue(file.fields, "type"));
    const durationMs = parseOptionalInteger(fieldValue(file.fields, "durationMs"));
    const sourceUrl = emptyToNull(fieldValue(file.fields, "sourceUrl"));
    const crmOwnerKey = await resolveCrmOwnerKey({
      repos: deps.repos,
      userId: user.id,
      fields: file.fields,
    });
    const crmStorage = crmOwnerKey
      ? await storeCrmFile({
          env: deps.env,
          ownerKey: crmOwnerKey,
          fileName: file.filename,
          mimeType: file.mimetype || "application/octet-stream",
          buffer,
        })
      : null;
    const storagePath =
      crmStorage?.storagePath ??
      (await writeMediaFile({
        env: deps.env,
        userId: user.id,
        sha256,
        fileName: file.filename,
        buffer,
      }));

    const asset = await deps.repos.mediaAssets.create({
      userId: user.id,
      type,
      fileName: file.filename || `${sha256}.bin`,
      mimeType: file.mimetype || "application/octet-stream",
      sha256,
      sizeBytes: buffer.byteLength,
      durationMs,
      storagePath,
      sourceUrl,
      deletedAt: null,
    });

    return reply.code(201).send({
      asset,
      deduped: false,
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
    const user = await authenticateRequest(request, reply, deps.env);
    if (!user) {
      return reply;
    }

    const mediaAssetId = Number((request.params as { id?: string }).id);
    if (!Number.isInteger(mediaAssetId) || mediaAssetId <= 0) {
      return reply.code(400).send({ error: "Invalid media asset id" });
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
    try {
      const readable = await resolveCrmReadableFile({
        env: deps.env,
        storagePath: asset.storagePath,
      });
      resolvedPath = readable.localPath;
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
      return reply.send(createReadStream(resolvedPath));
    } catch {
      return reply.code(404).send({ error: "Media asset file not found" });
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
  const phone = conversation.externalThreadId.replace(/\D/g, "");
  if (phone.length >= 8) {
    return phone;
  }
  return conversation.contactId ? `contact-${conversation.contactId}` : `conversation-${conversation.id}`;
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
