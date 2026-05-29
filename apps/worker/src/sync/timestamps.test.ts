import { describe, expect, it } from "vitest";

import { inferVisibleMessageSeconds, parseWhatsAppDisplayedAt } from "./timestamps.js";

describe("WhatsApp timestamp normalization", () => {
  it("keeps minute precision when WhatsApp does not expose seconds", () => {
    const parsed = parseWhatsAppDisplayedAt("[15:34, 30/04/2026] Maria: ");

    expect(parsed).toEqual({
      waDisplayedAt: "2026-04-30T15:34:00.000-03:00",
      timestampPrecision: "minute",
      messageSecond: null,
      minuteKey: "2026-04-30T15:34-03:00",
    });
  });

  it("uses real seconds only when the source text exposes them", () => {
    const parsed = parseWhatsAppDisplayedAt("[15:34:27, 30/04/2026] Maria: ");

    expect(parsed.timestampPrecision).toBe("second");
    expect(parsed.messageSecond).toBe(27);
    expect(parsed.waDisplayedAt).toBe("2026-04-30T15:34:27.000-03:00");
  });

  it("corrects swapped day and month when the parsed date is far in the future", () => {
    const parsed = parseWhatsAppDisplayedAt(
      "[15:35, 05/08/2026] Maria: ",
      "2026-05-08T18:35:46.438Z",
    );

    expect(parsed).toEqual({
      waDisplayedAt: "2026-05-08T15:35:00.000-03:00",
      timestampPrecision: "minute",
      messageSecond: null,
      minuteKey: "2026-05-08T15:35-03:00",
    });
  });

  it("infers same-minute ordering with the newest visible message as second 59", () => {
    const inferred = inferVisibleMessageSeconds([
      {
        waDisplayedAt: "2026-04-30T15:34:00.000-03:00",
        timestampPrecision: "minute",
        messageSecond: null,
      },
      {
        waDisplayedAt: "2026-04-30T15:34:00.000-03:00",
        timestampPrecision: "minute",
        messageSecond: null,
      },
      {
        waDisplayedAt: "2026-04-30T15:34:00.000-03:00",
        timestampPrecision: "minute",
        messageSecond: null,
      },
    ]);

    expect(inferred.map((message) => message.waInferredSecond)).toEqual([57, 58, 59]);
  });
});
