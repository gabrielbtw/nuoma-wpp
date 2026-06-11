import { describe, expect, it } from "vitest";

import { resolveConversationSyncPhone } from "./conversation-sync-target.js";

describe("conversation sync target", () => {
  it("prefers canonical wa_jid before external thread id", () => {
    expect(
      resolveConversationSyncPhone({
        waJid: "5531982066263@s.whatsapp.net",
        externalThreadId: "Saved Contact",
      }),
    ).toBe("5531982066263");
  });

  it("normalizes legacy external WhatsApp thread ids", () => {
    expect(
      resolveConversationSyncPhone({
        waJid: null,
        externalThreadId: "+55 31 9 8206-6263",
      }),
    ).toBe("5531982066263");
  });

  it("does not derive a phone from display names", () => {
    expect(
      resolveConversationSyncPhone({
        waJid: null,
        externalThreadId: "Gabriel Braga",
      }),
    ).toBeUndefined();
  });
});
