import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";
import { triggerAutomationForPhone } from "../../services/automation-trigger.js";
import { buildExtensionOverlaySnapshot } from "../../services/extension-overlay.js";
import { resolveApiSendPolicy } from "../../services/send-policy.js";

const phoneInputSchema = z.object({
  phone: z.string().min(8),
});

export const embedRouter = router({
  contactSummary: protectedProcedure.input(phoneInputSchema).query(async ({ ctx, input }) => {
    const sendPolicy = resolveApiSendPolicy(ctx.env);
    return buildExtensionOverlaySnapshot({
      repos: ctx.repos,
      userId: ctx.user.id,
      phone: input.phone,
      waJid: null,
      phoneSource: "embed.trpc",
      title: null,
      reason: "embed.contactSummary",
      sendPolicy,
    });
  }),

  eligibleAutomations: protectedProcedure.input(phoneInputSchema).query(async ({ ctx, input }) => {
    const contact = await ctx.repos.contacts.findByPhone({
      userId: ctx.user.id,
      phone: input.phone,
    });
    const automations = (await ctx.repos.automations.list(ctx.user.id)).filter(
      (automation) =>
        automation.status === "active" &&
        (!automation.trigger.channel || automation.trigger.channel === contact?.primaryChannel),
    );
    return { contactId: contact?.id ?? null, automations };
  }),

  addNote: protectedCsrfProcedure
    .input(
      phoneInputSchema.extend({
        body: z.string().min(1).max(5_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const contact = await ctx.repos.contacts.findByPhone({
        userId: ctx.user.id,
        phone: input.phone,
      });
      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
      }
      const timestamp = new Date().toISOString();
      const separator = contact.notes?.trim() ? "\n\n" : "";
      const updated = await ctx.repos.contacts.update({
        id: contact.id,
        userId: ctx.user.id,
        notes: `${contact.notes ?? ""}${separator}[${timestamp}] ${input.body}`,
      });
      return { contact: updated };
    }),

  dispatchAutomation: protectedCsrfProcedure
    .input(
      phoneInputSchema.extend({
        automationId: z.number().int().positive(),
        dryRun: z.boolean().default(true),
        allowedPhone: z.string().min(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sendPolicy = resolveApiSendPolicy(ctx.env, [input.allowedPhone]);
      return triggerAutomationForPhone({
        repos: ctx.repos,
        userId: ctx.user.id,
        automationId: input.automationId,
        phone: input.phone,
        dryRun: input.dryRun,
        allowedPhones: sendPolicy.allowedPhones,
        sendPolicyMode: sendPolicy.mode,
      });
    }),
});
