import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadApiEnv } from "@nuoma/config";

import { crmNamespace, normalizeCrmOwnerKey, storeCrmFile } from "./crm-file-storage.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("CRM file storage", () => {
  it("stores local CRM files under the canonical phone namespace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-crm-local-"));
    tempDirs.push(root);
    const buffer = Buffer.from("crm profile photo bytes");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const env = loadApiEnv({
      NODE_ENV: "test",
      API_CRM_STORAGE_PROVIDER: "local",
      API_CRM_STORAGE_LOCAL_ROOT: root,
    });

    const stored = await storeCrmFile({
      env,
      ownerKey: "+55 (31) 98206-6263",
      fileName: "Foto Perfil.jpeg",
      mimeType: "image/jpeg",
      buffer,
    });

    expect(stored).toMatchObject({
      provider: "local",
      namespace: "/nuoma/files/crm/5531982066263/",
      objectKey: `nuoma/files/crm/5531982066263/${sha256}.jpeg`,
      sha256,
      sizeBytes: buffer.byteLength,
      bucket: null,
    });
    expect(stored.storagePath).toBe(path.join(root, stored.objectKey));
    await expect(fs.readFile(stored.storagePath)).resolves.toEqual(buffer);
  });

  it("builds a signed S3 PUT without adding an SDK dependency", async () => {
    const buffer = Buffer.from("crm s3 bytes");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 200 });
    };
    const env = loadApiEnv({
      NODE_ENV: "test",
      API_CRM_STORAGE_PROVIDER: "s3",
      API_CRM_STORAGE_S3_BUCKET: "nuoma-crm-test",
      API_CRM_STORAGE_S3_REGION: "us-east-1",
      API_CRM_STORAGE_S3_ENDPOINT: "https://s3.local.test",
      API_CRM_STORAGE_S3_ACCESS_KEY_ID: "AKIATEST",
      API_CRM_STORAGE_S3_SECRET_ACCESS_KEY: "secret-test-key",
    });

    const stored = await storeCrmFile({
      env,
      ownerKey: "contact:42 / Instagram",
      fileName: "nota.txt",
      mimeType: "text/plain",
      buffer,
      now: new Date("2026-05-05T12:00:00.000Z"),
      fetchImpl,
    });

    expect(stored).toMatchObject({
      provider: "s3",
      namespace: "/nuoma/files/crm/contact-42-instagram/",
      objectKey: `nuoma/files/crm/contact-42-instagram/${sha256}.txt`,
      storagePath: `s3://nuoma-crm-test/nuoma/files/crm/contact-42-instagram/${sha256}.txt`,
      bucket: "nuoma-crm-test",
      localPath: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://s3.local.test/nuoma-crm-test/nuoma/files/crm/contact-42-instagram/${sha256}.txt`,
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=AKIATEST/");
    expect(headers["x-amz-content-sha256"]).toBe(sha256);
    expect(headers["x-amz-date"]).toBe("20260505T120000Z");
  });

  it("normalizes unsafe namespace and owner inputs", () => {
    const env = loadApiEnv({
      NODE_ENV: "test",
      API_CRM_STORAGE_NAMESPACE: "../Nuoma Files//CRM",
    });

    expect(crmNamespace(env, "../../Contato Acido")).toBe(
      "/nuoma-files/crm/contato-acido/",
    );
    expect(normalizeCrmOwnerKey("instagram:user/name")).toBe("instagram-user-name");
  });
});
