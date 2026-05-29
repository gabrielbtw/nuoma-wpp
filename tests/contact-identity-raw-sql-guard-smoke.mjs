import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["scripts", "tests"];
const allowedV1Fixtures = new Map([
  [
    "tests/v215-cutover-preflight-smoke.ts",
    "V1 fixture only; preflight does not write V2 contacts.",
  ],
]);

const rawContactInsertPattern = /\bINSERT\s+INTO\s+[`"]?contacts[`"]?\b/i;
const backfillPattern = /\bbackfillSmokeWhatsappIdentity\s*\(/;
const phoneE164Pattern = /\bphone_e164\b/i;
const waJidPattern = /\bwa_jid\b/i;

const files = await collectSourceFiles(scanRoots);
const contactInsertFiles = [];
const violations = [];

for (const relativePath of files) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = await fs.readFile(absolutePath, "utf8");
  if (!rawContactInsertPattern.test(source)) {
    continue;
  }

  contactInsertFiles.push(relativePath);
  const hasIdentityColumns = phoneE164Pattern.test(source) && waJidPattern.test(source);
  const hasBackfill = backfillPattern.test(source);
  const allowedReason = allowedV1Fixtures.get(relativePath);
  if (!hasIdentityColumns && !hasBackfill && !allowedReason) {
    violations.push(relativePath);
  }
}

if (violations.length > 0) {
  throw new Error(
    [
      "contact identity raw SQL guard failed:",
      ...violations.map(
        (file) =>
          `- ${file}: add phone_e164/wa_jid columns or call backfillSmokeWhatsappIdentity after INSERT INTO contacts`,
      ),
    ].join("\n"),
  );
}

console.log(
  [
    "contact-identity-raw-sql-guard",
    `scanned=${files.length}`,
    `contactInsertFiles=${contactInsertFiles.length}`,
    `allowedV1Fixtures=${allowedV1Fixtures.size}`,
    "status=ok",
  ].join("|"),
);

async function collectSourceFiles(roots) {
  const result = [];
  for (const root of roots) {
    await walk(path.join(repoRoot, root), root, result);
  }
  return result.sort();
}

async function walk(absoluteDir, relativeDir, result) {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      await walk(absolutePath, relativePath, result);
      continue;
    }
    if (!/\.(?:mjs|mts|js|ts)$/.test(entry.name)) {
      continue;
    }
    result.push(relativePath);
  }
}
