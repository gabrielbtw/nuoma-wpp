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
  Radio,
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
  displayLabel?: string;
  icon: typeof LayoutDashboard;
  shortcut: string;
}

export const SHELL_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", displayLabel: "Signal Board", icon: LayoutDashboard, shortcut: "1" },
  { to: "/inbox", label: "Inbox", icon: Inbox, shortcut: "2" },
  { to: "/contacts", label: "Contatos", icon: Users, shortcut: "3" },
  { to: "/campaigns", label: "Campanhas", icon: Sparkles, shortcut: "4" },
  { to: "/automations", label: "Automações", displayLabel: "Automação", icon: Activity, shortcut: "5" },
  { to: "/chatbots", label: "Chatbots", displayLabel: "Respostas", icon: Bot, shortcut: "6" },
  { to: "/operations", label: "Operações", displayLabel: "Operação", icon: Radio, shortcut: "o" },
  { to: "/jobs", label: "Jobs", displayLabel: "Logs", icon: ListChecks, shortcut: "7" },
  { to: "/implementation", label: "Implementação", displayLabel: "Fluxos", icon: ClipboardList, shortcut: "8" },
  { to: "/evidence", label: "Evidências", displayLabel: "Auditoria", icon: FolderSearch, shortcut: "v" },
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
          "flex flex-col gap-1 p-3",
          mode === "desktop"
            ? "sticky top-0 h-screen border-r border-border-subtle bg-bg-base"
            : "min-h-screen",
        )}
      >
        <MicroGrid className="hidden" size={48} />
        <Link
          to="/"
          aria-label="Nuoma"
          onClick={onNavigate}
          className="mb-1 inline-flex h-12 items-center justify-center gap-3 rounded-md px-1 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent xl:w-full xl:justify-start xl:px-2"
        >
          <NuomaLogo variant="small" tone="gold" className="h-9 w-9 shrink-0" />
          <span className="hidden min-w-0 xl:block">
            <span className="block truncate text-sm font-semibold tracking-tight text-fg-primary">
              Nuoma WPP
            </span>
            <span className="mt-0.5 block truncate font-mono text-[0.62rem] uppercase tracking-wider text-fg-dim">
              Operação local
            </span>
          </span>
        </Link>

        <div
          className="mb-2 mt-1 hidden px-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-fg-faint xl:block"
          aria-hidden
        >
          Operações
        </div>

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

        <div className="nuoma-sidebar-workspace mt-auto hidden rounded-md border border-border-subtle bg-bg-surface p-3 xl:block">
          <div className="font-mono text-[0.6rem] uppercase tracking-wider text-fg-faint">
            Workspace
          </div>
          <div className="mt-1 truncate text-sm font-medium text-fg-primary">
            Operação Principal
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge variant={workspaceStatus.variant}>{workspaceStatus.label}</Badge>
            <span className="font-mono text-[0.62rem] text-fg-dim">{workspaceStatus.detail}</span>
          </div>
        </div>

        <div className="nuoma-sidebar-footer mt-2 flex w-full flex-col items-center gap-1 border-t border-border-subtle pt-2 xl:items-stretch">
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
          className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <motion.span
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className={cn(
              "group relative inline-flex h-9 w-9 items-center justify-center rounded-md xl:w-full xl:justify-start xl:gap-3 xl:px-3",
              "transition-colors duration-fast ease-out",
              active
                ? "bg-accent/12 text-accent-strong"
                : "text-fg-muted hover:bg-fg-primary/[0.05] hover:text-fg-primary",
            )}
          >
            <Icon className="h-[1.05rem] w-[1.05rem] shrink-0" />
            <span className="nuoma-nav-label hidden min-w-0 flex-1 truncate text-[0.86rem] xl:block">
              {item.displayLabel ?? item.label}
            </span>
            <span className="nuoma-nav-shortcut hidden font-mono text-[0.62rem] text-fg-faint xl:block">
              {item.shortcut}
            </span>
            {active && (
              <motion.span
                layoutId="sidebar-active-marker"
                className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
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
