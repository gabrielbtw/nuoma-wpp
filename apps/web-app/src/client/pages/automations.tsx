import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { AutomationEditor, type AutomationDraft } from "@/components/automations/editor";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiFetch, toJsonBody } from "@/lib/api";
import { cn } from "@/lib/utils";

function buildAutomationTemplate(category: AutomationDraft["category"] = "follow-up"): AutomationDraft {
  if (category === "instagram-incoming") {
    return {
      name: "Resposta automática Instagram",
      category,
      enabled: true,
      description: "Responde no Direct quando entra uma nova mensagem no Instagram, usando o thread já sincronizado.",
      triggerTags: [],
      excludeTags: ["nao_insistir"],
      requiredStatus: null,
      procedureOnly: false,
      requireLastOutgoing: false,
      requireNoReply: false,
      timeWindowHours: 1,
      minimumIntervalHours: 12,
      randomDelayMinSeconds: 5,
      randomDelayMaxSeconds: 15,
      sendWindowStart: "08:00",
      sendWindowEnd: "22:00",
      templateKey: null,
      actions: [
        {
          type: "send-text",
          content: "Oi! Recebi sua mensagem aqui no Instagram e já vou seguir com seu atendimento.",
          mediaPath: null,
          waitSeconds: null,
          tagName: null,
          reminderText: null,
          metadata: {}
        }
      ]
    };
  }

  return {
    name: "",
    category,
    enabled: true,
    description: "",
    triggerTags: ["follow-up"],
    excludeTags: ["nao_insistir"],
    requiredStatus: "aguardando_resposta",
    procedureOnly: false,
    requireLastOutgoing: true,
    requireNoReply: true,
    timeWindowHours: 24,
    minimumIntervalHours: 72,
    randomDelayMinSeconds: 10,
    randomDelayMaxSeconds: 45,
    sendWindowStart: "08:00",
    sendWindowEnd: "20:00",
    templateKey: null,
    actions: [
      {
        type: "send-text",
        content: "Oi! Passando para saber se você quer retomar o atendimento.",
        mediaPath: null,
        waitSeconds: null,
        tagName: null,
        reminderText: null,
        metadata: {}
      }
    ]
  };
}

const emptyAutomation = buildAutomationTemplate();
type AutomationRecord = AutomationDraft & { id: string };

export function AutomationsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AutomationDraft>(emptyAutomation);
  const [dialogOpen, setDialogOpen] = useState(false);

  const automationsQuery = useQuery({
    queryKey: ["automations"],
    queryFn: () => apiFetch<AutomationRecord[]>("/automations")
  });

  const saveMutation = useMutation({
    mutationFn: (payload: typeof emptyAutomation) =>
      apiFetch(draft.id ? `/automations/${draft.id}` : "/automations", {
        method: draft.id ? "PATCH" : "POST",
        body: toJsonBody(payload)
      }),
    onSuccess: async () => {
      setDraft(emptyAutomation);
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["automations"] });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/automations/${id}/toggle`, {
        method: "POST"
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["automations"] });
    }
  });

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-700">
      <PageHeader
        eyebrow="Regras Operacionais"
        title="Automações"
        description="Configure gatilhos, restrições e ações automáticas com foco em operação real, sem etapas cenográficas."
        actions={
          <div className="flex items-center gap-3 bg-white/5 p-1.5 rounded-2xl border border-white/5 backdrop-blur-md">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest text-cmm-blue hover:bg-cmm-blue/10"
                  onClick={() => setDraft(buildAutomationTemplate("instagram-incoming"))}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Auto-Resposta IG
                </Button>
              </DialogTrigger>
              <div className="h-4 w-px bg-white/10" />
              <DialogTrigger asChild>
                <Button
                  onClick={() => setDraft(buildAutomationTemplate())}
                  className="h-10 rounded-xl bg-cmm-blue px-6 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-transform"
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Nova Regra
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl border-white/10 bg-slate-950/90 backdrop-blur-3xl rounded-[2.5rem] p-0 overflow-hidden shadow-2xl">
                <div className="p-10 space-y-8">
                  <div className="space-y-2">
                    <DialogTitle className="font-display text-3xl font-bold text-white tracking-tight">
                      {draft.id ? "Editar automação" : "Nova automação"}
                    </DialogTitle>
                    <DialogDescription className="text-sm font-medium text-slate-400">
                      Defina quando a regra dispara, quais bloqueios se aplicam e o que deve acontecer em seguida.
                    </DialogDescription>
                  </div>

                  <AutomationEditor value={draft} onChange={setDraft} />

                  <div className="flex items-center justify-between border-t border-white/5 pt-8">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-cmm-blue animate-pulse" />
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Persistência local imediata</span>
                    </div>
                    <div className="flex gap-4">
                      <Button variant="ghost" className="h-12 rounded-2xl px-8 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-white/5" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                      <Button
                        className="h-12 rounded-2xl bg-cmm-blue px-10 text-xs font-black uppercase tracking-widest shadow-xl shadow-blue-500/20"
                        onClick={() => saveMutation.mutate(draft)}
                        disabled={saveMutation.isPending}
                      >
                        {saveMutation.isPending ? "PROCESSANDO..." : draft.id ? "SALVAR ALTERAÇÕES" : "ATIVAR REGRA"}
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {automationsQuery.error ? <ErrorPanel message={(automationsQuery.error as Error).message} /> : null}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {(automationsQuery.data ?? []).map((automation) => (
          <div key={automation.id} className="group relative glass-card rounded-[2rem] border-white/5 bg-white/[0.01] overflow-hidden transition-all duration-500 hover:bg-white/[0.03] hover:scale-[1.01] hover:shadow-2xl">
            <div className="p-8 space-y-6">
              <div className="flex items-start justify-between">
                <div className="h-12 w-12 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-cmm-blue group-hover:text-white transition-colors duration-500">
                  {automation.category === "instagram-incoming" ? <Plus className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge tone={automation.enabled ? "success" : "warning"} className="rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest">
                    {automation.enabled ? "Ativo" : "Pausado"}
                  </Badge>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">ID: {automation.id.split('-')[0]}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-display text-xl font-bold text-white tracking-tight leading-tight">{automation.name || "Sem Nome"}</h3>
                <p className="text-sm font-medium text-slate-400 line-clamp-2 min-h-[40px] opacity-70">{automation.description || "Nenhuma descrição definida para esta regra operacional."}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge tone="info" className="bg-cmm-blue/10 text-cmm-blue border-white/5 text-[9px] font-black uppercase tracking-widest">
                  {automation.category.replace('-', ' ')}
                </Badge>
                {automation.triggerTags.length > 0 && (
                  <div className="flex -space-x-2">
                    {automation.triggerTags.slice(0, 3).map((tag: string) => (
                      <div key={tag} className="h-6 px-3 rounded-full bg-slate-900 border border-white/10 flex items-center shadow-lg">
                        <span className="text-[8px] font-bold text-slate-300">#{tag}</span>
                      </div>
                    ))}
                    {automation.triggerTags.length > 3 && (
                      <div className="h-6 w-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[8px] font-bold text-slate-500">
                        +{automation.triggerTags.length - 3}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <Button
                  variant="ghost"
                  className="h-12 rounded-2xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-cmm-blue/10 hover:text-cmm-blue group-hover:border-cmm-blue/20"
                  onClick={() => {
                    setDraft(automation);
                    setDialogOpen(true);
                  }}
                >
                  Ajustar
                </Button>
                <Button
                  variant="secondary"
                  className={cn(
                    "h-12 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all",
                    automation.enabled ? "bg-white/5 text-slate-500" : "bg-cmm-emerald/10 text-cmm-emerald shadow-lg shadow-emerald-500/10"
                  )}
                  onClick={() => toggleMutation.mutate(automation.id)}
                >
                  {automation.enabled ? "Pausar" : "Ativar"}
                </Button>
              </div>
            </div>
          </div>
        ))}

        <button
          onClick={() => {
            setDraft(buildAutomationTemplate());
            setDialogOpen(true);
          }}
          className="group h-full min-h-[340px] rounded-[2rem] border-2 border-dashed border-white/5 bg-transparent p-8 flex flex-col items-center justify-center text-center gap-4 transition-all hover:border-cmm-blue/30 hover:bg-cmm-blue/[0.02]"
        >
          <div className="h-14 w-14 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-cmm-blue/10 group-hover:scale-110 transition-all duration-500">
            <Plus className="h-6 w-6 text-slate-500 group-hover:text-cmm-blue" />
          </div>
          <div>
            <p className="font-display text-lg font-bold text-slate-400 group-hover:text-white transition-colors">Nova Regra</p>
            <p className="text-xs font-medium text-slate-600 mt-1">Crie um novo fluxo de ações automáticas</p>
          </div>
        </button>
      </div>
    </div>
  );
}
