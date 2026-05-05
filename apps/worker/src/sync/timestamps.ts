import type { TimestampPrecision } from "@nuoma/contracts";

const SAO_PAULO_OFFSET = "-03:00";

export interface ParsedWhatsAppTimestamp {
  waDisplayedAt: string | null;
  timestampPrecision: TimestampPrecision;
  messageSecond: number | null;
  minuteKey: string | null;
}

export interface MessageForInference {
  waDisplayedAt: string | null;
  timestampPrecision: TimestampPrecision;
  messageSecond: number | null;
}

export function parseWhatsAppDisplayedAt(text: string | null): ParsedWhatsAppTimestamp {
  if (!text) {
    return emptyTimestamp();
  }

  const match = text.match(
    /\[(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?,\s*(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{2,4})\]/,
  );
  if (!match?.groups) {
    return emptyTimestamp();
  }

  const hour = pad2(match.groups.hour);
  const minute = pad2(match.groups.minute);
  const day = pad2(match.groups.day);
  const month = pad2(match.groups.month);
  const year = normalizeYear(match.groups.year);
  const second = match.groups.second ? pad2(match.groups.second) : "00";
  const messageSecond = match.groups.second ? Number(second) : null;
  const waDisplayedAt = `${year}-${month}-${day}T${hour}:${minute}:${second}.000${SAO_PAULO_OFFSET}`;

  return {
    waDisplayedAt,
    timestampPrecision: messageSecond === null ? "minute" : "second",
    messageSecond,
    minuteKey: `${year}-${month}-${day}T${hour}:${minute}${SAO_PAULO_OFFSET}`,
  };
}

export function inferVisibleMessageSeconds<T extends MessageForInference>(
  messages: readonly T[],
): Array<T & { waInferredSecond: number | null }> {
  const byMinute = new Map<string, number[]>();

  messages.forEach((message, index) => {
    if (typeof message.messageSecond === "number") {
      return;
    }
    const key = minuteKeyFromIso(message.waDisplayedAt);
    if (!key) {
      return;
    }
    const indexes = byMinute.get(key) ?? [];
    indexes.push(index);
    byMinute.set(key, indexes);
  });

  const inferred = messages.map((message) => ({
    ...message,
    waInferredSecond:
      typeof message.messageSecond === "number" ? message.messageSecond : (null as number | null),
  }));

  for (const indexes of byMinute.values()) {
    const start = Math.max(0, 60 - indexes.length);
    indexes.forEach((messageIndex, groupIndex) => {
      const message = inferred[messageIndex];
      if (message) {
        message.waInferredSecond = Math.min(59, start + groupIndex);
      }
    });
  }

  return inferred;
}

function minuteKeyFromIso(value: string | null): string | null {
  if (!value || value.length < 22) {
    return null;
  }
  return `${value.slice(0, 16)}${value.slice(-6)}`;
}

function emptyTimestamp(): ParsedWhatsAppTimestamp {
  return {
    waDisplayedAt: null,
    timestampPrecision: "unknown",
    messageSecond: null,
    minuteKey: null,
  };
}

function pad2(value: string | undefined): string {
  return String(value ?? "0").padStart(2, "0");
}

function normalizeYear(value: string | undefined): string {
  const year = String(value ?? "");
  if (year.length === 2) {
    return `20${year}`;
  }
  return year.padStart(4, "0");
}
