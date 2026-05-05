import type { SyncEvent } from "./events.js";

export interface WaFlowTraceFilter {
  phone?: string;
  externalThreadId?: string;
}

export function filterWhatsAppFlowTrace(
  events: SyncEvent[],
  filter: WaFlowTraceFilter,
): SyncEvent[] {
  const normalizedPhone = normalizePhone(filter.phone);
  return events.filter((event) => {
    if (event.thread.channel !== "whatsapp") {
      return false;
    }
    if (filter.externalThreadId && event.thread.externalThreadId !== filter.externalThreadId) {
      return false;
    }
    if (!normalizedPhone) {
      return true;
    }
    const threadPhone =
      normalizePhone(event.thread.phone) ?? normalizePhone(event.thread.externalThreadId);
    return threadPhone === normalizedPhone;
  });
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}
