import { normalizePhone } from "@nuoma/contracts";

export function resolveConversationSyncPhone(input: {
  waJid?: string | null;
  externalThreadId: string;
}): string | undefined {
  return normalizePhone(input.waJid) ?? normalizePhone(input.externalThreadId) ?? undefined;
}
