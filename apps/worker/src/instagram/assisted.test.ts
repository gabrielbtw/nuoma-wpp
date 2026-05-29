import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";

import { fillInstagramComposer } from "./assisted.js";

function createRichComposerPage(options: { keyboardWrites: boolean }) {
  let composerText = "";
  let focused = false;
  const textarea = {
    count: vi.fn(async () => 0),
    fill: vi.fn(),
  };
  const richComposer = {
    count: vi.fn(async () => 1),
    scrollIntoViewIfNeeded: vi.fn(async () => undefined),
    click: vi.fn(async () => {
      throw new Error("unstable composer");
    }),
    evaluate: vi.fn(async (_callback: unknown, value?: string) => {
      if (typeof value === "string") {
        composerText = value;
        return true;
      }
      focused = true;
      return undefined;
    }),
  };
  const page = {
    locator: vi.fn((selector: string) => ({
      last: () => (selector === "textarea" ? textarea : richComposer),
    })),
    keyboard: {
      insertText: vi.fn(async (value: string) => {
        if (options.keyboardWrites && focused) {
          composerText = value;
        }
      }),
      press: vi.fn(),
    },
    evaluate: vi.fn(async (_callback: unknown, expectedText?: string) => {
      if (typeof expectedText === "string") {
        return composerText.includes(expectedText);
      }
      return true;
    }),
    waitForTimeout: vi.fn(),
  } as unknown as Page;

  return { page, richComposer };
}

describe("Instagram assisted sender", () => {
  it("falls back to DOM focus when Instagram rich composer is not stable for clicking", async () => {
    const { page, richComposer } = createRichComposerPage({ keyboardWrites: true });

    await fillInstagramComposer(page, "oi pelo instagram");

    expect(richComposer.click).toHaveBeenCalledTimes(2);
    expect(richComposer.click).toHaveBeenLastCalledWith({ force: true, timeout: 3_000 });
    expect(richComposer.evaluate).toHaveBeenCalledTimes(1);
    expect(page.keyboard.insertText).toHaveBeenCalledWith("oi pelo instagram");
  });

  it("uses direct DOM insertion when keyboard input does not update the rich composer", async () => {
    const { page, richComposer } = createRichComposerPage({ keyboardWrites: false });

    await fillInstagramComposer(page, "fallback por input event");

    expect(page.keyboard.insertText).toHaveBeenCalledWith("fallback por input event");
    expect(richComposer.evaluate).toHaveBeenCalledTimes(2);
    expect(richComposer.evaluate).toHaveBeenLastCalledWith(expect.any(Function), "fallback por input event");
  });
});
