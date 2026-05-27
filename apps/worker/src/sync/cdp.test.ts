import { describe, expect, it } from "vitest";

import {
  parseTemporaryMessagesDuration,
  shouldAllowActiveSendTarget,
  type ActiveSendTargetState,
} from "./cdp.js";

const baseState: ActiveSendTargetState = {
  href: "https://web.whatsapp.com/",
  hrefPhone: null,
  title: "Gabriel Braga Nuoma",
  titlePhone: null,
  overlayPhone: null,
  contactInfoPhone: null,
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

  it("allows saved contacts when contact details prove the live target phone", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: {
          ...baseState,
          contactInfoPhone: "5531982066263",
        },
        openChatPhone: "5531982066263",
        openChatPhoneNavigatedAtMs: 995_000,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: "gabriel braga nuoma",
      }),
    ).toBe(true);
  });

  it("allows Brazilian mobile contacts when WhatsApp title omits the ninth digit", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531988962330",
        state: {
          ...baseState,
          title: "+55 31 8896-2330",
          titlePhone: "553188962330",
          overlayPhone: "553188962330",
        },
        openChatPhone: null,
        openChatPhoneNavigatedAtMs: 0,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: null,
      }),
    ).toBe(true);
  });

  it("allows local Brazilian phone evidence without country code", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531991275407",
        state: {
          ...baseState,
          title: "31 9127-5407 Bh",
          titlePhone: "3191275407",
          overlayPhone: "3191275407",
        },
        openChatPhone: null,
        openChatPhoneNavigatedAtMs: 0,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: "5407 bh",
      }),
    ).toBe(true);
  });

  it("allows the canonical test phone when live evidence is local BR digits only", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531982066263",
        state: {
          ...baseState,
          title: "31982066263",
          titlePhone: "31982066263",
          overlayPhone: "31982066263",
        },
        openChatPhone: null,
        openChatPhoneNavigatedAtMs: 0,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: null,
      }),
    ).toBe(true);
  });

  it("allows a saved-contact title immediately after navigating when overlay confirms the live target phone", () => {
    expect(
      shouldAllowActiveSendTarget({
        expectedPhone: "5531985657732",
        state: {
          ...baseState,
          title: "Vitoria Da Motta Cliente Bh",
          overlayPhone: "5531985657732",
        },
        openChatPhone: "5531985657732",
        openChatPhoneNavigatedAtMs: 995_000,
        nowMs: 1_000_000,
        allowedSelfChatPhones: [],
        expectedTitle: "7732 bh",
      }),
    ).toBe(true);
  });

  it("TODO fails until title-only reuse is blocked because live phone evidence is mandatory", () => {
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
    ).toBe(false);
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

describe("temporary messages duration parser", () => {
  it("recognizes PT/EN/ES duration labels", () => {
    expect(parseTemporaryMessagesDuration("24 horas")).toBe("24h");
    expect(parseTemporaryMessagesDuration("24 hours")).toBe("24h");
    expect(parseTemporaryMessagesDuration("Mensajes temporales: 24 horas")).toBe("24h");
    expect(parseTemporaryMessagesDuration("7 dias")).toBe("7d");
    expect(parseTemporaryMessagesDuration("7 days")).toBe("7d");
    expect(parseTemporaryMessagesDuration("90 dias")).toBe("90d");
    expect(parseTemporaryMessagesDuration("90 days")).toBe("90d");
    expect(parseTemporaryMessagesDuration("3 meses")).toBe("90d");
    expect(parseTemporaryMessagesDuration("three months")).toBe("90d");
    expect(parseTemporaryMessagesDuration("Desativadas")).toBeNull();
  });
});
