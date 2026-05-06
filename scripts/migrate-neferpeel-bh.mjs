#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oldRoot = "/Users/gabrielbraga/Projetos/nuoma-wpp";
const oldDbPath = path.join(oldRoot, "storage", "database", "nuoma.db");
const newDbPath = path.join(rootDir, "data", "nuoma-v2.db");
const mediaTargetDir = path.join(rootDir, "data", "campaign-media", "neferpeel-bh");
const userId = 1;
const now = new Date().toISOString();
const dryRun = process.argv.includes("--dry-run");

const oldMedia = [
  { type: "voice", fileName: "A1BH.ogg", mimeType: "audio/ogg", source: "storage/uploads/media/automation/neferpeel-bh/A1BH.ogg" },
  { type: "image", fileName: "foto1.jpg", mimeType: "image/jpeg", source: "storage/uploads/media/automation/neferpeel-bh/foto1.jpg" },
  { type: "image", fileName: "foto2.jpg", mimeType: "image/jpeg", source: "storage/uploads/media/automation/neferpeel-bh/foto2.jpg" },
  { type: "image", fileName: "foto3.jpg", mimeType: "image/jpeg", source: "storage/uploads/media/automation/neferpeel-bh/foto3.jpg" },
  { type: "image", fileName: "foto4.jpg", mimeType: "image/jpeg", source: "storage/uploads/media/automation/neferpeel-bh/foto4.jpg" },
];

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

function firstName(name) {
  const clean = String(name || "").trim();
  if (!clean || clean.startsWith("+")) return "";
  return clean.split(/\s+/)[0] || "";
}

function getOrCreateTag(db, name, color) {
  const existing = db
    .prepare("SELECT id FROM tags WHERE user_id = ? AND name = ?")
    .get(userId, name);
  if (existing?.id) return Number(existing.id);
  const result = db
    .prepare(
      `INSERT INTO tags (user_id, name, color, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, name, color, "Migrado do nuoma-wpp Neferpeel BH", now, now);
  return Number(result.lastInsertRowid);
}

function upsertContact(db, lead, tagIds) {
  const phone = normalizePhone(lead.phone);
  if (!phone) return null;
  const existing = db
    .prepare("SELECT id, name FROM contacts WHERE user_id = ? AND phone = ? AND deleted_at IS NULL")
    .get(userId, phone);
  let contactId;
  if (existing?.id) {
    contactId = Number(existing.id);
    const currentName = String(existing.name || "");
    const betterName = lead.name && !lead.name.startsWith("+") ? lead.name : currentName;
    db.prepare(
      `UPDATE contacts
          SET name = ?,
              primary_channel = 'whatsapp',
              status = CASE WHEN status IN ('lead', 'active') THEN status ELSE 'lead' END,
              notes = trim(coalesce(notes, '') || char(10) || ?),
              updated_at = ?
        WHERE id = ?`,
    ).run(
      betterName || phone,
      `Migrado Neferpeel BH de /nuoma-wpp em ${now}; oldContactId=${lead.id}`,
      now,
      contactId,
    );
  } else {
    const result = db
      .prepare(
        `INSERT INTO contacts (user_id, name, phone, primary_channel, status, notes, last_message_at, created_at, updated_at)
         VALUES (?, ?, ?, 'whatsapp', 'lead', ?, ?, ?, ?)`,
      )
      .run(
        userId,
        lead.name || phone,
        phone,
        `Migrado Neferpeel BH de /nuoma-wpp em ${now}; oldContactId=${lead.id}`,
        lead.lastIncomingAt || lead.lastOutgoingAt || null,
        now,
        now,
      );
    contactId = Number(result.lastInsertRowid);
  }

  for (const tagId of tagIds) {
    db.prepare(
      `INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, user_id, created_at, sort_order)
       VALUES (?, ?, ?, ?, 0)`,
    ).run(contactId, tagId, userId, now);
  }
  return contactId;
}

function upsertMediaAsset(db, item) {
  const sourcePath = path.join(oldRoot, item.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`media file not found: ${sourcePath}`);
  }
  fs.mkdirSync(mediaTargetDir, { recursive: true });
  const targetPath = path.join(mediaTargetDir, item.fileName);
  if (!fs.existsSync(targetPath) || sha256(targetPath) !== sha256(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
  const digest = sha256(targetPath);
  const stat = fs.statSync(targetPath);
  const existing = db
    .prepare("SELECT id FROM media_assets WHERE user_id = ? AND sha256 = ?")
    .get(userId, digest);
  if (existing?.id) return Number(existing.id);
  const storagePath = path.relative(rootDir, targetPath);
  const result = db
    .prepare(
      `INSERT INTO media_assets
        (user_id, type, file_name, mime_type, sha256, size_bytes, duration_ms, storage_path, source_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      item.type,
      item.fileName,
      item.mimeType,
      digest,
      stat.size,
      storagePath,
      `nuoma-wpp:${item.source}`,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

const oldDb = new Database(oldDbPath, { readonly: true });
const db = new Database(newDbPath);

try {
  const sourceAutomation = oldDb
    .prepare("SELECT id, name, description FROM automations WHERE id = ?")
    .get("3fe672ad-1e93-47c9-8c54-f0b16410e462");
  if (!sourceAutomation) {
    throw new Error("source automation Neferpeel BH not found");
  }

  const leads = oldDb
    .prepare(
      `WITH tagged AS (
         SELECT
           c.id,
           c.name,
           c.phone,
           c.last_incoming_at AS lastIncomingAt,
           c.last_outgoing_at AS lastOutgoingAt,
           max(CASE WHEN t.name = 'neferpeel-lead-bh' THEN 1 ELSE 0 END) AS lead,
           max(CASE WHEN t.name = 'neferpeel-sem-resposta' THEN 1 ELSE 0 END) AS semResposta,
           max(CASE WHEN t.name = 'nao_insistir' THEN 1 ELSE 0 END) AS naoInsistir
         FROM contacts c
         JOIN contact_tags ct ON ct.contact_id = c.id
         JOIN tags t ON t.id = ct.tag_id
         WHERE c.phone IS NOT NULL AND trim(c.phone) <> ''
         GROUP BY c.id
       )
       SELECT *
       FROM tagged
       WHERE lead = 1 AND naoInsistir = 0
       ORDER BY semResposta ASC, lastIncomingAt DESC, lastOutgoingAt DESC, phone ASC`,
    )
    .all();

  const duplicatePhones = new Set();
  const seenPhones = new Set();
  const uniqueLeads = [];
  for (const lead of leads) {
    const phone = normalizePhone(lead.phone);
    if (!phone) continue;
    if (seenPhones.has(phone)) {
      duplicatePhones.add(phone);
      continue;
    }
    seenPhones.add(phone);
    uniqueLeads.push({ ...lead, phone });
  }

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          sourceAutomation,
          leads: leads.length,
          uniqueRecipients: uniqueLeads.length,
          duplicatePhones: [...duplicatePhones],
          media: oldMedia.map((item) => ({ ...item, exists: fs.existsSync(path.join(oldRoot, item.source)) })),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const tx = db.transaction(() => {
    const assetIds = Object.fromEntries(oldMedia.map((item) => [item.fileName, upsertMediaAsset(db, item)]));
    const leadTagId = getOrCreateTag(db, "neferpeel-lead-bh", "#3ddc97");
    const semRespostaTagId = getOrCreateTag(db, "neferpeel-sem-resposta", "#3ddc97");
    const migratedTagId = getOrCreateTag(db, "migrado-neferpeel-bh", "#8b5cf6");

    const steps = [
      {
        id: "nefer-bom-dia",
        label: "Bom dia",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Bom dia! Tudo bem? 😊",
      },
      {
        id: "nefer-apresentacao",
        label: "Apresentacao",
        type: "text",
        delaySeconds: 3,
        conditions: [],
        template: "Meu nome é Gabriel, especialista aqui na Nuoma.",
      },
      {
        id: "nefer-audio",
        label: "Audio explicativo",
        type: "voice",
        delaySeconds: 3,
        conditions: [],
        mediaAssetId: assetIds["A1BH.ogg"],
        caption: null,
      },
      {
        id: "nefer-fotos",
        label: "Fotos antes e depois",
        type: "image",
        delaySeconds: 5,
        conditions: [],
        mediaAssetId: assetIds["foto1.jpg"],
        mediaAssetIds: ["foto1.jpg", "foto2.jpg", "foto3.jpg", "foto4.jpg"].map((name) => assetIds[name]),
        caption: null,
      },
      {
        id: "nefer-fechamento",
        label: "Fechamento",
        type: "text",
        delaySeconds: 3,
        conditions: [],
        template: "Olha essa transformação em apenas 15 dias! 😍\n\nNo áudio acima eu expliquei sobre o Neferpeel, ficou alguma dúvida?",
      },
    ];

    db.prepare(
      `UPDATE campaigns
          SET status = 'archived',
              updated_at = ?
        WHERE user_id = ?
          AND name = ?
          AND status = 'draft'`,
    ).run(now, userId, "Neferpeel BH - migrada do nuoma-wpp");

    const campaignResult = db
      .prepare(
        `INSERT INTO campaigns
          (user_id, name, status, channel, segment_json, steps_json, evergreen, starts_at, completed_at, metadata_json, created_at, updated_at)
         VALUES (?, ?, 'draft', 'whatsapp', NULL, ?, 0, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        userId,
        "Neferpeel BH - migrada do nuoma-wpp",
        JSON.stringify(steps),
        JSON.stringify({
          source: "nuoma-wpp",
          sourceAutomationId: sourceAutomation.id,
          sourceAutomationName: sourceAutomation.name,
          sourceDescription: sourceAutomation.description,
          sendMode: "draft_requires_manual_activation",
          originalActionTypes: ["send-text", "send-audio", "send-image", "apply-tag"],
          originalApplyTag: "neferpeel-lead-bh",
          recipientFilter: "tag neferpeel-lead-bh excluding nao_insistir",
          migratedAt: now,
        }),
        now,
        now,
      );
    const campaignId = Number(campaignResult.lastInsertRowid);

    let recipients = 0;
    for (const lead of uniqueLeads) {
      const tags = lead.semResposta ? [leadTagId, semRespostaTagId, migratedTagId] : [leadTagId, migratedTagId];
      const contactId = upsertContact(db, lead, tags);
      if (!contactId) continue;
      db.prepare(
        `INSERT INTO campaign_recipients
          (user_id, campaign_id, contact_id, phone, channel, status, current_step_id, last_error, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'whatsapp', 'queued', NULL, NULL, ?, ?, ?)`,
      ).run(
        userId,
        campaignId,
        contactId,
        lead.phone,
        JSON.stringify({
          variables: {
            nome: lead.name || "",
            name: lead.name || "",
            primeiro_nome: firstName(lead.name),
          },
          sourceContactId: lead.id,
          sourceTags: lead.semResposta ? ["neferpeel-lead-bh", "neferpeel-sem-resposta"] : ["neferpeel-lead-bh"],
          migratedAt: now,
        }),
        now,
        now,
      );
      recipients += 1;
    }

    return { campaignId, recipients, assetIds };
  });

  const result = tx();
  console.log(
    JSON.stringify(
      {
        migrated: true,
        campaignId: result.campaignId,
        status: "draft",
        recipients: result.recipients,
        assetIds: result.assetIds,
        mediaDir: path.relative(rootDir, mediaTargetDir),
      },
      null,
      2,
    ),
  );
} finally {
  oldDb.close();
  db.close();
}
