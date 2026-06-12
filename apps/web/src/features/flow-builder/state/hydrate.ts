import type { AutomationAction, CampaignStep, Segment } from "@nuoma/contracts";

import {
  newActionDraft,
  newConditionDraft,
  newStepDraft,
  type ActionDraft,
  type ConditionDraft,
  type StepDraft,
} from "../../../flow-builder/lib/build-steps.js";
import type { SegmentDraft } from "../../../flow-builder/lib/segment.js";

let segmentDraftCounter = 0;

export function newSegmentDraft(): SegmentDraft {
  segmentDraftCounter += 1;
  return {
    id: `segment-${Date.now()}-${segmentDraftCounter}`,
    field: "tag",
    operator: "eq",
    value: "",
  };
}

function conditionToDraft(condition: CampaignStep["conditions"][number]): ConditionDraft {
  return {
    ...newConditionDraft(),
    type: condition.type,
    action: condition.action,
    value: condition.value ?? "",
    targetStepId: condition.targetStepId ?? "",
  };
}

export function campaignStepToDraft(step: CampaignStep): StepDraft {
  const draft: StepDraft = {
    ...newStepDraft(1),
    id: step.id,
    label: step.label,
    type: step.type,
    delaySeconds: String(step.delaySeconds),
    conditions: step.conditions.map(conditionToDraft),
  };
  switch (step.type) {
    case "text":
      draft.template = step.template;
      break;
    case "link":
      draft.url = step.url;
      draft.linkText = step.text;
      draft.previewEnabled = step.previewEnabled;
      break;
    case "temporary_messages":
      draft.temporaryMessagesDuration = step.duration;
      break;
    case "document":
      draft.mediaAssetId = String(step.mediaAssetId);
      draft.fileName = step.fileName;
      draft.caption = step.caption ?? "";
      break;
    default:
      draft.mediaAssetId = String(step.mediaAssetId);
      draft.caption = step.caption ?? "";
      break;
  }
  return draft;
}

export function automationActionToDraft(action: AutomationAction, order: number): ActionDraft {
  const draft: ActionDraft = {
    ...newActionDraft(order),
    id: action.id ?? `action-${Date.now()}-${order}`,
    type: action.type,
  };
  switch (action.type) {
    case "send_step":
      draft.step = campaignStepToDraft(action.step);
      break;
    case "delay":
      draft.delayActionSeconds = String(action.seconds);
      draft.delayLabel = action.label ?? "";
      break;
    case "branch": {
      draft.branchLabel = action.label;
      draft.branchTargetActionId = action.targetActionId ?? "";
      const condition = action.condition?.conditions[0];
      if (condition) {
        draft.branchConditionField = condition.field;
        draft.branchConditionOperator = condition.operator;
        draft.branchConditionValue = segmentValueToDraft(condition.value);
      }
      break;
    }
    case "apply_tag":
    case "remove_tag":
      draft.tagId = String(action.tagId);
      break;
    case "set_status":
      draft.status = action.status;
      break;
    case "create_reminder":
      draft.reminderTitle = action.title;
      draft.dueAt = isoToLocalInput(action.dueAt);
      break;
    case "notify_attendant":
      draft.notifyAttendantId = action.attendantId ? String(action.attendantId) : "";
      draft.notifyMessage = action.message;
      break;
    case "trigger_automation":
      draft.triggerAutomationId = String(action.automationId);
      break;
  }
  return draft;
}

export function segmentToDrafts(segment: Segment | null | undefined): {
  enabled: boolean;
  operator: "and" | "or";
  drafts: SegmentDraft[];
} {
  if (!segment || segment.conditions.length === 0) {
    return { enabled: false, operator: "and", drafts: [newSegmentDraft()] };
  }
  return {
    enabled: true,
    operator: segment.operator,
    drafts: segment.conditions.map((condition) => ({
      ...newSegmentDraft(),
      field: condition.field,
      operator: condition.operator,
      value: segmentValueToDraft(condition.value),
    })),
  };
}

function segmentValueToDraft(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

/** ISO datetime → value for <input type="datetime-local"> in the local timezone. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO datetime with offset, or null. */
export function localInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
