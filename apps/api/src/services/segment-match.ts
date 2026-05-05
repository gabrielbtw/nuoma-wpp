import type { Contact, Segment } from "@nuoma/contracts";

export function segmentMatches(
  segment: Segment | null,
  contact: Contact | null,
  channel: "whatsapp" | "instagram" | "system",
): boolean {
  if (!segment) return true;
  const checks = segment.conditions.map((condition) => {
    const value = condition.value;
    switch (condition.field) {
      case "channel":
        return compareValue(channel, condition.operator, value);
      case "status":
        return compareValue(contact?.status ?? null, condition.operator, value);
      case "tag":
        return compareCollection(contact?.tagIds ?? [], condition.operator, value);
      case "lastMessageAt":
        return compareValue(contact?.lastMessageAt ?? null, condition.operator, value);
      case "createdAt":
        return compareValue(contact?.createdAt ?? null, condition.operator, value);
      case "procedure":
      case "instagramRelationship":
        return true;
      default:
        return false;
    }
  });
  return segment.operator === "or" ? checks.some(Boolean) : checks.every(Boolean);
}

function compareCollection(
  values: Array<string | number>,
  operator: Segment["conditions"][number]["operator"],
  expected: Segment["conditions"][number]["value"],
): boolean {
  if (operator === "exists") return values.length > 0;
  if (operator === "not_exists") return values.length === 0;
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  const hasAny = expectedValues.some(
    (value) => (typeof value === "string" || typeof value === "number") && values.includes(value),
  );
  if (operator === "eq" || operator === "in") return hasAny;
  if (operator === "neq" || operator === "not_in") return !hasAny;
  return false;
}

function compareValue(
  actual: string | number | boolean | null,
  operator: Segment["conditions"][number]["operator"],
  expected: Segment["conditions"][number]["value"],
): boolean {
  if (operator === "exists") return actual !== null && actual !== "";
  if (operator === "not_exists") return actual === null || actual === "";
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  const hasAny = expectedValues.some((value) => value === actual);
  if (operator === "eq" || operator === "in") return hasAny;
  if (operator === "neq" || operator === "not_in") return !hasAny;
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const actualTime = Date.parse(actual);
  const expectedTime = Date.parse(expected);
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime)) return false;
  if (operator === "before") return actualTime < expectedTime;
  if (operator === "after") return actualTime > expectedTime;
  return false;
}
