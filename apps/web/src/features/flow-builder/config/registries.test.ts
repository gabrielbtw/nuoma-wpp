import { automationActionSchema, campaignStepSchema } from "@nuoma/contracts";
import { describe, expect, it } from "vitest";

import { buildActions, buildStep } from "../../../flow-builder/lib/build-steps.js";
import {
  actionRegistry,
  automationLibraryBlocks,
  campaignLibraryBlocks,
} from "./action-registry.js";
import { stepRegistry } from "./step-registry.js";

const contractStepTypes = campaignStepSchema.options.map((option) => option.shape.type.value);
const contractActionTypes = automationActionSchema.options.map((option) => option.shape.type.value);

describe("step registry", () => {
  it("covers every campaign step type defined in the contract", () => {
    expect(new Set(Object.keys(stepRegistry))).toEqual(new Set(contractStepTypes));
  });

  it("creates drafts that build into valid contract steps after minimal fill", () => {
    for (const definition of Object.values(stepRegistry)) {
      const draft = definition.createDraft(1);
      if (
        !draft.mediaAssetId &&
        draft.type !== "text" &&
        draft.type !== "link" &&
        draft.type !== "temporary_messages"
      ) {
        draft.mediaAssetId = "1";
      }
      const built = buildStep(draft, 1);
      expect(typeof built, `${definition.type} draft should build`).not.toBe("string");
      if (typeof built !== "string") {
        expect(built.type).toBe(definition.type);
      }
    }
  });

  it("summarizes drafts without throwing", () => {
    for (const definition of Object.values(stepRegistry)) {
      expect(definition.summarize(definition.createDraft(1))).toBeTypeOf("string");
    }
  });
});

describe("action registry", () => {
  it("covers every automation action type defined in the contract", () => {
    expect(new Set(Object.keys(actionRegistry))).toEqual(new Set(contractActionTypes));
  });

  it("creates drafts that build into valid contract actions after minimal fill", () => {
    for (const definition of Object.values(actionRegistry)) {
      const draft = definition.createDraft(1);
      draft.tagId = draft.tagId || "1";
      draft.triggerAutomationId = draft.triggerAutomationId || "1";
      draft.dueAt = draft.dueAt || "2026-01-01T10:00";
      const built = buildActions([draft]);
      expect(typeof built, `${definition.type} draft should build`).not.toBe("string");
      if (typeof built !== "string") {
        expect(built[0]?.type).toBe(definition.type);
      }
    }
  });
});

describe("block library", () => {
  it("exposes all step types for campaigns", () => {
    expect(
      campaignLibraryBlocks()
        .map((block) => block.key)
        .sort(),
    ).toEqual(contractStepTypes.map((type) => `step:${type}`).sort());
  });

  it("exposes messages plus non-send actions for automations", () => {
    const keys = new Set(automationLibraryBlocks().map((block) => block.key));
    expect(keys.has("step:text")).toBe(true);
    expect(keys.has("action:delay")).toBe(true);
    expect(keys.has("action:send_step")).toBe(false);
    expect(keys.size).toBe(contractStepTypes.length + contractActionTypes.length - 1);
  });
});
