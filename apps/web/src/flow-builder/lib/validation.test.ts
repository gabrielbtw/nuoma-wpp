import { describe, expect, it } from "vitest";

import { buildStep, type StepDraft } from "./build-steps.js";
import {
  conditionFieldErrors,
  instagramSupportedStepTypes,
  readyChecks,
  stepDraftFieldErrors,
  unsupportedInstagramStepLabels,
} from "./validation.js";

function stepDraft(overrides: Partial<StepDraft> = {}): StepDraft {
  return {
    id: "step-1",
    label: "Step 1",
    type: "text",
    delaySeconds: "0",
    template: "Olá",
    url: "https://nuoma.com.br",
    linkText: "Ver detalhes",
    previewEnabled: true,
    mediaAssetId: "10",
    fileName: "documento.pdf",
    caption: "",
    temporaryMessagesDuration: "24h",
    conditions: [],
    ...overrides,
  };
}

describe("validation helpers", () => {
  it("returns field errors by step type", () => {
    expect(stepDraftFieldErrors(stepDraft({ template: "" }), 1)).toEqual({
      template: "Step 1: mensagem vazia.",
    });
    expect(stepDraftFieldErrors(stepDraft({ type: "link", url: "", linkText: "" }), 2)).toEqual({
      url: "Step 2: informe a URL.",
      linkText: "Step 2: informe o texto do link.",
    });
    expect(stepDraftFieldErrors(stepDraft({ type: "image", mediaAssetId: "0" }), 3)).toEqual({
      mediaAssetId: "Step 3: informe um Media Asset ID válido.",
    });
    expect(stepDraftFieldErrors(stepDraft({ type: "document", fileName: "" }), 4)).toEqual({
      fileName: "Step 4: documento precisa de nome de arquivo.",
    });
    expect(stepDraftFieldErrors(stepDraft({ type: "temporary_messages" }), 5)).toEqual({});
  });

  it("returns condition errors for required value and branch target", () => {
    expect(
      conditionFieldErrors(
        { id: "c1", type: "has_tag", action: "branch", value: "", targetStepId: "" },
        2,
        3,
      ),
    ).toEqual({
      value: "Step 2, condição 3: informe o valor.",
      targetStepId: "Step 2, condição 3: branch precisa de destino.",
    });
    expect(
      conditionFieldErrors(
        { id: "c2", type: "channel_is", action: "wait", value: "", targetStepId: "" },
        1,
        1,
      ),
    ).toEqual({ value: "Step 1, condição 1: informe o valor." });
  });

  it("keeps the Instagram support gate at text, link, image and video", () => {
    expect([...instagramSupportedStepTypes].sort()).toEqual(["image", "link", "text", "video"]);
    // Comportamento movido: o fallback usa o indice da lista filtrada, nao o indice original.
    expect(
      unsupportedInstagramStepLabels([
        stepDraft({ label: "Texto", type: "text" }),
        stepDraft({ label: "Audio", type: "voice" }),
        stepDraft({ label: "", type: "document" }),
      ]),
    ).toEqual(["Audio", "Step 2"]);
  });

  it("builds ready checks with the existing CSV, channel and A/B gates", () => {
    const step = buildStep(stepDraft(), 1);
    if (typeof step === "string") throw new Error(step);

    expect(
      readyChecks({
        name: "Campanha",
        previewSteps: [step],
        stepBuildError: null,
        channel: "instagram",
        steps: [stepDraft({ type: "voice", label: "Audio" })],
        csvPreview: {
          headers: ["telefone"],
          phoneHeader: "telefone",
          rows: [],
          totalRows: 1,
          validCount: 0,
          invalidCount: 1,
          duplicateCount: 0,
          errors: ["Linha 2: telefone inválido"],
        },
        abEnabled: true,
        abTargetStep: null,
      }),
    ).toEqual([
      { label: "Nome", ok: true },
      { label: "Blocos", ok: true },
      { label: "Canal", ok: false },
      { label: "Público", ok: false },
      { label: "CSV", ok: false },
      { label: "A/B", ok: false },
    ]);
  });
});
