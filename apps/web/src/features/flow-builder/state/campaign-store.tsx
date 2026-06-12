import type { Campaign, CampaignStatus, ChannelType } from "@nuoma/contracts";
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
  type BuilderStepType,
  type ConditionDraft,
  type StepDraft,
} from "../../../flow-builder/lib/build-steps.js";
import type { SegmentDraft } from "../../../flow-builder/lib/segment.js";
import { stepRegistry } from "../config/step-registry.js";
import { campaignStepToDraft, isoToLocalInput, newSegmentDraft, segmentToDrafts } from "./hydrate.js";

export type BuilderSelection = { kind: "flow" } | { kind: "block"; id: string };

export interface CampaignBuilderState {
  campaignId: number | null;
  name: string;
  channel: ChannelType;
  status: CampaignStatus;
  evergreen: boolean;
  startsAt: string;
  segmentEnabled: boolean;
  segmentOperator: "and" | "or";
  segments: SegmentDraft[];
  metadata: Record<string, unknown>;
  steps: StepDraft[];
  selection: BuilderSelection;
  previewOpen: boolean;
  dirty: boolean;
  /** bumped on hydrate/reorder so the canvas can re-fit the viewport */
  layoutVersion: number;
}

type MetaPatch = Partial<
  Pick<
    CampaignBuilderState,
    | "name"
    | "channel"
    | "evergreen"
    | "startsAt"
    | "segmentEnabled"
    | "segmentOperator"
    | "segments"
  >
>;

export type CampaignBuilderAction =
  | { type: "hydrate"; campaign: Campaign }
  | { type: "patchMeta"; patch: MetaPatch }
  | { type: "addStep"; stepType: BuilderStepType; index?: number }
  | { type: "updateStep"; id: string; patch: Partial<StepDraft> }
  | { type: "removeStep"; id: string }
  | { type: "duplicateStep"; id: string }
  | { type: "reorderSteps"; orderedIds: string[] }
  | { type: "addCondition"; stepId: string }
  | { type: "updateCondition"; stepId: string; conditionId: string; patch: Partial<ConditionDraft> }
  | { type: "removeCondition"; stepId: string; conditionId: string }
  | { type: "connectBranch"; sourceId: string; targetId: string }
  | { type: "select"; selection: BuilderSelection }
  | { type: "setPreviewOpen"; open: boolean }
  | { type: "markSaved"; campaignId: number; status: CampaignStatus };

export function createInitialCampaignState(): CampaignBuilderState {
  return {
    campaignId: null,
    name: "Nova campanha",
    channel: "whatsapp",
    status: "draft",
    evergreen: false,
    startsAt: "",
    segmentEnabled: false,
    segmentOperator: "and",
    segments: [newSegmentDraft()],
    metadata: { source: "flow_builder_v2" },
    steps: [stepRegistry.text.createDraft(1)],
    selection: { kind: "flow" },
    previewOpen: false,
    dirty: false,
    layoutVersion: 0,
  };
}

function withStepPatch(steps: StepDraft[], id: string, patch: Partial<StepDraft>): StepDraft[] {
  return steps.map((step) => (step.id === id ? { ...step, ...patch } : step));
}

function regenerateIds(step: StepDraft): StepDraft {
  const copy = stepRegistry[step.type].createDraft(1);
  return {
    ...step,
    id: copy.id,
    label: `${step.label} (cópia)`,
    conditions: step.conditions.map((condition) => ({
      ...condition,
      id: newConditionDraft().id,
    })),
  };
}

function campaignReducer(
  state: CampaignBuilderState,
  action: CampaignBuilderAction,
): CampaignBuilderState {
  switch (action.type) {
    case "hydrate": {
      const segment = segmentToDrafts(action.campaign.segment);
      return {
        ...createInitialCampaignState(),
        campaignId: action.campaign.id,
        name: action.campaign.name,
        channel: action.campaign.channel,
        status: action.campaign.status,
        evergreen: action.campaign.evergreen,
        startsAt: isoToLocalInput(action.campaign.startsAt),
        segmentEnabled: segment.enabled,
        segmentOperator: segment.operator,
        segments: segment.drafts,
        metadata: action.campaign.metadata,
        steps: action.campaign.steps.map(campaignStepToDraft),
        dirty: false,
        layoutVersion: state.layoutVersion + 1,
      };
    }
    case "patchMeta":
      return { ...state, ...action.patch, dirty: true };
    case "addStep": {
      const draft = stepRegistry[action.stepType].createDraft(state.steps.length + 1);
      const index = action.index ?? state.steps.length;
      const steps = [...state.steps];
      steps.splice(Math.max(0, Math.min(index, steps.length)), 0, draft);
      return {
        ...state,
        steps,
        selection: { kind: "block", id: draft.id },
        dirty: true,
        layoutVersion: state.layoutVersion + 1,
      };
    }
    case "updateStep":
      return { ...state, steps: withStepPatch(state.steps, action.id, action.patch), dirty: true };
    case "removeStep": {
      const steps = state.steps.filter((step) => step.id !== action.id);
      const selection: BuilderSelection =
        state.selection.kind === "block" && state.selection.id === action.id
          ? { kind: "flow" }
          : state.selection;
      return { ...state, steps, selection, dirty: true, layoutVersion: state.layoutVersion + 1 };
    }
    case "duplicateStep": {
      const index = state.steps.findIndex((step) => step.id === action.id);
      const source = state.steps[index];
      if (index < 0 || !source) return state;
      const copy = regenerateIds(source);
      const steps = [...state.steps];
      steps.splice(index + 1, 0, copy);
      return {
        ...state,
        steps,
        selection: { kind: "block", id: copy.id },
        dirty: true,
        layoutVersion: state.layoutVersion + 1,
      };
    }
    case "reorderSteps": {
      const byId = new Map(state.steps.map((step) => [step.id, step]));
      const steps = action.orderedIds
        .map((id) => byId.get(id))
        .filter((step): step is StepDraft => Boolean(step));
      if (steps.length !== state.steps.length) return state;
      return { ...state, steps, dirty: true, layoutVersion: state.layoutVersion + 1 };
    }
    case "addCondition":
      return {
        ...state,
        steps: state.steps.map((step) =>
          step.id === action.stepId
            ? { ...step, conditions: [...step.conditions, newConditionDraft()] }
            : step,
        ),
        dirty: true,
      };
    case "updateCondition":
      return {
        ...state,
        steps: state.steps.map((step) =>
          step.id === action.stepId
            ? {
                ...step,
                conditions: step.conditions.map((condition) =>
                  condition.id === action.conditionId
                    ? { ...condition, ...action.patch }
                    : condition,
                ),
              }
            : step,
        ),
        dirty: true,
      };
    case "removeCondition":
      return {
        ...state,
        steps: state.steps.map((step) =>
          step.id === action.stepId
            ? {
                ...step,
                conditions: step.conditions.filter(
                  (condition) => condition.id !== action.conditionId,
                ),
              }
            : step,
        ),
        dirty: true,
      };
    case "connectBranch": {
      if (action.sourceId === action.targetId) return state;
      const source = state.steps.find((step) => step.id === action.sourceId);
      const target = state.steps.find((step) => step.id === action.targetId);
      if (!source || !target) return state;
      const alreadyConnected = source.conditions.some(
        (condition) => condition.action === "branch" && condition.targetStepId === action.targetId,
      );
      if (alreadyConnected) return state;
      const branch: ConditionDraft = {
        ...newConditionDraft(),
        action: "branch",
        targetStepId: action.targetId,
      };
      return {
        ...state,
        steps: withStepPatch(state.steps, source.id, {
          conditions: [...source.conditions, branch],
        }),
        selection: { kind: "block", id: source.id },
        dirty: true,
      };
    }
    case "select":
      return { ...state, selection: action.selection };
    case "setPreviewOpen":
      return { ...state, previewOpen: action.open };
    case "markSaved":
      return { ...state, campaignId: action.campaignId, status: action.status, dirty: false };
    default:
      return state;
  }
}

interface CampaignBuilderContextValue {
  state: CampaignBuilderState;
  dispatch: Dispatch<CampaignBuilderAction>;
}

const CampaignBuilderContext = createContext<CampaignBuilderContextValue | null>(null);

export function CampaignBuilderProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(campaignReducer, undefined, createInitialCampaignState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <CampaignBuilderContext.Provider value={value}>{children}</CampaignBuilderContext.Provider>;
}

export function useCampaignBuilder(): CampaignBuilderContextValue {
  const context = useContext(CampaignBuilderContext);
  if (!context) {
    throw new Error("useCampaignBuilder requer CampaignBuilderProvider");
  }
  return context;
}
