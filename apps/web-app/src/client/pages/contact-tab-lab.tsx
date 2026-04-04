import { ArrowRight, CalendarClock, CheckCheck, CircleDashed, Clock3, Instagram, LayoutTemplate, MessageSquareText, Phone, ShieldCheck, Sparkles, Star, UserRound, Zap } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MockClient = {
  name: string;
  handle: string;
  phone: string;
  status: string;
  procedure: string;
  tags: string[];
  note: string;
  relationship: string;
  lastTouch: string;
  nextAction: string;
  incomingMessages: number;
  hasStrongIntent: boolean;
};

const mockClient: MockClient = {
  name: "Marina Soares",
  handle: "@marinasoares.skin",
  phone: "+55 31 99888-2145",
  status: "Aguardando resposta",
  procedure: "Já fez procedimento",
  tags: ["VIP", "Instagram quente", "Retorno 15d"],
  note: "Prefere abordagem consultiva, responde melhor à noite e tende a converter quando recebe prova social com antes/depois.",
  relationship: "Segue você, recebeu 12 mensagens e já iniciou conversa mais de 3 vezes.",
  lastTouch: "29 mar 2026, 20:14",
  nextAction: "Enviar proposta com duas opções de agenda e CTA de confirmação.",
  incomingMessages: 12,
  hasStrongIntent: true
};

const versions = [
  {
    name: "Versão 01",
    title: "Concierge Profile",
    description: "Foco em acolhimento premium, leitura rápida e decisão de próximo passo em um bloco só."
  },
  {
    name: "Versão 02",
    title: "Signal Board",
    description: "Mais analítica, com ênfase em sinais de relacionamento, intensidade e timing da conversa."
  },
  {
    name: "Versão 03",
    title: "Narrative Ledger",
    description: "Organiza o cliente como uma mini história operacional, ótima para handoff e contexto."
  },
  {
    name: "Versão 04",
    title: "Compact Revenue Rail",
    description: "Pensada como rail lateral de inbox, enxuta e agressiva para operação diária."
  }
] as const;

function MiniMetric({
  label,
  value,
  icon: Icon,
  accent
}: {
  label: string;
  value: string;
  icon: typeof Clock3;
  accent: string;
}) {
  return (
    <div className="rounded-[1.35rem] border border-white/8 bg-black/30 px-4 py-4">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
        <Icon className={cn("h-3.5 w-3.5", accent)} />
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold tracking-tight text-white">{value}</div>
    </div>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <Badge key={tag} className="border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-200">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function ConciergeVersion() {
  return (
    <section className="rounded-[2rem] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_38%),linear-gradient(160deg,rgba(15,23,42,0.96),rgba(2,6,23,0.92))] p-7 shadow-[0_30px_80px_-40px_rgba(34,211,238,0.35)]">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-[1.6rem] border border-white/10 bg-white/[0.05]">
            <UserRound className="h-7 w-7 text-cyan-300" />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200/70">Cliente em foco</p>
              <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">{mockClient.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <span>{mockClient.handle}</span>
                <span className="text-slate-600">•</span>
                <span>{mockClient.phone}</span>
              </div>
            </div>
            <TagRow tags={mockClient.tags} />
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-cyan-300/20 bg-cyan-300/10 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/70">Próximo movimento</p>
          <p className="mt-2 max-w-xs text-sm font-medium leading-relaxed text-cyan-50">{mockClient.nextAction}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <MiniMetric label="Status" value={mockClient.status} icon={Sparkles} accent="text-cyan-300" />
        <MiniMetric label="Procedimento" value={mockClient.procedure} icon={ShieldCheck} accent="text-emerald-300" />
        <MiniMetric label="Último toque" value={mockClient.lastTouch} icon={CalendarClock} accent="text-amber-300" />
      </div>

      <div className="mt-6 rounded-[1.5rem] border border-white/8 bg-black/25 p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Leitura operacional</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-200">{mockClient.note}</p>
      </div>
    </section>
  );
}

function SignalBoardVersion() {
  return (
    <section className="rounded-[2rem] border border-lime-300/15 bg-[radial-gradient(circle_at_top_right,rgba(163,230,53,0.14),transparent_34%),linear-gradient(180deg,rgba(10,14,10,0.95),rgba(8,20,16,0.94))] p-7 shadow-[0_30px_80px_-42px_rgba(163,230,53,0.28)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-lime-200/70">Signal board</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">{mockClient.name}</h2>
        </div>
        <Badge className="border-lime-300/20 bg-lime-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-lime-100">
          {mockClient.hasStrongIntent ? "Alta propensão" : "Atenção"}
        </Badge>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="Msgs recebidas" value={`${mockClient.incomingMessages}`} icon={MessageSquareText} accent="text-lime-300" />
        <MiniMetric label="Canal quente" value="Instagram" icon={Instagram} accent="text-pink-300" />
        <MiniMetric label="Sinal social" value="Segue você" icon={Star} accent="text-amber-300" />
        <MiniMetric label="Ritmo" value="Últimos 7 dias" icon={Clock3} accent="text-sky-300" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[1.5rem] border border-white/8 bg-black/25 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Relacionamento</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-200">{mockClient.relationship}</p>
        </div>
        <div className="rounded-[1.5rem] border border-lime-200/15 bg-lime-200/[0.06] p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-lime-100/70">Recomendação</p>
          <p className="mt-3 text-sm leading-relaxed text-lime-50">{mockClient.nextAction}</p>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-lime-100/80">
            <ArrowRight className="h-3.5 w-3.5" />
            agir em até 24h
          </div>
        </div>
      </div>
    </section>
  );
}

function NarrativeLedgerVersion() {
  const timeline = [
    {
      label: "Origem",
      value: "Entrou pelo Instagram e iniciou a conversa por conta própria."
    },
    {
      label: "Momento atual",
      value: "Está em espera após receber as opções de tratamento."
    },
    {
      label: "Chave de conversão",
      value: "Prova social + clareza de agenda + abordagem objetiva no fechamento."
    }
  ];

  return (
    <section className="rounded-[2rem] border border-fuchsia-300/15 bg-[radial-gradient(circle_at_top_left,rgba(244,114,182,0.16),transparent_36%),linear-gradient(180deg,rgba(24,7,18,0.95),rgba(10,10,18,0.95))] p-7 shadow-[0_30px_80px_-44px_rgba(244,114,182,0.24)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-fuchsia-100/70">Narrative ledger</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">{mockClient.name}</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-300">{mockClient.note}</p>
        </div>
        <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Canal principal</p>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Instagram className="h-4 w-4 text-pink-300" />
            {mockClient.handle}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          {timeline.map((item) => (
            <div key={item.label} className="rounded-[1.5rem] border border-white/8 bg-black/25 p-5">
              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">
                <CircleDashed className="h-3.5 w-3.5 text-fuchsia-300" />
                {item.label}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-200">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-[1.6rem] border border-fuchsia-200/15 bg-fuchsia-200/[0.05] p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniMetric label="Status" value={mockClient.status} icon={Zap} accent="text-fuchsia-300" />
            <MiniMetric label="Último toque" value={mockClient.lastTouch} icon={CheckCheck} accent="text-sky-300" />
          </div>
          <div className="mt-5">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-fuchsia-100/70">Próxima narrativa</p>
            <p className="mt-3 text-sm leading-relaxed text-fuchsia-50">{mockClient.nextAction}</p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-5">
            <TagRow tags={mockClient.tags} />
          </div>
        </div>
      </div>
    </section>
  );
}

function CompactRevenueRailVersion() {
  return (
    <section className="rounded-[2rem] border border-amber-300/15 bg-[radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.14),transparent_38%),linear-gradient(180deg,rgba(18,14,6,0.96),rgba(11,10,14,0.96))] p-7 shadow-[0_30px_80px_-42px_rgba(251,191,36,0.22)]">
      <div className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
        <div className="rounded-[1.7rem] border border-white/8 bg-black/30 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[1.2rem] border border-amber-300/20 bg-amber-300/10">
              <LayoutTemplate className="h-5 w-5 text-amber-200" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight text-white">{mockClient.name}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{mockClient.status}</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                <Phone className="h-3.5 w-3.5 text-emerald-300" />
                WhatsApp
              </div>
              <p className="mt-2 text-sm font-semibold text-white">{mockClient.phone}</p>
            </div>
            <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                <Instagram className="h-3.5 w-3.5 text-pink-300" />
                Instagram
              </div>
              <p className="mt-2 text-sm font-semibold text-white">{mockClient.handle}</p>
            </div>
          </div>
        </div>

        <div className="rounded-[1.7rem] border border-amber-200/15 bg-amber-200/[0.05] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/70">Receita operacional</p>
              <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">Rail de ação rápida</h2>
            </div>
            <Badge className="border-amber-200/20 bg-amber-200/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-50">
              prioridade alta
            </Badge>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <MiniMetric label="Mensagens" value={`${mockClient.incomingMessages}`} icon={MessageSquareText} accent="text-amber-200" />
            <MiniMetric label="Procedimento" value="Cliente existente" icon={ShieldCheck} accent="text-emerald-300" />
            <MiniMetric label="Último toque" value="Ontem, 20:14" icon={Clock3} accent="text-sky-300" />
          </div>

          <div className="mt-5 rounded-[1.35rem] border border-white/10 bg-black/25 p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Mensagem ideal</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-100">{mockClient.nextAction}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ContactTabLabPage() {
  return (
    <div className="space-y-8 pb-16">
      <PageHeader
        eyebrow="Cliente Lab"
        title="4 versões da aba do cliente"
        description="Explorações visuais da área de cliente para decidir direção de UX antes de levar a versão escolhida para a experiência principal."
        actions={
          <Button className="h-11 rounded-2xl bg-cmm-blue px-5 text-[10px] font-black uppercase tracking-[0.22em]">
            base: perfil operacional
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {versions.map((version, index) => (
          <div key={version.name} className="rounded-[2.2rem] border border-white/8 bg-white/[0.02] p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 px-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">{version.name}</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">{version.title}</h2>
                <p className="mt-2 max-w-xl text-sm text-slate-400">{version.description}</p>
              </div>
              <Badge className="border-white/10 bg-black/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">
                conceito {index + 1}
              </Badge>
            </div>

            {index === 0 ? <ConciergeVersion /> : null}
            {index === 1 ? <SignalBoardVersion /> : null}
            {index === 2 ? <NarrativeLedgerVersion /> : null}
            {index === 3 ? <CompactRevenueRailVersion /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
