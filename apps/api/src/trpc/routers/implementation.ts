import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { protectedProcedure, router } from "../init.js";

type ImplementationStatus = "done" | "partial" | "pending";

interface ImplementationItem {
  id: string | null;
  title: string;
  description: string | null;
  section: string;
  status: ImplementationStatus;
}

export const implementationRouter = router({
  status: protectedProcedure.query(async () => {
    const markdownPath = await findImplementationMarkdown();
    const markdown = await fs.readFile(markdownPath, "utf8");
    const items = parseImplementationMarkdown(markdown);
    const summary = {
      done: items.filter((item) => item.status === "done").length,
      partial: items.filter((item) => item.status === "partial").length,
      pending: items.filter((item) => item.status === "pending").length,
    };

    return {
      markdown,
      markdownPath,
      items,
      summary,
      updatedAt: new Date().toISOString(),
    };
  }),
});

async function findImplementationMarkdown(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(moduleDir, "../../../../../"),
  ];

  for (const candidate of candidates) {
    const markdownPath = path.join(candidate, "docs", "IMPLEMENTATION_STATUS.md");
    try {
      await fs.access(markdownPath);
      return markdownPath;
    } catch {
      // Try the next likely repo root.
    }
  }

  return path.join(process.cwd(), "docs", "IMPLEMENTATION_STATUS.md");
}

function parseImplementationMarkdown(markdown: string): ImplementationItem[] {
  const items: ImplementationItem[] = [];
  let section = "Geral";

  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(rawLine);
    if (heading) {
      section = heading[1]?.trim() || section;
      continue;
    }

    const checkbox = /^-\s+\[(x|~| )\]\s+(.+)$/.exec(rawLine);
    if (!checkbox) {
      continue;
    }

    const status = statusFromMarker(checkbox[1] ?? " ");
    const parsed = parseItemText(checkbox[2] ?? "");
    items.push({
      ...parsed,
      section,
      status,
    });
  }

  return items;
}

function statusFromMarker(marker: string): ImplementationStatus {
  if (marker.toLowerCase() === "x") {
    return "done";
  }
  if (marker === "~") {
    return "partial";
  }
  return "pending";
}

function parseItemText(text: string): Pick<ImplementationItem, "id" | "title" | "description"> {
  const normalized = text.trim();
  const bold = /^\*\*(.+?)\*\*\s*(?:—\s*(.+))?$/.exec(normalized);
  const title = (bold?.[1] ?? normalized).trim();
  const id = /^([A-Z]+[0-9. -]+(?:\[[^\]]+\])?)/.exec(title)?.[1]?.trim() ?? null;

  return {
    id,
    title,
    description: bold?.[2]?.trim() ?? null,
  };
}
