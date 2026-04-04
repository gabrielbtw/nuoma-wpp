import type { FastifyInstance } from "fastify";
import {
  addManualRecipients,
  buildCampaignImportPreview,
  getCampaignStepStats,
  campaignInputSchema,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  enqueueJob,
  getCampaign,
  importCampaignRecipients,
  listCampaignRecipients,
  listCampaigns,
  syncCampaignRecipientContacts,
  updateCampaign
} from "@nuoma/core";
import { activateCampaign, cancelCampaign, pauseCampaign } from "@nuoma/core";
import { parseCsvFile, resolveCsvUploadPath } from "../lib/uploads.js";

export async function registerCampaignRoutes(app: FastifyInstance) {
  app.get("/campaigns", async () => listCampaigns());

  app.post("/campaigns", async (request, reply) => {
    const payload = campaignInputSchema.parse(request.body);
    const campaign = createCampaign(payload);
    reply.code(201);
    return campaign;
  });

  app.get("/campaigns/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const campaign = getCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }
    return campaign;
  });

  app.patch("/campaigns/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const existing = getCampaign(params.id);
    if (!existing) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }

    const payload = campaignInputSchema.partial().parse(request.body);
    return updateCampaign(params.id, {
      ...existing,
      ...payload,
      steps: payload.steps ?? existing.steps
    });
  });

  app.post("/campaigns/:id/activate", async (request, reply) => {
    const params = request.params as { id: string };
    const campaign = activateCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }
    return campaign;
  });

  app.post("/campaigns/:id/pause", async (request, reply) => {
    const params = request.params as { id: string };
    const campaign = pauseCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }
    return campaign;
  });

  app.post("/campaigns/:id/cancel", async (request, reply) => {
    const params = request.params as { id: string };
    const campaign = cancelCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }
    return campaign;
  });

  app.delete("/campaigns/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const campaign = getCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }

    deleteCampaign(params.id);
    reply.code(204);
    return null;
  });

  app.post("/campaigns/:id/duplicate", async (request, reply) => {
    const params = request.params as { id: string };
    const campaign = duplicateCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }
    reply.code(201);
    return campaign;
  });

  app.post("/campaigns/:id/preview-import", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { uploadId: string; mapping: { phone?: string; name?: string; instagram?: string; tags?: string } };
    const campaign = getCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }
    if (!body?.uploadId) {
      reply.code(400);
      return { message: "CSV não informado" };
    }

    const rows = await parseCsvFile(await resolveCsvUploadPath(body.uploadId));
    const headers = Object.keys(rows[0] ?? {});
    const preview = buildCampaignImportPreview(rows, body.mapping, {
      eligibleChannels: campaign.eligibleChannels
    });

    return {
      uploadId: body.uploadId,
      headers,
      preview: preview.preview.slice(0, 50),
      summary: preview.summary,
      totalRows: preview.summary.total
    };
  });

  app.post("/campaigns/:id/import-recipients", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { uploadId: string; mapping: { phone?: string; name?: string; instagram?: string; tags?: string } };
    const existingCampaign = getCampaign(params.id);
    if (!existingCampaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }
    if (!body?.uploadId) {
      reply.code(400);
      return { message: "CSV não informado" };
    }

    const filePath = await resolveCsvUploadPath(body.uploadId);
    const rows = await parseCsvFile(filePath);
    const preview = buildCampaignImportPreview(rows, body.mapping, {
      eligibleChannels: existingCampaign.eligibleChannels
    });
    if (preview.recipients.length === 0) {
      reply.code(400);
      return { message: "Nenhum destinatário elegível foi encontrado no CSV." };
    }

    const campaign = importCampaignRecipients(
      params.id,
      preview.recipients,
      filePath
    );
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha não encontrada" };
    }

    syncCampaignRecipientContacts(params.id);
    const recipients = listCampaignRecipients(params.id);
    for (const recipient of recipients) {
      if (String((recipient as Record<string, unknown>).channel ?? "whatsapp") !== "whatsapp") {
        continue;
      }
      enqueueJob({
        type: "validate-recipient",
        dedupeKey: `validate:${params.id}:${recipient.id}`,
        payload: {
          campaignId: params.id,
          recipientId: String(recipient.id),
          phone: String(recipient.phone ?? "")
        },
        maxAttempts: 1
      });
    }

    return campaign;
  });

  app.post("/campaigns/:id/add-recipients", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      entries: Array<{ value: string; channel: "whatsapp" | "instagram"; name?: string }>;
    };
    const campaign = getCampaign(params.id);
    if (!campaign) {
      reply.code(404);
      return { message: "Campanha nao encontrada" };
    }
    if (!body?.entries?.length) {
      reply.code(400);
      return { message: "Nenhum destinatario informado" };
    }

    const result = addManualRecipients(params.id, body.entries);

    syncCampaignRecipientContacts(params.id);
    const recipients = listCampaignRecipients(params.id);
    for (const recipient of recipients) {
      const recChannel = String((recipient as Record<string, unknown>).channel ?? "whatsapp");
      const recStatus = String((recipient as Record<string, unknown>).status ?? "");
      if (recChannel !== "whatsapp" || recStatus !== "pending") continue;
      enqueueJob({
        type: "validate-recipient",
        dedupeKey: `validate:${params.id}:${recipient.id}`,
        payload: {
          campaignId: params.id,
          recipientId: String(recipient.id),
          phone: String(recipient.phone ?? "")
        },
        maxAttempts: 1
      });
    }

    return { added: result.added, campaign: result.campaign };
  });

  app.get("/campaigns/:id/recipients", async (request) => {
    const params = request.params as { id: string };
    return listCampaignRecipients(params.id);
  });

  app.get("/campaigns/:id/step-stats", async (request) => {
    const params = request.params as { id: string };
    return getCampaignStepStats(params.id);
  });
}
