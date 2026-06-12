import { describe, expect, it } from "vitest";

import { newConditionDraft } from "../../../flow-builder/lib/build-steps.js";
import { createActionFromBlock } from "../state/automation-store.js";
import { stepRegistry } from "../config/step-registry.js";
import { simulateAutomation, simulateCampaign } from "./simulate.js";

describe("simulateCampaign", () => {
  it("renders text steps as bubbles with delay chips and condition events", () => {
    const step = stepRegistry.text.createDraft(1);
    step.template = "Olá {{nome}}!";
    step.delaySeconds = "90";
    step.conditions = [{ ...newConditionDraft(), type: "replied", action: "exit" }];

    const events = simulateCampaign([step]);

    expect(events[0]).toEqual({ kind: "delay", label: "aguarda 1min 30s" });
    expect(events[1]?.kind).toBe("event");
    expect(events.at(-1)).toEqual({
      kind: "bubble",
      stepType: "text",
      lines: ["Olá {{nome}}!"],
    });
  });

  it("renders temporary_messages as a system event, not a bubble", () => {
    const step = stepRegistry.temporary_messages.createDraft(1);
    const events = simulateCampaign([step]);
    expect(events.every((event) => event.kind !== "bubble" || event.stepType !== "text")).toBe(
      true,
    );
    expect(events.some((event) => event.kind === "event")).toBe(true);
  });
});

describe("simulateAutomation", () => {
  it("maps every action type to a renderable event", () => {
    const actions = [
      createActionFromBlock("step:text", 1),
      createActionFromBlock("action:delay", 2),
      createActionFromBlock("action:branch", 3),
      createActionFromBlock("action:apply_tag", 4),
      createActionFromBlock("action:remove_tag", 5),
      createActionFromBlock("action:set_status", 6),
      createActionFromBlock("action:create_reminder", 7),
      createActionFromBlock("action:notify_attendant", 8),
      createActionFromBlock("action:trigger_automation", 9),
    ];
    const events = simulateAutomation(actions);
    expect(events.length).toBeGreaterThanOrEqual(actions.length);
    expect(events.some((event) => event.kind === "bubble")).toBe(true);
    expect(events.some((event) => event.kind === "delay")).toBe(true);
    expect(events.filter((event) => event.kind === "event").length).toBeGreaterThanOrEqual(6);
  });
});
