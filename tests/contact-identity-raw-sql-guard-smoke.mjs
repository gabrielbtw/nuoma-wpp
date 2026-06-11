import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["packages/db/src", "scripts", "tests"];
const allowedRawSqlFixtures = new Map([
  [
    "packages/db/src/contact-identity-backfill.test.ts",
    "DB trigger test intentionally omits identity columns to prove automatic backfill.",
  ],
  [
    "packages/db/src/repositories.test.ts",
    "Repository test intentionally omits identity columns to prove raw SQL backfill.",
  ],
  [
    "tests/v215-cutover-preflight-smoke.ts",
    "V1 fixture only; preflight does not write V2 contacts.",
  ],
  [
    "tests/v215-cutover-apply-smoke.ts",
    "V1 fixture only; cutover apply must prove V2 phone_e164/wa_jid after migration.",
  ],
  [
    "tests/contact-identity-raw-sql-guard-smoke.mjs",
    "Guard owns the violation message text; it is not a DB write fixture.",
  ],
]);

const rawContactInsertPattern = /\bINSERT\s+INTO\s+[`"]?contacts[`"]?\b/gi;
const rawConversationInsertPattern = /\bINSERT\s+INTO\s+[`"]?conversations[`"]?\b/gi;
const backfillPattern = /\bbackfillSmokeWhatsappIdentity\s*\(/;
const phoneE164Pattern = /\bphone_e164\b/i;
const waJidPattern = /\bwa_jid\b/i;

const files = await collectSourceFiles(scanRoots);
const contactInsertFiles = [];
const conversationInsertFiles = [];
const violations = [];

for (const relativePath of files) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = await fs.readFile(absolutePath, "utf8");
  const contactInsertStatements = extractRawContactInsertStatements(source);
  const conversationInsertStatements = extractRawConversationInsertStatements(source);
  if (contactInsertStatements.length === 0 && conversationInsertStatements.length === 0) {
    continue;
  }

  if (contactInsertStatements.length > 0) {
    contactInsertFiles.push(relativePath);
  }
  if (conversationInsertStatements.length > 0) {
    conversationInsertFiles.push(relativePath);
  }
  const hasBackfill = backfillPattern.test(source);
  const allowedReason = allowedRawSqlFixtures.get(relativePath);
  const everyInsertHasIdentityColumns = contactInsertStatements.every(
    (statement) => phoneE164Pattern.test(statement) && waJidPattern.test(statement),
  );
  const everyConversationInsertHasWaJid = conversationInsertStatements.every((statement) =>
    waJidPattern.test(statement),
  );
  const contactIdentityViolation =
    contactInsertStatements.length > 0 && !everyInsertHasIdentityColumns && !hasBackfill;
  const conversationIdentityViolation =
    conversationInsertStatements.length > 0 && !everyConversationInsertHasWaJid && !hasBackfill;
  if ((contactIdentityViolation || conversationIdentityViolation) && !allowedReason) {
    violations.push({
      path: relativePath,
      contactIdentityViolation,
      conversationIdentityViolation,
    });
  }
}

if (violations.length > 0) {
  throw new Error(
    [
      "contact identity raw SQL guard failed:",
      ...violations.map((violation) => {
        const fixes = [];
        if (violation.contactIdentityViolation) {
          fixes.push("add phone_e164/wa_jid columns or call backfillSmokeWhatsappIdentity after INSERT INTO contacts");
        }
        if (violation.conversationIdentityViolation) {
          fixes.push("add wa_jid or call backfillSmokeWhatsappIdentity after INSERT INTO conversations");
        }
        return `- ${violation.path}: ${fixes.join("; ")}`;
      }),
    ].join("\n"),
  );
}

console.log(
  [
    "contact-identity-raw-sql-guard",
    `scanned=${files.length}`,
    `contactInsertFiles=${contactInsertFiles.length}`,
    `conversationInsertFiles=${conversationInsertFiles.length}`,
    `allowedRawSqlFixtures=${allowedRawSqlFixtures.size}`,
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

function extractRawContactInsertStatements(source) {
  return extractRawInsertStatements(source, rawContactInsertPattern);
}

function extractRawConversationInsertStatements(source) {
  return extractRawInsertStatements(source, rawConversationInsertPattern);
}

function extractRawInsertStatements(source, pattern) {
  const statements = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const runIndex = source.indexOf(").run", start);
    const end = runIndex > start ? runIndex : start + 1_200;
    statements.push(source.slice(start, Math.min(source.length, end)));
  }
  return statements;
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
