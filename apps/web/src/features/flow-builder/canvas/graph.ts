import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { Flag, Play, type LucideIcon } from "lucide-react";

import {
  buildActions,
  type ActionDraft,
  type StepDraft,
} from "../../../flow-builder/lib/build-steps.js";
import { conditionTypes } from "../../../flow-builder/lib/builder-options.js";
import {
  conditionFieldErrors,
  instagramSupportedStepTypes,
  stepDraftFieldErrors,
} from "../../../flow-builder/lib/validation.js";
import { actionRegistry, triggerIcon, triggerLabel } from "../config/action-registry.js";
import { humanizeSeconds, stepRegistry, type NodeTone } from "../config/step-registry.js";
import type { AutomationBuilderState } from "../state/automation-store.js";
import type { CampaignBuilderState } from "../state/campaign-store.js";

export type BuilderNodeKind = "entry" | "block" | "end";

/**
 * Node payload rendered by FlowNodeCard. Must stay a type alias (not an
 * interface) so it satisfies xyflow's Record<string, unknown> constraint.
 */
export type BuilderNodeData = {
  kind: BuilderNodeKind;
  refId: string | null;
  order: number | null;
  kicker: string | null;
  title: string;
  typeLabel: string;
  summary: string;
  icon: LucideIcon;
  tone: NodeTone;
  badges: string[];
  errors: string[];
  branchSource: boolean;
};

export type BuilderNode = Node<BuilderNodeData, "builder">;

export interface BuilderGraph {
  nodes: BuilderNode[];
  edges: Edge[];
  errorsById: Map<string, string[]>;
}

const SEQUENCE_EDGE_BASE = {
  type: "sequence" as const,
  style: { stroke: "var(--nw-flow-edge)", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--nw-flow-edge)", width: 16, height: 16 },
};

function annotatedEdge(
  id: string,
  source: string,
  target: string,
  label: string,
  color: string,
): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: "branch",
    targetHandle: "branch-in",
    type: "smoothstep",
    label,
    style: { stroke: color, strokeWidth: 1.5, strokeDasharray: "6 4" },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    labelStyle: { fill: color, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em" },
    labelBgStyle: { fill: "rgb(var(--nw-surface-1))", fillOpacity: 0.92 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 5,
  };
}

function conditionTypeLabel(type: string): string {
  return conditionTypes.find((option) => option.value === type)?.label ?? type;
}

function node(partial: Omit<BuilderNode, "position" | "type">): BuilderNode {
  return {
    ...partial,
    type: "builder",
    position: { x: 0, y: 0 },
    draggable: partial.data.kind === "block",
    connectable: true,
  };
}

/* ------------------------------------------------------------------------- */
/* Campaign                                                                   */
/* ------------------------------------------------------------------------- */

function campaignStepErrors(
  step: StepDraft,
  order: number,
  channel: CampaignBuilderState["channel"],
): string[] {
  const errors = Object.values(stepDraftFieldErrors(step, order)).filter(Boolean) as string[];
  step.conditions.forEach((condition, index) => {
    errors.push(
      ...(Object.values(conditionFieldErrors(condition, order, index + 1)).filter(
        Boolean,
      ) as string[]),
    );
  });
  if (channel === "instagram" && !instagramSupportedStepTypes.has(step.type)) {
    errors.push("Tipo de bloco sem suporte no Instagram.");
  }
  return errors;
}

function campaignStepBadges(step: StepDraft): string[] {
  const badges: string[] = [];
  const delay = Number.parseInt(step.delaySeconds || "0", 10) || 0;
  if (delay > 0) badges.push(`aguarda ${humanizeSeconds(delay)}`);
  if (step.conditions.length > 0) {
    badges.push(
      step.conditions.length === 1 ? "1 condição" : `${step.conditions.length} condições`,
    );
  }
  return badges;
}

export function buildCampaignGraph(state: CampaignBuilderState): BuilderGraph {
  const errorsById = new Map<string, string[]>();
  const nodes: BuilderNode[] = [];
  const edges: Edge[] = [];

  const audience = state.segmentEnabled
    ? `Segmento ativo · ${state.segments.length} regra(s)`
    : "Todos os contatos elegíveis do canal";
  const scheduleBadge = state.evergreen
    ? "Evergreen"
    : state.startsAt
      ? "Agendada"
      : "Disparo manual";

  nodes.push(
    node({
      id: "entry",
      data: {
        kind: "entry",
        refId: null,
        order: null,
        kicker: "Início",
        title: "Entrada da campanha",
        typeLabel: "Público e canal",
        summary: audience,
        icon: Play,
        tone: state.channel === "instagram" ? "ig" : "wa",
        badges: [state.channel === "instagram" ? "Instagram" : "WhatsApp", scheduleBadge],
        errors: state.name.trim() ? [] : ["Dê um nome à campanha."],
        branchSource: false,
      },
    }),
  );

  state.steps.forEach((step, index) => {
    const order = index + 1;
    const definition = stepRegistry[step.type];
    const errors = campaignStepErrors(step, order, state.channel);
    errorsById.set(step.id, errors);
    nodes.push(
      node({
        id: step.id,
        data: {
          kind: "block",
          refId: step.id,
          order,
          kicker: null,
          title: step.label.trim() || `Step ${order}`,
          typeLabel: definition.label,
          summary: definition.summarize(step),
          icon: definition.icon,
          tone: definition.tone,
          badges: campaignStepBadges(step),
          errors,
          branchSource: true,
        },
      }),
    );
  });

  nodes.push(
    node({
      id: "end",
      data: {
        kind: "end",
        refId: null,
        order: null,
        kicker: "Fim",
        title: "Fim do fluxo",
        typeLabel: "",
        summary: "",
        icon: Flag,
        tone: "neutral",
        badges: [],
        errors: [],
        branchSource: false,
      },
    }),
  );

  const sequenceTargets = [...state.steps.map((step) => step.id), "end"];
  let previous = "entry";
  sequenceTargets.forEach((target, index) => {
    edges.push({
      ...SEQUENCE_EDGE_BASE,
      id: `seq-${previous}-${target}`,
      source: previous,
      target,
      data: { insertIndex: index },
    });
    previous = target;
  });

  const stepIds = new Set(state.steps.map((step) => step.id));
  state.steps.forEach((step) => {
    step.conditions.forEach((condition, index) => {
      const label = conditionTypeLabel(condition.type);
      if (condition.action === "branch" && condition.targetStepId && stepIds.has(condition.targetStepId)) {
        edges.push(
          annotatedEdge(
            `branch-${step.id}-${index}`,
            step.id,
            condition.targetStepId,
            label,
            "var(--nw-flow-branch)",
          ),
        );
      }
      if (condition.action === "exit") {
        edges.push(
          annotatedEdge(`exit-${step.id}-${index}`, step.id, "end", label, "var(--nw-flow-exit)"),
        );
      }
    });
  });

  return { nodes, edges, errorsById };
}

/* ------------------------------------------------------------------------- */
/* Automation                                                                 */
/* ------------------------------------------------------------------------- */

function automationActionErrors(
  action: ActionDraft,
  order: number,
  triggerChannel: AutomationBuilderState["triggerChannel"],
): string[] {
  const errors: string[] = [];
  const built = buildActions([action]);
  if (typeof built === "string") {
    errors.push(built.replace(/^(Ação|Step) 1/, `$1 ${order}`));
  }
  if (
    action.type === "send_step" &&
    triggerChannel === "instagram" &&
    !instagramSupportedStepTypes.has(action.step.type)
  ) {
    errors.push("Tipo de mensagem sem suporte no Instagram.");
  }
  return errors;
}

function automationActionBadges(action: ActionDraft): string[] {
  const badges: string[] = [];
  if (action.type === "send_step") {
    const delay = Number.parseInt(action.step.delaySeconds || "0", 10) || 0;
    if (delay > 0) badges.push(`aguarda ${humanizeSeconds(delay)}`);
  }
  if (action.type === "branch" && !action.branchTargetActionId) {
    badges.push("sem destino");
  }
  return badges;
}

export function buildAutomationGraph(state: AutomationBuilderState): BuilderGraph {
  const errorsById = new Map<string, string[]>();
  const nodes: BuilderNode[] = [];
  const edges: Edge[] = [];

  const gates: string[] = [];
  if (state.segmentEnabled) gates.push(`${state.segments.length} regra(s) de segmento`);
  if (state.requireWithin24hWindow) gates.push("janela 24h");
  const channelBadge =
    state.triggerChannel === "instagram"
      ? "Instagram"
      : state.triggerChannel === "whatsapp"
        ? "WhatsApp"
        : "Qualquer canal";

  nodes.push(
    node({
      id: "entry",
      data: {
        kind: "entry",
        refId: null,
        order: null,
        kicker: "Gatilho",
        title: triggerLabel(state.triggerType),
        typeLabel: "Entrada da automação",
        summary: gates.length > 0 ? `Condições: ${gates.join(" · ")}` : "Sem condições de entrada",
        icon: triggerIcon[state.triggerType],
        tone: state.triggerChannel === "instagram" ? "ig" : "wa",
        badges: [channelBadge],
        errors: state.name.trim() ? [] : ["Dê um nome à automação."],
        branchSource: false,
      },
    }),
  );

  state.actions.forEach((action, index) => {
    const order = index + 1;
    const definition = actionRegistry[action.type];
    const stepDefinition = action.type === "send_step" ? stepRegistry[action.step.type] : null;
    const errors = automationActionErrors(action, order, state.triggerChannel);
    errorsById.set(action.id, errors);
    nodes.push(
      node({
        id: action.id,
        data: {
          kind: "block",
          refId: action.id,
          order,
          kicker: null,
          title:
            action.type === "send_step"
              ? action.step.label.trim() || stepDefinition?.label || definition.label
              : definition.label,
          typeLabel: stepDefinition ? stepDefinition.label : definition.label,
          summary: definition.summarize(action),
          icon: stepDefinition ? stepDefinition.icon : definition.icon,
          tone: stepDefinition ? stepDefinition.tone : definition.tone,
          badges: automationActionBadges(action),
          errors,
          branchSource: action.type === "branch",
        },
      }),
    );
  });

  nodes.push(
    node({
      id: "end",
      data: {
        kind: "end",
        refId: null,
        order: null,
        kicker: "Fim",
        title: "Fim do fluxo",
        typeLabel: "",
        summary: "",
        icon: Flag,
        tone: "neutral",
        badges: [],
        errors: [],
        branchSource: false,
      },
    }),
  );

  const sequenceTargets = [...state.actions.map((action) => action.id), "end"];
  let previous = "entry";
  sequenceTargets.forEach((target, index) => {
    edges.push({
      ...SEQUENCE_EDGE_BASE,
      id: `seq-${previous}-${target}`,
      source: previous,
      target,
      data: { insertIndex: index },
    });
    previous = target;
  });

  const actionIds = new Set(state.actions.map((action) => action.id));
  state.actions.forEach((action) => {
    if (
      action.type === "branch" &&
      action.branchTargetActionId &&
      actionIds.has(action.branchTargetActionId)
    ) {
      edges.push(
        annotatedEdge(
          `branch-${action.id}`,
          action.id,
          action.branchTargetActionId,
          action.branchLabel.trim() || "branch",
          "var(--nw-flow-branch)",
        ),
      );
    }
  });

  return { nodes, edges, errorsById };
}
