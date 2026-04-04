import type { FastifyInstance } from "fastify";
import {
  addMessage,
  enqueueJob,
  getContactById,
  getConversationById,
  getLatestConversationForContactChannel,
  listConversations,
  listMessagesForContact,
  listMessagesForConversation,
  listUnifiedInbox,
  rememberInstagramThreadForContact,
  sendJobPayloadSchema,
  updateConversationInternalStatus
} from "@nuoma/core";
import { z } from "zod";
import { getInstagramAssistedService } from "../lib/instagram-assisted.js";

const manualMessageSchema = z.object({
  text: z.string().trim().min(1, "Mensagem obrigatoria")
});

const patchConversationSchema = z.object({
  internalStatus: z.enum(["open", "waiting", "closed"])
});

export async function registerConversationRoutes(app: FastifyInstance) {
  app.get("/conversations", async (request) => {
    const query = request.query as { channel?: string; status?: string; q?: string };
    return listConversations({
      channel: query.channel,
      status: query.status,
      query: query.q
    });
  });

  app.get("/inbox/unified", async (request) => {
    const query = request.query as { channel?: string; status?: string; q?: string; page?: string; pageSize?: string };
    return listUnifiedInbox({
      channel: query.channel,
      status: query.status,
      query: query.q,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined
    });
  });

  app.get("/inbox/contact/:contactId/messages", async (request) => {
    const params = request.params as { contactId: string };
    const query = request.query as { limit?: string };
    return listMessagesForContact(params.contactId, query.limit ? Number(query.limit) : 200);
  });

  app.get("/conversations/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const conversation = getConversationById(params.id);
    if (!conversation) {
      reply.code(404);
      return { message: "Conversa não encontrada" };
    }
    return conversation;
  });

  app.get("/conversations/:id/messages", async (request, reply) => {
    const params = request.params as { id: string };
    const conversation = getConversationById(params.id);
    if (!conversation) {
      reply.code(404);
      return { message: "Conversa não encontrada" };
    }
    return listMessagesForConversation(params.id);
  });

  app.patch("/conversations/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const existing = getConversationById(params.id);
    if (!existing) {
      reply.code(404);
      return { message: "Conversa não encontrada" };
    }

    const body = patchConversationSchema.parse(request.body);
    return updateConversationInternalStatus(params.id, body.internalStatus);
  });

  // Send message to a contact via unified inbox (picks the right conversation/channel)
  app.post("/conversations/send-to-contact", async (request, reply) => {
    const body = request.body as { contactId: string; text: string; channel: string; mediaPath?: string; contentType?: string };
    if (!body?.contactId || (!body?.text?.trim() && !body?.mediaPath)) {
      reply.code(400);
      return { message: "contactId e (text ou mediaPath) sao obrigatorios" };
    }

    const contact = getContactById(body.contactId);
    if (!contact) {
      reply.code(404);
      return { message: "Contato nao encontrado" };
    }

    const channel = (body.channel === "instagram" ? "instagram" : "whatsapp") as "whatsapp" | "instagram";
    const contentType = body.contentType || "text";

    // Find existing conversation for this contact+channel
    const conversation = getLatestConversationForContactChannel(body.contactId, channel);

    if (channel === "whatsapp") {
      if (!contact.phone) {
        reply.code(400);
        return { message: "Contato sem telefone para WhatsApp" };
      }
      enqueueJob({
        type: "send-message",
        dedupeKey: null,
        payload: sendJobPayloadSchema.parse({
          source: "manual",
          channel: "whatsapp",
          externalThreadId: conversation?.externalThreadId ?? null,
          recipientDisplayValue: contact.name || contact.phone,
          recipientNormalizedValue: contact.phone,
          phone: contact.phone,
          conversationId: conversation?.id ?? null,
          contactId: contact.id,
          contentType,
          text: body.text,
          mediaPath: body.mediaPath ?? null,
          caption: body.text
        })
      });
      reply.code(202);
      return { queued: true, channel: "whatsapp" };
    }

    if (channel === "instagram") {
      const instagramService = getInstagramAssistedService();
      const threadId = conversation?.externalThreadId ?? null;
      const username = contact.instagram?.replace(/^@/, "") ?? null;

      const sent = await instagramService.sendMessage({
        threadId,
        username,
        text: body.text,
        mediaPath: body.mediaPath ?? null,
        contentType: contentType as "text" | "audio" | "image" | "video",
        caption: body.text
      });

      if (conversation) {
        addMessage({
          conversationId: conversation.id,
          contactId: contact.id,
          direction: "outgoing",
          contentType: contentType as "text" | "audio" | "image" | "video" | "file" | "summary",
          body: body.text,
          externalId: sent.externalId,
          sentAt: sent.sentAt,
          meta: { source: "inbox-manual-send" }
        });
      }

      reply.code(202);
      return { queued: false, sent: true, channel: "instagram" };
    }

    reply.code(409);
    return { message: "Canal nao suportado" };
  });

  app.post("/conversations/:id/messages", async (request, reply) => {
    const params = request.params as { id: string };
    const conversation = getConversationById(params.id);
    if (!conversation) {
      reply.code(404);
      return { message: "Conversa não encontrada" };
    }

    const body = manualMessageSchema.parse(request.body);
    if (conversation.channel === "whatsapp") {
      enqueueJob({
        type: "send-message",
        dedupeKey: null,
        payload: sendJobPayloadSchema.parse({
          source: "manual",
          channel: conversation.channel,
          channelAccountId: conversation.channelAccountId,
          externalThreadId: conversation.externalThreadId,
          recipientDisplayValue: conversation.title,
          recipientNormalizedValue: conversation.externalThreadId,
          phone: conversation.waChatId,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          contentType: "text",
          text: body.text
        })
      });

      reply.code(202);
      return { queued: true };
    }

    if (conversation.channel === "instagram") {
      const instagramService = getInstagramAssistedService();
      const sent = await instagramService.sendMessageToThread({
        threadId: conversation.externalThreadId,
        text: body.text
      });

      addMessage({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        direction: "outgoing",
        contentType: "text",
        body: body.text,
        externalId: sent.externalId,
        sentAt: sent.sentAt,
        meta: {
          source: "instagram-assisted-send"
        }
      });

      if (conversation.contactId) {
        rememberInstagramThreadForContact({
          contactId: conversation.contactId,
          instagram:
            (typeof conversation.metadata?.username === "string" ? conversation.metadata.username : null) ??
            conversation.contactInstagram ??
            null,
          threadId: conversation.externalThreadId,
          threadTitle: conversation.title,
          observedAt: sent.sentAt,
          source: "instagram-assisted-manual-send"
        });
      }

      reply.code(202);
      return {
        queued: false,
        sent: true
      };
    }

    reply.code(409);
    return { message: "Este canal ainda não suporta envio automático neste modo." };
  });
}
