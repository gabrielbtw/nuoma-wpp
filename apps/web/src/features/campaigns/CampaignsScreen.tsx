import type { CampaignStatus, ChannelType } from "@nuoma/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@nuoma/ui";

import { CampaignsDispatchPanel } from "../../campaigns/CampaignsDispatchPanel.js";
import { CampaignsRecipientsPanel } from "../../campaigns/CampaignsRecipientsPanel.js";
import { parseCampaignSearch } from "../../campaigns/campaign-search.js";
import { trpc } from "../../lib/trpc.js";
import { campaignStatusLabel } from "../shared/status.js";
import { CampaignCard } from "./CampaignCard.js";
import { useCampaignOps } from "./use-campaign-ops.js";

type HubTab = "campaigns" | "dispatch" | "recipients";

const STATUS_FILTERS: Array<{ value: CampaignStatus | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "draft", label: "Rascunho" },
  { value: "scheduled", label: "Agendada" },
  { value: "running", label: "Em execução" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Concluída" },
];

const CHANNEL_FILTERS: Array<{ value: ChannelType | "all"; label: string }> = [
  { value: "all", label: "Todos os canais" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
];

export function CampaignsScreen() {
  const navigate = useNavigate();
  const campaigns = trpc.campaigns.list.useQuery();
  const list = useMemo(() => campaigns.data?.campaigns ?? [], [campaigns.data?.campaigns]);
  const ops = useCampaignOps(list);

  const initialSearch = useMemo(() => {
    if (typeof window === "undefined")
      return { tab: "overview" as const, campaignId: null, intent: null };
    return parseCampaignSearch(window.location.search);
  }, []);

  const [tab, setTab] = useState<HubTab>(() => {
    if (initialSearch.tab === "dispatch") return "dispatch";
    if (initialSearch.tab === "recipients") return "recipients";
    return "campaigns";
  });

  // Legacy deep link: /campaigns?tab=builder now opens the dedicated builder.
  useEffect(() => {
    if (initialSearch.tab === "builder") {
      if (initialSearch.campaignId) {
        void navigate({
          to: "/campaigns/$campaignId/edit",
          params: { campaignId: String(initialSearch.campaignId) },
          replace: true,
        });
      } else {
        void navigate({ to: "/campaigns/new", replace: true });
      }
    }
  }, [initialSearch, navigate]);

  // Deep link (?campaignId=) pre-selects the dispatch console target. Run once.
  useEffect(() => {
    if (initialSearch.campaignId) {
      ops.selectCampaignForDispatch(initialSearch.campaignId);
    }
  }, []);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all");
  const [channelFilter, setChannelFilter] = useState<ChannelType | "all">("all");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return list.filter((campaign) => {
      if (statusFilter !== "all" && campaign.status !== statusFilter) return false;
      if (channelFilter !== "all" && campaign.channel !== channelFilter) return false;
      if (term && !campaign.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [channelFilter, list, query, statusFilter]);

  const kpis = useMemo(
    () => ({
      total: list.length,
      running: list.filter((campaign) => campaign.status === "running").length,
      drafts: list.filter((campaign) => campaign.status === "draft").length,
      evergreen: list.filter((campaign) => campaign.evergreen).length,
    }),
    [list],
  );

  return (
    <div className="flex w-full max-w-none flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-accent">
            Campanhas
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold text-ink-strong md:text-3xl">
            Fluxos de saída
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-ink-soft">
            Desenhe sequências no builder, publique e dispare com guardrails por canal.
          </p>
        </div>
        <Button
          variant="primary"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => navigate({ to: "/campaigns/new" })}
          data-testid="campaigns-new"
        >
          Criar campanha
        </Button>
      </header>

      {campaigns.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Total", value: kpis.total },
            { label: "Em execução", value: kpis.running },
            { label: "Rascunhos", value: kpis.drafts },
            { label: "Evergreen", value: kpis.evergreen },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-line-hairline bg-surface-1 px-4 py-3"
            >
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
                {item.label}
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink-strong">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as HubTab)}>
        <TabsList>
          <TabsTrigger value="campaigns" data-testid="campaign-tab-list">
            Campanhas
          </TabsTrigger>
          <TabsTrigger value="dispatch" data-testid="campaign-tab-dispatch">
            Disparo
          </TabsTrigger>
          <TabsTrigger value="recipients" data-testid="campaign-tab-recipients">
            Destinatários
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1 md:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar campanha…"
                className="h-9 pl-9 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {STATUS_FILTERS.map((option) => (
                <FilterChip
                  key={option.value}
                  active={statusFilter === option.value}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </FilterChip>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {CHANNEL_FILTERS.map((option) => (
                <FilterChip
                  key={option.value}
                  active={channelFilter === option.value}
                  onClick={() => setChannelFilter(option.value)}
                >
                  {option.label}
                </FilterChip>
              ))}
            </div>
          </div>

          {campaigns.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : campaigns.error ? (
            <ErrorState
              title="Falha ao carregar campanhas"
              description={campaigns.error.message}
              action={
                <Button variant="secondary" size="sm" onClick={() => campaigns.refetch()}>
                  Tentar de novo
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            list.length === 0 ? (
              <EmptyState
                title="Nenhuma campanha ainda"
                description="Crie a primeira sequência no builder — texto, áudio, mídia e condições."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={() => navigate({ to: "/campaigns/new" })}
                  >
                    Criar campanha
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="Nada com esses filtros"
                description="Ajuste a busca ou os filtros de status e canal."
              />
            )
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onEdit={() =>
                    navigate({
                      to: "/campaigns/$campaignId/edit",
                      params: { campaignId: String(campaign.id) },
                    })
                  }
                  onPause={() =>
                    ops.pauseCampaign.mutate({ id: campaign.id, reason: "manual_pause_hub" })
                  }
                  onResume={() => ops.resumeCampaign.mutate({ id: campaign.id })}
                  onSelectForDispatch={() => {
                    ops.selectCampaignForDispatch(campaign.id);
                    setTab("dispatch");
                  }}
                  pausePending={
                    ops.pauseCampaign.isPending && ops.pauseCampaign.variables?.id === campaign.id
                  }
                  resumePending={
                    ops.resumeCampaign.isPending && ops.resumeCampaign.variables?.id === campaign.id
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="dispatch" className="mt-4 space-y-4">
          {ops.selectedSafeCampaign ? (
            <p className="font-mono text-[0.68rem] uppercase tracking-widest text-ink-soft">
              Selecionada: {ops.selectedSafeCampaign.name} · {ops.selectedSafeCampaign.channel} ·{" "}
              {campaignStatusLabel(ops.selectedSafeCampaign.status)}
            </p>
          ) : (
            <p className="font-mono text-[0.68rem] uppercase tracking-widest text-status-warn">
              Selecione uma campanha para simular ou disparar.
            </p>
          )}
          <CampaignsDispatchPanel
            campaigns={list}
            selectedCampaignId={ops.selectedSafeCampaignId}
            selectedValue={ops.safeCampaignId}
            onSelect={ops.setSafeCampaignId}
            confirmation={ops.safeConfirm}
            onConfirmationChange={ops.setSafeConfirm}
            readiness={ops.readiness.data ?? null}
            loadingReady={ops.readiness.isFetching}
            readyError={ops.readiness.error?.message ?? null}
            batchPhones={ops.safeBatchPhones}
            onBatchPhonesChange={ops.setSafeBatchPhones}
            batchAllowedPhone={ops.safeBatchAllowedPhone}
            onBatchAllowedPhoneChange={ops.setSafeBatchAllowedPhone}
            batchAllowedInstagram={ops.safeBatchAllowedInstagram}
            onBatchAllowedInstagramChange={ops.setSafeBatchAllowedInstagram}
            batchConfirmation={ops.safeBatchConfirm}
            onBatchConfirmationChange={ops.setSafeBatchConfirm}
            batchReady={ops.currentBatchReady}
            batchReadyPending={ops.batchReady.isPending}
            batchReadyError={ops.batchReady.error?.message ?? null}
            batchDispatchPending={ops.batchDispatch.isPending}
            lastBatchDispatch={ops.lastBatchDispatch}
            enqueuePending={
              ops.selectedSafeCampaignId
                ? ops.isCampaignTickPending(ops.selectedSafeCampaignId, false)
                : false
            }
            intent={initialSearch.intent}
            lastTick={ops.lastTick}
            globalPreviewPending={ops.isGlobalTickPending(true)}
            globalEnqueuePending={ops.isGlobalTickPending(false)}
            globalEnqueueConfirmation={ops.globalTickConfirm}
            onGlobalEnqueueConfirmationChange={ops.setGlobalTickConfirm}
            onReady={ops.runSafeReady}
            onEnqueue={ops.runSafeEnqueue}
            onBatchReady={ops.runBatchReady}
            onBatchDispatch={ops.runBatchDispatch}
            onGlobalPreview={() => {
              if (!ops.selectedSafeCampaignId) return;
              ops.tick.mutate({ dryRun: true, campaignId: ops.selectedSafeCampaignId });
            }}
            onGlobalEnqueue={() =>
              ops.runConfirmedTick({
                campaignId: ops.selectedSafeCampaignId ?? undefined,
                label: ops.selectedSafeCampaign?.name ?? "campanha selecionada",
                confirmText: ops.globalTickConfirm,
              })
            }
          />
        </TabsContent>

        <TabsContent value="recipients" className="mt-4">
          <CampaignsRecipientsPanel
            campaigns={list}
            loading={campaigns.isLoading}
            error={campaigns.error?.message ?? null}
            onPause={(campaignId) =>
              ops.pauseCampaign.mutate({ id: campaignId, reason: "manual_pause_hub" })
            }
            onResume={(campaignId) => ops.resumeCampaign.mutate({ id: campaignId })}
            onToggleOverlay={ops.toggleCampaignOverlay}
            onPreview={(campaignId) => ops.tick.mutate({ dryRun: true, campaignId })}
            onEnqueue={(campaignId, label, confirmText) =>
              ops.runConfirmedTick({ campaignId, label, confirmText })
            }
            isPausePending={(campaignId) =>
              ops.pauseCampaign.isPending && ops.pauseCampaign.variables?.id === campaignId
            }
            isResumePending={(campaignId) =>
              ops.resumeCampaign.isPending && ops.resumeCampaign.variables?.id === campaignId
            }
            isOverlayPending={(campaignId) =>
              ops.updateCampaign.isPending && ops.updateCampaign.variables?.id === campaignId
            }
            isPreviewPending={(campaignId) => ops.isCampaignTickPending(campaignId, true)}
            isEnqueuePending={(campaignId) => ops.isCampaignTickPending(campaignId, false)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-[0.7rem] font-medium transition-colors duration-150",
        active
          ? "bg-accent/15 text-accent"
          : "text-ink-soft hover:bg-ink-strong/[0.06] hover:text-ink-strong",
      )}
    >
      {children}
    </button>
  );
}
