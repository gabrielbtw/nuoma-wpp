import { z } from "zod";

import {
  createContactInputSchema,
  importContactsInputSchema,
  searchContactsInputSchema,
  updateContactInputSchema,
  type ImportContactRow,
} from "@nuoma/contracts";

import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createContactBodySchema = createContactInputSchema.omit({ userId: true });
const updateContactBodySchema = updateContactInputSchema.omit({ userId: true });
const searchContactsBodySchema = searchContactsInputSchema.omit({ userId: true });

type ParsedContactRow = ImportContactRow & { sourceRow: number };

const csvHeaderAliases = {
  email: ["email", "e-mail", "mail"],
  instagramHandle: ["instagram", "instagramHandle", "instagram_handle", "ig"],
  name: ["name", "nome", "contato", "cliente"],
  notes: ["notes", "nota", "notas", "observacao", "observacaoes", "observações"],
  phone: ["phone", "telefone", "celular", "whatsapp", "wpp"],
  primaryChannel: ["primaryChannel", "primary_channel", "canal"],
  status: ["status", "situacao"],
} as const;

function normalizePhone(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase() ?? "";
  return value || null;
}

function normalizeInstagram(handle: string | null | undefined): string | null {
  const value = handle?.trim().replace(/^@/, "") ?? "";
  return value || null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function findCsvCell(
  row: Record<string, string>,
  field: keyof typeof csvHeaderAliases,
): string | undefined {
  for (const alias of csvHeaderAliases[field]) {
    const value = row[alias.toLowerCase()];
    if (value !== undefined && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function parseContactsCsv(csv: string): Array<ParsedContactRow | { error: string; sourceRow: number }> {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const headers = parseCsvLine(lines[0]!).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line, index) => {
    const sourceRow = index + 2;
    const cells = parseCsvLine(line);
    const raw = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const name = findCsvCell(raw, "name");
    if (!name) {
      return { sourceRow, error: "missing_name" };
    }
    return {
      sourceRow,
      name,
      phone: normalizePhone(findCsvCell(raw, "phone")),
      email: normalizeEmail(findCsvCell(raw, "email")),
      instagramHandle: normalizeInstagram(findCsvCell(raw, "instagramHandle")),
      primaryChannel: (findCsvCell(raw, "primaryChannel") as ParsedContactRow["primaryChannel"]) ?? "whatsapp",
      status: (findCsvCell(raw, "status") as ParsedContactRow["status"]) ?? "lead",
      notes: findCsvCell(raw, "notes") ?? null,
    };
  });
}

function normalizeImportRows(rows: ImportContactRow[]): ParsedContactRow[] {
  return rows.map((row, index) => ({
    ...row,
    sourceRow: index + 1,
    phone: normalizePhone(row.phone),
    email: normalizeEmail(row.email),
    instagramHandle: normalizeInstagram(row.instagramHandle),
    notes: row.notes ?? null,
  }));
}

export const contactsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(500).optional(),
          includeDeleted: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const contacts = await ctx.repos.contacts.list({
        userId: ctx.user.id,
        cursor: input?.cursor,
        limit: input?.limit,
        includeDeleted: input?.includeDeleted,
      });
      return { contacts };
    }),

  search: protectedProcedure.input(searchContactsBodySchema).query(async ({ ctx, input }) => {
    const contacts = await ctx.repos.contacts.search({
      userId: ctx.user.id,
      query: input.query,
      limit: input.limit,
      includeDeleted: input.includeDeleted,
    });
    return { contacts };
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const contact = await ctx.repos.contacts.findById(input.id);
      if (!contact || contact.userId !== ctx.user.id) {
        return { contact: null };
      }
      return { contact };
    }),

  create: protectedCsrfProcedure
    .input(createContactBodySchema)
    .mutation(async ({ ctx, input }) => {
      const contact = await ctx.repos.contacts.create({
        ...input,
        userId: ctx.user.id,
      });
      return { contact };
    }),

  update: protectedCsrfProcedure
    .input(updateContactBodySchema)
    .mutation(async ({ ctx, input }) => {
      const contact = await ctx.repos.contacts.update({
        ...input,
        userId: ctx.user.id,
      });
      return { contact };
    }),

  import: protectedCsrfProcedure
    .input(importContactsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const csvRows = input.csv ? parseContactsCsv(input.csv) : [];
      const normalizedRows = input.rows ? normalizeImportRows(input.rows) : [];
      const rows = [...csvRows, ...normalizedRows];
      const errors: Array<{ row: number; reason: string }> = [];
      const contacts = [];
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let duplicates = 0;

      for (const row of rows) {
        if ("error" in row) {
          errors.push({ row: row.sourceRow, reason: row.error });
          skipped += 1;
          continue;
        }

        const parsed = createContactBodySchema.safeParse(row);
        if (!parsed.success) {
          errors.push({ row: row.sourceRow, reason: "invalid_row" });
          skipped += 1;
          continue;
        }

        const existing = await ctx.repos.contacts.findByIdentity({
          userId: ctx.user.id,
          phone: parsed.data.phone ?? null,
          email: parsed.data.email ?? null,
          instagramHandle: parsed.data.instagramHandle ?? null,
        });

        if (existing) {
          duplicates += 1;
          if (input.duplicateMode === "update_existing") {
            if (!input.dryRun) {
              const updatedContact = await ctx.repos.contacts.update({
                id: existing.id,
                userId: ctx.user.id,
                name: parsed.data.name,
                phone: parsed.data.phone ?? existing.phone,
                email: parsed.data.email ?? existing.email,
                primaryChannel: parsed.data.primaryChannel,
                instagramHandle: parsed.data.instagramHandle ?? existing.instagramHandle,
                status: parsed.data.status,
                notes: parsed.data.notes ?? existing.notes,
              });
              if (updatedContact) contacts.push(updatedContact);
            }
            updated += 1;
          } else {
            skipped += 1;
          }
          continue;
        }

        if (!parsed.data.phone && !parsed.data.email && !parsed.data.instagramHandle) {
          errors.push({ row: row.sourceRow, reason: "missing_identity" });
          skipped += 1;
          continue;
        }

        if (!input.dryRun) {
          contacts.push(
            await ctx.repos.contacts.create({
              ...parsed.data,
              userId: ctx.user.id,
            }),
          );
        }
        created += 1;
      }

      return {
        dryRun: input.dryRun,
        created,
        updated,
        skipped,
        duplicates,
        errors,
        contacts,
      };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.repos.contacts.softDelete(input.id, ctx.user.id);
      return { ok };
    }),
});
