import { z } from "zod";

import { createTagInputSchema, updateTagInputSchema } from "@nuoma/contracts";

import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createTagBodySchema = createTagInputSchema.omit({ userId: true });
const updateTagBodySchema = updateTagInputSchema.omit({ userId: true });

export const tagsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const tags = await ctx.repos.tags.list(ctx.user.id);
    return { tags };
  }),

  create: protectedCsrfProcedure
    .input(createTagBodySchema)
    .mutation(async ({ ctx, input }) => {
      const tag = await ctx.repos.tags.create({ ...input, userId: ctx.user.id });
      return { tag };
    }),

  update: protectedCsrfProcedure
    .input(updateTagBodySchema)
    .mutation(async ({ ctx, input }) => {
      const tag = await ctx.repos.tags.update({ ...input, userId: ctx.user.id });
      return { tag };
    }),

  delete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.repos.tags.delete({ id: input.id, userId: ctx.user.id });
      return { ok };
    }),
});
