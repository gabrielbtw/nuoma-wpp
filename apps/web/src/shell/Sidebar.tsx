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
  Badge,
  type BadgeVariant,
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
  { to: "/", label: "Visão geral", icon: LayoutDashboard, shortcut: "1" },
  { to: "/inbox", label: "Mensagens", icon: Inbox, shortcut: "2" },
  { to: "/contacts", label: "Contatos", icon: Users, shortcut: "3" },
  { to: "/campaigns", label: "Campanhas", icon: Sparkles, shortcut: "4" },
  { to: "/automations", label: "Automação", icon: Activity, shortcut: "5" },
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
  runtimeStatus?: ShellRuntimeStatus;
}

export interface ShellRuntimeStatus {
  loading: boolean;
  cdpConnected: boolean;
  workersOnline: number;
  workersTotal: number;
  hasErrors: boolean;
  unavailable?: boolean;
  error?: boolean;
}

export function Sidebar({ mode = "desktop", onNavigate, runtimeStatus }: SidebarProps) {
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const workspaceStatus = workspaceStatusFor(runtimeStatus);

  return (
    <aside
      className={cn(
        "relative shrink-0",
        mode === "desktop" ? "hidden w-[5rem] px-2 py-3 md:block xl:w-[15rem]" : "w-full p-0",
      )}
    >
      <div
        className={cn(
          "botforge-surface flex flex-col gap-2 rounded-lg p-2",
          mode === "desktop"
            ? "sticky top-3 h-[calc(100vh-1.5rem)]"
            : "min-h-[calc(100vh-1.25rem)]",
        )}
      >
        <MicroGrid className="hidden" size={48} />
        <Link
          to="/"
          aria-label="Nuoma"
          onClick={onNavigate}
          className="inline-flex h-12 items-center justify-center gap-3 rounded-lg px-1 outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-cyan/60 xl:w-full xl:justify-start xl:px-2"
        >
          <NuomaLogo variant="small" tone="gold" className="h-10 w-10 shrink-0" />
          <span className="hidden min-w-0 xl:block">
            <span className="block truncate text-sm font-semibold text-fg-primary">Nuoma WPP</span>
            <span className="mt-0.5 block truncate font-mono text-[0.62rem] uppercase text-fg-dim">
              Operação local
            </span>
          </span>
        </Link>

        <div className="my-1 h-px w-full bg-white/10" />

        <nav className="flex w-full flex-col gap-1.5">
          {SHELL_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              active={isActive(currentPath, item.to)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="nuoma-sidebar-workspace mt-auto hidden rounded-lg border border-brand-cyan/15 bg-brand-cyan/8 p-3 shadow-flat-subtle xl:block">
          <div className="font-mono text-[0.62rem] uppercase text-fg-dim">Workspace</div>
          <div className="mt-1 truncate text-sm font-medium text-fg-primary">
            Operação Principal
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge variant={workspaceStatus.variant}>{workspaceStatus.label}</Badge>
            <span className="font-mono text-[0.62rem] text-fg-dim">{workspaceStatus.detail}</span>
          </div>
        </div>

        <div className="nuoma-sidebar-footer flex w-full flex-col items-center gap-1.5 border-t border-white/10 pt-2 xl:items-stretch">
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

function workspaceStatusFor(input: ShellRuntimeStatus | undefined): {
  label: string;
  detail: string;
  variant: BadgeVariant;
} {
  if (!input || input.unavailable) {
    return { label: "sem métrica", detail: "v2", variant: "neutral" };
  }
  if (input.loading) {
    return { label: "checando", detail: "v2", variant: "info" };
  }
  if (input.error) {
    return { label: "erro", detail: "métrica", variant: "danger" };
  }
  if (input.workersTotal === 0) {
    return { label: "sem worker", detail: "0/0", variant: "warning" };
  }
  if (input.hasErrors) {
    return {
      label: "atenção",
      detail: `${input.workersOnline}/${input.workersTotal}`,
      variant: "danger",
    };
  }
  return {
    label: input.cdpConnected ? "online" : "degradado",
    detail: `${input.workersOnline}/${input.workersTotal}`,
    variant: input.cdpConnected ? "success" : "warning",
  };
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
              "relative inline-flex h-10 w-10 items-center justify-center rounded-lg xl:w-full xl:justify-start xl:gap-3 xl:px-3",
              "border transition-[background-color,box-shadow,color] duration-base ease-out",
              active
                ? "border-brand-cyan/40 bg-brand-cyan/12 text-brand-cyan shadow-glow-cyan"
                : "border-border-subtle/10 bg-bg-surface/30 text-fg-muted shadow-flat-subtle hover:border-border-muted/20 hover:bg-bg-surface/64 hover:text-fg-primary hover:shadow-flat",
            )}
          >
            <Icon className={cn("h-4 w-4", active && "drop-shadow-[0_0_8px_var(--glow-active)]")} />
            <span className="nuoma-nav-label hidden min-w-0 flex-1 truncate text-sm xl:block">{item.label}</span>
            <span className="nuoma-nav-shortcut hidden font-mono text-[0.62rem] text-fg-dim xl:block">
              {item.shortcut}
            </span>
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
