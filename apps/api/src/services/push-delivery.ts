import * as webPush from "web-push";

import type { ApiEnv } from "@nuoma/config";
import type { PushSubscriptionRecord, Repositories } from "@nuoma/db";

export interface PushDeliveryResult {
  configured: boolean;
  delivered: boolean;
  attempted: number;
  failed: number;
  staleDeleted: number;
  mode: "event-only" | "web-push";
  reason?: "vapid_not_configured" | "no_subscriptions";
}

export interface PushDeliveryService {
  sendTestPush(userId: number): Promise<PushDeliveryResult>;
}

export function createPushDeliveryService(input: {
  env: ApiEnv;
  repos: Repositories;
  sender?: typeof webPush.sendNotification;
}): PushDeliveryService {
  const sender = input.sender ?? webPush.sendNotification;

  return {
    async sendTestPush(userId) {
      const vapid = webPushVapid(input.env);
      if (!vapid) {
        return {
          configured: false,
          delivered: false,
          attempted: 0,
          failed: 0,
          staleDeleted: 0,
          mode: "event-only",
          reason: "vapid_not_configured",
        };
      }

      const subscriptions = await input.repos.pushSubscriptions.listByUser(userId);
      if (subscriptions.length === 0) {
        return {
          configured: true,
          delivered: false,
          attempted: 0,
          failed: 0,
          staleDeleted: 0,
          mode: "web-push",
          reason: "no_subscriptions",
        };
      }

      const payload = JSON.stringify({
        title: "Nuoma",
        body: "Teste de notificação",
        tag: "nuoma-push-test",
        timestamp: new Date().toISOString(),
      });
      let delivered = 0;
      let failed = 0;
      let staleDeleted = 0;

      for (const subscription of subscriptions) {
        try {
          await sender(toWebPushSubscription(subscription), payload, {
            vapidDetails: {
              subject: vapid.subject,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
            TTL: 60,
          });
          delivered += 1;
        } catch (error) {
          failed += 1;
          if (isStaleSubscriptionError(error)) {
            const deleted = await input.repos.pushSubscriptions.deleteByEndpoint({
              userId,
              endpoint: subscription.endpoint,
            });
            if (deleted) staleDeleted += 1;
          }
        }
      }

      return {
        configured: true,
        delivered: delivered > 0,
        attempted: subscriptions.length,
        failed,
        staleDeleted,
        mode: "web-push",
      };
    },
  };
}

function webPushVapid(env: ApiEnv):
  | { publicKey: string; privateKey: string; subject: string }
  | null {
  if (!env.API_WEB_PUSH_VAPID_PUBLIC_KEY || !env.API_WEB_PUSH_VAPID_PRIVATE_KEY) {
    return null;
  }
  return {
    publicKey: env.API_WEB_PUSH_VAPID_PUBLIC_KEY,
    privateKey: env.API_WEB_PUSH_VAPID_PRIVATE_KEY,
    subject: env.API_WEB_PUSH_VAPID_SUBJECT,
  };
}

function toWebPushSubscription(subscription: PushSubscriptionRecord): webPush.PushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
}

function isStaleSubscriptionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error.statusCode === 404 || error.statusCode === 410)
  );
}
