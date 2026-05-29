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

export function smokeWhatsappIdentityValues(value) {
  const phone = normalizeSmokePhoneDigits(value);
  const phoneE164 = normalizeSmokePhoneE164(value);
  const waJid = normalizeSmokeWaJid(value);
  return {
    phone,
    phoneE164,
    waJid,
    legacyJid: phone ? `${phone}@c.us` : null,
  };
}

export function findSmokeWhatsappContact(db, input = {}) {
  const userId = Number(input.userId ?? 1);
  const identity = smokeWhatsappIdentityValues(input.phone);
  if (!identity.phone || !identity.phoneE164 || !identity.waJid) {
    return null;
  }

  if (hasColumns(db, "contacts", ["phone_e164", "wa_jid"])) {
    return db
      .prepare(
        `SELECT * FROM contacts
         WHERE user_id = @userId
           AND deleted_at IS NULL
           AND (
             phone = @phone
             OR phone_e164 = @phoneE164
             OR wa_jid = @waJid
           )
         ORDER BY id ASC LIMIT 1`,
      )
      .get({ userId, ...identity });
  }

  return db
    .prepare(
      `SELECT * FROM contacts
       WHERE user_id = ? AND deleted_at IS NULL AND phone = ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(userId, identity.phone);
}

export function findSmokeWhatsappConversation(db, input = {}) {
  const userId = Number(input.userId ?? 1);
  const contactId = input.contactId ?? null;
  const identity = smokeWhatsappIdentityValues(input.phone);
  if (!identity.phone || !identity.phoneE164 || !identity.waJid || !identity.legacyJid) {
    return null;
  }

  const hasConversationWaJid = hasColumns(db, "conversations", ["wa_jid"]);
  const hasContactIdentity = hasColumns(db, "contacts", ["phone_e164", "wa_jid"]);
  const conversationWaJidClause = hasConversationWaJid ? "OR c.wa_jid = @waJid" : "";
  const contactIdentityClause = hasContactIdentity
    ? `OR ct.phone = @phone
       OR ct.phone_e164 = @phoneE164
       OR ct.wa_jid = @waJid`
    : "OR ct.phone = @phone";

  return db
    .prepare(
      `SELECT c.*
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.user_id = @userId
         AND c.channel = 'whatsapp'
         AND (
           c.contact_id = @contactId
           OR c.external_thread_id = @phone
           OR c.external_thread_id = @legacyJid
           OR c.external_thread_id = @waJid
           ${conversationWaJidClause}
           ${contactIdentityClause}
         )
       ORDER BY c.last_message_at DESC NULLS LAST, c.id ASC
       LIMIT 1`,
    )
    .get({ userId, contactId, ...identity });
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
