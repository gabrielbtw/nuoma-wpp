import type { FastifyInstance } from "fastify";
import { registerAutomationRoutes } from "./automations.js";
import { registerCampaignRoutes } from "./campaigns.js";
import { registerContactRoutes } from "./contacts.js";
import { registerConversationRoutes } from "./conversations.js";
import { registerDataLakeRoutes } from "./data-lake.js";
import { registerInstagramRoutes } from "./instagram.js";
import { registerSystemRoutes } from "./system.js";
import { registerTagRoutes } from "./tags.js";
import { registerChatbotRoutes } from "./chatbots.js";
import { registerAttendantRoutes } from "./attendants.js";
import { registerTemplateRoutes } from "./templates.js";
import { registerUploadRoutes } from "./uploads.js";

export async function registerRoutes(app: FastifyInstance) {
  await registerSystemRoutes(app);
  await registerContactRoutes(app);
  await registerTagRoutes(app);
  await registerConversationRoutes(app);
  await registerDataLakeRoutes(app);
  await registerInstagramRoutes(app);
  await registerAutomationRoutes(app);
  await registerCampaignRoutes(app);
  await registerChatbotRoutes(app);
  await registerAttendantRoutes(app);
  await registerTemplateRoutes(app);
  await registerUploadRoutes(app);
}
