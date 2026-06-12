import { useMemo, useState } from "react";

import { useToast } from "@nuoma/ui";

import { isCampaignOverlayEnabled } from "../../campaigns/CampaignsRecipientsPanel.js";
import type { RouterInput, RouterOutput } from "../../lib/api-types.js";
import { trpc } from "../../lib/trpc.js";

export type CampaignListItem = RouterOutput["campaigns"]["list"]["campaigns"][number];
export type CampaignTickResult = RouterOutput["campaigns"]["tick"];
type RemarketingBatchInput = RouterInput["campaigns"]["remarketingBatchReady"];
export type RemarketingBatchDispatchResult = RouterOutput["campaigns"]["remarketingBatchDispatch"];

/**
 * Operational wiring for the dispatch/recipients consoles, ported intact from
 * the previous CampaignsPage — these flows are send-critical and keep their
 * guardrails (readiness check → textual confirmation → tick / batch dispatch).
 */
export function useCampaignOps(campaigns: CampaignListItem[]) {
  const utils = trpc.useUtils();
  const toast = useToast();

  const [lastTick, setLastTick] = useState<CampaignTickResult | null>(null);
  const [lastBatchDispatch, setLastBatchDispatch] = useState<RemarketingBatchDispatchResult | null>(
    null,
  );
  const [safeCampaignId, setSafeCampaignId] = useState("");
  const [safeConfirm, setSafeConfirm] = useState("");
  const [safeBatchPhones, setSafeBatchPhones] = useState("");
  const [safeBatchAllowedPhone, setSafeBatchAllowedPhone] = useState("");
  const [safeBatchAllowedInstagram, setSafeBatchAllowedInstagram] = useState("");
  const [safeBatchConfirm, setSafeBatchConfirm] = useState("");
  const [globalTickConfirm, setGlobalTickConfirm] = useState("");
  const [batchReadyKey, setBatchReadyKey] = useState<string | null>(null);

  const selectedSafeCampaignId = useMemo(() => {
    const parsed = Number(safeCampaignId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [safeCampaignId]);

  const selectedSafeCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedSafeCampaignId) ?? null,
    [campaigns, selectedSafeCampaignId],
  );

  const currentBatchInput = useMemo(
    () =>
      selectedSafeCampaignId
        ? remarketingBatchInput({
            campaignId: selectedSafeCampaignId,
            channel: selectedSafeCampaign?.channel ?? "whatsapp",
            recipients: safeBatchPhones,
            allowedPhone: safeBatchAllowedPhone,
            allowedInstagram: safeBatchAllowedInstagram,
          })
        : null,
    [
      selectedSafeCampaignId,
      selectedSafeCampaign?.channel,
      safeBatchPhones,
      safeBatchAllowedPhone,
      safeBatchAllowedInstagram,
    ],
  );
  const currentBatchKey = currentBatchInput ? remarketingBatchRequestKey(currentBatchInput) : null;

  const readiness = trpc.campaigns.ready.useQuery(
    { campaignId: selectedSafeCampaignId ?? 1 },
    { enabled: false, retry: false },
  );

  const batchReady = trpc.campaigns.remarketingBatchReady.useMutation({
    onSuccess(result, variables) {
      setBatchReadyKey(remarketingBatchRequestKey(variables));
      setSafeBatchConfirm("");
      toast.push({
        title: result.canDispatch ? "Lote pronto" : "Lote bloqueado",
        description: result.canDispatch
          ? `${result.summary.acceptedRecipients} destinatário(s), ${result.summary.plannedJobs} job(s) previstos.`
          : `${result.issues.filter((issue) => issue.severity === "error").length} bloqueio(s) no lote.`,
        variant: result.canDispatch ? "success" : "warning",
      });
    },
    onError(error) {
      toast.push({ title: "Falha ao validar lote", description: error.message, variant: "danger" });
    },
  });

  const currentBatchReady =
    batchReadyKey && currentBatchKey === batchReadyKey ? (batchReady.data ?? null) : null;

  const batchDispatch = trpc.campaigns.remarketingBatchDispatch.useMutation({
    async onSuccess(result) {
      setLastBatchDispatch(result);
      setBatchReadyKey(null);
      setSafeBatchConfirm("");
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Lote enfileirado",
        description: `${result.recipientsCreated} destinatário(s), ${result.scheduler.jobsCreated} job(s) criados.`,
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha no lote real", description: error.message, variant: "danger" });
    },
  });

  const tick = trpc.campaigns.tick.useMutation({
    onSuccess(result) {
      setLastTick(result);
      void utils.campaigns.list.invalidate();
      toast.push({
        title: result.dryRun ? "Simulação calculada" : "Jobs criados",
        description: result.dryRun
          ? `${result.plannedJobs.length} job(s) seriam criados`
          : `${result.jobsCreated} job(s), ${result.recipientsCompleted} concluído(s), ${result.recipientsSkipped} pulado(s)`,
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha no tick", description: error.message, variant: "danger" });
    },
  });

  const pauseCampaign = trpc.campaigns.pause.useMutation({
    async onSuccess(result) {
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Campanha pausada",
        description: result.campaign
          ? `${result.campaign.name} não será enfileirada até ser retomada.`
          : "Campanha atualizada.",
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha ao pausar", description: error.message, variant: "danger" });
    },
  });

  const resumeCampaign = trpc.campaigns.resume.useMutation({
    async onSuccess(result) {
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Campanha retomada",
        description: result.campaign
          ? `${result.campaign.name} voltou para ${result.campaign.status}.`
          : "Campanha atualizada.",
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha ao retomar", description: error.message, variant: "danger" });
    },
  });

  const updateCampaign = trpc.campaigns.update.useMutation({
    async onSuccess(result) {
      await utils.campaigns.list.invalidate();
      const enabled = isCampaignOverlayEnabled(result.campaign?.metadata ?? {});
      toast.push({
        title: enabled ? "Overlay liberado" : "Overlay removido",
        description: result.campaign
          ? `${result.campaign.name}: overlay ${enabled ? "sim" : "não"}.`
          : "Campanha atualizada.",
        variant: enabled ? "success" : "info",
      });
    },
    onError(error) {
      toast.push({
        title: "Falha ao atualizar overlay",
        description: error.message,
        variant: "danger",
      });
    },
  });

  const isGlobalTickPending = (dryRun: boolean) =>
    tick.isPending &&
    tick.variables?.campaignId === undefined &&
    (tick.variables?.dryRun ?? false) === dryRun;
  const isCampaignTickPending = (campaignId: number, dryRun: boolean) =>
    tick.isPending &&
    tick.variables?.campaignId === campaignId &&
    (tick.variables?.dryRun ?? false) === dryRun;

  const runSafeReady = async () => {
    if (!selectedSafeCampaignId) return;
    const result = await readiness.refetch();
    setSafeConfirm("");
    if (result.data) {
      toast.push({
        title: result.data.canEnqueue ? "Campanha pronta" : "Campanha bloqueada",
        description: result.data.canEnqueue
          ? `${result.data.summary.plannedJobs} job(s) prontos com guardrails aprovados.`
          : `${result.data.issues.filter((issue) => issue.severity === "error").length} bloqueio(s) encontrados.`,
        variant: result.data.canEnqueue ? "success" : "warning",
      });
    }
  };

  const runSafeEnqueue = () => {
    if (!selectedSafeCampaignId || !readiness.data?.canEnqueue) return;
    tick.mutate({ dryRun: false, campaignId: selectedSafeCampaignId, confirmText: safeConfirm });
    setSafeConfirm("");
  };

  const runConfirmedTick = (input: { campaignId?: number; label: string; confirmText: string }) => {
    if (!input.campaignId) {
      toast.push({
        title: "Selecione uma campanha",
        description: "Disparo real exige campanha selecionada.",
        variant: "warning",
      });
      return;
    }
    if (input.confirmText !== "DISPARAR") {
      toast.push({
        title: "Enfileiramento cancelado",
        description: "Confirmação textual obrigatória não foi preenchida.",
        variant: "warning",
      });
      return;
    }
    tick.mutate({ dryRun: false, campaignId: input.campaignId, confirmText: input.confirmText });
    setGlobalTickConfirm("");
  };

  const toggleCampaignOverlay = (campaign: CampaignListItem) => {
    const enabled = !isCampaignOverlayEnabled(campaign.metadata);
    updateCampaign.mutate({
      id: campaign.id,
      metadata: { ...campaign.metadata, overlayEnabled: enabled },
    });
  };

  const runBatchReady = () => {
    if (!currentBatchInput) return;
    batchReady.mutate(currentBatchInput);
  };

  const runBatchDispatch = () => {
    if (!currentBatchInput || !currentBatchReady?.canDispatch) return;
    if (currentBatchKey !== batchReadyKey) {
      toast.push({
        title: "Revalide o lote",
        description: "O alvo, campanha ou allowlist mudou depois da última validação.",
        variant: "warning",
      });
      return;
    }
    batchDispatch.mutate({ ...currentBatchInput, confirmText: safeBatchConfirm });
  };

  const selectCampaignForDispatch = (campaignId: number) => {
    setSafeCampaignId(String(campaignId));
    setSafeConfirm("");
    setGlobalTickConfirm("");
    setSafeBatchConfirm("");
    setBatchReadyKey(null);
  };

  return {
    lastTick,
    lastBatchDispatch,
    safeCampaignId,
    setSafeCampaignId,
    safeConfirm,
    setSafeConfirm,
    safeBatchPhones,
    setSafeBatchPhones,
    safeBatchAllowedPhone,
    setSafeBatchAllowedPhone,
    safeBatchAllowedInstagram,
    setSafeBatchAllowedInstagram,
    safeBatchConfirm,
    setSafeBatchConfirm,
    globalTickConfirm,
    setGlobalTickConfirm,
    selectedSafeCampaignId,
    selectedSafeCampaign,
    readiness,
    batchReady,
    currentBatchReady,
    batchDispatch,
    tick,
    pauseCampaign,
    resumeCampaign,
    updateCampaign,
    isGlobalTickPending,
    isCampaignTickPending,
    runSafeReady,
    runSafeEnqueue,
    runConfirmedTick,
    toggleCampaignOverlay,
    runBatchReady,
    runBatchDispatch,
    selectCampaignForDispatch,
  };
}

function remarketingBatchInput(input: {
  campaignId: number;
  channel: CampaignListItem["channel"];
  recipients: string;
  allowedPhone: string;
  allowedInstagram: string;
}): RemarketingBatchInput {
  const base = {
    campaignId: input.campaignId,
    rawPhones: "",
    phones: [],
    rawInstagramHandles: "",
    instagramHandles: [],
    contactIds: [],
    maxRecipients: 100,
  };
  if (input.channel === "instagram") {
    return {
      ...base,
      rawInstagramHandles: input.recipients,
      allowedInstagramHandle: input.allowedInstagram.trim() || undefined,
    };
  }
  return {
    ...base,
    rawPhones: input.recipients,
    allowedPhone: input.allowedPhone.trim() || undefined,
  };
}

function remarketingBatchRequestKey(input: RemarketingBatchInput): string {
  return JSON.stringify({
    campaignId: input.campaignId,
    rawPhones: normalizeBatchKeyText(input.rawPhones),
    phones: [...(input.phones ?? [])].map(normalizeBatchKeyText).sort(),
    rawInstagramHandles: normalizeBatchKeyText(input.rawInstagramHandles),
    instagramHandles: [...(input.instagramHandles ?? [])].map(normalizeBatchKeyText).sort(),
    contactIds: [...(input.contactIds ?? [])].sort((a, b) => a - b),
    allowedPhone: normalizeBatchKeyText(input.allowedPhone),
    allowedInstagramHandle: normalizeBatchKeyText(input.allowedInstagramHandle),
    maxRecipients: input.maxRecipients ?? 100,
  });
}

function normalizeBatchKeyText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
}
