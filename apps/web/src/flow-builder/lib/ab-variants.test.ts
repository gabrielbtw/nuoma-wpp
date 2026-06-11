import { describe, expect, it } from "vitest";

import { buildAbVariantsMetadata } from "./ab-variants.js";
import { buildStep, type StepDraft } from "./build-steps.js";

function textStep(overrides: Partial<StepDraft> = {}) {
  const step = buildStep(
    {
      id: "text 1!*",
      label: "Texto",
      type: "text",
      delaySeconds: "0",
      template: "Controle",
      url: "https://nuoma.com.br",
      linkText: "Ver detalhes",
      previewEnabled: true,
      mediaAssetId: "",
      fileName: "documento.pdf",
      caption: "",
      temporaryMessagesDuration: "24h",
      conditions: [],
      ...overrides,
    },
    1,
  );
  if (typeof step === "string") throw new Error(step);
  return step;
}

describe("buildAbVariantsMetadata", () => {
  it("returns null when disabled or when no text step exists", () => {
    expect(
      buildAbVariantsMetadata({
        enabled: false,
        steps: [textStep()],
        controlLabel: "A",
        controlWeight: "50",
        variantLabel: "B",
        variantWeight: "50",
        variantTemplate: "B",
      }),
    ).toBeNull();
    expect(
      buildAbVariantsMetadata({
        enabled: true,
        steps: [
          {
            id: "img",
            label: "Imagem",
            type: "image",
            delaySeconds: 0,
            conditions: [],
            mediaAssetId: 1,
            caption: null,
          },
        ],
        controlLabel: "A",
        controlWeight: "50",
        variantLabel: "B",
        variantWeight: "50",
        variantTemplate: "B",
      }),
    ).toBeNull();
  });

  it("normalizes weights and creates stepOverrides for the first text step id", () => {
    const metadata = buildAbVariantsMetadata({
      enabled: true,
      steps: [textStep()],
      controlLabel: " ",
      controlWeight: "120",
      variantLabel: "",
      variantWeight: "abc",
      variantTemplate: " Variante ",
    });

    expect(metadata).toEqual({
      enabled: true,
      assignment: "deterministic",
      variants: [
        { id: "a", label: "Controle", weight: 100, stepOverrides: {} },
        {
          id: "b",
          label: "Variante B",
          weight: 50,
          stepOverrides: {
            text1: { template: "Variante" },
          },
        },
      ],
    });
  });

  it("falls back to the control template when variant template is blank", () => {
    expect(
      buildAbVariantsMetadata({
        enabled: true,
        steps: [textStep({ template: "Mensagem controle" })],
        controlLabel: "Controle",
        controlWeight: "50",
        variantLabel: "B",
        variantWeight: "50",
        variantTemplate: " ",
      })?.variants[1]?.stepOverrides,
    ).toEqual({ text1: { template: "Mensagem controle" } });
  });
});
