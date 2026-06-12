import type {
  Automation,
  AutomationStatus,
  AutomationTrigger,
  ChannelType,
} from "@nuoma/contracts";
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import {
  newConditionDraft,
  type ActionDraft,
  type StepDraft,
} from "../../../flow-builder/lib/build-steps.js";
import type { SegmentDraft } from "../../../flow-builder/lib/segment.js";
import { actionRegistry, type LibraryBlockKey } from "../config/action-registry.js";
import { stepRegistry } from "../config/step-registry.js";
import { automationActionToDraft, newSegmentDraft, segmentToDrafts } from "./hydrate.js";
import type { BuilderSelection } from "./campaign-store.js";

export interface AutomationBuilderState {
  automationId: number | null;
  name: string;
  category: string;
  status: AutomationStatus;
  triggerType: AutomationTrigger["type"];
  triggerChannel: ChannelType | "";
  triggerTagId: string;
  triggerCampaignId: string;
  requireWithin24hWindow: boolean;
  segmentEnabled: boolean;
  segmentOperator: "and" | "or";
  segments: SegmentDraft[];
  metadata: Record<string, unknown>;
  actions: ActionDraft[];
  selection: BuilderSelection;
  previewOpen: boolean;
  dirty: boolean;
  layoutVersion: number;
}

type MetaPatch = Partial<
  Pick<
    AutomationBuilderState,
    | "name"
    | "category"
    | "triggerType"
    | "triggerChannel"
    | "triggerTagId"
    | "triggerCampaignId"
    | "requireWithin24hWindow"
    | "segmentEnabled"
    | "segmentOperator"
    | "segments"
  >
>;

export type AutomationBuilderAction =
  | { type: "hydrate"; automation: Automation }
  | { type: "patchMeta"; patch: MetaPatch }
  | { type: "addBlock"; block: LibraryBlockKey; index?: number }
  | { type: "updateAction"; id: string; patch: Partial<ActionDraft> }
  | { type: "updateActionStep"; id: string; patch: Partial<StepDraft> }
  | { type: "removeAction"; id: string }
  | { type: "duplicateAction"; id: string }
  | { type: "reorderActions"; orderedIds: string[] }
  | { type: "connectBranch"; sourceId: string; targetId: string }
  | { type: "select"; selection: BuilderSelection }
  | { type: "setPreviewOpen"; open: boolean }
  | { type: "markSaved"; automationId: number; status: AutomationStatus };

export function createInitialAutomationState(): AutomationBuilderState {
  return {
    automationId: null,
    name: "Nova automação",
    category: "geral",
    status: "draft",
    triggerType: "message_received",
    triggerChannel: "whatsapp",
    triggerTagId: "",
    triggerCampaignId: "",
    requireWithin24hWindow: false,
    segmentEnabled: false,
    segmentOperator: "and",
    segments: [newSegmentDraft()],
    metadata: { source: "flow_builder_v2" },
    actions: [actionRegistry.send_step.createDraft(1)],
    selection: { kind: "flow" },
    previewOpen: false,
    dirty: false,
    layoutVersion: 0,
  };
}

export function createActionFromBlock(block: LibraryBlockKey, order: number): ActionDraft {
  const [kind, type] = block.split(":") as ["step" | "action", string];
  if (kind === "step") {
    const definition = stepRegistry[type as keyof typeof stepRegistry];
    const draft = actionRegistry.send_step.createDraft(order);
    return { ...draft, step: definition.createDraft(order) };
  }
  return actionRegistry[type as keyof typeof actionRegistry].createDraft(order);
}

function automationReducer(
  state: AutomationBuilderState,
  action: AutomationBuilderAction,
): AutomationBuilderState {
  switch (action.type) {
    case "hydrate": {
      const segment = segmentToDrafts(action.automation.condition.segment);
      return {
        ...createInitialAutomationState(),
        automationId: action.automation.id,
        name: action.automation.name,
        category: action.automation.category,
        status: action.automation.status,
        triggerType: action.automation.trigger.type,
        triggerChannel: action.automation.trigger.channel ?? "",
        triggerTagId: action.automation.trigger.tagId
          ? String(action.automation.trigger.tagId)
          : "",
        triggerCampaignId: action.automation.trigger.campaignId
          ? String(action.automation.trigger.campaignId)
          : "",
        requireWithin24hWindow: action.automation.condition.requireWithin24hWindow,
        segmentEnabled: segment.enabled,
        segmentOperator: segment.operator,
        segments: segment.drafts,
        metadata: action.automation.metadata,
        actions: action.automation.actions.map((item, index) =>
          automationActionToDraft(item, index + 1),
        ),
        dirty: false,
        layoutVersion: state.layoutVersion + 1,
      };
    }
    case "patchMeta":
      return { ...state, ...action.patch, dirty: true };
    case "addBlock": {
      const draft = createActionFromBlock(action.block, state.actions.length + 1);
      const index = action.index ?? state.actions.length;
      const actions = [...state.actions];
      actions.splice(Math.max(0, Math.min(index, actions.length)), 0, draft);
      return {
        ...state,
        actions,
        selection: { kind: "block", id: draft.id },
        dirty: true,
        layoutVersion: state.layoutVersion + 1,
      };
    }
    case "updateAction":
      return {
        ...state,
        actions: state.actions.map((item) =>
          item.id === action.id ? { ...item, ...action.patch } : item,
        ),
        dirty: true,
      };
    case "updateActionStep":
      return {
        ...state,
        actions: state.actions.map((item) =>
          item.id === action.id ? { ...item, step: { ...item.step, ...action.patch } } : item,
        ),
        dirty: true,
      };
    case "removeAction": {
      const actions = state.actions.filter((item) => item.id !== action.id);
      const selection: BuilderSelection =
        state.selection.kind === "block" && state.selection.id === action.id
          ? { kind: "flow" }
          : state.selection;
      // Limpa branches que apontavam para a ação removida.
      const cleaned = actions.map((item) =>
        item.type === "branch" && item.branchTargetActionId === action.id
          ? { ...item, branchTargetActionId: "" }
          : item,
      );
      return {
        ...state,
        actions: cleaned,
        selection,
        dirty: true,
        layoutVersion: state.layoutVersion + 1,
      };
    }
    case "duplicateAction": {
      const index = state.actions.findIndex((item) => item.id === action.id);
      const source = state.actions[index];
      if (index < 0 || !source) return state;
      const fresh = actionRegistry[source.type].createDraft(state.actions.length + 1);
      const copy: ActionDraft = {
        ...source,
        id: fresh.id,
        step: {
          ...source.step,
          id: fresh.step.id,
          conditions: source.step.conditions.map((condition) => ({
            ...condition,
            id: newConditionDraft().id,
          })),
        },
      };
      const actions = [...state.actions];
      actions.splice(index + 1, 0, copy);
      return {
        ...state,
        actions,
        selection: { kind: "block", id: copy.id },
        dirty: true,
        layoutVersion: state.layoutVersion + 1,
      };
    }
    case "reorderActions": {
      const byId = new Map(state.actions.map((item) => [item.id, item]));
      const actions = action.orderedIds
        .map((id) => byId.get(id))
        .filter((item): item is ActionDraft => Boolean(item));
      if (actions.length !== state.actions.length) return state;
      return { ...state, actions, dirty: true, layoutVersion: state.layoutVersion + 1 };
    }
    case "connectBranch": {
      if (action.sourceId === action.targetId) return state;
      const source = state.actions.find((item) => item.id === action.sourceId);
      const target = state.actions.find((item) => item.id === action.targetId);
      if (!source || !target || source.type !== "branch") return state;
      return {
        ...state,
        actions: state.actions.map((item) =>
          item.id === source.id ? { ...item, branchTargetActionId: target.id } : item,
        ),
        selection: { kind: "block", id: source.id },
        dirty: true,
      };
    }
    case "select":
      return { ...state, selection: action.selection };
    case "setPreviewOpen":
      return { ...state, previewOpen: action.open };
    case "markSaved":
      return { ...state, automationId: action.automationId, status: action.status, dirty: false };
    default:
      return state;
  }
}

interface AutomationBuilderContextValue {
  state: AutomationBuilderState;
  dispatch: Dispatch<AutomationBuilderAction>;
}

const AutomationBuilderContext = createContext<AutomationBuilderContextValue | null>(null);

export function AutomationBuilderProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(automationReducer, undefined, createInitialAutomationState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <AutomationBuilderContext.Provider value={value}>{children}</AutomationBuilderContext.Provider>
  );
}

export function useAutomationBuilder(): AutomationBuilderContextValue {
  const context = useContext(AutomationBuilderContext);
  if (!context) {
    throw new Error("useAutomationBuilder requer AutomationBuilderProvider");
  }
  return context;
}
