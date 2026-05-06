import { z } from "zod";

import { adminCsrfProcedure, adminProcedure, router } from "../init.js";

export const streamingRouter = router({
  startScreencast: adminProcedure.query(async ({ ctx }) => ctx.streaming.startScreencast()),

  dispatchInput: adminCsrfProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        type: z.enum(["click", "keydown", "text"]),
        payload: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.streaming.dispatchInput(input)),
});
