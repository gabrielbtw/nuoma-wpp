import * as path from "node:path";

import { createRepositories, openDb } from "@nuoma/db";

const args = parseArgs(process.argv.slice(2));
const days = positiveNumber(args.get("days"), 90);
const apply = args.has("apply");
const json = args.has("json");
const now = parseDate(args.get("now") ?? new Date().toISOString(), "now");
const databasePath = resolveDatabasePath(
  args.get("db") ?? process.env.DATABASE_URL ?? path.resolve("data/nuoma-v2.db"),
);
const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

const handle = openDb(databasePath);
try {
  const repos = createRepositories(handle);
  const candidates = await repos.sendAuditEvents.countOlderThan({ occurredBefore: cutoff });
  let deleted = 0;
  const skipped: Array<{ reason: string }> = [];

  if (apply) {
    if (process.env.SEND_AUDIT_RETENTION_CONFIRM !== "SIM") {
      skipped.push({ reason: "missing_SEND_AUDIT_RETENTION_CONFIRM_SIM" });
    } else {
      deleted = await repos.sendAuditEvents.deleteOlderThan({ occurredBefore: cutoff });
    }
  }

  const report = {
    mode: apply ? "apply" : "audit",
    databasePath,
    generatedAtUtc: new Date().toISOString(),
    policy: {
      days,
      cutoff,
      confirmRequired: "SEND_AUDIT_RETENTION_CONFIRM=SIM",
    },
    candidates,
    deleted,
    skipped,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`send-audit-retention|mode=${report.mode}|db=${databasePath}`);
    console.log(
      `send-audit-retention|days=${days}|cutoff=${cutoff}|candidates=${candidates}|deleted=${deleted}`,
    );
    for (const item of skipped) {
      console.log(`send-audit-retention|skipped=${item.reason}`);
    }
  }

  if (apply && skipped.some((item) => item.reason === "missing_SEND_AUDIT_RETENTION_CONFIRM_SIM")) {
    process.exitCode = 2;
  }
} finally {
  handle.close();
}

function parseArgs(input: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (!arg.startsWith("--")) continue;
    const next = input[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(arg.slice(2), next);
      index += 1;
    } else {
      parsed.set(arg.slice(2), "true");
    }
  }
  return parsed;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, got ${value}`);
  }
  return parsed;
}

function parseDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label} date: ${value}`);
  }
  return parsed;
}

function resolveDatabasePath(value: string): string {
  if (value.startsWith("file:")) {
    return new URL(value).pathname;
  }
  return path.resolve(value);
}
