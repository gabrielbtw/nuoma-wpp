import { describe, expect, it } from "vitest";

import { attendantSchema } from "./attendants.js";
import { automationSchema, createAutomationInputSchema } from "./automations.js";
import { campaignSchema, createCampaignInputSchema } from "./campaigns.js";
import { chatbotRuleSchema, chatbotSchema } from "./chatbots.js";
import { contactSchema, createContactInputSchema } from "./contacts.js";
import { conversationSchema } from "./conversations.js";
import {
  attendantFixture,
  automationFixture,
  campaignFixture,
  chatbotFixture,
  chatbotRuleFixture,
  contactFixture,
  conversationFixture,
  jobFixture,
  mediaAssetFixture,
  messageFixture,
  reminderFixture,
  tagFixture,
  userFixture,
} from "./fixtures.js";
import { jobSchema } from "./jobs.js";
import { mediaAssetSchema } from "./media-assets.js";
import { messageSchema } from "./messages.js";
import { reminderSchema } from "./reminders.js";
import { tagSchema } from "./tags.js";
import { userSchema } from "./users.js";

const fixtureCases = [
  ["user", userSchema, userFixture],
  ["contact", contactSchema, contactFixture],
  ["conversation", conversationSchema, conversationFixture],
  ["message", messageSchema, messageFixture],
  ["tag", tagSchema, tagFixture],
  ["mediaAsset", mediaAssetSchema, mediaAssetFixture],
  ["campaign", campaignSchema, campaignFixture],
  ["automation", automationSchema, automationFixture],
  ["chatbot", chatbotSchema, chatbotFixture],
  ["chatbotRule", chatbotRuleSchema, chatbotRuleFixture],
  ["attendant", attendantSchema, attendantFixture],
  ["job", jobSchema, jobFixture],
  ["reminder", reminderSchema, reminderFixture],
] as const;

describe("domain fixtures", () => {
  it.each(fixtureCases)("validates %s", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
  });
});

describe("domain input defaults", () => {
  it("allows contacts without phone for Instagram-only contacts", () => {
    const result = createContactInputSchema.parse({
      userId: 1,
      name: "Instagram only",
      phone: null,
      primaryChannel: "instagram",
      instagramHandle: "instagram.only",
    });

    expect(result.phone).toBeNull();
    expect(result.primaryChannel).toBe("instagram");
  });

  it("keeps WhatsApp minute precision explicit for captured messages", () => {
    const result = messageSchema.parse(messageFixture);

    expect(result.timestampPrecision).toBe("minute");
    expect(result.messageSecond).toBeNull();
    expect(result.waInferredSecond).toBe(59);
    expect(result.observedAtUtc).toBe("2026-04-30T15:00:42.123Z");
  });

  it("defaults campaign and automation metadata safely", () => {
    const campaign = createCampaignInputSchema.parse({
      userId: 1,
      name: "Teste",
      steps: campaignFixture.steps,
    });
    const automation = createAutomationInputSchema.parse({
      userId: 1,
      name: "Auto",
      category: "Relacionamento",
      trigger: automationFixture.trigger,
      condition: automationFixture.condition,
      actions: automationFixture.actions,
    });

    expect(campaign.channel).toBe("whatsapp");
    expect(campaign.metadata).toEqual({});
    expect(automation.metadata).toEqual({});
  });
});
