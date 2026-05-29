import { describe, expect, it } from "vitest";

import {
  normalizePhone,
  normalizePhoneE164,
  normalizeWaJid,
  phoneE164Schema,
  waJidSchema,
} from "./phone.js";

describe("normalizePhone", () => {
  it("normalizes Brazilian local and E.164-like inputs to the same canonical digits", () => {
    expect(normalizePhone("31982066263")).toBe("5531982066263");
    expect(normalizePhone("5531982066263")).toBe("5531982066263");
    expect(normalizePhone("+55 31 98206-6263")).toBe("5531982066263");
    expect(normalizePhoneE164("31982066263")).toBe("+5531982066263");
    expect(normalizePhoneE164("5531982066263")).toBe("+5531982066263");
    expect(normalizePhoneE164("+55 31 9 8206-6263")).toBe("+5531982066263");
    expect(phoneE164Schema.parse("+5531982066263")).toBe("+5531982066263");
  });

  it("accepts WhatsApp thread identifiers without using display names as identity", () => {
    expect(normalizePhone("5531982066263@c.us")).toBe("5531982066263");
    expect(normalizeWaJid("5531982066263@c.us")).toBe("5531982066263@s.whatsapp.net");
    expect(normalizeWaJid("5531982066263@s.whatsapp.net")).toBe("5531982066263@s.whatsapp.net");
    expect(normalizeWaJid("+55 31 9 8206-6263")).toBe("5531982066263@s.whatsapp.net");
    expect(waJidSchema.parse("5531982066263@s.whatsapp.net")).toBe("5531982066263@s.whatsapp.net");
    expect(normalizePhone("Gabriel Braga")).toBeNull();
    expect(normalizeWaJid("Gabriel Braga")).toBeNull();
    expect(normalizeWaJid("5531982066263@g.us")).toBeNull();
  });

  it("rejects ambiguous short numbers without country and area code", () => {
    expect(normalizePhone("982066263")).toBeNull();
    expect(normalizePhone("2066263")).toBeNull();
  });
});
