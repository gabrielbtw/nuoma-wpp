import { createHash, createHmac } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ApiEnv } from "@nuoma/config";

export interface StoreCrmFileInput {
  env: ApiEnv;
  ownerKey: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export interface StoredCrmFile {
  provider: "local" | "s3";
  namespace: string;
  objectKey: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  bucket: string | null;
  localPath: string | null;
}

export interface ResolveCrmReadableFileInput {
  env: ApiEnv;
  storagePath: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export interface ResolvedCrmReadableFile {
  localPath: string;
  cached: boolean;
  provider: "local" | "s3";
  bucket: string | null;
  objectKey: string | null;
}

export async function storeCrmFile(input: StoreCrmFileInput): Promise<StoredCrmFile> {
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const namespace = crmNamespace(input.env, input.ownerKey);
  const objectKey = `${namespace.slice(1)}${sha256}${safeExtension(input.fileName)}`;

  if (input.env.API_CRM_STORAGE_PROVIDER === "s3") {
    const storagePath = await putS3Object({
      env: input.env,
      objectKey,
      body: input.buffer,
      contentType: input.mimeType || "application/octet-stream",
      now: input.now ?? new Date(),
      fetchImpl: input.fetchImpl ?? fetch,
    });
    return {
      provider: "s3",
      namespace,
      objectKey,
      storagePath,
      sha256,
      sizeBytes: input.buffer.byteLength,
      bucket: requireS3Bucket(input.env),
      localPath: null,
    };
  }

  const localRoot = crmLocalRoot(input.env);
  const targetPath = path.join(localRoot, objectKey);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, input.buffer);
  return {
    provider: "local",
    namespace,
    objectKey,
    storagePath: targetPath,
    sha256,
    sizeBytes: input.buffer.byteLength,
    bucket: null,
    localPath: targetPath,
  };
}

export async function resolveCrmReadableFile(
  input: ResolveCrmReadableFileInput,
): Promise<ResolvedCrmReadableFile> {
  if (!input.storagePath.startsWith("s3://")) {
    return {
      localPath: path.isAbsolute(input.storagePath)
        ? input.storagePath
        : path.resolve(process.cwd(), input.storagePath),
      cached: false,
      provider: "local",
      bucket: null,
      objectKey: null,
    };
  }

  const parsed = parseS3StoragePath(input.storagePath);
  const expectedBucket = requireS3Bucket(input.env);
  if (parsed.bucket !== expectedBucket) {
    throw new Error("CRM S3 storage bucket mismatch");
  }

  const localPath = path.join(crmCacheRoot(input.env), parsed.bucket, safeObjectKey(parsed.objectKey));
  try {
    await fs.access(localPath);
    return {
      localPath,
      cached: true,
      provider: "s3",
      bucket: parsed.bucket,
      objectKey: parsed.objectKey,
    };
  } catch {
    // Cache miss; download below.
  }

  await getS3Object({
    env: input.env,
    objectKey: parsed.objectKey,
    targetPath: localPath,
    now: input.now ?? new Date(),
    fetchImpl: input.fetchImpl ?? fetch,
  });

  return {
    localPath,
    cached: false,
    provider: "s3",
    bucket: parsed.bucket,
    objectKey: parsed.objectKey,
  };
}

export function crmNamespace(env: ApiEnv, ownerKey: string): string {
  const namespace = sanitizeNamespace(env.API_CRM_STORAGE_NAMESPACE);
  const owner = normalizeCrmOwnerKey(ownerKey);
  return `/${namespace}/${owner}/`;
}

export function normalizeCrmOwnerKey(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    return digits;
  }
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "unknown";
}

export function crmLocalRoot(env: ApiEnv): string {
  if (env.API_CRM_STORAGE_LOCAL_ROOT) {
    return path.resolve(env.API_CRM_STORAGE_LOCAL_ROOT);
  }
  if (env.DATABASE_URL !== ":memory:") {
    return path.resolve(path.dirname(env.DATABASE_URL), "crm-files");
  }
  return path.resolve(process.cwd(), "data", "crm-files");
}

export function crmCacheRoot(env: ApiEnv): string {
  if (env.API_CRM_STORAGE_CACHE_ROOT) {
    return path.resolve(env.API_CRM_STORAGE_CACHE_ROOT);
  }
  return path.resolve(crmLocalRoot(env), ".cache");
}

function sanitizeNamespace(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => normalizeCrmOwnerKey(part))
    .filter(Boolean)
    .join("/");
  return normalized || "nuoma/files/crm";
}

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return /^[a-z0-9.]{1,16}$/.test(extension) ? extension : "";
}

async function putS3Object(input: {
  env: ApiEnv;
  objectKey: string;
  body: Buffer;
  contentType: string;
  now: Date;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const bucket = requireS3Bucket(input.env);
  const accessKeyId = input.env.API_CRM_STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = input.env.API_CRM_STORAGE_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("CRM S3 storage requires API_CRM_STORAGE_S3_ACCESS_KEY_ID and SECRET_ACCESS_KEY");
  }

  const region = input.env.API_CRM_STORAGE_S3_REGION;
  const endpoint = s3Endpoint(input.env, bucket);
  const url = s3ObjectUrl(input.env, endpoint, bucket, input.objectKey);
  const payloadHash = createHash("sha256").update(input.body).digest("hex");
  const signed = signS3Put({
    url,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken: input.env.API_CRM_STORAGE_S3_SESSION_TOKEN,
    contentType: input.contentType,
    payloadHash,
    now: input.now,
  });

  const response = await input.fetchImpl(url, {
    method: "PUT",
    headers: signed.headers,
    body: input.body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`CRM S3 upload failed: ${response.status} ${detail}`.trim());
  }

  return `s3://${bucket}/${input.objectKey}`;
}

async function getS3Object(input: {
  env: ApiEnv;
  objectKey: string;
  targetPath: string;
  now: Date;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const bucket = requireS3Bucket(input.env);
  const accessKeyId = input.env.API_CRM_STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = input.env.API_CRM_STORAGE_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("CRM S3 storage requires API_CRM_STORAGE_S3_ACCESS_KEY_ID and SECRET_ACCESS_KEY");
  }

  const region = input.env.API_CRM_STORAGE_S3_REGION;
  const endpoint = s3Endpoint(input.env, bucket);
  const url = s3ObjectUrl(input.env, endpoint, bucket, input.objectKey);
  const signed = signS3Request({
    method: "GET",
    url,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken: input.env.API_CRM_STORAGE_S3_SESSION_TOKEN,
    payloadHash: "UNSIGNED-PAYLOAD",
    now: input.now,
  });

  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: signed.headers,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`CRM S3 download failed: ${response.status} ${detail}`.trim());
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(input.targetPath), { recursive: true });
  await fs.writeFile(input.targetPath, bytes);
}

function requireS3Bucket(env: ApiEnv): string {
  const bucket = env.API_CRM_STORAGE_S3_BUCKET;
  if (!bucket) {
    throw new Error("CRM S3 storage requires API_CRM_STORAGE_S3_BUCKET");
  }
  return bucket;
}

function s3Endpoint(env: ApiEnv, bucket: string): URL {
  if (env.API_CRM_STORAGE_S3_ENDPOINT) {
    return new URL(env.API_CRM_STORAGE_S3_ENDPOINT);
  }
  return env.API_CRM_STORAGE_S3_FORCE_PATH_STYLE
    ? new URL(`https://s3.${env.API_CRM_STORAGE_S3_REGION}.amazonaws.com`)
    : new URL(`https://${bucket}.s3.${env.API_CRM_STORAGE_S3_REGION}.amazonaws.com`);
}

function s3ObjectUrl(env: ApiEnv, endpoint: URL, bucket: string, objectKey: string): URL {
  const url = new URL(endpoint.toString());
  const encodedKey = objectKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  if (env.API_CRM_STORAGE_S3_FORCE_PATH_STYLE || env.API_CRM_STORAGE_S3_ENDPOINT) {
    url.pathname = joinUrlPath(url.pathname, bucket, encodedKey);
  } else {
    url.pathname = joinUrlPath(url.pathname, encodedKey);
  }
  return url;
}

function joinUrlPath(...parts: string[]): string {
  return `/${parts
    .flatMap((part) => part.split("/"))
    .filter(Boolean)
    .join("/")}`;
}

function signS3Put(input: {
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  contentType: string;
  payloadHash: string;
  now: Date;
}): { headers: Record<string, string> } {
  return signS3Request({ ...input, method: "PUT" });
}

function signS3Request(input: {
  method: "GET" | "PUT";
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  contentType?: string;
  payloadHash: string;
  now: Date;
}): { headers: Record<string, string> } {
  const amzDate = toAmzDate(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate,
  };
  if (input.contentType) {
    headers["content-type"] = input.contentType;
  }
  if (input.sessionToken) {
    headers["x-amz-security-token"] = input.sessionToken;
  }

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]?.trim() ?? ""}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    input.url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = getSignatureKey(input.secretAccessKey, dateStamp, input.region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  headers.authorization = [
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");
  return { headers };
}

function parseS3StoragePath(storagePath: string): { bucket: string; objectKey: string } {
  const withoutScheme = storagePath.slice("s3://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
    throw new Error("Invalid CRM S3 storage path");
  }
  return {
    bucket: withoutScheme.slice(0, slashIndex),
    objectKey: withoutScheme.slice(slashIndex + 1),
  };
}

function safeObjectKey(objectKey: string): string {
  const normalized = objectKey.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid CRM S3 object key");
  }
  return path.join(...parts);
}

function getSignatureKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  const dateKey = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update(service).digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
