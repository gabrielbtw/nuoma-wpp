import { Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Command, LogOut, Menu, Search } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  KeyboardShortcut,
  LoadingState,
  MicroGrid,
  NuomaLogo,
  Sheet,
  SheetContent,
  SheetTitle,
  TooltipProvider,
  VisuallyHidden,
} from "@nuoma/ui";

import { useAuth } from "../auth/auth-context.js";
import { LoginPage } from "../pages/LoginPage.js";
import { CommandPalette } from "./CommandPalette.js";
import { SHELL_SHORTCUT_ITEMS, Sidebar } from "./Sidebar.js";

export function ShellLayout() {
  const auth = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
      <div className="relative min-h-screen overflow-hidden bg-bg-canvas text-fg-primary">
        <MicroGrid className="fixed opacity-30" fade={false} size={64} />
        <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_18%),linear-gradient(135deg,rgba(var(--color-brand-cyan),0.08),transparent_34%,rgba(0,0,0,0.28))]" />

        <div className="relative flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col px-2 py-3 sm:px-3 md:py-4">
            <header className="botforge-surface mb-3 flex h-14 items-center gap-2 rounded-xl px-2.5">
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
                leftIcon={<Search className="h-3.5 w-3.5" />}
                className="ml-auto min-w-0 flex-1 justify-between gap-3 bg-bg-sunken/68 shadow-pressed-sm sm:ml-0 sm:max-w-[21rem] sm:flex-none"
              >
                <span className="min-w-0 flex-1 truncate text-left text-fg-muted">
                  Buscar ou navegar
                </span>
                <KeyboardShortcut keys={["⌘", "K"]} />
              </Button>

              <div className="ml-0 flex items-center gap-2 sm:ml-auto">
                <span className="hidden max-w-[18rem] truncate rounded-md border border-white/8 bg-bg-sunken/72 px-2.5 py-1.5 font-mono text-[0.68rem] text-fg-dim shadow-pressed-sm md:inline">
                  {router.state.location.pathname}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-brand-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
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

            <main
              className="flex-1 overflow-y-auto px-1 pb-4 focus:outline-none sm:px-2"
              tabIndex={0}
              aria-label="Conteúdo principal"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={router.state.location.pathname}
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
            <Sidebar mode="mobile" onNavigate={() => setMobileNavOpen(false)} />
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
