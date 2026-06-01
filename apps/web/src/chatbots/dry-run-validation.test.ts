import { describe, expect, it } from "vitest";

import { validateChatbotDryRun } from "./dry-run-validation.js";

describe("chatbot dry-run validation", () => {
  it("normalizes Brazilian WhatsApp variants before the dry-run mutation", () => {
    for (const identity of ["5531982066263", "31982066263", "+55 31 9 8206-6263"]) {
      const result = validateChatbotDryRun({
        channel: "whatsapp",
        identity,
        body: "Qual o preco?",
      });

      expect(result.valid).toBe(true);
      expect(result.values.identity).toBe("5531982066263");
      expect(result.errors.identity).toBeUndefined();
    }
  });

  it("returns inline field errors for invalid WhatsApp dry-runs", () => {
    const result = validateChatbotDryRun({
      channel: "whatsapp",
      identity: "982066263",
      body: " ",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({
      identity: "Use um WhatsApp com DDD, ex: 31982066263 ou +55 31 9 8206-6263.",
      body: "Digite uma mensagem para simular o chatbot.",
    });
  });

  it("normalizes Instagram handles and rejects URLs before the dry-run mutation", () => {
    const valid = validateChatbotDryRun({
      channel: "instagram",
      identity: "@nuoma.crm",
      body: "Oi",
    });
    const invalid = validateChatbotDryRun({
      channel: "instagram",
      identity: "https://instagram.com/nuoma.crm",
      body: "Oi",
    });

    expect(valid.valid).toBe(true);
    expect(valid.values.identity).toBe("nuoma.crm");
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.identity).toBe("Use apenas o @handle, sem URL ou espaços.");
  });
});
