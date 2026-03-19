import { randomUUID, createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { parse as parseCsv } from "csv-parse/sync";
import { InputError, createOrReuseMediaAsset, ensureRuntimeDirectories, loadEnv, looksLikeValidWhatsAppCandidate, normalizeBrazilianPhone } from "@nuoma/core";

const MEDIA_MIME_PREFIXES = ["audio/", "image/", "video/"];
const CSV_MIME_TYPES = ["text/csv", "application/vnd.ms-excel", "text/plain"];
const CSV_UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFileName(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

function mimeBucket(mimeType: string) {
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  return "file";
}

function getCsvUploadsDirectory() {
  const env = loadEnv();
  return path.join(env.UPLOADS_DIR, "csv");
}

function assertValidCsvUploadId(uploadId: string) {
  const normalized = uploadId.trim();
  if (!CSV_UPLOAD_ID_PATTERN.test(normalized)) {
    throw new InputError("Referência do CSV inválida.");
  }

  return normalized.toLowerCase();
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function saveMediaUpload(
  file: MultipartFile,
  options?: { scope?: "campaign" | "automation" | "temp"; campaignId?: string; automationId?: string }
) {
  const env = loadEnv();
  ensureRuntimeDirectories();

  if (!MEDIA_MIME_PREFIXES.some((prefix) => (file.mimetype ?? "").startsWith(prefix))) {
    throw new Error("Tipo de mídia inválido. Envie áudio, imagem ou vídeo.");
  }

  const bucket = mimeBucket(file.mimetype);
  const scope = options?.scope ?? "temp";
  const baseDir = path.join(env.UPLOADS_DIR, "media", scope, bucket, options?.campaignId ?? options?.automationId ?? "shared");
  await fs.mkdir(baseDir, { recursive: true });

  const tempPath = path.join(env.TEMP_DIR, `${Date.now()}-${safeFileName(file.filename)}`);
  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  await pipeline(file.file, createWriteStream(tempPath));

  const stats = await fs.stat(tempPath);
  const sha256 = await hashFile(tempPath);
  const finalName = `${sha256.slice(0, 12)}-${safeFileName(file.filename)}`;
  const finalPath = path.join(baseDir, finalName);

  const existing = createOrReuseMediaAsset({
    sha256,
    originalName: file.filename,
    safeName: finalName,
    mimeType: file.mimetype,
    sizeBytes: stats.size,
    category: scope,
    storagePath: finalPath,
    linkedCampaignId: options?.campaignId ?? null,
    linkedAutomationId: options?.automationId ?? null
  });

  if (existing && existing.storage_path && existing.storage_path !== finalPath) {
    await fs.rm(tempPath, { force: true });
    return existing;
  }

  await fs.rename(tempPath, finalPath);
  return createOrReuseMediaAsset({
    sha256,
    originalName: file.filename,
    safeName: finalName,
    mimeType: file.mimetype,
    sizeBytes: stats.size,
    category: scope,
    storagePath: finalPath,
    linkedCampaignId: options?.campaignId ?? null,
    linkedAutomationId: options?.automationId ?? null
  });
}

export async function saveCsvUpload(file: MultipartFile) {
  ensureRuntimeDirectories();

  if (!CSV_MIME_TYPES.includes(file.mimetype)) {
    throw new Error("Arquivo CSV inválido.");
  }

  const directory = getCsvUploadsDirectory();
  await fs.mkdir(directory, { recursive: true });
  const uploadId = randomUUID();
  const filePath = path.join(directory, `${uploadId}.csv`);
  await pipeline(file.file, createWriteStream(filePath));

  const raw = await fs.readFile(filePath, "utf8");
  const records = parseCsv(raw, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Array<Record<string, string>>;

  const headers = Object.keys(records[0] ?? {});
  return {
    uploadId,
    headers,
    preview: records.slice(0, 20).map((row) => {
      const phoneKey = Object.keys(row).find((key) => ["phone", "telefone", "celular", "whatsapp", "numero", "número"].includes(key.toLowerCase()));
      const originalPhone = phoneKey ? row[phoneKey] : "";
      const normalizedPhone = originalPhone ? normalizeBrazilianPhone(originalPhone) : null;
      return {
        ...row,
        _normalizedPhone: normalizedPhone,
        _phoneLooksValid: normalizedPhone ? looksLikeValidWhatsAppCandidate(normalizedPhone) : false
      };
    }),
    totalRows: records.length
  };
}

export async function resolveCsvUploadPath(uploadId: string) {
  ensureRuntimeDirectories();
  const safeUploadId = assertValidCsvUploadId(uploadId);
  const directory = getCsvUploadsDirectory();
  const resolvedDirectory = path.resolve(directory);
  const resolvedFilePath = path.resolve(directory, `${safeUploadId}.csv`);

  if (!resolvedFilePath.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new InputError("Referência do CSV inválida.");
  }

  if (!existsSync(resolvedFilePath)) {
    throw new InputError("CSV não encontrado. Reenvie o arquivo.");
  }

  return resolvedFilePath;
}

export async function parseCsvFile(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return parseCsv(raw, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Array<Record<string, string>>;
}
