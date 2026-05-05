import type { Campaign, CampaignRecipient, CampaignStep } from "@nuoma/contracts";

export interface CampaignAbVariant {
  id: string;
  label: string;
  weight: number;
  stepOverrides: Record<string, Record<string, unknown>>;
}

export interface CampaignAbConfig {
  enabled: true;
  assignment: "deterministic";
  variants: CampaignAbVariant[];
}

export function readCampaignAbConfig(metadata: Record<string, unknown>): CampaignAbConfig | null {
  const raw = objectRecord(metadata.abVariants);
  if (raw.enabled === false) {
    return null;
  }

  const variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .map((entry, index) => readCampaignAbVariant(entry, index))
    .filter((entry): entry is CampaignAbVariant => entry !== null);

  if (variants.length < 2) {
    return null;
  }

  return {
    enabled: true,
    assignment: "deterministic",
    variants,
  };
}

export function resolveCampaignAbVariant(input: {
  campaign: Campaign;
  recipient: CampaignRecipient;
}): CampaignAbVariant | null {
  const config = readCampaignAbConfig(input.campaign.metadata);
  if (!config) {
    return null;
  }

  const existingId = stringFromUnknown(input.recipient.metadata.abVariantId);
  const existing = existingId
    ? config.variants.find((variant) => variant.id === existingId)
    : null;
  if (existing) {
    return existing;
  }

  return selectCampaignAbVariant(config, `${input.campaign.id}:${input.recipient.id}:${input.recipient.phone ?? ""}`);
}

export function applyCampaignAbVariantToStep(
  step: CampaignStep,
  variant: CampaignAbVariant | null,
): CampaignStep {
  const override = variant?.stepOverrides[step.id];
  if (!override) {
    return step;
  }

  const label = nonEmptyString(override.label) ?? step.label;
  const delaySeconds = positiveInteger(override.delaySeconds) ?? step.delaySeconds;

  if (step.type === "text") {
    return {
      ...step,
      label,
      delaySeconds,
      template: nonEmptyString(override.template) ?? step.template,
    };
  }

  if (step.type === "link") {
    return {
      ...step,
      label,
      delaySeconds,
      text: nonEmptyString(override.text) ?? step.text,
      url: validUrl(override.url) ?? step.url,
      previewEnabled:
        typeof override.previewEnabled === "boolean" ? override.previewEnabled : step.previewEnabled,
    };
  }

  if (step.type === "document") {
    return {
      ...step,
      label,
      delaySeconds,
      mediaAssetId: positiveInteger(override.mediaAssetId) ?? step.mediaAssetId,
      fileName: nonEmptyString(override.fileName) ?? step.fileName,
      caption: nullableString(override.caption, step.caption),
    };
  }

  if (step.type === "image") {
    const mediaAssetIds = positiveIntegerArray(override.mediaAssetIds);
    const mediaAssetId = positiveInteger(override.mediaAssetId) ?? mediaAssetIds?.[0] ?? step.mediaAssetId;
    return {
      ...step,
      label,
      delaySeconds,
      mediaAssetId,
      mediaAssetIds: mediaAssetIds ?? step.mediaAssetIds,
      caption: nullableString(override.caption, step.caption),
    };
  }

  return {
    ...step,
    label,
    delaySeconds,
    mediaAssetId: positiveInteger(override.mediaAssetId) ?? step.mediaAssetId,
    caption: nullableString(override.caption, step.caption),
  };
}

export function campaignAbAssignmentMetadata(input: {
  metadata: Record<string, unknown>;
  variant: CampaignAbVariant | null;
  now: Date;
}): Record<string, unknown> {
  if (!input.variant) {
    return input.metadata;
  }
  return {
    ...input.metadata,
    abVariantId: input.variant.id,
    abVariantLabel: input.variant.label,
    abVariantAssignedAt:
      typeof input.metadata.abVariantAssignedAt === "string"
        ? input.metadata.abVariantAssignedAt
        : input.now.toISOString(),
  };
}

function readCampaignAbVariant(value: unknown, index: number): CampaignAbVariant | null {
  const record = objectRecord(value);
  const id = nonEmptyString(record.id) ?? `variant-${index + 1}`;
  const label = nonEmptyString(record.label) ?? id;
  const weight = positiveInteger(record.weight) ?? 1;
  const stepOverrides = objectRecord(record.stepOverrides);
  return {
    id,
    label,
    weight,
    stepOverrides: Object.fromEntries(
      Object.entries(stepOverrides).map(([stepId, override]) => [stepId, objectRecord(override)]),
    ),
  };
}

function selectCampaignAbVariant(
  config: CampaignAbConfig,
  stableKey: string,
): CampaignAbVariant {
  const totalWeight = config.variants.reduce((total, variant) => total + variant.weight, 0);
  const bucket = stableHash(stableKey) % Math.max(1, totalWeight);
  let cursor = 0;
  for (const variant of config.variants) {
    cursor += variant.weight;
    if (bucket < cursor) {
      return variant;
    }
  }
  return config.variants[0] as CampaignAbVariant;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value.trim() || null : fallback;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function positiveIntegerArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids = Array.from(new Set(value.map(positiveInteger).filter((id): id is number => id !== null)));
  return ids.length > 0 ? ids.slice(0, 10) : null;
}

function validUrl(value: unknown): string | null {
  const url = nonEmptyString(value);
  if (!url) {
    return null;
  }
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}
