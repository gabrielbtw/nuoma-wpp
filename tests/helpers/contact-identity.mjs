export function normalizeSmokePhoneDigits(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /@g\.us$/i.test(raw) || /@broadcast$/i.test(raw)) {
    return null;
  }
  const digits = raw.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }
  return null;
}

export function normalizeSmokePhoneE164(value) {
  const phone = normalizeSmokePhoneDigits(value);
  return phone ? `+${phone}` : null;
}

export function normalizeSmokeWaJid(value) {
  const phone = normalizeSmokePhoneDigits(value);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

export function backfillSmokeWhatsappIdentity(db, input = {}) {
  const userId = Number(input.userId ?? 1);
  const now = input.now ?? new Date().toISOString();
  const phone = normalizeSmokePhoneDigits(input.phone);
  const phoneE164 = normalizeSmokePhoneE164(input.phone);
  const waJid = normalizeSmokeWaJid(input.phone);
  if (!phone || !phoneE164 || !waJid) {
    return { contacts: 0, conversations: 0, skipped: true };
  }

  let contacts = 0;
  if (hasColumns(db, "contacts", ["phone_e164", "wa_jid"])) {
    const result = db
      .prepare(
        `UPDATE contacts
         SET phone_e164 = COALESCE(phone_e164, @phoneE164),
             wa_jid = COALESCE(wa_jid, @waJid),
             updated_at = COALESCE(updated_at, @now)
         WHERE user_id = @userId
           AND deleted_at IS NULL
           AND (
             id = @contactId
             OR phone = @phone
             OR phone_e164 = @phoneE164
             OR wa_jid = @waJid
           )`,
      )
      .run({
        userId,
        contactId: input.contactId ?? null,
        phone,
        phoneE164,
        waJid,
        now,
      });
    contacts = result.changes;
  }

  let conversations = 0;
  if (hasColumns(db, "conversations", ["wa_jid"])) {
    const result = db
      .prepare(
        `UPDATE conversations
         SET wa_jid = COALESCE(wa_jid, @waJid),
             updated_at = COALESCE(updated_at, @now)
         WHERE user_id = @userId
           AND channel = 'whatsapp'
           AND (
             id = @conversationId
             OR external_thread_id = @phone
             OR external_thread_id = @legacyJid
             OR external_thread_id = @waJid
           )`,
      )
      .run({
        userId,
        conversationId: input.conversationId ?? null,
        phone,
        legacyJid: `${phone}@c.us`,
        waJid,
        now,
      });
    conversations = result.changes;
  }

  return { contacts, conversations, skipped: false };
}

function hasColumns(db, table, names) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const present = new Set(columns.map((column) => column.name));
  return names.every((name) => present.has(name));
}
