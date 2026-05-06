/**
 * @nuoma/config — Runtime env validation, single source of truth.
 *
 * Each app imports the slice it needs (apiEnv, workerEnv, webEnv) so a
 * mis-configured worker doesn't crash the api startup.
 */
import { z } from "zod";

const booleanFromEnv = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", "yes", "no"])])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    return value === "true" || value === "1" || value === "yes";
  });

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TZ: z.string().default("America/Sao_Paulo"),
});

const apiSchema = baseSchema.extend({
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  API_JWT_SECRET: z
    .string()
    .min(16, "API_JWT_SECRET must be at least 16 chars")
    .default("dev-only-change-me-local"),
  API_JWT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  API_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  API_CAMPAIGN_SCHEDULER_ENABLED: booleanFromEnv.default(false),
  API_CAMPAIGN_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),
  API_CAMPAIGN_SCHEDULER_USER_ID: z.coerce.number().int().positive().default(1),
  API_SEND_POLICY_MODE: z.enum(["test", "production"]).default("test"),
  API_SEND_ALLOWED_PHONES: z.string().default(""),
  API_AUTOMATION_ENGINE_ENABLED: booleanFromEnv.default(false),
  API_AUTOMATION_ENGINE_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  API_AUTOMATION_ENGINE_USER_ID: z.coerce.number().int().positive().default(1),
  API_AUTOMATION_ENGINE_ALLOWED_PHONE: z.string().default("5531982066263"),
  API_WEB_PUSH_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  API_WEB_PUSH_VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  API_WEB_PUSH_VAPID_SUBJECT: z.string().min(1).default("mailto:admin@nuoma.local"),
  API_CRM_STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  API_CRM_STORAGE_NAMESPACE: z.string().min(1).default("/nuoma/files/crm"),
  API_CRM_STORAGE_LOCAL_ROOT: z.string().min(1).optional(),
  API_CRM_STORAGE_CACHE_ROOT: z.string().min(1).optional(),
  API_CRM_STORAGE_S3_BUCKET: z.string().min(1).optional(),
  API_CRM_STORAGE_S3_REGION: z.string().min(1).default("us-east-1"),
  API_CRM_STORAGE_S3_ENDPOINT: z.string().url().optional(),
  API_CRM_STORAGE_S3_FORCE_PATH_STYLE: booleanFromEnv.default(false),
  API_CRM_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  API_CRM_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  API_CRM_STORAGE_S3_SESSION_TOKEN: z.string().min(1).optional(),
  API_STREAMING_ENABLED: booleanFromEnv.default(false),
  API_STREAMING_CDP_HOST: z.string().default("127.0.0.1"),
  API_STREAMING_CDP_PORT: z.coerce.number().int().min(1).max(65535).default(9223),
  API_STREAMING_TARGET_URL_MATCH: z.string().min(1).default("web.whatsapp.com"),
  API_STREAMING_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  DATABASE_URL: z.string().default("../../data/nuoma-v2.db"),
});

const workerSchema = baseSchema.extend({
  WORKER_HEADLESS: booleanFromEnv.default(false),
  WORKER_BROWSER_ENABLED: booleanFromEnv.default(false),
  WORKER_BROWSER_ATTACH_EXISTING: booleanFromEnv.default(true),
  WORKER_KEEP_BROWSER_OPEN: booleanFromEnv.default(true),
  WORKER_SYNC_ENABLED: booleanFromEnv.default(false),
  WORKER_SYNC_RECONCILE_MS: z.coerce.number().int().min(0).default(60_000),
  WORKER_SYNC_MULTI_CHAT_ENABLED: booleanFromEnv.default(false),
  WORKER_SYNC_MULTI_CHAT_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  WORKER_SYNC_MULTI_CHAT_DELAY_MS: z.coerce.number().int().min(250).default(1_200),
  WORKER_SEND_REUSE_OPEN_CHAT_ENABLED: booleanFromEnv.default(false),
  WORKER_SEND_CONFIRMATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  WORKER_SEND_STRICT_DELIVERY: booleanFromEnv.default(true),
  WA_SEND_POLICY_MODE: z.enum(["test", "production"]).default("test"),
  WA_SEND_ALLOWED_PHONES: z.string().default(""),
  WA_SEND_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  WA_SEND_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(12),
  WORKER_JOB_LOOP_ENABLED: booleanFromEnv.default(true),
  WORKER_ID: z.string().min(1).default("worker-local-1"),
  WORKER_POLL_MS: z.coerce.number().int().min(250).default(1000),
  WORKER_HEARTBEAT_SEC: z.coerce.number().int().positive().default(20),
  WORKER_MAX_RSS_MB: z.coerce.number().int().positive().default(1200),
  WORKER_TEMP_DIR: z.string().default("../../data/tmp"),
  CHROMIUM_PROFILE_DIR: z.string().default("../../data/chromium-profile/whatsapp"),
  CHROMIUM_CDP_HOST: z.string().default("127.0.0.1"),
  CHROMIUM_CDP_BIND_HOST: z.string().optional(),
  CHROMIUM_CDP_PORT: z.coerce.number().int().min(1).max(65535).default(9223),
  WA_WEB_URL: z.string().url().default("https://web.whatsapp.com/"),
  WA_INBOX_TARGET_PHONE: z.string().optional(),
  WA_SEND_ALLOWED_PHONE: z.string().optional(),
  DATABASE_URL: z.string().default("../../data/nuoma-v2.db"),
});

const webSchema = baseSchema.extend({
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  VITE_API_URL: z.string().url().default("http://127.0.0.1:3001"),
  VITE_WEB_PUSH_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
});

export type ApiEnv = z.infer<typeof apiSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;
export type WebEnv = z.infer<typeof webSchema>;

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const result = apiSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid API env: ${result.error.toString()}`);
  }
  return result.data;
}

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid Worker env: ${result.error.toString()}`);
  }
  return result.data;
}

export function loadWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = webSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid Web env: ${result.error.toString()}`);
  }
  return result.data;
}

/**
 * Constants — keep in sync with V1 conventions when possible.
 */
export const CONSTANTS = {
  appVersion: "0.1.0",
  apiServiceName: "nuoma-wpp-v2-api",
  workerServiceName: "nuoma-wpp-v2-worker",
  webServiceName: "nuoma-wpp-v2-web",
  defaultUserId: 1,
} as const;
