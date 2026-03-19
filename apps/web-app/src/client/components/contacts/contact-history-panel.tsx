import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Clock3, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

type ContactHistoryItem = {
  id: string;
  field: string;
  label: string;
  previousValue: string | null;
  nextValue: string | null;
  source: string;
  createdAt: string;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function sourceLabel(source: string) {
  switch (source) {
    case "instagram":
      return "Instagram";
    case "whatsapp":
      return "WhatsApp";
    case "automation":
      return "Automação";
    case "system":
      return "Sistema";
    default:
      return "Manual";
  }
}

function sourceTone(source: string): "success" | "warning" | "danger" | "info" | "default" {
  switch (source) {
    case "whatsapp":
      return "success";
    case "instagram":
      return "warning";
    case "automation":
      return "info";
    case "system":
      return "default";
    default:
      return "default";
  }
}

export function ContactHistoryPanel({
  contactId,
  open,
  onToggle
}: {
  contactId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const query = useQuery({
    queryKey: ["contact-history", contactId],
    queryFn: () => apiFetch<ContactHistoryItem[]>(`/contacts/${contactId}/history?limit=80`),
    enabled: open
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-1 items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Histórico de alterações
            </CardTitle>
            <p className="mt-2 text-sm text-slate-400">O histórico fica recolhido por padrão e mostra valores anteriores e novos quando disponíveis.</p>
          </div>
          <Button variant="secondary" onClick={onToggle}>
            {open ? "Ocultar histórico" : "Mostrar histórico"}
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-[1.25rem] border border-white/8 bg-slate-950/45 p-4">
                  <div className="h-4 w-32 rounded-full bg-white/8" />
                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
                    <div className="h-12 rounded-2xl bg-white/6" />
                    <div className="mx-auto h-8 w-8 rounded-full bg-white/6" />
                    <div className="h-12 rounded-2xl bg-white/6" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {!query.isLoading && (query.data ?? []).length === 0 ? <div className="text-sm text-slate-400">Nenhuma alteração relevante registrada até agora.</div> : null}
          <div className="space-y-3">
            {(query.data ?? []).map((item) => (
              <div key={item.id} className="rounded-[1.25rem] border border-white/8 bg-slate-950/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="font-medium text-white">{item.label}</div>
                    <Badge tone={sourceTone(item.source)}>{sourceLabel(item.source)}</Badge>
                  </div>
                  <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatDateTime(item.createdAt)}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Anterior</div>
                    <div className="mt-1 text-sm text-slate-300">{item.previousValue || "Sem valor"}</div>
                  </div>
                  <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-slate-400">
                    <ArrowRightLeft className="h-4 w-4" />
                  </div>
                  <div className="rounded-2xl border border-primary/15 bg-primary/[0.06] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Novo</div>
                    <div className="mt-1 text-sm text-slate-100">{item.nextValue || "Sem valor"}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
