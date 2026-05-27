import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone.js";

describe("normalizePhone", () => {
  it("normalizes Brazilian local and E.164-like inputs to the same canonical digits", () => {
    expect(normalizePhone("31982066263")).toBe("5531982066263");
    expect(normalizePhone("5531982066263")).toBe("5531982066263");
    expect(normalizePhone("+55 31 98206-6263")).toBe("5531982066263");
  });

  it("accepts WhatsApp thread identifiers without using display names as identity", () => {
    expect(normalizePhone("5531982066263@c.us")).toBe("5531982066263");
    expect(normalizePhone("Gabriel Braga")).toBeNull();
  });

  it("rejects ambiguous short numbers without country and area code", () => {
    expect(normalizePhone("982066263")).toBeNull();
    expect(normalizePhone("2066263")).toBeNull();
  });
});
