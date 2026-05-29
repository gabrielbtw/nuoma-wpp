import type { AppRouter } from "@nuoma/api";
import { Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Command, LogOut, Menu, Radio, Search, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Avatar,
  AvatarFallback,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  KeyboardShortcut,
  LoadingState,
  NuomaLogo,
  Sheet,
  SheetContent,
  SheetTitle,
  TooltipProvider,
  VisuallyHidden,
} from "@nuoma/ui";

import { useAuth } from "../auth/auth-context.js";
import { trpc } from "../lib/trpc.js";
import { LoginPage } from "../pages/LoginPage.js";
import { CommandPalette } from "./CommandPalette.js";
import { SHELL_SHORTCUT_ITEMS, Sidebar, type ShellRuntimeStatus } from "./Sidebar.js";

type SystemMetrics = inferRouterOutputs<AppRouter>["system"]["metrics"];

export function ShellLayout() {
  const auth = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isFlowStudioRoute = router.state.location.pathname === "/campaigns";
  const metrics = trpc.system.metrics.useQuery(undefined, {
    enabled: auth.user?.role === "admin",
    refetchInterval: 10_000,
    retry: false,
  });
  const runtimeStatus = runtimeStatusFromMetrics(
    auth.user?.role,
    metrics.data,
    metrics.isLoading,
    metrics.isError,
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const isMod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (isMod && key === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (event.key === "Escape" && paletteOpen) setPaletteOpen(false);
      if (event.key === "Escape" && mobileNavOpen) setMobileNavOpen(false);

      if (
        !isMod &&
        !event.altKey &&
        !event.shiftKey &&
        !paletteOpen &&
        !isTextEntryTarget(event.target)
      ) {
        const target = SHELL_SHORTCUT_ITEMS.find((item) => item.shortcut === event.key);
        if (target) {
          event.preventDefault();
          void navigate({ to: target.to });
          setMobileNavOpen(false);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen, navigate, paletteOpen]);

  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <LoadingState title="Carregando sessão" />
      </div>
    );
  }

  if (!auth.user) {
    return <LoginPage />;
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="nuoma-concept-app relative min-h-screen overflow-hidden bg-bg-canvas text-fg-primary">
        <div className="nuoma-concept-backdrop" />

        <div className={cn("relative flex min-h-screen", isFlowStudioRoute && "nuoma-flow-shell")}>
          <Sidebar runtimeStatus={runtimeStatus} />
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col px-0 py-0",
            )}
          >
            {!isFlowStudioRoute && (
            <header className="botforge-surface nuoma-topbar mb-0 flex min-h-14 items-center gap-2 rounded-lg px-2.5">
              <Button
                variant="soft"
                size="sm"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Abrir navegação"
                className="aspect-square px-0 md:hidden"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div className="flex min-w-0 items-center gap-2 md:hidden">
                <NuomaLogo variant="small" tone="gold" className="h-8 w-8" />
                <span className="truncate text-sm font-semibold">Nuoma</span>
              </div>
              <Button
                variant="soft"
                size="sm"
                onClick={() => setPaletteOpen(true)}
                aria-label="Abrir busca"
                className="ml-auto aspect-square min-w-9 border border-white/10 bg-bg-sunken/72 px-0 text-brand-cyan shadow-pressed-sm sm:hidden"
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button
                variant="soft"
                size="sm"
                onClick={() => setPaletteOpen(true)}
                aria-label="Abrir busca"
                leftIcon={<Search className="h-4 w-4 text-brand-cyan" />}
                className="hidden min-w-0 max-w-[30rem] flex-none justify-between gap-3 border border-white/10 bg-bg-sunken/72 shadow-pressed-sm sm:inline-flex xl:min-w-[28rem]"
              >
                <span className="min-w-0 flex-1 truncate text-left text-fg-muted">
                  Buscar contatos, campanhas, mensagens...
                </span>
                <KeyboardShortcut keys={["⌘", "K"]} className="hidden md:inline-flex" />
              </Button>

              <div className="ml-0 flex min-w-0 items-center gap-2 sm:ml-auto">
                <span className="hidden max-w-[16rem] truncate rounded-md border border-white/8 bg-bg-sunken/72 px-2.5 py-1.5 font-mono text-[0.68rem] text-fg-dim shadow-pressed-sm lg:inline">
                  {router.state.location.pathname}
                </span>
                <span
                  className={cn(
                    "hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.7rem] font-medium shadow-flat-subtle md:inline-flex",
                    runtimeStatus.cdpConnected && !runtimeStatus.error
                      ? "border-brand-cyan/18 bg-brand-cyan/10 text-brand-cyan"
                      : "border-semantic-warning/18 bg-semantic-warning/10 text-semantic-warning",
                  )}
                >
                  <Radio className="h-3 w-3" />
                  {cdpLabel(runtimeStatus)}
                </span>
                <span
                  className={cn(
                    "hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.7rem] font-medium shadow-flat-subtle xl:inline-flex",
                    !runtimeStatus.error &&
                      !runtimeStatus.hasErrors &&
                      runtimeStatus.workersOnline > 0
                      ? "border-semantic-success/18 bg-semantic-success/10 text-semantic-success"
                      : "border-semantic-warning/18 bg-semantic-warning/10 text-semantic-warning",
                  )}
                >
                  <Zap className="h-3 w-3" />
                  {operationLabel(runtimeStatus)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Notificações"
                  className="hidden aspect-square px-0 sm:inline-flex"
                >
                  <Bell className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-brand-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                      aria-label="Conta"
                    >
                      <Avatar>
                        <AvatarFallback>{auth.user.email.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel>{auth.user.email}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                      Configurações
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                      <Command className="mr-1 h-3.5 w-3.5" />
                      Command palette
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void auth.logout()}>
                      <LogOut className="mr-1 h-3.5 w-3.5" />
                      Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
            )}

            <main
              className={cn(
                "nuoma-main-scroll flex-1 overflow-y-auto px-3 py-3 focus:outline-none",
                isFlowStudioRoute && "px-0 py-0",
              )}
              tabIndex={0}
              aria-label="Conteúdo principal"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={router.state.location.pathname}
                  className="nuoma-route-frame"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="max-w-[5.75rem] p-2.5" showClose={false}>
            <VisuallyHidden>
              <SheetTitle>Navegação</SheetTitle>
            </VisuallyHidden>
            <Sidebar
              mode="mobile"
              runtimeStatus={runtimeStatus}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function runtimeStatusFromMetrics(
  role: string | undefined,
  metrics: SystemMetrics | undefined,
  loading: boolean,
  error: boolean,
): ShellRuntimeStatus {
  if (role !== "admin") {
    return {
      loading: false,
      cdpConnected: false,
      workersOnline: 0,
      workersTotal: 0,
      hasErrors: false,
      unavailable: true,
    };
  }
  if (loading) {
    return {
      loading: true,
      cdpConnected: false,
      workersOnline: 0,
      workersTotal: 0,
      hasErrors: false,
    };
  }
  if (error || !metrics) {
    return {
      loading: false,
      cdpConnected: false,
      workersOnline: 0,
      workersTotal: 0,
      hasErrors: true,
      error: true,
    };
  }
  return {
    loading: false,
    cdpConnected: metrics.whatsapp.cdpConnected,
    workersOnline: metrics.workers.online,
    workersTotal: metrics.workers.total,
    hasErrors: metrics.workers.withErrors > 0 || metrics.jobs.dead > 0,
  };
}

function cdpLabel(status: ShellRuntimeStatus): string {
  if (status.unavailable) return "Sem métrica";
  if (status.loading) return "Checando CDP";
  if (status.error) return "CDP indisponível";
  return status.cdpConnected ? "CDP ativo" : "CDP ausente";
}

function operationLabel(status: ShellRuntimeStatus): string {
  if (status.unavailable) return "Métrica admin";
  if (status.loading) return "Checando";
  if (status.error) return "Métrica falhou";
  if (status.workersTotal === 0) return "Sem worker";
  if (status.hasErrors) return "Atenção";
  return `${status.workersOnline}/${status.workersTotal} workers`;
}
