import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createSafariConverterPlan,
  formatSafariConverterUnavailableMessage,
  isSafariConverterUnavailable,
  safariBundleIdentifier,
  safariCompanionAppName,
} from "./build-plan.js";

describe("M39 Safari extension converter plan", () => {
  it("uses xcrun safari-web-extension-converter by default", () => {
    const plan = createSafariConverterPlan({
      sourceDir: "/repo/apps/safari-extension/dist/web-extension",
      outputDir: "/repo/apps/safari-extension/dist",
    });

    expect(plan.command).toBe("xcrun");
    expect(plan.usesXcrun).toBe(true);
    expect(plan.args[0]).toBe("safari-web-extension-converter");
    expect(plan.args).toContain("/repo/apps/safari-extension/dist/web-extension");
    expect(plan.args).toContain("--project-location");
    expect(plan.args).toContain("/repo/apps/safari-extension/dist");
    expect(plan.args).toContain("--app-name");
    expect(plan.args).toContain(safariCompanionAppName);
    expect(plan.args).toContain("--bundle-identifier");
    expect(plan.args).toContain(safariBundleIdentifier);
    expect(plan.args).toContain("--no-open");
    expect(plan.args).toContain("--force");
  });

  it("runs a provided converter binary directly for controlled smokes", () => {
    const fakeConverter = path.join("/tmp", "fake-safari-converter");
    const plan = createSafariConverterPlan({
      converterBin: fakeConverter,
      sourceDir: "/repo/chrome-dist",
      outputDir: "/repo/safari-dist",
    });

    expect(plan.command).toBe(fakeConverter);
    expect(plan.usesXcrun).toBe(false);
    expect(plan.args[0]).toBe("/repo/chrome-dist");
    expect(plan.args).not.toContain("safari-web-extension-converter");
  });

  it("formats a clear blocker when the local converter is unavailable", () => {
    const plan = createSafariConverterPlan({
      sourceDir: "/repo/chrome-dist",
      outputDir: "/repo/safari-dist",
    });
    const error = Object.assign(new Error("xcrun failed"), {
      code: 72,
      stderr: 'xcrun: error: unable to find utility "safari-web-extension-converter"',
    });

    expect(isSafariConverterUnavailable(error)).toBe(true);
    expect(formatSafariConverterUnavailableMessage(plan, error)).toContain(
      "M39 Safari Extension Companion bloqueado",
    );
  });
});
