import { describe, expect, it } from "vitest";

import { shouldAllowActiveSendTarget, type ActiveSendTargetState } from "./cdp.js";

const baseState: ActiveSendTargetState = {
  href: "https://web.whatsapp.com/",
  hrefPhone: null,
  title: "Gabriel Braga Nuoma",
  titlePhone: null,
  overlayPhone: null,
  hasComposer: true,
};

describe("CDP active send target guard", () => {
  it("does not trust stale openChatPhone memory without live WhatsApp evidence", () => {
    const nowMs = 1_000_000;

    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: baseState,
        openChatPhone: "5531982066263",
        openChatPhoneNavigatedAtMs: nowMs - 60_000,
        nowMs,
        allowedSelfChatPhones: [],
        expectedTitle: null,
      }),
    ).toBe(false);
  });

  it("does not trust the short post-navigation window without live target evidence", () => {
    const nowMs = 1_000_000;

    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: baseState,
        openChatPhone: "5531982066263",
        openChatPhoneNavigatedAtMs: nowMs - 5_000,
        nowMs,
        allowedSelfChatPhones: [],
        expectedTitle: null,
      }),
    ).toBe(false);
  });

  it("allows live DOM phone evidence even without memory", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: {
          ...baseState,
          overlayPhone: "5531982066263",
        },
        openChatPhone: null,
        openChatPhoneNavigatedAtMs: 0,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: null,
      }),
    ).toBe(true);
  });

  it("allows reusing a saved-contact chat when the active title matches the expected conversation", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: baseState,
        openChatPhone: "5531982066263",
        openChatPhoneNavigatedAtMs: 995_000,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: "gabriel braga nuoma",
      }),
    ).toBe(true);
  });

  it("blocks when /send phone matches but the active WhatsApp header is another phone", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: {
          ...baseState,
          href: "https://web.whatsapp.com/send?phone=5531982066263",
          hrefPhone: "5531982066263",
          title: "+55 31 9296-2471",
          titlePhone: "553192962471",
        },
        openChatPhone: "5531982066263",
        openChatPhoneNavigatedAtMs: 995_000,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: "gabriel braga nuoma",
      }),
    ).toBe(false);
  });

  it("blocks when /send phone matches but the active WhatsApp title is another saved contact", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: {
          ...baseState,
          href: "https://web.whatsapp.com/send?phone=5531982066263",
          hrefPhone: "5531982066263",
          title: "Outro Contato",
        },
        openChatPhone: "5531982066263",
        openChatPhoneNavigatedAtMs: 995_000,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: "gabriel braga nuoma",
      }),
    ).toBe(false);
  });
});
