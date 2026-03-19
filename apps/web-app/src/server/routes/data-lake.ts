import type { FastifyInstance } from "fastify";
import { getDataLakeOverview, getDataLakeProviderStatus, runDataLakePipeline } from "@nuoma/core";
import { z } from "zod";

const dataLakeRunSchema = z
  .object({
    includeDatabaseMessages: z.boolean().optional(),
    includeInstagramExports: z.boolean().optional(),
    instagramRoots: z.array(z.string().trim().min(1)).optional(),
    mediaRoots: z.array(z.string().trim().min(1)).optional(),
    maxMediaFiles: z.coerce.number().int().min(1).max(5000).optional(),
    maxEnrichmentItems: z.coerce.number().int().min(1).max(200).optional(),
    sourceScope: z.string().trim().min(1).max(64).optional()
  })
  .partial()
  .default({});

export async function registerDataLakeRoutes(app: FastifyInstance) {
  app.get("/data-lake", async () => {
    const provider = getDataLakeProviderStatus();
    return {
      providerConfigured: provider.audioProvider !== "none" || provider.imageProvider !== "none",
      provider,
      ...getDataLakeOverview()
    };
  });

  app.post("/data-lake/run", async (request) => {
    const body = dataLakeRunSchema.parse(request.body ?? {});
    const provider = getDataLakeProviderStatus();
    const result = await runDataLakePipeline(body);
    return {
      providerConfigured: provider.audioProvider !== "none" || provider.imageProvider !== "none",
      provider,
      ...result
    };
  });
}
