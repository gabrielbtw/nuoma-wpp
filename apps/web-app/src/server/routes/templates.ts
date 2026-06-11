import type { FastifyInstance } from "fastify";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  templateInputSchema,
  listAvailableVars
} from "@nuoma/core";

export async function registerTemplateRoutes(app: FastifyInstance) {
  app.get("/templates", async (_req, reply) => {
    const query = _req.query as { category?: string };
    const templates = listTemplates(query.category);
    return reply.send(templates);
  });

  app.get("/templates/variables", async (_req, reply) => {
    return reply.send(listAvailableVars());
  });

  app.get("/templates/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = getTemplate(id);
    if (!template) return reply.status(404).send({ error: "Template não encontrado" });
    return reply.send(template);
  });

  app.post("/templates", async (req, reply) => {
    const input = templateInputSchema.parse(req.body);
    const template = createTemplate(input);
    return reply.status(201).send(template);
  });

  app.patch("/templates/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = templateInputSchema.partial().parse(req.body);
    const template = updateTemplate(id, input);
    if (!template) return reply.status(404).send({ error: "Template não encontrado" });
    return reply.send(template);
  });

  app.delete("/templates/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = deleteTemplate(id);
    if (!deleted) return reply.status(404).send({ error: "Template não encontrado" });
    return reply.status(204).send();
  });
}
