import type {
  AutomationAction,
  AutomationTrigger,
  CampaignStep,
  CampaignStepCondition,
  ChannelType,
} from "@nuoma/contracts";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type OnNodeDrag,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Bell,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  FileUp,
  Flag,
  GitBranch,
  Image,
  Instagram,
  Link2,
  LockKeyhole,
  Maximize2,
  Mic,
  Minimize2,
  MousePointer2,
  PanelRight,
  Pencil,
  PlayCircle,
  Plus,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Video,
  ZoomIn,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  useToast,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";
import { buildAbVariantsMetadata } from "./lib/ab-variants.js";
import {
  buildActions,
  buildSteps,
  newActionDraft,
  newConditionDraft,
  newStepDraft,
  type ActionDraft,
  type BuilderActionType,
  type BuilderStepType,
  type ConditionDraft,
  type StepDraft,
} from "./lib/build-steps.js";
import { parseCsvPreview, type CsvPreviewResult } from "./lib/csv-preview.js";
import {
  buildSegment,
  buildSegmentFromDrafts,
  type SegmentDraft,
  type SegmentField,
  type SegmentOperator,
} from "./lib/segment.js";
import { automationTemplates, campaignTemplates } from "./lib/templates.js";
import {
  conditionFieldErrors,
  instagramSupportedStepTypes,
  readyChecks as buildReadyChecks,
  stepDraftFieldErrors,
  unsupportedInstagramStepLabels,
  type StepFieldErrors,
} from "./lib/validation.js";

type BuilderTab = "base" | "audience" | "steps" | "preview";
type CampaignWorkspaceTab = "overview" | "dispatch" | "recipients";
type DraftSaveState = "dirty" | "saving" | "saved" | "error";

const stepTypes: Array<{ value: BuilderStepType; label: string }> = [
  { value: "temporary_messages", label: "Mensagens temporárias" },
  { value: "text", label: "Texto" },
  { value: "link", label: "Link" },
  { value: "voice", label: "Áudio" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "document", label: "Documento" },
];

const temporaryMessagesDurations: Array<{ value: "24h" | "7d" | "90d"; label: string }> = [
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "90d", label: "90 dias" },
];

const actionTypes: Array<{ value: BuilderActionType; label: string }> = [
  { value: "send_step", label: "Enviar step" },
  { value: "delay", label: "Delay" },
  { value: "branch", label: "Branch" },
  { value: "apply_tag", label: "Aplicar tag" },
  { value: "remove_tag", label: "Remover tag" },
  { value: "set_status", label: "Definir status" },
  { value: "create_reminder", label: "Criar lembrete" },
  { value: "notify_attendant", label: "Notificar atendente" },
  { value: "trigger_automation", label: "Disparar automação" },
];

const conditionTypes: Array<{ value: CampaignStepCondition["type"]; label: string }> = [
  { value: "replied", label: "Respondeu" },
  { value: "has_tag", label: "Tem tag" },
  { value: "channel_is", label: "Canal é" },
  { value: "outside_window", label: "Fora 24h" },
];

const conditionActions: Array<{ value: CampaignStepCondition["action"]; label: string }> = [
  { value: "exit", label: "Sair" },
  { value: "branch", label: "Ir para step" },
  { value: "skip", label: "Pular" },
  { value: "wait", label: "Aguardar" },
];

const segmentFields: Array<{ value: SegmentField; label: string }> = [
  { value: "tag", label: "Tag" },
  { value: "status", label: "Status" },
  { value: "channel", label: "Canal" },
  { value: "lastMessageAt", label: "Última msg" },
  { value: "createdAt", label: "Criado em" },
  { value: "procedure", label: "Procedimento" },
  { value: "instagramRelationship", label: "Relação IG" },
];

const segmentOperators: Array<{ value: SegmentOperator; label: string }> = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "exists", label: "Existe" },
  { value: "not_exists", label: "Não existe" },
  { value: "before", label: "Antes" },
  { value: "after", label: "Depois" },
];

const builderTabs: Array<{ value: BuilderTab; label: string; description: string }> = [
  { value: "base", label: "Base", description: "Nome, canal e templates" },
  { value: "audience", label: "Audiência", description: "Segmento e CSV" },
  { value: "steps", label: "Passos", description: "Mensagens e regras" },
  { value: "preview", label: "Preview", description: "Fluxo final" },
];

export function CampaignFlowBuilder({
  onOpenCampaignTab,
}: {
  onOpenCampaignTab?: (tab: CampaignWorkspaceTab) => void;
} = {}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const createCampaign = trpc.campaigns.create.useMutation({
    async onSuccess(result) {
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Campanha criada",
        description: `Rascunho #${result.campaign.id} salvo sem enfileirar envio.`,
        variant: "success",
      });
    },
    onError(error) {
      toast.push({
        title: "Falha ao criar campanha",
        description: error.message,
        variant: "danger",
      });
    },
  });

  const [name, setName] = useState("Lançamento Coleção Inverno");
  const [channel, setChannel] = useState<ChannelType>("whatsapp");
  const [evergreen, setEvergreen] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [segmentEnabled, setSegmentEnabled] = useState(false);
  const [segmentField, setSegmentField] = useState<SegmentField>("status");
  const [segmentOperator, setSegmentOperator] = useState<SegmentOperator>("eq");
  const [segmentValue, setSegmentValue] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([newStepDraft(1)]);
  const [activeTab, setActiveTab] = useState<BuilderTab>("base");
  const [csvText, setCsvText] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResult | null>(null);
  const [abEnabled, setAbEnabled] = useState(false);
  const [abControlLabel, setAbControlLabel] = useState("Controle");
  const [abControlWeight, setAbControlWeight] = useState("50");
  const [abVariantLabel, setAbVariantLabel] = useState("Variante B");
  const [abVariantWeight, setAbVariantWeight] = useState("50");
  const [abVariantTemplate, setAbVariantTemplate] = useState(
    "Oi {{nome}}, tenho uma sugestão objetiva para você.",
  );
  const [saveState, setSaveState] = useState<DraftSaveState>("dirty");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const dirtyReadyRef = useRef(false);

  const stepBuildResult = useMemo(() => buildSteps(steps), [steps]);
  const stepBuildError = typeof stepBuildResult === "string" ? stepBuildResult : null;
  const previewSteps = typeof stepBuildResult === "string" ? [] : stepBuildResult;
  const abTargetStep = previewSteps.find((step) => step.type === "text") ?? null;
  const unsupportedInstagramSteps =
    channel === "instagram" ? unsupportedInstagramStepLabels(steps) : [];
  const readyChecks = buildReadyChecks({
    name,
    previewSteps,
    stepBuildError,
    channel,
    steps,
    csvPreview,
    abEnabled,
    abTargetStep,
  });

  useEffect(() => {
    if (!dirtyReadyRef.current) {
      dirtyReadyRef.current = true;
      return;
    }
    setSaveState("dirty");
  }, [
    abControlLabel,
    abControlWeight,
    abEnabled,
    abVariantLabel,
    abVariantTemplate,
    abVariantWeight,
    channel,
    csvPreview,
    evergreen,
    name,
    overlayEnabled,
    segmentEnabled,
    segmentField,
    segmentOperator,
    segmentValue,
    steps,
  ]);

  function validateDraft(): CampaignStep[] | null {
    if (!name.trim()) {
      toast.push({ title: "Nome obrigatório", variant: "warning" });
      setActiveTab("base");
      setTimeout(() => nameInputRef.current?.focus(), 0);
      return null;
    }
    if (typeof stepBuildResult === "string") {
      toast.push({ title: "Revise os steps", description: stepBuildResult, variant: "warning" });
      setActiveTab("steps");
      return null;
    }
    if (unsupportedInstagramSteps.length > 0) {
      toast.push({
        title: "Steps incompatíveis com Instagram",
        description: `Remova ou troque: ${unsupportedInstagramSteps.join(", ")}.`,
        variant: "warning",
      });
      setActiveTab("steps");
      return null;
    }
    if (csvPreview && csvPreview.validCount === 0) {
      toast.push({
        title: "CSV sem destinatários válidos",
        description: "Corrija a coluna de telefone ou remova o CSV antes de salvar o rascunho.",
        variant: "warning",
      });
      setActiveTab("audience");
      return null;
    }
    if (abEnabled && !stepBuildResult.some((step) => step.type === "text")) {
      toast.push({
        title: "A/B precisa de step texto",
        description: "Adicione um step de texto para aplicar o override da variante B.",
        variant: "warning",
      });
      setActiveTab("steps");
      return null;
    }
    return stepBuildResult;
  }

  function createDraft(options: { afterSuccess?: () => void } = {}) {
    const validSteps = validateDraft();
    if (!validSteps) return;
    const abVariants = buildAbVariantsMetadata({
      enabled: abEnabled,
      steps: validSteps,
      controlLabel: abControlLabel,
      controlWeight: abControlWeight,
      variantLabel: abVariantLabel,
      variantWeight: abVariantWeight,
      variantTemplate: abVariantTemplate,
    });

    const payload = {
      name: name.trim(),
      channel,
      evergreen,
      segment: buildSegment(segmentEnabled, segmentField, segmentOperator, segmentValue),
      steps: validSteps,
      metadata: {
        source: "visual_builder",
        builderVersion: "v2.10",
        overlayEnabled,
        ...(abVariants ? { abVariants } : {}),
        csvPreview: csvPreview
          ? {
              totalRows: csvPreview.totalRows,
              validCount: csvPreview.validCount,
              invalidCount: csvPreview.invalidCount,
              duplicateCount: csvPreview.duplicateCount,
              phoneHeader: csvPreview.phoneHeader,
            }
          : null,
      },
    };
    setSaveState("saving");
    createCampaign.mutate(payload, {
      onSuccess() {
        setSaveState("saved");
        options.afterSuccess?.();
      },
      onError() {
        setSaveState("error");
      },
    });
  }

  function testFlow() {
    if (!validateDraft()) return;
    setActiveTab("preview");
  }

  function reviewAndActivate() {
    createDraft({ afterSuccess: () => onOpenCampaignTab?.("dispatch") ?? setActiveTab("preview") });
  }

  function focusNameInput() {
    setActiveTab("base");
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  }

  function applyTemplate(templateId: string) {
    const template = campaignTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setName(template.name);
    setChannel("whatsapp");
    setEvergreen(template.evergreen);
    setSteps(
      template.steps.map((step, index) => ({
        ...newStepDraft(index + 1),
        ...step,
        conditions: step.conditions
          ? step.conditions.map((condition, conditionIndex) => ({
              ...condition,
              id: `${condition.id}-${Date.now()}-${conditionIndex}`,
            }))
          : [],
      })),
    );
    setActiveTab("steps");
    toast.push({
      title: "Template aplicado",
      description: `${template.name} carregado como rascunho editável.`,
      variant: "success",
    });
  }

  function reorderStepsFromCanvas(orderedStepIds: string[]) {
    setSteps((current) => {
      const byId = new Map(current.map((step) => [step.id, step]));
      const ordered = orderedStepIds
        .map((stepId) => byId.get(stepId))
        .filter((step): step is StepDraft => Boolean(step));
      const missing = current.filter((step) => !orderedStepIds.includes(step.id));
      const next = [...ordered, ...missing];
      if (next.length !== current.length) {
        return current;
      }
      const changed = next.some((step, index) => step.id !== current[index]?.id);
      return changed ? next : current;
    });
  }

  async function loadCsvFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setCsvPreview(parseCsvPreview(text));
  }

  function processCsvPreview() {
    const preview = parseCsvPreview(csvText);
    setCsvPreview(preview);
    toast.push({
      title: "CSV validado",
      description: `${preview.validCount} válido(s), ${preview.invalidCount} inválido(s), ${preview.duplicateCount} duplicado(s).`,
      variant: preview.validCount > 0 ? "success" : "warning",
    });
  }

  const draftStatusText = createCampaign.isPending
    ? "Salvando..."
    : saveState === "saved"
      ? "Rascunho salvo"
      : saveState === "error"
        ? "Falha ao salvar. Tente novamente."
        : stepBuildError
          ? "Rascunho com erro"
          : "Alterações não salvas";

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as BuilderTab)}>
      <div className="nuoma-flow-studio" data-testid="campaign-flow-studio-v2">
        <header className="nuoma-flow-topbar">
          <div className="nuoma-flow-title">
	            <div className="nuoma-flow-title-line">
	              <span>Flow Studio</span>
	              <span className="nuoma-flow-title-slash">/</span>
	              <span>{name || "Campanha sem nome"}</span>
	              <button type="button" aria-label="Editar nome do fluxo" onClick={focusNameInput}>
	                <Pencil className="h-3.5 w-3.5" />
	              </button>
	            </div>
	            <div className="nuoma-flow-status">
	              <span />
	              {draftStatusText}
	            </div>
	          </div>

	          <div className="nuoma-flow-account">
	            <Badge variant={channel === "instagram" ? "warning" : "success"}>
	              {channel === "instagram" ? "Instagram" : "WhatsApp"}
	            </Badge>
	            <Badge variant={readyChecks.some((check) => !check.ok) ? "warning" : "success"}>
	              {readyChecks.filter((check) => !check.ok).length} pendência(s)
	            </Badge>
	          </div>
	        </header>

        <div className="nuoma-flow-actionbar">
          <button
            type="button"
            className="nuoma-flow-button nuoma-flow-button-outline"
            onClick={testFlow}
          >
            <BadgeCheck className="h-4 w-4" />
            Testar fluxo
          </button>
          <button
            type="button"
            className="nuoma-flow-button nuoma-flow-button-dark"
            onClick={reviewAndActivate}
          >
            Revisar disparo
          </button>
          <div className="nuoma-flow-activate-group">
            <button
              type="button"
              onClick={reviewAndActivate}
            >
              Revisar e ativar
            </button>
          </div>
        </div>

        <div className="nuoma-flow-body">
          <aside className="nuoma-flow-rail">
            <div className="nuoma-flow-rail-title">Etapas do fluxo</div>
            <TabsList className="nuoma-flow-tabs">
              {builderTabs.map((tab, index) => {
                const visualState = index < 2 ? "done" : index === 2 ? "active" : "upcoming";
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="nuoma-flow-step-tab"
                    data-flow-state={visualState}
                    data-testid={`campaign-builder-tab-${tab.value}`}
                  >
                    <span className="nuoma-flow-step-marker">
                      {visualState === "done" ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </span>
                    <span className="nuoma-flow-step-copy">
                      <span>{tab.label}</span>
                      <span>
                        {tab.value === "base"
                          ? "Configurações gerais"
                          : tab.value === "audience"
                            ? "Quem vai receber"
                            : tab.value === "steps"
                              ? "Construa seu fluxo"
                              : "Revise e teste"}
                      </span>
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </aside>

          <section className="nuoma-flow-stage">
            <CampaignFlowCanvasBoard
              steps={steps}
              channel={channel}
              evergreen={evergreen}
              csvPreview={csvPreview}
              segmentEnabled={segmentEnabled}
              abEnabled={abEnabled}
              onOpenSteps={() => setActiveTab("steps")}
              onOpenPreview={() => setActiveTab("preview")}
              onReorderSteps={reorderStepsFromCanvas}
            />

            <div className="nuoma-flow-editor-panels" aria-label="Edição funcional do fluxo">
              <TabsContent value="base" data-testid="campaign-builder-base">
                <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="nuoma-compat-surface rounded-xl p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-primary">
                      <ClipboardList className="h-4 w-4 text-accent" />
                      Configuração
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_12rem_10rem_10rem]">
                      <LabeledField
                        label="Nome"
                        error={name.trim() ? null : "Nome obrigatório."}
                        errorId="campaign-name-error"
                      >
                        <Input
                          ref={nameInputRef}
                          value={name}
                          invalid={!name.trim()}
                          aria-invalid={!name.trim()}
                          aria-describedby={!name.trim() ? "campaign-name-error" : undefined}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </LabeledField>
                      <LabeledField label="Canal">
                        <ChannelSelect value={channel} onValueChange={setChannel} />
                      </LabeledField>
                      <label className="flex min-h-[4.25rem] items-center gap-3 rounded-lg bg-bg-base px-4 py-3 shadow-pressed-sm">
                        <Switch
                          checked={evergreen}
                          onCheckedChange={setEvergreen}
                          aria-label="Campanha evergreen"
                        />
                        <span className="text-sm text-fg-muted">Evergreen</span>
                      </label>
                      <label className="flex min-h-[4.25rem] items-center gap-3 rounded-lg bg-bg-base px-4 py-3 shadow-pressed-sm">
                        <Switch
                          checked={overlayEnabled}
                          onCheckedChange={setOverlayEnabled}
                          aria-label="Campanha disponível no overlay"
                        />
                        <span className="text-sm text-fg-muted">
                          Overlay {overlayEnabled ? "sim" : "não"}
                        </span>
                      </label>
                    </div>
                  </div>
                  <div className="nuoma-compat-surface rounded-xl p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-primary">
                      <Sparkles className="h-4 w-4 text-accent" />
                      Templates
                    </div>
                    <div className="grid gap-2">
                      {campaignTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => applyTemplate(template.id)}
                          className="rounded-lg bg-bg-base px-3 py-3 text-left shadow-flat transition-shadow hover:shadow-raised-sm"
                          data-testid="campaign-template-card"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-fg-primary">
                              {template.name}
                            </span>
                            <Badge variant={template.evergreen ? "success" : "neutral"}>
                              {template.steps.length} steps
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-fg-dim">
                            {template.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <AbVariantsPanel
                  enabled={abEnabled}
                  onEnabledChange={setAbEnabled}
                  controlLabel={abControlLabel}
                  onControlLabelChange={setAbControlLabel}
                  controlWeight={abControlWeight}
                  onControlWeightChange={setAbControlWeight}
                  variantLabel={abVariantLabel}
                  onVariantLabelChange={setAbVariantLabel}
                  variantWeight={abVariantWeight}
                  onVariantWeightChange={setAbVariantWeight}
                  variantTemplate={abVariantTemplate}
                  onVariantTemplateChange={setAbVariantTemplate}
                  targetStepLabel={abTargetStep?.label ?? null}
                />
              </TabsContent>

              <TabsContent value="audience" data-testid="campaign-builder-audience">
                <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-xl bg-bg-deep/80 p-4 shadow-pressed-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-fg-primary">Segmento</div>
                        <div className="text-xs text-fg-dim">
                          Filtro simples salvo no contrato da campanha.
                        </div>
                      </div>
                      <Checkbox
                        checked={segmentEnabled}
                        onCheckedChange={(checked) => setSegmentEnabled(checked === true)}
                        aria-label="Ativar segmento"
                      />
                    </div>
                    {segmentEnabled && (
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_9rem_1fr]">
                        <LabeledField label="Campo">
                          <Select
                            value={segmentField}
                            onValueChange={(value) => setSegmentField(value as SegmentField)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {segmentFields.map((field) => (
                                <SelectItem key={field.value} value={field.value}>
                                  {field.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </LabeledField>
                        <LabeledField label="Operador">
                          <Select
                            value={segmentOperator}
                            onValueChange={(value) => setSegmentOperator(value as SegmentOperator)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {segmentOperators.map((operator) => (
                                <SelectItem key={operator.value} value={operator.value}>
                                  {operator.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </LabeledField>
                        <LabeledField label="Valor">
                          <Input
                            value={segmentValue}
                            disabled={
                              segmentOperator === "exists" || segmentOperator === "not_exists"
                            }
                            onChange={(event) => setSegmentValue(event.target.value)}
                          />
                        </LabeledField>
                      </div>
                    )}
                  </div>

                  <CsvPreviewPanel
                    csvText={csvText}
                    csvPreview={csvPreview}
                    onCsvTextChange={setCsvText}
                    onCsvFile={loadCsvFile}
                    onProcess={processCsvPreview}
                  />
                </div>
              </TabsContent>

              <TabsContent value="steps" data-testid="campaign-builder-steps">
                <StepList value={steps} onChange={setSteps} title="Steps" channel={channel} />
              </TabsContent>

              <TabsContent value="preview" data-testid="campaign-builder-preview">
                <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <CampaignPreviewPanel
                    name={name}
                    channel={channel}
                    evergreen={evergreen}
                    steps={previewSteps}
                    stepError={stepBuildError}
                    csvPreview={csvPreview}
                    segmentEnabled={segmentEnabled}
                    abEnabled={abEnabled}
                  />
                  <WorkflowViewer
                    steps={steps}
                    channel={channel}
                    evergreen={evergreen}
                    csvPreview={csvPreview}
                    segmentEnabled={segmentEnabled}
                    abEnabled={abEnabled}
                    className="min-h-full"
                  />
                </div>
              </TabsContent>
            </div>
          </section>

          <FlowStudioInspector
            activeTab={activeTab}
            readyChecks={readyChecks}
            channel={channel}
            evergreen={evergreen}
            stepCount={previewSteps.length}
            csvPreview={csvPreview}
            abEnabled={abEnabled}
            stepBuildError={stepBuildError}
            createPending={createCampaign.isPending}
            onCreateDraft={createDraft}
            onReviewAndActivate={reviewAndActivate}
            onOpenCampaignTab={onOpenCampaignTab}
          />
        </div>
      </div>
    </Tabs>
  );
}

function CampaignFlowCanvasBoard({
  steps,
  channel,
  evergreen,
  csvPreview,
  segmentEnabled,
  abEnabled,
  onOpenSteps,
  onOpenPreview,
  onReorderSteps,
}: {
  steps: StepDraft[];
  channel: ChannelType;
  evergreen: boolean;
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
  abEnabled: boolean;
  onOpenSteps: () => void;
  onOpenPreview: () => void;
  onReorderSteps: (orderedStepIds: string[]) => void;
}) {
  const graph = useMemo(
    () =>
      buildCampaignFlowGraph({
        steps,
        channel,
        evergreen,
        csvPreview,
        segmentEnabled,
        abEnabled,
        onOpenSteps,
      }),
    [abEnabled, channel, csvPreview, evergreen, onOpenSteps, segmentEnabled, steps],
  );
	  const [nodes, setNodes, onNodesChange] = useNodesState<CampaignCanvasNode>(graph.nodes);
	  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(graph.edges);
	  const [flowInstance, setFlowInstance] =
	    useState<ReactFlowInstance<CampaignCanvasNode, Edge> | null>(null);
	  const [zoomPercent, setZoomPercent] = useState(100);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph.edges, graph.nodes, setEdges, setNodes]);

	  const handleNodeDragStop = useCallback<OnNodeDrag<CampaignCanvasNode>>(
    (_event, _node, currentNodes) => {
      const orderedStepIds = currentNodes
        .filter((node) => node.data.kind === "step" || node.data.kind === "branch")
        .sort((a, b) => a.position.y - b.position.y)
        .map((node) => node.id);
      onReorderSteps(orderedStepIds);
    },
    [onReorderSteps],
	  );
	  const fitCanvas = useCallback(() => {
	    void flowInstance?.fitView({ padding: 0.24, includeHiddenNodes: false, duration: 180 });
	  }, [flowInstance]);
	  const zoomCanvasIn = useCallback(() => {
	    void flowInstance?.zoomIn({ duration: 140 });
	  }, [flowInstance]);
	  const zoomCanvasOut = useCallback(() => {
	    void flowInstance?.zoomOut({ duration: 140 });
	  }, [flowInstance]);

  return (
    <div className="nuoma-flow-board" data-testid="campaign-flow-canvas-board">
      <div className="nuoma-flow-board-toolbar" aria-label="Ferramentas do canvas">
	        <button type="button" aria-label="Selecionar" className="is-active" title="Selecionar">
	          <MousePointer2 className="h-4 w-4" />
	        </button>
        <button
          type="button"
          aria-label="Editar passos"
          title="Editar passos"
          onClick={onOpenSteps}
        >
          <Route className="h-4 w-4" />
        </button>
	        <button type="button" aria-label="Ajustar tela" title="Ajustar tela" onClick={fitCanvas}>
	          <Maximize2 className="h-4 w-4" />
	        </button>
	        <span className="nuoma-flow-toolbar-divider" />
	        <button type="button" aria-label="Reduzir zoom" title="Reduzir zoom" onClick={zoomCanvasOut}>
	          <Minimize2 className="h-4 w-4" />
	        </button>
	        <button
	          type="button"
	          aria-label="Zoom atual"
	          className="nuoma-flow-zoom-label"
	          onClick={fitCanvas}
	        >
	          {zoomPercent}%
	        </button>
	        <button type="button" aria-label="Aumentar zoom" title="Aumentar zoom" onClick={zoomCanvasIn}>
	          <ZoomIn className="h-4 w-4" />
	        </button>
        <span className="nuoma-flow-toolbar-divider" />
        <button
          type="button"
          aria-label="Abrir preview"
          title="Abrir preview"
          onClick={onOpenPreview}
        >
          <PanelRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Arraste nós para reordenar steps"
          title="Arraste nós para reordenar steps"
        >
          <LockKeyhole className="h-4 w-4" />
        </button>
      </div>

      <div className="nuoma-flow-reactflow" data-testid="campaign-xyflow-canvas">
        <ReactFlow<CampaignCanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={campaignFlowNodeTypes}
	          onNodesChange={onNodesChange}
	          onEdgesChange={onEdgesChange}
	          onNodeDragStop={handleNodeDragStop}
	          onInit={(instance) => {
	            setFlowInstance(instance);
	            setZoomPercent(Math.round(instance.getZoom() * 100));
	          }}
	          onMoveEnd={(_event, viewport) => setZoomPercent(Math.round(viewport.zoom * 100))}
	          fitView
          fitViewOptions={{ padding: 0.24, includeHiddenNodes: false }}
          minZoom={0.45}
          maxZoom={1.35}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          preventScrolling={false}
        >
          <Background color="var(--nw-flow-grid)" gap={28} size={1.15} />
          <MiniMap
            pannable
            zoomable
            className="nuoma-flow-xy-minimap"
            nodeColor={(node) => flowToneColor((node as CampaignCanvasNode).data.tone)}
          />
          <Controls className="nuoma-flow-xy-controls" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

type CampaignCanvasTone = "cyan" | "wa" | "ig" | "violet" | "neutral" | "danger";

type CampaignCanvasNodeData = {
  label: string;
  meta: string;
  summary: string;
  iconType: BuilderStepType | "start" | "end" | "branch";
  tone: CampaignCanvasTone;
  kind: "start" | "step" | "branch" | "end";
  conditionCount?: number;
  onOpenSteps?: () => void;
};

type CampaignCanvasNode = Node<CampaignCanvasNodeData, "campaignCanvas">;

const campaignFlowNodeTypes: NodeTypes = {
  campaignCanvas: CampaignFlowNode,
};

function CampaignFlowNode({ data }: NodeProps<CampaignCanvasNode>) {
  const Icon = flowCanvasIcon(data.iconType);
  const isStart = data.kind === "start";
  const isEnd = data.kind === "end";
  return (
    <div
      className={cn(
        "nuoma-flow-xy-node",
        `nuoma-flow-xy-node-${data.tone}`,
        data.kind === "branch" && "nuoma-flow-xy-node-branch",
      )}
      onDoubleClick={data.onOpenSteps}
    >
      {!isStart ? <Handle type="target" position={Position.Left} /> : null}
      <div className="nuoma-flow-xy-node-head">
        <span className="nuoma-flow-xy-node-icon">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="nuoma-flow-xy-node-title">{data.label}</div>
          <div className="nuoma-flow-xy-node-meta">
            {data.meta.split("\n").map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="nuoma-flow-xy-node-summary">{data.summary}</div>
      {data.kind === "branch" ? (
        <div className="nuoma-flow-xy-branch-row">
          <button type="button" className="nodrag" onClick={data.onOpenSteps}>
            Sim
          </button>
          <button type="button" className="nodrag" onClick={data.onOpenSteps}>
            Não
          </button>
        </div>
      ) : data.conditionCount ? (
        <button
          type="button"
          className="nuoma-flow-xy-condition nodrag"
          onClick={data.onOpenSteps}
        >
          {data.conditionCount} regra(s)
        </button>
      ) : null}
      {!isEnd ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

function buildCampaignFlowGraph(inputGraph: {
  steps: StepDraft[];
  channel: ChannelType;
  evergreen: boolean;
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
  abEnabled: boolean;
  onOpenSteps: () => void;
}): { nodes: CampaignCanvasNode[]; edges: Edge[] } {
  const rowGap = 142;
  const stepX = 360;
  const startY = Math.max(70, (Math.min(inputGraph.steps.length, 4) * rowGap) / 2 - 42);
  const nodes: CampaignCanvasNode[] = [
    {
      id: "start",
      type: "campaignCanvas",
      position: { x: 36, y: startY },
      data: {
        label: "Início",
        meta: `Entrada do fluxo\n${campaignAudienceLabel(inputGraph)}`,
        summary: `${inputGraph.channel} · ${inputGraph.evergreen ? "evergreen" : "manual"} · A/B ${inputGraph.abEnabled ? "on" : "off"}`,
        iconType: "start",
        tone: "cyan",
        kind: "start",
        onOpenSteps: inputGraph.onOpenSteps,
      },
    },
  ];

  const stepIds = new Set(inputGraph.steps.map((step) => step.id));
  inputGraph.steps.forEach((step, index) => {
    const hasBranch = step.conditions.some((condition) => condition.action === "branch");
    nodes.push({
      id: step.id,
      type: "campaignCanvas",
      position: { x: stepX, y: index * rowGap + 36 },
      data: {
        label: step.label || `Step ${index + 1}`,
        meta: `${step.type} · delay ${step.delaySeconds || 0}s`,
        summary: stepDraftCanvasSummary(step),
        iconType: hasBranch ? "branch" : step.type,
        tone: stepTone(step, inputGraph.channel, hasBranch),
        kind: hasBranch ? "branch" : "step",
        conditionCount: step.conditions.length || undefined,
        onOpenSteps: inputGraph.onOpenSteps,
      },
    });
  });

  nodes.push({
    id: "end",
    type: "campaignCanvas",
    position: { x: 720, y: Math.max(36, inputGraph.steps.length * rowGap - 80) },
    data: {
      label: "Fim",
      meta: "Saída do fluxo\nEncerrar jornada",
      summary: "Finaliza o contato atual antes do próximo contato na fila.",
      iconType: "end",
      tone: "neutral",
      kind: "end",
      onOpenSteps: inputGraph.onOpenSteps,
    },
  });

  const edges: Edge[] = [];
  const markerEnd = { type: MarkerType.ArrowClosed, color: "var(--nw-flow-edge)" };
  const defaultEdge = {
    type: "smoothstep",
    markerEnd,
    style: { stroke: "var(--nw-flow-edge)", strokeWidth: 2 },
  };
  const firstStep = inputGraph.steps[0];
  edges.push({
    id: firstStep ? "start-to-first" : "start-to-end",
    source: "start",
    target: firstStep?.id ?? "end",
    ...defaultEdge,
  });

  inputGraph.steps.forEach((step, index) => {
    const nextStep = inputGraph.steps[index + 1];
    edges.push({
      id: `${step.id}-next`,
      source: step.id,
      target: nextStep?.id ?? "end",
      label: nextStep ? "próximo" : "concluir",
      ...defaultEdge,
    });
    step.conditions.forEach((condition, conditionIndex) => {
      if (
        condition.action === "branch" &&
        condition.targetStepId &&
        stepIds.has(condition.targetStepId)
      ) {
        edges.push({
          id: `${step.id}-branch-${conditionIndex}`,
          source: step.id,
          target: condition.targetStepId,
          label: conditionLabel(condition),
          type: "smoothstep",
          markerEnd,
          style: { stroke: "var(--nw-flow-branch)", strokeWidth: 2 },
          labelStyle: { fill: "var(--nw-flow-label)", fontSize: 11, fontWeight: 600 },
        });
      }
      if (condition.action === "exit") {
        edges.push({
          id: `${step.id}-exit-${conditionIndex}`,
          source: step.id,
          target: "end",
          label: conditionLabel(condition),
          type: "smoothstep",
          markerEnd,
          style: { stroke: "var(--nw-flow-exit)", strokeWidth: 2 },
          labelStyle: { fill: "var(--nw-flow-exit)", fontSize: 11, fontWeight: 600 },
        });
      }
    });
  });

  return { nodes, edges };
}

function campaignAudienceLabel(inputGraph: {
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
}) {
  if (inputGraph.csvPreview) return `${inputGraph.csvPreview.validCount} contatos elegíveis`;
  return inputGraph.segmentEnabled ? "Segmento ativo" : "Todos que entram";
}

function flowCanvasIcon(iconType: CampaignCanvasNodeData["iconType"]) {
  if (iconType === "start") return PlayCircle;
  if (iconType === "end") return Flag;
  if (iconType === "branch") return GitBranch;
  return stepIcon(iconType);
}

function stepTone(step: StepDraft, channel: ChannelType, hasBranch: boolean): CampaignCanvasTone {
  if (hasBranch) return "violet";
  if (step.type === "temporary_messages" || step.type === "voice") return "cyan";
  if (channel === "instagram" || step.type === "image" || step.type === "video") return "ig";
  if (step.type === "document") return "neutral";
  return "wa";
}

function flowToneColor(tone: CampaignCanvasTone) {
  if (tone === "wa") return "var(--nw-flow-wa)";
  if (tone === "ig") return "var(--nw-flow-ig)";
  if (tone === "violet") return "var(--nw-flow-accent)";
  if (tone === "danger") return "var(--nw-flow-danger)";
  if (tone === "neutral") return "var(--nw-flow-neutral)";
  return "var(--nw-flow-accent)";
}

function conditionLabel(condition: ConditionDraft) {
  const type =
    conditionTypes.find((item) => item.value === condition.type)?.label ?? condition.type;
  const value = condition.value.trim();
  return value ? `${type}: ${value}` : type;
}

function stepDraftCanvasSummary(step: StepDraft) {
  if (step.type === "temporary_messages") return `Temporárias ${step.temporaryMessagesDuration}`;
  if (step.type === "text") return step.template || "Mensagem de texto";
  if (step.type === "link") return `${step.linkText || "Link"} - ${step.url || "URL pendente"}`;
  if (step.type === "document")
    return `${step.fileName || "Documento"} - asset #${step.mediaAssetId || "-"}`;
  if (step.type === "voice") return step.fileName || "Voice note PTT";
  return step.caption || "Mídia sem legenda";
}

function FlowStudioInspector({
  activeTab,
  readyChecks,
  channel,
  evergreen,
  stepCount,
  csvPreview,
  abEnabled,
  stepBuildError,
  createPending,
  onCreateDraft,
  onReviewAndActivate,
  onOpenCampaignTab,
}: {
  activeTab: BuilderTab;
  readyChecks: Array<{ label: string; ok: boolean }>;
  channel: ChannelType;
  evergreen: boolean;
  stepCount: number;
  csvPreview: CsvPreviewResult | null;
  abEnabled: boolean;
  stepBuildError: string | null;
  createPending: boolean;
  onCreateDraft: () => void;
  onReviewAndActivate: () => void;
  onOpenCampaignTab?: (tab: CampaignWorkspaceTab) => void;
}) {
  const readyCount = readyChecks.filter((check) => check.ok).length;
  const failedChecks = readyChecks.filter((check) => !check.ok);
  const validationIssueCount = failedChecks.length;
  const isFlowValid = validationIssueCount === 0;
  const validationStatus = isFlowValid ? "valid" : "invalid";
  const estimatedAudience = csvPreview?.validCount
    ? csvPreview.validCount.toLocaleString("pt-BR")
    : "Sem estimativa";
  return (
    <aside className="nuoma-flow-inspector" data-active-tab={activeTab}>
      <h2>Resumo e validação</h2>

      <section
        className="nuoma-flow-inspector-card nuoma-flow-valid-card"
        data-testid="campaign-flow-validation-card"
        data-status={validationStatus}
      >
        <div className="nuoma-flow-card-head">
          <span
            className={cn("nuoma-flow-card-icon", isFlowValid ? "is-success" : "is-warning")}
          >
            {isFlowValid ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </span>
          <div>
            <strong>{isFlowValid ? "Fluxo válido" : "Fluxo com pendências"}</strong>
            <span>
              {isFlowValid
                ? "Tudo pronto para ativação."
                : `${validationIssueCount} item(ns) precisam de revisão.`}
            </span>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs">
          {readyChecks.map((check) => (
            <div
              key={check.label}
              className="flex items-center justify-between gap-3"
              data-testid="campaign-flow-validation-check"
              data-ok={check.ok ? "true" : "false"}
            >
              <span className="text-fg-muted">{check.label}</span>
              <Badge variant={check.ok ? "success" : "warning"}>
                {check.ok ? "ok" : "revisar"}
              </Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="nuoma-flow-inspector-card">
        <div className="nuoma-flow-card-head">
          <span className="nuoma-flow-card-icon">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <strong>Safe Dispatch</strong>
            <span>{isFlowValid ? "Validação pronta" : "Validação pendente"}</span>
          </div>
          <span className="nuoma-flow-toggle" />
        </div>
        <p>
          {isFlowValid
            ? "O fluxo pode seguir para revisão de disparo."
            : "Resolva as pendências antes de criar Jobs de envio."}
        </p>
        <div className="nuoma-flow-safe-grid">
          <div>
            <span>Checks ok</span>
            <strong>{readyCount}/{readyChecks.length}</strong>
          </div>
          <div>
            <span>Pendências</span>
            <strong>{failedChecks.length}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{isFlowValid ? "Liberado" : "Revisar"}</strong>
          </div>
        </div>
      </section>

      <section className="nuoma-flow-inspector-card nuoma-flow-audience-card">
        <div className="nuoma-flow-card-head">
          <span className="nuoma-flow-card-icon">
            <Users className="h-4 w-4" />
          </span>
          <div>
            <strong>Audiência estimada</strong>
          </div>
        </div>
        <div className="nuoma-flow-audience-value">{estimatedAudience}</div>
        <div className="nuoma-flow-audience-foot">
          <span>Contatos elegíveis</span>
          <strong>{csvPreview ? "CSV validado" : "Valide CSV ou segmento"}</strong>
        </div>
      </section>

      <section className="nuoma-flow-inspector-card nuoma-flow-compact-card">
        <div className="nuoma-flow-card-head">
          <span className="nuoma-flow-card-icon">
            <GitBranch className="h-4 w-4" />
          </span>
          <div>
            <strong>Passos do fluxo</strong>
            <span>{stepCount} passos</span>
          </div>
          <button type="button" onClick={() => onOpenCampaignTab?.("recipients")}>
            Ver detalhes
          </button>
        </div>
      </section>

      <section className="nuoma-flow-inspector-card nuoma-flow-alert-card">
        <div className="nuoma-flow-card-head">
          <span className="nuoma-flow-card-icon is-warning">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <strong>Possíveis alertas</strong>
          </div>
          <span>{validationIssueCount} alerta(s)</span>
        </div>
        <div className="nuoma-flow-alert-copy">
          <strong>{isFlowValid ? "Sem bloqueios críticos" : "Revise antes de ativar"}</strong>
          <p>
            {isFlowValid
              ? "O fluxo pode seguir para revisão de disparo."
              : "Corrija os itens abaixo antes de salvar ou ativar."}
          </p>
          {failedChecks.length > 0 ? (
            <ul>
              {failedChecks.map((check) => (
                <li key={check.label}>{check.label}</li>
              ))}
            </ul>
          ) : null}
          {stepBuildError ? <p>{stepBuildError}</p> : null}
        </div>
      </section>

      <div className="nuoma-flow-inspector-actions">
        <button
          type="button"
          className="nuoma-flow-submit"
          disabled={createPending}
          onClick={onReviewAndActivate}
        >
          <Send className="h-4 w-4" />
          {createPending ? "Salvando..." : "Revisar e ativar fluxo"}
        </button>
        <button type="button" className="nuoma-flow-save" disabled={createPending} onClick={onCreateDraft}>
          Salvar rascunho
        </button>
      </div>

      <div className="nuoma-flow-inspector-meta" aria-hidden="true">
        <span>{channel}</span>
        <span>{evergreen ? "evergreen" : "manual"}</span>
        <span>{abEnabled ? "A/B on" : `${readyCount}/${readyChecks.length}`}</span>
      </div>
    </aside>
  );
}

function CsvPreviewPanel({
  csvText,
  csvPreview,
  onCsvTextChange,
  onCsvFile,
  onProcess,
}: {
  csvText: string;
  csvPreview: CsvPreviewResult | null;
  onCsvTextChange: (value: string) => void;
  onCsvFile: (file: File | null) => void | Promise<void>;
  onProcess: () => void;
}) {
  const visibleRows = csvPreview?.rows.slice(0, 8) ?? [];
  return (
    <div
      className="rounded-xl bg-bg-deep/80 p-4 shadow-pressed-sm"
      data-testid="campaign-csv-preview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <FileUp className="h-4 w-4 text-accent" />
            CSV preview
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-dim">
            Valida telefone, duplicatas e linhas antes de criar qualquer recipient.
          </p>
        </div>
        <Button variant="soft" size="sm" onClick={onProcess} data-testid="campaign-csv-process">
          Validar
        </Button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.1fr]">
        <LabeledField label="Arquivo CSV">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void onCsvFile(event.currentTarget.files?.[0] ?? null)}
            data-testid="campaign-csv-file"
          />
        </LabeledField>
        <LabeledField label="Colar CSV">
          <Textarea
            rows={4}
            value={csvText}
            placeholder={"nome,telefone\nMaria,+55 31 98206-6263"}
            onChange={(event) => onCsvTextChange(event.target.value)}
            data-testid="campaign-csv-text"
          />
        </LabeledField>
      </div>
      {csvPreview && (
        <div className="mt-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <CampaignPreviewMetric label="linhas" value={csvPreview.totalRows} />
            <CampaignPreviewMetric label="válidas" value={csvPreview.validCount} tone="success" />
            <CampaignPreviewMetric
              label="inválidas"
              value={csvPreview.invalidCount}
              tone="danger"
            />
            <CampaignPreviewMetric
              label="duplicadas"
              value={csvPreview.duplicateCount}
              tone="warning"
            />
          </div>
          <div className="mt-3 rounded-lg bg-bg-base shadow-flat">
            <div className="grid grid-cols-[4rem_1fr_1fr_6rem] gap-2 border-b border-contour-line/40 px-3 py-2 font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
              <span>Linha</span>
              <span>Telefone</span>
              <span>Nome</span>
              <span>Status</span>
            </div>
            <div
              className="max-h-64 overflow-y-auto"
              data-testid="campaign-csv-rows"
              role="region"
              aria-label="Linhas validadas do CSV"
              tabIndex={0}
            >
              {visibleRows.map((row) => (
                <div
                  key={row.rowNumber}
                  className="grid grid-cols-[4rem_1fr_1fr_6rem] gap-2 px-3 py-2 text-xs"
                  data-valid={row.valid ? "true" : "false"}
                >
                  <span className="font-mono text-fg-dim">{row.rowNumber}</span>
                  <span className="truncate font-mono text-fg-primary">{row.phone || "—"}</span>
                  <span className="truncate text-fg-muted">{row.name ?? "—"}</span>
                  <Badge variant={row.valid ? "success" : "danger"}>
                    {row.valid ? "ok" : "erro"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
          {csvPreview.errors.length > 0 && (
            <ul className="mt-3 grid gap-1">
              {csvPreview.errors.slice(0, 3).map((error) => (
                <li key={error} className="text-xs text-semantic-danger">
                  {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AbVariantsPanel({
  enabled,
  onEnabledChange,
  controlLabel,
  onControlLabelChange,
  controlWeight,
  onControlWeightChange,
  variantLabel,
  onVariantLabelChange,
  variantWeight,
  onVariantWeightChange,
  variantTemplate,
  onVariantTemplateChange,
  targetStepLabel,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  controlLabel: string;
  onControlLabelChange: (value: string) => void;
  controlWeight: string;
  onControlWeightChange: (value: string) => void;
  variantLabel: string;
  onVariantLabelChange: (value: string) => void;
  variantWeight: string;
  onVariantWeightChange: (value: string) => void;
  variantTemplate: string;
  onVariantTemplateChange: (value: string) => void;
  targetStepLabel: string | null;
}) {
  return (
    <div
      className="rounded-xl bg-bg-deep/80 p-4 shadow-pressed-sm"
      data-testid="campaign-ab-builder"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <GitBranch className="h-4 w-4 text-accent" />
            A/B variants
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-dim">
            Atribuição determinística por recipient; a variante B pode trocar o texto do primeiro
            step.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Ativar A/B" />
      </div>
      {enabled && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[0.85fr_0.85fr_1.3fr]">
          <div className="grid gap-3 rounded-lg bg-bg-base p-3 shadow-flat">
            <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
              Controle
            </div>
            <LabeledField label="Label">
              <Input
                value={controlLabel}
                onChange={(event) => onControlLabelChange(event.target.value)}
              />
            </LabeledField>
            <LabeledField label="Peso">
              <Input
                inputMode="numeric"
                value={controlWeight}
                onChange={(event) => onControlWeightChange(event.target.value)}
              />
            </LabeledField>
          </div>
          <div className="grid gap-3 rounded-lg bg-bg-base p-3 shadow-flat">
            <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
              Variante
            </div>
            <LabeledField label="Label">
              <Input
                value={variantLabel}
                onChange={(event) => onVariantLabelChange(event.target.value)}
              />
            </LabeledField>
            <LabeledField label="Peso">
              <Input
                inputMode="numeric"
                value={variantWeight}
                onChange={(event) => onVariantWeightChange(event.target.value)}
              />
            </LabeledField>
          </div>
          <div className="rounded-lg bg-bg-base p-3 shadow-flat">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                Override
              </div>
              <Badge variant={targetStepLabel ? "violet" : "warning"}>
                {targetStepLabel ?? "sem step texto"}
              </Badge>
            </div>
            <LabeledField label="Mensagem B">
              <Textarea
                rows={4}
                value={variantTemplate}
                onChange={(event) => onVariantTemplateChange(event.target.value)}
              />
            </LabeledField>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignPreviewPanel({
  name,
  channel,
  evergreen,
  steps,
  stepError,
  csvPreview,
  segmentEnabled,
  abEnabled,
}: {
  name: string;
  channel: ChannelType;
  evergreen: boolean;
  steps: CampaignStep[];
  stepError: string | null;
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
  abEnabled: boolean;
}) {
  return (
    <div
      className="rounded-xl bg-bg-deep/80 p-4 shadow-pressed-sm"
      data-testid="campaign-preview-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <CheckCircle2 className="h-4 w-4 text-accent" />
            Preview do rascunho
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-dim">
            O preview não enfileira jobs e não toca no WhatsApp.
          </p>
        </div>
        <Badge variant={stepError ? "danger" : "success"}>{stepError ? "revisar" : "pronto"}</Badge>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <CampaignPreviewMetric label="canal" value={channel} />
        <CampaignPreviewMetric label="modo" value={evergreen ? "evergreen" : "manual"} />
        <CampaignPreviewMetric label="segmento" value={segmentEnabled ? "ativo" : "off"} />
        <CampaignPreviewMetric label="A/B" value={abEnabled ? "ativo" : "off"} />
        <CampaignPreviewMetric label="csv ok" value={csvPreview?.validCount ?? "—"} />
      </div>

      <div className="mt-4 rounded-lg bg-bg-base p-3 shadow-flat">
        <div className="font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
          Campanha
        </div>
        <div className="mt-1 text-sm font-medium text-fg-primary">{name || "Sem nome"}</div>
      </div>

      {stepError ? (
        <div className="mt-3 rounded-lg border border-semantic-danger/40 bg-semantic-danger/10 p-3 text-sm text-semantic-danger">
          {stepError}
        </div>
      ) : (
        <ol className="mt-3 grid gap-2">
          {steps.map((step, index) => (
            <li key={step.id} className="rounded-lg bg-bg-base p-3 shadow-flat">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg-primary">
                    {index + 1}. {step.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[0.65rem] text-fg-dim">
                    {step.type} · delay {step.delaySeconds}s · {step.conditions.length} regra(s)
                  </div>
                </div>
                <Badge variant="neutral">{step.type}</Badge>
                {step.type === "temporary_messages" ? (
                  <Badge variant="warning">{step.duration}</Badge>
                ) : null}
              </div>
              <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-fg-muted">
                {stepSummary(step)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function WorkflowViewer({
  steps,
  channel,
  evergreen,
  csvPreview,
  segmentEnabled,
  abEnabled,
  className,
}: {
  steps: StepDraft[];
  channel: ChannelType;
  evergreen: boolean;
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
  abEnabled: boolean;
  className?: string;
}) {
  const nodes = [
    {
      id: "audience",
      label: "Público",
      meta: csvPreview
        ? `${csvPreview.validCount} CSV válidos`
        : segmentEnabled
          ? "segmento ativo"
          : "manual",
      icon: FileUp,
    },
    {
      id: "campaign",
      label: "Campanha",
      meta: `${channel} · ${evergreen ? "evergreen" : "manual"} · A/B ${abEnabled ? "on" : "off"}`,
      icon: ClipboardList,
    },
    ...steps.map((step, index) => ({
      id: step.id,
      label: step.label || `Step ${index + 1}`,
      meta:
        step.type === "temporary_messages"
          ? `temporárias ${step.temporaryMessagesDuration} · ${step.delaySeconds || 0}s`
          : `${step.type} · ${step.delaySeconds || 0}s`,
      icon: stepIcon(step.type),
    })),
    {
      id: "tick",
      label: "Scheduler tick",
      meta: "dry-run ou fila segura",
      icon: GitBranch,
    },
  ];

  return (
    <div
      className={cn("nuoma-compat-surface nuoma-flow-canvas rounded-lg p-4", className)}
      data-testid="campaign-workflow-viewer"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
        <GitBranch className="h-4 w-4 text-accent" />
        Workflow
      </div>
      <div className="mt-4 grid gap-3 rounded-xl bg-bg-sunken/58 p-3">
        {nodes.map((node, index) => {
          const Icon = node.icon;
          return (
            <div key={node.id} className="relative">
              {index > 0 && (
                <div
                  className="absolute -top-3 left-5 h-3 w-px bg-accent/35"
                  aria-hidden="true"
                />
              )}
              <div
                data-workflow-node="true"
                data-testid="campaign-workflow-node"
                className="nuoma-compat-readable rounded-xl px-3 py-3 transition-transform hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent shadow-pressed-sm">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg-primary">{node.label}</div>
                    <div className="mt-0.5 truncate font-mono text-[0.65rem] text-fg-dim">
                      {node.meta}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CampaignPreviewMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-lg bg-bg-base px-3 py-2.5 shadow-flat">
      <div className="font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim">{label}</div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-sm",
          tone === "success" && "text-semantic-success",
          tone === "warning" && "text-semantic-warning",
          tone === "danger" && "text-semantic-danger",
          tone === "neutral" && "text-fg-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function AutomationFlowBuilder() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const createAutomation = trpc.automations.create.useMutation({
    async onSuccess(result) {
      await utils.automations.list.invalidate();
      toast.push({
        title: "Automação criada",
        description: `Rascunho #${result.automation.id} salvo sem criar job.`,
        variant: "success",
      });
    },
    onError(error) {
      toast.push({
        title: "Falha ao criar automação",
        description: error.message,
        variant: "danger",
      });
    },
  });

  const [name, setName] = useState("Automação de resposta");
  const [category, setCategory] = useState("Atendimento");
  const [triggerType, setTriggerType] = useState<AutomationTrigger["type"]>("message_received");
  const [triggerChannel, setTriggerChannel] = useState<ChannelType>("whatsapp");
  const [triggerTagId, setTriggerTagId] = useState("");
  const [triggerCampaignId, setTriggerCampaignId] = useState("");
  const [requireWithin24hWindow, setRequireWithin24hWindow] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [actions, setActions] = useState<ActionDraft[]>([newActionDraft(1)]);
  const [segmentEnabled, setSegmentEnabled] = useState(true);
  const [segmentOperator, setSegmentOperator] = useState<"and" | "or">("and");
  const [segmentDrafts, setSegmentDrafts] = useState<SegmentDraft[]>([
    { id: "automation-segment-1", field: "channel", operator: "eq", value: "whatsapp" },
  ]);

  function createDraft() {
    const builtActions = buildActions(actions);
    const segment = buildSegmentFromDrafts(segmentEnabled, segmentOperator, segmentDrafts);
    if (!name.trim() || !category.trim()) {
      toast.push({ title: "Nome e categoria são obrigatórios", variant: "warning" });
      return;
    }
    if (typeof builtActions === "string") {
      toast.push({ title: "Revise as ações", description: builtActions, variant: "warning" });
      return;
    }

    createAutomation.mutate({
      name: name.trim(),
      category: category.trim(),
      trigger: buildTrigger(triggerType, triggerChannel, triggerTagId, triggerCampaignId),
      condition: {
        segment,
        requireWithin24hWindow,
      },
      actions: builtActions,
      metadata: {
        source: "visual_builder",
        builderVersion: "v2.10",
        overlayEnabled,
        actionRegistry: actionTypes.map((action) => action.value),
        preview: {
          segmentEnabled,
          segmentConditions: segment?.conditions.length ?? 0,
          actionCount: builtActions.length,
        },
      },
    });
  }

  function applyAutomationTemplate(templateId: string) {
    const template = automationTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setName(template.name);
    setCategory(template.category);
    setTriggerType(template.triggerType);
    setRequireWithin24hWindow(template.requireWithin24hWindow);
    setActions(
      template.actions.map((action, index) => ({
        ...action,
        id: `${action.id}-${Date.now()}-${index}`,
      })),
    );
    setSegmentEnabled(template.segmentDrafts.length > 0);
    setSegmentDrafts(
      template.segmentDrafts.map((segment, index) => ({
        ...segment,
        id: `${segment.id}-${Date.now()}-${index}`,
      })),
    );
    toast.push({
      title: "Template aplicado",
      description: `${template.name} carregado no builder de automação.`,
      variant: "success",
    });
  }

  const builtActionsPreview = useMemo(() => buildActions(actions), [actions]);
  const previewActions = typeof builtActionsPreview === "string" ? [] : builtActionsPreview;
  const previewError = typeof builtActionsPreview === "string" ? builtActionsPreview : null;
  const automationChecks = [
    { label: "Nome", ok: Boolean(name.trim()) },
    { label: "Categoria", ok: Boolean(category.trim()) },
    { label: "Ações", ok: previewActions.length > 0 && !previewError },
    { label: "Condições", ok: !segmentEnabled || segmentDrafts.length > 0 },
    { label: "Preview", ok: !previewError },
  ];

  return (
    <Card className="nuoma-flow-studio nuoma-automation-studio overflow-hidden">
      <div className="nuoma-flow-studio-grid nuoma-automation-studio-grid">
        <aside className="nuoma-flow-studio-rail">
          <div className="px-2">
            <CardTitle>Automation Studio</CardTitle>
            <CardDescription className="mt-1">
              Trigger, condição e ações em rascunho.
            </CardDescription>
          </div>
          <div
            className="rounded-lg bg-bg-base/60 p-3 shadow-flat"
            data-testid="automation-template-gallery"
          >
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-primary">
              <Sparkles className="h-4 w-4 text-accent" />
              Templates
            </div>
            <div className="grid gap-2">
              {automationTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="rounded-lg bg-bg-base px-3 py-3 text-left shadow-flat transition-shadow hover:shadow-raised-sm"
                  onClick={() => applyAutomationTemplate(template.id)}
                  data-testid="automation-template-card"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-fg-primary">{template.name}</span>
                    <Badge variant="neutral">{template.actions.length} ações</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg-dim">{template.description}</p>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <CardContent className="nuoma-flow-studio-canvas">
          <div className="nuoma-flow-studio-canvas-header">
            <div>
              <p className="nuoma-compat-kicker">Automação draft</p>
              <h2 className="mt-1 text-xl font-semibold text-fg-primary">{name || "Sem nome"}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{triggerChannel}</Badge>
              <Badge variant="cyan">{triggerType}</Badge>
              <Badge variant={overlayEnabled ? "success" : "neutral"}>
                overlay {overlayEnabled ? "sim" : "não"}
              </Badge>
              <Badge variant="warning">draft</Badge>
            </div>
          </div>

          <AutomationFlowCanvasBoard
            triggerType={triggerType}
            triggerChannel={triggerChannel}
            requireWithin24hWindow={requireWithin24hWindow}
            segmentEnabled={segmentEnabled}
            segmentCount={segmentDrafts.length}
            actions={actions}
            previewActions={previewActions}
            previewError={previewError}
          />

          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label="Nome">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </LabeledField>
            <LabeledField label="Categoria">
              <Input value={category} onChange={(event) => setCategory(event.target.value)} />
            </LabeledField>
          </div>

          <div className="rounded-lg bg-bg-deep/88 p-4 shadow-pressed-sm">
            <div className="grid gap-3 md:grid-cols-4">
              <LabeledField label="Trigger">
                <Select
                  value={triggerType}
                  onValueChange={(value) => setTriggerType(value as AutomationTrigger["type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="message_received">Mensagem recebida</SelectItem>
                    <SelectItem value="campaign_completed">Campanha completa</SelectItem>
                    <SelectItem value="tag_applied">Tag aplicada</SelectItem>
                    <SelectItem value="tag_removed">Tag removida</SelectItem>
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Canal">
                <ChannelSelect value={triggerChannel} onValueChange={setTriggerChannel} />
              </LabeledField>
              <LabeledField label="Tag ID">
                <Input
                  inputMode="numeric"
                  value={triggerTagId}
                  disabled={triggerType !== "tag_applied" && triggerType !== "tag_removed"}
                  onChange={(event) => setTriggerTagId(event.target.value)}
                />
              </LabeledField>
              <LabeledField label="Campanha ID">
                <Input
                  inputMode="numeric"
                  value={triggerCampaignId}
                  disabled={triggerType !== "campaign_completed"}
                  onChange={(event) => setTriggerCampaignId(event.target.value)}
                />
              </LabeledField>
            </div>
            <label className="mt-4 flex items-center gap-3 rounded-lg bg-bg-base px-4 py-3 shadow-pressed-sm">
              <Switch
                checked={requireWithin24hWindow}
                onCheckedChange={setRequireWithin24hWindow}
                aria-label="Exigir janela de 24 horas"
              />
              <span className="text-sm text-fg-muted">Exigir conversa dentro da janela de 24h</span>
            </label>
            <label className="mt-3 flex items-center gap-3 rounded-lg bg-bg-base px-4 py-3 shadow-pressed-sm">
              <Switch
                checked={overlayEnabled}
                onCheckedChange={setOverlayEnabled}
                aria-label="Automação disponível no overlay"
              />
              <span className="text-sm text-fg-muted">
                Overlay {overlayEnabled ? "sim" : "não"}
              </span>
            </label>
          </div>

          <SegmentBuilder
            enabled={segmentEnabled}
            operator={segmentOperator}
            drafts={segmentDrafts}
            title="Condition builder AND/OR"
            testId="automation-condition-builder"
            onEnabledChange={setSegmentEnabled}
            onOperatorChange={setSegmentOperator}
            onDraftsChange={setSegmentDrafts}
          />

          <ActionList value={actions} onChange={setActions} />

          <AutomationPreviewPanel
            name={name}
            triggerType={triggerType}
            triggerChannel={triggerChannel}
            requireWithin24hWindow={requireWithin24hWindow}
            segmentEnabled={segmentEnabled}
            segmentOperator={segmentOperator}
            segmentDrafts={segmentDrafts}
            actions={previewActions}
            error={previewError}
          />
        </CardContent>

        <AutomationStudioInspector
          checks={automationChecks}
          triggerType={triggerType}
          triggerChannel={triggerChannel}
          actionCount={previewActions.length}
          segmentCount={segmentDrafts.length}
          requireWithin24hWindow={requireWithin24hWindow}
          previewError={previewError}
          createPending={createAutomation.isPending}
          onCreateDraft={createDraft}
        />
      </div>
    </Card>
  );
}

function AutomationFlowCanvasBoard({
  triggerType,
  triggerChannel,
  requireWithin24hWindow,
  segmentEnabled,
  segmentCount,
  actions,
  previewActions,
  previewError,
}: {
  triggerType: AutomationTrigger["type"];
  triggerChannel: ChannelType;
  requireWithin24hWindow: boolean;
  segmentEnabled: boolean;
  segmentCount: number;
  actions: ActionDraft[];
  previewActions: AutomationAction[];
  previewError: string | null;
}) {
  const graph = useMemo(
    () =>
      buildAutomationFlowGraph({
        triggerType,
        triggerChannel,
        requireWithin24hWindow,
        segmentEnabled,
        segmentCount,
        actions,
        previewActions,
        previewError,
      }),
    [
      actions,
      previewActions,
      previewError,
      requireWithin24hWindow,
      segmentCount,
      segmentEnabled,
      triggerChannel,
      triggerType,
    ],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<AutomationCanvasNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph.edges, graph.nodes, setEdges, setNodes]);

  return (
    <div
      className="nuoma-flow-board nuoma-automation-canvas-board"
      data-testid="automation-flow-canvas-board"
    >
      <div className="nuoma-flow-board-toolbar" aria-label="Ferramentas do canvas de automação">
        <button type="button" aria-label="Selecionar" className="is-active" title="Selecionar">
          <MousePointer2 className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Ajustar tela" title="Ajustar tela">
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="nuoma-flow-toolbar-divider" />
        <button type="button" aria-label="Canvas de automação bloqueado" title="Canvas bloqueado">
          <LockKeyhole className="h-4 w-4" />
        </button>
      </div>

      <div className="nuoma-flow-reactflow" data-testid="automation-xyflow-canvas">
        <ReactFlow<AutomationCanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={automationFlowNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.28, includeHiddenNodes: false }}
          minZoom={0.38}
          maxZoom={1.35}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          preventScrolling={false}
        >
          <Background color="var(--nw-flow-grid)" gap={28} size={1.15} />
          <MiniMap
            pannable
            zoomable
            className="nuoma-flow-xy-minimap"
            nodeColor={(node) => flowToneColor((node as AutomationCanvasNode).data.tone)}
          />
          <Controls className="nuoma-flow-xy-controls" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

type AutomationCanvasIconType = AutomationTrigger["type"] | BuilderActionType | "condition" | "end" | "instagram";

type AutomationCanvasNodeData = {
  label: string;
  meta: string;
  summary: string;
  iconType: AutomationCanvasIconType;
  tone: CampaignCanvasTone;
  kind: "trigger" | "condition" | "action" | "branch" | "end" | "error";
  actionType?: BuilderActionType;
};

type AutomationCanvasNode = Node<AutomationCanvasNodeData, "automationCanvas">;

const automationFlowNodeTypes: NodeTypes = {
  automationCanvas: AutomationFlowNode,
};

function AutomationFlowNode({ data }: NodeProps<AutomationCanvasNode>) {
  const Icon = automationCanvasIcon(data.iconType);
  const isTrigger = data.kind === "trigger";
  const isEnd = data.kind === "end";
  return (
    <div
      className={cn(
        "nuoma-flow-xy-node",
        `nuoma-flow-xy-node-${data.tone}`,
        data.kind === "branch" && "nuoma-flow-xy-node-branch",
      )}
      data-testid="automation-canvas-node"
      data-automation-node-kind={data.kind}
      data-action-type={data.actionType}
    >
      {!isTrigger ? <Handle type="target" position={Position.Left} /> : null}
      <div className="nuoma-flow-xy-node-head">
        <span className="nuoma-flow-xy-node-icon">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="nuoma-flow-xy-node-title">{data.label}</div>
          <div className="nuoma-flow-xy-node-meta">
            {data.meta.split("\n").map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="nuoma-flow-xy-node-summary">{data.summary}</div>
      {data.kind === "branch" ? (
        <div className="nuoma-flow-xy-branch-row">
          <button type="button" className="nodrag">
            Sim
          </button>
          <button type="button" className="nodrag">
            Não
          </button>
        </div>
      ) : null}
      {!isEnd ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

function buildAutomationFlowGraph(inputGraph: {
  triggerType: AutomationTrigger["type"];
  triggerChannel: ChannelType;
  requireWithin24hWindow: boolean;
  segmentEnabled: boolean;
  segmentCount: number;
  actions: ActionDraft[];
  previewActions: AutomationAction[];
  previewError: string | null;
}): { nodes: AutomationCanvasNode[]; edges: Edge[] } {
  const rowGap = 138;
  const hasCondition = inputGraph.segmentEnabled || inputGraph.requireWithin24hWindow;
  const actionX = hasCondition ? 660 : 360;
  const endX = actionX + 360;
  const actionCount = Math.max(inputGraph.actions.length, 1);
  const startY = Math.max(58, (Math.min(actionCount, 4) * rowGap) / 2 - 42);
  const previewById = new Map(inputGraph.previewActions.map((action) => [action.id, action]));
  const actionIds = new Set(inputGraph.actions.map((action) => action.id));
  const nodes: AutomationCanvasNode[] = [
    {
      id: "automation-trigger",
      type: "automationCanvas",
      position: { x: 36, y: startY },
      data: {
        label: automationTriggerLabel(inputGraph.triggerType),
        meta: `Trigger\n${inputGraph.triggerChannel}`,
        summary: `Entrada ${inputGraph.triggerType} em ${inputGraph.triggerChannel}.`,
        iconType: inputGraph.triggerChannel === "instagram" ? "instagram" : inputGraph.triggerType,
        tone: inputGraph.triggerChannel === "instagram" ? "ig" : "wa",
        kind: "trigger",
      },
    },
  ];

  if (hasCondition) {
    const gates = [
      inputGraph.segmentEnabled ? `${inputGraph.segmentCount} regra(s) de segmento` : null,
      inputGraph.requireWithin24hWindow ? "janela 24h exigida" : null,
    ].filter(Boolean);
    nodes.push({
      id: "automation-condition",
      type: "automationCanvas",
      position: { x: 360, y: startY },
      data: {
        label: "Condição",
        meta: "Gates\nAND/OR",
        summary: gates.join(" · ") || "Sem gate ativo.",
        iconType: "condition",
        tone: "cyan",
        kind: "condition",
      },
    });
  }

  inputGraph.actions.forEach((action, index) => {
    const previewAction = previewById.get(action.id) ?? inputGraph.previewActions[index];
    const isBranch = action.type === "branch";
    nodes.push({
      id: action.id,
      type: "automationCanvas",
      position: { x: actionX, y: index * rowGap + 36 },
      data: {
        label: previewAction
          ? automationActionLabel(previewAction)
          : automationActionDraftLabel(action),
        meta: `${action.type}\nação ${index + 1}`,
        summary: previewAction
          ? automationActionSummary(previewAction)
          : automationActionDraftCanvasSummary(action),
        iconType: action.type === "send_step" && inputGraph.triggerChannel === "instagram" ? "instagram" : action.type,
        tone: automationActionTone(action.type, inputGraph.triggerChannel),
        kind: isBranch ? "branch" : "action",
        actionType: action.type,
      },
    });
  });

  if (inputGraph.previewError) {
    nodes.push({
      id: "automation-preview-error",
      type: "automationCanvas",
      position: { x: actionX, y: inputGraph.actions.length * rowGap + 36 },
      data: {
        label: "Revisar ação",
        meta: "Validação\npreview",
        summary: inputGraph.previewError,
        iconType: "condition",
        tone: "danger",
        kind: "error",
      },
    });
  }

  nodes.push({
    id: "automation-end",
    type: "automationCanvas",
    position: { x: endX, y: Math.max(36, inputGraph.actions.length * rowGap - 74) },
    data: {
      label: "Fim",
      meta: "Saída\nsem job",
      summary: "Criar rascunho salva automação, mas não enfileira envio.",
      iconType: "end",
      tone: "neutral",
      kind: "end",
    },
  });

  const edges: Edge[] = [];
  const markerEnd = { type: MarkerType.ArrowClosed, color: "var(--nw-flow-edge)" };
  const defaultEdge = {
    type: "smoothstep",
    markerEnd,
    style: { stroke: "var(--nw-flow-edge)", strokeWidth: 2 },
  };
  const firstTarget = inputGraph.actions[0]?.id ?? "automation-end";

  edges.push({
    id: hasCondition ? "trigger-to-condition" : "trigger-to-first",
    source: "automation-trigger",
    target: hasCondition ? "automation-condition" : firstTarget,
    ...defaultEdge,
  });

  if (hasCondition) {
    edges.push({
      id: "condition-to-first",
      source: "automation-condition",
      target: firstTarget,
      label: "ok",
      ...defaultEdge,
    });
  }

  inputGraph.actions.forEach((action, index) => {
    const nextAction = inputGraph.actions[index + 1];
    edges.push({
      id: `${action.id}-next`,
      source: action.id,
      target: nextAction?.id ?? "automation-end",
      label: nextAction ? "próximo" : "concluir",
      ...defaultEdge,
    });
    const targetActionId = action.type === "branch" ? action.branchTargetActionId.trim() : "";
    if (targetActionId && actionIds.has(targetActionId)) {
      edges.push({
        id: `${action.id}-branch`,
        source: action.id,
        target: targetActionId,
        label: action.branchLabel.trim() || "branch",
        type: "smoothstep",
        markerEnd,
        style: { stroke: "var(--nw-flow-branch)", strokeWidth: 2 },
        labelStyle: { fill: "var(--nw-flow-branch)", fontSize: 11, fontWeight: 600 },
      });
    }
  });

  if (inputGraph.previewError) {
    edges.push({
      id: "preview-error-to-end",
      source: "automation-preview-error",
      target: "automation-end",
      label: "corrigir",
      ...defaultEdge,
      style: { stroke: "var(--nw-flow-danger)", strokeWidth: 2 },
    });
  }

  return { nodes, edges };
}

function automationTriggerLabel(type: AutomationTrigger["type"]) {
  if (type === "campaign_completed") return "Campanha completa";
  if (type === "tag_applied") return "Tag aplicada";
  if (type === "tag_removed") return "Tag removida";
  return "Mensagem recebida";
}

function automationActionDraftLabel(action: ActionDraft) {
  if (action.type === "send_step") return action.step.label || "Enviar step";
  if (action.type === "delay") return action.delayLabel.trim() || "Delay";
  if (action.type === "branch") return action.branchLabel.trim() || "Branch";
  if (action.type === "apply_tag") return `Aplicar tag #${action.tagId || "-"}`;
  if (action.type === "remove_tag") return `Remover tag #${action.tagId || "-"}`;
  if (action.type === "set_status") return `Status ${action.status || "-"}`;
  if (action.type === "create_reminder") return action.reminderTitle || "Criar lembrete";
  if (action.type === "notify_attendant") return "Notificar atendente";
  return `Disparar automação #${action.triggerAutomationId || "-"}`;
}

function automationActionDraftCanvasSummary(action: ActionDraft) {
  if (action.type === "send_step") return stepDraftCanvasSummary(action.step);
  if (action.type === "delay")
    return `${action.delayActionSeconds || "0"}s antes das próximas ações`;
  if (action.type === "branch") {
    return `${action.branchConditionField} ${action.branchConditionOperator} ${action.branchConditionValue || "-"}`;
  }
  if (action.type === "apply_tag" || action.type === "remove_tag") return "Ação de CRM";
  if (action.type === "set_status") return "Atualiza status do contato";
  if (action.type === "create_reminder") return action.dueAt || "Data pendente";
  if (action.type === "notify_attendant") return action.notifyMessage || "Notificação pendente";
  return "Aciona automação filha com guarda anti-loop";
}

function automationActionTone(type: BuilderActionType, channel: ChannelType): CampaignCanvasTone {
  if (type === "branch") return "violet";
  if (type === "delay" || type === "create_reminder") return "cyan";
  if (type === "send_step") return channel === "instagram" ? "ig" : "wa";
  if (type === "notify_attendant" || type === "trigger_automation") return "violet";
  return "neutral";
}

function automationCanvasIcon(iconType: AutomationCanvasIconType) {
  if (iconType === "message_received") return PlayCircle;
  if (iconType === "instagram") return Instagram;
  if (iconType === "campaign_completed") return Flag;
  if (iconType === "tag_applied") return BadgeCheck;
  if (iconType === "tag_removed") return Trash2;
  if (iconType === "condition") return ShieldCheck;
  if (iconType === "end") return Flag;
  if (iconType === "send_step") return Send;
  if (iconType === "delay") return Clock;
  if (iconType === "branch") return GitBranch;
  if (iconType === "apply_tag") return BadgeCheck;
  if (iconType === "remove_tag") return Trash2;
  if (iconType === "set_status") return CheckCircle2;
  if (iconType === "create_reminder") return Bell;
  if (iconType === "notify_attendant") return Bell;
  return Route;
}

function AutomationStudioInspector({
  checks,
  triggerType,
  triggerChannel,
  actionCount,
  segmentCount,
  requireWithin24hWindow,
  previewError,
  createPending,
  onCreateDraft,
}: {
  checks: Array<{ label: string; ok: boolean }>;
  triggerType: AutomationTrigger["type"];
  triggerChannel: ChannelType;
  actionCount: number;
  segmentCount: number;
  requireWithin24hWindow: boolean;
  previewError: string | null;
  createPending: boolean;
  onCreateDraft: () => void;
}) {
  const readyCount = checks.filter((check) => check.ok).length;
  return (
    <aside className="nuoma-flow-studio-inspector">
      <div>
        <p className="nuoma-compat-kicker">Inspector</p>
        <h3 className="mt-1 text-base font-semibold text-fg-primary">Saída segura</h3>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CampaignPreviewMetric
          label="checks"
          value={`${readyCount}/${checks.length}`}
          tone="success"
        />
        <CampaignPreviewMetric label="ações" value={actionCount} />
        <CampaignPreviewMetric label="condições" value={segmentCount} />
        <CampaignPreviewMetric label="janela" value={requireWithin24hWindow ? "24h" : "off"} />
      </div>

      <div className="rounded-lg bg-bg-base p-3 shadow-flat">
        <div className="mb-2 font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
          Gates
        </div>
        <div className="grid gap-2">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-fg-muted">{check.label}</span>
              <Badge variant={check.ok ? "success" : "warning"}>
                {check.ok ? "ok" : "revisar"}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-bg-base p-3 shadow-flat">
        <div className="mb-2 font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
          Sinais
        </div>
        <div className="grid gap-2 text-xs text-fg-muted">
          <div className="flex justify-between gap-3">
            <span>Trigger</span>
            <span className="font-mono text-fg-primary">{triggerType}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Canal</span>
            <span className="font-mono text-fg-primary">{triggerChannel}</span>
          </div>
        </div>
      </div>

      {previewError ? (
        <div className="rounded-lg border border-semantic-danger/35 bg-semantic-danger/10 p-3 text-xs leading-relaxed text-semantic-danger">
          {previewError}
        </div>
      ) : null}

      <Button variant="accent" className="w-full" loading={createPending} onClick={onCreateDraft}>
        Criar rascunho
      </Button>
    </aside>
  );
}

function StepList({
  value,
  onChange,
  title,
  channel = "whatsapp",
}: {
  value: StepDraft[];
  onChange: (value: StepDraft[]) => void;
  title: string;
  channel?: ChannelType;
}) {
  const unsupportedLabels = channel === "instagram" ? unsupportedInstagramStepLabels(value) : [];
  return (
    <div className="rounded-xl bg-bg-deep p-4 shadow-pressed-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg-primary">{title}</div>
        <Button
          variant="soft"
          size="sm"
          aria-label={`Adicionar ${title.toLocaleLowerCase("pt-BR")}`}
          title={`Adicionar ${title.toLocaleLowerCase("pt-BR")}`}
          onClick={() => onChange([...value, newStepDraft(value.length + 1)])}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {unsupportedLabels.length > 0 ? (
        <div className="mb-3 rounded-md border border-semantic-warning/40 bg-semantic-warning/10 px-3 py-2 text-xs leading-relaxed text-semantic-warning">
          Instagram aceita texto, link, imagem e vídeo. Revise: {unsupportedLabels.join(", ")}.
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        {value.map((step, index) => (
          <StepEditor
            key={step.id}
            index={index}
            value={step}
            stepOptions={value.map((item, optionIndex) => ({
              id: item.id,
              label: item.label || `Step ${optionIndex + 1}`,
            }))}
            canRemove={value.length > 1}
            canMoveUp={index > 0}
            canMoveDown={index < value.length - 1}
            channel={channel}
            onChange={(next) => onChange(value.map((item) => (item.id === step.id ? next : item)))}
            onRemove={() => onChange(value.filter((item) => item.id !== step.id))}
            onMove={(direction) => onChange(moveItem(value, index, direction))}
          />
        ))}
      </div>
    </div>
  );
}

function StepEditor({
  index,
  value,
  stepOptions = [],
  canRemove,
  canMoveUp,
  canMoveDown,
  channel,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  value: StepDraft;
  stepOptions?: Array<{ id: string; label: string }>;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  channel: ChannelType;
  onChange: (value: StepDraft) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const Icon = stepIcon(value.type);
  const availableStepTypes = stepTypes.filter(
    (type) =>
      channel !== "instagram" ||
      instagramSupportedStepTypes.has(type.value) ||
      type.value === value.type,
  );
  const unsupportedForChannel =
    channel === "instagram" && !instagramSupportedStepTypes.has(value.type);
  const fieldErrors = stepDraftFieldErrors(value, index + 1);
  return (
    <div className="rounded-lg bg-bg-base p-3 shadow-flat">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 text-accent" />
          <span className="font-mono text-xs text-fg-dim">step {index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Mover para cima" disabled={!canMoveUp} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton label="Mover para baixo" disabled={!canMoveDown} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </IconButton>
          <IconButton label="Remover step" disabled={!canRemove} onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_10rem_8rem]">
        <LabeledField label="Label">
          <Input
            value={value.label}
            onChange={(event) => onChange({ ...value, label: event.target.value })}
          />
        </LabeledField>
        <LabeledField label="Tipo">
          <Select
            value={value.type}
            onValueChange={(nextType) => onChange({ ...value, type: nextType as BuilderStepType })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableStepTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledField>
        <LabeledField label="Espera (s)">
          <Input
            inputMode="numeric"
            value={value.delaySeconds}
            onChange={(event) => onChange({ ...value, delaySeconds: event.target.value })}
          />
        </LabeledField>
      </div>
      {unsupportedForChannel ? (
        <div className="mt-3 rounded-md bg-semantic-warning/10 px-3 py-2 text-xs text-semantic-warning">
          Este tipo não dispara no Instagram.
        </div>
      ) : null}
      <StepBody index={index} value={value} errors={fieldErrors} onChange={onChange} />
      <StepConditions
        stepIndex={index}
        value={value}
        stepOptions={stepOptions}
        onChange={onChange}
      />
    </div>
  );
}

function StepBody({
  index,
  value,
  errors,
  onChange,
}: {
  index: number;
  value: StepDraft;
  errors: StepFieldErrors;
  onChange: (value: StepDraft) => void;
}) {
  if (value.type === "temporary_messages") {
    return (
      <div className="mt-3 rounded-lg bg-bg-deep/70 p-3 shadow-pressed-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <div>
              <div className="text-sm font-medium text-fg-primary">
                Definir mensagens temporárias
              </div>
              <div className="text-xs text-fg-dim">Step operacional: não envia mensagem.</div>
            </div>
          </div>
          <div className="w-36">
            <Select
              value={value.temporaryMessagesDuration}
              onValueChange={(duration) =>
                onChange({
                  ...value,
                  temporaryMessagesDuration: duration as StepDraft["temporaryMessagesDuration"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {temporaryMessagesDurations.map((duration) => (
                  <SelectItem key={duration.value} value={duration.value}>
                    {duration.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  }

  if (value.type === "text") {
    return (
      <LabeledField
        label="Mensagem"
        className="mt-3"
        error={errors.template}
        errorId={`campaign-step-message-${index + 1}-error`}
      >
        <Textarea
          data-testid={`campaign-step-message-${index + 1}`}
          invalid={Boolean(errors.template)}
          aria-invalid={Boolean(errors.template)}
          aria-describedby={
            errors.template ? `campaign-step-message-${index + 1}-error` : undefined
          }
          rows={3}
          value={value.template}
          placeholder="Olá {{nome}}, tudo bem?"
          onChange={(event) => onChange({ ...value, template: event.target.value })}
        />
      </LabeledField>
    );
  }

  if (value.type === "link") {
    return (
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <LabeledField
          label="URL"
          error={errors.url}
          errorId={`campaign-step-url-${index + 1}-error`}
        >
          <Input
            invalid={Boolean(errors.url)}
            aria-invalid={Boolean(errors.url)}
            aria-describedby={errors.url ? `campaign-step-url-${index + 1}-error` : undefined}
            value={value.url}
            placeholder="https://..."
            onChange={(event) => onChange({ ...value, url: event.target.value })}
          />
        </LabeledField>
        <LabeledField
          label="Texto"
          error={errors.linkText}
          errorId={`campaign-step-link-text-${index + 1}-error`}
        >
          <Input
            invalid={Boolean(errors.linkText)}
            aria-invalid={Boolean(errors.linkText)}
            aria-describedby={
              errors.linkText ? `campaign-step-link-text-${index + 1}-error` : undefined
            }
            value={value.linkText}
            onChange={(event) => onChange({ ...value, linkText: event.target.value })}
          />
        </LabeledField>
        <label className="flex min-h-[4.25rem] items-center gap-3 rounded-lg bg-bg-deep px-4 py-3 shadow-pressed-sm">
          <Checkbox
            checked={value.previewEnabled}
            onCheckedChange={(checked) => onChange({ ...value, previewEnabled: checked === true })}
            aria-label="Preview de link"
          />
          <span className="text-sm text-fg-muted">Preview</span>
        </label>
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-[9rem_1fr_1fr]">
      <LabeledField
        label="Asset ID"
        error={errors.mediaAssetId}
        errorId={`campaign-step-asset-${index + 1}-error`}
      >
        <Input
          invalid={Boolean(errors.mediaAssetId)}
          aria-invalid={Boolean(errors.mediaAssetId)}
          aria-describedby={
            errors.mediaAssetId ? `campaign-step-asset-${index + 1}-error` : undefined
          }
          inputMode="numeric"
          value={value.mediaAssetId}
          onChange={(event) => onChange({ ...value, mediaAssetId: event.target.value })}
        />
      </LabeledField>
      {value.type === "document" && (
        <LabeledField
          label="Arquivo"
          error={errors.fileName}
          errorId={`campaign-step-file-${index + 1}-error`}
        >
          <Input
            invalid={Boolean(errors.fileName)}
            aria-invalid={Boolean(errors.fileName)}
            aria-describedby={errors.fileName ? `campaign-step-file-${index + 1}-error` : undefined}
            value={value.fileName}
            onChange={(event) => onChange({ ...value, fileName: event.target.value })}
          />
        </LabeledField>
      )}
      <LabeledField label="Legenda" className={value.type === "document" ? "" : "md:col-span-2"}>
        <Input
          value={value.caption}
          onChange={(event) => onChange({ ...value, caption: event.target.value })}
        />
      </LabeledField>
    </div>
  );
}

function StepConditions({
  stepIndex,
  value,
  stepOptions,
  onChange,
}: {
  stepIndex: number;
  value: StepDraft;
  stepOptions: Array<{ id: string; label: string }>;
  onChange: (value: StepDraft) => void;
}) {
  return (
    <div
      className="mt-3 rounded-lg bg-bg-deep/70 p-3 shadow-pressed-sm"
      data-testid="campaign-step-conditions"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-fg-primary">Condições</span>
        </div>
        <Button
          variant="soft"
          size="xs"
          aria-label="Adicionar condição"
          title="Adicionar condição"
          onClick={() =>
            onChange({ ...value, conditions: [...value.conditions, newConditionDraft()] })
          }
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {value.conditions.length === 0 ? (
        <div className="mt-2 text-xs text-fg-dim">Sem regras para este step.</div>
      ) : (
        <div className="mt-3 grid gap-2">
          {value.conditions.map((condition, conditionIndex) => {
            const conditionErrors = conditionFieldErrors(
              condition,
              stepIndex + 1,
              conditionIndex + 1,
            );
            const valueErrorId = `campaign-step-${stepIndex + 1}-condition-${conditionIndex + 1}-value-error`;
            const targetErrorId = `campaign-step-${stepIndex + 1}-condition-${conditionIndex + 1}-target-error`;
            return (
              <div
                key={condition.id}
                className="grid gap-2 rounded-md bg-bg-base p-2 shadow-flat md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                data-testid="campaign-step-condition-row"
              >
                <LabeledField label="Se">
                  <Select
                    value={condition.type}
                    onValueChange={(nextType) =>
                      onChange({
                        ...value,
                        conditions: value.conditions.map((item) =>
                          item.id === condition.id
                            ? { ...item, type: nextType as CampaignStepCondition["type"] }
                            : item,
                        ),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {conditionTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </LabeledField>
                <LabeledField label="Ação">
                  <Select
                    value={condition.action}
                    onValueChange={(nextAction) =>
                      onChange({
                        ...value,
                        conditions: value.conditions.map((item) =>
                          item.id === condition.id
                            ? { ...item, action: nextAction as CampaignStepCondition["action"] }
                            : item,
                        ),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {conditionActions.map((action) => (
                        <SelectItem key={action.value} value={action.value}>
                          {action.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </LabeledField>
                <LabeledField label="Valor" error={conditionErrors.value} errorId={valueErrorId}>
                  <Input
                    value={condition.value}
                    invalid={Boolean(conditionErrors.value)}
                    aria-invalid={Boolean(conditionErrors.value)}
                    aria-describedby={conditionErrors.value ? valueErrorId : undefined}
                    placeholder={conditionPlaceholder(condition.type)}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        conditions: value.conditions.map((item) =>
                          item.id === condition.id ? { ...item, value: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </LabeledField>
                <LabeledField
                  label="Destino"
                  error={conditionErrors.targetStepId}
                  errorId={targetErrorId}
                >
                  <Select
                    value={condition.targetStepId || "__none"}
                    disabled={condition.action !== "branch" || stepOptions.length === 0}
                    onValueChange={(targetStepId) =>
                      onChange({
                        ...value,
                        conditions: value.conditions.map((item) =>
                          item.id === condition.id
                            ? {
                                ...item,
                                targetStepId: targetStepId === "__none" ? "" : targetStepId,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <SelectTrigger
                      aria-invalid={Boolean(conditionErrors.targetStepId)}
                      aria-describedby={conditionErrors.targetStepId ? targetErrorId : undefined}
                      className={cn(
                        conditionErrors.targetStepId &&
                          "ring-2 ring-semantic-danger/60 focus:ring-semantic-danger/60",
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Sem destino</SelectItem>
                      {stepOptions
                        .filter((option) => option.id !== value.id)
                        .map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </LabeledField>
                <IconButton
                  label="Remover condição"
                  onClick={() =>
                    onChange({
                      ...value,
                      conditions: value.conditions.filter((item) => item.id !== condition.id),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SegmentBuilder({
  enabled,
  operator,
  drafts,
  title,
  testId,
  onEnabledChange,
  onOperatorChange,
  onDraftsChange,
}: {
  enabled: boolean;
  operator: "and" | "or";
  drafts: SegmentDraft[];
  title: string;
  testId: string;
  onEnabledChange: (value: boolean) => void;
  onOperatorChange: (value: "and" | "or") => void;
  onDraftsChange: (value: SegmentDraft[]) => void;
}) {
  return (
    <div className="rounded-xl bg-bg-deep p-4 shadow-pressed-sm" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
          <Route className="h-4 w-4 text-accent" />
          {title}
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={operator}
            onValueChange={(value) => onOperatorChange(value as "and" | "or")}
          >
            <SelectTrigger className="w-24" aria-label={`${title} operador`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">AND</SelectItem>
              <SelectItem value="or">OR</SelectItem>
            </SelectContent>
          </Select>
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-label="Ativar condição"
          />
          <Button
            variant="soft"
            size="xs"
            aria-label="Adicionar condição de segmento"
            title="Adicionar condição de segmento"
            onClick={() =>
              onDraftsChange([
                ...drafts,
                {
                  id: `segment-${Date.now()}-${drafts.length}`,
                  field: "status",
                  operator: "eq",
                  value: "novo",
                },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {!enabled ? (
        <div className="mt-3 text-xs text-fg-dim">
          Segmento desligado; o fluxo aceita qualquer contato elegível.
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {drafts.map((draft, index) => (
            <div
              key={draft.id}
              className="grid gap-2 rounded-lg bg-bg-base p-2 shadow-flat md:grid-cols-[1fr_9rem_1fr_auto]"
              data-testid="automation-condition-row"
            >
              <LabeledField label={`Campo ${index + 1}`}>
                <Select
                  value={draft.field}
                  onValueChange={(field) =>
                    onDraftsChange(
                      drafts.map((item) =>
                        item.id === draft.id ? { ...item, field: field as SegmentField } : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentFields.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Operador">
                <Select
                  value={draft.operator}
                  onValueChange={(conditionOperator) =>
                    onDraftsChange(
                      drafts.map((item) =>
                        item.id === draft.id
                          ? { ...item, operator: conditionOperator as SegmentOperator }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentOperators.map((conditionOperator) => (
                      <SelectItem key={conditionOperator.value} value={conditionOperator.value}>
                        {conditionOperator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Valor">
                <Input
                  value={draft.value}
                  disabled={draft.operator === "exists" || draft.operator === "not_exists"}
                  onChange={(event) =>
                    onDraftsChange(
                      drafts.map((item) =>
                        item.id === draft.id ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                />
              </LabeledField>
              <IconButton
                label="Remover condição"
                disabled={drafts.length === 1}
                onClick={() => onDraftsChange(drafts.filter((item) => item.id !== draft.id))}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionList({
  value,
  onChange,
}: {
  value: ActionDraft[];
  onChange: (value: ActionDraft[]) => void;
}) {
  const [dragActionId, setDragActionId] = useState<string | null>(null);

  function dropAction(targetActionId: string) {
    if (!dragActionId || dragActionId === targetActionId) return;
    onChange(moveItemById(value, dragActionId, targetActionId));
    setDragActionId(null);
  }

  return (
    <div className="rounded-xl bg-bg-deep p-4 shadow-pressed-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg-primary">Ações</div>
        <Button
          variant="soft"
          size="sm"
          aria-label="Adicionar ação"
          title="Adicionar ação"
          onClick={() => onChange([...value, newActionDraft(value.length + 1)])}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        {value.map((action, index) => (
          <div
            key={action.id}
            className={cn(
              "rounded-lg bg-bg-base p-3 shadow-flat transition-shadow",
              dragActionId === action.id && "shadow-raised-sm",
            )}
            data-testid="automation-action-row"
            data-action-id={action.id}
            draggable
            onDragStart={() => setDragActionId(action.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropAction(action.id)}
            onDragEnd={() => setDragActionId(null)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-fg-dim">ação {index + 1}</span>
              <div className="flex items-center gap-1">
                <IconButton
                  label="Mover para cima"
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(value, index, -1))}
                >
                  <ArrowUp className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="Mover para baixo"
                  disabled={index === value.length - 1}
                  onClick={() => onChange(moveItem(value, index, 1))}
                >
                  <ArrowDown className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="Remover ação"
                  disabled={value.length === 1}
                  onClick={() => onChange(value.filter((item) => item.id !== action.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[12rem_1fr]">
              <LabeledField label="Tipo">
                <Select
                  value={action.type}
                  onValueChange={(nextType) =>
                    onChange(
                      value.map((item) =>
                        item.id === action.id
                          ? { ...item, type: nextType as BuilderActionType }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {actionTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledField>
              <ActionBody
                value={action}
                onChange={(next) =>
                  onChange(value.map((item) => (item.id === action.id ? next : item)))
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutomationPreviewPanel({
  name,
  triggerType,
  triggerChannel,
  requireWithin24hWindow,
  segmentEnabled,
  segmentOperator,
  segmentDrafts,
  actions,
  error,
}: {
  name: string;
  triggerType: AutomationTrigger["type"];
  triggerChannel: ChannelType;
  requireWithin24hWindow: boolean;
  segmentEnabled: boolean;
  segmentOperator: "and" | "or";
  segmentDrafts: SegmentDraft[];
  actions: AutomationAction[];
  error: string | null;
}) {
  return (
    <div className="nuoma-compat-surface rounded-xl p-4" data-testid="automation-flow-preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <PlayCircle className="h-4 w-4 text-accent" />
            Preview do flow
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-dim">
            Simulação visual local; criar rascunho não enfileira job.
          </p>
        </div>
        <Badge variant={error ? "danger" : "success"}>{error ? "revisar" : "válido"}</Badge>
      </div>
      {error ? <div className="mt-3 text-xs text-semantic-danger">{error}</div> : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="nuoma-compat-readable rounded-lg p-3">
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            Resumo
          </div>
          <div className="mt-2 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">Fluxo</span>
              <span className="truncate font-medium">{name || "Sem nome"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">Trigger</span>
              <span className="font-mono text-xs">
                {triggerType} · {triggerChannel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">Janela</span>
              <Badge variant={requireWithin24hWindow ? "warning" : "neutral"}>
                {requireWithin24hWindow ? "24h" : "livre"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">Condição</span>
              <span className="font-mono text-xs">
                {segmentEnabled
                  ? `${segmentOperator.toUpperCase()} · ${segmentDrafts.length}`
                  : "sem filtro"}
              </span>
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          {actions.length === 0 ? (
            <div className="nuoma-compat-readable rounded-lg px-3 py-4 text-xs text-fg-dim">
              Nenhuma ação válida para prévia.
            </div>
          ) : (
            actions.map((action, index) => (
              <div
                key={`${action.type}-${index}`}
                className="nuoma-compat-readable grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5"
                data-testid="automation-preview-node"
                data-action-type={action.type}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-xs font-mono text-accent">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {automationActionLabel(action)}
                  </div>
                  <div className="truncate text-xs text-fg-dim">
                    {automationActionSummary(action)}
                  </div>
                </div>
                <Badge variant={action.type === "send_step" ? "cyan" : "neutral"}>
                  {action.type}
                </Badge>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ActionBody({
  value,
  onChange,
}: {
  value: ActionDraft;
  onChange: (value: ActionDraft) => void;
}) {
  if (value.type === "send_step") {
    return (
      <StepEditor
        index={0}
        value={value.step}
        canRemove={false}
        canMoveUp={false}
        canMoveDown={false}
        channel="whatsapp"
        onChange={(step) => onChange({ ...value, step })}
        onRemove={() => undefined}
        onMove={() => undefined}
      />
    );
  }

  if (value.type === "delay") {
    return (
      <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
        <LabeledField label="Espera (s)">
          <Input
            inputMode="numeric"
            value={value.delayActionSeconds}
            onChange={(event) => onChange({ ...value, delayActionSeconds: event.target.value })}
          />
        </LabeledField>
        <LabeledField label="Rótulo">
          <Input
            value={value.delayLabel}
            onChange={(event) => onChange({ ...value, delayLabel: event.target.value })}
          />
        </LabeledField>
      </div>
    );
  }

  if (value.type === "branch") {
    return (
      <div className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
          <LabeledField label="Rótulo">
            <Input
              value={value.branchLabel}
              onChange={(event) => onChange({ ...value, branchLabel: event.target.value })}
            />
          </LabeledField>
          <LabeledField label="Destino">
            <Input
              value={value.branchTargetActionId}
              placeholder="action-id opcional"
              onChange={(event) => onChange({ ...value, branchTargetActionId: event.target.value })}
            />
          </LabeledField>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_9rem_1fr]">
          <LabeledField label="Campo">
            <Select
              value={value.branchConditionField}
              onValueChange={(field) =>
                onChange({ ...value, branchConditionField: field as SegmentField })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {segmentFields.map((field) => (
                  <SelectItem key={field.value} value={field.value}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LabeledField>
          <LabeledField label="Operador">
            <Select
              value={value.branchConditionOperator}
              onValueChange={(operator) =>
                onChange({ ...value, branchConditionOperator: operator as SegmentOperator })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {segmentOperators.map((operator) => (
                  <SelectItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LabeledField>
          <LabeledField label="Valor">
            <Input
              value={value.branchConditionValue}
              disabled={
                value.branchConditionOperator === "exists" ||
                value.branchConditionOperator === "not_exists"
              }
              onChange={(event) => onChange({ ...value, branchConditionValue: event.target.value })}
            />
          </LabeledField>
        </div>
      </div>
    );
  }

  if (value.type === "apply_tag" || value.type === "remove_tag") {
    return (
      <LabeledField label="Tag ID">
        <Input
          inputMode="numeric"
          value={value.tagId}
          onChange={(event) => onChange({ ...value, tagId: event.target.value })}
        />
      </LabeledField>
    );
  }

  if (value.type === "set_status") {
    return (
      <LabeledField label="Status">
        <Input
          value={value.status}
          onChange={(event) => onChange({ ...value, status: event.target.value })}
        />
      </LabeledField>
    );
  }

  if (value.type === "create_reminder") {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledField label="Título">
          <Input
            value={value.reminderTitle}
            onChange={(event) => onChange({ ...value, reminderTitle: event.target.value })}
          />
        </LabeledField>
        <LabeledField label="Vencimento">
          <Input
            type="datetime-local"
            value={value.dueAt}
            onChange={(event) => onChange({ ...value, dueAt: event.target.value })}
          />
        </LabeledField>
      </div>
    );
  }

  if (value.type === "notify_attendant") {
    return (
      <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
        <LabeledField label="Atendente ID">
          <Input
            inputMode="numeric"
            value={value.notifyAttendantId}
            placeholder="opcional"
            onChange={(event) => onChange({ ...value, notifyAttendantId: event.target.value })}
          />
        </LabeledField>
        <LabeledField label="Mensagem">
          <Input
            value={value.notifyMessage}
            onChange={(event) => onChange({ ...value, notifyMessage: event.target.value })}
          />
        </LabeledField>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <LabeledField label="Automação ID">
        <Input
          inputMode="numeric"
          value={value.triggerAutomationId}
          onChange={(event) => onChange({ ...value, triggerAutomationId: event.target.value })}
        />
      </LabeledField>
      <div className="flex items-end text-xs leading-relaxed text-fg-dim">
        Execução real usa guarda anti-loop e herda a allowlist do disparo atual.
      </div>
    </div>
  );
}

function ChannelSelect({
  value,
  onValueChange,
}: {
  value: ChannelType;
  onValueChange: (value: ChannelType) => void;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as ChannelType)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="whatsapp">WhatsApp</SelectItem>
        <SelectItem value="instagram">Instagram</SelectItem>
        <SelectItem value="system">Sistema</SelectItem>
      </SelectContent>
    </Select>
  );
}

function LabeledField({
  label,
  children,
  className,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  error?: string | null;
  errorId?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
        {label}
      </span>
      {children}
      {error ? (
        <span
          id={errorId}
          className="mt-1.5 block text-xs leading-snug text-semantic-danger"
          data-testid={errorId}
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

function IconButton({
  label,
  disabled,
  children,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 w-9 px-0"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function buildTrigger(
  type: AutomationTrigger["type"],
  channel: ChannelType,
  tagIdInput: string,
  campaignIdInput: string,
): AutomationTrigger {
  const trigger: AutomationTrigger = { type, channel };
  const tagId = Number.parseInt(tagIdInput, 10);
  const campaignId = Number.parseInt(campaignIdInput, 10);
  if ((type === "tag_applied" || type === "tag_removed") && Number.isInteger(tagId) && tagId > 0) {
    trigger.tagId = tagId;
  }
  if (type === "campaign_completed" && Number.isInteger(campaignId) && campaignId > 0) {
    trigger.campaignId = campaignId;
  }
  return trigger;
}

function conditionPlaceholder(type: CampaignStepCondition["type"]) {
  if (type === "has_tag") return "tag-id ou slug";
  if (type === "channel_is") return "whatsapp";
  if (type === "outside_window") return "24h";
  return "opcional";
}

function stepSummary(step: CampaignStep) {
  if (step.type === "temporary_messages") return `Definir temporárias em ${step.duration}.`;
  if (step.type === "text") return step.template;
  if (step.type === "link") return `${step.text} · ${step.url}`;
  if (step.type === "document") return `${step.fileName} · asset #${step.mediaAssetId}`;
  if (step.type === "image") {
    const count = step.mediaAssetIds?.length ?? 1;
    return `${count} imagem(ns) · asset #${step.mediaAssetId}${step.caption ? ` · ${step.caption}` : ""}`;
  }
  return `asset #${step.mediaAssetId}${step.caption ? ` · ${step.caption}` : ""}`;
}

function automationActionLabel(action: AutomationAction) {
  if (action.type === "send_step") return action.step.label;
  if (action.type === "delay") return action.label ?? "Delay";
  if (action.type === "branch") return action.label;
  if (action.type === "apply_tag") return `Aplicar tag #${action.tagId}`;
  if (action.type === "remove_tag") return `Remover tag #${action.tagId}`;
  if (action.type === "set_status") return `Status ${action.status}`;
  if (action.type === "create_reminder") return action.title;
  if (action.type === "notify_attendant") return "Notificar atendente";
  return `Disparar automação #${action.automationId}`;
}

function automationActionSummary(action: AutomationAction) {
  if (action.type === "send_step") return stepSummary(action.step);
  if (action.type === "delay") return `${action.seconds}s antes das próximas ações com envio`;
  if (action.type === "branch") {
    const condition = action.condition?.conditions[0];
    return condition
      ? `${condition.field} ${condition.operator} ${String(condition.value ?? "nulo")}`
      : "Branch sem condição";
  }
  if (action.type === "apply_tag" || action.type === "remove_tag") return "Ação de CRM";
  if (action.type === "set_status") return "Atualiza status do contato";
  if (action.type === "create_reminder")
    return `Vence em ${new Date(action.dueAt).toLocaleString("pt-BR")}`;
  if (action.type === "notify_attendant") return action.message;
  return "Aciona automação filha com guarda anti-loop";
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const copy = [...items];
  const current = copy[index];
  const target = copy[nextIndex];
  if (current === undefined || target === undefined) return items;
  copy[index] = target;
  copy[nextIndex] = current;
  return copy;
}

function moveItemById<T extends { id: string }>(items: T[], sourceId: string, targetId: string) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
  const copy = [...items];
  const [moved] = copy.splice(sourceIndex, 1);
  if (!moved) return items;
  copy.splice(targetIndex, 0, moved);
  return copy;
}

function stepIcon(type: BuilderStepType) {
  if (type === "temporary_messages") return Clock;
  if (type === "link") return Link2;
  if (type === "voice") return Mic;
  if (type === "image") return Image;
  if (type === "video") return Video;
  if (type === "document") return FileText;
  return FileText;
}
