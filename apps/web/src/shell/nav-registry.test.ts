import { describe, expect, it } from "vitest";

import {
  getShellNavSections,
  getShellShortcutItems,
  shellBreadcrumbForLocation,
} from "./nav-registry.js";

describe("shell nav registry", () => {
  it("filters admin and dev routes for operators", () => {
    const sections = getShellNavSections({ isAdmin: false, isDev: false });
    const paths = sections.flatMap((section) => section.items.map((item) => item.path));

    expect(paths).toContain("/inbox");
    expect(paths).toContain("/campaigns");
    expect(paths).not.toContain("/");
    expect(paths).not.toContain("/jobs");
    expect(paths).not.toContain("/implementation");
  });

  it("includes admin and dev shortcuts when allowed", () => {
    const shortcuts = getShellShortcutItems(true, true).map((item) => item.shortcut);

    expect(shortcuts).toContain("1");
    expect(shortcuts).toContain("7");
    expect(shortcuts).toContain("8");
  });

  it("builds human breadcrumbs for campaign tabs", () => {
    expect(shellBreadcrumbForLocation("/campaigns", "?tab=dispatch")).toBe("Campanhas / Disparo");
    expect(shellBreadcrumbForLocation("/campaigns", "?tab=builder")).toBe("Campanhas / Builder");
    expect(shellBreadcrumbForLocation("/campaigns", "")).toBe("Campanhas / Visão geral");
  });
});
