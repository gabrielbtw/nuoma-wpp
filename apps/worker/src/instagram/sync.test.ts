import { describe, expect, it } from "vitest";

import {
  parseInstagramDisplayedTimestamp,
  shouldSkipInstagramSyncedDuplicate,
  stableInstagramMessageExternalId,
} from "./sync.js";

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

  it("parses Instagram relative timestamps with explicit precision", () => {
    expect(parseInstagramDisplayedTimestamp("Há 6 h", "2026-05-29T18:30:00.000Z")).toEqual({
      sentAt: "2026-05-29T12:30:00.000Z",
      timestampPrecision: "minute",
    });
    expect(parseInstagramDisplayedTimestamp("agora", "2026-05-29T18:30:00.000Z")).toEqual({
      sentAt: "2026-05-29T18:30:00.000Z",
      timestampPrecision: "second",
    });
    expect(parseInstagramDisplayedTimestamp("ontem", "2026-05-29T18:30:00.000Z")).toEqual({
      sentAt: "2026-05-28T18:30:00.000Z",
      timestampPrecision: "date",
    });
    expect(
      parseInstagramDisplayedTimestamp("21 de mai de 2026 11:41", "2026-05-29T18:30:00.000Z"),
    ).toEqual({
      sentAt: "2026-05-21T14:41:00.000Z",
      timestampPrecision: "minute",
    });
    expect(parseInstagramDisplayedTimestamp("Visto: Há 6 h", "2026-05-29T18:30:00.000Z")).toBe(
      null,
    );
  });

  it("skips synced outgoing duplicates already created by dispatch", () => {
    const existingMessages = [
      {
        direction: "outbound" as const,
        status: "sent" as const,
        body: "ig video media smoke",
        contentType: "video" as const,
        mediaAssetId: 5604,
        observedAtUtc: "2026-05-29T10:40:00.000Z",
      },
    ];

    expect(
      shouldSkipInstagramSyncedDuplicate({
        message: {
          direction: "outgoing",
          body: "ig video media smoke",
          contentType: "text",
          sentAt: "2026-05-29T10:41:00.000Z",
        },
        existingMessages,
        syncedAt: "2026-05-29T10:42:00.000Z",
      }),
    ).toBe(true);
    expect(
      shouldSkipInstagramSyncedDuplicate({
        message: {
          direction: "outgoing",
          body: "",
          contentType: "video",
          sentAt: "2026-05-29T10:41:00.000Z",
        },
        existingMessages,
        syncedAt: "2026-05-29T10:42:00.000Z",
      }),
    ).toBe(true);
    expect(
      shouldSkipInstagramSyncedDuplicate({
        message: {
          direction: "incoming",
          body: "61 98299.0982",
          contentType: "text",
          sentAt: "2026-05-21T14:41:00.000Z",
        },
        existingMessages: [
          {
            direction: "inbound",
            status: "received",
            body: "61 98299.0982",
            contentType: "text",
            mediaAssetId: null,
            observedAtUtc: "2026-05-21T14:41:00.000Z",
          },
        ],
        syncedAt: "2026-05-29T10:42:00.000Z",
      }),
    ).toBe(true);
  });
});
