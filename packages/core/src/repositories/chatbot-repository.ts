import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { ChatbotRecord, ChatbotRuleRecord, ChatbotInput } from "../types/domain.js";

function nowIso() { return new Date().toISOString(); }

function mapRule(row: Record<string, unknown>): ChatbotRuleRecord {
  return {
    id: String(row.id),
    chatbotId: String(row.chatbot_id),
    priority: Number(row.priority ?? 0),
    matchType: String(row.match_type ?? "contains") as ChatbotRuleRecord["matchType"],
    keywordPattern: String(row.keyword_pattern ?? ""),
    responseType: String(row.response_type ?? "text") as ChatbotRuleRecord["responseType"],
    responseBody: String(row.response_body ?? ""),
    responseMediaPath: (row.response_media_path as string) ?? null,
    applyTag: (row.apply_tag as string) ?? null,
    changeStatus: (row.change_status as string) ?? null,
    flagForHuman: Boolean(row.flag_for_human),
    enabled: Boolean(row.enabled),
    triggerAutomationId: (row.trigger_automation_id as string) ?? null,
    phoneDddFilter: (row.phone_ddd_filter as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function getRulesForChatbot(chatbotId: string): ChatbotRuleRecord[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM chatbot_rules WHERE chatbot_id = ? ORDER BY priority ASC").all(chatbotId) as Array<Record<string, unknown>>;
  return rows.map(mapRule);
}

function mapChatbot(row: Record<string, unknown>): ChatbotRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    channelScope: String(row.channel_scope ?? "any") as ChatbotRecord["channelScope"],
    description: String(row.description ?? ""),
    fallbackAction: String(row.fallback_action ?? "silence_and_flag") as ChatbotRecord["fallbackAction"],
    fallbackTag: String(row.fallback_tag ?? "chatbot_nao_entendeu"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    rules: getRulesForChatbot(String(row.id))
  };
}

export function listChatbots(): ChatbotRecord[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM chatbots ORDER BY name ASC").all() as Array<Record<string, unknown>>;
  return rows.map(mapChatbot);
}

export function getChatbot(chatbotId: string): ChatbotRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chatbots WHERE id = ?").get(chatbotId) as Record<string, unknown> | undefined;
  return row ? mapChatbot(row) : null;
}

export function createChatbot(input: ChatbotInput): ChatbotRecord {
  const db = getDb();
  const id = randomUUID();
  const now = nowIso();

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO chatbots (id, name, enabled, channel_scope, description, fallback_action, fallback_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.enabled ? 1 : 0, input.channelScope, input.description, input.fallbackAction, input.fallbackTag, now, now);

    replaceRules(id, input.rules ?? []);
  });

  transaction();
  return getChatbot(id)!;
}

export function updateChatbot(chatbotId: string, input: Partial<ChatbotInput>): ChatbotRecord | null {
  const db = getDb();
  const existing = getChatbot(chatbotId);
  if (!existing) return null;

  const now = nowIso();
  const transaction = db.transaction(() => {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
    if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled ? 1 : 0); }
    if (input.channelScope !== undefined) { fields.push("channel_scope = ?"); values.push(input.channelScope); }
    if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
    if (input.fallbackAction !== undefined) { fields.push("fallback_action = ?"); values.push(input.fallbackAction); }
    if (input.fallbackTag !== undefined) { fields.push("fallback_tag = ?"); values.push(input.fallbackTag); }

    if (fields.length > 0) {
      fields.push("updated_at = ?"); values.push(now); values.push(chatbotId);
      db.prepare(`UPDATE chatbots SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    if (input.rules !== undefined) {
      replaceRules(chatbotId, input.rules);
    }
  });

  transaction();
  return getChatbot(chatbotId);
}

export function deleteChatbot(chatbotId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM chatbots WHERE id = ?").run(chatbotId);
  return result.changes > 0;
}

function replaceRules(chatbotId: string, rules: ChatbotInput["rules"]) {
  const db = getDb();
  const now = nowIso();
  db.prepare("DELETE FROM chatbot_rules WHERE chatbot_id = ?").run(chatbotId);

  const insert = db.prepare(
    `INSERT INTO chatbot_rules (id, chatbot_id, priority, match_type, keyword_pattern, response_type, response_body, response_media_path, apply_tag, change_status, flag_for_human, enabled, trigger_automation_id, phone_ddd_filter, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    insert.run(
      r.id?.trim() || randomUUID(), chatbotId, r.priority ?? i, r.matchType, r.keywordPattern,
      r.responseType, r.responseBody, r.responseMediaPath ?? null,
      r.applyTag ?? null, r.changeStatus ?? null, r.flagForHuman ? 1 : 0, r.enabled ? 1 : 0,
      r.triggerAutomationId ?? null, r.phoneDddFilter ?? null, now, now
    );
  }
}

/**
 * Match an incoming message against chatbot rules. Returns first matching rule or null.
 */
/**
 * Extract the DDD (area code) from a Brazilian phone number.
 * Handles formats like "5531...", "+5531...", "31..." etc.
 */
function extractDdd(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  return withoutCountry.length >= 2 ? withoutCountry.slice(0, 2) : null;
}

export function matchChatbotRule(chatbotId: string, messageText: string, phone?: string | null): ChatbotRuleRecord | null {
  const chatbot = getChatbot(chatbotId);
  if (!chatbot || !chatbot.enabled) return null;

  const text = messageText.toLowerCase().trim();
  for (const rule of chatbot.rules) {
    if (!rule.enabled) continue;

    // DDD filter: skip rule if phone doesn't match required DDDs
    if (rule.phoneDddFilter) {
      if (!phone) continue;
      const ddd = extractDdd(phone);
      if (!ddd) continue;
      const allowedDdds = rule.phoneDddFilter.split(",").map((d) => d.trim());
      if (!allowedDdds.includes(ddd)) continue;
    }

    const pattern = rule.keywordPattern.toLowerCase().trim();
    let matched = false;

    switch (rule.matchType) {
      case "contains": matched = text.includes(pattern); break;
      case "exact": matched = text === pattern; break;
      case "starts_with": matched = text.startsWith(pattern); break;
      case "regex":
        try { matched = new RegExp(pattern, "i").test(text); } catch { matched = false; }
        break;
    }

    if (matched) return rule;
  }

  return null;
}

/**
 * Get active chatbots for a given channel.
 */
export function getActiveChatbotsForChannel(channel: "whatsapp" | "instagram"): ChatbotRecord[] {
  return listChatbots().filter((c) => c.enabled && (c.channelScope === "any" || c.channelScope === channel));
}
