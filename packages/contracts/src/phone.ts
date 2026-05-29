import { z } from "zod";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

export const phoneE164Schema = z.string().regex(/^\+\d{8,15}$/);
export const phoneE164DigitsSchema = z.string().regex(/^55\d{10,11}$/);
export const waJidSchema = z.string().regex(/^\d{10,15}@s\.whatsapp\.net$/);

export function normalizePhoneE164(
  value: string | null | undefined,
  defaultCountry: CountryCode = "BR",
): string | null {
  const candidate = phoneCandidate(value);
  if (!candidate) {
    return null;
  }

  const digits = candidate.replace(/\D/g, "");
  const parseInput =
    candidate.trim().startsWith("+") ||
    (digits.startsWith("55") && (digits.length === 12 || digits.length === 13))
      ? `+${digits}`
      : candidate;
  const phone = parsePhoneNumberFromString(parseInput, defaultCountry);
  if (!phone?.isValid()) {
    return null;
  }
  return phone.format("E.164");
}

export function normalizePhone(
  value: string | null | undefined,
  defaultCountry: CountryCode = "BR",
): string | null {
  return normalizePhoneE164(value, defaultCountry)?.replace(/^\+/, "") ?? null;
}

export function normalizeWaJid(
  value: string | null | undefined,
  defaultCountry: CountryCode = "BR",
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw || /@g\.us$/i.test(raw) || /@broadcast$/i.test(raw)) {
    return null;
  }
  const phone = normalizePhone(raw, defaultCountry);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

export function isPhoneE164(value: string | null | undefined): boolean {
  return normalizePhoneE164(value) === value;
}

export function isPhoneE164Digits(value: string | null | undefined): boolean {
  return normalizePhone(value) === value;
}

function phoneCandidate(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const withoutJidSuffix = raw.split("@")[0]?.trim() ?? "";
  const digits = withoutJidSuffix.replace(/\D/g, "");
  if (digits.length < 10) {
    return null;
  }
  return withoutJidSuffix;
}

export type PhoneE164 = z.infer<typeof phoneE164Schema>;
export type PhoneE164Digits = z.infer<typeof phoneE164DigitsSchema>;
export type WaJid = z.infer<typeof waJidSchema>;
