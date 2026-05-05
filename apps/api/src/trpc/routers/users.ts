import argon2 from "argon2";
import { z } from "zod";

import { createUserInputSchema, updateUserInputSchema } from "@nuoma/contracts";

import { adminCsrfProcedure, adminProcedure, router } from "../init.js";

function publicUser<TUser extends { passwordHash?: string }>(user: TUser) {
  const { passwordHash: _omit, ...publicFields } = user;
  return publicFields;
}

export const usersRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const users = await ctx.repos.users.list({
        cursor: input?.cursor,
        limit: input?.limit,
      });
      return { users };
    }),

  get: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.repos.users.findById(input.id);
      return { user: user ? publicUser(user) : null };
    }),

  create: adminCsrfProcedure
    .input(createUserInputSchema)
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const created = await ctx.repos.users.create({
        email: input.email,
        passwordHash,
        role: input.role,
        displayName: input.displayName ?? null,
      });
      return { user: publicUser(created) };
    }),

  update: adminCsrfProcedure
    .input(updateUserInputSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.repos.users.update(input.id, {
        email: input.email,
        role: input.role,
        displayName: input.displayName,
        isActive: input.isActive,
      });
      return { user: updated ? publicUser(updated) : null };
    }),

  deactivate: adminCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.repos.users.update(input.id, {
        isActive: false,
      });
      return { user: updated ? publicUser(updated) : null, ok: Boolean(updated) };
    }),
});
