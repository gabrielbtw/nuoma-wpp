import type { FastifyReply, FastifyRequest } from "fastify";

import type { ApiEnv } from "@nuoma/config";

export const ACCESS_COOKIE = "nuoma_access";
export const REFRESH_COOKIE = "nuoma_refresh";
export const CSRF_COOKIE = "nuoma_csrf";

/**
 * Structural cookie surface added at runtime by `@fastify/cookie`. We declare it
 * locally and cast at the boundary so neither `apps/api` nor consumers via path
 * mapping (`apps/web`) need to resolve `@fastify/cookie` types directly. The
 * structural typing keeps signatures permissive enough to coexist with the real
 * upstream augmentation when it IS visible (in `apps/api`).
 */
interface CookieJarRequest {
  cookies: { [name: string]: string | undefined };
}

interface CookieSetOptions {
  domain?: string;
  path?: string;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  httpOnly?: boolean;
  maxAge?: number;
  expires?: Date;
}

interface CookieClearOptions {
  domain?: string;
  path?: string;
}

interface CookieJarReply {
  setCookie(name: string, value: string, options?: CookieSetOptions): CookieJarReply;
  clearCookie(name: string, options?: CookieClearOptions): CookieJarReply;
}

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  return (request as unknown as CookieJarRequest).cookies?.[name];
}

export function setAuthCookies(
  reply: FastifyReply,
  env: ApiEnv,
  input: { accessToken: string; refreshToken: string; csrfToken: string },
): void {
  const secure = env.NODE_ENV === "production";
  const jar = reply as unknown as CookieJarReply;
  jar
    .setCookie(ACCESS_COOKIE, input.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: env.API_JWT_TTL_SECONDS,
    })
    .setCookie(REFRESH_COOKIE, input.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: env.API_REFRESH_TTL_SECONDS,
    })
    .setCookie(CSRF_COOKIE, input.csrfToken, {
      httpOnly: false,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: env.API_REFRESH_TTL_SECONDS,
    });
}

export function clearAuthCookies(reply: FastifyReply): void {
  const jar = reply as unknown as CookieJarReply;
  jar
    .clearCookie(ACCESS_COOKIE, { path: "/" })
    .clearCookie(REFRESH_COOKIE, { path: "/" })
    .clearCookie(CSRF_COOKIE, { path: "/" });
}
