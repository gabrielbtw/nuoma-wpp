/**
 * Campaign Workflow Viewer - Visual flow diagram with per-step stats
 * Shows the campaign as a ManyChat-like visual flow with success/error reporting.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  Link2,
  Image as ImageIcon,
  MessageSquareText,
  Mic,
  Tag,
  Video,
  XCircle,
  Loader2,
  Users,
  type LucideIcon
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CampaignStepDraft } from "@/lib/campaign-utils";

type StepStats = Record<number, {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}>;

const stepIconMap: Record<string, LucideIcon> = {
  text: MessageSquareText,
  audio: Mic,
  image: ImageIcon,
  video: Video,
  document: FileText,
  link: Link2,
  wait: Clock3,
  ADD_TAG: Tag,
  REMOVE_TAG: Tag
};

const stepColorMap: Record<string, { bg: string; border: string; icon: string }> = {
  text: { bg: "bg-blue-500/10", border: "border-blue-500/30", icon: "text-blue-400" },
  audio: { bg: "bg-purple-500/10", border: "border-purple-500/30", icon: "text-purple-400" },
  image: { bg: "bg-pink-500/10", border: "border-pink-500/30", icon: "text-pink-400" },
  video: { bg: "bg-red-500/10", border: "border-red-500/30", icon: "text-red-400" },
  document: { bg: "bg-amber-500/10", border: "border-amber-500/30", icon: "text-amber-400" },
  link: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", icon: "text-cyan-400" },
  wait: { bg: "bg-orange-500/10", border: "border-orange-500/30", icon: "text-orange-400" },
  ADD_TAG: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: "text-emerald-400" },
  REMOVE_TAG: { bg: "bg-slate-500/10", border: "border-slate-500/30", icon: "text-slate-400" }
};

const stepLabelMap: Record<string, string> = {
  text: "Mensagem", audio: "Audio", image: "Imagem", video: "Video",
  document: "Documento", link: "Link", wait: "Espera",
  ADD_TAG: "Adicionar Tag", REMOVE_TAG: "Remover Tag"
};

function StepNode({
  step, index, stats, isLast, hasCondition
}: {
  step: CampaignStepDraft;
  index: number;
  stats?: { pending: number; processing: number; sent: number; failed: number; skipped: number; total: number };
  isLast: boolean;
  hasCondition: boolean;
}) {
  const Icon = stepIconMap[step.type] ?? MessageSquareText;
  const colors = stepColorMap[step.type] ?? stepColorMap.text;
  const label = stepLabelMap[step.type] ?? step.type;

  const successRate = stats && stats.total > 0
    ? Math.round((stats.sent / stats.total) * 100)
    : null;
  const failRate = stats && stats.total > 0
    ? Math.round((stats.failed / stats.total) * 100)
    : null;

  const previewText = step.type === "wait"
    ? `${step.waitMinutes ?? 0} minutos`
    : step.type === "ADD_TAG" || step.type === "REMOVE_TAG"
      ? step.tagName ?? ""
      : (step.content || "").substring(0, 80) + ((step.content || "").length > 80 ? "..." : "");

  return (
    <div className="flex flex-col items-center">
      {/* Node card */}
      <div className={cn(
        "relative w-full max-w-[360px] rounded-2xl border p-4 transition-all",
        colors.bg, colors.border
      )}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", colors.bg)}>
            <Icon className={cn("h-5 w-5", colors.icon)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h4 className="text-sm font-bold text-white truncate">{label}</h4>
            </div>
            {hasCondition && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-cmm-purple mt-0.5">
                <Filter className="h-2.5 w-2.5" /> Condicional
              </span>
            )}
          </div>
        </div>

        {/* Content preview */}
        {previewText && (
          <div className="mb-3 rounded-lg bg-black/20 px-3 py-2">
            <p className="text-xs text-slate-300 leading-relaxed font-mono break-words">
              {previewText}
            </p>
          </div>
        )}

        {/* Stats bar */}
        {stats && stats.total > 0 ? (
          <div className="space-y-2">
            {/* Progress bar */}
            <div className="h-2 w-full rounded-full bg-black/30 overflow-hidden flex">
              {stats.sent > 0 && (
                <div className="h-full bg-cmm-emerald transition-all" style={{ width: `${(stats.sent / stats.total) * 100}%` }} />
              )}
              {stats.processing > 0 && (
                <div className="h-full bg-cmm-blue animate-pulse transition-all" style={{ width: `${(stats.processing / stats.total) * 100}%` }} />
              )}
              {stats.pending > 0 && (
                <div className="h-full bg-slate-600 transition-all" style={{ width: `${(stats.pending / stats.total) * 100}%` }} />
              )}
              {stats.failed > 0 && (
                <div className="h-full bg-red-500 transition-all" style={{ width: `${(stats.failed / stats.total) * 100}%` }} />
              )}
              {stats.skipped > 0 && (
                <div className="h-full bg-yellow-600 transition-all" style={{ width: `${(stats.skipped / stats.total) * 100}%` }} />
              )}
            </div>

            {/* Stats numbers */}
            <div className="flex flex-wrap gap-2">
              {stats.sent > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-cmm-emerald">
                  <CheckCircle2 className="h-3 w-3" /> {stats.sent}
                </span>
              )}
              {stats.processing > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-cmm-blue">
                  <Loader2 className="h-3 w-3 animate-spin" /> {stats.processing}
                </span>
              )}
              {stats.pending > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                  <Clock3 className="h-3 w-3" /> {stats.pending}
                </span>
              )}
              {stats.failed > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
                  <XCircle className="h-3 w-3" /> {stats.failed}
                </span>
              )}
              {stats.skipped > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-yellow-500">
                  <XCircle className="h-3 w-3" /> {stats.skipped} skip
                </span>
              )}
              <span className="ml-auto text-[10px] font-bold text-slate-500">
                <Users className="h-3 w-3 inline mr-1" />{stats.total}
              </span>
            </div>

            {/* Success/fail rates */}
            {(successRate !== null || failRate !== null) && (
              <div className="flex gap-3 pt-1">
                {successRate !== null && successRate > 0 && (
                  <Badge tone="success" className="text-[9px] px-2 py-0.5">{successRate}% sucesso</Badge>
                )}
                {failRate !== null && failRate > 0 && (
                  <Badge tone="danger" className="text-[9px] px-2 py-0.5">{failRate}% falha</Badge>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <Clock3 className="h-3 w-3" /> Sem execucoes
          </div>
        )}

        {/* Channel scope indicator */}
        {step.channelScope !== "any" && (
          <div className="absolute -top-2 -right-2 rounded-full bg-slate-900 border border-n-border px-2 py-0.5 text-[9px] font-bold text-slate-400">
            {step.channelScope === "whatsapp" ? "WA" : "IG"}
          </div>
        )}
      </div>

      {/* Connector arrow */}
      {!isLast && (
        <div className="flex flex-col items-center py-2">
          <div className="h-6 w-px bg-white/10" />
          <ArrowDown className="h-4 w-4 text-white/20" />
        </div>
      )}
    </div>
  );
}

export function WorkflowViewer({
  campaignId,
  steps,
  campaignName
}: {
  campaignId: string;
  steps: CampaignStepDraft[];
  campaignName: string;
}) {
  const statsQuery = useQuery({
    queryKey: ["campaign-step-stats", campaignId],
    queryFn: () => apiFetch<StepStats>(`/campaigns/${campaignId}/step-stats`),
    refetchInterval: 10_000
  });

  const stats = statsQuery.data ?? {};

  // Aggregate totals
  const totalSent = Object.values(stats).reduce((sum, s) => sum + s.sent, 0);
  const totalFailed = Object.values(stats).reduce((sum, s) => sum + s.failed, 0);
  const totalPending = Object.values(stats).reduce((sum, s) => sum + s.pending, 0);
  const totalProcessing = Object.values(stats).reduce((sum, s) => sum + s.processing, 0);

  return (
    <div className="space-y-6">
      {/* Header with aggregate stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-white tracking-tight">{campaignName}</h2>
          <p className="text-sm text-slate-400">{steps.length} etapas no fluxo</p>
        </div>
        <div className="flex gap-2">
          {totalSent > 0 && <Badge tone="success" className="text-xs px-3 py-1">{totalSent} enviados</Badge>}
          {totalProcessing > 0 && <Badge tone="info" className="text-xs px-3 py-1">{totalProcessing} processando</Badge>}
          {totalPending > 0 && <Badge tone="default" className="text-xs px-3 py-1">{totalPending} pendentes</Badge>}
          {totalFailed > 0 && <Badge tone="danger" className="text-xs px-3 py-1">{totalFailed} falhas</Badge>}
        </div>
      </div>

      {/* Flow diagram */}
      <div className="flex flex-col items-center py-4">
        {/* Start node */}
        <div className="mb-2 flex items-center gap-2 rounded-full border border-cmm-blue/30 bg-cmm-blue/10 px-4 py-2">
          <div className="h-2 w-2 rounded-full bg-cmm-blue animate-pulse" />
          <span className="text-xs font-bold text-cmm-blue">INICIO</span>
        </div>
        <div className="flex flex-col items-center py-2">
          <div className="h-6 w-px bg-white/10" />
          <ArrowDown className="h-4 w-4 text-white/20" />
        </div>

        {/* Step nodes */}
        {steps.map((step, index) => (
          <StepNode
            key={step.id ?? `step-${index}`}
            step={step}
            index={index}
            stats={stats[index]}
            isLast={index === steps.length - 1}
            hasCondition={Boolean(step.conditionType)}
          />
        ))}

        {/* End node */}
        <div className="flex flex-col items-center py-2">
          <div className="h-6 w-px bg-white/10" />
          <ArrowDown className="h-4 w-4 text-white/20" />
        </div>
        <div className="flex items-center gap-2 rounded-full border border-cmm-emerald/30 bg-cmm-emerald/10 px-4 py-2">
          <CheckCircle2 className="h-3 w-3 text-cmm-emerald" />
          <span className="text-xs font-bold text-cmm-emerald">CONCLUIDO</span>
        </div>
      </div>
    </div>
  );
}
