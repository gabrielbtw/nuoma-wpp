function digitsOnly(input: string) {
  return input.replace(/\D/g, "");
}

export function formatInstagramHandle(input?: string | null) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function normalizeCpf(input?: string | null) {
  if (!input) {
    return null;
  }

  const digits = digitsOnly(input);
  return digits.length > 0 ? digits : null;
}

export function isValidCpf(input?: string | null) {
  const digits = normalizeCpf(input);
  if (!digits || digits.length !== 11) {
    return false;
  }

  if (/^(\d)\1{10}$/.test(digits)) {
    return false;
  }

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(digits[index]) * (10 - index);
  }

  let remainder = (sum * 10) % 11;
  if (remainder === 10) {
    remainder = 0;
  }

  if (remainder !== Number(digits[9])) {
    return false;
  }

  sum = 0;
  for (let index = 0; index < 10; index += 1) {
    sum += Number(digits[index]) * (11 - index);
  }

  remainder = (sum * 10) % 11;
  if (remainder === 10) {
    remainder = 0;
  }

  return remainder === Number(digits[10]);
}

export function formatCpfInput(input?: string | null) {
  const digits = digitsOnly(input ?? "").slice(0, 11);
  if (!digits) {
    return "";
  }

  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  }

  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function startsWithBrazilPrefix(input?: string | null) {
  const trimmed = (input ?? "").trim();
  return trimmed.startsWith("+55") || trimmed.startsWith("55");
}

export function formatPhoneForInput(input?: string | null) {
  const raw = (input ?? "").trim();
  if (!raw) {
    return "";
  }

  if (!startsWithBrazilPrefix(raw) && !(digitsOnly(raw).startsWith("55") && digitsOnly(raw).length >= 12)) {
    return raw;
  }

  const digits = digitsOnly(raw);
  if (!digits.startsWith("55")) {
    return raw;
  }

  const local = digits.slice(2, 13);
  const prefix = raw.startsWith("+") ? "+55" : "55";
  if (!local) {
    return prefix;
  }

  if (local.length <= 2) {
    return `${prefix} (${local}`;
  }

  const area = local.slice(0, 2);
  const subscriber = local.slice(2);
  if (!subscriber) {
    return `${prefix} (${area})`;
  }

  if (subscriber.length <= 4) {
    return `${prefix} (${area}) ${subscriber}`;
  }

  if (subscriber.length <= 8) {
    return `${prefix} (${area}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
  }

  return `${prefix} (${area}) ${subscriber.slice(0, 5)}-${subscriber.slice(5, 9)}`;
}

export function normalizePhoneForSubmission(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (!startsWithBrazilPrefix(trimmed)) {
    return trimmed;
  }

  const digits = digitsOnly(trimmed);
  return digits.startsWith("55") ? digits : trimmed;
}

export function formatPhoneForDisplay(input?: string | null) {
  const raw = (input ?? "").trim();
  if (!raw) {
    return "-";
  }

  const digits = digitsOnly(raw);
  if (digits.startsWith("55") && digits.length >= 12) {
    return formatPhoneForInput(raw.startsWith("+") ? raw : `+${digits}`);
  }

  return raw;
}

export function formatChannelDisplayValue(type: string, input?: string | null) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return "";
  }

  return type === "instagram" ? formatInstagramHandle(trimmed) : formatPhoneForDisplay(trimmed);
}
