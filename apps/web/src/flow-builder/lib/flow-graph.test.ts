import { describe, expect, it } from "vitest";

import type { ActionDraft, StepDraft } from "./build-steps.js";
import { buildAutomationFlowGraph, buildCampaignFlowGraph } from "./flow-graph.js";

function stepDraft(overrides: Partial<StepDraft> = {}): StepDraft {
  return {
    id: "step-1",
    label: "Step 1",
    type: "text",
    delaySeconds: "0",
    template: "Oi",
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

function actionDraft(overrides: Partial<ActionDraft> = {}): ActionDraft {
  return {
    id: "action-1",
    type: "send_step",
    step: stepDraft(),
    delayActionSeconds: "300",
    delayLabel: "Aguardar",
    branchLabel: "Branch",
    branchTargetActionId: "",
    branchConditionField: "status",
    branchConditionOperator: "eq",
    branchConditionValue: "novo",
    tagId: "",
    status: "novo",
    reminderTitle: "Retornar contato",
    dueAt: "",
    notifyAttendantId: "",
    notifyMessage: "Lead precisa de atendimento humano.",
    triggerAutomationId: "",
    ...overrides,
  };
}

describe("flow graph builders", () => {
  it("builds campaign nodes with sequential, branch and exit edges", () => {
    const onOpenSteps = () => undefined;
    const graph = buildCampaignFlowGraph({
      steps: [
        stepDraft({
          id: "step-1",
          conditions: [
            { id: "c1", type: "has_tag", action: "branch", value: "vip", targetStepId: "step-2" },
            { id: "c2", type: "replied", action: "exit", value: "", targetStepId: "" },
          ],
        }),
        stepDraft({ id: "step-2", label: "Step 2", type: "link" }),
      ],
      channel: "whatsapp",
      evergreen: false,
      csvPreview: null,
      segmentEnabled: true,
      abEnabled: true,
      onOpenSteps,
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["start", "step-1", "step-2", "end"]);
    expect(graph.nodes.find((node) => node.id === "step-1")?.data).toMatchObject({
      iconType: "branch",
      kind: "branch",
      conditionCount: 2,
      onOpenSteps,
    });
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      "start-to-first",
      "step-1-next",
      "step-1-branch-0",
      "step-1-exit-1",
      "step-2-next",
    ]);
    expect(graph.edges.find((edge) => edge.id === "step-1-branch-0")).toMatchObject({
      source: "step-1",
      target: "step-2",
      label: "Tem tag: vip",
    });
    expect(graph.edges.find((edge) => edge.id === "step-1-exit-1")).toMatchObject({
      source: "step-1",
      target: "end",
      label: "Respondeu",
    });
  });

  it("builds automation gate, action and branch edges from drafts", () => {
    const graph = buildAutomationFlowGraph({
      triggerType: "message_received",
      triggerChannel: "instagram",
      requireWithin24hWindow: true,
      segmentEnabled: true,
      segmentCount: 2,
      actions: [
        actionDraft({
          id: "action-1",
          type: "branch",
          branchLabel: "VIP",
          branchTargetActionId: "action-2",
        }),
        actionDraft({ id: "action-2", type: "delay", delayActionSeconds: "60" }),
      ],
      previewActions: [],
      previewError: "Revise a acao",
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "automation-trigger",
      "automation-condition",
      "action-1",
      "action-2",
      "automation-preview-error",
      "automation-end",
    ]);
    expect(graph.nodes.find((node) => node.id === "automation-trigger")?.data).toMatchObject({
      iconType: "instagram",
      tone: "ig",
    });
    expect(graph.nodes.find((node) => node.id === "automation-condition")?.data.summary).toBe(
      "2 regra(s) de segmento · janela 24h exigida",
    );
    expect(graph.edges.map((edge) => edge.id)).toContain("action-1-branch");
    expect(graph.edges.find((edge) => edge.id === "action-1-branch")).toMatchObject({
      source: "action-1",
      target: "action-2",
      label: "VIP",
    });
    expect(graph.edges.find((edge) => edge.id === "preview-error-to-end")).toMatchObject({
      source: "automation-preview-error",
      target: "automation-end",
      label: "corrigir",
    });
  });
});
