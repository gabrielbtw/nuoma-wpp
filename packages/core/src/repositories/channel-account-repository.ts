import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { ChannelAccountRecord, ChannelAccountStatus, ChannelType } from "../types/domain.js";
import {
  defaultChannelAccountDisplayName,
  defaultChannelAccountKey,
  defaultChannelAccountStatus
} from "../utils/channels.js";

function nowIso() {
  return new Date().toISOString();
}

function parseJsonObject(input: string | null | undefined) {
  if (!input) {
    return {};
  }

  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapChannelAccount(row: Record<string, unknown>): ChannelAccountRecord {
  return {
    id: String(row.id),
    type: String(row.type) as ChannelType,
    provider: String(row.provider ?? "local"),
    accountKey: String(row.account_key),
    displayName: String(row.display_name),
    status: String(row.status) as ChannelAccountStatus,
    metadata: parseJsonObject(row.metadata_json as string | null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function listChannelAccounts() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM channel_accounts ORDER BY type ASC, display_name ASC").all() as Array<Record<string, unknown>>;
  return rows.map(mapChannelAccount);
}

export function getChannelAccountById(channelAccountId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM channel_accounts WHERE id = ?").get(channelAccountId) as Record<string, unknown> | undefined;
  return row ? mapChannelAccount(row) : null;
}

export function getChannelAccountByKey(type: ChannelType, accountKey: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM channel_accounts WHERE type = ? AND account_key = ?").get(type, accountKey) as
    | Record<string, unknown>
    | undefined;
  return row ? mapChannelAccount(row) : null;
}

export function ensureChannelAccount(input: {
  type: ChannelType;
  provider?: string;
  accountKey?: string;
  displayName?: string;
  status?: ChannelAccountStatus;
  metadata?: Record<string, unknown>;
}) {
  const existing = getChannelAccountByKey(input.type, input.accountKey ?? defaultChannelAccountKey(input.type));
  if (existing) {
    return existing;
  }

  const db = getDb();
  const timestamp = nowIso();
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO channel_accounts (id, type, provider, account_key, display_name, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.type,
    input.provider ?? "local",
    input.accountKey ?? defaultChannelAccountKey(input.type),
    input.displayName ?? defaultChannelAccountDisplayName(input.type),
    input.status ?? defaultChannelAccountStatus(input.type),
    JSON.stringify(input.metadata ?? {}),
    timestamp,
    timestamp
  );

  return getChannelAccountById(id);
}

export function ensureDefaultChannelAccounts() {
  return {
    whatsapp: ensureChannelAccount({
      type: "whatsapp",
      provider: "local-browser",
      accountKey: defaultChannelAccountKey("whatsapp"),
      displayName: defaultChannelAccountDisplayName("whatsapp"),
      status: defaultChannelAccountStatus("whatsapp"),
      metadata: {
        workerKey: "wa-worker"
      }
    }),
    instagram: ensureChannelAccount({
      type: "instagram",
      provider: "assisted-browser",
      accountKey: defaultChannelAccountKey("instagram"),
      displayName: defaultChannelAccountDisplayName("instagram"),
      status: defaultChannelAccountStatus("instagram"),
      metadata: {
        mode: "assisted"
      }
    })
  };
}
