import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";

import {
  cn,
  KeyboardShortcut,
  MicroGrid,
  SignalDot,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nuoma/ui";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  shortcut: string;
}

export const SHELL_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, shortcut: "1" },
  { to: "/inbox", label: "Inbox", icon: Inbox, shortcut: "2" },
  { to: "/contacts", label: "Contatos", icon: Users, shortcut: "3" },
  { to: "/campaigns", label: "Campanhas", icon: Sparkles, shortcut: "4" },
  { to: "/automations", label: "Automações", icon: Activity, shortcut: "5" },
  { to: "/chatbots", label: "Chatbots", icon: Bot, shortcut: "6" },
  { to: "/jobs", label: "Jobs", icon: ListChecks, shortcut: "7" },
  { to: "/implementation", label: "Implementação", icon: ClipboardList, shortcut: "8" },
];

export const SHELL_FOOTER_NAV_ITEMS: NavItem[] = [
  { to: "/settings", label: "Configurações", icon: Settings, shortcut: "9" },
  { to: "/dev/components", label: "Dev / DS", icon: Wrench, shortcut: "0" },
];

export const SHELL_SHORTCUT_ITEMS = [...SHELL_NAV_ITEMS, ...SHELL_FOOTER_NAV_ITEMS];

interface SidebarProps {
  mode?: "desktop" | "mobile";
  onNavigate?: () => void;
}

export function Sidebar({ mode = "desktop", onNavigate }: SidebarProps) {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  return (
    <aside
      className={cn(
        "relative shrink-0",
        mode === "desktop" ? "hidden w-20 px-3 py-5 md:block" : "w-full p-0",
      )}
    >
      <div
        className={cn(
          "botforge-surface flex flex-col items-center gap-3 rounded-xxxl p-3",
          mode === "desktop" ? "sticky top-5 h-[calc(100vh-2.5rem)]" : "min-h-[calc(100vh-1.5rem)]",
        )}
      >
        <MicroGrid className="hidden" size={56} />
        <Link
          to="/"
          aria-label="Nuoma"
          onClick={onNavigate}
          className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-surface shadow-pressed-sm hover:shadow-raised-sm transition-shadow"
        >
          <SignalDot status="active" size="md" />
        </Link>

        <div className="my-1 h-px w-8 bg-contour-line" />

        <nav className="flex flex-col gap-2">
          {SHELL_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              active={isActive(currentPath, item.to)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-3 border-t border-contour-line/50 w-full items-center">
          {SHELL_FOOTER_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              active={isActive(currentPath, item.to)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function isActive(currentPath: string, target: string): boolean {
  if (target === "/") return currentPath === "/";
  return currentPath === target || currentPath.startsWith(`${target}/`);
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Link
          to={item.to}
          aria-label={item.label}
          onClick={onNavigate}
          className="relative outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/60 rounded-xl"
        >
          <motion.span
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className={cn(
              "relative inline-flex h-12 w-12 items-center justify-center rounded-xl bg-bg-surface",
              "transition-shadow duration-base ease-out",
              active
                ? "shadow-pressed-md text-brand-cyan"
                : "shadow-flat text-fg-muted hover:shadow-raised-sm hover:text-fg-primary",
            )}
          >
            <Icon className={cn("h-4 w-4", active && "drop-shadow-[0_0_8px_var(--glow-active)]")} />
            {active && (
              <motion.span
                layoutId="sidebar-active-marker"
                className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-brand-cyan shadow-glow-cyan"
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
              />
            )}
          </motion.span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        <span>{item.label}</span>
        <KeyboardShortcut keys={item.shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}
