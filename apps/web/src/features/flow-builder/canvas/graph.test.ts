import { describe, expect, it } from "vitest";

import { newConditionDraft } from "../../../flow-builder/lib/build-steps.js";
import { stepRegistry } from "../config/step-registry.js";
import {
  createInitialAutomationState,
  createActionFromBlock,
} from "../state/automation-store.js";
import { createInitialCampaignState } from "../state/campaign-store.js";
import { buildAutomationGraph, buildCampaignGraph } from "./graph.js";
import { insertIndexForY, layoutVertical } from "./layout.js";

describe("buildCampaignGraph", () => {
  it("projects entry, blocks and end on a sequence", () => {
    const state = createInitialCampaignState();
    state.steps = [stepRegistry.text.createDraft(1), stepRegistry.image.createDraft(2)];
    const graph = buildCampaignGraph(state);

    expect(graph.nodes.map((node) => node.data.kind)).toEqual(["entry", "block", "block", "end"]);
    const sequence = graph.edges.filter((edge) => edge.type === "sequence");
    expect(sequence).toHaveLength(3);
    expect(sequence.map((edge) => edge.data?.insertIndex)).toEqual([0, 1, 2]);
  });

  it("emits branch and exit edges from step conditions", () => {
    const state = createInitialCampaignState();
    const first = stepRegistry.text.createDraft(1);
    const second = stepRegistry.text.createDraft(2);
    first.conditions = [
      { ...newConditionDraft(), action: "branch", targetStepId: second.id },
      { ...newConditionDraft(), action: "exit" },
    ];
    state.steps = [first, second];
    const graph = buildCampaignGraph(state);

    const branch = graph.edges.find((edge) => edge.id.startsWith("branch-"));
    const exit = graph.edges.find((edge) => edge.id.startsWith("exit-"));
    expect(branch?.target).toBe(second.id);
    expect(exit?.target).toBe("end");
  });

  it("flags media steps without asset as errors", () => {
    const state = createInitialCampaignState();
    state.steps = [stepRegistry.image.createDraft(1)];
    const graph = buildCampaignGraph(state);
    expect(graph.errorsById.get(state.steps[0]!.id)?.length).toBeGreaterThan(0);
  });
});

describe("buildAutomationGraph", () => {
  it("marks instagram-unsupported send steps", () => {
    const state = createInitialAutomationState();
    state.triggerChannel = "instagram";
    state.actions = [createActionFromBlock("step:voice", 1)];
    const graph = buildAutomationGraph(state);
    const errors = graph.errorsById.get(state.actions[0]!.id) ?? [];
    expect(errors.some((error) => error.includes("Instagram"))).toBe(true);
  });

  it("links branch actions to their targets", () => {
    const state = createInitialAutomationState();
    const branch = createActionFromBlock("action:branch", 1);
    const target = createActionFromBlock("step:text", 2);
    branch.branchTargetActionId = target.id;
    state.actions = [branch, target];
    const graph = buildAutomationGraph(state);
    expect(graph.edges.some((edge) => edge.id === `branch-${branch.id}`)).toBe(true);
  });
});

describe("layoutVertical", () => {
  it("stacks nodes top-down without overlap", () => {
    const state = createInitialCampaignState();
    state.steps = Array.from({ length: 6 }, (_, index) => stepRegistry.text.createDraft(index + 1));
    const nodes = layoutVertical(buildCampaignGraph(state).nodes);
    for (let index = 1; index < nodes.length; index += 1) {
      expect(nodes[index]!.position.y).toBeGreaterThan(nodes[index - 1]!.position.y + 40);
    }
  });

  it("maps a drop y to a stable insert index", () => {
    const state = createInitialCampaignState();
    state.steps = [stepRegistry.text.createDraft(1), stepRegistry.text.createDraft(2)];
    const nodes = layoutVertical(buildCampaignGraph(state).nodes);
    const blocks = nodes.filter((node) => node.data.kind === "block");
    expect(insertIndexForY(blocks, blocks[0]!.position.y - 10)).toBe(0);
    expect(insertIndexForY(blocks, blocks[1]!.position.y + 200)).toBe(2);
  });
});
