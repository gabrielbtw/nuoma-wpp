import { createAttendantInputSchema, updateAttendantInputSchema } from "@nuoma/contracts";

import { adminCsrfProcedure, adminProcedure, router } from "../init.js";

const createAttendantBodySchema = createAttendantInputSchema.omit({ userId: true });
const updateAttendantBodySchema = updateAttendantInputSchema.omit({ userId: true });

export const attendantsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const attendants = await ctx.repos.attendants.list(ctx.user.id);
    return { attendants };
  }),

  create: adminCsrfProcedure
    .input(createAttendantBodySchema)
    .mutation(async ({ ctx, input }) => {
      const attendant = await ctx.repos.attendants.create({
        ...input,
        userId: ctx.user.id,
      });
      return { attendant };
    }),

  update: adminCsrfProcedure
    .input(updateAttendantBodySchema)
    .mutation(async ({ ctx, input }) => {
      const attendant = await ctx.repos.attendants.update({
        ...input,
        userId: ctx.user.id,
      });
      return { attendant };
    }),
});
