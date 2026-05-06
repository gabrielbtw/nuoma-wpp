import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import argon2 from "argon2";

import { loadApiEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";

import { buildApiApp } from "../apps/api/src/app.js";
import { storeCrmFile } from "../apps/api/src/services/crm-file-storage.js";

const execFileAsync = promisify(execFile);

interface ExportedAwsCredentials {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken?: string;
}

interface TrpcResult<T> {
  data?: T;
  setCookie?: string | string[];
}

const bucket = process.env.NUOMA_STRONG_S3_BUCKET ?? "nuoma-files";
const ownerKey = `strong-m222-${Date.now()}`;
const body = Buffer.from(`nuoma m222 strong s3 cache ${new Date().toISOString()}\n`);

async function main() {
  const credentials = await loadAwsCredentials();
  const region = process.env.NUOMA_STRONG_S3_REGION ?? (await resolveBucketRegion(bucket));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-m222-s3-"));
  const dbPath = path.join(tempDir, "api.db");
  const cacheRoot = path.join(tempDir, "crm-cache");
  const db = openDb(dbPath);
  let objectKey: string | null = null;

  try {
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });

    const env = loadApiEnv({
      API_LOG_LEVEL: "silent",
      NODE_ENV: "test",
      API_JWT_SECRET: "test-secret-with-more-than-16-chars",
      DATABASE_URL: dbPath,
      API_CRM_STORAGE_PROVIDER: "s3",
      API_CRM_STORAGE_NAMESPACE: "/nuoma-wpp-v2/strong-tests/crm",
      API_CRM_STORAGE_CACHE_ROOT: cacheRoot,
      API_CRM_STORAGE_S3_BUCKET: bucket,
      API_CRM_STORAGE_S3_REGION: region,
      API_CRM_STORAGE_S3_ACCESS_KEY_ID: credentials.AccessKeyId,
      API_CRM_STORAGE_S3_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
      ...(credentials.SessionToken
        ? { API_CRM_STORAGE_S3_SESSION_TOKEN: credentials.SessionToken }
        : {}),
    });

    const stored = await storeCrmFile({
      env,
      ownerKey,
      fileName: "m222-strong.txt",
      mimeType: "text/plain",
      buffer: body,
    });
    objectKey = stored.objectKey;

    const asset = await repos.mediaAssets.create({
      userId: user.id,
      type: "document",
      fileName: "m222-strong.txt",
      mimeType: "text/plain",
      sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: body.byteLength,
      durationMs: null,
      storagePath: stored.storagePath,
      sourceUrl: null,
      deletedAt: null,
    });

    const app = await buildApiApp({ env, db, migrate: false });
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected API TCP address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const login = await trpcCall<{ csrfToken: string }>(baseUrl, "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);
      if (!cookies.includes("nuoma_access=")) {
        throw new Error("Login did not return access cookie");
      }

      const first = await fetch(`${baseUrl}/api/media/assets/${asset.id}`, {
        headers: { cookie: cookies },
      });
      const firstText = await first.text();
      assertResponse(first, "miss");
      if (firstText !== body.toString("utf8")) {
        throw new Error("First S3 download body mismatch");
      }

      const second = await fetch(`${baseUrl}/api/media/assets/${asset.id}`, {
        headers: { cookie: cookies },
      });
      const secondText = await second.text();
      assertResponse(second, "hit");
      if (secondText !== body.toString("utf8")) {
        throw new Error("Second S3 cache body mismatch");
      }

      const cachedFiles = await listFiles(cacheRoot);
      if (cachedFiles.length !== 1) {
        throw new Error(`Expected one cached file, found ${cachedFiles.length}`);
      }

      console.log(
        [
          "m222-crm-s3-cache-strong",
          `bucket=${bucket}`,
          `region=${region}`,
          `assetId=${asset.id}`,
          "first=miss",
          "second=hit",
          `bytes=${body.byteLength}`,
          `cacheFiles=${cachedFiles.length}`,
          "status=passed",
        ].join("|"),
      );
    } finally {
      await app.close();
    }
  } finally {
    db.close();
    if (objectKey) {
      await execFileAsync("aws", ["s3", "rm", `s3://${bucket}/${objectKey}`]).catch(() => undefined);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function loadAwsCredentials(): Promise<ExportedAwsCredentials> {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      AccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      SessionToken: process.env.AWS_SESSION_TOKEN,
    };
  }
  const { stdout } = await execFileAsync("aws", ["configure", "export-credentials", "--format", "process"]);
  const parsed = JSON.parse(stdout) as Partial<ExportedAwsCredentials>;
  if (!parsed.AccessKeyId || !parsed.SecretAccessKey) {
    throw new Error("AWS credentials are not available");
  }
  return {
    AccessKeyId: parsed.AccessKeyId,
    SecretAccessKey: parsed.SecretAccessKey,
    SessionToken: parsed.SessionToken,
  };
}

async function resolveBucketRegion(bucketName: string): Promise<string> {
  if (process.env.AWS_REGION) {
    return process.env.AWS_REGION;
  }
  const { stdout } = await execFileAsync("aws", [
    "s3api",
    "get-bucket-location",
    "--bucket",
    bucketName,
    "--output",
    "json",
  ]);
  const parsed = JSON.parse(stdout) as { LocationConstraint?: string | null };
  return parsed.LocationConstraint ?? "us-east-1";
}

async function trpcCall<T>(baseUrl: string, procedure: string, input: unknown): Promise<TrpcResult<T>> {
  const response = await fetch(`${baseUrl}/trpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const bodyJson = (await response.json()) as { result?: { data?: { json?: T } } };
  return {
    data: bodyJson.result?.data?.json,
    setCookie: response.headers.getSetCookie?.() ?? response.headers.get("set-cookie") ?? undefined,
  };
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((cookie) => cookie.split(";")[0]).join("; ");
}

function assertResponse(response: Response, expectedCache: "miss" | "hit"): void {
  if (!response.ok) {
    throw new Error(`Expected media route success, got ${response.status}`);
  }
  const cache = response.headers.get("x-nuoma-storage-cache");
  if (cache !== expectedCache) {
    throw new Error(`Expected x-nuoma-storage-cache=${expectedCache}, got ${cache}`);
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

await main();
