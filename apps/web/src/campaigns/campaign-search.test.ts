import { describe, expect, it } from "vitest";

import { isCampaignBuilderImmersive, parseCampaignSearch } from "./campaign-search.js";

describe("campaign search", () => {
  it("defaults campaigns to overview", () => {
    expect(parseCampaignSearch("")).toEqual({ tab: "overview", campaignId: null, intent: null });
  });

  it("routes enqueue intent to dispatch without selecting a fallback campaign", () => {
    expect(parseCampaignSearch("?intent=enqueue")).toEqual({
      tab: "dispatch",
      campaignId: null,
      intent: "enqueue",
    });
  });

  it("parses explicit tab and campaign id", () => {
    expect(parseCampaignSearch("?tab=recipients&campaignId=42")).toEqual({
      tab: "recipients",
      campaignId: 42,
      intent: null,
    });
  });

  it("keeps legacy builder deep link immersive while it redirects", () => {
    expect(isCampaignBuilderImmersive("/campaigns", "?tab=builder")).toBe(true);
    expect(isCampaignBuilderImmersive("/campaigns", "?tab=dispatch")).toBe(false);
    expect(isCampaignBuilderImmersive("/inbox", "?tab=builder")).toBe(false);
  });

  it("detects the dedicated builder routes as immersive", () => {
    expect(isCampaignBuilderImmersive("/campaigns/new")).toBe(true);
    expect(isCampaignBuilderImmersive("/campaigns/42/edit")).toBe(true);
    expect(isCampaignBuilderImmersive("/automations/new")).toBe(true);
    expect(isCampaignBuilderImmersive("/automations/7/edit")).toBe(true);
    expect(isCampaignBuilderImmersive("/campaigns")).toBe(false);
    expect(isCampaignBuilderImmersive("/automations")).toBe(false);
    expect(isCampaignBuilderImmersive("/campaigns/abc/edit")).toBe(false);
  });
});
