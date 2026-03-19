import type { FastifyInstance } from "fastify";
import { createTag, deleteTag, getTagById, listTags, tagInputSchema, updateTag } from "@nuoma/core";

export async function registerTagRoutes(app: FastifyInstance) {
  app.get("/tags", async () => listTags());

  app.post("/tags", async (request, reply) => {
    const payload = tagInputSchema.parse(request.body);
    const tag = createTag(payload);
    reply.code(201);
    return tag;
  });

  app.patch("/tags/:id", async (request, reply) => {
    const params = request.params as { id: string };
    if (!getTagById(params.id)) {
      reply.code(404);
      return { message: "Tag não encontrada" };
    }
    return updateTag(params.id, tagInputSchema.parse(request.body));
  });

  app.delete("/tags/:id", async (request, reply) => {
    const params = request.params as { id: string };
    deleteTag(params.id);
    reply.code(204);
    return null;
  });
}
