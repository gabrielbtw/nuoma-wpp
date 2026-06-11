import type { Segment, SegmentCondition } from "@nuoma/contracts";

export type SegmentField = SegmentCondition["field"];
export type SegmentOperator = SegmentCondition["operator"];

export interface SegmentDraft {
  id: string;
  field: SegmentField;
  operator: SegmentOperator;
  value: string;
}

export function buildSegment(
  enabled: boolean,
  field: SegmentField,
  operator: SegmentOperator,
  rawValue: string,
): Segment | null {
  if (!enabled) return null;
  const value = parseSegmentDraftValue(operator, rawValue);
  return {
    operator: "and",
    conditions: [{ field, operator, value }],
  };
}

export function buildSegmentFromDrafts(
  enabled: boolean,
  operator: "and" | "or",
  drafts: SegmentDraft[],
): Segment | null {
  if (!enabled) return null;
  const conditions = drafts
    .map((draft) => ({
      field: draft.field,
      operator: draft.operator,
      value: parseSegmentDraftValue(draft.operator, draft.value),
    }))
    .filter(
      (condition) =>
        condition.operator === "exists" ||
        condition.operator === "not_exists" ||
        condition.value !== "",
    );
  return conditions.length > 0 ? { operator, conditions } : null;
}

export function parseSegmentDraftValue(operator: SegmentOperator, rawValue: string) {
  return operator === "exists" || operator === "not_exists" ? null : parseSegmentValue(rawValue);
}

export function parseSegmentValue(value: string) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}
