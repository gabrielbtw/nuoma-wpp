import { normalizePhone } from "@nuoma/contracts";

export interface AutomationManualTriggerValidationInput {
  automationId: string;
  phone: string;
}

export interface AutomationManualTriggerValidationResult {
  automationId: number | null;
  phone: string | null;
  errors: {
    automationId?: string;
    phone?: string;
  };
  valid: boolean;
}

export function validateAutomationManualTrigger(
  input: AutomationManualTriggerValidationInput,
): AutomationManualTriggerValidationResult {
  const automationId = Number(input.automationId);
  const normalizedPhone = normalizePhone(input.phone);
  const errors: AutomationManualTriggerValidationResult["errors"] = {};

  if (!Number.isInteger(automationId) || automationId <= 0) {
    errors.automationId = "Informe um ID positivo.";
  }

  if (!normalizedPhone) {
    errors.phone = "Informe um telefone WhatsApp valido.";
  }

  return {
    automationId: errors.automationId ? null : automationId,
    phone: normalizedPhone,
    errors,
    valid: Object.keys(errors).length === 0,
  };
}
