import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredRootFiles = [
  "package.json",
  "package-lock.json",
  "turbo.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "README.md",
  "docs/adr/0001-stack-choice.md",
  "docs/adr/0002-monorepo-structure.md",
  "docs/adr/0003-feature-folders.md",
  "docs/adr/0004-sqlite-drizzle.md",
];

const requiredWorkspaces = [
  { dir: "apps/api", name: "@nuoma/api", files: ["src/app.ts", "src/index.ts", "src/router.ts"] },
  { dir: "apps/web", name: "@nuoma/web", files: ["src/main.tsx", "index.html", "vite.config.ts"] },
  { dir: "apps/worker", name: "@nuoma/worker", files: ["src/index.ts", "src/job-loop.ts"] },
  {
    dir: "apps/chrome-extension",
    name: "@nuoma/chrome-extension",
    files: ["src/manifest.ts", "src/content.ts", "src/background.ts"],
  },
  { dir: "packages/config", name: "@nuoma/config", files: ["src/index.ts"] },
  { dir: "packages/contracts", name: "@nuoma/contracts", files: ["src/index.ts", "src/health.ts"] },
  { dir: "packages/db", name: "@nuoma/db", files: ["src/index.ts", "src/schema.ts", "src/migrate.ts", "drizzle.config.ts"] },
  { dir: "packages/ui", name: "@nuoma/ui", files: ["src/index.ts"] },
];

const requiredScripts = ["build", "dev", "lint", "test", "typecheck"];
const requiredTurboTasks = ["build", "dev", "lint", "test", "typecheck", "clean"];
const requiredAliases = [
  "@nuoma/api",
  "@nuoma/api/router",
  "@nuoma/api/app",
  "@nuoma/config",
  "@nuoma/contracts",
  "@nuoma/db",
  "@nuoma/db/schema",
  "@nuoma/ui",
];

function main() {
  const rootPackage = readJson("package.json");
  assert(rootPackage.private === true, "root package must be private");
  assertArrayIncludes(rootPackage.workspaces, ["apps/*", "packages/*"], "root workspaces");
  for (const script of requiredScripts) {
    assert(typeof rootPackage.scripts?.[script] === "string", `root script missing: ${script}`);
  }

  const turbo = readJson("turbo.json");
  for (const task of requiredTurboTasks) {
    assert(turbo.tasks?.[task], `turbo task missing: ${task}`);
  }

  const tsconfig = readJson("tsconfig.base.json");
  for (const alias of requiredAliases) {
    assert(Array.isArray(tsconfig.compilerOptions?.paths?.[alias]), `tsconfig alias missing: ${alias}`);
  }

  for (const file of requiredRootFiles) {
    assertFile(file);
  }

  for (const workspace of requiredWorkspaces) {
    const pkg = readJson(path.join(workspace.dir, "package.json"));
    assert(pkg.name === workspace.name, `workspace ${workspace.dir} has unexpected name ${pkg.name}`);
    assertFile(path.join(workspace.dir, "tsconfig.json"));
    for (const file of workspace.files) {
      assertFile(path.join(workspace.dir, file));
    }
  }

  assertTextIncludes("README.md", [
    "V2.1-V2.6 base",
    "Turborepo",
    "better-sqlite3 + Drizzle ORM",
  ]);
  assertTextIncludes("docs/adr/0001-stack-choice.md", ["Accepted for V2.1 foundations"]);
  assertTextIncludes("docs/adr/0002-monorepo-structure.md", ["Turborepo monorepo"]);

  console.log(
    [
      "v21-foundations",
      `workspaces=${requiredWorkspaces.length}`,
      `rootFiles=${requiredRootFiles.length}`,
      `aliases=${requiredAliases.length}`,
      "status=closed",
    ].join("|"),
  );
}

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  assertFile(relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function assertFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  assert(fs.existsSync(fullPath), `missing file: ${relativePath}`);
  const stat = fs.statSync(fullPath);
  assert(stat.isFile() && stat.size > 0, `empty or non-file path: ${relativePath}`);
}

function assertArrayIncludes(actual, expected, label) {
  assert(Array.isArray(actual), `${label} must be an array`);
  for (const item of expected) {
    assert(actual.includes(item), `${label} missing ${item}`);
  }
}

function assertTextIncludes(relativePath, fragments) {
  const text = fs.readFileSync(path.join(root, relativePath), "utf8");
  for (const fragment of fragments) {
    assert(text.includes(fragment), `${relativePath} missing text: ${fragment}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`V2.1 foundations smoke failed: ${message}`);
  }
}

main();
