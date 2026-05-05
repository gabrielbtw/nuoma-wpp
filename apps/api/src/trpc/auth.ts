import { createHash, randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";

import type { ApiEnv } from "@nuoma/config";
import { authSessionSchema, type AuthSession, type User } from "@nuoma/contracts";
import type { Repositories, UserRecord } from "@nuoma/db";

import { CSRF_COOKIE, readCookie, setAuthCookies } from "./cookies.js";

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "attendant" | "viewer";
}

function secretKey(env: ApiEnv): Uint8Array {
  return new TextEncoder().encode(env.API_JWT_SECRET);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function addSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

export function publicUser(user: UserRecord): User {
  const { passwordHash: _passwordHash, ...publicFields } = user;
  return publicFields;
}

export async function signAccessToken(
  env: ApiEnv,
  user: UserRecord,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = addSeconds(env.API_JWT_TTL_SECONDS);
  const token = await new SignJWT({
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey(env));

  return { token, expiresAt };
}

export async function verifyAccessToken(env: ApiEnv, token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secretKey(env));
  const id = Number(payload.sub);
  if (
    !Number.isInteger(id) ||
    typeof payload.email !== "string" ||
    typeof payload.role !== "string"
  ) {
    throw new Error("Invalid access token payload");
  }
  if (!["admin", "attendant", "viewer"].includes(payload.role)) {
    throw new Error("Invalid access token role");
  }
  return {
    id,
    email: payload.email,
    role: payload.role as AuthUser["role"],
  };
}

export function checkCsrf(request: FastifyRequest): boolean {
  const header = request.headers["x-csrf-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) return false;
  return token === readCookie(request, CSRF_COOKIE);
}

export interface IssueSessionInput {
  env: ApiEnv;
  repos: Repositories;
  user: UserRecord;
  request: FastifyRequest;
  reply: FastifyReply;
  previousRefreshTokenHash?: string;
}

export async function issueSession(input: IssueSessionInput): Promise<AuthSession> {
  const access = await signAccessToken(input.env, input.user);
  const refreshToken = randomToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshExpiresAt = addSeconds(input.env.API_REFRESH_TTL_SECONDS);
  const csrfToken = randomToken();

  await input.repos.refreshSessions.create({
    userId: input.user.id,
    tokenHash: refreshTokenHash,
    expiresAt: refreshExpiresAt.toISOString(),
    ipAddress: input.request.ip,
    userAgent: input.request.headers["user-agent"] ?? null,
  });

  if (input.previousRefreshTokenHash) {
    await input.repos.refreshSessions.revoke(input.previousRefreshTokenHash, refreshTokenHash);
  }

  setAuthCookies(input.reply, input.env, {
    accessToken: access.token,
    refreshToken,
    csrfToken,
  });

  return authSessionSchema.parse({
    user: publicUser(input.user),
    csrfToken,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  });
}
