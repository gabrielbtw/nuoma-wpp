import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "packages/ui/src/tokens/index.ts",
  "packages/ui/src/controls/field.tsx",
  "packages/ui/src/controls/icon-button.tsx",
  "packages/ui/src/controls/number-input.tsx",
  "packages/ui/src/display/data-table.tsx",
  "packages/ui/src/display/filter-bar.tsx",
  "packages/ui/src/display/pagination.tsx",
];

for (const file of requiredFiles) {
  assert.equal(existsSync(path.join(root, file)), true, `missing ${file}`);
}

const localConceptFiles = [
  "data/design-system-v3/concepts/04-green-blue-component-board.png",
  "data/design-system-v3/concepts/05-green-blue-workspace.png",
];
const localConceptsPresent = localConceptFiles.every((file) => existsSync(path.join(root, file)));

const uiIndex = read("packages/ui/src/index.ts");
for (const exported of [
  "field",
  "icon-button",
  "number-input",
  "data-table",
  "filter-bar",
  "pagination",
]) {
  assert.match(uiIndex, new RegExp(`export \\* from "\\./(?:controls|display)/${exported}\\.js"`));
}

const tokenSource = read("packages/ui/src/tokens/index.ts");
for (const token of ["blue", "green", "teal", "blueSoft", "greenSoft", "tealSoft"]) {
  assert.match(tokenSource, new RegExp(`${token}:`), `missing brand token ${token}`);
}

const scanned = [
  "apps/web/src/styles.css",
  "packages/ui/src/tokens/index.ts",
  "apps/web/src/components/charts/ThemedChart.tsx",
  "apps/worker/src/features/overlay/inject.ts",
]
  .map((file) => `${file}\n${read(file)}`)
  .join("\n\n");

const forbiddenColorLiterals = [
  "#21dff1",
  "33, 223, 241",
  "rgb(120 216 213)",
  "202 166 106",
  "232 201 141",
  "214 162 60",
  "238 200 126",
  "238 79 159",
  "#d6a23c",
  "#CAA66A",
  "#E8C98D",
  "#e8c98d",
];

for (const literal of forbiddenColorLiterals) {
  assert.equal(scanned.includes(literal), false, `forbidden legacy/neon color literal: ${literal}`);
}

console.log(
  `design-system-v3|exports=ok|green_blue_palette=ok|concepts=${
    localConceptsPresent ? "local" : "skipped"
  }`,
);

function read(file) {
  return readFileSync(path.join(root, file), "utf8");
}
