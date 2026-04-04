import type { FastifyInstance } from "fastify";
import {
  listChatbots, getChatbot, createChatbot, updateChatbot, deleteChatbot,
  chatbotInputSchema
} from "@nuoma/core";

export async function registerChatbotRoutes(app: FastifyInstance) {
  app.get("/chatbots", async () => listChatbots());

  app.get("/chatbots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const chatbot = getChatbot(id);
    if (!chatbot) return reply.status(404).send({ error: "Chatbot nao encontrado" });
    return chatbot;
  });

  app.post("/chatbots", async (req, reply) => {
    const input = chatbotInputSchema.parse(req.body);
    const chatbot = createChatbot(input);
    return reply.status(201).send(chatbot);
  });

  app.patch("/chatbots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = chatbotInputSchema.partial().parse(req.body);
    const chatbot = updateChatbot(id, input);
    if (!chatbot) return reply.status(404).send({ error: "Chatbot nao encontrado" });
    return chatbot;
  });

  app.delete("/chatbots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = deleteChatbot(id);
    if (!deleted) return reply.status(404).send({ error: "Chatbot nao encontrado" });
    return reply.status(204).send();
  });
}
