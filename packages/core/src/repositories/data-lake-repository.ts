import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(input: string | null | undefined, fallback: T) {
  if (!input) {
    return fallback;
  }

  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export type DataLakeSourceRecord = {
  id: string;
  sourceType: string;
  label: string;
  rootPath: string;
  status: string;
  lastScanAt: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DataLakeAssetRecord = {
  id: string;
  sourceId: string | null;
  originKey: string;
  sourceType: string;
  assetKind: string;
  channel: string | null;
  externalId: string | null;
  contactId: string | null;
  title: string;
  textContent: string;
  transcriptText: string | null;
  summaryText: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  originalPath: string | null;
  storagePath: string | null;
  enrichmentStatus: string;
  enrichmentModel: string | null;
  enrichmentError: string | null;
  capturedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DataLakeReportRecord = {
  id: string;
  status: string;
  sourceScope: string;
  summaryText: string;
  topKeywords: Array<Record<string, unknown>>;
  topBigrams: Array<Record<string, unknown>>;
  topSenders: Array<Record<string, unknown>>;
  topThreads: Array<Record<string, unknown>>;
  intentSignals: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  totals: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function mapSource(row: Record<string, unknown>): DataLakeSourceRecord {
  return {
    id: String(row.id),
    sourceType: String(row.source_type),
    label: String(row.label),
    rootPath: String(row.root_path),
    status: String(row.status),
    lastScanAt: (row.last_scan_at as string | null) ?? null,
    config: parseJson<Record<string, unknown>>(row.config_json as string | null, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapAsset(row: Record<string, unknown>): DataLakeAssetRecord {
  return {
    id: String(row.id),
    sourceId: (row.source_id as string | null) ?? null,
    originKey: String(row.origin_key),
    sourceType: String(row.source_type),
    assetKind: String(row.asset_kind),
    channel: (row.channel as string | null) ?? null,
    externalId: (row.external_id as string | null) ?? null,
    contactId: (row.contact_id as string | null) ?? null,
    title: String(row.title ?? ""),
    textContent: String(row.text_content ?? ""),
    transcriptText: (row.transcript_text as string | null) ?? null,
    summaryText: (row.summary_text as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    sha256: (row.sha256 as string | null) ?? null,
    originalPath: (row.original_path as string | null) ?? null,
    storagePath: (row.storage_path as string | null) ?? null,
    enrichmentStatus: String(row.enrichment_status ?? "ready"),
    enrichmentModel: (row.enrichment_model as string | null) ?? null,
    enrichmentError: (row.enrichment_error as string | null) ?? null,
    capturedAt: (row.captured_at as string | null) ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json as string | null, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapReport(row: Record<string, unknown>): DataLakeReportRecord {
  return {
    id: String(row.id),
    status: String(row.status),
    sourceScope: String(row.source_scope),
    summaryText: String(row.summary_text ?? ""),
    topKeywords: parseJson<Array<Record<string, unknown>>>(row.top_keywords_json as string | null, []),
    topBigrams: parseJson<Array<Record<string, unknown>>>(row.top_bigrams_json as string | null, []),
    topSenders: parseJson<Array<Record<string, unknown>>>(row.top_senders_json as string | null, []),
    topThreads: parseJson<Array<Record<string, unknown>>>(row.top_threads_json as string | null, []),
    intentSignals: parseJson<Array<Record<string, unknown>>>(row.intent_signals_json as string | null, []),
    timeline: parseJson<Array<Record<string, unknown>>>(row.timeline_json as string | null, []),
    totals: parseJson<Record<string, unknown>>(row.totals_json as string | null, {}),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json as string | null, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function upsertDataLakeSource(input: {
  id: string;
  sourceType: string;
  label: string;
  rootPath: string;
  status?: string;
  lastScanAt?: string | null;
  config?: Record<string, unknown>;
}) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM data_lake_sources WHERE id = ?").get(input.id) as Record<string, unknown> | undefined;
  const timestamp = nowIso();

  if (existing) {
    db.prepare(
      `
        UPDATE data_lake_sources
        SET
          source_type = ?,
          label = ?,
          root_path = ?,
          status = ?,
          last_scan_at = ?,
          config_json = ?,
          updated_at = ?
        WHERE id = ?
      `
    ).run(
      input.sourceType,
      input.label,
      input.rootPath,
      input.status ?? existing.status ?? "active",
      input.lastScanAt ?? existing.last_scan_at ?? null,
      JSON.stringify(input.config ?? parseJson(existing.config_json as string | null, {})),
      timestamp,
      input.id
    );
  } else {
    db.prepare(
      `
        INSERT INTO data_lake_sources (
          id, source_type, label, root_path, status, last_scan_at, config_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      input.id,
      input.sourceType,
      input.label,
      input.rootPath,
      input.status ?? "active",
      input.lastScanAt ?? null,
      JSON.stringify(input.config ?? {}),
      timestamp,
      timestamp
    );
  }

  return getDataLakeSourceById(input.id);
}

export function getDataLakeSourceById(sourceId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM data_lake_sources WHERE id = ?").get(sourceId) as Record<string, unknown> | undefined;
  return row ? mapSource(row) : null;
}

export function listDataLakeSources() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM data_lake_sources ORDER BY label ASC").all() as Array<Record<string, unknown>>;
  return rows.map(mapSource);
}

export function upsertDataLakeAsset(input: {
  sourceId?: string | null;
  originKey: string;
  sourceType: string;
  assetKind: string;
  channel?: string | null;
  externalId?: string | null;
  contactId?: string | null;
  title?: string;
  textContent?: string;
  transcriptText?: string | null;
  summaryText?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  originalPath?: string | null;
  storagePath?: string | null;
  enrichmentStatus?: string;
  enrichmentModel?: string | null;
  enrichmentError?: string | null;
  capturedAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM data_lake_assets WHERE origin_key = ?").get(input.originKey) as Record<string, unknown> | undefined;
  const timestamp = nowIso();

  if (existing) {
    db.prepare(
      `
        UPDATE data_lake_assets
        SET
          source_id = ?,
          source_type = ?,
          asset_kind = ?,
          channel = ?,
          external_id = ?,
          contact_id = ?,
          title = ?,
          text_content = ?,
          transcript_text = ?,
          summary_text = ?,
          mime_type = ?,
          size_bytes = ?,
          sha256 = ?,
          original_path = ?,
          storage_path = ?,
          enrichment_status = ?,
          enrichment_model = ?,
          enrichment_error = ?,
          captured_at = ?,
          metadata_json = ?,
          updated_at = ?
        WHERE id = ?
      `
    ).run(
      input.sourceId ?? existing.source_id ?? null,
      input.sourceType,
      input.assetKind,
      input.channel ?? existing.channel ?? null,
      input.externalId ?? existing.external_id ?? null,
      input.contactId ?? existing.contact_id ?? null,
      input.title ?? existing.title ?? "",
      input.textContent ?? existing.text_content ?? "",
      input.transcriptText ?? existing.transcript_text ?? null,
      input.summaryText ?? existing.summary_text ?? null,
      input.mimeType ?? existing.mime_type ?? null,
      input.sizeBytes ?? existing.size_bytes ?? null,
      input.sha256 ?? existing.sha256 ?? null,
      input.originalPath ?? existing.original_path ?? null,
      input.storagePath ?? existing.storage_path ?? null,
      input.enrichmentStatus ?? existing.enrichment_status ?? "ready",
      input.enrichmentModel ?? existing.enrichment_model ?? null,
      input.enrichmentError ?? existing.enrichment_error ?? null,
      input.capturedAt ?? existing.captured_at ?? null,
      JSON.stringify(input.metadata ?? parseJson(existing.metadata_json as string | null, {})),
      timestamp,
      existing.id
    );

    return getDataLakeAssetById(String(existing.id));
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO data_lake_assets (
        id, source_id, origin_key, source_type, asset_kind, channel, external_id, contact_id, title, text_content,
        transcript_text, summary_text, mime_type, size_bytes, sha256, original_path, storage_path, enrichment_status,
        enrichment_model, enrichment_error, captured_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.sourceId ?? null,
    input.originKey,
    input.sourceType,
    input.assetKind,
    input.channel ?? null,
    input.externalId ?? null,
    input.contactId ?? null,
    input.title ?? "",
    input.textContent ?? "",
    input.transcriptText ?? null,
    input.summaryText ?? null,
    input.mimeType ?? null,
    input.sizeBytes ?? null,
    input.sha256 ?? null,
    input.originalPath ?? null,
    input.storagePath ?? null,
    input.enrichmentStatus ?? "ready",
    input.enrichmentModel ?? null,
    input.enrichmentError ?? null,
    input.capturedAt ?? null,
    JSON.stringify(input.metadata ?? {}),
    timestamp,
    timestamp
  );

  return getDataLakeAssetById(id);
}

export function getDataLakeAssetById(assetId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM data_lake_assets WHERE id = ?").get(assetId) as Record<string, unknown> | undefined;
  return row ? mapAsset(row) : null;
}

export function listDataLakeAssets(filters?: {
  assetKinds?: string[];
  enrichmentStatuses?: string[];
  limit?: number;
}) {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.assetKinds?.length) {
    where.push(`asset_kind IN (${filters.assetKinds.map(() => "?").join(", ")})`);
    params.push(...filters.assetKinds);
  }

  if (filters?.enrichmentStatuses?.length) {
    where.push(`enrichment_status IN (${filters.enrichmentStatuses.map(() => "?").join(", ")})`);
    params.push(...filters.enrichmentStatuses);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(1000, filters?.limit ?? 200));
  const rows = db
    .prepare(
      `
        SELECT *
        FROM data_lake_assets
        ${whereClause}
        ORDER BY datetime(COALESCE(captured_at, updated_at)) DESC, created_at DESC
        LIMIT ?
      `
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map(mapAsset);
}

export function listDataLakeTextCorpus(limit = 5000) {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM data_lake_assets
        WHERE trim(
          COALESCE(NULLIF(text_content, ''), '') || ' ' ||
          COALESCE(NULLIF(transcript_text, ''), '') || ' ' ||
          COALESCE(NULLIF(summary_text, ''), '')
        ) <> ''
        ORDER BY datetime(COALESCE(captured_at, updated_at)) DESC, created_at DESC
        LIMIT ?
      `
    )
    .all(Math.max(1, Math.min(10000, limit))) as Array<Record<string, unknown>>;

  return rows.map(mapAsset);
}

export function createDataLakeReport(input: {
  status?: string;
  sourceScope?: string;
  summaryText: string;
  topKeywords?: Array<Record<string, unknown>>;
  topBigrams?: Array<Record<string, unknown>>;
  topSenders?: Array<Record<string, unknown>>;
  topThreads?: Array<Record<string, unknown>>;
  intentSignals?: Array<Record<string, unknown>>;
  timeline?: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO data_lake_reports (
        id, status, source_scope, summary_text, top_keywords_json, top_bigrams_json, top_senders_json, top_threads_json,
        intent_signals_json, timeline_json, totals_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.status ?? "ready",
    input.sourceScope ?? "default",
    input.summaryText,
    JSON.stringify(input.topKeywords ?? []),
    JSON.stringify(input.topBigrams ?? []),
    JSON.stringify(input.topSenders ?? []),
    JSON.stringify(input.topThreads ?? []),
    JSON.stringify(input.intentSignals ?? []),
    JSON.stringify(input.timeline ?? []),
    JSON.stringify(input.totals ?? {}),
    JSON.stringify(input.metadata ?? {}),
    timestamp,
    timestamp
  );

  return getDataLakeReportById(id);
}

export function getDataLakeReportById(reportId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM data_lake_reports WHERE id = ?").get(reportId) as Record<string, unknown> | undefined;
  return row ? mapReport(row) : null;
}

export function getLatestDataLakeReport() {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM data_lake_reports ORDER BY datetime(created_at) DESC, id DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? mapReport(row) : null;
}
