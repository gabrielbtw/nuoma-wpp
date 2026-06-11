import { describe, expect, it } from "vitest";

import {
  buildStep,
  buildStepConditions,
  buildSteps,
  sanitizeStepId,
  type StepDraft,
} from "./build-steps.js";

function stepDraft(overrides: Partial<StepDraft> = {}): StepDraft {
  return {
    id: "step-1",
    label: "Step 1",
    type: "text",
    delaySeconds: "0",
    template: "Olá {{nome}}",
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

describe("buildStep", () => {
  it("builds one payload for each campaign step type", () => {
    expect(buildStep(stepDraft({ type: "text", template: "  Oi  " }), 1)).toMatchObject({
      type: "text",
      template: "Oi",
    });
    expect(buildStep(stepDraft({ type: "link", linkText: " Abrir ", url: " https://x.test " }), 1))
      .toMatchObject({
        type: "link",
        text: "Abrir",
        url: "https://x.test",
        previewEnabled: true,
      });
    expect(
      buildStep(stepDraft({ type: "temporary_messages", temporaryMessagesDuration: "7d" }), 1),
    ).toMatchObject({ type: "temporary_messages", duration: "7d" });
    expect(buildStep(stepDraft({ type: "voice", caption: " audio " }), 1)).toMatchObject({
      type: "voice",
      mediaAssetId: 10,
      caption: "audio",
    });
    expect(buildStep(stepDraft({ type: "image" }), 1)).toMatchObject({
      type: "image",
      mediaAssetId: 10,
      caption: null,
    });
    expect(buildStep(stepDraft({ type: "video" }), 1)).toMatchObject({
      type: "video",
      mediaAssetId: 10,
      caption: null,
    });
    expect(buildStep(stepDraft({ type: "document", fileName: " proposta.pdf " }), 1)).toMatchObject(
      {
        type: "document",
        mediaAssetId: 10,
        fileName: "proposta.pdf",
        caption: null,
      },
    );
  });

  it("sanitizes step ids and falls back when every character is removed", () => {
    expect(sanitizeStepId("step 1!*_ok-é", 1)).toBe("step1_ok-");
    expect(buildStep(stepDraft({ id: "!!!" }), 2)).toMatchObject({ id: "step-2" });
  });

  it("builds conditions and keeps branch target ids byte-identical after trim", () => {
    const result = buildStepConditions(
      stepDraft({
        conditions: [
          { id: "c1", type: "has_tag", action: "branch", value: " vip ", targetStepId: " step 2!* " },
          { id: "c2", type: "replied", action: "exit", value: "", targetStepId: "ignored" },
        ],
      }),
      1,
    );

    // Comportamento movido: o id do step e sanitizado, mas targetStepId so recebe trim.
    expect(result).toEqual([
      { type: "has_tag", action: "branch", value: "vip", targetStepId: "step 2!*" },
      { type: "replied", action: "exit", value: null, targetStepId: null },
    ]);
  });

  it("stops buildSteps at the first invalid step message", () => {
    expect(buildSteps([stepDraft(), stepDraft({ template: "" })])).toBe("Step 2: mensagem vazia.");
    expect(buildStep(stepDraft({ type: "document", fileName: "" }), 1)).toBe(
      "Step 1: documento precisa de nome de arquivo.",
    );
  });
});
