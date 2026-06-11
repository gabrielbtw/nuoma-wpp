import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Globe2, Instagram, MessageCircleMore, Plus, Trash2, GripVertical,
  Power, PowerOff, MessageSquareText, AlertTriangle
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { apiFetch, toJsonBody } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type ChatbotRule = {
  id?: string;
  priority: number;
  matchType: string;
  keywordPattern: string;
  responseType: string;
  responseBody: string;
  responseMediaPath: string | null;
  applyTag: string | null;
  changeStatus: string | null;
  flagForHuman: boolean;
  enabled: boolean;
  triggerAutomationId: string | null;
  phoneDddFilter: string | null;
};

type ChatbotRecord = {
  id: string;
  name: string;
  enabled: boolean;
  channelScope: string;
  description: string;
  fallbackAction: string;
  fallbackTag: string;
  rules: ChatbotRule[];
  createdAt: string;
  updatedAt: string;
};

const matchTypeOptions = [
  { value: "contains", label: "Contem" },
  { value: "exact", label: "Exato" },
  { value: "starts_with", label: "Comeca com" },
  { value: "regex", label: "Regex" }
];

function emptyRule(): ChatbotRule {
  return {
    priority: 0, matchType: "contains", keywordPattern: "", responseType: "text",
    responseBody: "", responseMediaPath: null, applyTag: null, changeStatus: null,
    flagForHuman: false, enabled: true, triggerAutomationId: null, phoneDddFilter: null
  };
}

function emptyChatbot() {
  return {
    name: "", enabled: true, channelScope: "any", description: "",
    fallbackAction: "silence_and_flag", fallbackTag: "chatbot_nao_entendeu",
    rules: [emptyRule()]
  };
}

export function ChatbotPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof emptyChatbot>>(emptyChatbot());
  const [creating, setCreating] = useState(false);
  const [testInput, setTestInput] = useState("");

  const chatbotsQuery = useQuery({
    queryKey: ["chatbots"],
    queryFn: () => apiFetch<ChatbotRecord[]>("/chatbots")
  });

  const automationsQuery = useQuery({
    queryKey: ["automations"],
    queryFn: () => apiFetch<Array<{ id: string; name: string; enabled: boolean }>>("/automations")
  });
  const automations = automationsQuery.data ?? [];

  const chatbots = chatbotsQuery.data ?? [];
  const selected = chatbots.find((c) => c.id === selectedId) ?? null;

  const saveMutation = useMutation({
    mutationFn: (data: { id?: string; payload: Record<string, unknown> }) =>
      data.id
        ? apiFetch(`/chatbots/${data.id}`, { method: "PATCH", body: toJsonBody(data.payload) })
        : apiFetch("/chatbots", { method: "POST", body: toJsonBody(data.payload) }),
    onSuccess: async () => {
      toast("success", creating ? "Chatbot criado!" : "Chatbot atualizado!");
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ["chatbots"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/chatbots/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast("success", "Chatbot removido.");
      setSelectedId(null);
      await qc.invalidateQueries({ queryKey: ["chatbots"] });
    }
  });

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setDraft(emptyChatbot());
  }

  function selectChatbot(bot: ChatbotRecord) {
    setCreating(false);
    setSelectedId(bot.id);
    setDraft({
      name: bot.name, enabled: bot.enabled, channelScope: bot.channelScope,
      description: bot.description, fallbackAction: bot.fallbackAction,
      fallbackTag: bot.fallbackTag, rules: bot.rules.length > 0 ? bot.rules : [emptyRule()]
    });
  }

  // Simulate match test
  const testResult = testInput.trim() ? draft.rules.find((r) => {
    if (!r.enabled || !r.keywordPattern) return false;
    const text = testInput.toLowerCase();
    const pattern = r.keywordPattern.toLowerCase();
    if (r.matchType === "contains") return text.includes(pattern);
    if (r.matchType === "exact") return text === pattern;
    if (r.matchType === "starts_with") return text.startsWith(pattern);
    if (r.matchType === "regex") { try { return new RegExp(pattern, "i").test(text); } catch { return false; } }
    return false;
  }) : null;

  const isEditing = creating || selectedId;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden animate-fade-in">
      <PageHeader
        eyebrow="Automacao"
        title="Chatbot"
        description="Regras de resposta automatica por keyword para WhatsApp e Instagram."
        actions={
          <Button onClick={startCreate} className="bg-cmm-purple text-white transition-all duration-200 hover:brightness-110">
            <Plus className="h-4 w-4 mr-2" /> Novo chatbot
          </Button>
        }
      />

      <div className="grid flex-1 gap-4 overflow-hidden xl:grid-cols-[320px_1fr_300px]">
        {/* Left: Chatbot list */}
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar">
            {chatbots.map((bot) => (
              <button key={bot.id} onClick={() => selectChatbot(bot)}
                className={cn("w-full flex items-center gap-3 rounded-xl p-3 text-left transition-all duration-200",
                  selectedId === bot.id ? "bg-cmm-purple/10 border border-cmm-purple/30" : "hover:bg-n-surface-2 border border-transparent")}>
                <Bot className={cn("h-5 w-5 shrink-0", bot.enabled ? "text-cmm-purple" : "text-n-text-dim")} />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-n-text truncate">{bot.name}</p>
                  <p className="text-micro text-n-text-dim">{bot.rules.length} regras | {bot.channelScope}</p>
                </div>
                {bot.enabled ? <Power className="h-3.5 w-3.5 text-n-wa" /> : <PowerOff className="h-3.5 w-3.5 text-n-text-dim" />}
              </button>
            ))}
            {chatbots.length === 0 && (
              <EmptyState icon={Bot} title="Nenhum chatbot" description="Crie seu primeiro chatbot para responder automaticamente." actionLabel="Criar chatbot" onAction={startCreate} />
            )}
          </div>
        </div>

        {/* Center: Editor */}
        <div className="flex flex-col gap-4 overflow-y-auto custom-scrollbar">
          {isEditing ? (
            <div className="space-y-4">
              {/* Config */}
              <div className="rounded-2xl border border-n-border/40 bg-n-surface p-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className="text-micro font-semibold uppercase tracking-wider text-n-text-dim">Nome</p>
                    <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Meu Chatbot" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-micro font-semibold uppercase tracking-wider text-n-text-dim">Canal</p>
                    <div className="flex gap-2">
                      {[
                        { value: "any", label: "Todos", icon: Globe2 },
                        { value: "whatsapp", label: "WA", icon: MessageCircleMore },
                        { value: "instagram", label: "IG", icon: Instagram }
                      ].map((opt) => (
                        <button key={opt.value} onClick={() => setDraft({ ...draft, channelScope: opt.value })}
                          className={cn("flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border text-xs font-bold transition-all",
                            draft.channelScope === opt.value ? "border-cmm-purple/30 bg-cmm-purple/10 text-cmm-purple" : "border-n-border/40 bg-n-surface text-n-text-dim")}>
                          <opt.icon className="h-3.5 w-3.5" /> {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-n-surface-2 px-3 py-2.5">
                  <span className="text-caption text-n-text-muted">Ativo</span>
                  <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
                </div>
              </div>

              {/* Rules */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-semibold text-n-text">Regras ({draft.rules.length})</h3>
                  <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, rules: [...draft.rules, emptyRule()] })} className="text-cmm-purple">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Regra
                  </Button>
                </div>

                {draft.rules.map((rule, idx) => (
                  <div key={idx} className="rounded-xl border border-n-border/40 bg-n-surface p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-micro text-n-text-dim">Regra {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <Switch checked={rule.enabled} onCheckedChange={(v) => {
                          const rules = [...draft.rules]; rules[idx] = { ...rule, enabled: v }; setDraft({ ...draft, rules });
                        }} />
                        <button onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== idx) })}
                          className="text-n-text-dim hover:text-n-red"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[120px_1fr]">
                      <select className="h-9 rounded-lg border border-n-border/40 bg-n-surface-2 px-2 text-xs font-semibold text-n-text"
                        value={rule.matchType} onChange={(e) => {
                          const rules = [...draft.rules]; rules[idx] = { ...rule, matchType: e.target.value }; setDraft({ ...draft, rules });
                        }}>
                        {matchTypeOptions.map((o) => <option key={o.value} value={o.value} className="bg-n-bg">{o.label}</option>)}
                      </select>
                      <Input className="h-9" placeholder="Palavra-chave..." value={rule.keywordPattern} onChange={(e) => {
                        const rules = [...draft.rules]; rules[idx] = { ...rule, keywordPattern: e.target.value }; setDraft({ ...draft, rules });
                      }} />
                    </div>
                    <Textarea className="min-h-[60px] text-sm" placeholder="Resposta automatica..." value={rule.responseBody} onChange={(e) => {
                      const rules = [...draft.rules]; rules[idx] = { ...rule, responseBody: e.target.value }; setDraft({ ...draft, rules });
                    }} />
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-micro text-n-text-dim">
                        <input type="checkbox" checked={rule.flagForHuman} onChange={(e) => {
                          const rules = [...draft.rules]; rules[idx] = { ...rule, flagForHuman: e.target.checked }; setDraft({ ...draft, rules });
                        }} className="rounded" />
                        Sinalizar p/ humano
                      </label>
                      <Input className="h-7 w-32 text-xs" placeholder="Aplicar tag..." value={rule.applyTag ?? ""} onChange={(e) => {
                        const rules = [...draft.rules]; rules[idx] = { ...rule, applyTag: e.target.value || null }; setDraft({ ...draft, rules });
                      }} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Input className="h-7 w-24 text-xs" placeholder="Filtro DDD" value={rule.phoneDddFilter ?? ""} onChange={(e) => {
                        const rules = [...draft.rules]; rules[idx] = { ...rule, phoneDddFilter: e.target.value || null }; setDraft({ ...draft, rules });
                      }} />
                      <select className="h-7 rounded-lg border border-n-border/40 bg-n-surface-2 px-2 text-xs text-n-text" value={rule.triggerAutomationId ?? ""} onChange={(e) => {
                        const rules = [...draft.rules]; rules[idx] = { ...rule, triggerAutomationId: e.target.value || null }; setDraft({ ...draft, rules });
                      }}>
                        <option value="">Sem automação</option>
                        {automations.filter((a) => a.enabled).map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              {/* Fallback */}
              <div className="rounded-xl border border-n-amber/20 bg-n-amber/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-n-amber" />
                  <p className="text-xs font-semibold text-n-amber">Fallback (sem match)</p>
                </div>
                <p className="text-micro text-n-text-muted">Quando nenhuma regra faz match: silencio + flag com tag "{draft.fallbackTag}"</p>
              </div>

              {/* Save */}
              <div className="flex gap-3">
                <Button className="flex-1 bg-cmm-purple text-white transition-all duration-200 hover:brightness-110" disabled={!draft.name.trim() || saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ id: selectedId ?? undefined, payload: draft })}>
                  {saveMutation.isPending ? "Salvando..." : creating ? "Criar chatbot" : "Salvar alteracoes"}
                </Button>
                {selectedId && (
                  <Button variant="ghost" className="text-red-400" onClick={() => deleteMutation.mutate(selectedId)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <EmptyState icon={Bot} title="Selecione ou crie um chatbot" description="Escolha um chatbot da lista ou crie um novo para configurar regras de resposta automatica." />
          )}
        </div>

        {/* Right: Preview / Test */}
        <div className="hidden xl:flex flex-col gap-4">
          <div className="rounded-2xl border border-n-border/40 bg-n-surface p-4 space-y-3">
            <h4 className="text-label font-semibold text-n-text">Testar resposta</h4>
            <Input placeholder="Digite uma mensagem de teste..." value={testInput} onChange={(e) => setTestInput(e.target.value)} />
            {testInput.trim() && (
              <div className="space-y-2">
                {testResult ? (
                  <div className="rounded-lg bg-n-wa/10 border border-n-wa/20 p-3">
                    <p className="text-micro font-semibold text-n-wa uppercase tracking-wider">Match encontrado</p>
                    <p className="mt-1 text-caption text-n-text-muted">Keyword: {testResult.keywordPattern}</p>
                    <div className="mt-2 rounded-lg bg-n-surface-2 p-2">
                      <p className="text-body text-n-text">{testResult.responseBody || "(sem resposta configurada)"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-n-amber/10 border border-n-amber/20 p-3">
                    <p className="text-micro font-semibold text-n-amber uppercase tracking-wider">Sem match</p>
                    <p className="mt-1 text-caption text-n-text-muted">Fallback: silencio + flag "{draft.fallbackTag}"</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chat preview mockup */}
          <div className="flex-1 rounded-2xl border border-n-border/40 bg-n-surface p-4 space-y-3 overflow-y-auto">
            <h4 className="text-label font-semibold text-n-text">Preview da conversa</h4>
            <div className="space-y-2">
              {testInput.trim() && (
                <>
                  <div className="flex justify-end">
                    <div className="rounded-2xl rounded-br-md bg-n-surface-2 px-3 py-2 max-w-[80%]">
                      <p className="text-caption text-n-text-muted">{testInput}</p>
                    </div>
                  </div>
                  {testResult ? (
                    <div className="flex justify-start">
                      <div className="rounded-2xl rounded-bl-md bg-cmm-purple/20 px-3 py-2 max-w-[80%]">
                        <p className="text-caption text-n-text">{testResult.responseBody || "..."}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center">
                      <p className="text-micro text-n-text-dim italic">Sem resposta (fallback)</p>
                    </div>
                  )}
                </>
              )}
              {!testInput.trim() && (
                <p className="text-micro text-n-text-dim text-center py-8">Digite uma mensagem acima para testar</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
