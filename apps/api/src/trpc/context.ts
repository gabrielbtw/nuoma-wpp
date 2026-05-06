import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

import type { ApiEnv } from "@nuoma/config";
import type { Repositories } from "@nuoma/db";

import type { StreamingCdpService } from "../services/streaming-cdp.js";
import { ACCESS_COOKIE, readCookie } from "./cookies.js";
import { verifyAccessToken, type AuthUser } from "./auth.js";

export interface ContextDeps {
  env: ApiEnv;
  repos: Repositories;
  streaming: StreamingCdpService;
}

export interface Context {
  env: ApiEnv;
  repos: Repositories;
  streaming: StreamingCdpService;
  req: CreateFastifyContextOptions["req"];
  res: CreateFastifyContextOptions["res"];
  user: AuthUser | null;
}

export function createContextFactory(deps: ContextDeps) {
  return async ({ req, res }: CreateFastifyContextOptions): Promise<Context> => {
    let user: AuthUser | null = null;
    const accessToken = readCookie(req, ACCESS_COOKIE);
    if (accessToken) {
      try {
        user = await verifyAccessToken(deps.env, accessToken);
      } catch {
        user = null;
      }
    }
    return {
      env: deps.env,
      repos: deps.repos,
      streaming: deps.streaming,
      req,
      res,
      user,
    };
  };
}
