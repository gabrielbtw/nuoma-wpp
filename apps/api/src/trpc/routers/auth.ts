import argon2 from "argon2";
import { TRPCError } from "@trpc/server";

import {
  changePasswordInputSchema,
  loginInputSchema,
  requestPasswordResetInputSchema,
  resetPasswordInputSchema,
  type AuthSession,
} from "@nuoma/contracts";

import {
  addSeconds,
  hashToken,
  issueSession,
  publicUser,
  randomToken,
} from "../auth.js";
import { REFRESH_COOKIE, clearAuthCookies, readCookie } from "../cookies.js";
import {
  csrfProcedure,
  protectedCsrfProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../init.js";

export const authRouter = router({
  login: publicProcedure
    .input(loginInputSchema)
    .mutation(async ({ ctx, input }): Promise<AuthSession> => {
      const user = await ctx.repos.users.findByEmail(input.email);
      if (
        !user ||
        !user.isActive ||
        !(await argon2.verify(user.passwordHash, input.password))
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      const session = await issueSession({
        env: ctx.env,
        repos: ctx.repos,
        user,
        request: ctx.req,
        reply: ctx.res,
      });
      await ctx.repos.users.update(user.id, { lastLoginAt: new Date().toISOString() });
      await ctx.repos.auditLogs.create({
        userId: user.id,
        actorUserId: user.id,
        action: "auth.login",
        targetTable: "users",
        targetId: user.id,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return session;
    }),

  logout: csrfProcedure.mutation(async ({ ctx }) => {
    const refreshToken = readCookie(ctx.req, REFRESH_COOKIE);
    if (refreshToken) {
      await ctx.repos.refreshSessions.revoke(hashToken(refreshToken));
    }
    clearAuthCookies(ctx.res);
    return { ok: true as const };
  }),

  refresh: publicProcedure.mutation(async ({ ctx }): Promise<AuthSession> => {
    const refreshToken = readCookie(ctx.req, REFRESH_COOKIE);
    if (!refreshToken) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing refresh token" });
    }
    const refreshTokenHash = hashToken(refreshToken);
    const session = await ctx.repos.refreshSessions.findByTokenHash(refreshTokenHash);
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) {
      clearAuthCookies(ctx.res);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid refresh token" });
    }

    const user = await ctx.repos.users.findById(session.userId);
    if (!user || !user.isActive) {
      clearAuthCookies(ctx.res);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User is inactive" });
    }

    return issueSession({
      env: ctx.env,
      repos: ctx.repos,
      user,
      request: ctx.req,
      reply: ctx.res,
      previousRefreshTokenHash: refreshTokenHash,
    });
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.repos.users.findById(ctx.user.id);
    if (!user || !user.isActive) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User is inactive" });
    }
    return { user: publicUser(user) };
  }),

  changePassword: protectedCsrfProcedure
    .input(changePasswordInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.repos.users.findById(ctx.user.id);
      if (!user || !(await argon2.verify(user.passwordHash, input.currentPassword))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid password" });
      }

      const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
      await ctx.repos.users.update(user.id, { passwordHash });
      await ctx.repos.refreshSessions.revokeAllForUser(user.id);
      await ctx.repos.auditLogs.create({
        userId: user.id,
        actorUserId: user.id,
        action: "auth.change_password",
        targetTable: "users",
        targetId: user.id,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      clearAuthCookies(ctx.res);
      return { ok: true as const };
    }),

  requestPasswordReset: publicProcedure
    .input(requestPasswordResetInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.repos.users.findByEmail(input.email);
      const resetToken = randomToken();

      if (user) {
        await ctx.repos.passwordResetTokens.create({
          userId: user.id,
          tokenHash: hashToken(resetToken),
          expiresAt: addSeconds(60 * 60).toISOString(),
        });
        await ctx.repos.auditLogs.create({
          userId: user.id,
          actorUserId: user.id,
          action: "auth.request_password_reset",
          targetTable: "users",
          targetId: user.id,
        });
      }

      return {
        ok: true as const,
        resetToken: ctx.env.NODE_ENV === "production" ? undefined : resetToken,
      };
    }),

  resetPassword: publicProcedure
    .input(resetPasswordInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tokenHash = hashToken(input.token);
      const reset = await ctx.repos.passwordResetTokens.findByTokenHash(tokenHash);
      if (!reset || reset.usedAt || Date.parse(reset.expiresAt) <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid reset token" });
      }

      const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
      await ctx.repos.users.update(reset.userId, { passwordHash });
      await ctx.repos.passwordResetTokens.markUsed(tokenHash);
      await ctx.repos.refreshSessions.revokeAllForUser(reset.userId);
      await ctx.repos.auditLogs.create({
        userId: reset.userId,
        actorUserId: reset.userId,
        action: "auth.reset_password",
        targetTable: "users",
        targetId: reset.userId,
      });
      return { ok: true as const };
    }),
});
