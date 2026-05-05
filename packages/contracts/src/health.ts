import { z } from "zod";

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number(),
  startedAt: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
