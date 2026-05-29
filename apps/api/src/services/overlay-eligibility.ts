export function isOverlayEnabled(metadata: unknown): boolean {
  const record = objectRecord(metadata);
  return record.overlayEnabled === true;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
