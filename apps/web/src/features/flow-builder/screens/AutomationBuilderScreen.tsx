import type { AutomationTrigger } from "@nuoma/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { Button, ErrorState, LoadingState, useToast } from "@nuoma/ui";

import { buildActions } from "../../../flow-builder/lib/build-steps.js";
import { buildSegmentFromDrafts } from "../../../flow-builder/lib/segment.js";
import { trpc } from "../../../lib/trpc.js";
import { automationStatusLabel, automationStatusVariant } from "../../shared/status.js";
import { FlowCanvas } from "../canvas/FlowCanvas.js";
import { buildAutomationGraph } from "../canvas/graph.js";
import { layoutVertical } from "../canvas/layout.js";
import {
  actionRegistry,
  automationLibraryBlocks,
  type LibraryBlockKey,
} from "../config/action-registry.js";
import { stepRegistry } from "../config/step-registry.js";
import { ActionInspector } from "../inspector/ActionInspector.js";
import { AutomationFlowSettings } from "../inspector/AutomationFlowSettings.js";
import { InspectorShell } from "../inspector/InspectorShell.js";
import { BlockLibrary } from "../library/BlockLibrary.js";
import { PreviewPanel } from "../preview/PreviewPanel.js";
import { simulateAutomation } from "../preview/simulate.js";
import { BuilderTopBar } from "../shell/BuilderTopBar.js";
import { AutomationBuilderProvider, useAutomationBuilder } from "../state/automation-store.js";

export function AutomationBuilderScreen() {
  return (
    <AutomationBuilderProvider>
      <AutomationBuilderInner />
    </AutomationBuilderProvider>
  );
}

function AutomationBuilderInner() {
  const { state, dispatch } = useAutomationBuilder();
  const navigate = useNavigate();
  const toast = useToast();
  const utils = trpc.useUtils();

  const params = useParams({ strict: false }) as { automationId?: string };
  const editingId = params.automationId ? Number.parseInt(params.automationId, 10) : null;
  const isEditing = editingId !== null && Number.isInteger(editingId) && editingId > 0;

  const automationQuery = trpc.automations.get.useQuery(
    { id: editingId ?? 0 },
    { enabled: isEditing, retry: false },
  );

  useEffect(() => {
    const automation = automationQuery.data?.automation;
    if (automation && state.automationId !== automation.id) {
      dispatch({ type: "hydrate", automation });
    }
  }, [automationQuery.data, dispatch, state.automationId]);

  useEffect(() => {
    if (!state.dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.dirty]);

  const graph = useMemo(() => {
    const built = buildAutomationGraph(state);
    return { ...built, nodes: layoutVertical(built.nodes) };
  }, [state]);

  const errorCount = useMemo(
    () => graph.nodes.reduce((total, node) => total + node.data.errors.length, 0),
    [graph.nodes],
  );

  const previewEvents = useMemo(() => simulateAutomation(state.actions), [state.actions]);
  const libraryBlocks = useMemo(() => automationLibraryBlocks(), []);

  const selection = state.selection;
  const selectedIndex =
    selection.kind === "block"
      ? state.actions.findIndex((action) => action.id === selection.id)
      : -1;
  const selectedAction = selectedIndex >= 0 ? state.actions[selectedIndex] : null;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "Escape" && state.selection.kind === "block" && !inField) {
        dispatch({ type: "select", selection: { kind: "flow" } });
      }
      if (event.key === "Delete" && selectedAction && !inField) {
        dispatch({ type: "removeAction", id: selectedAction.id });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatch, selectedAction, state.selection.kind]);

  const createAutomation = trpc.automations.create.useMutation();
  const updateAutomation = trpc.automations.update.useMutation();
  const saving = createAutomation.isPending || updateAutomation.isPending;

  const buildPayload = useCallback(() => {
    if (!state.name.trim()) {
      toast.push({ title: "Dê um nome à automação", variant: "warning" });
      dispatch({ type: "select", selection: { kind: "flow" } });
      return null;
    }
    const actions = buildActions(state.actions);
    if (typeof actions === "string") {
      toast.push({ title: "Fluxo incompleto", description: actions, variant: "warning" });
      return null;
    }
    if (errorCount > 0) {
      toast.push({
        title: "Fluxo com pendências",
        description: "Revise as ações marcadas no canvas antes de salvar.",
        variant: "warning",
      });
      return null;
    }
    const tagId = Number.parseInt(state.triggerTagId, 10);
    const campaignId = Number.parseInt(state.triggerCampaignId, 10);
    const trigger: AutomationTrigger = {
      type: state.triggerType,
      ...(state.triggerChannel ? { channel: state.triggerChannel } : {}),
      ...((state.triggerType === "tag_applied" || state.triggerType === "tag_removed") &&
      Number.isInteger(tagId) &&
      tagId > 0
        ? { tagId }
        : {}),
      ...(state.triggerType === "campaign_completed" &&
      Number.isInteger(campaignId) &&
      campaignId > 0
        ? { campaignId }
        : {}),
    };
    return {
      name: state.name.trim(),
      category: state.category.trim() || "geral",
      trigger,
      condition: {
        segment: buildSegmentFromDrafts(
          state.segmentEnabled,
          state.segmentOperator,
          state.segments,
        ),
        requireWithin24hWindow: state.requireWithin24hWindow,
      },
      actions,
      metadata: state.metadata,
    };
  }, [dispatch, errorCount, state, toast]);

  const save = useCallback(async (): Promise<number | null> => {
    const payload = buildPayload();
    if (!payload) return null;
    try {
      if (state.automationId) {
        const result = await updateAutomation.mutateAsync({ id: state.automationId, ...payload });
        dispatch({
          type: "markSaved",
          automationId: state.automationId,
          status: result.automation?.status ?? state.status,
        });
        await Promise.all([
          utils.automations.list.invalidate(),
          utils.automations.get.invalidate({ id: state.automationId }),
        ]);
        toast.push({ title: "Alterações salvas", variant: "success" });
        return state.automationId;
      }
      const result = await createAutomation.mutateAsync(payload);
      const automation = result.automation;
      dispatch({ type: "markSaved", automationId: automation.id, status: automation.status });
      await utils.automations.list.invalidate();
      toast.push({
        title: "Automação criada",
        description: "Salva como rascunho. Ative quando estiver pronta.",
        variant: "success",
      });
      void navigate({
        to: "/automations/$automationId/edit",
        params: { automationId: String(automation.id) },
        replace: true,
      });
      return automation.id;
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
    createAutomation,
    dispatch,
    navigate,
    state.automationId,
    state.status,
    toast,
    updateAutomation,
    utils,
  ]);

  const publish = useCallback(async () => {
    const id = state.dirty || !state.automationId ? await save() : state.automationId;
    if (!id) return;
    try {
      await updateAutomation.mutateAsync({ id, status: "active" });
      dispatch({ type: "markSaved", automationId: id, status: "active" });
      await utils.automations.list.invalidate();
      toast.push({
        title: "Automação ativada",
        description: "Ela passa a reagir aos eventos do gatilho imediatamente.",
        variant: "success",
      });
    } catch (error) {
      toast.push({
        title: "Falha ao ativar",
        description: error instanceof Error ? error.message : String(error),
        variant: "danger",
      });
    }
  }, [dispatch, save, state.automationId, state.dirty, toast, updateAutomation, utils]);

  const addBlock = useCallback(
    (block: LibraryBlockKey, index?: number) => {
      dispatch({ type: "addBlock", block, index });
    },
    [dispatch],
  );

  if (isEditing && automationQuery.isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoadingState title="Abrindo automação" description="Carregando o fluxo salvo…" />
      </div>
    );
  }

  if (isEditing && (automationQuery.error || automationQuery.data?.automation === null)) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <ErrorState
          title="Automação não encontrada"
          description={automationQuery.error?.message ?? "Verifique se ela não foi removida."}
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate({ to: "/automations" })}>
              Voltar para automações
            </Button>
          }
        />
      </div>
    );
  }

  const selectedDefinition = selectedAction
    ? selectedAction.type === "send_step"
      ? stepRegistry[selectedAction.step.type]
      : actionRegistry[selectedAction.type]
    : null;

  return (
    <div className="nwfb-shell" data-testid="automation-builder">
      <BuilderTopBar
        backTo="/automations"
        name={state.name}
        onNameChange={(name) => dispatch({ type: "patchMeta", patch: { name } })}
        channel={state.triggerChannel}
        statusLabel={automationStatusLabel(state.status)}
        statusVariant={automationStatusVariant(state.status)}
        dirty={state.dirty}
        errorCount={errorCount}
        saving={saving}
        publishing={saving}
        previewOpen={state.previewOpen}
        publishLabel="Ativar"
        publishConfirmTitle="Ativar automação?"
        publishConfirmDescription="A automação passa a reagir aos eventos do gatilho em tempo real. Envios reais continuam protegidos pela política de allowlist do worker."
        onSave={() => void save()}
        onPublish={() => void publish()}
        onTogglePreview={() => dispatch({ type: "setPreviewOpen", open: !state.previewOpen })}
        onShowErrors={() => dispatch({ type: "select", selection: { kind: "flow" } })}
      />

      <div className="nwfb-body">
        <aside className="nwfb-library">
          <BlockLibrary blocks={libraryBlocks} channel={state.triggerChannel} onAdd={addBlock} />
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
            onReorder={(orderedIds) => dispatch({ type: "reorderActions", orderedIds })}
            onConnectBranch={(sourceId, targetId) =>
              dispatch({ type: "connectBranch", sourceId, targetId })
            }
            onInsertAt={(index) => dispatch({ type: "addBlock", block: "step:text", index })}
            onDropBlock={addBlock}
          />
          <AnimatePresence>
            {state.previewOpen ? (
              <PreviewPanel
                mode="automation"
                flowChannel={state.triggerChannel}
                events={previewEvents}
                savedId={state.automationId}
                dirty={state.dirty}
                onClose={() => dispatch({ type: "setPreviewOpen", open: false })}
              />
            ) : null}
          </AnimatePresence>
        </main>

        <aside className="nwfb-inspector">
          {selectedAction && selectedDefinition ? (
            <InspectorShell
              panelKey={selectedAction.id}
              icon={selectedDefinition.icon}
              tone={selectedDefinition.tone}
              kicker={`Ação ${String(selectedIndex + 1).padStart(2, "0")}`}
              title={selectedDefinition.label}
              onDuplicate={() => dispatch({ type: "duplicateAction", id: selectedAction.id })}
              onDelete={() => dispatch({ type: "removeAction", id: selectedAction.id })}
            >
              <ActionInspector
                action={selectedAction}
                order={selectedIndex + 1}
                state={state}
                onPatch={(patch) =>
                  dispatch({ type: "updateAction", id: selectedAction.id, patch })
                }
                onPatchStep={(patch) =>
                  dispatch({ type: "updateActionStep", id: selectedAction.id, patch })
                }
              />
            </InspectorShell>
          ) : (
            <InspectorShell
              panelKey="flow-settings"
              icon={SlidersHorizontal}
              tone="accent"
              kicker="Fluxo"
              title="Configurações da automação"
            >
              <AutomationFlowSettings
                state={state}
                onPatch={(patch) => dispatch({ type: "patchMeta", patch })}
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
          Edite fluxos em um desktop ou tablet em modo paisagem. As automações continuam acessíveis
          na listagem.
        </p>
      </div>
    </div>
  );
}
