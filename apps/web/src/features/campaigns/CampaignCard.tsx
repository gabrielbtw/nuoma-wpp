import { Layers, Pause, Play, Radio, SquarePen } from "lucide-react";

import { Badge, Button, ChannelIcon, TimeAgo, cn } from "@nuoma/ui";

import { campaignStatusLabel, campaignStatusVariant } from "../shared/status.js";
import type { CampaignListItem } from "./use-campaign-ops.js";

export interface CampaignCardProps {
  campaign: CampaignListItem;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onSelectForDispatch: () => void;
  pausePending: boolean;
  resumePending: boolean;
}

export function CampaignCard({
  campaign,
  onEdit,
  onPause,
  onResume,
  onSelectForDispatch,
  pausePending,
  resumePending,
}: CampaignCardProps) {
  const isInstagram = campaign.channel === "instagram";
  const canPause = campaign.status === "running" || campaign.status === "scheduled";
  const canResume = campaign.status === "paused";

  return (
    <article
      data-testid="campaign-card"
      data-campaign-id={campaign.id}
      className={cn(
        "group flex flex-col rounded-xl border border-line-hairline bg-surface-2 p-4",
        "shadow-flat transition-[border-color,box-shadow,transform] duration-150",
        "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised",
      )}
    >
      <header className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            isInstagram ? "bg-channel-ig/12 text-channel-ig" : "bg-channel-wa/12 text-channel-wa",
          )}
        >
          <ChannelIcon channel={campaign.channel} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-sm font-semibold text-ink-strong">
            {campaign.name}
          </h3>
          <p className="mt-0.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">
            #{campaign.id} · {isInstagram ? "Instagram" : "WhatsApp"}
          </p>
        </div>
        <Badge variant={campaignStatusVariant(campaign.status)}>
          {campaignStatusLabel(campaign.status)}
        </Badge>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-ink-soft">
        <span className="flex items-center gap-1 rounded-md bg-ink-strong/[0.05] px-1.5 py-0.5">
          <Layers className="h-3 w-3" />
          {campaign.steps.length === 1 ? "1 bloco" : `${campaign.steps.length} blocos`}
        </span>
        {campaign.evergreen ? (
          <span className="rounded-md bg-status-info/10 px-1.5 py-0.5 text-status-info">
            evergreen
          </span>
        ) : null}
        {campaign.segment ? (
          <span className="rounded-md bg-ink-strong/[0.05] px-1.5 py-0.5">segmentada</span>
        ) : null}
        <span className="ml-auto text-ink-faint">
          <TimeAgo date={campaign.updatedAt} />
        </span>
      </div>

      <footer className="mt-4 flex items-center gap-2 border-t border-line-hairline pt-3">
        <Button
          variant="secondary"
          size="xs"
          leftIcon={<SquarePen className="h-3.5 w-3.5" />}
          onClick={onEdit}
          data-testid="campaign-card-edit"
        >
          Abrir no builder
        </Button>
        {canPause ? (
          <Button
            variant="ghost"
            size="xs"
            loading={pausePending}
            leftIcon={<Pause className="h-3.5 w-3.5" />}
            onClick={onPause}
          >
            Pausar
          </Button>
        ) : null}
        {canResume ? (
          <Button
            variant="ghost"
            size="xs"
            loading={resumePending}
            leftIcon={<Play className="h-3.5 w-3.5" />}
            onClick={onResume}
          >
            Retomar
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          leftIcon={<Radio className="h-3.5 w-3.5" />}
          onClick={onSelectForDispatch}
          title="Selecionar no console de disparo"
        >
          Disparo
        </Button>
      </footer>
    </article>
  );
}
