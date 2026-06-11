import type { FastifyInstance } from "fastify";
import {
  attendantInputSchema,
  createAttendant,
  deleteAttendant,
  getAttendantById,
  listAttendants,
  updateAttendant
} from "@nuoma/core";
import { saveAttendantSampleUpload } from "../lib/uploads.js";

export async function registerAttendantRoutes(app: FastifyInstance) {
  app.get("/attendants", async () => {
    return listAttendants();
  });

  app.get("/attendants/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const attendant = getAttendantById(id);
    if (!attendant) {
      return reply.code(404).send({ message: "Atendente não encontrado" });
    }
    return attendant;
  });

  app.post("/attendants", async (request, reply) => {
    const payload = attendantInputSchema.parse(request.body);
    const attendant = createAttendant(payload);
    return reply.code(201).send(attendant);
  });

  app.patch("/attendants/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getAttendantById(id);
    if (!existing) {
      return reply.code(404).send({ message: "Atendente não encontrado" });
    }
    const payload = attendantInputSchema.partial().parse(request.body);
    const updated = updateAttendant(id, payload);
    return updated;
  });

  app.delete("/attendants/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getAttendantById(id);
    if (!existing) {
      return reply.code(404).send({ message: "Atendente não encontrado" });
    }
    deleteAttendant(id);
    return reply.code(204).send();
  });

  // POST /attendants/:id/samples — upload a single voice sample file
  app.post("/attendants/:id/samples", async (request, reply) => {
    const { id } = request.params as { id: string };
    const attendant = getAttendantById(id);
    if (!attendant) {
      return reply.code(404).send({ message: "Atendente não encontrado" });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: "Arquivo não enviado" });
    }

    const storagePath = await saveAttendantSampleUpload(file, id);
    const updated = updateAttendant(id, {
      voiceSamples: [...attendant.voiceSamples, storagePath]
    });

    return reply.code(201).send(updated);
  });

  // DELETE /attendants/:id/samples — remove a specific sample by path
  app.delete("/attendants/:id/samples", async (request, reply) => {
    const { id } = request.params as { id: string };
    const attendant = getAttendantById(id);
    if (!attendant) {
      return reply.code(404).send({ message: "Atendente não encontrado" });
    }
    const { samplePath } = request.body as { samplePath: string };
    const updated = updateAttendant(id, {
      voiceSamples: attendant.voiceSamples.filter((s) => s !== samplePath)
    });
    return updated;
  });
}
