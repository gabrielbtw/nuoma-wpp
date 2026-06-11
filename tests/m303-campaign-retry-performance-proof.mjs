import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const userId = Number(process.env.M303_USER_ID ?? 1);
const expectedRounds = Number(process.env.M303_EXPECTED_ROUNDS ?? 3);
const maxDurationSeconds = Number(process.env.M303_MAX_DURATION_SECONDS ?? 120);
const requireMaxAttemptsOne = process.env.M303_REQUIRE_MAX_ATTEMPTS_ONE !== "false";
const requireNeferpeelBh = process.env.M303_REQUIRE_NEFERPEEL_BH !== "false";
const requireTemporaryMessages = process.env.M303_REQUIRE_TEMPORARY_MESSAGES !== "false";
const requireContactSessionReuse = process.env.M303_REQUIRE_CONTACT_SESSION_REUSE !== "false";
const phone = normalizePhone(process.env.M303_PHONE ?? process.env.SMOKE_PHONE ?? "5531982066263");
const campaignIds = parseIntegerList(process.env.M303_CAMPAIGN_IDS);
const campaignBatchIds = parseStringList(process.env.M303_CAMPAIGN_BATCH_IDS);

function main() {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("M303_USER_ID must be a positive integer");
  }
  if (!Number.isInteger(expectedRounds) || expectedRounds <= 0) {
    throw new Error("M303_EXPECTED_ROUNDS must be a positive integer");
  }
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new Error("M303_MAX_DURATION_SECONDS must be a positive number");
  }
  if (!phone) {
    throw new Error("M303_PHONE/SMOKE_PHONE must be a valid BR phone");
  }
  if (campaignIds.length > 0 && campaignBatchIds.length > 0) {
    throw new Error("Use M303_CAMPAIGN_IDS or M303_CAMPAIGN_BATCH_IDS, not both");
  }

  const scopes =
    campaignBatchIds.length > 0
      ? campaignBatchIds.map((id) => ({ kind: "batch", id }))
      : campaignIds.map((id) => ({ kind: "campaign", id }));

  if (scopes.length !== expectedRounds) {
    throw new Error(
      `expected ${expectedRounds} round scope(s), got ${scopes.length}; set M303_CAMPAIGN_IDS or M303_CAMPAIGN_BATCH_IDS`,
    );
  }
  assertDistinctScopes(scopes);

  const db = new Database(databaseUrl, { readonly: true });
  try {
    const reports = scopes.map((scope) => reportScope(db, scope));
    for (const report of reports) {
      assertReport(report);
    }
    const maxObservedDuration = Math.max(...reports.map((report) => report.durationSeconds));
    const totalSteps = reports.reduce((total, report) => total + report.jobs.length, 0);
    console.log(
      [
        "m303-campaign-retry-performance-proof",
        "status=passed",
        `rounds=${reports.length}`,
        `phone=${phone}`,
        `steps=${totalSteps}`,
        `maxDurationSeconds=${maxObservedDuration.toFixed(3)}`,
        `limitSeconds=${maxDurationSeconds}`,
        `requireMaxAttemptsOne=${String(requireMaxAttemptsOne)}`,
        `database=${databaseUrl}`,
      ].join("|"),
    );
    console.log(JSON.stringify({ phone, reports }, null, 2));
  } finally {
    db.close();
  }
}

function reportScope(db, scope) {
  const jobs = readJobs(db, scope).filter((job) => normalizePhone(job.payload.phone) === phone);
  const jobIds = new Set(jobs.map((job) => job.id));
  const events = readEvents(db, scope).filter((event) => jobIds.has(Number(event.payload.jobId)));
  const campaignIds = uniquePositiveIds(jobs.map((job) => Number(job.payload.campaignId)));
  const campaigns = requireNeferpeelBh ? readCampaigns(db, campaignIds) : [];
  const startedEvents = events.filter((event) => event.type === "sender.campaign_step.started");
  const completedEvents = events.filter((event) => event.type === "sender.campaign_step.completed");
  const failedEvents = events.filter((event) => event.type === "sender.campaign_step.failed");
  const completedEventsByJobId = new Map(
    completedEvents.map((event) => [Number(event.payload.jobId), event]),
  );
  const completedNavigation = jobs
    .map((job) => completedEventsByJobId.get(job.id))
    .filter(Boolean)
    .map((event) => ({
      id: event.id,
      jobId: Number(event.payload.jobId),
      stepId: event.payload.stepId ?? null,
      navigationMode: event.payload.navigationMode ?? null,
    }));
  const temporaryEvents = events.filter(
    (event) => event.type === "sender.temporary_messages.audit",
  );
  const beforeTemporaryProofs = temporaryEvents.filter(
    (event) =>
      event.payload.phase === "before_send" &&
      event.payload.executionMode === "whatsapp_real" &&
      event.payload.verified === true &&
      event.payload.verifiedDuration === "24h",
  );
  const restoreTemporaryProofs = temporaryEvents.filter(
    (event) =>
      event.payload.phase === "after_completion_restore" &&
      event.payload.executionMode === "whatsapp_real" &&
      event.payload.verified === true &&
      event.payload.verifiedDuration === "90d",
  );
  const failedTemporaryEvents = temporaryEvents.filter(
    (event) => event.payload.verified === false || event.severity === "warn",
  );
  const startedByJobId = new Set(startedEvents.map((event) => Number(event.payload.jobId)));
  const completedByJobId = new Set(completedEvents.map((event) => Number(event.payload.jobId)));
  const firstAt = minDate([
    ...startedEvents.map((event) => event.createdAt),
    ...jobs.map((job) => job.claimedAt ?? job.scheduledAt),
  ]);
  const lastAt = maxDate([
    ...completedEvents.map((event) => event.createdAt),
    ...jobs.map((job) => job.completedAt),
  ]);
  const durationSeconds =
    firstAt && lastAt ? Math.max(0, (Date.parse(lastAt) - Date.parse(firstAt)) / 1000) : NaN;

  return {
    scope,
    phone,
    durationSeconds,
    firstAt,
    lastAt,
    jobs,
    campaigns,
    batches: [...new Set(jobs.map((job) => job.payload.campaignBatchId).filter(Boolean))],
    startedEvents: startedEvents.length,
    completedEvents: completedEvents.length,
    failedEvents: failedEvents.length,
    completedNavigation,
    nonReusedFollowupNavigations: completedNavigation
      .slice(1)
      .filter((event) => event.navigationMode !== "reused-open-chat"),
    temporaryEvents: temporaryEvents.length,
    beforeTemporaryProofs,
    restoreTemporaryProofs,
    failedTemporaryEvents,
    missingStartedJobIds: jobs.map((job) => job.id).filter((jobId) => !startedByJobId.has(jobId)),
    missingCompletedJobIds: jobs
      .map((job) => job.id)
      .filter((jobId) => !completedByJobId.has(jobId)),
    nonCompletedJobs: jobs.filter((job) => job.status !== "completed"),
    retriedJobs: jobs.filter((job) => job.attempts !== 1),
    multiAttemptJobs: jobs.filter((job) => job.maxAttempts !== 1),
  };
}

function assertReport(report) {
  const scopeLabel = `${report.scope.kind}:${report.scope.id}`;
  if (report.jobs.length === 0) {
    throw new Error(`${scopeLabel} has no campaign_step jobs for phone ${phone}`);
  }
  if (requireNeferpeelBh) {
    const nonNeferpeelCampaigns = report.campaigns.filter(
      (campaign) => !isNeferpeelBhName(campaign.name),
    );
    if (report.campaigns.length === 0 || nonNeferpeelCampaigns.length > 0) {
      throw new Error(
        `${scopeLabel} is not scoped to Neferpeel BH campaign(s): ${
          report.campaigns.map((campaign) => `${campaign.id}:${campaign.name}`).join(", ") || "none"
        }`,
      );
    }
  }
  if (report.nonCompletedJobs.length > 0) {
    throw new Error(
      `${scopeLabel} has non-completed jobs: ${report.nonCompletedJobs
        .map((job) => `${job.id}:${job.status}:${job.lastError ?? "no_error"}`)
        .join(", ")}`,
    );
  }
  if (report.retriedJobs.length > 0) {
    throw new Error(
      `${scopeLabel} retried campaign_step job(s): ${report.retriedJobs
        .map((job) => `${job.id}:attempts=${job.attempts}`)
        .join(", ")}`,
    );
  }
  if (requireMaxAttemptsOne && report.multiAttemptJobs.length > 0) {
    throw new Error(
      `${scopeLabel} has campaign_step job(s) configured to retry: ${report.multiAttemptJobs
        .map((job) => `${job.id}:maxAttempts=${job.maxAttempts}`)
        .join(", ")}`,
    );
  }
  if (report.failedEvents > 0) {
    throw new Error(
      `${scopeLabel} has ${report.failedEvents} sender.campaign_step.failed event(s)`,
    );
  }
  if (requireContactSessionReuse && report.nonReusedFollowupNavigations.length > 0) {
    throw new Error(
      `${scopeLabel} did not reuse the open WhatsApp chat after the first step: ${report.nonReusedFollowupNavigations
        .map(
          (event) =>
            `${event.jobId}:${event.stepId ?? "unknown"}:${event.navigationMode ?? "missing"}`,
        )
        .join(", ")}`,
    );
  }
  if (requireTemporaryMessages) {
    if (report.beforeTemporaryProofs.length === 0) {
      throw new Error(
        `${scopeLabel} missing verified whatsapp_real temporary_messages before_send 24h proof`,
      );
    }
    if (report.restoreTemporaryProofs.length === 0) {
      throw new Error(
        `${scopeLabel} missing verified whatsapp_real temporary_messages after_completion_restore 90d proof`,
      );
    }
    const invalidProofs = report.beforeTemporaryProofs.filter((event) => {
      const screenshotPath = event.payload.visualProof?.screenshotPath;
      return !screenshotPath || !fs.existsSync(path.resolve(screenshotPath));
    });
    if (invalidProofs.length > 0) {
      throw new Error(
        `${scopeLabel} has temporary_messages 24h proof without readable screenshot: ${invalidProofs
          .map((event) => event.id)
          .join(",")}`,
      );
    }
    if (report.failedTemporaryEvents.length > 0) {
      throw new Error(
        `${scopeLabel} has failed temporary_messages audit event(s): ${report.failedTemporaryEvents
          .map(
            (event) =>
              `${event.id}:${event.payload.phase ?? "unknown"}:${event.payload.error ?? "unverified"}`,
          )
          .join(", ")}`,
      );
    }
  }
  if (report.missingStartedJobIds.length > 0) {
    throw new Error(
      `${scopeLabel} missing started events for jobs: ${report.missingStartedJobIds.join(",")}`,
    );
  }
  if (report.missingCompletedJobIds.length > 0) {
    throw new Error(
      `${scopeLabel} missing completed events for jobs: ${report.missingCompletedJobIds.join(",")}`,
    );
  }
  if (!Number.isFinite(report.durationSeconds)) {
    throw new Error(`${scopeLabel} does not have enough timestamps to calculate duration`);
  }
  if (report.durationSeconds > maxDurationSeconds) {
    throw new Error(
      `${scopeLabel} took ${report.durationSeconds.toFixed(3)}s, over ${maxDurationSeconds}s`,
    );
  }
}

function assertDistinctScopes(scopes) {
  const keys = scopes.map((scope) => `${scope.kind}:${scope.id}`);
  const unique = new Set(keys);
  if (unique.size !== keys.length) {
    throw new Error(`round scopes must be distinct; got ${keys.join(",")}`);
  }
}

function readJobs(db, scope) {
  const where =
    scope.kind === "batch"
      ? "json_extract(payload_json, '$.campaignBatchId') = ?"
      : "cast(json_extract(payload_json, '$.campaignId') as integer) = ?";
  return db
    .prepare(
      `SELECT id, status, attempts, max_attempts AS maxAttempts, scheduled_at AS scheduledAt,
              claimed_at AS claimedAt, completed_at AS completedAt, last_error AS lastError,
              payload_json AS payload
       FROM jobs
       WHERE user_id = ?
         AND type = 'campaign_step'
         AND ${where}
       ORDER BY id ASC`,
    )
    .all(userId, scope.id)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

function readEvents(db, scope) {
  const like =
    scope.kind === "batch"
      ? `%"campaignBatchId":"${escapeLike(scope.id)}"%`
      : `%"campaignId":${scope.id}%`;
  return db
    .prepare(
      `SELECT id, type, severity, payload_json AS payload, created_at AS createdAt
       FROM system_events
       WHERE user_id = ?
         AND type IN (
           'sender.campaign_step.started',
           'sender.campaign_step.completed',
           'sender.campaign_step.failed',
           'sender.temporary_messages.audit'
         )
         AND payload_json LIKE ? ESCAPE '\\'
       ORDER BY id ASC`,
    )
    .all(userId, like)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload) }))
    .filter((event) =>
      scope.kind === "batch"
        ? event.payload.campaignBatchId === scope.id
        : Number(event.payload.campaignId) === scope.id,
    );
}

function readCampaigns(db, campaignIds) {
  if (campaignIds.length === 0) return [];
  const placeholders = campaignIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, name, status, channel
       FROM campaigns
       WHERE user_id = ?
         AND id IN (${placeholders})
       ORDER BY id ASC`,
    )
    .all(userId, ...campaignIds);
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

function parseIntegerList(value) {
  return parseStringList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function parseStringList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePositiveIds(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function isNeferpeelBhName(value) {
  const normalized = String(value ?? "").toLocaleLowerCase("pt-BR");
  return normalized.includes("neferpeel") && normalized.includes("bh");
}

function minDate(values) {
  const valid = values.filter((value) => value && Number.isFinite(Date.parse(value))).sort();
  return valid[0] ?? null;
}

function maxDate(values) {
  const valid = values.filter((value) => value && Number.isFinite(Date.parse(value))).sort();
  return valid.at(-1) ?? null;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

main();
