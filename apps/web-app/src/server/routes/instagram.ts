import type { FastifyInstance } from "fastify";
import { listReplySuggestions } from "@nuoma/core";
import { z } from "zod";
import { getInstagramAssistedService } from "../lib/instagram-assisted.js";
import { syncInstagramInboxToDatabase } from "../lib/instagram-sync.js";

const syncRequestSchema = z
  .object({
    threadLimit: z.coerce.number().int().min(1).max(50).optional(),
    messagesLimit: z.coerce.number().int().min(1).max(100).optional()
  })
  .partial()
  .default({});

export async function registerInstagramRoutes(app: FastifyInstance) {
  app.get("/instagram/session", async () => {
    const instagramService = getInstagramAssistedService();
    return instagramService.getSessionState();
  });

  app.post("/instagram/session/open", async () => {
    const instagramService = getInstagramAssistedService();
    return instagramService.openSession();
  });

  app.post("/instagram/sync", async (request) => {
    const body = syncRequestSchema.parse(request.body ?? {});
    return syncInstagramInboxToDatabase({
      threadLimit: body.threadLimit,
      messagesLimit: body.messagesLimit
    });
  });

  app.get("/reply-suggestions", async (request) => {
    const query = request.query as { channel?: "whatsapp" | "instagram" | "all"; limit?: string };
    return listReplySuggestions({
      channel: query.channel ?? "all",
      limit: Number(query.limit ?? 8)
    });
  });
}
