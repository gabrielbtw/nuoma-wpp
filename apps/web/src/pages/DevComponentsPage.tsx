import {
  AICommandBar,
  Animate,
  Avatar,
  AvatarFallback,
  Badge,
  BentoGrid,
  BentoItem,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  Input,
  KeyboardShortcut,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioItem,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTrigger,
  SignalDot,
  Skeleton,
  SkeletonText,
  StatCard,
  Surface,
  Switch,
  Textarea,
  TimeAgo,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToast,
} from "@nuoma/ui";
import {
  BarChart3,
  Boxes,
  CircleDot,
  Hand,
  LayoutGrid,
  Settings2,
  Sparkles,
  Type,
  Waypoints,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  DonutChart,
  GaugeChart,
  GroupedBarChart,
  HorizontalBarChart,
  LineAreaChart,
  ScatterPlot,
} from "../components/charts/index.js";

const CANVAS = [
  ["--color-bg-deep", "#060709", "base profunda"],
  ["--color-bg-canvas", "#08090C", "canvas / grid"],
  ["--color-bg-sunken", "#0A0B0E", "inputs recessed"],
  ["--color-bg-base", "#0E0F12", "página"],
  ["--color-bg-surface", "#13151A", "painéis"],
  ["--color-bg-raised", "#17191F", "cards"],
  ["--color-bg-elevated", "#1B1E25", "dropdowns"],
  ["--color-bg-subtle", "#23262F", "hover fills"],
] as const;

const BRAND = [
  ["--color-brand-gold", "#CAA66A", "identidade · 8%"],
  ["--color-brand-gold-soft", "#E8C98D", "highlight / texto"],
  ["--color-brand-cyan", "#78D8D5", "foco operacional"],
  ["--color-brand-cyan-soft", "#BFF2EE", "estado live claro"],
] as const;

const TEXT_COLORS = [
  ["--color-fg-primary", "#F0F2F6", "texto primário"],
  ["--color-fg-muted", "#B8BEC9", "corpo"],
  ["--color-fg-dim", "#7E8695", "secundário"],
  ["--color-fg-faint", "#525868", "placeholder"],
] as const;

const STATUS_COLORS = [
  ["--color-channel-whatsapp", "#78CADC", "WhatsApp"],
  ["--color-channel-instagram", "#CAA66A", "Instagram"],
  ["--color-semantic-warning", "#D7B265", "atenção"],
  ["--color-semantic-danger", "#D36464", "erro"],
  ["--color-semantic-info", "#78D8D5", "informação"],
] as const;

const VOLUME = [
  { mes: "Dez", enviadas: 1240, respondidas: 840 },
  { mes: "Jan", enviadas: 1100, respondidas: 760 },
  { mes: "Fev", enviadas: 1320, respondidas: 910 },
  { mes: "Mar", enviadas: 1280, respondidas: 880 },
  { mes: "Abr", enviadas: 1450, respondidas: 1010 },
  { mes: "Mai", enviadas: 1620, respondidas: 1140 },
];

const CHANNELS = [
  { canal: "WhatsApp", enviadas: 1620, respondidas: 1140 },
  { canal: "Instagram", enviadas: 840, respondidas: 560 },
  { canal: "Sistema", enviadas: 210, respondidas: 120 },
];

const RANKING = [
  { name: "Ana L.", value: 96 },
  { name: "Carlos M.", value: 91 },
  { name: "Juliana S.", value: 88 },
  { name: "Pedro H.", value: 81 },
  { name: "Fernanda T.", value: 74 },
  { name: "Lucas A.", value: 68 },
];

const STATUS_SPLIT = [
  { name: "Entregue", value: 62, color: "rgb(120 202 220)" },
  { name: "Na fila", value: 24, color: "rgb(215 178 101)" },
  { name: "Falhou", value: 14, color: "rgb(211 100 100)" },
];

const SCATTER = Array.from({ length: 42 }, () => ({
  x: Math.round(20 + Math.random() * 70),
  y: Math.round(20 + Math.random() * 70),
  z: Math.round(500 + Math.random() * 9500),
}));

export function DevComponentsPage() {
  const toast = useToast();
  const [range, setRange] = useState("semana");
  const [auto, setAuto] = useState(true);

  if (!import.meta.env.DEV) {
    return (
      <ErrorState
        title="Indisponível em produção"
        description="Esta página só renderiza em NODE_ENV=development."
        className="min-h-[60vh]"
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 pb-20 pt-2">
      <Animate preset="rise-in">
        <header className="flex flex-col gap-5 border-b border-border-subtle/40 pb-10">
          <p className="botforge-kicker flex items-center gap-2">
            <span className="h-px w-5 bg-brand-cyan" />
            Nuoma · Design System · v2026.1
          </p>
          <h1 className="botforge-display text-5xl md:text-6xl">
            O sistema visual do{" "}
            <span className="nuoma-gradient-text">Nuoma WPP</span>.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
            Tokens, materiais, componentes e padrões de produto para o CRM
            omnichannel local-first. Estética Cartographic Operations — graphite
            matte, vidro em camadas, acentos gold e cyan, Geist em tudo.
          </p>
          <div className="flex flex-wrap gap-8 pt-2">
            <Stat num="62" label="tokens" />
            <Stat num="26" label="componentes" />
            <Stat num="3" label="temas" />
            <Stat num="6" label="chart types" />
          </div>
        </header>
      </Animate>

      <Section
        id="cores"
        title="Sistema de Cores"
        hint="Paleta Nuoma 2026 — organizada por papel. Dark-native."
      >
        <SubLabel>Canvas — graphite matte</SubLabel>
        <SwatchGrid items={CANVAS} />
        <SubLabel>Marca — acentos gold &amp; cyan</SubLabel>
        <SwatchGrid items={BRAND} />
        <SubLabel>Texto</SubLabel>
        <SwatchGrid items={TEXT_COLORS} />
        <SubLabel>Canais &amp; Status</SubLabel>
        <SwatchGrid items={STATUS_COLORS} />
        <SubLabel>Gradientes de acento</SubLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          <GradientSwatch className="bg-gradient-accent" name="gradient-accent" />
          <GradientSwatch className="bg-gradient-aura" name="gradient-aura" />
          <GradientSwatch className="bg-gradient-glass" name="gradient-glass" />
        </div>
      </Section>

      <Section
        id="tipografia"
        title="Tipografia"
        hint="Geist para interface. Geist Mono para dados e labels técnicos."
      >
        <SubLabel>Geist — interface &amp; destaques</SubLabel>
        <div className="flex flex-col divide-y divide-border-subtle/40 overflow-hidden rounded-md border border-border-subtle/40">
          <TypeRow token="Display" detail="3rem · 780 · -.03em">
            <span className="botforge-display text-5xl">2.341</span>
          </TypeRow>
          <TypeRow token="H1" detail="2.25rem · 700">
            <span className="botforge-display text-4xl">Operação Omnichannel</span>
          </TypeRow>
          <TypeRow token="H2" detail="1.5rem · 700">
            <span className="font-display text-2xl font-bold text-fg-primary">
              Caixa de Entrada Unificada
            </span>
          </TypeRow>
          <TypeRow token="Body" detail="0.875rem · 400">
            <span className="text-sm text-fg-muted">
              O Nuoma WPP centraliza conversas, automações e campanhas em uma
              operação local-first.
            </span>
          </TypeRow>
          <TypeRow token="Small" detail="0.75rem · 400">
            <span className="text-xs text-fg-dim">
              Última sincronização há 2 min · Extensão conectada
            </span>
          </TypeRow>
        </div>
        <SubLabel>Geist Mono — dados &amp; labels</SubLabel>
        <div className="flex flex-col divide-y divide-border-subtle/40 overflow-hidden rounded-md border border-border-subtle/40">
          <TypeRow token="Métrica" detail="1.25rem · tabular">
            <span className="font-mono text-xl tabular-nums text-fg-primary">
              R$ 18.420,00
            </span>
          </TypeRow>
          <TypeRow token="Kicker" detail="0.7rem · uppercase">
            <span className="font-mono text-[0.7rem] uppercase tracking-wider text-brand-cyan">
              Sync Engine · Live
            </span>
          </TypeRow>
          <TypeRow token="Código / ID" detail="0.8rem">
            <span className="font-mono text-sm text-fg-muted">
              job_7f3a · campaign:ab-variant-02 · 240ms
            </span>
          </TypeRow>
        </div>
      </Section>

      <Section
        id="materiais"
        title="Materiais &amp; Elevação"
        hint="Surfaces operacionais e vidro em camadas para chrome flutuante."
      >
        <SubLabel>Surfaces</SubLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Surface variant="raised" className="p-5 text-sm text-fg-muted">
            raised — cards e painéis
          </Surface>
          <Surface variant="pressed" className="p-5 text-sm text-fg-muted">
            pressed — campos recessed
          </Surface>
          <Surface variant="flat" className="p-5 text-sm text-fg-muted">
            flat — leitura densa
          </Surface>
        </div>
        <SubLabel>Glass — camadas flutuantes</SubLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="nuoma-glass-panel rounded-md p-5 text-sm text-fg-muted shadow-raised-sm">
            glass-panel — sidebar, popovers
          </div>
          <div className="nuoma-glass-elevated rounded-md p-5 text-sm text-fg-muted shadow-raised-md">
            glass-elevated — feature cards, drawers
          </div>
        </div>
        <SubLabel>Elevação — recipes de sombra</SubLabel>
        <div className="grid gap-4 sm:grid-cols-4">
          <ElevCard shadow="shadow-raised-md" name="raised" />
          <ElevCard shadow="shadow-lift" name="lift" />
          <ElevCard shadow="shadow-glow-cyan" name="glow-cyan" />
          <ElevCard shadow="shadow-glow-aura" name="glow-aura" />
        </div>
        <SubLabel>SignalDot</SubLabel>
        <div className="flex flex-wrap items-center gap-6 text-sm text-fg-muted">
          <span className="flex items-center gap-2">
            <SignalDot status="active" /> active
          </span>
          <span className="flex items-center gap-2">
            <SignalDot status="idle" /> idle
          </span>
          <span className="flex items-center gap-2">
            <SignalDot status="error" /> error
          </span>
          <span className="flex items-center gap-2">
            <SignalDot status="degraded" /> degraded
          </span>
        </div>
      </Section>

      <Section
        id="componentes"
        title="Componentes"
        hint="Biblioteca @nuoma/ui com estados completos."
      >
        <SubLabel>Buttons</SubLabel>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
        </div>

        <SubLabel>Segmented Control · Toggles</SubLabel>
        <div className="flex flex-wrap items-center gap-6">
          <SegmentedControl
            aria-label="Período"
            value={range}
            onValueChange={setRange}
            options={[
              { value: "hoje", label: "Hoje" },
              { value: "semana", label: "Semana" },
              { value: "mes", label: "Mês" },
            ]}
          />
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <Switch checked={auto} onCheckedChange={setAuto} aria-label="Automação" />
            Automação ativa
          </label>
          <Checkbox defaultChecked aria-label="Confirmar entrega" />
          <RadioGroup defaultValue="a" className="flex flex-row gap-3">
            <RadioItem value="a" aria-label="Opção A" />
            <RadioItem value="b" aria-label="Opção B" />
          </RadioGroup>
        </div>

        <SubLabel>Inputs</SubLabel>
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <Input placeholder="Nome do contato" />
          <Input placeholder="Token da API" monospace />
          <Input placeholder="Número inválido" invalid />
          <Select defaultValue="wa">
            <SelectTrigger aria-label="Canal">
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wa">WhatsApp</SelectItem>
              <SelectItem value="ig">Instagram</SelectItem>
              <SelectItem value="system">Sistema</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Mensagem da campanha" className="sm:col-span-2" />
        </div>

        <SubLabel>Badges &amp; Display</SubLabel>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="success">Entregue</Badge>
          <Badge variant="warning">Na fila</Badge>
          <Badge variant="danger">Falhou</Badge>
          <Badge variant="info">Processando</Badge>
          <Badge variant="violet">Premium</Badge>
          <Badge variant="cyan">Live</Badge>
          <Avatar>
            <AvatarFallback>GB</AvatarFallback>
          </Avatar>
          <TimeAgo date={Date.now() - 3 * 60_000} />
          <KeyboardShortcut keys={["⌘", "K"]} />
        </div>

        <SubLabel>StatCard / KPI</SubLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Mensagens enviadas"
            value="18.420"
            delta={{ value: "12%", direction: "up" }}
            trend={[8, 9, 8.5, 10, 9.7, 11.8, 12.4]}
          />
          <StatCard
            label="Taxa de resposta"
            value="67"
            unit="%"
            delta={{ value: "5%", direction: "up" }}
            trend={[5.2, 5.6, 6, 6.3, 6.5, 6.7, 6.7]}
          />
          <StatCard
            label="Falhas de entrega"
            value="142"
            delta={{ value: "18", direction: "down", tone: "positive" }}
            trend={[2.4, 2.1, 1.9, 1.7, 1.6, 1.5, 1.42]}
          />
          <StatCard
            label="SLA de resposta"
            value="1m 42s"
            hint="Tempo médio nas últimas 24h"
            variant="glass"
          />
        </div>

        <SubLabel>Skeleton — carregamento</SubLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card variant="flat" className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton variant="circle" className="w-10" />
              <div className="flex-1">
                <SkeletonText lines={2} />
              </div>
            </div>
            <Skeleton variant="block" />
          </Card>
          <Card variant="flat" className="flex flex-col gap-3">
            <SkeletonText lines={4} />
          </Card>
          <Card variant="flat" className="flex flex-col gap-3">
            <Skeleton variant="block" className="h-24" />
            <SkeletonText lines={2} />
          </Card>
        </div>

        <SubLabel>Overlays</SubLabel>
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="soft">Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle className="font-display text-lg font-semibold">
                Confirmar disparo
              </DialogTitle>
              <p className="mt-2 text-sm text-fg-muted">
                Campanha para 1.240 contatos no WhatsApp.
              </p>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="soft">Sheet</Button>
            </SheetTrigger>
            <SheetContent side="right">
              <h2 className="font-display text-lg font-semibold">Filtros</h2>
              <p className="mt-2 text-sm text-fg-muted">Drawer lateral.</p>
            </SheetContent>
          </Sheet>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="soft">Popover</Button>
            </PopoverTrigger>
            <PopoverContent>Conteúdo do popover.</PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="soft">Tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Hint contextual</TooltipContent>
          </Tooltip>
          <Button
            variant="soft"
            onClick={() =>
              toast.push({
                title: "Campanha disparada",
                description: "1.240 mensagens na fila.",
                variant: "success",
              })
            }
          >
            Toast
          </Button>
        </div>

        <SubLabel>Empty State</SubLabel>
        <Card variant="flat">
          <EmptyState
            title="Sem conversas ainda"
            description="Conecte a extensão para sincronizar suas conversas de WhatsApp."
            action={<Button size="sm">Conectar agora</Button>}
          />
        </Card>
      </Section>

      <Section
        id="tendencias"
        title="Padrões UX/UI 2026"
        hint="AI-first, espacial e modular — adotados do padrão Orielo."
      >
        <SubLabel>AI Command Bar</SubLabel>
        <AICommandBar
          placeholder='Pergunte ou comande o Nuoma — ex.: "criar campanha para leads inativos"'
          suggestions={[
            "Resumir conversas não lidas",
            "Gerar variante A/B",
            "Agendar disparo para 18h",
          ]}
          onSubmit={(value) =>
            toast.push({ title: "Comando recebido", description: value, variant: "info" })
          }
        />

        <SubLabel>Bento Grid — dashboard modular</SubLabel>
        <BentoGrid columns={4}>
          <BentoItem colSpan={2} rowSpan={2} aura className="flex flex-col justify-between">
            <p className="botforge-kicker">Índice de operação</p>
            <div>
              <p className="botforge-display nuoma-gradient-text text-6xl tabular-nums">
                94
              </p>
              <p className="mt-1 text-sm text-fg-dim">
                Saúde da operação omnichannel · meta 90
              </p>
            </div>
            <Badge variant="success" className="self-start">
              Acima da meta
            </Badge>
          </BentoItem>
          <BentoItem className="flex flex-col justify-between">
            <p className="botforge-kicker">Live</p>
            <p className="flex items-center gap-2 text-2xl font-bold text-fg-primary">
              <SignalDot status="active" /> 12
            </p>
            <p className="text-xs text-fg-dim">atendentes online</p>
          </BentoItem>
          <BentoItem className="flex flex-col justify-between">
            <p className="botforge-kicker">Fila</p>
            <p className="text-2xl font-bold text-fg-primary">38</p>
            <p className="text-xs text-fg-dim">mensagens aguardando</p>
          </BentoItem>
          <BentoItem colSpan={2} className="flex flex-col justify-between">
            <p className="botforge-kicker">SLA médio</p>
            <p className="botforge-display text-3xl text-brand-gold-soft">1m 42s</p>
            <p className="text-xs text-fg-dim">tempo de resposta · 24h</p>
          </BentoItem>
        </BentoGrid>

        <SubLabel>Tendências aplicadas</SubLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TrendCard icon={<Sparkles className="h-4 w-4" />} tag="AI-first" title="Interface conversacional">
            Command bar com IA em todo fluxo. O usuário descreve a intenção; o
            sistema sugere a ação.
          </TrendCard>
          <TrendCard icon={<Boxes className="h-4 w-4" />} tag="Spatial" title="Profundidade em camadas">
            Vidro progressivo e blur por hierarquia substituem sombras duras.
          </TrendCard>
          <TrendCard icon={<LayoutGrid className="h-4 w-4" />} tag="Bento" title="Dashboards modulares">
            Grid bento com células de tamanhos variados, recombinável por contexto.
          </TrendCard>
          <TrendCard icon={<CircleDot className="h-4 w-4" />} tag="Live" title="Presença em tempo real">
            Pulsos e contadores reativos comunicam estado de sessão e sync.
          </TrendCard>
          <TrendCard icon={<Hand className="h-4 w-4" />} tag="Tactile" title="Micro-interações físicas">
            Press scale, spring easing, entradas elásticas — feedback imediato.
          </TrendCard>
          <TrendCard icon={<Settings2 className="h-4 w-4" />} tag="Adaptive" title="Multi-tema adaptativo">
            Void-flow, Aurora e Ocean trocam acentos sem quebrar contraste.
          </TrendCard>
        </div>
      </Section>

      <Section
        id="charts"
        title="Sistema de Gráficos"
        hint="Recharts tematizado pelos tokens Nuoma."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard name="Volume de Mensagens" desc="Line / Area · enviadas vs. respondidas">
            <LineAreaChart
              data={VOLUME}
              xKey="mes"
              series={[
                { key: "enviadas", label: "Enviadas" },
                { key: "respondidas", label: "Respondidas" },
              ]}
            />
          </ChartCard>
          <ChartCard name="Desempenho por Canal" desc="Bar agrupado">
            <GroupedBarChart
              data={CHANNELS}
              xKey="canal"
              series={[
                { key: "enviadas", label: "Enviadas" },
                { key: "respondidas", label: "Respondidas" },
              ]}
            />
          </ChartCard>
          <ChartCard name="Ranking de Atendentes" desc="Bar horizontal · top por resposta">
            <HorizontalBarChart data={RANKING} />
          </ChartCard>
          <ChartCard name="Status da Carteira" desc="Donut · distribuição de conversas">
            <DonutChart data={STATUS_SPLIT} />
          </ChartCard>
          <ChartCard name="Índice de Operação" desc="Gauge · score composto 0–100">
            <GaugeChart value={94} label="Índice" />
          </ChartCard>
          <ChartCard name="Volume × Conversão" desc="Scatter · tamanho = receita">
            <ScatterPlot data={SCATTER} xLabel="Volume" yLabel="Conversão" />
          </ChartCard>
        </div>
      </Section>

      <Section
        id="principios"
        title="Princípios de Design"
        hint="Regras de uso para manter consistência e qualidade."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PrincipleCard icon={<CircleDot className="h-4 w-4" />} title="Acento com parcimônia">
            Gold é identidade — máximo 8% da composição. Cyan marca foco
            operacional e estado live. Fora isso, graphite.
          </PrincipleCard>
          <PrincipleCard icon={<Boxes className="h-4 w-4" />} title="Profundidade por camada">
            Vidro comunica hierarquia. Dados densos ficam em surface estável —
            legibilidade nunca cede ao blur.
          </PrincipleCard>
          <PrincipleCard icon={<BarChart3 className="h-4 w-4" />} title="Status é funcional">
            Cores semânticas são independentes da marca. Misturar gold/cyan com
            status cria ambiguidade.
          </PrincipleCard>
          <PrincipleCard icon={<Type className="h-4 w-4" />} title="Números sempre tabular">
            KPIs, valores, IDs e timestamps usam Geist Mono ou tabular-nums para
            alinhamento perfeito.
          </PrincipleCard>
          <PrincipleCard icon={<Waypoints className="h-4 w-4" />} title="Tracking só em display">
            Letter-spacing negativo é permitido apenas em type display. Corpo e
            UI densa permanecem neutros.
          </PrincipleCard>
          <PrincipleCard icon={<Sparkles className="h-4 w-4" />} title="Motion funcional">
            Animação comunica estado. Loops decorativos respeitam
            prefers-reduced-motion.
          </PrincipleCard>
        </div>
      </Section>
    </div>
  );
}

function Stat({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="botforge-display text-2xl tabular-nums">{num}</span>
      <span className="font-mono text-[0.7rem] uppercase tracking-wider text-fg-dim">
        {label}
      </span>
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          className="botforge-display text-2xl"
          dangerouslySetInnerHTML={{ __html: title }}
        />
        <p className="text-xs text-fg-dim">{hint}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-3 font-mono text-[0.68rem] uppercase tracking-wider text-fg-dim">
      {children}
      <span className="h-px flex-1 bg-border-subtle/40" />
    </p>
  );
}

function SwatchGrid({ items }: { items: ReadonlyArray<readonly [string, string, string]> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {items.map(([cssVar, hex, role]) => (
        <div
          key={cssVar}
          className="overflow-hidden rounded-sm border border-border-subtle/40"
        >
          <div className="h-14" style={{ background: `rgb(var(${cssVar}))` }} />
          <div className="bg-bg-surface px-2.5 py-2">
            <span className="block font-mono text-[0.66rem] text-fg-muted">
              {cssVar.replace("--color-", "")}
            </span>
            <span className="font-mono text-[0.62rem] tabular-nums text-fg-dim">
              {hex} · {role}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GradientSwatch({ className, name }: { className: string; name: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border-subtle/40">
      <div className={`h-20 ${className}`} />
      <div className="bg-bg-surface px-3 py-2">
        <span className="font-mono text-[0.68rem] text-fg-muted">{name}</span>
      </div>
    </div>
  );
}

function TypeRow({
  token,
  detail,
  children,
}: {
  token: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-5 bg-bg-surface px-5 py-4">
      <div className="w-32 shrink-0">
        <span className="font-mono text-[0.7rem] text-brand-cyan">{token}</span>
        <span className="mt-0.5 block font-mono text-[0.62rem] text-fg-dim">
          {detail}
        </span>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ElevCard({ shadow, name }: { shadow: string; name: string }) {
  return (
    <div
      className={`rounded-md border border-border-subtle/40 bg-bg-raised p-5 text-center ${shadow}`}
    >
      <span className="font-mono text-xs text-brand-cyan">{name}</span>
    </div>
  );
}

function ChartCard({
  name,
  desc,
  children,
}: {
  name: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <Card variant="flat" className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-base font-semibold text-fg-primary">{name}</h3>
        <p className="text-xs text-fg-dim">{desc}</p>
      </div>
      {children}
    </Card>
  );
}

function TrendCard({
  icon,
  tag,
  title,
  children,
}: {
  icon: ReactNode;
  tag: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card variant="raised" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-cyan/12 text-brand-cyan">
          {icon}
        </span>
        <span className="font-mono text-[0.62rem] uppercase tracking-wider text-brand-gold-soft">
          {tag}
        </span>
      </div>
      <h3 className="font-display text-sm font-semibold text-fg-primary">{title}</h3>
      <p className="text-xs leading-relaxed text-fg-dim">{children}</p>
    </Card>
  );
}

function PrincipleCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card variant="raised" className="flex flex-col gap-2.5">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-brand-cyan/10 text-brand-cyan">
        {icon}
      </span>
      <h3 className="font-display text-sm font-semibold text-fg-primary">{title}</h3>
      <p className="text-xs leading-relaxed text-fg-dim">{children}</p>
    </Card>
  );
}
