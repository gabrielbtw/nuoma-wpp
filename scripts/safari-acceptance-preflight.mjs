#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(
  repoRoot,
  String(
    args.output ??
      `output/safari-acceptance-preflight-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  ),
);
const requireProof = Boolean(args["require-proof"]);
const skipBuild = Boolean(args["skip-build"]);
const proofPath = args.proof
  ? path.resolve(repoRoot, String(args.proof))
  : process.env.SAFARI_ACCEPTANCE_PROOF_PATH;

const report = {
  mode: "safari-acceptance-preflight",
  generatedAtUtc: new Date().toISOString(),
  checks: [],
  blockers: [],
  warnings: [],
  nextActions: [],
};

const xcodeSelect = command("xcode-select", ["-p"]);
if (xcodeSelect.status === 0) {
  ok("xcode.select", { developerDir: xcodeSelect.stdout.trim() });
} else {
  blocker("xcode.select", sampleCommandError(xcodeSelect));
}

const converter = command("xcrun", ["--find", "safari-web-extension-converter"]);
const converterAvailable = converter.status === 0 && converter.stdout.trim().length > 0;
if (converterAvailable) {
  ok("safari.converter", { path: converter.stdout.trim() });
} else {
  blocker("safari.converter", sampleCommandError(converter));
}

if (skipBuild) {
  warning("safari.real_build", "Real Safari build skipped by --skip-build");
} else if (!converterAvailable) {
  blocker(
    "safari.real_build",
    "Real Safari build requires safari-web-extension-converter from full Xcode",
  );
} else {
  const build = command("npm", ["run", "build:safari-extension"]);
  if (build.status === 0) {
    ok("safari.real_build", { command: "npm run build:safari-extension" });
  } else {
    blocker("safari.real_build", sampleCommandError(build));
  }
}

await checkProof();

report.status = report.blockers.length === 0 ? "ready" : "blocked";
if (report.status === "blocked") {
  report.nextActions.push(
    "Instale/ative o Xcode completo, rode o build real, habilite a extensao no Safari e capture prova visual.",
  );
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  [
    "safari-acceptance-preflight",
    `status=${report.status}`,
    `blockers=${report.blockers.length}`,
    `warnings=${report.warnings.length}`,
    `output=${path.relative(repoRoot, outputPath)}`,
  ].join("|"),
);
for (const blockerItem of report.blockers) {
  console.log(`blocker|check=${blockerItem.check}|reason=${blockerItem.reason}`);
}
if (report.blockers.length > 0) {
  process.exitCode = 1;
}

async function checkProof() {
  if (!proofPath) {
    (requireProof ? blocker : warning)(
      "safari.acceptance_proof",
      "Set SAFARI_ACCEPTANCE_PROOF_PATH or --proof after enabling the extension in Safari",
    );
    return;
  }
  try {
    const stat = await fs.stat(proofPath);
    if (!stat.isFile()) {
      blocker("safari.acceptance_proof", "Proof path is not a file");
      return;
    }
    ok("safari.acceptance_proof", {
      path: path.relative(repoRoot, proofPath),
      sizeBytes: stat.size,
    });
  } catch (error) {
    blocker("safari.acceptance_proof", error instanceof Error ? error.message : String(error));
  }
}

function command(bin, commandArgs) {
  return spawnSync(bin, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function ok(check, details = {}) {
  report.checks.push({ check, status: "ok", ...details });
}

function blocker(check, reason) {
  report.checks.push({ check, status: "blocked", reason });
  report.blockers.push({ check, reason });
}

function warning(check, reason) {
  report.checks.push({ check, status: "warning", reason });
  report.warnings.push({ check, reason });
}

function sampleCommandError(result) {
  if (result.error) return result.error.message;
  return (
    [result.stderr, result.stdout].filter(Boolean).join("\n").trim().slice(0, 500) ||
    "command failed"
  );
}

function parseArgs(input) {
  const parsed = {};
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "require-proof" || key === "skip-build") {
      parsed[key] = true;
      continue;
    }
    parsed[key] = input[index + 1];
    index += 1;
  }
  return parsed;
}
