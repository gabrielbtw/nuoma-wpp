import type { Conversation } from "@nuoma/contracts";

export function conversationDisplayTitle(conversation: Conversation): string {
  const phone = normalizePhone(conversation.externalThreadId) ?? normalizePhone(conversation.title);
  const title = conversation.title.trim();

  if (conversation.channel !== "whatsapp") {
    return title || conversation.externalThreadId;
  }

  if (phone && isPotentialContactName(title) && normalizePhone(title) !== phone) {
    return title;
  }

  if (conversation.contactId != null && isPotentialContactName(title)) {
    return title;
  }

  if (phone) {
    return formatBrazilianPhone(phone);
  }

  return `Thread #${conversation.id}`;
}

export function conversationSearchText(conversation: Conversation): string {
  return [
    conversationDisplayTitle(conversation),
    conversation.externalThreadId,
    conversation.title,
    conversation.lastPreview ?? "",
  ].join(" ");
}

export function conversationIdentityLine(conversation: Conversation): string {
  const phone = normalizePhone(conversation.externalThreadId) ?? normalizePhone(conversation.title);
  if (phone) {
    return formatBrazilianPhone(phone);
  }
  return conversation.externalThreadId;
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

function isPotentialContactName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalizePhone(normalized)) return false;
  if (normalized === "online") return false;
  if (normalized === "whatsapp" || normalized === "whatsapp business") return false;
  if (normalized === "conta comercial" || normalized === "business account") return false;
  if (normalized.startsWith("visto por último")) return false;
  if (normalized.startsWith("last seen")) return false;
  if (normalized.includes("clique para mostrar")) return false;
  if (normalized.includes("click to view")) return false;
  if (normalized.includes("digitando")) return false;
  if (normalized.includes("typing")) return false;
  return true;
}

function formatBrazilianPhone(phone: string): string {
  if (phone.length === 13 && phone.startsWith("55")) {
    return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  if (phone.length === 12 && phone.startsWith("55")) {
    return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 8)}-${phone.slice(8)}`;
  }
  return phone;
}
