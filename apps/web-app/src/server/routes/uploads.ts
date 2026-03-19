import type { FastifyInstance } from "fastify";
import { saveCsvUpload, saveMediaUpload } from "../lib/uploads.js";

export async function registerUploadRoutes(app: FastifyInstance) {
  app.post("/uploads/media", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { message: "Arquivo não enviado" };
    }

    const fields = file.fields as Record<string, { value: string }>;
    const media = await saveMediaUpload(file, {
      scope: (fields.scope?.value as "campaign" | "automation" | "temp" | undefined) ?? "temp",
      campaignId: fields.campaignId?.value,
      automationId: fields.automationId?.value
    });

    reply.code(201);
    return media;
  });

  app.post("/uploads/csv", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { message: "Arquivo não enviado" };
    }

    const csv = await saveCsvUpload(file);
    reply.code(201);
    return csv;
  });
}
