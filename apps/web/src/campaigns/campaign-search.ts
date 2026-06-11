export type CampaignTab = "overview" | "builder" | "dispatch" | "recipients";

const CAMPAIGN_TABS = new Set<CampaignTab>(["overview", "builder", "dispatch", "recipients"]);

export interface CampaignSearchState {
  tab: CampaignTab;
  campaignId: number | null;
  intent: string | null;
}

export function parseCampaignSearch(
  search: string | URLSearchParams | null | undefined,
): CampaignSearchState {
  const params =
    search instanceof URLSearchParams
      ? search
      : new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const tab = params.get("tab");
  const intent = params.get("intent");
  const rawCampaignId = params.get("campaignId");
  const campaignId = rawCampaignId ? Number(rawCampaignId) : NaN;
  return {
    tab: CAMPAIGN_TABS.has(tab as CampaignTab)
      ? (tab as CampaignTab)
      : intent === "enqueue"
        ? "dispatch"
        : "overview",
    campaignId: Number.isInteger(campaignId) && campaignId > 0 ? campaignId : null,
    intent,
  };
}

export function campaignSearchFromWindow(): CampaignSearchState {
  if (typeof window === "undefined") {
    return { tab: "overview", campaignId: null, intent: null };
  }
  return parseCampaignSearch(window.location.search);
}

export function isCampaignBuilderImmersive(pathname: string, search = ""): boolean {
  return pathname === "/campaigns" && parseCampaignSearch(search).tab === "builder";
}
