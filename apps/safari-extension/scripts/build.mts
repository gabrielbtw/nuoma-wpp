import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  createSafariConverterPlan,
  formatSafariConverterUnavailableMessage,
  isSafariConverterUnavailable,
  safariBuildSummaryFilename,
  safariExtensionVersion,
} from "../src/build-plan.js";

const execFileAsync = promisify(execFile);
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "../..");
const chromeDistDir = path.join(repoRoot, "apps/chrome-extension/dist");
const distDir = path.join(packageDir, "dist");
const webExtensionDir = path.join(distDir, "web-extension");
const summaryPath = path.join(distDir, safariBuildSummaryFilename);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const allowMissingConverter = process.argv.includes("--allow-missing-converter");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

await execFileAsync(npmBin, ["run", "build:chrome-extension"], {
  cwd: repoRoot,
  env: process.env,
});

await fs.cp(chromeDistDir, webExtensionDir, { recursive: true });

const manifestPath = path.join(webExtensionDir, "manifest.json");
const pageBridgePath = path.join(webExtensionDir, "page-bridge.js");
const manifest = await readManifest(manifestPath);
await assertFile(path.join(webExtensionDir, "background.js"));
await assertFile(path.join(webExtensionDir, "content.js"));
await assertFile(pageBridgePath);
await assertFile(path.join(webExtensionDir, "popup.html"));

const plan = createSafariConverterPlan({
  converterBin: process.env.SAFARI_WEB_EXTENSION_CONVERTER_BIN,
  sourceDir: webExtensionDir,
  outputDir: distDir,
});

try {
  await execFileAsync(plan.command, plan.args, {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
  });
} catch (error) {
  if (isSafariConverterUnavailable(error)) {
    if (allowMissingConverter) {
      const blocker = formatSafariConverterUnavailableMessage(plan, error);
      await writeSummary({
        status: "blocked_converter_unavailable",
        manifest,
        pageBridgePath,
        plan,
        xcodeProjectPath: null,
        blocker,
      });
      console.warn(blocker);
      console.log(
        [
          "m39-safari-extension",
          `webExtension=${path.relative(repoRoot, webExtensionDir)}`,
          "xcodeProject=blocked",
          "manifest=ok",
          "overlay=ok",
          "status=blocked_converter_unavailable",
        ].join("|"),
      );
      process.exit(0);
    }
    throw new Error(formatSafariConverterUnavailableMessage(plan, error));
  }
  throw error;
}

const xcodeProjectPath = await findXcodeProject(distDir);
if (!xcodeProjectPath) {
  throw new Error("M39 Safari Extension Companion falhou: projeto .xcodeproj nao foi gerado.");
}

await writeSummary({
  status: "built",
  manifest,
  pageBridgePath,
  plan,
  xcodeProjectPath,
  blocker: null,
});

console.log(
  [
    "m39-safari-extension",
    `webExtension=${path.relative(repoRoot, webExtensionDir)}`,
    `xcodeProject=${path.relative(repoRoot, xcodeProjectPath)}`,
    "manifest=ok",
    "overlay=ok",
    "status=built",
  ].join("|"),
);

interface SafariManifest {
  manifest_version: number;
  name: string;
  version: string;
  content_scripts: Array<{ matches: string[]; js: string[] }>;
}

async function readManifest(filePath: string): Promise<SafariManifest> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("manifest.json invalido: raiz nao e objeto");
  }
  if (parsed.manifest_version !== 3) {
    throw new Error("manifest.json invalido: manifest_version precisa ser 3");
  }
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error("manifest.json invalido: name/version ausentes");
  }
  if (!Array.isArray(parsed.content_scripts)) {
    throw new Error("manifest.json invalido: content_scripts ausente");
  }
  return parsed as unknown as SafariManifest;
}

async function writeSummary(input: {
  status: "built" | "blocked_converter_unavailable";
  manifest: SafariManifest;
  pageBridgePath: string;
  plan: ReturnType<typeof createSafariConverterPlan>;
  xcodeProjectPath: string | null;
  blocker: string | null;
}): Promise<void> {
  const pageBridge = await fs.readFile(input.pageBridgePath, "utf8");
  const summary = {
    mode: "safari-extension-companion",
    milestone: "M39",
    status: input.status,
    safariExtensionVersion,
    source: path.relative(repoRoot, chromeDistDir),
    webExtensionDir: path.relative(repoRoot, webExtensionDir),
    xcodeProjectPath: input.xcodeProjectPath ? path.relative(repoRoot, input.xcodeProjectPath) : null,
    manifestVersion: input.manifest.manifest_version,
    manifestName: input.manifest.name,
    manifestPackageVersion: input.manifest.version,
    contentScriptMatches: input.manifest.content_scripts.flatMap((script) => script.matches),
    overlayMountTokenDetected: pageBridge.includes("nuoma-wpp-overlay-root"),
    converter: {
      command: input.plan.command,
      args: input.plan.args,
      usesXcrun: input.plan.usesXcrun,
    },
    blocker: input.blocker,
    generatedAtUtc: new Date().toISOString(),
  };

  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

async function assertFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`arquivo invalido: ${filePath}`);
  }
}

async function findXcodeProject(baseDir: string): Promise<string | null> {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(".xcodeproj")) {
      return path.join(baseDir, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "web-extension") {
      continue;
    }
    const nestedDir = path.join(baseDir, entry.name);
    const nested = await fs.readdir(nestedDir, { withFileTypes: true }).catch(() => []);
    const project = nested.find((nestedEntry) => nestedEntry.isDirectory() && nestedEntry.name.endsWith(".xcodeproj"));
    if (project) {
      return path.join(nestedDir, project.name);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
