import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, Bot, ChevronDown, EyeOff, PauseCircle, PlayCircle, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@nuoma/ui";

import { useOctoPet } from "./OctoPetProvider.js";
import { OctoSprite } from "./OctoSprite.js";
import { OCTO_STATE_LABELS } from "./types.js";

const STATUS_CARDS = [
  { title: "Campanhas", detail: "Preview local pronto para API." },
  { title: "Sincronização", detail: "Eventos de teste em Configurações." },
  { title: "Próxima etapa", detail: "Conectar worker e backend." },
];

export function OctoPetOverlay() {
  const octo = useOctoPet();
  const { preferences } = octo;

  if (!preferences.enabled) return null;

  return (
    <aside
      className="octo-overlay hidden md:block"
      data-testid="octo-pet-overlay"
      aria-label="Octo, assistente Nuoma"
    >
      <AnimatePresence>
        {preferences.expanded && (
          <motion.div
            key="tray"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="octo-tray botforge-surface"
            data-testid="octo-pet-tray"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-brand-cyan" />
                  <h2 className="text-sm font-semibold tracking-tight">Octo</h2>
                </div>
                <p className="mt-1 text-xs text-fg-muted">{octo.message}</p>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  label={preferences.muted ? "Desmutar Octo" : "Mutar Octo"}
                  onClick={() => octo.setMuted(!preferences.muted)}
                >
                  {preferences.muted ? (
                    <BellOff className="h-3.5 w-3.5" />
                  ) : (
                    <Bell className="h-3.5 w-3.5" />
                  )}
                </IconButton>
                <IconButton label="Esconder Octo" onClick={() => octo.setEnabled(false)}>
                  <EyeOff className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label="Fechar painel" onClick={() => octo.setExpanded(false)}>
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              <div className="rounded-lg bg-bg-base px-3 py-2 shadow-pressed-sm">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-fg-muted">Estado</span>
                  <span className="font-mono uppercase tracking-[0.16em] text-brand-cyan">
                    {OCTO_STATE_LABELS[octo.visualState]}
                  </span>
                </div>
              </div>
              {STATUS_CARDS.map((card) => (
                <div key={card.title} className="rounded-lg bg-bg-base/72 px-3 py-2 shadow-flat">
                  <div className="text-xs font-medium text-fg-primary">{card.title}</div>
                  <div className="mt-0.5 text-xs leading-5 text-fg-muted">{card.detail}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!preferences.expanded && !preferences.muted && octo.visualState !== "idle" && (
          <motion.div
            key={octo.message}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="octo-bubble botforge-readable"
            data-testid="octo-pet-bubble"
          >
            {octo.message}
          </motion.div>
        )}
      </AnimatePresence>

      <Tooltip delayDuration={180}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "octo-button botforge-surface",
              octo.visualState === "failed" && "octo-button-alert",
              preferences.expanded && "shadow-glow-cyan",
            )}
            aria-label={preferences.expanded ? "Recolher Octo" : "Abrir Octo"}
            aria-expanded={preferences.expanded}
            data-testid="octo-pet-button"
            onClick={() => {
              octo.toggleExpanded();
              octo.clearBadge();
            }}
          >
            <OctoSprite state={octo.visualState} className="h-[5.75rem] w-[5.3rem]" />
            {octo.badgeCount > 0 && (
              <span className="octo-badge" data-testid="octo-pet-badge">
                {Math.min(octo.badgeCount, 9)}
              </span>
            )}
            <span className="octo-state-icon" aria-hidden="true">
              {octo.visualState === "running" || octo.visualState === "review" ? (
                <PlayCircle className="h-4 w-4" />
              ) : octo.visualState === "waiting" ? (
                <PauseCircle className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Octo</TooltipContent>
      </Tooltip>
    </aside>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={label}
      className="aspect-square px-0"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
