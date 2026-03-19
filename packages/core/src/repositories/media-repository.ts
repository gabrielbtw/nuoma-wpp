import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";

function nowIso() {
  return new Date().toISOString();
}

export function getMediaAssetByHash(sha256: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM media_assets WHERE sha256 = ?").get(sha256) as Record<string, unknown> | undefined;
}

export function getMediaAssetById(mediaAssetId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM media_assets WHERE id = ?").get(mediaAssetId) as Record<string, unknown> | undefined;
}

export function createOrReuseMediaAsset(input: {
  sha256: string;
  originalName: string;
  safeName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  storagePath: string;
  linkedCampaignId?: string | null;
  linkedAutomationId?: string | null;
}) {
  const existing = getMediaAssetByHash(input.sha256);
  if (existing) {
    return existing;
  }

  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO media_assets (
        id, sha256, original_name, safe_name, mime_type, size_bytes, category, linked_campaign_id, linked_automation_id, storage_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.sha256,
    input.originalName,
    input.safeName,
    input.mimeType,
    input.sizeBytes,
    input.category,
    input.linkedCampaignId ?? null,
    input.linkedAutomationId ?? null,
    input.storagePath,
    nowIso()
  );

  return getMediaAssetById(id);
}

export function listTemporaryMediaAssets() {
  const db = getDb();
  return db.prepare("SELECT * FROM media_assets WHERE category = 'temp'").all() as Array<Record<string, unknown>>;
}
