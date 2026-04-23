import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Zap } from "lucide-react";
import { AutomationEditor, type AutomationDraft } from "@/components/automations/editor";
import { ErrorPanel } from "@/components/shared/error-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiFetch, toJsonBody } from "@/lib/api";
import { cn } from "@/lib/utils";

function buildAutomationTemplate(category: AutomationDraft["category"] = "follow-up"): AutomationDraft {
  if (category === "instagram-incoming") {
    return {
      name: "Resposta automatica Instagram",
      category,
      enabled: true,
      description: "Responde no Direct quando entra uma nova mensagem no Instagram, usando o thread ja sincronizado.",
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
          content: "Oi! Recebi sua mensagem aqui no Instagram e ja vou seguir com seu atendimento.",
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
        content: "Oi! Passando para saber se voce quer retomar o atendimento.",
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

  const automations = automationsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Regras Operacionais"
        title="Automacoes"
        description="Configure gatilhos, restricoes e acoes automaticas."
        actions={
          <div className="flex items-center gap-2">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg text-label text-n-ig hover:bg-n-surface-2 transition-fast"
                  onClick={() => setDraft(buildAutomationTemplate("instagram-incoming"))}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Auto-Resposta IG
                </Button>
              </DialogTrigger>
              <div className="h-4 w-px bg-n-border" />
              <DialogTrigger asChild>
                <Button
                  onClick={() => setDraft(buildAutomationTemplate())}
                  className="h-8 rounded-lg bg-n-blue px-4 text-label text-white transition-fast hover:brightness-110"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Nova Regra
                </Button>
              </DialogTrigger>

              <DialogContent className="max-w-4xl max-h-[90vh] rounded-xl border border-n-border bg-n-surface p-0 flex flex-col overflow-hidden">
                <div className="p-4 pb-2 space-y-1 shrink-0">
                  <DialogTitle className="text-h3 text-n-text">
                    {draft.id ? "Editar automacao" : "Nova automacao"}
                  </DialogTitle>
                  <DialogDescription className="text-caption text-n-text-muted">
                    Defina quando a regra dispara, quais bloqueios se aplicam e o que deve acontecer em seguida.
                  </DialogDescription>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
                  <AutomationEditor value={draft} onChange={setDraft} />
                </div>

                <div className="flex items-center justify-between border-t border-n-border p-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="signal-dot active" />
                    <span className="text-micro text-n-text-dim">Persistencia local imediata</span>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="ghost"
                      className="h-9 rounded-lg px-4 text-label text-n-text-muted hover:bg-n-surface-2 transition-fast"
                      onClick={() => setDialogOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="h-9 rounded-lg bg-n-blue px-6 text-label text-white transition-fast hover:brightness-110"
                      onClick={() => saveMutation.mutate(draft)}
                      disabled={saveMutation.isPending}
                    >
                      {saveMutation.isPending ? "Processando..." : draft.id ? "Salvar" : "Ativar Regra"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {automationsQuery.error ? <ErrorPanel message={(automationsQuery.error as Error).message} /> : null}

      {automations.length === 0 && !automationsQuery.isLoading ? (
        <EmptyState
          icon={Zap}
          title="Nenhuma automacao configurada"
          description="Crie sua primeira regra para automatizar acoes operacionais."
          actionLabel="Nova Regra"
          onAction={() => {
            setDraft(buildAutomationTemplate());
            setDialogOpen(true);
          }}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {automations.map((automation) => (
            <div
              key={automation.id}
              className="rounded-xl border border-n-border bg-n-surface p-3 space-y-3 transition-fast hover:border-n-border hover:bg-n-surface-2"
            >
              {/* Header: icon + status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-n-surface-2 flex items-center justify-center shrink-0">
                    {automation.category === "instagram-incoming" ? (
                      <Plus className="h-4 w-4 text-n-ig" />
                    ) : (
                      <Pencil className="h-4 w-4 text-n-text-muted" />
                    )}
                  </div>
                  <h3 className="text-body text-n-text font-medium truncate">
                    {automation.name || "Sem Nome"}
                  </h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("signal-dot", automation.enabled ? "active" : "idle")} />
                  <span className="text-micro text-n-text-dim">
                    {automation.enabled ? "Ativo" : "Pausado"}
                  </span>
                </div>
              </div>

              {/* Description */}
              {automation.description && (
                <p className="text-caption text-n-text-muted line-clamp-2">
                  {automation.description}
                </p>
              )}

              {/* Category + trigger tags */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="info" className="text-micro">
                  {automation.category.replace("-", " ")}
                </Badge>
                {automation.triggerTags.slice(0, 3).map((tag: string) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-md bg-n-surface-2 border border-n-border-subtle px-1.5 py-0.5 text-micro text-n-text-dim"
                  >
                    #{tag}
                  </span>
                ))}
                {automation.triggerTags.length > 3 && (
                  <span className="text-micro text-n-text-dim">
                    +{automation.triggerTags.length - 3}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  className="flex-1 rounded-lg border border-n-border bg-n-surface-2 py-1.5 text-label text-n-text-muted transition-fast hover:text-n-text hover:border-n-blue/40"
                  onClick={() => {
                    setDraft(automation);
                    setDialogOpen(true);
                  }}
                >
                  Ajustar
                </button>
                <button
                  className={cn(
                    "flex-1 rounded-lg py-1.5 text-label transition-fast",
                    automation.enabled
                      ? "border border-n-border bg-n-surface-2 text-n-text-dim hover:text-n-amber"
                      : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  )}
                  onClick={() => toggleMutation.mutate(automation.id)}
                >
                  {automation.enabled ? "Pausar" : "Ativar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
