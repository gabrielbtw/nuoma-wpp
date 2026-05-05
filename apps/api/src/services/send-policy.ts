import type { ApiEnv } from "@nuoma/config";

const CLIENT_ALLOWED_PHONE_OVERRIDE = "5531982066263";

export interface ApiSendPolicy {
  mode: ApiEnv["API_SEND_POLICY_MODE"];
  allowedPhones: string[];
}

export function resolveApiSendPolicy(
  env: ApiEnv,
  extraAllowedPhones: Array<string | null | undefined> = [],
): ApiSendPolicy {
  const allowedPhones = parsePhoneList(env.API_SEND_ALLOWED_PHONES, extraAllowedPhones);
  return {
    mode: env.API_SEND_POLICY_MODE,
    allowedPhones:
      env.API_SEND_POLICY_MODE === "test" && allowedPhones.length === 0
        ? ["5531982066263"]
        : allowedPhones,
  };
}

export function evaluateApiRealSendTarget(
  policy: ApiSendPolicy,
  phone: string,
): { allowed: true } | { allowed: false; reason: string } {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { allowed: false, reason: "invalid_phone" };
  }

  if (policy.mode === "test") {
    return policy.allowedPhones.includes(normalizedPhone)
      ? { allowed: true }
      : { allowed: false, reason: "not_allowlisted_for_test_execution" };
  }

  if (policy.allowedPhones.length > 0 && !policy.allowedPhones.includes(normalizedPhone)) {
    return { allowed: false, reason: "not_in_production_canary_allowlist" };
  }

  return { allowed: true };
}

export function parsePhoneList(
  csv: string | null | undefined,
  extraPhones: Array<string | null | undefined> = [],
): string[] {
  const phones = new Set<string>();
  for (const raw of [...(csv ?? "").split(","), ...extraPhones]) {
    const phone = normalizePhone(raw);
    if (phone) {
      phones.add(phone);
    }
  }
  return [...phones];
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

export function normalizeClientAllowedPhoneOverride(
  phone: string | null | undefined,
): string | undefined {
  return normalizePhone(phone) === CLIENT_ALLOWED_PHONE_OVERRIDE
    ? CLIENT_ALLOWED_PHONE_OVERRIDE
    : undefined;
}
