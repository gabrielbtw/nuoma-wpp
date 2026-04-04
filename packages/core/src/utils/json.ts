/**
 * Shared JSON parsing utilities.
 * Extracted from duplicated implementations across repositories.
 */

export function parseJsonObject(input: string | null | undefined): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseJsonArray<T = string>(input: string | null | undefined, fallback: T[] = []): T[] {
  if (!input) return fallback;
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function parseJsonStringArray(input: string | null | undefined): string[] {
  return parseJsonArray<string>(input).map(String);
}
