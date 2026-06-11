import { describe, expect, it } from "vitest";

import { validateContactDetailsDraft } from "./contact-details-validation.js";

describe("contact details validation", () => {
  it("normalizes BR WhatsApp phone variants to one canonical identity", () => {
    for (const phone of ["5531982066263", "31982066263", "+55 31 9 8206-6263"]) {
      const result = validateContactDetailsDraft({
        name: "Gabriel",
        phone,
        email: "",
        instagramHandle: "",
      });

      expect(result.valid).toBe(true);
      expect(result.values.phone).toBe("5531982066263");
      expect(result.errors.phone).toBeUndefined();
    }
  });

  it("returns inline field errors before the contact update mutation", () => {
    const result = validateContactDetailsDraft({
      name: " ",
      phone: "982066263",
      email: "gabriel@",
      instagramHandle: "https://instagram.com/gabriel",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({
      name: "Informe um nome visível para o contato.",
      phone: "Use um WhatsApp com DDD, ex: 31982066263 ou +55 31 9 8206-6263.",
      email: "Use um email válido ou deixe o campo em branco.",
      instagramHandle: "Use apenas o @handle, sem espaços ou URL.",
    });
  });
});
