import type { AppRouter } from "@nuoma/api";
import { Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { AnimatePresence, motion } from "framer-motion";
import { Command, LogOut, Menu, Radio, Search, Zap } from "lucide-react";
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
import { getShellShortcutItems, Sidebar, type ShellRuntimeStatus } from "./Sidebar.js";

type SystemMetrics = inferRouterOutputs<AppRouter>["system"]["metrics"];

export function ShellLayout() {
  const auth = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isAdmin = auth.user?.role === "admin";
  const isFlowStudioRoute = router.state.location.pathname === "/campaigns";
  const metrics = trpc.system.metrics.useQuery(undefined, {
    enabled: isAdmin,
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
        const target = getShellShortcutItems(isAdmin).find((item) => item.shortcut === event.key);
        if (target) {
          event.preventDefault();
          void navigate({ to: target.to });
          setMobileNavOpen(false);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAdmin, mobileNavOpen, navigate, paletteOpen]);

  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0">
        <LoadingState title="Carregando sessão" />
      </div>
    );
  }

  if (!auth.user) {
    return <LoginPage />;
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="nw-shell-app">
        <div className={cn("nw-shell-frame", isFlowStudioRoute && "nw-shell-frame-flow")}>
          <Sidebar runtimeStatus={runtimeStatus} isAdmin={isAdmin} />
          <div className="flex min-w-0 flex-1 flex-col">
            {!isFlowStudioRoute && (
              <header className="nw-shell-topbar">
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Abrir navegação"
                  className="aspect-square border border-line-hairline bg-surface-1 px-0 text-ink-base hover:bg-surface-2 hover:text-ink-strong md:hidden"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <div className="flex min-w-0 items-center gap-2 md:hidden">
                  <NuomaLogo variant="small" tone="gold" className="h-8 w-8" />
                  <span className="truncate font-display text-sm font-semibold text-ink-strong">
                    Nuoma
                  </span>
                </div>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Abrir busca"
                  className="ml-auto aspect-square min-w-9 border border-line-hairline bg-surface-1 px-0 text-accent hover:bg-surface-2 hover:text-accent-hover sm:hidden"
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Abrir busca"
                  leftIcon={<Search className="h-4 w-4 text-accent" />}
                  className="hidden min-w-0 max-w-[30rem] flex-none justify-between gap-3 border border-line-hairline bg-surface-1 text-ink-base hover:bg-surface-2 hover:text-ink-strong sm:inline-flex xl:min-w-[28rem]"
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    Buscar contatos, campanhas, mensagens...
                  </span>
                  <KeyboardShortcut keys={["⌘", "K"]} className="hidden md:inline-flex" />
                </Button>

                <div className="ml-0 flex min-w-0 items-center gap-2 sm:ml-auto">
                  <span className="hidden max-w-[16rem] truncate rounded-md border border-line-hairline bg-surface-1 px-2.5 py-1.5 font-mono text-[0.68rem] text-ink-soft lg:inline">
                    {router.state.location.pathname}
                  </span>
                  <span
                    className={cn(
                      "hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.7rem] font-medium md:inline-flex",
                      runtimeStatus.cdpConnected && !runtimeStatus.error
                        ? "border-status-ok/25 bg-status-ok/10 text-status-ok"
                        : "border-status-warn/25 bg-status-warn/10 text-status-warn",
                    )}
                  >
                    <Radio className="h-3 w-3" />
                    {cdpLabel(runtimeStatus)}
                  </span>
                  <span
                    className={cn(
                      "hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.7rem] font-medium xl:inline-flex",
                      !runtimeStatus.error &&
                        !runtimeStatus.hasErrors &&
                        runtimeStatus.workersOnline > 0
                        ? "border-status-ok/25 bg-status-ok/10 text-status-ok"
                        : "border-status-warn/25 bg-status-warn/10 text-status-warn",
                    )}
                  >
                    <Zap className="h-3 w-3" />
                    {operationLabel(runtimeStatus)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
                        aria-label="Conta"
                      >
                        <Avatar>
                          <AvatarFallback>
                            {auth.user.email.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuLabel>{auth.user.email}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {isAdmin && (
                        <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                          Configurações
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                        <Command className="mr-1 h-3.5 w-3.5" />
                        Paleta de comandos
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
                "nw-shell-main flex-1 overflow-y-auto px-4 py-5 focus:outline-none lg:px-8 lg:py-7",
                isFlowStudioRoute && "px-0 py-0 lg:px-0 lg:py-0",
              )}
              tabIndex={0}
              aria-label="Conteúdo principal"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={router.state.location.pathname}
                  className="nw-shell-route-frame"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} isAdmin={isAdmin} />
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            className="w-[min(21rem,calc(100vw-2rem))] max-w-none border-r border-line-hairline bg-surface-0 p-0 text-ink-strong"
            showClose={false}
          >
            <VisuallyHidden>
              <SheetTitle>Navegação</SheetTitle>
            </VisuallyHidden>
            <Sidebar
              mode="mobile"
              runtimeStatus={runtimeStatus}
              isAdmin={isAdmin}
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
