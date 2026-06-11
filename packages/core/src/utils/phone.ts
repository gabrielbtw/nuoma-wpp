function digitsOnly(input: string) {
  return input.replace(/\D/g, "");
}

export function normalizeBrazilianPhone(input: string, defaultCountryCode = "55") {
  const digits = digitsOnly(input);
  if (!digits) {
    return null;
  }

  if (digits.startsWith(defaultCountryCode) && digits.length >= 12) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `${defaultCountryCode}${digits}`;
  }

  if (digits.length === 8 || digits.length === 9) {
    return `${defaultCountryCode}31${digits}`;
  }

  if (digits.length > 11 && !digits.startsWith(defaultCountryCode)) {
    return `${defaultCountryCode}${digits}`;
  }

  return digits.length >= 12 ? digits : null;
}

export function looksLikeValidWhatsAppCandidate(input: string) {
  const normalized = normalizeBrazilianPhone(input);
  return normalized != null && normalized.length >= 12 && normalized.length <= 13;
}

export function normalizeInstagramHandle(input?: string | null) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const normalized = withoutAt.replace(/\s+/g, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
