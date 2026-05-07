import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const evidenceExtensions = new Set([".jpeg", ".jpg", ".json", ".md", ".png", ".webp"]);
const imageExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const maxDepth = 4;
const maxScannedFiles = 1_200;

export interface EvidenceAsset {
  name: string;
  relativePath: string;
  routePath: string;
  type: "image" | "json" | "markdown";
  sizeBytes: number;
  updatedAt: string;
}

export interface EvidenceGroup {
  id: string;
  title: string;
  category: "m303-proof" | "screen-smoke" | "single-proof" | "wpp-smoke";
  version: string | null;
  relativeDir: string;
  updatedAt: string;
  assets: EvidenceAsset[];
  cover: EvidenceAsset | null;
  report: EvidenceAsset | null;
  evidenceJson: EvidenceAsset | null;
  markdownPreview: string | null;
  summary: {
    totalAssets: number;
    images: number;
    reports: number;
    json: number;
  };
}

export interface EvidenceCenterResult {
  dataRoot: string;
  generatedAt: string;
  groups: EvidenceGroup[];
  summary: {
    groups: number;
    images: number;
    reports: number;
    json: number;
    latestAt: string | null;
  };
}

interface EvidenceFile {
  absolutePath: string;
  relativePath: string;
  relativeDir: string;
  name: string;
  extension: string;
  sizeBytes: number;
  updatedAt: string;
}

export async function listEvidenceCenter(input: { limit?: number } = {}): Promise<EvidenceCenterResult> {
  const dataRoot = await resolveEvidenceDataRoot();
  const files = await listEvidenceFiles(dataRoot);
  const groups = await buildEvidenceGroups(files, input.limit ?? 80);
  return {
    dataRoot,
    generatedAt: new Date().toISOString(),
    groups,
    summary: {
      groups: groups.length,
      images: groups.reduce((sum, group) => sum + group.summary.images, 0),
      reports: groups.reduce((sum, group) => sum + group.summary.reports, 0),
      json: groups.reduce((sum, group) => sum + group.summary.json, 0),
      latestAt: groups[0]?.updatedAt ?? null,
    },
  };
}

export async function resolveEvidenceDataRoot(): Promise<string> {
  const configuredRoot = process.env.NUOMA_EVIDENCE_DATA_ROOT?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), "data"),
    path.resolve(process.cwd(), "../..", "data"),
    path.resolve(moduleDir, "../../../../../data"),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
      // Try the next likely repo root.
    }
  }

  return path.join(process.cwd(), "data");
}

export function encodeEvidencePath(relativePath: string): string {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

export function decodeEvidencePath(encodedPath: string): string {
  return Buffer.from(encodedPath, "base64url").toString("utf8");
}

export async function resolveEvidenceFile(encodedPath: string): Promise<{
  absolutePath: string;
  contentType: string;
  relativePath: string;
  sizeBytes: number;
}> {
  const dataRoot = await resolveEvidenceDataRoot();
  const relativePath = decodeEvidencePath(encodedPath);
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("Invalid evidence path");
  }

  const extension = path.extname(relativePath).toLowerCase();
  if (!evidenceExtensions.has(extension)) {
    throw new Error("Unsupported evidence file");
  }

  const absolutePath = path.resolve(dataRoot, relativePath);
  const rootWithSeparator = `${path.resolve(dataRoot)}${path.sep}`;
  if (absolutePath !== path.resolve(dataRoot) && !absolutePath.startsWith(rootWithSeparator)) {
    throw new Error("Evidence path escaped data root");
  }

  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error("Evidence file not found");
  }

  return {
    absolutePath,
    contentType: contentTypeForExtension(extension),
    relativePath,
    sizeBytes: stats.size,
  };
}

async function listEvidenceFiles(dataRoot: string): Promise<EvidenceFile[]> {
  const files: EvidenceFile[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (files.length >= maxScannedFiles || depth > maxDepth) {
      return;
    }

    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxScannedFiles) {
        return;
      }
      if (entry.name.startsWith(".") || entry.name === "tmp") {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!evidenceExtensions.has(extension)) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      const relativePath = path.relative(dataRoot, absolutePath);
      files.push({
        absolutePath,
        relativePath,
        relativeDir: path.dirname(relativePath) === "." ? "" : path.dirname(relativePath),
        name: entry.name,
        extension,
        sizeBytes: stats.size,
        updatedAt: stats.mtime.toISOString(),
      });
    }
  }

  await walk(dataRoot, 0);
  return files.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

async function buildEvidenceGroups(files: EvidenceFile[], limit: number): Promise<EvidenceGroup[]> {
  const grouped = new Map<string, EvidenceFile[]>();
  for (const file of files) {
    const key = file.relativeDir || path.basename(file.name, file.extension);
    grouped.set(key, [...(grouped.get(key) ?? []), file]);
  }

  const groups = await Promise.all(
    [...grouped.entries()].map(async ([key, groupFiles]) => buildEvidenceGroup(key, groupFiles)),
  );

  return groups
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

async function buildEvidenceGroup(key: string, files: EvidenceFile[]): Promise<EvidenceGroup> {
  const assets = files
    .sort((a, b) => {
      const aRank = assetRank(a);
      const bRank = assetRank(b);
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name, "pt-BR");
    })
    .map(toEvidenceAsset);
  const report = assets.find((asset) => asset.name.toLowerCase() === "report.md") ?? null;
  const evidenceJson = assets.find((asset) => asset.name.toLowerCase() === "evidence.json") ?? null;
  const cover = assets.find((asset) => asset.type === "image") ?? null;
  const updatedAt = assets
    .map((asset) => asset.updatedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? new Date(0).toISOString();
  const markdownPreview = report
    ? await readMarkdownPreview(files.find((file) => file.relativePath === report.relativePath))
    : null;

  return {
    id: encodeEvidencePath(key),
    title: titleFromKey(key),
    category: categoryFromKey(key, assets),
    version: versionFromKey(key),
    relativeDir: key,
    updatedAt,
    assets,
    cover,
    report,
    evidenceJson,
    markdownPreview,
    summary: {
      totalAssets: assets.length,
      images: assets.filter((asset) => asset.type === "image").length,
      reports: report ? 1 : 0,
      json: assets.filter((asset) => asset.type === "json").length,
    },
  };
}

function toEvidenceAsset(file: EvidenceFile): EvidenceAsset {
  return {
    name: file.name,
    relativePath: file.relativePath,
    routePath: `/api/evidence/file?path=${encodeURIComponent(encodeEvidencePath(file.relativePath))}`,
    type:
      file.extension === ".md" ? "markdown" : file.extension === ".json" ? "json" : "image",
    sizeBytes: file.sizeBytes,
    updatedAt: file.updatedAt,
  };
}

async function readMarkdownPreview(file: EvidenceFile | undefined): Promise<string | null> {
  if (!file) {
    return null;
  }
  try {
    const markdown = await fs.readFile(file.absolutePath, "utf8");
    return markdown.trim().slice(0, 1_200) || null;
  } catch {
    return null;
  }
}

function assetRank(file: EvidenceFile): number {
  const name = file.name.toLowerCase();
  if (name === "report.md") return 0;
  if (name === "evidence.json") return 1;
  if (imageExtensions.has(file.extension)) return 2;
  return 3;
}

function categoryFromKey(
  key: string,
  assets: EvidenceAsset[],
): EvidenceGroup["category"] {
  const normalized = key.toLowerCase();
  if (normalized.includes("m303")) return "m303-proof";
  if (normalized.includes("wpp") || assets.some((asset) => asset.name.toLowerCase().includes("wpp"))) {
    return "wpp-smoke";
  }
  if (assets.some((asset) => asset.name.toLowerCase() === "report.md")) return "screen-smoke";
  return "single-proof";
}

function titleFromKey(key: string): string {
  const source = key || "data";
  return source
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function versionFromKey(key: string): string | null {
  const normalized = key.toLowerCase();
  const m303 = /\bm303\b/.exec(normalized);
  if (m303) return "M30.3";
  const mSub = /\bm(\d{2})(\d)\b/.exec(normalized);
  if (mSub) return `M${Number(mSub[1])}.${mSub[2]}`;
  const mPlain = /\bm(\d{1,2})\b/.exec(normalized);
  if (mPlain) return `M${Number(mPlain[1])}`;
  const v2 = /\bv2(?:-screen-smoke)?\b/.exec(normalized);
  if (v2) return "V2";
  const version = /\bv(\d{2,3})\b/.exec(normalized);
  if (!version) return null;
  const digits = version[1]!;
  if (digits.length === 2) return `V2.${Number(digits[1])}`;
  return `V2.${Number(digits.slice(1))}`;
}

function contentTypeForExtension(extension: string): string {
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "text/markdown; charset=utf-8";
}
