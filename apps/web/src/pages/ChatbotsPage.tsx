import {
  Animate,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from "@nuoma/ui";
import type { AutomationAction, ChatbotRuleMatch } from "@nuoma/contracts";
import { Bot, FlaskConical, GripVertical, Plus, Regex } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { trpc } from "../lib/trpc.js";

interface AbTestSummary {
  enabled: boolean;
  assignment: "deterministic";
  variants: Array<{
    id: string;
    label: string;
    weight: number;
    actionsCount: number;
  }>;
}

type ChatbotActionKind =
  | "send_step"
  | "apply_tag"
  | "set_status"
  | "notify_attendant"
  | "trigger_automation";

const matchTypes: Array<{ value: ChatbotRuleMatch["type"]; label: string }> = [
  { value: "contains", label: "Contém" },
  { value: "equals", label: "Igual" },
  { value: "starts_with", label: "Começa com" },
  { value: "regex", label: "Regex" },
  { value: "fallback", label: "Fallback" },
];

const chatbotActionKinds: Array<{ value: ChatbotActionKind; label: string }> = [
  { value: "send_step", label: "Responder" },
  { value: "apply_tag", label: "Aplicar tag" },
  { value: "set_status", label: "Mudar status" },
  { value: "notify_attendant", label: "Notificar atendente" },
  { value: "trigger_automation", label: "Disparar automação" },
];

export function ChatbotsPage() {
  const chatbots = trpc.chatbots.list.useQuery();
  const utils = trpc.useUtils();
  const toast = useToast();
  const [body, setBody] = useState("Qual o preco?");
  const [phone, setPhone] = useState("5531982066263");
  const [selectedChatbotId, setSelectedChatbotId] = useState("");
  const [ruleName, setRuleName] = useState("Resposta preço");
  const [priority, setPriority] = useState("10");
  const [matchType, setMatchType] = useState<ChatbotRuleMatch["type"]>("contains");
  const [matchValue, setMatchValue] = useState("preco");
  const [regexProbe, setRegexProbe] = useState("Qual o preco?");
  const [actionKind, setActionKind] = useState<ChatbotActionKind>("send_step");
  const [responseText, setResponseText] = useState("Vou te mandar as opções por aqui.");
  const [tagId, setTagId] = useState("1");
  const [statusValue, setStatusValue] = useState("interessado");
  const [notifyMessage, setNotifyMessage] = useState("Chatbot pediu atendimento humano.");
  const [automationId, setAutomationId] = useState("1");
  const [variantsEnabled, setVariantsEnabled] = useState(true);
  const [variantA, setVariantA] = useState("Vou te mandar as opções por aqui.");
  const [variantB, setVariantB] = useState("Tenho duas opções para você comparar.");
  const selectedChatbotIdNumber = Number.parseInt(selectedChatbotId, 10);
  const dryRun = trpc.chatbots.testRule.useQuery(
    {
      ...(Number.isInteger(selectedChatbotIdNumber) && selectedChatbotIdNumber > 0
        ? { chatbotId: selectedChatbotIdNumber }
        : {}),
      channel: "whatsapp",
      phone: phone.replace(/\D/g, ""),
      body,
    },
    { enabled: false },
  );
  const selectedVariant = dryRun.data?.abTest?.selectedVariantLabel ?? "sem A/B";
  const createRule = trpc.chatbots.createRule.useMutation({
    async onSuccess() {
      await utils.chatbots.listRules.invalidate();
      toast.push({ title: "Regra criada", description: "Rascunho ativo salvo sem criar job.", variant: "success" });
    },
    onError(error) {
      toast.push({ title: "Falha ao criar regra", description: error.message, variant: "danger" });
    },
  });
  const regexStatus = useMemo(
    () => testRegex(matchType, matchValue, regexProbe),
    [matchType, matchValue, regexProbe],
  );

  useEffect(() => {
    if (!selectedChatbotId && chatbots.data?.chatbots[0]) {
      setSelectedChatbotId(String(chatbots.data.chatbots[0].id));
    }
  }, [chatbots.data?.chatbots, selectedChatbotId]);

  function createRuleFromBuilder() {
    const chatbotId = Number.parseInt(selectedChatbotId, 10);
    const action = buildChatbotAction({
      actionKind,
      responseText,
      tagId,
      statusValue,
      notifyMessage,
      automationId,
    });
    if (!Number.isInteger(chatbotId) || chatbotId <= 0) {
      toast.push({ title: "Escolha um chatbot", variant: "warning" });
      return;
    }
    if (!ruleName.trim()) {
      toast.push({ title: "Nome da regra obrigatório", variant: "warning" });
      return;
    }
    if (typeof action === "string") {
      toast.push({ title: "Revise a ação", description: action, variant: "warning" });
      return;
    }
    if (matchType !== "fallback" && !matchValue.trim()) {
      toast.push({ title: "Match precisa de valor", variant: "warning" });
      return;
    }
    if (regexStatus.state === "invalid") {
      toast.push({ title: "Regex inválida", description: regexStatus.message, variant: "warning" });
      return;
    }
    const basePriority = Number.parseInt(priority, 10);
    createRule.mutate({
      chatbotId,
      name: ruleName.trim(),
      priority: Number.isInteger(basePriority) && basePriority >= 0 ? basePriority : 100,
      match: { type: matchType, value: matchType === "fallback" ? null : matchValue.trim() },
      segment: null,
      actions: [action],
      metadata: buildChatbotVariantsMetadata(variantsEnabled, variantA, variantB, action),
    });
  }

  return (
    <div className="flex flex-col gap-7 max-w-6xl mx-auto pt-2">
      <Animate preset="rise-in">
        <header>
          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-fg-dim font-mono">
            Chatbots
          </p>
          <h1 className="font-serif italic text-5xl md:text-6xl leading-[1] mt-2 tracking-tight">
            Auto-resposta <span className="text-brand-violet">priorizada</span>.
          </h1>
          <p className="text-sm text-fg-muted mt-3 max-w-xl">
            Regras com prioridade, fallback e variantes A/B determinísticas para dry-run seguro.
          </p>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.06}>
        <Card data-testid="chatbots-ab-test-summary">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Teste seco A/B</CardTitle>
                <CardDescription>
                  Simula a regra ativa sem criar job e sem enviar mensagem.
                </CardDescription>
              </div>
              <Badge variant="violet">V2.10.35</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-[14rem_11rem_1fr_auto]">
            <Select value={selectedChatbotId} onValueChange={setSelectedChatbotId}>
              <SelectTrigger
                aria-label="Chatbot do teste seco"
                data-testid="chatbot-dry-run-chatbot-select"
              >
                <SelectValue placeholder="Chatbot" />
              </SelectTrigger>
              <SelectContent>
                {(chatbots.data?.chatbots ?? []).map((chatbot) => (
                  <SelectItem key={chatbot.id} value={String(chatbot.id)}>
                    {chatbot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={phone}
              inputMode="tel"
              aria-label="Telefone do teste"
              onChange={(event) => setPhone(event.target.value)}
            />
            <Input
              value={body}
              aria-label="Mensagem do teste"
              onChange={(event) => setBody(event.target.value)}
            />
            <Button
              variant="accent"
              loading={dryRun.isFetching}
              leftIcon={<FlaskConical className="h-4 w-4" />}
              data-testid="chatbot-ab-dry-run-button"
              onClick={() => void dryRun.refetch()}
            >
              Testar
            </Button>
            {dryRun.data && (
              <div
                className="lg:col-span-4 rounded-lg border border-border-muted bg-bg-base/60 px-4 py-3 text-sm"
                data-testid="chatbot-ab-dry-run-result"
                data-selected-variant-id={dryRun.data.abTest?.selectedVariantId ?? ""}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={dryRun.data.matched ? "success" : "warning"}>
                    {dryRun.data.matched ? "match" : "sem match"}
                  </Badge>
                  <Badge variant={dryRun.data.abTest ? "cyan" : "neutral"}>
                    variante: {selectedVariant}
                  </Badge>
                  <span className="text-fg-muted">
                    {dryRun.data.actions.length} ação(ões) prevista(s)
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.08}>
        <Card data-testid="chatbot-rule-builder">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Builder de regras</CardTitle>
                <CardDescription>
                  Match, regex tester, fallback, ações e variantes sem disparar envio.
                </CardDescription>
              </div>
              <Badge variant="cyan">V2.10.26-34</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_8rem]">
              <LabeledField label="Chatbot">
                <Select value={selectedChatbotId} onValueChange={setSelectedChatbotId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {(chatbots.data?.chatbots ?? []).map((chatbot) => (
                      <SelectItem key={chatbot.id} value={String(chatbot.id)}>
                        {chatbot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Nome">
                <Input value={ruleName} onChange={(event) => setRuleName(event.target.value)} />
              </LabeledField>
              <LabeledField label="Prioridade">
                <Input
                  inputMode="numeric"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                />
              </LabeledField>
            </div>

            <div className="grid gap-3 lg:grid-cols-[12rem_1fr_1fr]">
              <LabeledField label="Tipo de match">
                <Select
                  value={matchType}
                  onValueChange={(value) => setMatchType(value as ChatbotRuleMatch["type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {matchTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Valor">
                <Input
                  value={matchValue}
                  disabled={matchType === "fallback"}
                  onChange={(event) => setMatchValue(event.target.value)}
                />
              </LabeledField>
              <LabeledField label="Regex tester">
                <Input value={regexProbe} onChange={(event) => setRegexProbe(event.target.value)} />
              </LabeledField>
            </div>
            <div
              className="rounded-lg border border-border-muted bg-bg-base/60 px-3 py-2 text-xs"
              data-testid="chatbot-regex-tester"
              data-regex-state={regexStatus.state}
            >
              <div className="flex items-center gap-2">
                <Regex className="h-4 w-4 text-brand-cyan" />
                <span className="font-mono">{regexStatus.message}</span>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[12rem_1fr]">
              <LabeledField label="Ação">
                <Select value={actionKind} onValueChange={(value) => setActionKind(value as ChatbotActionKind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {chatbotActionKinds.map((kind) => (
                      <SelectItem key={kind.value} value={kind.value}>
                        {kind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledField>
              <ChatbotActionEditor
                actionKind={actionKind}
                responseText={responseText}
                tagId={tagId}
                statusValue={statusValue}
                notifyMessage={notifyMessage}
                automationId={automationId}
                onResponseTextChange={setResponseText}
                onTagIdChange={setTagId}
                onStatusValueChange={setStatusValue}
                onNotifyMessageChange={setNotifyMessage}
                onAutomationIdChange={setAutomationId}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[auto_1fr_1fr]">
              <label className="flex items-center gap-3 rounded-lg bg-bg-base px-4 py-3 shadow-pressed-sm">
                <input
                  type="checkbox"
                  checked={variantsEnabled}
                  onChange={(event) => setVariantsEnabled(event.target.checked)}
                />
                <span className="text-sm text-fg-muted">Variantes A/B</span>
              </label>
              <LabeledField label="Variante A">
                <Input value={variantA} onChange={(event) => setVariantA(event.target.value)} />
              </LabeledField>
              <LabeledField label="Variante B">
                <Input value={variantB} onChange={(event) => setVariantB(event.target.value)} />
              </LabeledField>
            </div>

            <div className="flex justify-end">
              <Button
                variant="accent"
                loading={createRule.isPending}
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={createRuleFromBuilder}
                data-testid="chatbot-create-rule-button"
              >
                Criar regra
              </Button>
            </div>
          </CardContent>
        </Card>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>Existentes</CardTitle>
            <CardDescription>
              {chatbots.data ? `${chatbots.data.chatbots.length} chatbot(s)` : "—"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chatbots.isLoading ? (
              <LoadingState />
            ) : chatbots.error ? (
              <ErrorState description={chatbots.error.message} />
            ) : !chatbots.data || chatbots.data.chatbots.length === 0 ? (
              <EmptyState description="Nenhum chatbot ainda." />
            ) : (
              <div className="grid gap-4" data-testid="chatbot-list">
                {chatbots.data.chatbots.map((chatbot) => (
                  <section
                    key={chatbot.id}
                    className="rounded-lg border border-border-muted bg-bg-sunken/40 p-4"
                    data-testid="chatbot-card"
                    data-chatbot-id={chatbot.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 text-brand-cyan" />
                          <h2 className="truncate text-base font-medium">{chatbot.name}</h2>
                        </div>
                        <p className="mt-1 text-xs font-mono text-fg-dim">
                          #{chatbot.id} · {chatbot.channel}
                        </p>
                      </div>
                      <Badge variant={chatbot.status === "active" ? "success" : "neutral"}>
                        {chatbot.status}
                      </Badge>
                    </div>
                    <ChatbotRulesPanel chatbotId={chatbot.id} />
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Animate>
    </div>
  );
}

function ChatbotRulesPanel({ chatbotId }: { chatbotId: number }) {
  const rules = trpc.chatbots.listRules.useQuery({ chatbotId, isActive: true });
  const utils = trpc.useUtils();
  const [dragRuleId, setDragRuleId] = useState<number | null>(null);
  const updateRule = trpc.chatbots.updateRule.useMutation({
    async onSuccess() {
      await utils.chatbots.listRules.invalidate({ chatbotId, isActive: true });
    },
  });

  async function swapPriority(targetRuleId: number) {
    if (!dragRuleId || dragRuleId === targetRuleId || !rules.data) return;
    const source = rules.data.rules.find((rule) => rule.id === dragRuleId);
    const target = rules.data.rules.find((rule) => rule.id === targetRuleId);
    if (!source || !target) return;
    await Promise.all([
      updateRule.mutateAsync({ id: source.id, priority: target.priority }),
      updateRule.mutateAsync({ id: target.id, priority: source.priority }),
    ]);
    setDragRuleId(null);
  }

  if (rules.isLoading) {
    return <LoadingState className="py-5" title="Carregando regras" />;
  }
  if (rules.error) {
    return <ErrorState className="py-5" description={rules.error.message} />;
  }
  if (!rules.data || rules.data.rules.length === 0) {
    return <EmptyState className="py-5" description="Nenhuma regra ativa." />;
  }

  return (
    <div className="mt-4 grid gap-3">
      {rules.data.rules.map((rule) => {
        const abTest = readAbTest(rule.metadata);
        return (
          <article
            key={rule.id}
            className="rounded-lg border border-border-subtle bg-bg-base/55 p-3"
            data-testid="chatbot-rule-item"
            data-rule-id={rule.id}
            draggable
            onDragStart={() => setDragRuleId(rule.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void swapPriority(rule.id)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <GripVertical
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-fg-dim"
                  data-testid="chatbot-rule-priority-dnd"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{rule.name}</p>
                  <p className="text-xs font-mono text-fg-dim">
                    prioridade {rule.priority} · {rule.match.type}
                    {rule.match.value ? ` "${rule.match.value}"` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={rule.match.type === "fallback" ? "warning" : "neutral"}>
                  {rule.match.type === "fallback" ? "fallback" : "match"}
                </Badge>
                <Badge variant={abTest?.enabled ? "cyan" : "neutral"}>
                  {abTest?.enabled ? `${abTest.variants.length} variantes` : "sem A/B"}
                </Badge>
              </div>
            </div>
            {abTest && (
              <div
                className="mt-3 grid gap-2 md:grid-cols-2"
                data-testid="chatbot-ab-test-panel"
                data-rule-id={rule.id}
                data-variants={abTest.variants.length}
              >
                {abTest.variants.map((variant) => (
                  <div
                    key={variant.id}
                    className="rounded-md border border-border-muted bg-bg-sunken/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{variant.label}</span>
                      <Badge variant="neutral">{variant.weight}</Badge>
                    </div>
                    <p className="mt-1 text-xs font-mono text-fg-dim">
                      {variant.actionsCount} ação(ões) · {abTest.assignment}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ChatbotActionEditor({
  actionKind,
  responseText,
  tagId,
  statusValue,
  notifyMessage,
  automationId,
  onResponseTextChange,
  onTagIdChange,
  onStatusValueChange,
  onNotifyMessageChange,
  onAutomationIdChange,
}: {
  actionKind: ChatbotActionKind;
  responseText: string;
  tagId: string;
  statusValue: string;
  notifyMessage: string;
  automationId: string;
  onResponseTextChange: (value: string) => void;
  onTagIdChange: (value: string) => void;
  onStatusValueChange: (value: string) => void;
  onNotifyMessageChange: (value: string) => void;
  onAutomationIdChange: (value: string) => void;
}) {
  if (actionKind === "send_step") {
    return (
      <LabeledField label="Resposta">
        <Textarea rows={3} value={responseText} onChange={(event) => onResponseTextChange(event.target.value)} />
      </LabeledField>
    );
  }
  if (actionKind === "apply_tag") {
    return (
      <LabeledField label="Tag ID">
        <Input inputMode="numeric" value={tagId} onChange={(event) => onTagIdChange(event.target.value)} />
      </LabeledField>
    );
  }
  if (actionKind === "set_status") {
    return (
      <LabeledField label="Status">
        <Input value={statusValue} onChange={(event) => onStatusValueChange(event.target.value)} />
      </LabeledField>
    );
  }
  if (actionKind === "notify_attendant") {
    return (
      <LabeledField label="Mensagem">
        <Input value={notifyMessage} onChange={(event) => onNotifyMessageChange(event.target.value)} />
      </LabeledField>
    );
  }
  return (
    <LabeledField label="Automação ID">
      <Input inputMode="numeric" value={automationId} onChange={(event) => onAutomationIdChange(event.target.value)} />
    </LabeledField>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
        {label}
      </span>
      {children}
    </label>
  );
}

function buildChatbotAction(input: {
  actionKind: ChatbotActionKind;
  responseText: string;
  tagId: string;
  statusValue: string;
  notifyMessage: string;
  automationId: string;
}): AutomationAction | string {
  if (input.actionKind === "send_step") {
    const template = input.responseText.trim();
    return template
      ? {
          type: "send_step",
          step: {
            id: `chatbot-reply-${Date.now()}`,
            label: "Resposta chatbot",
            type: "text",
            template,
            delaySeconds: 0,
            conditions: [],
          },
        }
      : "Resposta vazia.";
  }
  if (input.actionKind === "apply_tag") {
    const tagId = Number.parseInt(input.tagId, 10);
    return Number.isInteger(tagId) && tagId > 0 ? { type: "apply_tag", tagId } : "Tag ID inválido.";
  }
  if (input.actionKind === "set_status") {
    const status = input.statusValue.trim();
    return status ? { type: "set_status", status } : "Status vazio.";
  }
  if (input.actionKind === "notify_attendant") {
    const message = input.notifyMessage.trim();
    return message ? { type: "notify_attendant", attendantId: null, message } : "Mensagem vazia.";
  }
  const automationId = Number.parseInt(input.automationId, 10);
  return Number.isInteger(automationId) && automationId > 0
    ? { type: "trigger_automation", automationId }
    : "Automação ID inválida.";
}

function buildChatbotVariantsMetadata(
  enabled: boolean,
  variantA: string,
  variantB: string,
  fallbackAction: AutomationAction,
) {
  if (!enabled || fallbackAction.type !== "send_step" || fallbackAction.step.type !== "text") {
    return {};
  }
  const baseStep = fallbackAction.step;
  return {
    abTest: {
      enabled: true,
      assignment: "deterministic" as const,
      variants: [
        {
          id: "controle",
          label: "Controle",
          weight: 50,
          actions: [
            {
              type: "send_step" as const,
              step: { ...baseStep, template: variantA.trim() || baseStep.template },
            },
          ],
        },
        {
          id: "variante-b",
          label: "Variante B",
          weight: 50,
          actions: [
            {
              type: "send_step" as const,
              step: { ...baseStep, template: variantB.trim() || baseStep.template },
            },
          ],
        },
      ],
    },
  };
}

function testRegex(matchType: ChatbotRuleMatch["type"], pattern: string, probe: string) {
  if (matchType !== "regex") {
    return { state: "idle" as const, message: "Regex tester ativo apenas para match regex." };
  }
  try {
    const regex = new RegExp(pattern, "i");
    return regex.test(probe)
      ? { state: "matched" as const, message: "Regex válida e casou com o texto de teste." }
      : { state: "miss" as const, message: "Regex válida, mas não casou com o texto de teste." };
  } catch (error) {
    return {
      state: "invalid" as const,
      message: error instanceof Error ? error.message : "Regex inválida.",
    };
  }
}

function readAbTest(metadata: unknown): AbTestSummary | null {
  if (!isRecord(metadata) || !isRecord(metadata.abTest)) {
    return null;
  }
  const variantsRaw = metadata.abTest.variants;
  if (metadata.abTest.enabled !== true || !Array.isArray(variantsRaw) || variantsRaw.length < 2) {
    return null;
  }
  const variants = variantsRaw.flatMap((variant) => {
    if (!isRecord(variant)) return [];
    const id = String(variant.id ?? "");
    const label = String(variant.label ?? "");
    const weight = Number(variant.weight ?? 0);
    const actions = Array.isArray(variant.actions) ? variant.actions : [];
    if (!id || !label || !Number.isFinite(weight)) return [];
    return [{ id, label, weight, actionsCount: actions.length }];
  });
  return variants.length >= 2
    ? {
        enabled: true,
        assignment: "deterministic",
        variants,
      }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
