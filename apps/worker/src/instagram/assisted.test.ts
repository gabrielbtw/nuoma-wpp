import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import type { Page } from "playwright";

import { loadWorkerEnv } from "@nuoma/config";

import { fillInstagramComposer, sendInstagramTextViaCdp } from "./assisted.js";

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

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

describe("sendInstagramTextViaCdp guard rails", () => {
  it("blocks Instagram challenge pages after navigating to an explicit Direct thread", async () => {
    const page = createInstagramPageHarness({
      afterGoto: (url, state) => {
        if (url.includes("/direct/t/")) {
          state.href = "https://www.instagram.com/challenge/action/";
          state.body = "Challenge required. Confirm your identity.";
        }
      },
    });
    const browser = mockBrowser(page);

    await expect(
      sendInstagramTextViaCdp({
        env: loadWorkerEnv({ NODE_ENV: "test" }),
        username: "gabriell_braga",
        threadId: "110051807055981",
        text: "Oi pelo Direct",
        reason: "unit-test",
      }),
    ).rejects.toThrow("Instagram challenge is blocking automation");

    expect(page.goto).toHaveBeenCalledWith(
      "https://www.instagram.com/direct/t/110051807055981/",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
    expect(page.textarea.press).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it("blocks suspicious activity pages after filling the composer and before pressing send", async () => {
    const page = createInstagramPageHarness({
      composerAvailable: true,
      afterTextareaFill: (_text, state) => {
        state.body = "We detected suspicious activity on your account. Try again later.";
      },
    });
    mockBrowser(page);

    await expect(
      sendInstagramTextViaCdp({
        env: loadWorkerEnv({ NODE_ENV: "test" }),
        username: "gabriell_braga",
        threadId: "110051807055981",
        text: "Oi pelo Direct",
        reason: "unit-test",
      }),
    ).rejects.toThrow("Instagram suspicious-activity guard is blocking automation");

    expect(page.textarea.fill).toHaveBeenCalledWith("Oi pelo Direct");
    expect(page.textarea.press).not.toHaveBeenCalled();
  });
});

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
    evaluate: vi.fn(async (callback: unknown, expectedText?: string) => {
      const source = String(callback);
      if (source.includes("body: String(document.body")) {
        return {
          href: "https://www.instagram.com/direct/t/test-thread/",
          loginInput: false,
          body: "Instagram Direct aberto",
        };
      }
      if (source.includes("loginInput: Boolean")) {
        return {
          href: "https://www.instagram.com/direct/t/test-thread/",
          loginInput: false,
        };
      }
      if (typeof expectedText === "string") {
        return composerText.includes(expectedText);
      }
      return true;
    }),
    waitForTimeout: vi.fn(),
  } as unknown as Page;

  return { page, richComposer };
}

function mockBrowser(page: ReturnType<typeof createInstagramPageHarness>) {
  const context = {
    pages: () => [page],
    newPage: vi.fn(async () => page),
  };
  const browser = {
    contexts: () => [context],
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  vi.mocked(chromium.connectOverCDP).mockResolvedValueOnce(browser as never);
  return browser;
}

function createInstagramPageHarness(input: {
  composerAvailable?: boolean;
  afterGoto?: (url: string, state: InstagramHarnessState) => void;
  afterTextareaFill?: (text: string, state: InstagramHarnessState) => void;
}) {
  const state: InstagramHarnessState = {
    href: "https://www.instagram.com/direct/inbox/",
    body: "Instagram Direct inbox",
    composerAvailable: input.composerAvailable ?? false,
  };
  const textarea = {
    count: vi.fn(async () => (state.composerAvailable ? 1 : 0)),
    fill: vi.fn(async (text: string) => {
      input.afterTextareaFill?.(text, state);
    }),
    press: vi.fn(async () => undefined),
  };
  const emptyLocator = {
    count: vi.fn(async () => 0),
    fill: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined),
  };
  const page = {
    textarea,
    isClosed: () => false,
    url: () => state.href,
    goto: vi.fn(async (url: string) => {
      state.href = url;
      input.afterGoto?.(url, state);
    }),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async (source: unknown) => evaluateInstagramHarness(source, state)),
    locator: vi.fn((selector: string) => ({
      last: () => (selector === "textarea" ? textarea : emptyLocator),
    })),
    keyboard: {
      insertText: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
    },
  };
  return page;
}

function evaluateInstagramHarness(source: unknown, state: InstagramHarnessState): unknown {
  const text = String(source);
  if (text.includes("body: String(document.body")) {
    return {
      href: state.href,
      loginInput: false,
      body: state.body,
    };
  }
  if (text.includes("loginInput: Boolean")) {
    return {
      href: state.href,
      loginInput: false,
    };
  }
  if (text.includes("document.querySelector(\"textarea\")")) {
    return state.composerAvailable;
  }
  if (text.includes("input[type='file']")) {
    return false;
  }
  if (text.includes("document.body?.innerText")) {
    return false;
  }
  return false;
}

interface InstagramHarnessState {
  href: string;
  body: string;
  composerAvailable: boolean;
}
