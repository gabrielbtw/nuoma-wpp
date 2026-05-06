import Database from "better-sqlite3";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const requiredBeforeProofPath = process.env.M303_REQUIRED_BEFORE_PROOF_PATH
  ? path.resolve(process.env.M303_REQUIRED_BEFORE_PROOF_PATH)
  : null;
const campaignIdInput = process.env.M303_CAMPAIGN_ID;

async function main() {
  if (process.env.M303_CONFIRM_NEFERPEEL_REAL !== "SIM") {
    throw new Error(
      "M303 real smoke blocked: set M303_CONFIRM_NEFERPEEL_REAL=SIM and M303_CAMPAIGN_ID=<id> after starting the Neferpeel real run",
    );
  }
  const campaignId = readCampaignId();
  const report = readCampaignReport(campaignId);
  assertM303Report(report);
  await assertBeforeSendVisualProof(report);
  console.log(
    [
      "m303-neferpeel-temporary-context",
      `campaign=${campaignId}`,
      `beforeVerified=${report.beforeVerified}`,
      `restoreVerified=${report.restoreVerified}`,
      `completed=${report.completedSteps}`,
      `failed=${report.failedSteps}`,
      `activeJobs=${report.activeJobs}`,
      `outsideAllowlist=${report.completedOutsideAllowlist}`,
      `wppBefore=${report.beforeVisualProofPath}`,
      "ig=nao_aplicavel",
    ].join("|"),
  );
}

function readCampaignId() {
  const campaignId = Number(campaignIdInput);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    throw new Error("M303 real smoke requires M303_CAMPAIGN_ID=<positive campaign id>");
  }
  return campaignId;
}

function readCampaignReport(campaignId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const events = db
      .prepare(
        `SELECT id, type, severity, payload_json AS payload, created_at AS createdAt
         FROM system_events
         WHERE user_id = 1
           AND payload_json LIKE ?
           AND type IN (
             'sender.temporary_messages.audit',
             'sender.campaign_step.completed',
             'sender.campaign_step.failed'
           )
         ORDER BY id ASC`,
      )
      .all(`%"campaignId":${campaignId}%`)
      .map((row) => ({
        ...row,
        payload: JSON.parse(row.payload),
      }));
    const activeJobs = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE user_id = 1
           AND type = 'campaign_step'
           AND status IN ('queued', 'claimed', 'running')
           AND payload_json LIKE ?`,
      )
      .get(`%"campaignId":${campaignId}%`).count;
    const allowedPhones = new Set(
      String(process.env.WA_SEND_ALLOWED_PHONE ?? "")
        .split(",")
        .map((phone) => phone.replace(/\D/g, ""))
        .filter(Boolean),
    );
    const beforeProofEvent = events.findLast(
      (event) =>
        event.type === "sender.temporary_messages.audit" &&
        event.payload.phase === "before_send" &&
        event.payload.executionMode === "whatsapp_real" &&
        event.payload.verified === true &&
        event.payload.verifiedDuration === "24h" &&
        event.payload.visualProof?.screenshotPath &&
        (!requiredBeforeProofPath ||
          path.resolve(event.payload.visualProof.screenshotPath) === requiredBeforeProofPath),
    );
    const cutoffEventId = beforeProofEvent?.id ?? 0;
    const scopedEvents = events.filter((event) => event.id >= cutoffEventId);
    const completedEvents = scopedEvents.filter((event) => event.type === "sender.campaign_step.completed");
    return {
      campaignId,
      events: scopedEvents,
      beforeVerified: scopedEvents.some(
        (event) =>
          event.type === "sender.temporary_messages.audit" &&
          event.payload.phase === "before_send" &&
          event.payload.executionMode === "whatsapp_real" &&
          event.payload.verified === true &&
          event.payload.verifiedDuration === "24h",
      ),
      restoreVerified: scopedEvents.some(
        (event) =>
          event.type === "sender.temporary_messages.audit" &&
          event.payload.phase === "after_completion_restore" &&
          event.payload.executionMode === "whatsapp_real" &&
          event.payload.verified === true &&
          event.payload.verifiedDuration === "90d",
      ),
      completedSteps: completedEvents.length,
      failedSteps: scopedEvents.filter((event) => event.type === "sender.campaign_step.failed").length,
      activeJobs,
      beforeVisualProofPath: beforeProofEvent?.payload.visualProof?.screenshotPath ?? null,
      beforeVisualProofText: beforeProofEvent?.payload.visualProof?.textEvidence ?? "",
      completedOutsideAllowlist:
        allowedPhones.size === 0
          ? 0
          : completedEvents.filter((event) => {
              const phone = String(event.payload.phone ?? "").replace(/\D/g, "");
              return phone && !allowedPhones.has(phone);
            }).length,
    };
  } finally {
    db.close();
  }
}

function assertM303Report(report) {
  if (!report.beforeVerified) {
    throw new Error("M303 failed: missing verified whatsapp_real before_send 24h event");
  }
  if (!report.beforeVisualProofPath) {
    throw new Error("M303 failed: missing before-send WhatsApp visual proof screenshot");
  }
  if (!report.restoreVerified) {
    throw new Error("M303 failed: missing verified whatsapp_real restore event");
  }
  if (report.completedSteps <= 0) {
    throw new Error("M303 failed: no completed campaign steps found");
  }
  if (report.failedSteps > 0) {
    throw new Error(`M303 failed: campaign has ${report.failedSteps} failed step event(s)`);
  }
  if (report.activeJobs > 0) {
    throw new Error(`M303 failed: campaign still has ${report.activeJobs} active campaign_step job(s)`);
  }
  if (report.completedOutsideAllowlist > 0) {
    throw new Error(
      `M303 failed: ${report.completedOutsideAllowlist} completed step(s) outside WA_SEND_ALLOWED_PHONE`,
    );
  }
}

async function assertBeforeSendVisualProof(report) {
  const proofPath = path.resolve(report.beforeVisualProofPath);
  const stat = await fs.stat(proofPath).catch(() => null);
  if (!stat || stat.size <= 0) {
    throw new Error(`M303 failed: before-send visual proof screenshot not found: ${proofPath}`);
  }
}

main().catch((error) => {
  console.error(
    `m303-neferpeel-temporary-context|failed|ig=nao_aplicavel|error=${error.message}`,
  );
  process.exitCode = 1;
});
