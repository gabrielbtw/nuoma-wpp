/**
 * Import contacts from multiple CSV files into Nuoma.
 *
 * - Parses 7 CSV files (Google Contacts exports, Trinks, phone lists)
 * - Normalizes Brazilian phone numbers
 * - Deduplicates by normalized phone (keeps longest name)
 * - Skips contacts that already exist in the database
 *
 * Usage:  npx tsx scripts/import-contacts.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createContact,
  getContactByPhone,
  getDb,
  normalizeBrazilianPhone,
  looksLikeValidWhatsAppCandidate,
} from "@nuoma/core";

// ---------------------------------------------------------------------------
// CSV parsing (simple, no external deps)
// ---------------------------------------------------------------------------

function parseCsv(filePath: string): Array<Record<string, string>> {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RawContact {
  name: string;
  phone: string;
}

function looksLikePhoneNumber(name: string): boolean {
  const cleaned = name.replace(/[\s()\-+.]/g, "");
  return /^\d{6,}$/.test(cleaned);
}

/**
 * Pre-normalize phone strings before passing to normalizeBrazilianPhone.
 * Handles:
 * - Multiple numbers separated by ":::" or " / " → splits into array
 * - Leading zero in DDD: (021) → (21), 031 → 31
 * - International prefix 0055 → 55
 */
function preNormalizePhones(raw: string): string[] {
  // Split by ::: or /
  const parts = raw.split(/\s*(?::::|\/)\s*/).map((p) => p.trim()).filter(Boolean);

  return parts.map((part) => {
    let cleaned = part;

    // Remove leading + for processing, add back later
    const hasPlus = cleaned.startsWith("+");
    if (hasPlus) cleaned = cleaned.slice(1);

    // Strip all non-digits
    let digits = cleaned.replace(/\D/g, "");

    // 0055... → 55...
    if (digits.startsWith("0055")) {
      digits = digits.slice(2);
    }
    // 00XX (international with 00 prefix, not Brazil) → skip by returning original
    else if (digits.startsWith("00")) {
      return part;
    }
    // 0DD (leading zero in DDD): 02199... → 2199..., 03198... → 3198...
    else if (digits.startsWith("0") && digits.length >= 11) {
      digits = digits.slice(1);
    }

    return digits;
  });
}

function titleCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (char) => char.toUpperCase());
}

// ---------------------------------------------------------------------------
// Parsers per CSV type
// ---------------------------------------------------------------------------

function parseGoogleContacts(filePath: string): RawContact[] {
  const rows = parseCsv(filePath);
  const contacts: RawContact[] = [];

  for (const row of rows) {
    const nameParts = [
      row["First Name"] ?? "",
      row["Middle Name"] ?? "",
      row["Last Name"] ?? "",
    ]
      .map((p) => p.trim())
      .filter(Boolean);

    const name = nameParts.join(" ");

    // Skip if name looks like a phone number
    if (!name || looksLikePhoneNumber(name)) continue;

    // Collect all phone columns
    const phones = [
      row["Phone 1 - Value"],
      row["Phone 2 - Value"],
      row["Phone 3 - Value"],
    ].filter(Boolean);

    for (const phone of phones) {
      if (phone) {
        contacts.push({ name, phone });
      }
    }
  }

  return contacts;
}

function parseTelefoneNumeros(filePath: string): RawContact[] {
  const rows = parseCsv(filePath);
  const contacts: RawContact[] = [];

  for (const row of rows) {
    const phone = row["Tefone Tratado"] || row["Telefone"] || "";
    if (!phone || phone === "9") continue;
    contacts.push({ name: "", phone });
  }

  return contacts;
}

function parseTrinks(filePath: string): RawContact[] {
  const rows = parseCsv(filePath);
  const contacts: RawContact[] = [];

  for (const row of rows) {
    const name = row["Cliente"] ?? "";
    let phone = row["Telefone"] ?? "";

    // Some rows have "phone1 / phone2" — take first
    if (phone.includes("/")) {
      phone = phone.split("/")[0].trim();
    }

    if (!phone) continue;
    contacts.push({ name: name.trim(), phone });
  }

  return contacts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const DOWNLOADS = resolve(process.env.HOME ?? "~", "Downloads");

const CSV_FILES: Array<{ path: string; parser: (p: string) => RawContact[] }> = [
  { path: resolve(DOWNLOADS, "contacts.csv"), parser: parseGoogleContacts },
  { path: resolve(DOWNLOADS, "contacts-2.csv"), parser: parseGoogleContacts },
  { path: resolve(DOWNLOADS, "Telefone - Números-2.csv"), parser: parseTelefoneNumeros },
  { path: resolve(DOWNLOADS, "Telefone - Realizados.csv"), parser: parseTrinks },
  { path: resolve(DOWNLOADS, "Telefone - Trinks Agendados.csv"), parser: parseTrinks },
  { path: resolve(DOWNLOADS, "Telefone - Trinks Cancelados.csv"), parser: parseTrinks },
  { path: resolve(DOWNLOADS, "Telefone - Trinks Faltaram.csv"), parser: parseTrinks },
];

// Step 1: Parse all CSVs
console.log("Parsing CSV files...\n");
let totalParsed = 0;
const allRaw: RawContact[] = [];

for (const { path, parser } of CSV_FILES) {
  const contacts = parser(path);
  const fileName = path.split("/").pop();
  console.log(`  ${fileName}: ${contacts.length} registros`);
  totalParsed += contacts.length;
  allRaw.push(...contacts);
}
console.log(`\nTotal parsed: ${totalParsed}`);

// Step 2: Normalize phones and deduplicate
const deduped = new Map<string, { name: string; normalizedPhone: string }>();
let invalidPhones = 0;

for (const raw of allRaw) {
  const phoneCandidates = preNormalizePhones(raw.phone);
  let anyValid = false;

  for (const candidate of phoneCandidates) {
    const normalized = normalizeBrazilianPhone(candidate);
    if (!normalized || normalized.length < 12 || normalized.length > 13) {
      continue;
    }

    anyValid = true;
    const existing = deduped.get(normalized);
    const cleanName = raw.name ? titleCase(raw.name.trim()) : "";

    if (!existing || cleanName.length > existing.name.length) {
      deduped.set(normalized, { name: cleanName, normalizedPhone: normalized });
    }
  }

  if (!anyValid) {
    invalidPhones++;
  }
}

console.log(`Invalid phones skipped: ${invalidPhones}`);
console.log(`Unique contacts after dedup: ${deduped.size}`);

// Step 3: Initialize DB and import
console.log("\nInitializing database...");
getDb(); // triggers DB init + migrations

let created = 0;
let alreadyExists = 0;
let errors = 0;

console.log("Importing contacts...\n");

for (const [normalizedPhone, { name }] of deduped) {
  try {
    const existing = getContactByPhone(normalizedPhone);
    if (existing) {
      alreadyExists++;
      continue;
    }

    createContact({
      name: name || "",
      phone: normalizedPhone,
      status: "novo",
      procedureStatus: "unknown",
      tags: [],
    });
    created++;

    if (created % 500 === 0) {
      console.log(`  ... ${created} criados`);
    }
  } catch (err) {
    errors++;
    if (errors <= 5) {
      console.error(`  Erro ao criar contato ${normalizedPhone}:`, err);
    }
  }
}

console.log(`\n--- Resultado ---`);
console.log(`Total parsed:     ${totalParsed}`);
console.log(`Telefones inválidos: ${invalidPhones}`);
console.log(`Duplicatas removidas: ${totalParsed - invalidPhones - deduped.size}`);
console.log(`Já existiam no DB:   ${alreadyExists}`);
console.log(`Criados:             ${created}`);
console.log(`Erros:               ${errors}`);
