import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createManifest } from "../src/manifest.js";
import { createPageBridgeScript } from "../src/page-bridge.js";

const execFileAsync = promisify(execFile);
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "../..");
const distDir = path.join(packageDir, "dist");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

await execFileAsync(
  process.execPath,
  [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  { cwd: packageDir },
);

await Promise.all([
  fs.writeFile(
    path.join(distDir, "manifest.json"),
    `${JSON.stringify(createManifest(), null, 2)}\n`,
    "utf8",
  ),
  fs.writeFile(path.join(distDir, "page-bridge.js"), `${createPageBridgeScript()}\n`, "utf8"),
  fs.copyFile(path.join(packageDir, "src/popup.html"), path.join(distDir, "popup.html")),
]);

console.log(`m38-chrome-extension|dist=${path.relative(repoRoot, distDir)}|status=built`);
