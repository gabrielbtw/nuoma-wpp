import type { FastifyInstance } from "fastify";
import { automationRuleInputSchema, createAutomation, getAutomation, listAutomations, setAutomationEnabled, updateAutomation } from "@nuoma/core";

export async function registerAutomationRoutes(app: FastifyInstance) {
  app.get("/automations", async () => listAutomations());

  app.post("/automations", async (request, reply) => {
    const payload = automationRuleInputSchema.parse(request.body);
    const automation = createAutomation(payload);
    reply.code(201);
    return automation;
  });

  app.patch("/automations/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const existing = getAutomation(params.id);
    if (!existing) {
      reply.code(404);
      return { message: "Automação não encontrada" };
    }

    const payload = automationRuleInputSchema.partial().parse(request.body);
    return updateAutomation(params.id, {
      ...existing,
      ...payload,
      triggerTags: payload.triggerTags ?? existing.triggerTags,
      excludeTags: payload.excludeTags ?? existing.excludeTags,
      actions: payload.actions ?? existing.actions
    });
  });

  app.post("/automations/:id/toggle", async (request, reply) => {
    const params = request.params as { id: string };
    const existing = getAutomation(params.id);
    if (!existing) {
      reply.code(404);
      return { message: "Automação não encontrada" };
    }

    return setAutomationEnabled(params.id, !existing.enabled);
  });
}
