import type { CampaignStep } from "@nuoma/contracts";

export interface BuildAbVariantsMetadataInput {
  enabled: boolean;
  steps: CampaignStep[];
  controlLabel: string;
  controlWeight: string;
  variantLabel: string;
  variantWeight: string;
  variantTemplate: string;
}

export function buildAbVariantsMetadata(input: BuildAbVariantsMetadataInput) {
  if (!input.enabled) {
    return null;
  }
  const textStep = input.steps.find((step) => step.type === "text");
  if (!textStep) {
    return null;
  }
  return {
    enabled: true,
    assignment: "deterministic",
    variants: [
      {
        id: "a",
        label: input.controlLabel.trim() || "Controle",
        weight: positiveWeight(input.controlWeight),
        stepOverrides: {},
      },
      {
        id: "b",
        label: input.variantLabel.trim() || "Variante B",
        weight: positiveWeight(input.variantWeight),
        stepOverrides: {
          [textStep.id]: {
            template: input.variantTemplate.trim() || textStep.template,
          },
        },
      },
    ],
  };
}

function positiveWeight(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
}
