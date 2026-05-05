import { z } from "zod";

import { adminCsrfProcedure, adminProcedure, router } from "../init.js";

export const streamingRouter = router({
  startScreencast: adminProcedure.query(() => {
    return {
      available: false as const,
      url: null,
      reason: "Screencast relay is not enabled in the local API runtime yet.",
    };
  }),

  dispatchInput: adminCsrfProcedure
    .input(
      z.object({
        type: z.enum(["click", "keydown", "text"]),
        payload: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ input }) => {
      return {
        accepted: false as const,
        type: input.type,
        reason: "Input relay requires an active screencast session.",
      };
    }),
});
