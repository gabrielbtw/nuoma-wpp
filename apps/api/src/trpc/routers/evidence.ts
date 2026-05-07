import { z } from "zod";

import { listEvidenceCenter } from "../../services/evidence-center.js";
import { protectedProcedure, router } from "../init.js";

export const evidenceRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(80),
        })
        .optional(),
    )
    .query(async ({ input }) => listEvidenceCenter({ limit: input?.limit })),
});
