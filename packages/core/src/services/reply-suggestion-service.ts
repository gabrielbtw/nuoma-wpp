import { getDb } from "../db/connection.js";
import type { ChannelType, ReplySuggestionRecord } from "../types/domain.js";

function normalizeSuggestionContent(input: string) {
  return input.trim().replace(/\s+/g, " ");
}

function suggestionLabel(source: "automation" | "campaign", name: string) {
  return source === "automation" ? `Automação · ${name}` : `Campanha · ${name}`;
}

export function listReplySuggestions(input?: { channel?: ChannelType | "all"; limit?: number }) {
  const db = getDb();
  const limit = Math.max(1, Math.min(20, Number(input?.limit ?? 8)));
  const channel = input?.channel ?? "all";
  const suggestions = new Map<string, ReplySuggestionRecord>();

  const automationRows = db
    .prepare(
      `
        SELECT
          aa.id,
          a.name,
          aa.content
        FROM automation_actions aa
        INNER JOIN automations a ON a.id = aa.automation_id
        WHERE aa.type = 'send-text'
          AND trim(aa.content) <> ''
          AND a.enabled = 1
        ORDER BY datetime(a.updated_at) DESC, aa.sort_order ASC
        LIMIT 40
      `
    )
    .all() as Array<{ id: string; name: string; content: string }>;

  for (const row of automationRows) {
    const content = normalizeSuggestionContent(row.content);
    if (!content || suggestions.has(content.toLowerCase())) {
      continue;
    }

    suggestions.set(content.toLowerCase(), {
      id: `automation:${row.id}`,
      label: suggestionLabel("automation", row.name),
      content,
      source: "automation"
    });
  }

  const campaignRows = db
    .prepare(
      `
        SELECT
          cs.id,
          c.name,
          cs.content,
          cs.caption,
          cs.channel_scope
        FROM campaign_steps cs
        INNER JOIN campaigns c ON c.id = cs.campaign_id
        WHERE cs.type = 'text'
          AND trim(cs.content) <> ''
          AND (? = 'all' OR cs.channel_scope IN ('any', ?))
        ORDER BY datetime(c.updated_at) DESC, cs.sort_order ASC
        LIMIT 40
      `
    )
    .all(channel, channel) as Array<{ id: string; name: string; content: string; caption: string; channel_scope: string }>;

  for (const row of campaignRows) {
    const content = normalizeSuggestionContent(row.content || row.caption);
    if (!content || suggestions.has(content.toLowerCase())) {
      continue;
    }

    suggestions.set(content.toLowerCase(), {
      id: `campaign:${row.id}`,
      label: suggestionLabel("campaign", row.name),
      content,
      source: "campaign"
    });
  }

  return [...suggestions.values()].slice(0, limit);
}
