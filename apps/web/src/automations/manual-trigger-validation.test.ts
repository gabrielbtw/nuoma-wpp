import { describe, expect, it } from "vitest";

import { validateAutomationManualTrigger } from "./manual-trigger-validation.js";

describe("validateAutomationManualTrigger", () => {
  it.each(["31982066263", "5531982066263", "+55 31 9 8206-6263"])(
    "normalizes %s to the same canonical WhatsApp target",
    (phone) => {
      expect(validateAutomationManualTrigger({ automationId: "12", phone })).toMatchObject({
        automationId: 12,
        phone: "5531982066263",
        valid: true,
        errors: {},
      });
    },
  );

  it("returns inline field errors before the mutation can run", () => {
    expect(validateAutomationManualTrigger({ automationId: "0", phone: "Gabriel salvo" })).toEqual({
      automationId: null,
      phone: null,
      valid: false,
      errors: {
        automationId: "Informe um ID positivo.",
        phone: "Informe um telefone WhatsApp valido.",
      },
    });
  });
});
