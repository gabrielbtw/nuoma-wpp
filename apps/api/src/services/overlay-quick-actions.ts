import {
  contactStatusSchema,
  normalizePhone,
  normalizeWaJid,
  type Contact,
  type ContactStatus,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

export type OverlayQuickActionName = "applyTag" | "removeTag" | "setStatus" | "createReminder";

export interface OverlayAutomationHistoryItem {
  id: number;
  type: string;
  severity: string;
  automationId: number | null;
  phone: string | null;
  eligible: boolean | null;
  reasons: string[];
  jobsCreated: number;
  actionsApplied: number;
  createdAt: string;
}

export async function applyOverlayQuickAction(input: {
  repos: Repositories;
  userId: number;
  phone: string | null;
  waJid?: string | null;
  action: OverlayQuickActionName;
  tagId?: number | null;
  status?: string | null;
  reminderTitle?: string | null;
  reminderDueAt?: string | null;
  reminderNotes?: string | null;
  source: string;
}) {
  const target = await resolveOverlayContact(input);
  if (!target.contact) {
    return blockedQuickAction(input.action, target.phone, "contact_not_found");
  }

  if (input.action === "applyTag" || input.action === "removeTag") {
    const tagId = positiveInteger(input.tagId);
    if (!tagId) {
      return blockedQuickAction(input.action, target.phone, "invalid_tag");
    }
    const tags = await input.repos.tags.list(input.userId);
    if (!tags.some((tag) => tag.id === tagId)) {
      return blockedQuickAction(input.action, target.phone, "tag_not_found");
    }
    const changed =
      input.action === "applyTag"
        ? await input.repos.contactTags.add({
            userId: input.userId,
            contactId: target.contact.id,
            tagId,
          })
        : await input.repos.contactTags.remove({
            userId: input.userId,
            contactId: target.contact.id,
            tagId,
          });
    const contact = await input.repos.contacts.findById(target.contact.id);
    if (changed) {
      await input.repos.systemEvents.create({
        userId: input.userId,
        type: input.action === "applyTag" ? "contact.tag_applied" : "contact.tag_removed",
        severity: "info",
        payload: JSON.stringify({
          contactId: target.contact.id,
          phone: target.phone,
          tagId,
          source: input.source,
          action: input.action,
        }),
      });
    }
    await auditQuickAction({
      repos: input.repos,
      userId: input.userId,
      action: input.action,
      source: input.source,
      phone: target.phone,
      contactId: target.contact.id,
      ok: true,
      changed,
      tagId,
    });
    return {
      ok: true,
      action: input.action,
      changed,
      contact,
      reminder: null,
      rejected: [],
    };
  }

  if (input.action === "setStatus") {
    const parsed = contactStatusSchema.safeParse(input.status);
    if (!parsed.success) {
      return blockedQuickAction(input.action, target.phone, "invalid_status");
    }
    const contact = await input.repos.contacts.update({
      id: target.contact.id,
      userId: input.userId,
      status: parsed.data,
    });
    await auditQuickAction({
      repos: input.repos,
      userId: input.userId,
      action: input.action,
      source: input.source,
      phone: target.phone,
      contactId: target.contact.id,
      ok: Boolean(contact),
      changed: Boolean(contact && contact.status !== target.contact.status),
      status: parsed.data,
    });
    return {
      ok: Boolean(contact),
      action: input.action,
      changed: Boolean(contact && contact.status !== target.contact.status),
      contact,
      reminder: null,
      rejected: contact ? [] : [{ reason: "contact_update_failed" }],
    };
  }

  const dueAt = parseReminderDueAt(input.reminderDueAt);
  if (!dueAt) {
    return blockedQuickAction(input.action, target.phone, "invalid_reminder_due_at");
  }
  const reminder = await input.repos.reminders.create({
    userId: input.userId,
    contactId: target.contact.id,
    conversationId: null,
    assignedToUserId: input.userId,
    title:
      stringValue(input.reminderTitle) ??
      `Retornar contato ${target.contact.name || target.phone || target.contact.id}`,
    notes: stringValue(input.reminderNotes),
    dueAt,
    status: "open",
  });
  await auditQuickAction({
    repos: input.repos,
    userId: input.userId,
    action: input.action,
    source: input.source,
    phone: target.phone,
    contactId: target.contact.id,
    ok: true,
    changed: true,
    reminderId: reminder.id,
  });
  return {
    ok: true,
    action: input.action,
    changed: true,
    contact: target.contact,
    reminder,
    rejected: [],
  };
}

export async function listOverlayAutomationHistory(input: {
  repos: Repositories;
  userId: number;
  phone: string | null;
  limit?: number;
}): Promise<OverlayAutomationHistoryItem[]> {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    return [];
  }
  const events = await input.repos.systemEvents.list({
    userId: input.userId,
    limit: Math.max(20, (input.limit ?? 5) * 6),
  });
  return events
    .filter((event) => {
      if (
        event.type !== "automation.overlay.dispatched" &&
        event.type !== "automation.overlay.blocked" &&
        event.type !== "automation.triggered"
      ) {
        return false;
      }
      const payload = event.payload as Record<string, unknown>;
      return normalizePhone(stringValue(payload.phone)) === phone;
    })
    .slice(0, input.limit ?? 5)
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return {
        id: event.id,
        type: event.type,
        severity: event.severity,
        automationId: positiveInteger(payload.automationId),
        phone: normalizePhone(stringValue(payload.phone)),
        eligible: typeof payload.eligible === "boolean" ? payload.eligible : null,
        reasons: Array.isArray(payload.reasons)
          ? payload.reasons.map((reason) => String(reason)).filter(Boolean)
          : [],
        jobsCreated: positiveInteger(payload.jobsCreated) ?? 0,
        actionsApplied: positiveInteger(payload.actionsApplied) ?? 0,
        createdAt: event.createdAt,
      };
    });
}

async function resolveOverlayContact(input: {
  repos: Repositories;
  userId: number;
  phone: string | null;
  waJid?: string | null;
}): Promise<{ contact: Contact | null; phone: string | null; waJid: string | null }> {
  const waJid = normalizeWaJid(input.waJid ?? input.phone);
  const phone = normalizePhone(input.phone) ?? normalizePhone(waJid);
  const contact =
    phone || waJid
      ? await input.repos.contacts.findByIdentity({
          userId: input.userId,
          phone,
          waJid,
        })
      : null;
  return { contact, phone, waJid };
}

function blockedQuickAction(action: OverlayQuickActionName, phone: string | null, reason: string) {
  return {
    ok: false,
    action,
    changed: false,
    contact: null,
    reminder: null,
    rejected: [{ source: "quick_action", value: phone ?? "", reason }],
  };
}

async function auditQuickAction(input: {
  repos: Repositories;
  userId: number;
  phone: string | null;
  contactId: number;
  action: OverlayQuickActionName;
  source: string;
  ok: boolean;
  changed: boolean;
  tagId?: number | null;
  status?: ContactStatus | null;
  reminderId?: number | null;
}): Promise<void> {
  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "extension.overlay.quick_action",
    severity: input.ok ? "info" : "warn",
    payload: JSON.stringify({
      action: input.action,
      source: input.source,
      phone: input.phone,
      contactId: input.contactId,
      tagId: input.tagId ?? null,
      status: input.status ?? null,
      reminderId: input.reminderId ?? null,
      changed: input.changed,
      ok: input.ok,
      appliedAtUtc: new Date().toISOString(),
    }),
  });
}

function parseReminderDueAt(value: string | null | undefined): string | null {
  const raw = stringValue(value);
  if (!raw) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
