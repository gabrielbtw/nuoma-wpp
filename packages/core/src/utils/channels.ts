import type { ChannelType } from "../types/domain.js";
import { normalizeBrazilianPhone, normalizeInstagramHandle } from "./phone.js";

function digitsOnly(input: string) {
  return input.replace(/\D/g, "");
}

export function normalizeWhatsAppValue(input?: string | null) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const digits = digitsOnly(trimmed);
  if (!digits) {
    return null;
  }

  if (trimmed.startsWith("+") && !trimmed.startsWith("+55")) {
    return digits;
  }

  return normalizeBrazilianPhone(trimmed) ?? digits;
}

export function normalizeChannelValue(type: ChannelType, input?: string | null) {
  if (!input) {
    return null;
  }

  switch (type) {
    case "instagram":
      return normalizeInstagramHandle(input);
    case "whatsapp":
    default:
      return normalizeWhatsAppValue(input);
  }
}

export function normalizeChannelDisplayValue(type: ChannelType, input?: string | null) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (type === "instagram") {
    const normalized = normalizeInstagramHandle(trimmed);
    return normalized ? `@${normalized}` : trimmed;
  }

  return trimmed;
}

export function defaultChannelAccountKey(type: ChannelType) {
  return type === "instagram" ? "instagram-assisted" : "whatsapp-local";
}

export function defaultChannelAccountDisplayName(type: ChannelType) {
  return type === "instagram" ? "Instagram Assistido" : "WhatsApp Local";
}

export function defaultChannelAccountStatus(type: ChannelType) {
  return type === "instagram" ? "assisted" : "connected";
}
