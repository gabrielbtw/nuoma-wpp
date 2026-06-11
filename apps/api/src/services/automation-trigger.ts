import {
  contactStatusSchema,
  normalizePhone,
  type Automation,
  type AutomationAction,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { segmentMatches } from "./segment-match.js";
import { evaluateApiRealSendTarget, parsePhoneList } from "./send-policy.js";

interface TriggerAutomationInput {
  repos: Repositories;
  userId: number;
  automationId: number;
  phone?: string | null;
  instagramHandle?: string | null;
  dryRun?: boolean;
  allowedPhone?: string;
  allowedPhones?: string[];
  sendPolicyMode?: "test" | "production";
  conversationId?: number | null;
  triggerType?: Automation["trigger"]["type"];
  triggerChannel?: "whatsapp" | "instagram" | "system";
  within24hWindow?: boolean;
  dedupeScope?: string;
  sourceMessageId?: number;
  depth?: number;
}

export interface TriggerAutomationResult {
  dryRun: boolean;
  automation: Automation | null;
  contactId: number | null;
  phone: string | null;
  instagramHandle: string | null;
  eligible: boolean;
  reasons: string[];
  plannedActions: AutomationAction[];
  jobsCreated: number;
  actionsApplied: number;
  skippedActions: Array<{ type: AutomationAction["type"]; reason: string }>;
  wouldEnqueueJobs: boolean;
}

export async function triggerAutomationForPhone(
  input: TriggerAutomationInput,
): Promise<TriggerAutomationResult> {
  const dryRun = input.dryRun ?? true;
  const phone = normalizePhone(input.phone);
  const instagramHandle = normalizeInstagramHandle(input.instagramHandle);
  const channel = input.triggerChannel ?? (instagramHandle && !phone ? "instagram" : "whatsapp");
  const targetKey = channel === "instagram" ? `ig:${instagramHandle ?? ""}` : (phone ?? "");
  const sendPolicyMode = input.sendPolicyMode ?? "test";
  const allowedPhones = parsePhoneList(null, [...(input.allowedPhones ?? []), input.allowedPhone]);
  const automation = await input.repos.automations.findById({
    userId: input.userId,
    id: input.automationId,
  });
  const base: TriggerAutomationResult = {
    dryRun,
    automation,
    contactId: null,
    phone,
    instagramHandle,
    eligible: false,
    reasons: [],
    plannedActions: [],
    jobsCreated: 0,
    actionsApplied: 0,
    skippedActions: [],
    wouldEnqueueJobs: false,
  };

  if (!automation) {
    return { ...base, reasons: ["not_found"] };
  }
  if (channel === "instagram" && !instagramHandle) {
    return { ...base, reasons: ["invalid_instagram"] };
  }
  if (channel !== "instagram" && !phone) {
    return { ...base, reasons: ["invalid_phone"] };
  }

  const contact =
    channel === "instagram" && instagramHandle
      ? await input.repos.contacts.findByIdentity({
          userId: input.userId,
          instagramHandle,
        })
      : phone
        ? await input.repos.contacts.findByPhone({ userId: input.userId, phone })
        : null;
  const reasons: string[] = [];
  if (automation.status !== "active") {
    reasons.push("status_not_active");
  }
  if (input.triggerType && automation.trigger.type !== input.triggerType) {
    reasons.push("trigger_type_mismatch");
  }
  if (automation.trigger.channel && automation.trigger.channel !== channel) {
    reasons.push("channel_mismatch");
  }
  if (automation.condition.requireWithin24hWindow && input.within24hWindow !== true) {
    reasons.push("outside_24h_window");
  }
  if (!segmentMatches(automation.condition.segment, contact, channel)) {
    reasons.push("segment_mismatch");
  }
  if (!dryRun && channel !== "instagram") {
    const decision = evaluateApiRealSendTarget(
      {
        mode: sendPolicyMode,
        allowedPhones,
      },
      phone ?? "",
    );
    if (!decision.allowed) {
      reasons.push(decision.reason);
    }
  }

  const plannedActions = automation.actions;
  if (reasons.length > 0) {
    return {
      ...base,
      contactId: contact?.id ?? null,
      eligible: false,
      reasons,
      plannedActions,
      wouldEnqueueJobs: false,
    };
  }

  const sendStepActions = plannedActions.filter((action) => action.type === "send_step");
  if (dryRun) {
    return {
      ...base,
      contactId: contact?.id ?? null,
      eligible: true,
      plannedActions,
      wouldEnqueueJobs: sendStepActions.length > 0,
    };
  }

  const now = new Date();
  let jobsCreated = 0;
  let actionsApplied = 0;
  let delayOffsetMs = 0;
  const skippedActions: TriggerAutomationResult["skippedActions"] = [];
  const conversation = input.conversationId
    ? await input.repos.conversations.findById({
        userId: input.userId,
        id: input.conversationId,
      })
    : await input.repos.conversations.upsertObserved({
        userId: input.userId,
        channel,
        externalThreadId: channel === "instagram" ? `ig:${instagramHandle}` : phone!,
        title: contact?.name ?? instagramHandle ?? phone!,
        contactId: contact?.id ?? null,
      });

  const maxActionHops = Math.max(plannedActions.length * 2, plannedActions.length + 3);
  let actionIndex = 0;
  let actionHops = 0;

  while (actionIndex < plannedActions.length) {
    if (actionHops >= maxActionHops) {
      skippedActions.push({ type: "branch", reason: "branch_loop_guard" });
      break;
    }
    actionHops += 1;
    const action = plannedActions[actionIndex]!;

    if (action.type === "delay") {
      delayOffsetMs += action.seconds * 1000;
      actionsApplied += 1;
      actionIndex += 1;
      continue;
    }

    if (action.type === "branch") {
      const branchMatches = segmentMatches(action.condition, contact, channel);
      if (!branchMatches) {
        skippedActions.push({ type: action.type, reason: "branch_condition_not_matched" });
        actionIndex += 1;
        continue;
      }

      actionsApplied += 1;
      if (action.targetActionId) {
        const targetIndex = plannedActions.findIndex(
          (candidate) => candidate.id === action.targetActionId,
        );
        if (targetIndex >= 0) {
          actionIndex = targetIndex;
          continue;
        }
        skippedActions.push({ type: action.type, reason: "branch_target_not_found" });
      }
      actionIndex += 1;
      continue;
    }

    if (action.type === "apply_tag") {
      if (!contact) {
        skippedActions.push({ type: action.type, reason: "contact_not_found" });
        actionIndex += 1;
        continue;
      }
      const changed = await input.repos.contactTags.add({
        userId: input.userId,
        contactId: contact.id,
        tagId: action.tagId,
      });
      if (changed) actionsApplied += 1;
      actionIndex += 1;
      continue;
    }

    if (action.type === "remove_tag") {
      if (!contact) {
        skippedActions.push({ type: action.type, reason: "contact_not_found" });
        actionIndex += 1;
        continue;
      }
      const changed = await input.repos.contactTags.remove({
        userId: input.userId,
        contactId: contact.id,
        tagId: action.tagId,
      });
      if (changed) actionsApplied += 1;
      actionIndex += 1;
      continue;
    }

    if (action.type === "set_status") {
      if (!contact) {
        skippedActions.push({ type: action.type, reason: "contact_not_found" });
        actionIndex += 1;
        continue;
      }
      const status = contactStatusSchema.safeParse(action.status);
      if (!status.success) {
        skippedActions.push({ type: action.type, reason: "invalid_contact_status" });
        actionIndex += 1;
        continue;
      }
      const changed = await input.repos.contacts.update({
        id: contact.id,
        userId: input.userId,
        status: status.data,
      });
      if (changed) actionsApplied += 1;
      actionIndex += 1;
      continue;
    }

    if (action.type === "create_reminder") {
      await input.repos.reminders.create({
        userId: input.userId,
        contactId: contact?.id ?? null,
        conversationId: conversation?.id ?? null,
        assignedToUserId: null,
        title: action.title,
        notes: null,
        dueAt: action.dueAt,
      });
      actionsApplied += 1;
      actionIndex += 1;
      continue;
    }

    if (action.type === "notify_attendant") {
      await input.repos.systemEvents.create({
        userId: input.userId,
        type: "automation.attendant_notify.planned",
        severity: "info",
        payload: JSON.stringify({
          automationId: automation.id,
          contactId: contact?.id ?? null,
          conversationId: conversation?.id ?? null,
          attendantId: action.attendantId ?? null,
          message: action.message,
          sourceMessageId: input.sourceMessageId ?? null,
        }),
      });
      actionsApplied += 1;
      actionIndex += 1;
      continue;
    }

    if (action.type === "trigger_automation") {
      if (action.automationId === automation.id || (input.depth ?? 0) >= 1) {
        skippedActions.push({ type: action.type, reason: "automation_trigger_guard" });
        actionIndex += 1;
        continue;
      }
      const triggered = await triggerAutomationForPhone({
        ...input,
        automationId: action.automationId,
        dryRun: false,
        depth: (input.depth ?? 0) + 1,
        dedupeScope: `${input.dedupeScope ?? now.toISOString()}:trigger:${action.automationId}`,
      });
      if (!triggered.eligible) {
        skippedActions.push({
          type: action.type,
          reason: triggered.reasons.join(",") || "child_automation_not_eligible",
        });
        continue;
      }
      jobsCreated += triggered.jobsCreated;
      actionsApplied += triggered.actionsApplied + 1;
      skippedActions.push(...triggered.skippedActions);
      actionIndex += 1;
      continue;
    }

    if (!conversation) {
      skippedActions.push({ type: action.type, reason: "conversation_not_found" });
      actionIndex += 1;
      continue;
    }

    const scheduledAt = new Date(
      now.getTime() + delayOffsetMs + action.step.delaySeconds * 1000,
    ).toISOString();
    const job = await input.repos.jobs.create({
      userId: input.userId,
      type: "campaign_step",
      status: "queued",
      payload: {
        automationId: automation.id,
        conversationId: conversation.id,
        contactId: contact?.id ?? null,
        phone,
        instagramHandle,
        step: action.step,
        variables: {
          nome: contact?.name ?? instagramHandle ?? phone,
          name: contact?.name ?? instagramHandle ?? phone,
          telefone: phone ?? "",
          phone: phone ?? "",
          instagram: instagramHandle ?? "",
          instagramHandle: instagramHandle ?? "",
        },
        isLastStep: true,
        sourceMessageId: input.sourceMessageId ?? null,
      },
      dedupeKey: `automation_trigger:${automation.id}:${targetKey}:${action.step.id}:${
        input.dedupeScope ?? now.toISOString()
      }`,
      scheduledAt,
      priority: 5,
      maxAttempts: 1,
    });
    if (job) {
      jobsCreated += 1;
    }
    actionIndex += 1;
  }

  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "automation.triggered",
    severity: "info",
    payload: JSON.stringify({
      automationId: automation.id,
      contactId: contact?.id ?? null,
      phone,
      instagramHandle,
      jobsCreated,
      actionsApplied,
      skippedActions,
      sourceMessageId: input.sourceMessageId ?? null,
    }),
  });

  return {
    ...base,
    contactId: contact?.id ?? null,
    instagramHandle,
    eligible: true,
    plannedActions,
    jobsCreated,
    actionsApplied,
    skippedActions,
    wouldEnqueueJobs: jobsCreated > 0,
  };
}

function normalizeInstagramHandle(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^ig:/i, "")
    .replace(/^@+/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}
