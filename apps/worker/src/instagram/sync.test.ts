import { describe, expect, it } from "vitest";

import { stableInstagramMessageExternalId } from "./sync.js";

describe("Instagram sync helpers", () => {
  it("keeps stable explicit external ids and hashes positional browser ids", () => {
    const thread = {
      threadId: "110051807055981",
      messages: [
        {
          externalId: "server-id-1",
          direction: "incoming" as const,
          body: "Oi",
          contentType: "text" as const,
          sentAt: null,
        },
        {
          externalId: "ig-browser-random",
          direction: "outgoing" as const,
          body: "Tudo bem?",
          contentType: "text" as const,
          sentAt: null,
        },
      ],
    };

    expect(stableInstagramMessageExternalId(thread, 0, thread.messages[0]!)).toBe("server-id-1");
    expect(stableInstagramMessageExternalId(thread, 1, thread.messages[1]!)).toMatch(
      /^ig:110051807055981:e0:outgoing:/,
    );
    expect(stableInstagramMessageExternalId(thread, 1, thread.messages[1]!)).toBe(
      stableInstagramMessageExternalId(thread, 1, thread.messages[1]!),
    );
  });
});
