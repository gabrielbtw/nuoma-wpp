import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@nuoma/api";
import {
  Animate,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@nuoma/ui";

import { CampaignMetric, formatTime } from "./CampaignOperationalPanels.js";

type CampaignReadyReport = inferRouterOutputs<AppRouter>["campaigns"]["ready"];
type RemarketingBatchReadyReport =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchReady"];
type RemarketingBatchDispatchResult =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchDispatch"];
type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];
type CampaignBlockIssue = CampaignReadyReport["issues"][number];
type RemarketingBatchRejected = RemarketingBatchReadyReport["rejected"][number];

export function SafeRemarketingConsole({
  campaigns,
  selectedCampaignId,
  selectedValue,
  onSelect,
  confirmation,
  onConfirmationChange,
  readiness,
  loadingReady,
  readyError,
  batchPhones,
  onBatchPhonesChange,
  batchAllowedPhone,
  onBatchAllowedPhoneChange,
  batchAllowedInstagram,
  onBatchAllowedInstagramChange,
  batchConfirmation,
  onBatchConfirmationChange,
  batchReady,
  batchReadyPending,
  batchReadyError,
  batchDispatchPending,
  lastBatchDispatch,
  enqueuePending,
  onReady,
  onEnqueue,
  onBatchReady,
  onBatchDispatch,
}: {
  campaigns: CampaignListItem[];
  selectedCampaignId: number | null;
  selectedValue: string;
  onSelect: (value: string) => void;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  readiness: CampaignReadyReport | null;
  loadingReady: boolean;
  readyError: string | null;
  batchPhones: string;
  onBatchPhonesChange: (value: string) => void;
  batchAllowedPhone: string;
  onBatchAllowedPhoneChange: (value: string) => void;
  batchAllowedInstagram: string;
  onBatchAllowedInstagramChange: (value: string) => void;
  batchConfirmation: string;
  onBatchConfirmationChange: (value: string) => void;
  batchReady: RemarketingBatchReadyReport | null;
  batchReadyPending: boolean;
  batchReadyError: string | null;
  batchDispatchPending: boolean;
  lastBatchDispatch: RemarketingBatchDispatchResult | null;
  enqueuePending: boolean;
  onReady: () => void;
  onEnqueue: () => void;
  onBatchReady: () => void;
  onBatchDispatch: () => void;
}) {
  const canConfirm = Boolean(readiness?.canEnqueue && confirmation === readiness.confirmText);
  const canConfirmBatch = Boolean(
    batchReady?.canDispatch && batchConfirmation === batchReady.confirmText,
  );
  const selected = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const batchChannel = selected?.channel === "instagram" ? "instagram" : "whatsapp";
  const batchPlaceholder = batchChannel === "instagram" ? "@perfil_teste" : "5511999999999";
  const batchAllowlistValue =
    batchChannel === "instagram" ? batchAllowedInstagram : batchAllowedPhone;
  const batchAllowlistChange =
    batchChannel === "instagram" ? onBatchAllowedInstagramChange : onBatchAllowedPhoneChange;
  return (
    <Animate preset="rise-in" delaySeconds={0.06}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Console seguro de remarketing</CardTitle>
              <CardDescription>
                Simule bloqueios e confirme antes de criar Jobs de envio.
              </CardDescription>
            </div>
            <Badge variant={readiness?.canEnqueue ? "success" : "warning"}>
              {readiness?.canEnqueue ? "campanha pronta" : "guardrails"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Select value={selectedValue} onValueChange={onSelect}>
              <SelectTrigger
                aria-label="Campanha para remarketing seguro"
                data-testid="safe-dispatch-campaign-select"
              >
                <SelectValue placeholder="Selecione a campanha" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={String(campaign.id)}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="accent"
              loading={loadingReady}
              disabled={!selectedCampaignId}
              data-testid="safe-dispatch-ready-button"
              onClick={onReady}
            >
              Campanha pronta
            </Button>
            <Button
              variant="soft"
              loading={enqueuePending}
              disabled={!canConfirm}
              title={
                readiness && !canConfirm
                  ? readiness.canEnqueue
                    ? `Digite ${readiness.confirmText} para liberar.`
                    : "Corrija os bloqueios críticos antes de disparar."
                  : undefined
              }
              data-testid="safe-dispatch-enqueue-button"
              onClick={onEnqueue}
            >
              Disparar
            </Button>
          </div>

          {readyError && <div className="text-xs text-semantic-danger">{readyError}</div>}

          {readiness && (
            <div
              className="grid gap-3"
              data-testid="safe-dispatch-report"
              data-can-enqueue={readiness.canEnqueue}
              data-planned-jobs={readiness.summary.plannedJobs}
            >
              <div className="grid gap-2 sm:grid-cols-6">
                <CampaignMetric label="steps" value={readiness.summary.steps} />
                <CampaignMetric label="destinatários" value={readiness.summary.recipientsActive} />
                <CampaignMetric label="telefones" value={readiness.summary.phonesUnique} />
                <CampaignMetric label="jobs" value={readiness.summary.plannedJobs} />
                <CampaignMetric label="política" value={readiness.summary.policyMode} />
                <CampaignMetric label="lista permitida" value={readiness.summary.allowedPhones} />
              </div>
              <CampaignBlockingUxPanel
                title="Bloqueios do disparo"
                label="M40 campanhas"
                canProceed={readiness.canEnqueue}
                issues={readiness.issues}
                generatedAt={readiness.generatedAt}
                emptyMessage="Campanha pronta para enfileirar: nenhum bloqueio crítico encontrado."
                nextAction={
                  readiness.canEnqueue
                    ? `Digite ${readiness.confirmText} para liberar o disparo.`
                    : "Resolva os bloqueios críticos abaixo e rode Campanha pronta novamente."
                }
                data-testid="safe-dispatch-blocking-ux"
              />
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_17rem]">
                <ul className="grid max-h-44 gap-1 overflow-y-auto rounded-lg bg-bg-deep p-2 shadow-pressed-sm">
                  {readiness.issues.map((issue) => (
                    <li
                      key={`${issue.severity}-${issue.code}-${issue.count ?? 0}`}
                      className="grid gap-1 rounded-md bg-bg-base px-3 py-2 text-xs shadow-flat sm:grid-cols-[6rem_1fr_auto]"
                    >
                      <Badge
                        variant={
                          issue.severity === "error"
                            ? "danger"
                            : issue.severity === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {issue.severity}
                      </Badge>
                      <span className="text-fg-muted">{issue.message}</span>
                      <span className="font-mono text-fg-dim">{issue.count ?? issue.code}</span>
                    </li>
                  ))}
                  {readiness.issues.length === 0 && (
                    <li className="rounded-md bg-bg-base px-3 py-2 text-xs text-fg-muted shadow-flat">
                      Guardrails sem bloqueios.
                    </li>
                  )}
                </ul>
                <div className="grid content-start gap-2 rounded-lg bg-bg-deep p-2 shadow-pressed-sm">
                  <div className="px-1 font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                    Confirmação
                  </div>
                  <Input
                    aria-label="Confirmação do disparo"
                    monospace
                    value={confirmation}
                    placeholder={readiness.confirmText}
                    disabled={!readiness.canEnqueue}
                    data-testid="safe-dispatch-confirm-input"
                    onChange={(event) => onConfirmationChange(event.target.value)}
                  />
                  <div className="px-1 text-xs text-fg-muted">
                    Digite {readiness.confirmText} para liberar o botão de disparo.
                  </div>
                  {!readiness.canEnqueue && (
                    <div
                      className="rounded-md bg-bg-base px-3 py-2 text-xs text-semantic-warning shadow-flat"
                      data-testid="safe-dispatch-disabled-reason"
                    >
                      Disparo real bloqueado por {countIssues(readiness.issues, "error")}{" "}
                      bloqueio(s) crítico(s).
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="grid gap-3 rounded-lg bg-bg-deep p-3 shadow-pressed-sm"
            data-testid="safe-batch-dispatch-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                  Lote real
                </div>
                <div className="mt-0.5 text-xs text-fg-muted">
                  {batchChannel === "instagram"
                    ? "Valida lista permitida, lote inteiro e sessão Instagram antes de criar Jobs."
                    : "Valida lista permitida, lote inteiro e mensagens temporárias 24h/90d antes de criar Jobs."}
                </div>
              </div>
              <Badge variant={batchReady?.canDispatch ? "success" : "warning"}>
                {batchReady?.canDispatch ? "lote pronto" : "V2.10.36"}
              </Badge>
            </div>
            <Textarea
              aria-label={
                batchChannel === "instagram" ? "Perfis Instagram do lote" : "Telefones do lote"
              }
              rows={4}
              monospace
              value={batchPhones}
              placeholder={batchPlaceholder}
              data-testid="safe-batch-phones-input"
              onChange={(event) => onBatchPhonesChange(event.target.value)}
            />
            <Input
              monospace
              value={batchAllowlistValue}
              placeholder={batchPlaceholder}
              aria-label={
                batchChannel === "instagram"
                  ? "Instagram do envio canário"
                  : "Telefone do envio canário"
              }
              data-testid="safe-batch-allowlist-input"
              onChange={(event) => batchAllowlistChange(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="accent"
                size="sm"
                loading={batchReadyPending}
                disabled={!selectedCampaignId || batchPhones.trim().length === 0}
                data-testid="safe-batch-ready-button"
                onClick={onBatchReady}
              >
                Validar lote
              </Button>
              <Button
                variant="soft"
                size="sm"
                loading={batchDispatchPending}
                disabled={!canConfirmBatch}
                title={
                  batchReady && !canConfirmBatch
                    ? batchReady.canDispatch
                      ? `Digite ${batchReady.confirmText} para liberar o lote.`
                      : "Corrija o lote inteiro antes de disparar."
                    : undefined
                }
                data-testid="safe-batch-dispatch-button"
                onClick={onBatchDispatch}
              >
                Disparar lote real
              </Button>
            </div>
            {batchReadyError && (
              <div className="text-xs text-semantic-danger">{batchReadyError}</div>
            )}
            {batchReady && (
              <div
                className="grid gap-3"
                data-testid="safe-batch-report"
                data-can-dispatch={batchReady.canDispatch}
                data-accepted={batchReady.summary.acceptedRecipients}
                data-planned-jobs={batchReady.summary.plannedJobs}
              >
                <div className="grid gap-2 sm:grid-cols-6 lg:grid-cols-8">
                  <CampaignMetric label="cand." value={batchReady.summary.candidates} />
                  <CampaignMetric label="aceitos" value={batchReady.summary.acceptedRecipients} />
                  <CampaignMetric label="rejeit." value={batchReady.summary.rejectedRecipients} />
                  <CampaignMetric label="jobs" value={batchReady.summary.plannedJobs} />
                  <CampaignMetric label="política" value={batchReady.summary.policyMode} />
                  <CampaignMetric
                    label="temp"
                    value={
                      batchReady.temporaryMessages.controlSteps.length > 0
                        ? `${batchReady.temporaryMessages.controlSteps.length} step(s)`
                        : batchReady.temporaryMessages.enabled
                          ? `${batchReady.temporaryMessages.beforeSendDuration}/${batchReady.temporaryMessages.afterCompletionDuration}`
                          : "off"
                    }
                  />
                  <CampaignMetric
                    label="ig"
                    value={
                      batchReady.summary.instagramSession
                        ? batchReady.summary.instagramSession.authenticated
                          ? "on"
                          : batchReady.summary.instagramSession.status
                        : batchChannel === "instagram"
                          ? "off"
                          : "n/a"
                    }
                  />
                  <CampaignMetric
                    label="ativos"
                    value={`${batchReady.summary.activeCampaignStepJobs}/${batchReady.summary.activeRecipients}`}
                  />
                </div>
                <CampaignBlockingUxPanel
                  title="Bloqueios do lote real"
                  label="M40 lote"
                  canProceed={batchReady.canDispatch}
                  issues={batchReady.issues}
                  rejected={batchReady.rejected}
                  generatedAt={batchReady.generatedAt}
                  emptyMessage="Lote íntegro: nenhum telefone rejeitado e guardrails aprovados."
                  nextAction={
                    batchReady.canDispatch
                      ? `Digite ${batchReady.confirmText} para liberar o lote real.`
                      : "Corrija todos os rejeitados; lote parcial continua bloqueado."
                  }
                  data-testid="safe-batch-blocking-ux"
                />
                <ul className="grid max-h-40 gap-1 overflow-y-auto rounded-lg bg-bg-base p-2 shadow-pressed-sm">
                  {batchReady.issues.map((issue) => (
                    <li
                      key={`${issue.severity}-${issue.code}-${issue.count ?? 0}`}
                      className="grid gap-1 rounded-md bg-bg-deep px-3 py-2 text-xs shadow-flat sm:grid-cols-[6rem_1fr_auto]"
                    >
                      <Badge
                        variant={
                          issue.severity === "error"
                            ? "danger"
                            : issue.severity === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {issue.severity}
                      </Badge>
                      <span className="text-fg-muted">{issue.message}</span>
                      <span className="font-mono text-fg-dim">{issue.count ?? issue.code}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-2 rounded-lg bg-bg-base p-2 shadow-pressed-sm md:grid-cols-[minmax(0,1fr)_16rem]">
                  <div className="grid gap-1">
                    {batchReady.rejected.slice(0, 4).map((item) => (
                      <div
                        key={`${item.source}-${item.value}-${item.reason}`}
                        className="truncate rounded-md bg-bg-deep px-3 py-2 font-mono text-[0.7rem] text-fg-dim"
                      >
                        {item.source}:{item.value} · {item.reason}
                      </div>
                    ))}
                    {batchReady.rejected.length === 0 && (
                      <div className="rounded-md bg-bg-deep px-3 py-2 text-xs text-fg-muted">
                        Nenhum rejeitado no lote.
                      </div>
                    )}
                  </div>
                  <div className="grid content-start gap-2">
                    <Input
                      monospace
                      value={batchConfirmation}
                      placeholder={batchReady.confirmText}
                      disabled={!batchReady.canDispatch}
                      data-testid="safe-batch-confirm-input"
                      onChange={(event) => onBatchConfirmationChange(event.target.value)}
                    />
                    <div className="px-1 text-xs text-fg-muted">
                      Digite {batchReady.confirmText} para liberar o lote real.
                    </div>
                    {!batchReady.canDispatch && (
                      <div
                        className="rounded-md bg-bg-deep px-3 py-2 text-xs text-semantic-warning shadow-flat"
                        data-testid="safe-batch-disabled-reason"
                      >
                        Lote travado por {countIssues(batchReady.issues, "error")} bloqueio(s) e{" "}
                        {batchReady.rejected.length} rejeitado(s).
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {lastBatchDispatch && (
              <div
                className="rounded-lg bg-bg-base px-3 py-2 text-xs text-fg-muted shadow-flat"
                data-testid="safe-batch-last-dispatch"
              >
                lote {lastBatchDispatch.batchDispatchId} · destinatários{" "}
                {lastBatchDispatch.recipientsCreated} · jobs{" "}
                {lastBatchDispatch.scheduler.jobsCreated}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Animate>
  );
}

function CampaignBlockingUxPanel({
  title,
  label,
  canProceed,
  issues,
  rejected = [],
  generatedAt,
  emptyMessage,
  nextAction,
  "data-testid": testId,
}: {
  title: string;
  label: string;
  canProceed: boolean;
  issues: CampaignBlockIssue[];
  rejected?: RemarketingBatchRejected[];
  generatedAt: string;
  emptyMessage: string;
  nextAction: string;
  "data-testid": string;
}) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const infos = issues.filter((issue) => issue.severity === "info");
  const primaryIssue = errors[0] ?? warnings[0] ?? infos[0] ?? null;
  const rejectedGroups = groupRejected(rejected);

  return (
    <section
      className="rounded-lg bg-bg-base p-3 shadow-flat"
      data-testid={testId}
      data-status={canProceed ? "ready" : "blocked"}
      data-errors={errors.length}
      data-warnings={warnings.length}
      data-infos={infos.length}
      data-rejected={rejected.length}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            {label}
          </div>
          <div className="mt-1 text-sm font-semibold text-fg-primary">{title}</div>
          <div className="mt-1 text-xs text-fg-muted">
            Gerado {formatTime(generatedAt)} · {nextAction}
          </div>
        </div>
        <Badge variant={canProceed ? "success" : "danger"}>
          {canProceed ? "liberado" : "bloqueado"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <CampaignMetric label="críticos" value={errors.length} />
        <CampaignMetric label="atenções" value={warnings.length} />
        <CampaignMetric label="infos" value={infos.length} />
        <CampaignMetric label="rejeitados" value={rejected.length} />
      </div>

      <div className="mt-3 rounded-md bg-bg-deep px-3 py-2 shadow-pressed-sm">
        <div className="font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim">
          Próximo passo
        </div>
        <div className="mt-1 text-xs text-fg-primary">
          {primaryIssue ? issueResolution(primaryIssue) : emptyMessage}
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {issues.slice(0, 4).map((issue) => (
            <div
              key={`${issue.severity}-${issue.code}-${issue.count ?? 0}`}
              className="rounded-md bg-bg-deep px-3 py-2 shadow-pressed-sm"
              data-testid="campaign-blocking-issue"
              data-code={issue.code}
              data-severity={issue.severity}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={issueVariant(issue.severity)}>{issue.severity}</Badge>
                <span className="font-mono text-[0.65rem] text-fg-dim">
                  {issue.count ?? issue.code}
                </span>
              </div>
              <div className="mt-2 text-xs text-fg-primary">{issue.message}</div>
              <div className="mt-1 text-xs text-fg-muted">{issueResolution(issue)}</div>
            </div>
          ))}
        </div>
      )}

      {rejectedGroups.length > 0 && (
        <div className="mt-3 grid gap-1.5" data-testid="campaign-rejected-reasons">
          {rejectedGroups.slice(0, 5).map((group) => (
            <div
              key={group.reason}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg-deep px-3 py-2 text-xs shadow-pressed-sm"
              data-testid="campaign-rejected-reason"
              data-reason={group.reason}
              data-count={group.count}
            >
              <span className="text-fg-primary">{rejectedReasonLabel(group.reason)}</span>
              <span className="font-mono text-fg-dim">
                {group.count} · {group.sample}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function countIssues(issues: CampaignBlockIssue[], severity: CampaignBlockIssue["severity"]) {
  return issues.filter((issue) => issue.severity === severity).length;
}

function issueVariant(severity: CampaignBlockIssue["severity"]) {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function issueResolution(issue: CampaignBlockIssue) {
  switch (issue.code) {
    case "campaign_status_not_runnable":
      return "Retome a campanha ou altere o status para em execução/agendada antes de disparar.";
    case "channel_not_supported":
      return "Use uma campanha WhatsApp ou Instagram para este fluxo seguro.";
    case "campaign_without_steps":
      return "Adicione pelo menos um step com conteúdo antes de validar novamente.";
    case "empty_message_step":
      return "Preencha os steps de texto/link sem mensagem útil.";
    case "no_active_recipients":
      return "Inclua destinatários na fila/em execução ou use o lote real para criar novos alvos.";
    case "invalid_recipient_phone":
      return "Corrija os telefones dos destinatários para números WhatsApp válidos.";
    case "invalid_recipient_instagram":
      return "Corrija os Instagram dos destinatários antes de disparar.";
    case "unsupported_instagram_steps":
      return "Mantenha na campanha Instagram apenas texto, link, imagem ou vídeo.";
    case "suppressed_contact":
      return "Remova contatos blocked/archived do disparo ou regularize o status do contato.";
    case "duplicate_recipient_phone":
      return "Mantenha apenas um destinatário ativo por telefone.";
    case "recipient_already_waiting":
      return "Aguarde os Jobs anteriores finalizarem antes de criar novos envios.";
    case "send_policy_blocks_recipients":
      return "Ajuste a lista permitida ou retire os telefones fora da política atual.";
    case "production_without_canary_allowlist":
      return "Defina uma lista permitida canária explícita antes do envio real.";
    case "dry_run_without_jobs":
      return "Confira status, Steps, esperas e destinatários: a simulação não encontrou Job pronto.";
    case "scheduler_preview_error":
      return "Resolva o erro retornado pela prévia do scheduler e rode a validação novamente.";
    case "temporary_messages_audit_only":
      return "Adicione um step de mensagens temporárias se quiser prova operacional antes do envio.";
    case "temporary_messages_global_not_m303":
      return "Revise o global antigo ou migre para steps explícitos de mensagens temporárias.";
    case "send_policy_allowlist_required":
      return "Informe allowlist explícita para lote real.";
    case "instagram_allowlist_required":
      return "Informe o Instagram canário autorizado antes de liberar o lote.";
    case "instagram_session_unavailable":
      return "Inicie o processador com sessão Instagram antes de validar o lote.";
    case "instagram_session_error":
      return "Corrija o erro da sessão Instagram no processador e valide novamente.";
    case "instagram_session_disconnected":
      return "Reconecte a sessão do navegador (CDP) usada pelo Instagram.";
    case "instagram_session_not_authenticated":
      return "Autentique o Instagram na sessão compartilhada do processador.";
    case "active_campaign_step_jobs":
      return "Finalize ou limpe campaign_step ativos antes de abrir outro lote real.";
    case "active_campaign_recipients":
      return "Conclua destinatários ativos antes de criar um novo lote para a campanha.";
    case "empty_batch":
      return "Informe ao menos um telefone, Instagram ou contato no lote.";
    case "batch_has_rejections":
      return "Corrija todos os rejeitados; o sistema bloqueia lote parcial.";
    case "no_accepted_recipients":
      return "Nenhum alvo passou nos guardrails; revise telefones, contatos e allowlist.";
    case "accepted_recipients":
      return "Alvos aceitos para a próxima etapa de confirmação.";
    default:
      return issue.severity === "error"
        ? "Resolva este bloqueio antes de tentar o envio real."
        : "Revise esta condição antes de executar.";
  }
}

function groupRejected(rejected: RemarketingBatchRejected[]) {
  const groups = new Map<string, { reason: string; count: number; sample: string }>();
  for (const item of rejected) {
    const existing = groups.get(item.reason);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(item.reason, {
      reason: item.reason,
      count: 1,
      sample: `${item.source}:${item.value}`,
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function rejectedReasonLabel(reason: string) {
  switch (reason) {
    case "not_found":
      return "Contato não encontrado";
    case "missing_phone":
      return "Contato sem telefone";
    case "missing_instagram":
      return "Contato sem Instagram";
    case "invalid_phone":
      return "Telefone inválido";
    case "invalid_instagram":
      return "Instagram inválido";
    case "duplicate_candidate":
      return "Alvo duplicado no lote";
    case "duplicate_recipient":
      return "Já existe destinatário para este alvo";
    case "not_allowlisted_for_test_execution":
      return "Fora da lista permitida de teste";
    case "not_in_production_canary_allowlist":
      return "Fora da lista permitida canária";
    case "instagram_allowlist_required":
      return "Lista permitida do Instagram ausente";
    case "instagram_handle_not_allowed":
      return "Instagram fora da lista permitida";
    case "active_pipeline_for_instagram":
      return "Pipeline ativo para este Instagram";
    default:
      if (reason.startsWith("contact_") && reason.endsWith("_suppressed")) {
        return "Contato suprimido por status";
      }
      return reason.replaceAll("_", " ");
  }
}
