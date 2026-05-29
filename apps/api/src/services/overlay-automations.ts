import type { Automation } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import {
  triggerAutomationForPhone,
  type TriggerAutomationResult,
} from "./automation-trigger.js";
import {
  evaluateApiRealSendTarget,
  normalizePhone,
  type ApiSendPolicy,
} from "./send-policy.js";

export interface OverlayAutomationOption {
  id: number;
  name: string;
  category: string;
  status: Automation["status"];
  triggerChannel: Automation["trigger"]["channel"] | null;
  actionsCount: number;
  sendStepsCount: number;
  eligible: boolean;
  reasons: string[];
  wouldEnqueueJobs: boolean;
  canDispatchReal: boolean;
}

export interface OverlayAutomationRunResult {
  automation: {
    id: number;
    name: string;
    status: Automation["status"];
  } | null;
  phone: string | null;
  eligible: boolean;
  reasons: string[];
  jobsCreated: number;
  actionsApplied: number;
  plannedActions: number;
  skippedActions: TriggerAutomationResult["skippedActions"];
  wouldEnqueueJobs: boolean;
  rejected: Array<{ source: "phone"; value: string | number; reason: string }>;
}

export async function listOverlayAutomationOptions(input: {
  repos: Repositories;
  userId: number;
  phone: string | null;
  sendPolicy: ApiSendPolicy;
  within24hWindow?: boolean;
  limit?: number;
}): Promise<OverlayAutomationOption[]> {
  const phone = normalizePhone(input.phone);
  const automations = await input.repos.automations.list(input.userId);
  const evaluated = await Promise.all(
    automations
      .filter((automation) => {
        return (
          automation.status === "active" &&
          (!automation.trigger.channel || automation.trigger.channel === "whatsapp")
        );
      })
      .map(async (automation) => {
        const dryRun = await triggerAutomationForPhone({
          repos: input.repos,
          userId: input.userId,
          automationId: automation.id,
          phone,
          dryRun: true,
          allowedPhones: input.sendPolicy.allowedPhones,
          sendPolicyMode: input.sendPolicy.mode,
          triggerChannel: "whatsapp",
          within24hWindow: input.within24hWindow,
        });
        const sendDecision = phone
          ? evaluateApiRealSendTarget(input.sendPolicy, phone)
          : ({ allowed: false, reason: "invalid_phone" } as const);
        const reasons = [...dryRun.reasons];
        if (dryRun.eligible && !sendDecision.allowed) {
          reasons.push(sendDecision.reason);
        }
        const eligible = dryRun.eligible && sendDecision.allowed;
        return {
          id: automation.id,
          name: automation.name,
          category: automation.category,
          status: automation.status,
          triggerChannel: automation.trigger.channel ?? null,
          actionsCount: automation.actions.length,
          sendStepsCount: automation.actions.filter((action) => action.type === "send_step")
            .length,
          eligible,
          reasons,
          wouldEnqueueJobs: dryRun.wouldEnqueueJobs,
          canDispatchReal: eligible,
        } satisfies OverlayAutomationOption;
      }),
  );

  return evaluated
    .sort((a, b) => {
      const eligible = Number(b.eligible) - Number(a.eligible);
      if (eligible !== 0) return eligible;
      const jobs = Number(b.wouldEnqueueJobs) - Number(a.wouldEnqueueJobs);
      if (jobs !== 0) return jobs;
      return a.name.localeCompare(b.name, "pt-BR");
    })
    .slice(0, input.limit ?? 5);
}

export async function runOverlayAutomationNow(input: {
  repos: Repositories;
  userId: number;
  automationId: number;
  phone: string | null;
  sendPolicy: ApiSendPolicy;
  conversationId?: number | null;
  within24hWindow?: boolean;
  source: string;
  idempotencyKey?: string | null;
}): Promise<OverlayAutomationRunResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    return blockedRun(null, null, "invalid_phone");
  }

  const automation = await input.repos.automations.findById({
    userId: input.userId,
    id: input.automationId,
  });
  if (!automation) {
    return blockedRun(null, phone, "automation_not_found");
  }

  const replay = replayOverlayRun(automation, phone, input.idempotencyKey);
  if (replay) {
    return replay;
  }

  const triggered = await triggerAutomationForPhone({
    repos: input.repos,
    userId: input.userId,
    automationId: automation.id,
    phone,
    dryRun: false,
    allowedPhones: input.sendPolicy.allowedPhones,
    sendPolicyMode: input.sendPolicy.mode,
    conversationId: input.conversationId ?? null,
    triggerChannel: "whatsapp",
    within24hWindow: input.within24hWindow,
    dedupeScope: input.idempotencyKey ?? undefined,
  });
  const result = toOverlayRunResult(automation, triggered);

  await input.repos.systemEvents.create({
    userId: input.userId,
    type: triggered.eligible ? "automation.overlay.dispatched" : "automation.overlay.blocked",
    severity: triggered.eligible ? "info" : "warn",
    payload: JSON.stringify({
      automationId: automation.id,
      phone,
      source: input.source,
      idempotencyKey: input.idempotencyKey ?? null,
      eligible: triggered.eligible,
      reasons: triggered.reasons,
      jobsCreated: triggered.jobsCreated,
      actionsApplied: triggered.actionsApplied,
      dispatchedAtUtc: new Date().toISOString(),
    }),
  });

  await input.repos.automations.update({
    id: automation.id,
    userId: input.userId,
    metadata: {
      ...automation.metadata,
      lastOverlayRun: {
        at: new Date().toISOString(),
        phone,
        byUserId: input.userId,
        source: input.source,
        idempotencyKey: input.idempotencyKey ?? null,
        result: {
          eligible: result.eligible,
          reasons: result.reasons,
          jobsCreated: result.jobsCreated,
          actionsApplied: result.actionsApplied,
          plannedActions: result.plannedActions,
          wouldEnqueueJobs: result.wouldEnqueueJobs,
        },
      },
    },
  });

  return result;
}

export function isWithin24hWindow(lastMessageAt: string | null | undefined): boolean {
  if (!lastMessageAt) return false;
  const timestamp = new Date(lastMessageAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

function toOverlayRunResult(
  automation: Automation,
  result: TriggerAutomationResult,
): OverlayAutomationRunResult {
  return {
    automation: {
      id: automation.id,
      name: automation.name,
      status: automation.status,
    },
    phone: result.phone,
    eligible: result.eligible,
    reasons: result.reasons,
    jobsCreated: result.jobsCreated,
    actionsApplied: result.actionsApplied,
    plannedActions: result.plannedActions.length,
    skippedActions: result.skippedActions,
    wouldEnqueueJobs: result.wouldEnqueueJobs,
    rejected: result.eligible
      ? []
      : result.reasons.map((reason) => ({ source: "phone", value: result.phone ?? "", reason })),
  };
}

function replayOverlayRun(
  automation: Automation,
  phone: string,
  idempotencyKey: string | null | undefined,
): OverlayAutomationRunResult | null {
  if (!idempotencyKey) {
    return null;
  }
  const lastRun = objectRecord(automation.metadata.lastOverlayRun);
  if (lastRun.idempotencyKey !== idempotencyKey || lastRun.phone !== phone) {
    return null;
  }
  const previousResult = objectRecord(lastRun.result);
  const reasons = stringArray(previousResult.reasons);
  const eligible = booleanFromUnknown(previousResult.eligible) ?? reasons.length === 0;
  return {
    automation: {
      id: automation.id,
      name: automation.name,
      status: automation.status,
    },
    phone,
    eligible,
    reasons,
    jobsCreated: numberFromUnknown(previousResult.jobsCreated) ?? 0,
    actionsApplied: numberFromUnknown(previousResult.actionsApplied) ?? 0,
    plannedActions: numberFromUnknown(previousResult.plannedActions) ?? 0,
    skippedActions: [],
    wouldEnqueueJobs: booleanFromUnknown(previousResult.wouldEnqueueJobs) ?? false,
    rejected: eligible
      ? []
      : reasons.map((reason) => ({ source: "phone", value: phone, reason })),
  };
}

function blockedRun(
  automation: Automation | null,
  phone: string | null,
  reason: string,
): OverlayAutomationRunResult {
  return {
    automation: automation
      ? {
          id: automation.id,
          name: automation.name,
          status: automation.status,
        }
      : null,
    phone,
    eligible: false,
    reasons: [reason],
    jobsCreated: 0,
    actionsApplied: 0,
    plannedActions: 0,
    skippedActions: [],
    wouldEnqueueJobs: false,
    rejected: [{ source: "phone", value: phone ?? "", reason }],
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanFromUnknown(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
