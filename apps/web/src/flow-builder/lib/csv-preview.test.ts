import { describe, expect, it } from "vitest";

import { parseCsvPreview } from "./csv-preview.js";

describe("parseCsvPreview", () => {
  it("parses semicolon CSV with Portuguese headers", () => {
    const preview = parseCsvPreview("telefone;nome;email\n(31) 98206-6263;Gabriel;g@example.com");

    expect(preview).toMatchObject({
      headers: ["telefone", "nome", "email"],
      phoneHeader: "telefone",
      totalRows: 1,
      validCount: 1,
      invalidCount: 0,
    });
    expect(preview.rows[0]).toMatchObject({
      rowNumber: 2,
      phone: "5531982066263",
      name: "Gabriel",
      email: "g@example.com",
      valid: true,
    });
  });

  it("parses comma CSV with BOM and English headers", () => {
    const preview = parseCsvPreview("\uFEFFphone,name,e-mail\n+55 31 98206-6263,Ana,a@example.com");

    expect(preview.headers).toEqual(["phone", "name", "e-mail"]);
    expect(preview.phoneHeader).toBe("phone");
    expect(preview.rows[0]).toMatchObject({
      phone: "5531982066263",
      name: "Ana",
      email: "a@example.com",
    });
  });

  it("marks duplicate phones after normalization", () => {
    const preview = parseCsvPreview("whatsapp,nome\n31982066263,A\n5531982066263,B");

    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(1);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.rows[1]).toMatchObject({
      phone: "5531982066263",
      duplicate: true,
      valid: false,
      errors: ["telefone duplicado"],
    });
  });

  it("keeps invalid phone text in the row and reports the line error", () => {
    const preview = parseCsvPreview("number,contact\n123,Lead ruim");

    expect(preview.validCount).toBe(0);
    expect(preview.invalidCount).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      phone: "123",
      valid: false,
      errors: ["telefone inválido"],
    });
    expect(preview.errors).toContain("Linha 2: telefone inválido");
  });
});
