import { z } from "zod";

export const appErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type AppError = z.infer<typeof appErrorSchema>;
