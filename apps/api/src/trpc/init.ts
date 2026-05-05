import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import { checkCsrf } from "./auth.js";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

const requireAuthMiddleware = middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const requireAdminMiddleware = middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin role required" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const requireCsrfMiddleware = middleware(({ ctx, next }) => {
  if (!checkCsrf(ctx.req)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Invalid CSRF token" });
  }
  return next();
});

export const protectedProcedure = publicProcedure.use(requireAuthMiddleware);
export const adminProcedure = publicProcedure.use(requireAdminMiddleware);
export const csrfProcedure = publicProcedure.use(requireCsrfMiddleware);
export const protectedCsrfProcedure = protectedProcedure.use(requireCsrfMiddleware);
export const adminCsrfProcedure = adminProcedure.use(requireCsrfMiddleware);
