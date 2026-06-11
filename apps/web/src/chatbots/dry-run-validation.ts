export type ChatbotDryRunChannel = "whatsapp" | "instagram";

export interface ChatbotDryRunValidationInput {
  channel: ChatbotDryRunChannel;
  identity: string;
  body: string;
}

export interface ChatbotDryRunValidationResult {
  valid: boolean;
  values: {
    channel: ChatbotDryRunChannel;
    identity: string;
    body: string;
  };
  errors: {
    identity?: string;
    body?: string;
  };
}

export function validateChatbotDryRun(
  input: ChatbotDryRunValidationInput,
): ChatbotDryRunValidationResult {
  const errors: ChatbotDryRunValidationResult["errors"] = {};
  const body = input.body.trim();
  const identity =
    input.channel === "instagram"
      ? normalizeInstagramHandle(input.identity)
      : normalizeBrazilianWhatsappPhone(input.identity);

  if (!identity) {
    errors.identity =
      input.channel === "instagram"
        ? "Use apenas o @handle, sem URL ou espaços."
        : "Use um WhatsApp com DDD, ex: 31982066263 ou +55 31 9 8206-6263.";
  }
  if (!body) {
    errors.body = "Digite uma mensagem para simular o chatbot.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    values: {
      channel: input.channel,
      identity: identity ?? input.identity.trim(),
      body,
    },
    errors,
  };
}

function normalizeBrazilianWhatsappPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return null;
}

function normalizeInstagramHandle(value: string): string | null {
  const handle = value.trim().replace(/^@+/, "");
  if (
    !handle ||
    handle.length > 30 ||
    handle.includes("/") ||
    handle.includes(" ") ||
    !/^[a-zA-Z0-9._]+$/.test(handle)
  ) {
    return null;
  }
  return handle;
}
