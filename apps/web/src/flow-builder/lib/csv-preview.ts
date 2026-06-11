export interface CsvPreviewRow {
  rowNumber: number;
  phone: string;
  name: string | null;
  email: string | null;
  valid: boolean;
  duplicate: boolean;
  errors: string[];
}

export interface CsvPreviewResult {
  headers: string[];
  phoneHeader: string | null;
  rows: CsvPreviewRow[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  errors: string[];
}

export function parseCsvPreview(text: string): CsvPreviewResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return emptyCsvPreview(["CSV vazio."]);
  }

  const delimiter = detectCsvDelimiter(lines[0] ?? "");
  const headers = parseCsvLine(lines[0] ?? "", delimiter).map((header) => header.trim());
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const phoneIndex = normalizedHeaders.findIndex((header) =>
    ["telefone", "phone", "whatsapp", "celular", "numero", "number"].includes(header),
  );
  const nameIndex = normalizedHeaders.findIndex((header) =>
    ["nome", "name", "contato", "contact"].includes(header),
  );
  const emailIndex = normalizedHeaders.findIndex((header) => ["email", "e-mail"].includes(header));
  const seenPhones = new Set<string>();
  const errors: string[] = [];

  if (phoneIndex === -1) {
    errors.push(
      "Coluna de telefone não encontrada. Use telefone, phone, whatsapp, celular ou numero.",
    );
  }

  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line, delimiter);
    const rowNumber = index + 2;
    const rawPhone = phoneIndex >= 0 ? (cells[phoneIndex] ?? "") : "";
    const phone = normalizeCsvPhone(rawPhone);
    const rowErrors: string[] = [];
    if (!phone) {
      rowErrors.push("telefone inválido");
    }
    const duplicate = Boolean(phone && seenPhones.has(phone));
    if (duplicate) {
      rowErrors.push("telefone duplicado");
    }
    if (phone && !duplicate) {
      seenPhones.add(phone);
    }
    return {
      rowNumber,
      phone: phone ?? rawPhone.trim(),
      name: nameIndex >= 0 ? cleanCsvCell(cells[nameIndex]) : null,
      email: emailIndex >= 0 ? cleanCsvCell(cells[emailIndex]) : null,
      valid: rowErrors.length === 0 && phoneIndex >= 0,
      duplicate,
      errors: rowErrors,
    };
  });

  const duplicateCount = rows.filter((row) => row.duplicate).length;
  const invalidCount = rows.filter((row) => !row.valid).length;
  const previewErrors = [
    ...errors,
    ...rows.flatMap((row) => row.errors.map((error) => `Linha ${row.rowNumber}: ${error}`)),
  ];

  return {
    headers,
    phoneHeader: phoneIndex >= 0 ? (headers[phoneIndex] ?? null) : null,
    rows,
    totalRows: rows.length,
    validCount: rows.length - invalidCount,
    invalidCount,
    duplicateCount,
    errors: previewErrors,
  };
}

function emptyCsvPreview(errors: string[]): CsvPreviewResult {
  return {
    headers: [],
    phoneHeader: null,
    rows: [],
    totalRows: 0,
    validCount: 0,
    invalidCount: 0,
    duplicateCount: 0,
    errors,
  };
}

function detectCsvDelimiter(header: string) {
  const commaCount = (header.match(/,/g) ?? []).length;
  const semicolonCount = (header.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }
    if (char === delimiter && !insideQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function cleanCsvCell(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function normalizeCsvHeader(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizeCsvPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}
