import { describe, expect, it } from "vitest";

import { extractIdempotencyKeyFromJobPayload, idempotencyKey } from "./idempotency.js";

describe("idempotencyKey", () => {
  it("is deterministic for equivalent inputs regardless of property order", () => {
    const a = idempotencyKey({
      kind: "campaign_step",
      userId: 1,
      campaignId: 42,
      recipientId: 7,
      stepId: "welcome",
    });
    const b = idempotencyKey({
      stepId: "welcome",
      recipientId: 7,
      campaignId: 42,
      userId: 1,
      kind: "campaign_step",
    });
    expect(a).toBe(b);
    expect(a.startsWith("campaign_step:")).toBe(true);
    expect(a.length).toBe("campaign_step:".length + 16);
  });

  it("yields distinct keys for different recipients and step ids", () => {
    const base = {
      kind: "campaign_step" as const,
      userId: 1,
      campaignId: 42,
      stepId: "welcome",
    };
    const k1 = idempotencyKey({ ...base, recipientId: 1 });
    const k2 = idempotencyKey({ ...base, recipientId: 2 });
    const k3 = idempotencyKey({ ...base, recipientId: 1, stepId: "follow_up" });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("namespaces by kind so a manual send never collides with a campaign step", () => {
    const manual = idempotencyKey({
      kind: "manual",
      userId: 1,
      conversationId: 9,
      clientNonce: "abcdef1234567890",
    });
    const step = idempotencyKey({
      kind: "campaign_step",
      userId: 1,
      campaignId: 9,
      recipientId: 1,
      stepId: "abcdef1234567890",
    });
    expect(manual.startsWith("manual:")).toBe(true);
    expect(step.startsWith("campaign_step:")).toBe(true);
    expect(manual).not.toBe(step);
  });
});

describe("extractIdempotencyKeyFromJobPayload", () => {
  it("returns the key from payload when present", () => {
    expect(extractIdempotencyKeyFromJobPayload({ idempotencyKey: "cstep:abc123" }, 999)).toBe(
      "cstep:abc123",
    );
  });

  it("falls back to legacy:job:<id> when payload is missing the key", () => {
    expect(extractIdempotencyKeyFromJobPayload({ foo: "bar" }, 17)).toBe("legacy:job:17");
    expect(extractIdempotencyKeyFromJobPayload(null, 17)).toBe("legacy:job:17");
    expect(extractIdempotencyKeyFromJobPayload(undefined, 17)).toBe("legacy:job:17");
  });

  it("falls back when the key is present but empty/non-string", () => {
    expect(extractIdempotencyKeyFromJobPayload({ idempotencyKey: "" }, 5)).toBe("legacy:job:5");
    expect(extractIdempotencyKeyFromJobPayload({ idempotencyKey: 42 }, 5)).toBe("legacy:job:5");
  });
});
