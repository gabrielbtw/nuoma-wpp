import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  ClipboardList,
  FolderSearch,
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
  NuomaLogo,
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
  { to: "/evidence", label: "Evidências", icon: FolderSearch, shortcut: "v" },
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
        mode === "desktop" ? "hidden w-[4.75rem] px-2 py-3 md:block" : "w-full p-0",
      )}
    >
      <div
        className={cn(
          "botforge-surface flex flex-col items-center gap-2 rounded-xl p-2",
          mode === "desktop" ? "sticky top-3 h-[calc(100vh-1.5rem)]" : "min-h-[calc(100vh-1.25rem)]",
        )}
      >
        <MicroGrid className="hidden" size={48} />
        <Link
          to="/"
          aria-label="Nuoma"
          onClick={onNavigate}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-cyan/60"
        >
          <NuomaLogo variant="small" tone="gold" className="h-10 w-10" />
        </Link>

        <div className="my-1 h-px w-8 bg-white/10" />

        <nav className="flex flex-col gap-1.5">
          {SHELL_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              active={isActive(currentPath, item.to)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto flex w-full flex-col items-center gap-1.5 border-t border-white/10 pt-2">
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
          className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/60"
        >
          <motion.span
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className={cn(
              "relative inline-flex h-10 w-10 items-center justify-center rounded-lg",
              "border transition-[background-color,box-shadow,color] duration-base ease-out",
              active
                ? "border-brand-cyan/30 bg-brand-cyan/12 text-brand-cyan shadow-glow-cyan"
                : "border-white/8 bg-bg-sunken/62 text-fg-muted shadow-flat hover:bg-bg-surface/78 hover:text-fg-primary hover:shadow-raised-sm",
            )}
          >
            <Icon className={cn("h-4 w-4", active && "drop-shadow-[0_0_8px_var(--glow-active)]")} />
            {active && (
              <motion.span
                layoutId="sidebar-active-marker"
                className="absolute -left-2 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand-cyan shadow-glow-cyan"
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
