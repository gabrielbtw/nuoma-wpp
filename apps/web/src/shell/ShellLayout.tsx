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
  Sheet,
  SheetContent,
  SheetTitle,
  TooltipProvider,
  VisuallyHidden,
} from "@nuoma/ui";

import { useAuth } from "../auth/auth-context.js";
import { LoginPage } from "../pages/LoginPage.js";
import { CommandPalette } from "./CommandPalette.js";
import { NuomaAssistant } from "./NuomaAssistant.js";
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
      <div className="relative min-h-screen bg-bg-canvas text-fg-primary">
        <MicroGrid className="hidden" fade={false} size={56} />

        <div className="relative flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 px-3 py-5">
            <header className="botforge-surface flex items-center gap-3 px-3 py-3 mb-4 rounded-xxl">
              <Button
                variant="soft"
                size="sm"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Abrir navegação"
                className="md:hidden aspect-square px-0"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <Button
                variant="soft"
                size="sm"
                onClick={() => setPaletteOpen(true)}
                leftIcon={<Search className="h-3.5 w-3.5" />}
                className="min-w-0 flex-1 justify-between gap-3 sm:min-w-[18rem] sm:flex-none"
              >
                <span className="min-w-0 flex-1 truncate text-left text-fg-muted">
                  Buscar ou navegar
                </span>
                <KeyboardShortcut keys={["⌘", "K"]} />
              </Button>

              <div className="ml-auto flex items-center gap-3">
                <NuomaAssistant className="hidden sm:block" />
                <span className="hidden md:inline text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono px-3 py-1.5 rounded-md bg-bg-base shadow-pressed-sm">
                  {router.state.location.pathname}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base rounded-full transition-shadow"
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
                      <Command className="h-3.5 w-3.5 mr-1" />
                      Command palette
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void auth.logout()}>
                      <LogOut className="h-3.5 w-3.5 mr-1" />
                      Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            <main
              className="flex-1 overflow-y-auto pr-3 pl-3 pb-6 focus:outline-none"
              tabIndex={0}
              aria-label="Conteúdo principal"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={router.state.location.pathname}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="max-w-[6.5rem] p-3" showClose={false}>
          <VisuallyHidden>
            <SheetTitle>Navegação</SheetTitle>
          </VisuallyHidden>
          <Sidebar mode="mobile" onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
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
