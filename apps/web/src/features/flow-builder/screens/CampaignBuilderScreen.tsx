import { useNavigate, useParams } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { Button, ErrorState, LoadingState, useToast } from "@nuoma/ui";

import { buildSteps, type BuilderStepType } from "../../../flow-builder/lib/build-steps.js";
import { buildSegmentFromDrafts } from "../../../flow-builder/lib/segment.js";
import { trpc } from "../../../lib/trpc.js";
import { campaignStatusLabel, campaignStatusVariant } from "../../shared/status.js";
import { FlowCanvas } from "../canvas/FlowCanvas.js";
import { buildCampaignGraph } from "../canvas/graph.js";
import { layoutVertical } from "../canvas/layout.js";
import { campaignLibraryBlocks, type LibraryBlockKey } from "../config/action-registry.js";
import { stepRegistry } from "../config/step-registry.js";
import { CampaignFlowSettings } from "../inspector/CampaignFlowSettings.js";
import { InspectorShell } from "../inspector/InspectorShell.js";
import { StepFields } from "../inspector/StepFields.js";
import { ConditionsEditor } from "../inspector/fields/ConditionsEditor.js";
import { BlockLibrary } from "../library/BlockLibrary.js";
import { PreviewPanel } from "../preview/PreviewPanel.js";
import { simulateCampaign } from "../preview/simulate.js";
import { BuilderTopBar } from "../shell/BuilderTopBar.js";
import { CampaignBuilderProvider, useCampaignBuilder } from "../state/campaign-store.js";
import { localInputToIso } from "../state/hydrate.js";

export function CampaignBuilderScreen() {
  return (
    <CampaignBuilderProvider>
      <CampaignBuilderInner />
    </CampaignBuilderProvider>
  );
}

function CampaignBuilderInner() {
  const { state, dispatch } = useCampaignBuilder();
  const navigate = useNavigate();
  const toast = useToast();
  const utils = trpc.useUtils();

  const params = useParams({ strict: false }) as { campaignId?: string };
  const editingId = params.campaignId ? Number.parseInt(params.campaignId, 10) : null;
  const isEditing = editingId !== null && Number.isInteger(editingId) && editingId > 0;

  const campaignQuery = trpc.campaigns.get.useQuery(
    { id: editingId ?? 0 },
    { enabled: isEditing, retry: false },
  );

  useEffect(() => {
    const campaign = campaignQuery.data?.campaign;
    if (campaign && state.campaignId !== campaign.id) {
      dispatch({ type: "hydrate", campaign });
    }
  }, [campaignQuery.data, dispatch, state.campaignId]);

  useEffect(() => {
    if (!state.dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.dirty]);

  const graph = useMemo(() => {
    const built = buildCampaignGraph(state);
    return { ...built, nodes: layoutVertical(built.nodes) };
  }, [state]);

  const errorCount = useMemo(
    () => graph.nodes.reduce((total, node) => total + node.data.errors.length, 0),
    [graph.nodes],
  );

  const previewEvents = useMemo(() => simulateCampaign(state.steps), [state.steps]);
  const libraryBlocks = useMemo(() => campaignLibraryBlocks(), []);

  const selection = state.selection;
  const selectedStepIndex =
    selection.kind === "block" ? state.steps.findIndex((step) => step.id === selection.id) : -1;
  const selectedStep = selectedStepIndex >= 0 ? state.steps[selectedStepIndex] : null;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "Escape" && state.selection.kind === "block" && !inField) {
        dispatch({ type: "select", selection: { kind: "flow" } });
      }
      if (event.key === "Delete" && selectedStep && !inField) {
        dispatch({ type: "removeStep", id: selectedStep.id });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatch, selectedStep, state.selection.kind]);

  const createCampaign = trpc.campaigns.create.useMutation();
  const updateCampaign = trpc.campaigns.update.useMutation();
  const saving = createCampaign.isPending || updateCampaign.isPending;

  const buildPayload = useCallback(() => {
    if (!state.name.trim()) {
      toast.push({ title: "Dê um nome à campanha", variant: "warning" });
      dispatch({ type: "select", selection: { kind: "flow" } });
      return null;
    }
    const steps = buildSteps(state.steps);
    if (typeof steps === "string") {
      toast.push({ title: "Fluxo incompleto", description: steps, variant: "warning" });
      return null;
    }
    if (errorCount > 0) {
      toast.push({
        title: "Fluxo com pendências",
        description: "Revise os blocos marcados no canvas antes de salvar.",
        variant: "warning",
      });
      return null;
    }
    return {
      name: state.name.trim(),
      channel: state.channel,
      segment: buildSegmentFromDrafts(state.segmentEnabled, state.segmentOperator, state.segments),
      steps,
      evergreen: state.evergreen,
      startsAt: state.evergreen ? null : localInputToIso(state.startsAt),
      metadata: state.metadata,
    };
  }, [dispatch, errorCount, state, toast]);

  const save = useCallback(async (): Promise<number | null> => {
    const payload = buildPayload();
    if (!payload) return null;
    try {
      if (state.campaignId) {
        const result = await updateCampaign.mutateAsync({ id: state.campaignId, ...payload });
        dispatch({
          type: "markSaved",
          campaignId: state.campaignId,
          status: result.campaign?.status ?? state.status,
        });
        await Promise.all([
          utils.campaigns.list.invalidate(),
          utils.campaigns.get.invalidate({ id: state.campaignId }),
        ]);
        toast.push({ title: "Alterações salvas", variant: "success" });
        return state.campaignId;
      }
      const result = await createCampaign.mutateAsync(payload);
      const campaign = result.campaign;
      dispatch({ type: "markSaved", campaignId: campaign.id, status: campaign.status });
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Campanha criada",
        description: "Salva como rascunho. Publique quando estiver pronta.",
        variant: "success",
      });
      void navigate({
        to: "/campaigns/$campaignId/edit",
        params: { campaignId: String(campaign.id) },
        replace: true,
      });
      return campaign.id;
    } catch (error) {
      toast.push({
        title: "Falha ao salvar",
        description: error instanceof Error ? error.message : String(error),
        variant: "danger",
      });
      return null;
    }
  }, [
    buildPayload,
    createCampaign,
    dispatch,
    navigate,
    state.campaignId,
    state.status,
    toast,
    updateCampaign,
    utils,
  ]);

  const publish = useCallback(async () => {
    const id = state.dirty || !state.campaignId ? await save() : state.campaignId;
    if (!id) return;
    try {
      await updateCampaign.mutateAsync({ id, status: "scheduled" });
      dispatch({ type: "markSaved", campaignId: id, status: "scheduled" });
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Campanha publicada",
        description: "Status agendada. O disparo real continua passando pelo console de Disparo.",
        variant: "success",
      });
    } catch (error) {
      toast.push({
        title: "Falha ao publicar",
        description: error instanceof Error ? error.message : String(error),
        variant: "danger",
      });
    }
  }, [dispatch, save, state.campaignId, state.dirty, toast, updateCampaign, utils]);

  const addBlock = useCallback(
    (block: LibraryBlockKey, index?: number) => {
      if (!block.startsWith("step:")) return;
      const stepType = block.slice("step:".length) as BuilderStepType;
      dispatch({ type: "addStep", stepType, index });
    },
    [dispatch],
  );

  if (isEditing && campaignQuery.isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoadingState title="Abrindo campanha" description="Carregando o fluxo salvo…" />
      </div>
    );
  }

  if (isEditing && campaignQuery.error) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <ErrorState
          title="Campanha não encontrada"
          description={campaignQuery.error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate({ to: "/campaigns" })}>
              Voltar para campanhas
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="nwfb-shell" data-testid="campaign-builder">
      <BuilderTopBar
        backTo="/campaigns"
        name={state.name}
        onNameChange={(name) => dispatch({ type: "patchMeta", patch: { name } })}
        channel={state.channel}
        statusLabel={campaignStatusLabel(state.status)}
        statusVariant={campaignStatusVariant(state.status)}
        dirty={state.dirty}
        errorCount={errorCount}
        saving={saving}
        publishing={saving}
        previewOpen={state.previewOpen}
        publishLabel="Publicar"
        publishConfirmTitle="Publicar campanha?"
        publishConfirmDescription="A campanha fica agendada e visível para o scheduler. O envio real continua protegido pelos guardrails do console de Disparo (confirmação textual e allowlist)."
        onSave={() => void save()}
        onPublish={() => void publish()}
        onTogglePreview={() => dispatch({ type: "setPreviewOpen", open: !state.previewOpen })}
        onShowErrors={() => dispatch({ type: "select", selection: { kind: "flow" } })}
      />

      <div className="nwfb-body">
        <aside className="nwfb-library">
          <BlockLibrary blocks={libraryBlocks} channel={state.channel} onAdd={addBlock} />
        </aside>

        <main className="nwfb-stage">
          <FlowCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            selectedId={state.selection.kind === "block" ? state.selection.id : null}
            layoutVersion={state.layoutVersion}
            onSelectBlock={(id) =>
              dispatch({
                type: "select",
                selection: id ? { kind: "block", id } : { kind: "flow" },
              })
            }
            onReorder={(orderedIds) => dispatch({ type: "reorderSteps", orderedIds })}
            onConnectBranch={(sourceId, targetId) =>
              dispatch({ type: "connectBranch", sourceId, targetId })
            }
            onInsertAt={(index) => dispatch({ type: "addStep", stepType: "text", index })}
            onDropBlock={addBlock}
          />
          <AnimatePresence>
            {state.previewOpen ? (
              <PreviewPanel
                mode="campaign"
                flowChannel={state.channel}
                events={previewEvents}
                savedId={state.campaignId}
                dirty={state.dirty}
                onClose={() => dispatch({ type: "setPreviewOpen", open: false })}
              />
            ) : null}
          </AnimatePresence>
        </main>

        <aside className="nwfb-inspector">
          {selectedStep ? (
            <InspectorShell
              panelKey={selectedStep.id}
              icon={stepRegistry[selectedStep.type].icon}
              tone={stepRegistry[selectedStep.type].tone}
              kicker={`Bloco ${String(selectedStepIndex + 1).padStart(2, "0")}`}
              title={stepRegistry[selectedStep.type].label}
              onDuplicate={() => dispatch({ type: "duplicateStep", id: selectedStep.id })}
              onDelete={() => dispatch({ type: "removeStep", id: selectedStep.id })}
            >
              <div className="grid gap-4">
                <StepFields
                  step={selectedStep}
                  order={selectedStepIndex + 1}
                  channel={state.channel}
                  onPatch={(patch) => dispatch({ type: "updateStep", id: selectedStep.id, patch })}
                />
                <ConditionsEditor
                  step={selectedStep}
                  steps={state.steps}
                  order={selectedStepIndex + 1}
                  onAdd={() => dispatch({ type: "addCondition", stepId: selectedStep.id })}
                  onUpdate={(conditionId, patch) =>
                    dispatch({
                      type: "updateCondition",
                      stepId: selectedStep.id,
                      conditionId,
                      patch,
                    })
                  }
                  onRemove={(conditionId) =>
                    dispatch({ type: "removeCondition", stepId: selectedStep.id, conditionId })
                  }
                />
              </div>
            </InspectorShell>
          ) : (
            <InspectorShell
              panelKey="flow-settings"
              icon={SlidersHorizontal}
              tone="accent"
              kicker="Fluxo"
              title={state.campaignId ? "Configurações da campanha" : "Criar campanha"}
            >
              <CampaignFlowSettings
                state={state}
                onPatch={(patch) => dispatch({ type: "patchMeta", patch })}
                onApplyStarter={(draft) => dispatch({ type: "applyStarter", patch: draft })}
              />
            </InspectorShell>
          )}
        </aside>
      </div>

      <div className="nwfb-small-screen" data-testid="builder-small-screen-notice">
        <p className="font-display text-base font-semibold text-ink-strong">
          O builder precisa de uma tela maior
        </p>
        <p className="mt-2 max-w-sm text-sm leading-6 text-ink-soft">
          Edite fluxos em um desktop ou tablet em modo paisagem. As campanhas continuam acessíveis
          na listagem.
        </p>
      </div>
    </div>
  );
}
