import type {
  AutomationAction,
  AutomationTrigger,
  CampaignStep,
  CampaignStepCondition,
  ChannelType,
  Segment,
  SegmentCondition,
} from "@nuoma/contracts";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
  FileText,
  FileUp,
  GitBranch,
  Image,
  Link2,
  Mic,
  PlayCircle,
  Plus,
  Route,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { gsap } from "gsap";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
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

type BuilderStepType = CampaignStep["type"];
type BuilderActionType = AutomationAction["type"];
type SegmentField = SegmentCondition["field"];
type SegmentOperator = SegmentCondition["operator"];
type BuilderTab = "base" | "audience" | "steps" | "preview";

interface StepDraft {
  id: string;
  label: string;
  type: BuilderStepType;
  delaySeconds: string;
  template: string;
  url: string;
  linkText: string;
  previewEnabled: boolean;
  mediaAssetId: string;
  fileName: string;
  caption: string;
  conditions: ConditionDraft[];
}

interface ConditionDraft {
  id: string;
  type: CampaignStepCondition["type"];
  action: CampaignStepCondition["action"];
  value: string;
  targetStepId: string;
}

interface ActionDraft {
  id: string;
  type: BuilderActionType;
  step: StepDraft;
  delayActionSeconds: string;
  delayLabel: string;
  branchLabel: string;
  branchTargetActionId: string;
  branchConditionField: SegmentField;
  branchConditionOperator: SegmentOperator;
  branchConditionValue: string;
  tagId: string;
  status: string;
  reminderTitle: string;
  dueAt: string;
  notifyAttendantId: string;
  notifyMessage: string;
  triggerAutomationId: string;
}

interface SegmentDraft {
  id: string;
  field: SegmentField;
  operator: SegmentOperator;
  value: string;
}

interface CsvPreviewRow {
  rowNumber: number;
  phone: string;
  name: string | null;
  email: string | null;
  valid: boolean;
  duplicate: boolean;
  errors: string[];
}

interface CsvPreviewResult {
  headers: string[];
  phoneHeader: string | null;
  rows: CsvPreviewRow[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  errors: string[];
}

const stepTypes: Array<{ value: BuilderStepType; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "link", label: "Link" },
  { value: "voice", label: "Áudio" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "document", label: "Documento" },
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
  { value: "audience", label: "Público", description: "Segmento e CSV" },
  { value: "steps", label: "Steps", description: "Mensagens e regras" },
  { value: "preview", label: "Preview", description: "Fluxo final" },
];

let draftCounter = 0;

const campaignTemplates: Array<{
  id: string;
  name: string;
  description: string;
  evergreen: boolean;
  steps: Array<Partial<StepDraft> & Pick<StepDraft, "label" | "type">>;
}> = [
  {
    id: "reactivation",
    name: "Reativação WA",
    description: "Mensagem curta, espera resposta e encerra se o lead interagir.",
    evergreen: true,
    steps: [
      {
        label: "Abrir conversa",
        type: "text",
        template: "Oi {{nome}}, posso te mandar uma atualização rápida?",
        delaySeconds: "0",
        conditions: [
          {
            id: "template-reactivation-replied",
            type: "replied",
            action: "exit",
            value: "",
            targetStepId: "",
          },
        ],
      },
      {
        label: "Follow-up",
        type: "text",
        template: "Passando só para não deixar seu retorno esfriar. Quer que eu te explique por aqui?",
        delaySeconds: "86400",
      },
    ],
  },
  {
    id: "quote",
    name: "Orçamento com link",
    description: "Texto inicial + link com preview para orçamento ou landing page.",
    evergreen: false,
    steps: [
      {
        label: "Contexto",
        type: "text",
        template: "Olá {{nome}}, deixei o orçamento organizado para você.",
        delaySeconds: "0",
      },
      {
        label: "Link do orçamento",
        type: "link",
        linkText: "Abrir orçamento",
        url: "https://nuoma.com.br",
        previewEnabled: true,
        delaySeconds: "30",
      },
    ],
  },
  {
    id: "twenty-four-hour",
    name: "Janela 24h",
    description: "Sequência que aguarda quando a conversa está fora da janela ativa.",
    evergreen: false,
    steps: [
      {
        label: "Checar janela",
        type: "text",
        template: "Oi {{nome}}, consigo continuar seu atendimento por aqui?",
        delaySeconds: "0",
        conditions: [
          {
            id: "template-window-wait",
            type: "outside_window",
            action: "wait",
            value: "24h",
            targetStepId: "",
          },
        ],
      },
    ],
  },
];

const automationTemplates: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  triggerType: AutomationTrigger["type"];
  requireWithin24hWindow: boolean;
  actions: ActionDraft[];
  segmentDrafts: SegmentDraft[];
}> = [
  {
    id: "reply-then-tag",
    name: "Responder e taguear",
    category: "Atendimento",
    description: "Envia uma resposta curta, aplica tag e cria trilha auditável.",
    triggerType: "message_received",
    requireWithin24hWindow: true,
    actions: [
      {
        ...newActionDraft(1),
        step: { ...newStepDraft(1), label: "Resposta inicial", template: "Recebi sua mensagem e vou te ajudar." },
      },
      { ...newActionDraft(2), type: "apply_tag", tagId: "1" },
    ],
    segmentDrafts: [{ id: "template-status", field: "status", operator: "neq", value: "bloqueado" }],
  },
  {
    id: "delay-branch",
    name: "Delay + branch",
    category: "Follow-up",
    description: "Aguarda antes do follow-up e registra um branch de elegibilidade.",
    triggerType: "message_received",
    requireWithin24hWindow: false,
    actions: [
      { ...newActionDraft(1), type: "delay", delayActionSeconds: "3600", delayLabel: "Aguardar 1h" },
      {
        ...newActionDraft(2),
        type: "branch",
        branchLabel: "Se ainda ativo",
        branchConditionField: "status",
        branchConditionOperator: "neq",
        branchConditionValue: "arquivado",
      },
      {
        ...newActionDraft(3),
        step: { ...newStepDraft(3), label: "Follow-up", template: "Passando para retomar seu atendimento." },
      },
    ],
    segmentDrafts: [],
  },
  {
    id: "notify-and-trigger",
    name: "Escalar atendimento",
    category: "Operação",
    description: "Notifica atendente e aciona uma automação filha com guarda anti-loop.",
    triggerType: "tag_applied",
    requireWithin24hWindow: false,
    actions: [
      {
        ...newActionDraft(1),
        type: "notify_attendant",
        notifyMessage: "Lead precisa de retorno humano.",
      },
      { ...newActionDraft(2), type: "trigger_automation", triggerAutomationId: "1" },
    ],
    segmentDrafts: [{ id: "template-channel", field: "channel", operator: "eq", value: "whatsapp" }],
  },
];

export function CampaignFlowBuilder() {
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
      toast.push({ title: "Falha ao criar campanha", description: error.message, variant: "danger" });
    },
  });

  const [name, setName] = useState("Campanha WhatsApp");
  const [channel, setChannel] = useState<ChannelType>("whatsapp");
  const [evergreen, setEvergreen] = useState(false);
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

  const stepBuildResult = useMemo(() => buildSteps(steps), [steps]);
  const stepBuildError = typeof stepBuildResult === "string" ? stepBuildResult : null;
  const previewSteps = typeof stepBuildResult === "string" ? [] : stepBuildResult;
  const abTargetStep = previewSteps.find((step) => step.type === "text") ?? null;
  const readyChecks = [
    { label: "Nome", ok: Boolean(name.trim()) },
    { label: "Steps", ok: previewSteps.length > 0 && !stepBuildError },
    { label: "Público", ok: !csvPreview || csvPreview.validCount > 0 },
    { label: "CSV", ok: !csvPreview || csvPreview.invalidCount === 0 },
    { label: "A/B", ok: !abEnabled || Boolean(abTargetStep) },
  ];

  function createDraft() {
    if (!name.trim()) {
      toast.push({ title: "Nome obrigatório", variant: "warning" });
      setActiveTab("base");
      return;
    }
    if (typeof stepBuildResult === "string") {
      toast.push({ title: "Revise os steps", description: stepBuildResult, variant: "warning" });
      setActiveTab("steps");
      return;
    }
    if (csvPreview && csvPreview.validCount === 0) {
      toast.push({
        title: "CSV sem destinatários válidos",
        description: "Corrija a coluna de telefone ou remova o CSV antes de salvar o rascunho.",
        variant: "warning",
      });
      setActiveTab("audience");
      return;
    }
    if (abEnabled && !stepBuildResult.some((step) => step.type === "text")) {
      toast.push({
        title: "A/B precisa de step texto",
        description: "Adicione um step de texto para aplicar o override da variante B.",
        variant: "warning",
      });
      setActiveTab("steps");
      return;
    }
    const abVariants = buildAbVariantsMetadata({
      enabled: abEnabled,
      steps: stepBuildResult,
      controlLabel: abControlLabel,
      controlWeight: abControlWeight,
      variantLabel: abVariantLabel,
      variantWeight: abVariantWeight,
      variantTemplate: abVariantTemplate,
    });

    createCampaign.mutate({
      name: name.trim(),
      channel,
      evergreen,
      segment: buildSegment(segmentEnabled, segmentField, segmentOperator, segmentValue),
      steps: stepBuildResult,
      metadata: {
        source: "visual_builder",
        builderVersion: "v2.10",
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
    });
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

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Builder de campanha</CardTitle>
            <CardDescription>Wizard visual com CSV, preview e workflow sem enfileirar envio.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {readyChecks.map((check) => (
              <Badge key={check.label} variant={check.ok ? "success" : "warning"}>
                {check.label}
              </Badge>
            ))}
            <Badge variant="warning">draft</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as BuilderTab)}>
          <TabsList className="grid w-full grid-cols-2 gap-1 md:grid-cols-4">
            {builderTabs.map((tab, index) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="min-w-0 justify-start gap-2 px-3 py-2 text-left"
                data-testid={`campaign-builder-tab-${tab.value}`}
              >
                <span className="font-mono text-[0.62rem] text-fg-dim">{index + 1}</span>
                <span className="truncate">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="base" data-testid="campaign-builder-base">
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="botforge-surface rounded-xl p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-primary">
                  <ClipboardList className="h-4 w-4 text-brand-cyan" />
                  Configuração
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto]">
                  <LabeledField label="Nome">
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
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
                </div>
              </div>
              <div className="botforge-surface rounded-xl p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-primary">
                  <Sparkles className="h-4 w-4 text-brand-violet" />
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
                        <span className="text-sm font-medium text-fg-primary">{template.name}</span>
                        <Badge variant={template.evergreen ? "success" : "neutral"}>
                          {template.steps.length} steps
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-fg-dim">{template.description}</p>
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
                    <div className="text-xs text-fg-dim">Filtro simples salvo no contrato da campanha.</div>
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
                      <Select value={segmentField} onValueChange={(value) => setSegmentField(value as SegmentField)}>
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
                        disabled={segmentOperator === "exists" || segmentOperator === "not_exists"}
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
            <StepList value={steps} onChange={setSteps} title="Steps" />
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
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end">
          <Button variant="accent" loading={createCampaign.isPending} onClick={createDraft}>
            Criar rascunho
          </Button>
        </div>
      </CardContent>
    </Card>
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
    <div className="rounded-xl bg-bg-deep/80 p-4 shadow-pressed-sm" data-testid="campaign-csv-preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <FileUp className="h-4 w-4 text-brand-cyan" />
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
            <CampaignPreviewMetric label="inválidas" value={csvPreview.invalidCount} tone="danger" />
            <CampaignPreviewMetric label="duplicadas" value={csvPreview.duplicateCount} tone="warning" />
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
    <div className="rounded-xl bg-bg-deep/80 p-4 shadow-pressed-sm" data-testid="campaign-ab-builder">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <GitBranch className="h-4 w-4 text-brand-violet" />
            A/B variants
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-dim">
            Atribuição determinística por recipient; a variante B pode trocar o texto do primeiro step.
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
    <div className="rounded-xl bg-bg-deep/80 p-4 shadow-pressed-sm" data-testid="campaign-preview-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <CheckCircle2 className="h-4 w-4 text-brand-cyan" />
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
        <div className="font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">Campanha</div>
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
}: {
  steps: StepDraft[];
  channel: ChannelType;
  evergreen: boolean;
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
  abEnabled: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nodes = [
    {
      id: "audience",
      label: "Público",
      meta: csvPreview ? `${csvPreview.validCount} CSV válidos` : segmentEnabled ? "segmento ativo" : "manual",
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
      meta: `${step.type} · ${step.delaySeconds || 0}s`,
      icon: stepIcon(step.type),
    })),
    {
      id: "tick",
      label: "Scheduler tick",
      meta: "dry-run ou fila segura",
      icon: GitBranch,
    },
  ];

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-workflow-node='true']"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(items, { opacity: 1, y: 0, scale: 1 });
      return;
    }
    const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
    timeline.fromTo(
      items,
      { opacity: 0, y: 12, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.28, stagger: 0.04 },
    );
    return () => {
      timeline.kill();
    };
  }, [nodes.length, channel, evergreen, csvPreview?.validCount, segmentEnabled, abEnabled]);

  return (
    <div
      ref={rootRef}
      className="botforge-surface rounded-xl p-4"
      data-testid="campaign-workflow-viewer"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
        <GitBranch className="h-4 w-4 text-brand-violet" />
        Workflow
      </div>
      <div className="mt-4 grid gap-3 rounded-xl bg-bg-sunken/58 p-3">
        {nodes.map((node, index) => {
          const Icon = node.icon;
          return (
            <div key={node.id} className="relative">
              {index > 0 && (
                <div className="absolute -top-3 left-5 h-3 w-px bg-brand-cyan/35" aria-hidden="true" />
              )}
              <div
                data-workflow-node="true"
                data-testid="campaign-workflow-node"
                className="botforge-readable rounded-xl px-3 py-3 transition-transform hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-cyan/12 text-brand-cyan shadow-pressed-sm">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg-primary">{node.label}</div>
                    <div className="mt-0.5 truncate font-mono text-[0.65rem] text-fg-dim">{node.meta}</div>
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
      toast.push({ title: "Falha ao criar automação", description: error.message, variant: "danger" });
    },
  });

  const [name, setName] = useState("Automação de resposta");
  const [category, setCategory] = useState("Atendimento");
  const [triggerType, setTriggerType] = useState<AutomationTrigger["type"]>("message_received");
  const [triggerChannel, setTriggerChannel] = useState<ChannelType>("whatsapp");
  const [triggerTagId, setTriggerTagId] = useState("");
  const [triggerCampaignId, setTriggerCampaignId] = useState("");
  const [requireWithin24hWindow, setRequireWithin24hWindow] = useState(false);
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
    setActions(template.actions.map((action, index) => ({ ...action, id: `${action.id}-${Date.now()}-${index}` })));
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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Builder de automação</CardTitle>
            <CardDescription>Define trigger, janela de 24h e ações em rascunho.</CardDescription>
          </div>
          <Badge variant="warning">draft</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="rounded-xl bg-bg-deep p-4 shadow-pressed-sm" data-testid="automation-template-gallery">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-primary">
            <Sparkles className="h-4 w-4 text-brand-violet" />
            Galeria de templates
          </div>
          <div className="grid gap-2 lg:grid-cols-3">
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

        <div className="grid gap-3 md:grid-cols-2">
          <LabeledField label="Nome">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </LabeledField>
          <LabeledField label="Categoria">
            <Input value={category} onChange={(event) => setCategory(event.target.value)} />
          </LabeledField>
        </div>

        <div className="rounded-xl bg-bg-deep p-4 shadow-pressed-sm">
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

        <div className="flex justify-end">
          <Button variant="accent" loading={createAutomation.isPending} onClick={createDraft}>
            Criar rascunho
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StepList({
  value,
  onChange,
  title,
}: {
  value: StepDraft[];
  onChange: (value: StepDraft[]) => void;
  title: string;
}) {
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
  onChange: (value: StepDraft) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const Icon = stepIcon(value.type);
  return (
    <div className="rounded-lg bg-bg-base p-3 shadow-flat">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 text-brand-cyan" />
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
              {stepTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledField>
        <LabeledField label="Delay (s)">
          <Input
            inputMode="numeric"
            value={value.delaySeconds}
            onChange={(event) => onChange({ ...value, delaySeconds: event.target.value })}
          />
        </LabeledField>
      </div>
      <StepBody value={value} onChange={onChange} />
      <StepConditions value={value} stepOptions={stepOptions} onChange={onChange} />
    </div>
  );
}

function StepBody({
  value,
  onChange,
}: {
  value: StepDraft;
  onChange: (value: StepDraft) => void;
}) {
  if (value.type === "text") {
    return (
      <LabeledField label="Mensagem" className="mt-3">
        <Textarea
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
        <LabeledField label="URL">
          <Input
            value={value.url}
            placeholder="https://..."
            onChange={(event) => onChange({ ...value, url: event.target.value })}
          />
        </LabeledField>
        <LabeledField label="Texto">
          <Input value={value.linkText} onChange={(event) => onChange({ ...value, linkText: event.target.value })} />
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
      <LabeledField label="Asset ID">
        <Input
          inputMode="numeric"
          value={value.mediaAssetId}
          onChange={(event) => onChange({ ...value, mediaAssetId: event.target.value })}
        />
      </LabeledField>
      {value.type === "document" && (
        <LabeledField label="Arquivo">
          <Input
            value={value.fileName}
            onChange={(event) => onChange({ ...value, fileName: event.target.value })}
          />
        </LabeledField>
      )}
      <LabeledField label="Legenda" className={value.type === "document" ? "" : "md:col-span-2"}>
        <Input value={value.caption} onChange={(event) => onChange({ ...value, caption: event.target.value })} />
      </LabeledField>
    </div>
  );
}

function StepConditions({
  value,
  stepOptions,
  onChange,
}: {
  value: StepDraft;
  stepOptions: Array<{ id: string; label: string }>;
  onChange: (value: StepDraft) => void;
}) {
  return (
    <div className="mt-3 rounded-lg bg-bg-deep/70 p-3 shadow-pressed-sm" data-testid="campaign-step-conditions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-brand-violet" />
          <span className="text-sm font-medium text-fg-primary">Condições</span>
        </div>
        <Button
          variant="soft"
          size="xs"
          aria-label="Adicionar condição"
          title="Adicionar condição"
          onClick={() => onChange({ ...value, conditions: [...value.conditions, newConditionDraft()] })}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {value.conditions.length === 0 ? (
        <div className="mt-2 text-xs text-fg-dim">Sem regras para este step.</div>
      ) : (
        <div className="mt-3 grid gap-2">
          {value.conditions.map((condition) => (
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
              <LabeledField label="Valor">
                <Input
                  value={condition.value}
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
              <LabeledField label="Destino">
                <Select
                  value={condition.targetStepId || "__none"}
                  disabled={condition.action !== "branch" || stepOptions.length === 0}
                  onValueChange={(targetStepId) =>
                    onChange({
                      ...value,
                      conditions: value.conditions.map((item) =>
                        item.id === condition.id
                          ? { ...item, targetStepId: targetStepId === "__none" ? "" : targetStepId }
                          : item,
                      ),
                    })
                  }
                >
                  <SelectTrigger>
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
          ))}
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
          <Route className="h-4 w-4 text-brand-cyan" />
          {title}
        </div>
        <div className="flex items-center gap-3">
          <Select value={operator} onValueChange={(value) => onOperatorChange(value as "and" | "or")}>
            <SelectTrigger className="w-24" aria-label={`${title} operador`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">AND</SelectItem>
              <SelectItem value="or">OR</SelectItem>
            </SelectContent>
          </Select>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Ativar condição" />
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
        <div className="mt-3 text-xs text-fg-dim">Segmento desligado; o fluxo aceita qualquer contato elegível.</div>
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

function ActionList({ value, onChange }: { value: ActionDraft[]; onChange: (value: ActionDraft[]) => void }) {
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
                        item.id === action.id ? { ...item, type: nextType as BuilderActionType } : item,
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
                onChange={(next) => onChange(value.map((item) => (item.id === action.id ? next : item)))}
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
    <div className="botforge-surface rounded-xl p-4" data-testid="automation-flow-preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
            <PlayCircle className="h-4 w-4 text-brand-cyan" />
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
        <div className="botforge-readable rounded-lg p-3">
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">Resumo</div>
          <div className="mt-2 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">Fluxo</span>
              <span className="truncate font-medium">{name || "Sem nome"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">Trigger</span>
              <span className="font-mono text-xs">{triggerType} · {triggerChannel}</span>
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
                {segmentEnabled ? `${segmentOperator.toUpperCase()} · ${segmentDrafts.length}` : "sem filtro"}
              </span>
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          {actions.length === 0 ? (
            <div className="botforge-readable rounded-lg px-3 py-4 text-xs text-fg-dim">
              Nenhuma ação válida para prévia.
            </div>
          ) : (
            actions.map((action, index) => (
              <div
                key={`${action.type}-${index}`}
                className="botforge-readable grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5"
                data-testid="automation-preview-node"
                data-action-type={action.type}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-cyan/10 text-xs font-mono text-brand-cyan">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{automationActionLabel(action)}</div>
                  <div className="truncate text-xs text-fg-dim">{automationActionSummary(action)}</div>
                </div>
                <Badge variant={action.type === "send_step" ? "cyan" : "neutral"}>{action.type}</Badge>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ActionBody({ value, onChange }: { value: ActionDraft; onChange: (value: ActionDraft) => void }) {
  if (value.type === "send_step") {
    return (
      <StepEditor
        index={0}
        value={value.step}
        canRemove={false}
        canMoveUp={false}
        canMoveDown={false}
        onChange={(step) => onChange({ ...value, step })}
        onRemove={() => undefined}
        onMove={() => undefined}
      />
    );
  }

  if (value.type === "delay") {
    return (
      <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
        <LabeledField label="Delay (s)">
          <Input
            inputMode="numeric"
            value={value.delayActionSeconds}
            onChange={(event) => onChange({ ...value, delayActionSeconds: event.target.value })}
          />
        </LabeledField>
        <LabeledField label="Rótulo">
          <Input value={value.delayLabel} onChange={(event) => onChange({ ...value, delayLabel: event.target.value })} />
        </LabeledField>
      </div>
    );
  }

  if (value.type === "branch") {
    return (
      <div className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
          <LabeledField label="Rótulo">
            <Input value={value.branchLabel} onChange={(event) => onChange({ ...value, branchLabel: event.target.value })} />
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
              onValueChange={(field) => onChange({ ...value, branchConditionField: field as SegmentField })}
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
        <Input value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value })} />
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
          <Input value={value.notifyMessage} onChange={(event) => onChange({ ...value, notifyMessage: event.target.value })} />
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

function ChannelSelect({ value, onValueChange }: { value: ChannelType; onValueChange: (value: ChannelType) => void }) {
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
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
        {label}
      </span>
      {children}
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

function newStepDraft(order: number): StepDraft {
  draftCounter += 1;
  return {
    id: `step-${Date.now()}-${draftCounter}`,
    label: `Step ${order}`,
    type: "text",
    delaySeconds: "0",
    template: "Olá {{nome}}, tudo bem?",
    url: "https://nuoma.com.br",
    linkText: "Ver detalhes",
    previewEnabled: true,
    mediaAssetId: "",
    fileName: "documento.pdf",
    caption: "",
    conditions: [],
  };
}

function newConditionDraft(): ConditionDraft {
  draftCounter += 1;
  return {
    id: `condition-${Date.now()}-${draftCounter}`,
    type: "replied",
    action: "exit",
    value: "",
    targetStepId: "",
  };
}

function newActionDraft(order: number): ActionDraft {
  return {
    id: `action-${Date.now()}-${order}-${Math.random().toString(36).slice(2, 8)}`,
    type: "send_step",
    step: newStepDraft(order),
    delayActionSeconds: "300",
    delayLabel: "Aguardar",
    branchLabel: "Branch",
    branchTargetActionId: "",
    branchConditionField: "status",
    branchConditionOperator: "eq",
    branchConditionValue: "novo",
    tagId: "",
    status: "novo",
    reminderTitle: "Retornar contato",
    dueAt: "",
    notifyAttendantId: "",
    notifyMessage: "Lead precisa de atendimento humano.",
    triggerAutomationId: "",
  };
}

function buildSteps(steps: StepDraft[]): CampaignStep[] | string {
  const built: CampaignStep[] = [];
  for (const [index, step] of steps.entries()) {
    const result = buildStep(step, index + 1);
    if (typeof result === "string") {
      return result;
    }
    built.push(result);
  }
  return built;
}

function buildStep(step: StepDraft, order: number): CampaignStep | string {
  const id = step.id.replace(/[^a-zA-Z0-9_-]/g, "") || `step-${order}`;
  const label = step.label.trim() || `Step ${order}`;
  const delaySeconds = Math.max(0, Number.parseInt(step.delaySeconds || "0", 10) || 0);
  const conditions = buildStepConditions(step, order);
  if (typeof conditions === "string") {
    return conditions;
  }
  const base = { id, label, delaySeconds, conditions };

  if (step.type === "text") {
    const template = step.template.trim();
    return template ? { ...base, type: "text", template } : `Step ${order}: mensagem vazia.`;
  }
  if (step.type === "link") {
    const text = step.linkText.trim();
    const url = step.url.trim();
    if (!text || !url) return `Step ${order}: link precisa de texto e URL.`;
    return { ...base, type: "link", text, url, previewEnabled: step.previewEnabled };
  }

  const mediaAssetId = Number.parseInt(step.mediaAssetId, 10);
  if (!Number.isInteger(mediaAssetId) || mediaAssetId <= 0) {
    return `Step ${order}: informe um Media Asset ID válido.`;
  }
  const caption = step.caption.trim() || null;
  if (step.type === "document") {
    const fileName = step.fileName.trim();
    return fileName
      ? { ...base, type: "document", mediaAssetId, fileName, caption }
      : `Step ${order}: documento precisa de nome de arquivo.`;
  }
  return { ...base, type: step.type, mediaAssetId, caption };
}

function buildStepConditions(step: StepDraft, order: number): CampaignStepCondition[] | string {
  const built: CampaignStepCondition[] = [];
  for (const [index, condition] of step.conditions.entries()) {
    const value = condition.value.trim();
    const targetStepId = condition.targetStepId.trim();
    if ((condition.type === "has_tag" || condition.type === "channel_is") && !value) {
      return `Step ${order}, condição ${index + 1}: informe o valor.`;
    }
    if (condition.action === "branch" && !targetStepId) {
      return `Step ${order}, condição ${index + 1}: branch precisa de destino.`;
    }
    built.push({
      type: condition.type,
      action: condition.action,
      value: value || null,
      targetStepId: condition.action === "branch" ? targetStepId : null,
    });
  }
  return built;
}

function buildActions(actions: ActionDraft[]): AutomationAction[] | string {
  const built: AutomationAction[] = [];
  for (const [index, action] of actions.entries()) {
    const order = index + 1;
    if (action.type === "send_step") {
      const step = buildStep(action.step, order);
      if (typeof step === "string") return step;
      built.push({ id: action.id, type: "send_step", step });
      continue;
    }
    if (action.type === "delay") {
      const seconds = Number.parseInt(action.delayActionSeconds, 10);
      if (!Number.isInteger(seconds) || seconds <= 0) {
        return `Ação ${order}: delay precisa de segundos positivos.`;
      }
      built.push({ id: action.id, type: "delay", seconds, label: action.delayLabel.trim() || null });
      continue;
    }
    if (action.type === "branch") {
      const label = action.branchLabel.trim();
      if (!label) return `Ação ${order}: branch precisa de rótulo.`;
      built.push({
        id: action.id,
        type: "branch",
        label,
        condition: {
          operator: "and",
          conditions: [
            {
              field: action.branchConditionField,
              operator: action.branchConditionOperator,
              value: parseSegmentDraftValue(
                action.branchConditionOperator,
                action.branchConditionValue,
              ),
            },
          ],
        },
        targetActionId: action.branchTargetActionId.trim() || null,
      });
      continue;
    }
    if (action.type === "apply_tag" || action.type === "remove_tag") {
      const tagId = Number.parseInt(action.tagId, 10);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        return `Ação ${order}: informe um Tag ID válido.`;
      }
      built.push({ id: action.id, type: action.type, tagId });
      continue;
    }
    if (action.type === "set_status") {
      const status = action.status.trim();
      if (!status) return `Ação ${order}: informe o status.`;
      built.push({ id: action.id, type: "set_status", status });
      continue;
    }
    const title = action.reminderTitle.trim();
    const dueAt = toIsoDateTime(action.dueAt);
    if (action.type === "create_reminder") {
      if (!title || !dueAt) {
        return `Ação ${order}: lembrete precisa de título e data.`;
      }
      built.push({ id: action.id, type: "create_reminder", title, dueAt });
      continue;
    }
    if (action.type === "notify_attendant") {
      const message = action.notifyMessage.trim();
      if (!message) return `Ação ${order}: notificação precisa de mensagem.`;
      const attendantId = Number.parseInt(action.notifyAttendantId, 10);
      built.push({
        id: action.id,
        type: "notify_attendant",
        attendantId: Number.isInteger(attendantId) && attendantId > 0 ? attendantId : null,
        message,
      });
      continue;
    }
    const automationId = Number.parseInt(action.triggerAutomationId, 10);
    if (!Number.isInteger(automationId) || automationId <= 0) {
      return `Ação ${order}: informe a automação filha.`;
    }
    built.push({ id: action.id, type: "trigger_automation", automationId });
  }
  return built;
}

function buildAbVariantsMetadata(input: {
  enabled: boolean;
  steps: CampaignStep[];
  controlLabel: string;
  controlWeight: string;
  variantLabel: string;
  variantWeight: string;
  variantTemplate: string;
}) {
  if (!input.enabled) {
    return null;
  }
  const textStep = input.steps.find((step) => step.type === "text");
  if (!textStep) {
    return null;
  }
  return {
    enabled: true,
    assignment: "deterministic",
    variants: [
      {
        id: "a",
        label: input.controlLabel.trim() || "Controle",
        weight: positiveWeight(input.controlWeight),
        stepOverrides: {},
      },
      {
        id: "b",
        label: input.variantLabel.trim() || "Variante B",
        weight: positiveWeight(input.variantWeight),
        stepOverrides: {
          [textStep.id]: {
            template: input.variantTemplate.trim() || textStep.template,
          },
        },
      },
    ],
  };
}

function buildSegment(
  enabled: boolean,
  field: SegmentField,
  operator: SegmentOperator,
  rawValue: string,
): Segment | null {
  if (!enabled) return null;
  const value = parseSegmentDraftValue(operator, rawValue);
  return {
    operator: "and",
    conditions: [{ field, operator, value }],
  };
}

function buildSegmentFromDrafts(
  enabled: boolean,
  operator: "and" | "or",
  drafts: SegmentDraft[],
): Segment | null {
  if (!enabled) return null;
  const conditions = drafts
    .map((draft) => ({
      field: draft.field,
      operator: draft.operator,
      value: parseSegmentDraftValue(draft.operator, draft.value),
    }))
    .filter((condition) => condition.operator === "exists" || condition.operator === "not_exists" || condition.value !== "");
  return conditions.length > 0 ? { operator, conditions } : null;
}

function parseSegmentDraftValue(operator: SegmentOperator, rawValue: string) {
  return operator === "exists" || operator === "not_exists" ? null : parseSegmentValue(rawValue);
}

function positiveWeight(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
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
  if (action.type === "create_reminder") return `Vence em ${new Date(action.dueAt).toLocaleString("pt-BR")}`;
  if (action.type === "notify_attendant") return action.message;
  return "Aciona automação filha com guarda anti-loop";
}

function parseCsvPreview(text: string): CsvPreviewResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return emptyCsvPreview(["CSV vazio."]);
  }

  const delimiter = detectCsvDelimiter(lines[0] ?? "");
  const headers = parseCsvLine(lines[0] ?? "", delimiter).map((header) => header.trim());
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const phoneIndex = normalizedHeaders.findIndex((header) =>
    ["telefone", "phone", "whatsapp", "celular", "numero", "number"].includes(header),
  );
  const nameIndex = normalizedHeaders.findIndex((header) =>
    ["nome", "name", "contato", "contact"].includes(header),
  );
  const emailIndex = normalizedHeaders.findIndex((header) => ["email", "e-mail"].includes(header));
  const seenPhones = new Set<string>();
  const errors: string[] = [];

  if (phoneIndex === -1) {
    errors.push("Coluna de telefone não encontrada. Use telefone, phone, whatsapp, celular ou numero.");
  }

  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line, delimiter);
    const rowNumber = index + 2;
    const rawPhone = phoneIndex >= 0 ? (cells[phoneIndex] ?? "") : "";
    const phone = normalizeCsvPhone(rawPhone);
    const rowErrors: string[] = [];
    if (!phone) {
      rowErrors.push("telefone inválido");
    }
    const duplicate = Boolean(phone && seenPhones.has(phone));
    if (duplicate) {
      rowErrors.push("telefone duplicado");
    }
    if (phone && !duplicate) {
      seenPhones.add(phone);
    }
    return {
      rowNumber,
      phone: phone ?? rawPhone.trim(),
      name: nameIndex >= 0 ? cleanCsvCell(cells[nameIndex]) : null,
      email: emailIndex >= 0 ? cleanCsvCell(cells[emailIndex]) : null,
      valid: rowErrors.length === 0 && phoneIndex >= 0,
      duplicate,
      errors: rowErrors,
    };
  });

  const duplicateCount = rows.filter((row) => row.duplicate).length;
  const invalidCount = rows.filter((row) => !row.valid).length;
  const previewErrors = [
    ...errors,
    ...rows.flatMap((row) =>
      row.errors.map((error) => `Linha ${row.rowNumber}: ${error}`),
    ),
  ];

  return {
    headers,
    phoneHeader: phoneIndex >= 0 ? headers[phoneIndex] ?? null : null,
    rows,
    totalRows: rows.length,
    validCount: rows.length - invalidCount,
    invalidCount,
    duplicateCount,
    errors: previewErrors,
  };
}

function emptyCsvPreview(errors: string[]): CsvPreviewResult {
  return {
    headers: [],
    phoneHeader: null,
    rows: [],
    totalRows: 0,
    validCount: 0,
    invalidCount: 0,
    duplicateCount: 0,
    errors,
  };
}

function detectCsvDelimiter(header: string) {
  const commaCount = (header.match(/,/g) ?? []).length;
  const semicolonCount = (header.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }
    if (char === delimiter && !insideQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function cleanCsvCell(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function normalizeCsvHeader(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizeCsvPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function parseSegmentValue(value: string) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  if (type === "link") return Link2;
  if (type === "voice") return Mic;
  if (type === "image") return Image;
  if (type === "video") return Video;
  if (type === "document") return FileText;
  return FileText;
}
