import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import argon2 from "argon2";
import type { FastifyInstance } from "fastify";

import { loadApiEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";

import { buildApiApp } from "../apps/api/src/app.js";

interface TrpcResult<T> {
  statusCode: number;
  data?: T;
  error?: { message?: string; data?: { code?: string; httpStatus?: number } };
  setCookie?: string | string[];
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v24-api-auth-"));
  const dbPath = path.join(tempDir, "api.db");
  const db = openDb(dbPath);
  let app: FastifyInstance | null = null;

  try {
    await runMigrations(db);
    const repos = createRepositories(db);
    await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash: await argon2.hash("initial-password-123", { type: argon2.argon2id }),
      role: "admin",
      displayName: "Admin",
    });

    app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: dbPath,
      }),
      db,
      migrate: false,
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    assert(health.statusCode === 200, `health status ${health.statusCode}`);
    assert(health.json<{ ok: boolean; service: string }>().ok === true, "health ok=false");

    const unauthorizedMe = await trpcCall(app, "GET", "auth.me", undefined);
    assert(unauthorizedMe.statusCode === 401, `unauthorized me status ${unauthorizedMe.statusCode}`);

    const login = await trpcCall<{ user: { email: string; role: string }; csrfToken: string }>(
      app,
      "POST",
      "auth.login",
      {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      },
    );
    assert(login.statusCode === 200, `login status ${login.statusCode}`);
    assert(login.data?.user.email === "admin@nuoma.local", "login user mismatch");
    assert(login.data.user.role === "admin", "login role mismatch");
    assert(login.data.csrfToken.length >= 43, "csrf token too short");
    const cookies = cookieHeader(login.setCookie);
    assert(cookies.includes("nuoma_access="), "access cookie missing");
    assert(cookies.includes("nuoma_refresh="), "refresh cookie missing");

    const me = await trpcCall<{ user: { role: string } }>(app, "GET", "auth.me", undefined, {
      cookie: cookies,
    });
    assert(me.statusCode === 200, `me status ${me.statusCode}`);
    assert(me.data?.user.role === "admin", "me role mismatch");

    const missingCsrf = await trpcCall(
      app,
      "POST",
      "auth.changePassword",
      {
        currentPassword: "initial-password-123",
        newPassword: "should-not-apply-123",
      },
      { cookie: cookies },
    );
    assert(missingCsrf.statusCode === 403, `missing csrf status ${missingCsrf.statusCode}`);

    const refreshed = await trpcCall<{ csrfToken: string }>(
      app,
      "POST",
      "auth.refresh",
      undefined,
      { cookie: cookies },
    );
    assert(refreshed.statusCode === 200, `refresh status ${refreshed.statusCode}`);
    assert(refreshed.data?.csrfToken.length >= 43, "refresh csrf token too short");
    const refreshedCookies = cookieHeader(refreshed.setCookie);

    const changed = await trpcCall<{ ok: true }>(
      app,
      "POST",
      "auth.changePassword",
      {
        currentPassword: "initial-password-123",
        newPassword: "changed-password-123",
      },
      {
        cookie: refreshedCookies,
        csrfToken: refreshed.data.csrfToken,
      },
    );
    assert(changed.statusCode === 200, `change password status ${changed.statusCode}`);
    assert(changed.data?.ok === true, "change password ok=false");

    const relogin = await trpcCall(app, "POST", "auth.login", {
      email: "admin@nuoma.local",
      password: "changed-password-123",
    });
    assert(relogin.statusCode === 200, `relogin status ${relogin.statusCode}`);

    console.log("v24-api-auth|health=ok|login=ok|refresh=ok|csrf=ok|status=closed");
  } finally {
    if (app) {
      await app.close();
    }
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function trpcCall<T = unknown>(
  app: FastifyInstance,
  method: "GET" | "POST",
  procedure: string,
  input: unknown,
  options: { cookie?: string; csrfToken?: string } = {},
): Promise<TrpcResult<T>> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrfToken) headers["x-csrf-token"] = options.csrfToken;

  let url = `/trpc/${procedure}`;
  let payload: Record<string, unknown> | undefined;
  if (method === "GET") {
    if (input !== undefined) {
      url = `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
  } else {
    headers["content-type"] = "application/json";
    payload = input === undefined ? {} : { json: input };
  }

  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  const body = response.json() as {
    result?: { data?: { json?: T } };
    error?: { json?: TrpcResult<T>["error"] };
  };
  const setCookieHeader = response.headers["set-cookie"];
  return {
    statusCode: response.statusCode,
    data: body.result?.data?.json,
    error: body.error?.json,
    setCookie:
      typeof setCookieHeader === "string" || Array.isArray(setCookieHeader)
        ? setCookieHeader
        : undefined,
  };
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((cookie) => cookie.split(";")[0]).join("; ");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`V2.4 API/auth smoke failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
