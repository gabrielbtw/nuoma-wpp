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
  NuomaLogo,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nuoma/ui";

import {
  getShellNavSections,
  type ShellNavSection,
  type ShellRouteEntry,
} from "./nav-registry.js";

const NAV_ICONS: Record<string, typeof LayoutDashboard> = {
  "/": LayoutDashboard,
  "/inbox": Inbox,
  "/contacts": Users,
  "/campaigns": Sparkles,
  "/automations": Activity,
  "/chatbots": Bot,
  "/operations": Radio,
  "/jobs": ListChecks,
  "/settings": Settings,
  "/implementation": ClipboardList,
  "/evidence": FolderSearch,
  "/dev/components": Wrench,
};

interface SidebarProps {
  mode?: "desktop" | "mobile";
  onNavigate?: () => void;
  runtimeStatus?: ShellRuntimeStatus;
  isAdmin: boolean;
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

export function Sidebar({
  mode = "desktop",
  onNavigate,
  runtimeStatus,
  isAdmin,
}: SidebarProps) {
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const workspaceStatus = workspaceStatusFor(runtimeStatus);
  const sections = getShellNavSections({ isAdmin });
  const primarySections = sections.filter((section) => section.id !== "dev");
  const devSection = sections.find((section) => section.id === "dev");

  return (
    <aside
      className={cn(
        "nw-shell-sidebar relative shrink-0",
        mode === "desktop" ? "hidden w-[4.75rem] md:block xl:w-[16rem]" : "w-full",
      )}
    >
      <div
        className={cn(
          "nw-shell-sidebar-panel flex min-h-full flex-col",
          mode === "desktop" ? "sticky top-0 h-screen px-2 py-3 xl:px-3" : "px-3 py-4",
        )}
      >
        <Link
          to="/"
          aria-label="Nuoma"
          onClick={onNavigate}
          className={cn(
            "nw-shell-brand mb-4 inline-flex h-11 items-center justify-center gap-3 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            mode === "mobile" ? "w-full justify-start px-2" : "xl:w-full xl:justify-start xl:px-2",
          )}
        >
          <NuomaLogo variant="small" tone="gold" className="h-9 w-9 shrink-0" />
          <span className={cn("min-w-0", mode === "mobile" ? "block" : "hidden xl:block")}>
            <span className="block truncate font-display text-sm font-semibold text-ink-strong">
              Nuoma
            </span>
            <span className="mt-0.5 block truncate font-mono text-[0.64rem] uppercase text-ink-faint">
              Carvão & Cobre
            </span>
          </span>
        </Link>

        <nav className="flex w-full flex-col gap-5" aria-label="Navegação principal">
          {primarySections.map((section) => (
            <NavSectionBlock
              key={section.id}
              section={section}
              currentPath={currentPath}
              mode={mode}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-5">
          {isAdmin && (
            <div className="nw-shell-workspace hidden rounded-md border border-line-hairline bg-surface-1 p-3 xl:block">
              <div className="font-mono text-[0.64rem] uppercase text-ink-faint">Workspace</div>
              <div className="mt-1 truncate text-sm font-medium text-ink-strong">
                Operação Principal
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Badge variant={workspaceStatus.variant}>{workspaceStatus.label}</Badge>
                <span className="font-mono text-[0.62rem] text-ink-soft">
                  {workspaceStatus.detail}
                </span>
              </div>
            </div>
          )}

          {devSection && (
            <nav className="nw-shell-dev-nav flex w-full flex-col gap-2 border-t border-line-hairline pt-3">
              <NavSectionBlock
                section={devSection}
                currentPath={currentPath}
                mode={mode}
                onNavigate={onNavigate}
              />
            </nav>
          )}
        </div>
      </div>
    </aside>
  );
}

function NavSectionBlock({
  section,
  currentPath,
  mode,
  onNavigate,
}: {
  section: ShellNavSection;
  currentPath: string;
  mode: "desktop" | "mobile";
  onNavigate?: () => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div
        className={cn(
          "px-2 font-mono text-[0.64rem] uppercase text-ink-faint",
          mode === "desktop" && "hidden xl:block",
        )}
      >
        {section.label}
      </div>
      <div className="flex flex-col gap-1">
        {section.items.map((item) => (
          <NavLink
            key={item.path}
            item={item}
            active={isActive(currentPath, item.path)}
            mode={mode}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </section>
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
  mode,
  onNavigate,
}: {
  item: ShellRouteEntry;
  active: boolean;
  mode: "desktop" | "mobile";
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[item.path] ?? LayoutDashboard;
  const showLabel = mode === "mobile";

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Link
          to={item.path}
          aria-label={item.label}
          onClick={onNavigate}
          className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <motion.span
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            className={cn(
              "nw-shell-nav-item group relative inline-flex h-10 w-10 items-center justify-center rounded-md",
              "transition-colors duration-fast ease-out",
              mode === "mobile" ? "w-full justify-start gap-3 px-3" : "xl:w-full xl:justify-start xl:gap-3 xl:px-3",
              active
                ? "bg-surface-2 text-ink-strong"
                : "text-ink-soft hover:bg-surface-1 hover:text-ink-strong",
            )}
          >
            <Icon className={cn("h-[1.05rem] w-[1.05rem] shrink-0", active && "text-accent")} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[0.86rem]",
                showLabel ? "block" : "hidden xl:block",
              )}
            >
              {item.label}
            </span>
            <span
              className={cn(
                "font-mono text-[0.62rem] text-ink-faint",
                showLabel ? "block" : "hidden xl:block",
              )}
            >
              {item.shortcut}
            </span>
            {active && (
              <motion.span
                layoutId="sidebar-active-marker"
                className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
              />
            )}
          </motion.span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        <span>{item.label}</span>
        {item.shortcut ? <KeyboardShortcut keys={item.shortcut} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}
