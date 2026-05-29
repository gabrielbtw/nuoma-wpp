#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const files = {
  packageJson: await read("package.json"),
  campaignsRouter: await read("apps/api/src/trpc/routers/campaigns.ts"),
  overlayCampaigns: await read("apps/api/src/services/overlay-campaigns.ts"),
  sendPolicy: await read("apps/api/src/services/send-policy.ts"),
  sendPolicyTest: await read("apps/api/src/services/send-policy.test.ts"),
  appTest: await read("apps/api/src/app.test.ts"),
  contactsPage: await read("apps/web/src/pages/ContactsPage.tsx"),
  shellLayout: await read("apps/web/src/shell/ShellLayout.tsx"),
  sidebar: await read("apps/web/src/shell/Sidebar.tsx"),
  overlayInject: await read("apps/worker/src/features/overlay/inject.ts"),
  safariPreflight: await read("scripts/safari-acceptance-preflight.mjs"),
  goLivePreflight: await read("scripts/go-live-canary-preflight.mjs"),
  goLiveCanaryRun: await read("scripts/go-live-hosted-canary.mjs"),
  hostedEnvExample: await read(".env.hosted.example"),
  artifactRetention: await read("scripts/artifact-retention.mjs"),
};

const checks = [];

check("campaigns.execute blocks non-WhatsApp real dispatch", () => {
  includes(
    files.campaignsRouter,
    'campaign.channel !== "whatsapp"',
    "campaigns.execute must keep the real button flow WhatsApp-only",
  );
  includes(
    files.campaignsRouter,
    "Execução real por botão está liberada apenas para WhatsApp.",
    "campaigns.execute should expose an explicit channel blocker",
  );
});

check("campaigns.execute requires M30.3 before real WhatsApp enqueue", () => {
  matches(
    files.campaignsRouter,
    /campaignTemporaryMessagesGateIssue\(\s*campaign,\s*"Execução real",?\s*\)/,
    "campaigns.execute must call the M30.3 temporary-message gate",
  );
  includes(
    files.appTest,
    "expect(campaignExecuteWithoutM303.statusCode).toBe(400)",
    "API regression test must prove execution without M30.3 is blocked",
  );
  includes(
    files.appTest,
    'expect(campaignExecuteWithoutM303.error?.message).toContain("temporaryMessages M30.3")',
    "API regression test must assert the M30.3 blocker message",
  );
});

check("overlay campaign execution requires M30.3 and mutation guard", () => {
  includes(
    files.overlayCampaigns,
    "campaignTemporaryMessagesGateIssue(input.campaign)",
    "overlay campaign service must evaluate the M30.3 gate",
  );
  includes(
    files.overlayCampaigns,
    "temporary_messages_audit_only",
    "overlay campaign service must report the missing-M30.3 reason",
  );
  includes(
    files.appTest,
    "mutation_guard_required",
    "overlay bridge test must keep mutation guard coverage",
  );
});

check("request allowedPhone cannot bypass production canary policy", () => {
  includes(
    files.sendPolicy,
    'env.API_SEND_POLICY_MODE === "test" ? extraAllowedPhones : []',
    "API send policy must ignore request-level allowedPhone overrides in production",
  );
  includes(
    files.sendPolicyTest,
    "production_without_canary_allowlist",
    "send policy tests must assert empty production allowlist failure",
  );
  includes(
    files.appTest,
    'allowedPhone: "5531982066263"',
    "API app test must exercise request-level allowedPhone in production",
  );
});

check("artifact retention is scripted and audited by default", () => {
  includes(
    files.packageJson,
    '"artifacts:retention:audit"',
    "package.json must expose artifact retention audit",
  );
  includes(
    files.packageJson,
    '"test:artifact-retention"',
    "package.json must expose artifact retention smoke",
  );
  includes(
    files.artifactRetention,
    'confirmRequired: "ARTIFACT_RETENTION_CONFIRM=SIM"',
    "retention apply must require explicit confirmation",
  );
  const audit = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts/artifact-retention.mjs"),
      "--json",
      "--tmp-days",
      "999999",
      "--backup-days",
      "999999",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert(audit.status === 0, audit.stderr || audit.stdout);
  const report = JSON.parse(audit.stdout);
  assert(report.mode === "audit", "artifact retention must default to audit mode");
});

check("go-live and Safari acceptance gates are explicit external gates", () => {
  includes(
    files.packageJson,
    '"go-live:canary:preflight"',
    "package.json must expose go-live canary preflight",
  );
  includes(
    files.packageJson,
    '"go-live:canary:run"',
    "package.json must expose hosted canary runner",
  );
  includes(
    files.goLivePreflight,
    "GO_LIVE_HOSTED_PROOF_PATH",
    "go-live preflight must model hosted proof as an explicit gate",
  );
  includes(
    files.goLiveCanaryRun,
    "ENVIAR CANARIO",
    "hosted canary runner must require explicit send confirmation",
  );
  includes(
    files.goLiveCanaryRun,
    "sender.campaign_step.completed",
    "hosted canary runner must verify campaign-step completion evidence",
  );
  includes(
    files.goLiveCanaryRun,
    "Canary recipient still has active/non-final status",
    "hosted canary runner must reject active recipient residue",
  );
  includes(
    files.hostedEnvExample,
    "GO_LIVE_CAMPAIGN_ID=",
    "hosted env example must document canary campaign id",
  );
  includes(
    files.hostedEnvExample,
    "GO_LIVE_HOSTED_PROOF_PATH=",
    "hosted env example must document hosted proof path",
  );
  includes(
    files.goLivePreflight,
    "isCanonicalBrazilianPhone",
    "go-live preflight must reject weak canary phone formats",
  );
  includes(
    files.goLivePreflight,
    "loadEnvConfig",
    "go-live preflight must load env files for hosted/local gates",
  );
  includes(
    files.packageJson,
    '"test:go-live-preflight"',
    "package.json must expose go-live preflight smoke",
  );
  includes(
    files.packageJson,
    '"safari:acceptance:gate"',
    "package.json must expose a Safari acceptance gate",
  );
  includes(
    files.safariPreflight,
    "safari-web-extension-converter",
    "Safari preflight must require the real converter",
  );
});

check("empty contact UI no longer advertises placeholder actions", () => {
  notIncludes(
    files.contactsPage,
    "em breve",
    "contacts page should not show placeholder coming-soon copy",
  );
  notIncludes(
    files.overlayInject,
    "em breve",
    "overlay empty-contact actions should be real actions, not placeholders",
  );
  includes(
    files.overlayInject,
    "Sincronizar conversa",
    "overlay empty-contact state should provide a sync action",
  );
  includes(
    files.overlayInject,
    "Copiar telefone",
    "overlay empty-contact state should provide a copy action",
  );
});

check("shell runtime badges use real metrics instead of fixed online copy", () => {
  includes(
    files.shellLayout,
    "trpc.system.metrics.useQuery",
    "shell topbar should read runtime metrics",
  );
  includes(
    files.shellLayout,
    "runtimeStatusFromMetrics",
    "shell topbar should derive labels from metrics state",
  );
  includes(
    files.sidebar,
    "workspaceStatusFor(runtimeStatus)",
    "sidebar workspace badge should derive from runtime metrics",
  );
});

console.log(`product-confidence-smoke|status=ok|checks=${checks.length}`);

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function check(name, fn) {
  fn();
  checks.push(name);
}

function includes(haystack, needle, message) {
  assert(haystack.includes(needle), `${message}: missing ${JSON.stringify(needle)}`);
}

function notIncludes(haystack, needle, message) {
  assert(!haystack.includes(needle), `${message}: found ${JSON.stringify(needle)}`);
}

function matches(haystack, pattern, message) {
  assert(pattern.test(haystack), `${message}: missing ${String(pattern)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
