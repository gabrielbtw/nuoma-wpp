import { z } from "zod";

export const phoneE164DigitsSchema = z.string().regex(/^55\d{10,11}$/);

export function normalizePhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) {
    return null;
  }

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

export function isPhoneE164Digits(value: string | null | undefined): boolean {
  return normalizePhone(value) === value;
}

export type PhoneE164Digits = z.infer<typeof phoneE164DigitsSchema>;
