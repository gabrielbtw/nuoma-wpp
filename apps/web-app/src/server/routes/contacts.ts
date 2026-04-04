import type { FastifyInstance } from "fastify";
import { contactInputSchema, contactPatchSchema, createContact, deleteContact, getContactById, listContactHistory, listContactsPage, queryContactsBySegment, updateContact } from "@nuoma/core";
import type { SegmentQuery } from "@nuoma/core";

export async function registerContactRoutes(app: FastifyInstance) {
  app.get("/contacts", async (request) => {
    const query = request.query as { q?: string; tag?: string; status?: string; page?: string; pageSize?: string };
    return listContactsPage({
      query: query.q,
      tag: query.tag,
      status: query.status,
      page: Number(query.page ?? 1),
      pageSize: Number(query.pageSize ?? 20)
    });
  });

  app.post("/contacts/query", async (request) => {
    const body = request.body as { segment: SegmentQuery; page?: number; pageSize?: number };
    return queryContactsBySegment(body.segment, body.page ?? 1, body.pageSize ?? 60);
  });

  app.post("/contacts", async (request, reply) => {
    const payload = contactInputSchema.parse(request.body);
    const contact = createContact(payload);
    reply.code(201);
    return contact;
  });

  app.get("/contacts/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const contact = getContactById(params.id);
    if (!contact) {
      reply.code(404);
      return { message: "Contato não encontrado" };
    }
    return contact;
  });

  app.get("/contacts/:id/history", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { limit?: string };
    const contact = getContactById(params.id);
    if (!contact) {
      reply.code(404);
      return { message: "Contato não encontrado" };
    }

    return listContactHistory(params.id, Number(query.limit ?? 60));
  });

  app.patch("/contacts/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const existing = getContactById(params.id);
    if (!existing) {
      reply.code(404);
      return { message: "Contato não encontrado" };
    }

    const rawPayload = (request.body ?? {}) as Record<string, unknown>;
    const payload = contactPatchSchema.parse(rawPayload);
    const mergedOverrides = Object.fromEntries(
      Object.entries(payload).filter(([key]) => Object.prototype.hasOwnProperty.call(rawPayload, key))
    );
    const mergedPayload = contactInputSchema.parse({
      ...existing,
      ...mergedOverrides,
      tags: Object.prototype.hasOwnProperty.call(rawPayload, "tags") ? payload.tags : existing.tags
    });
    const updated = updateContact(params.id, mergedPayload);
    return updated;
  });

  app.delete("/contacts/:id", async (request, reply) => {
    const params = request.params as { id: string };
    deleteContact(params.id);
    reply.code(204);
    return null;
  });
}
