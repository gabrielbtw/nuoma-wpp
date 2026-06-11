import { createHmac, timingSafeEqual } from "node:crypto";

import type { ApiEnv } from "@nuoma/config";

interface MediaReadTokenPayload {
  assetId: number;
  userId: number;
  exp: number;
}

export function createMediaReadUrl(input: {
  env: ApiEnv;
  assetId: number;
  userId: number;
  ttlSeconds?: number;
}): { path: string; token: string; expiresAt: string } {
  const ttlSeconds = Math.max(60, Math.min(input.ttlSeconds ?? 300, 24 * 60 * 60));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: MediaReadTokenPayload = {
    assetId: input.assetId,
    userId: input.userId,
    exp,
  };
  const encoded = encodePayload(payload);
  const signature = sign(input.env, encoded);
  const token = `${encoded}.${signature}`;
  return {
    path: `/api/media/assets/${input.assetId}?token=${encodeURIComponent(token)}`,
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyMediaReadToken(input: {
  env: ApiEnv;
  token: string;
  assetId: number;
}): { userId: number } | null {
  const [encoded, signature] = input.token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(input.env, encoded);
  if (!safeEqual(signature, expected)) return null;

  const payload = decodePayload(encoded);
  if (!payload) return null;
  if (payload.assetId !== input.assetId) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return { userId: payload.userId };
}

function encodePayload(payload: MediaReadTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encoded: string): MediaReadTokenPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<MediaReadTokenPayload>;
    if (
      typeof parsed.assetId !== "number" ||
      typeof parsed.userId !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return {
      assetId: parsed.assetId,
      userId: parsed.userId,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

function sign(env: ApiEnv, encodedPayload: string): string {
  return createHmac("sha256", env.API_JWT_SECRET)
    .update(`media-read:${encodedPayload}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
