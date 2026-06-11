import { describe, expect, it } from "vitest";

import { classifyInstagramGuard } from "./guard.js";

describe("Instagram guard", () => {
  it("classifies login pages separately from challenge pages", () => {
    expect(
      classifyInstagramGuard({
        href: "https://www.instagram.com/accounts/login/",
        loginInput: true,
        body: "Instagram Entrar",
      }),
    ).toMatchObject({ blocked: true, reason: "login_required" });

    expect(
      classifyInstagramGuard({
        href: "https://www.instagram.com/challenge/action/",
        loginInput: false,
        body: "Enter the code we sent to your email",
      }),
    ).toMatchObject({ blocked: true, reason: "challenge" });
  });

  it("blocks suspicious-activity and temporary-block pages", () => {
    expect(
      classifyInstagramGuard({
        href: "https://www.instagram.com/direct/inbox/",
        loginInput: false,
        body: "We detected suspicious activity on your account. Try again later.",
      }),
    ).toMatchObject({ blocked: true, reason: "suspicious_activity" });

    expect(
      classifyInstagramGuard({
        href: "https://www.instagram.com/direct/inbox/",
        loginInput: false,
        body: "Sua conta foi temporariamente bloqueada. Tente novamente mais tarde.",
      }),
    ).toMatchObject({ blocked: true, reason: "suspicious_activity" });
  });

  it("allows a normal Direct inbox page", () => {
    expect(
      classifyInstagramGuard({
        href: "https://www.instagram.com/direct/inbox/",
        loginInput: false,
        body: "Primary General Requests",
      }),
    ).toMatchObject({ blocked: false, reason: null });
  });
});
