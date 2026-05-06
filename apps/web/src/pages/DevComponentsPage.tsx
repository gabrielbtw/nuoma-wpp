import {
  Animate,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChannelIcon,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  Input,
  KeyboardShortcut,
  LoadingState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTrigger,
  SignalDot,
  Surface,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  TimeAgo,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToast,
} from "@nuoma/ui";

export function DevComponentsPage() {
  const toast = useToast();
  const isDev = import.meta.env.DEV;

  if (!isDev) {
    return (
      <ErrorState
        title="Indisponível em produção"
        description="Esta página só renderiza em NODE_ENV=development."
        className="min-h-[60vh]"
      />
    );
  }

  return (
    <div className="flex flex-col gap-10 max-w-6xl mx-auto pt-2 pb-12">
      <Animate preset="rise-in">
        <header>
          <p className="botforge-kicker">
            Design system
          </p>
          <h1 className="botforge-title mt-2 text-5xl md:text-6xl">
            Componentes <span className="text-brand-violet">V2.8</span>.
          </h1>
          <p className="text-sm text-fg-muted mt-3 max-w-xl">
            Inventário visual cartográfico. Surfaces raised/pressed/flat agora usam contorno operacional.
          </p>
        </header>
      </Animate>

      <Section title="Surfaces">
        <div className="grid gap-4 sm:grid-cols-3">
          <Surface variant="raised" className="p-5 text-sm text-fg-muted">
            raised <span className="text-fg-primary">md</span>
          </Surface>
          <Surface variant="pressed" className="p-5 text-sm text-fg-muted">
            pressed <span className="text-fg-primary">md</span>
          </Surface>
          <Surface variant="flat" className="p-5 text-sm text-fg-muted">
            flat
          </Surface>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Surface variant="raised" size="sm" className="p-4 text-xs">raised sm</Surface>
          <Surface variant="raised" size="md" className="p-4 text-xs">raised md</Surface>
          <Surface variant="raised" size="lg" className="p-4 text-xs">raised lg</Surface>
          <Surface variant="raised" size="xl" className="p-4 text-xs">raised xl</Surface>
        </div>
        <div className="flex items-center gap-5">
          <SignalDot status="active" /> active
          <SignalDot status="idle" /> idle
          <SignalDot status="error" /> error
          <SignalDot status="degraded" /> degraded
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="xs">XS</Button>
          <Button size="sm">SM</Button>
          <Button size="md">MD</Button>
          <Button size="lg">LG</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
          <Input placeholder="Texto" />
          <Input placeholder="Mono" monospace />
          <Input placeholder="Inválido" invalid />
          <Textarea placeholder="Textarea" />
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <Switch defaultChecked aria-label="Ativar exemplo de switch" />
          <Checkbox defaultChecked aria-label="Selecionar exemplo de checkbox" />
          <RadioGroup defaultValue="a" className="flex flex-row gap-3">
            <RadioItem value="a" aria-label="Opção A" />
            <RadioItem value="b" aria-label="Opção B" />
          </RadioGroup>
          <Select defaultValue="wa">
            <SelectTrigger className="w-44" aria-label="Canal">
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wa">WhatsApp</SelectItem>
              <SelectItem value="ig">Instagram</SelectItem>
              <SelectItem value="system">Sistema</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="soft">Abrir Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle className="font-display text-lg font-semibold">Modal sculpted</DialogTitle>
              <p className="text-sm text-fg-muted mt-2">
                Dialog flutuante com lift shadow + radius generoso.
              </p>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="soft">Abrir Sheet</Button>
            </SheetTrigger>
            <SheetContent side="right">
              <h2 className="font-display text-lg font-semibold">Sheet lateral</h2>
              <p className="text-sm text-fg-muted mt-2">Drawer raised com cantos arredondados.</p>
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
        </div>
      </Section>

      <Section title="Display">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>neutral</Badge>
          <Badge variant="info">info</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
          <Badge variant="wa">wa</Badge>
          <Badge variant="ig">ig</Badge>
          <Badge variant="violet">amber</Badge>
          <Badge variant="cyan">cyan</Badge>
          <Avatar>
            <AvatarFallback>GB</AvatarFallback>
          </Avatar>
          <ChannelIcon channel="whatsapp" variant="chip" />
          <ChannelIcon channel="instagram" variant="chip" />
          <ChannelIcon channel="system" variant="chip" />
          <TimeAgo date={Date.now() - 3 * 60_000} />
          <KeyboardShortcut keys={["⌘", "K"]} />
        </div>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Tab A</TabsTrigger>
            <TabsTrigger value="b">Tab B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Conteúdo A</TabsContent>
          <TabsContent value="b">Conteúdo B</TabsContent>
        </Tabs>
      </Section>

      <Section title="States">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Empty</CardTitle>
              <CardDescription>Sem dados</CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState description="Nada por aqui." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Error</CardTitle>
              <CardDescription>Falha</CardDescription>
            </CardHeader>
            <CardContent>
              <ErrorState description="Backend respondeu 500." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Loading</CardTitle>
              <CardDescription>Buscando</CardDescription>
            </CardHeader>
            <CardContent>
              <LoadingState />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Toast">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => toast.push({ title: "Toast info", description: "Aria-live polite", variant: "info" })}>
            Trigger info
          </Button>
          <Button variant="soft" onClick={() => toast.push({ title: "Sucesso!", variant: "success" })}>
            Trigger success
          </Button>
          <Button variant="danger" onClick={() => toast.push({ title: "Erro!", description: "Falhou geral", variant: "danger" })}>
            Trigger danger
          </Button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="botforge-kicker">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
