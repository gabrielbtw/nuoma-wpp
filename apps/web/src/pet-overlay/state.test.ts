import { describe, expect, it } from "vitest";

import { getOctoTimeout, resolveOctoStateAfterTimeout, shouldAcceptOctoEvent } from "./state.js";

describe("Octo runtime state", () => {
  it("keeps failed state above success events", () => {
    expect(
      shouldAcceptOctoEvent(
        { visualState: "failed", activeEvent: "campaign_failed" },
        "campaign_sent",
      ),
    ).toBe(false);
  });

  it("allows higher-priority events to interrupt active work", () => {
    expect(
      shouldAcceptOctoEvent(
        { visualState: "running", activeEvent: "campaign_sending" },
        "api_connection_lost",
      ),
    ).toBe(true);
  });

  it("returns one-shot states to idle", () => {
    expect(resolveOctoStateAfterTimeout("jumping")).toBe("idle");
    expect(resolveOctoStateAfterTimeout("waving")).toBe("idle");
    expect(resolveOctoStateAfterTimeout("running")).toBe("running");
  });

  it("exposes expected timeouts", () => {
    expect(getOctoTimeout("failed")).toBe(6000);
    expect(getOctoTimeout("review")).toBeNull();
  });
});
