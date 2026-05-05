import { z } from "zod";

import { createPushDeliveryService } from "../../services/push-delivery.js";
import { protectedCsrfProcedure, router } from "../init.js";

const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const pushRouter = router({
  subscribe: protectedCsrfProcedure
    .input(pushSubscriptionInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.repos.pushSubscriptions.upsert({
        userId: ctx.user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { ok: true as const };
    }),

  unsubscribe: protectedCsrfProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.repos.pushSubscriptions.deleteByEndpoint({
        userId: ctx.user.id,
        endpoint: input.endpoint,
      });
      return { ok: true as const, deleted };
    }),

  test: protectedCsrfProcedure.mutation(async ({ ctx }) => {
    const result = await createPushDeliveryService({
      env: ctx.env,
      repos: ctx.repos,
    }).sendTestPush(ctx.user.id);
    await ctx.repos.systemEvents.create({
      userId: ctx.user.id,
      type: "push.test",
      severity: result.delivered ? "info" : result.configured ? "warn" : "info",
      payload: JSON.stringify(result),
    });
    return { ok: true as const, ...result };
  }),
});
