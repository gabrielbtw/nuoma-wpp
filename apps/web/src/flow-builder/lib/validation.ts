import type { CampaignStep, ChannelType } from "@nuoma/contracts";

import type { ConditionDraft, StepDraft, BuilderStepType } from "./build-steps.js";
import type { CsvPreviewResult } from "./csv-preview.js";

export interface StepFieldErrors {
  template?: string;
  url?: string;
  linkText?: string;
  mediaAssetId?: string;
  fileName?: string;
}

export interface ConditionFieldErrors {
  value?: string;
  targetStepId?: string;
}

export interface ReadyCheck {
  label: string;
  ok: boolean;
}

export const instagramSupportedStepTypes = new Set<BuilderStepType>([
  "text",
  "link",
  "image",
  "video",
]);

export function unsupportedInstagramStepLabels(steps: StepDraft[]): string[] {
  return steps
    .filter((step) => !instagramSupportedStepTypes.has(step.type))
    .map((step, index) => step.label.trim() || `Step ${index + 1}`);
}

export function stepDraftFieldErrors(step: StepDraft, order: number): StepFieldErrors {
  if (step.type === "text") {
    return step.template.trim() ? {} : { template: `Step ${order}: mensagem vazia.` };
  }

  if (step.type === "link") {
    return {
      ...(!step.url.trim() ? { url: `Step ${order}: informe a URL.` } : {}),
      ...(!step.linkText.trim() ? { linkText: `Step ${order}: informe o texto do link.` } : {}),
    };
  }

  if (step.type === "temporary_messages") {
    return {};
  }

  const mediaAssetId = Number.parseInt(step.mediaAssetId, 10);
  return {
    ...(!Number.isInteger(mediaAssetId) || mediaAssetId <= 0
      ? { mediaAssetId: `Step ${order}: informe um Media Asset ID válido.` }
      : {}),
    ...(step.type === "document" && !step.fileName.trim()
      ? { fileName: `Step ${order}: documento precisa de nome de arquivo.` }
      : {}),
  };
}

export function conditionFieldErrors(
  condition: ConditionDraft,
  stepOrder: number,
  conditionOrder: number,
): ConditionFieldErrors {
  const value = condition.value.trim();
  const targetStepId = condition.targetStepId.trim();
  return {
    ...((condition.type === "has_tag" || condition.type === "channel_is") && !value
      ? { value: `Step ${stepOrder}, condição ${conditionOrder}: informe o valor.` }
      : {}),
    ...(condition.action === "branch" && !targetStepId
      ? {
          targetStepId: `Step ${stepOrder}, condição ${conditionOrder}: branch precisa de destino.`,
        }
      : {}),
  };
}

export function readyChecks(input: {
  name: string;
  previewSteps: CampaignStep[];
  stepBuildError: string | null;
  channel: ChannelType;
  steps: StepDraft[];
  csvPreview: CsvPreviewResult | null;
  abEnabled: boolean;
  abTargetStep: CampaignStep | null;
}): ReadyCheck[] {
  const unsupportedInstagramSteps =
    input.channel === "instagram" ? unsupportedInstagramStepLabels(input.steps) : [];
  return [
    { label: "Nome", ok: Boolean(input.name.trim()) },
    { label: "Blocos", ok: input.previewSteps.length > 0 && !input.stepBuildError },
    { label: "Canal", ok: unsupportedInstagramSteps.length === 0 },
    { label: "Público", ok: !input.csvPreview || input.csvPreview.validCount > 0 },
    { label: "CSV", ok: !input.csvPreview || input.csvPreview.invalidCount === 0 },
    { label: "A/B", ok: !input.abEnabled || Boolean(input.abTargetStep) },
  ];
}
