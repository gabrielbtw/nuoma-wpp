import type { FastifyInstance } from "fastify";
import {
  addMessage,
  enqueueJob,
  getConversationById,
  listConversations,
  listMessagesForConversation,
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
