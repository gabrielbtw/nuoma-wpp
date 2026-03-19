import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorPanel } from "@/components/shared/error-panel";
import { ContactHistoryPanel } from "@/components/contacts/contact-history-panel";
import { ChannelIndicators } from "@/components/contacts/channel-indicators";
import { TagPill } from "@/components/tags/tag-pill";
import { apiFetch } from "@/lib/api";
import { formatChannelDisplayValue, formatCpfInput, formatPhoneForDisplay } from "@/lib/contact-utils";

type ContactChannel = {
  id: string;
  type: "whatsapp" | "instagram" | string;
  displayValue: string;
  normalizedValue: string | null;
  isPrimary: boolean;
  isActive: boolean;
};

type ContactRecord = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  instagram: string | null;
  cpf: string | null;
  notes: string | null;
  status: string;
  procedureStatus: "yes" | "no" | "unknown";
  tags: string[];
  channels: ContactChannel[];
  instagramFollowsMe: boolean | null;
  instagramFollowedByMe: boolean | null;
  instagramIncomingMessagesCount: number;
  instagramSentMoreThanThreeMessages: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

type TagRecord = {
  id: string;
  name: string;
  color: string;
};

const statusLabelMap: Record<string, string> = {
  novo: "Novo",
  aguardando_resposta: "Aguardando resposta",
  em_atendimento: "Em atendimento",
  cliente: "Cliente",
  sem_retorno: "Sem retorno",
  perdido: "Perdido"
};

const procedureLabelMap: Record<ContactRecord["procedureStatus"], string> = {
  yes: "Sim",
  no: "Não",
  unknown: "Não definido"
};

function statusTone(status: string): "success" | "warning" | "danger" | "info" | "default" {
  switch (status) {
    case "cliente":
      return "success";
    case "aguardando_resposta":
    case "em_atendimento":
      return "warning";
    case "perdido":
      return "danger";
    default:
      return "default";
  }
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatInstagramRelationship(contact: ContactRecord) {
  if (contact.instagramFollowsMe === true && contact.instagramFollowedByMe === true) {
    return "Mútuo";
  }
  if (contact.instagramFollowsMe === true) {
    return "Segue você";
  }
  if (contact.instagramFollowedByMe === true) {
    return "Você segue";
  }
  if (contact.instagramFollowsMe === false && contact.instagramFollowedByMe === false) {
    return "Sem vínculo atual";
  }
  return "Sem leitura";
}

export function ContactDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [historyOpen, setHistoryOpen] = useState(false);

  const query = useQuery({
    queryKey: ["contact", id],
    queryFn: () => apiFetch<ContactRecord>(`/contacts/${id}`),
    enabled: Boolean(id)
  });

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  const colorMap = useMemo(
    () => new Map((tagsQuery.data ?? []).map((item) => [item.name.trim().toLowerCase(), item.color])),
    [tagsQuery.data]
  );

  function goBack() {
    if (window.history.length > 1) {
      void navigate(-1);
      return;
    }

    void navigate("/contacts");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Detalhe do contato"
        description="Visão consolidada do cadastro, dos canais vinculados e do histórico, sem abrir o histórico por padrão."
        actions={
          <Button variant="ghost" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        }
      />
      {query.error ? <ErrorPanel message={(query.error as Error).message} /> : null}
      {query.data ? (
        <>
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-white/8 bg-white/[0.04]">
              <CardHeader>
                <div className="flex flex-1 flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <CardTitle>{query.data.name || "Sem nome"}</CardTitle>
                      <Badge tone={statusTone(query.data.status)}>{statusLabelMap[query.data.status] ?? query.data.status}</Badge>
                    </div>
                    <p className="mt-2 max-w-xl text-sm text-slate-400">Dados principais do contato e leitura rápida dos canais disponíveis.</p>
                  </div>
                  <ChannelIndicators phone={query.data.phone} instagram={query.data.instagram} channels={query.data.channels} />
                </div>
              </CardHeader>
              <CardContent className="grid gap-5 lg:grid-cols-2">
                {[
                  ["Telefone", formatPhoneForDisplay(query.data.phone)],
                  ["Email", query.data.email || "-"],
                  ["Instagram", query.data.instagram || "-"],
                  ["CPF", query.data.cpf ? formatCpfInput(query.data.cpf) : "-"],
                  ["Status", statusLabelMap[query.data.status] ?? query.data.status],
                  ["Procedimento", procedureLabelMap[query.data.procedureStatus]],
                  ["Vínculo Instagram", formatInstagramRelationship(query.data)],
                  ["Msgs recebidas no Instagram", query.data.instagramIncomingMessagesCount],
                  ["Mais de 3 msgs no Instagram", query.data.instagramSentMoreThanThreeMessages ? "Sim" : "Não"]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[1.25rem] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
                    <div className="mt-2 text-sm text-slate-200">{String(value)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-white/8 bg-white/[0.04]">
              <CardHeader>
                <CardTitle>Detalhes do contato</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <div className="text-sm text-slate-400">Canais vinculados</div>
                  <div className="mt-3 space-y-2">
                    {(query.data.channels ?? []).map((channel) => (
                      <div key={channel.id} className="flex items-center justify-between rounded-[1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div>
                          <div className="text-sm text-white">{formatChannelDisplayValue(channel.type, channel.displayValue)}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{channel.type}</div>
                        </div>
                        {channel.isPrimary ? <Badge tone="info">Principal</Badge> : null}
                      </div>
                    ))}
                    {(query.data.channels ?? []).length === 0 ? <div className="text-sm text-slate-500">Nenhum canal vinculado.</div> : null}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Tags</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(query.data.tags ?? []).map((tag) => (
                      <TagPill key={tag} name={tag} color={colorMap.get(tag.trim().toLowerCase())} />
                    ))}
                    {(query.data.tags ?? []).length === 0 ? <div className="text-sm text-slate-500">Nenhuma tag vinculada.</div> : null}
                  </div>
                </div>

                <div className="rounded-[1.25rem] border border-white/8 bg-slate-950/45 p-4">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <MessageSquareText className="h-4 w-4" />
                    Última mensagem
                  </div>
                  <div className="mt-2 text-sm text-slate-100">{query.data.lastMessagePreview || "Sem última mensagem registrada."}</div>
                  <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">{formatDateTime(query.data.lastMessageAt)}</div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Observações</div>
                  <p className="mt-2 text-sm text-slate-200">{query.data.notes || "Sem observações internas."}</p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Criado em</div>
                    <div className="mt-2 text-sm text-slate-200">{formatDateTime(query.data.createdAt)}</div>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Atualizado em</div>
                    <div className="mt-2 text-sm text-slate-200">{formatDateTime(query.data.updatedAt)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <ContactHistoryPanel contactId={query.data.id} open={historyOpen} onToggle={() => setHistoryOpen((current) => !current)} />
        </>
      ) : null}
    </div>
  );
}
