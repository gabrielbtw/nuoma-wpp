export type ShellRouteAccess = "operator" | "admin" | "dev";
export type ShellNavSectionId = "operate" | "dispatch" | "system" | "dev";

export interface ShellRouteEntry {
  path: string;
  label: string;
  breadcrumb: string;
  section: ShellNavSectionId;
  shortcut?: string;
  access: ShellRouteAccess;
  showInSidebar: boolean;
}

export interface ShellNavSection {
  id: ShellNavSectionId;
  label: string;
  items: ShellRouteEntry[];
}

const SECTION_LABELS: Record<ShellNavSectionId, string> = {
  operate: "Operar",
  dispatch: "Disparar",
  system: "Sistema",
  dev: "Dev",
};

export const SHELL_ROUTE_REGISTRY: ShellRouteEntry[] = [
  {
    path: "/inbox",
    label: "Inbox",
    breadcrumb: "Inbox",
    section: "operate",
    shortcut: "2",
    access: "operator",
    showInSidebar: true,
  },
  {
    path: "/contacts",
    label: "Contatos",
    breadcrumb: "Contatos",
    section: "operate",
    shortcut: "3",
    access: "operator",
    showInSidebar: true,
  },
  {
    path: "/campaigns",
    label: "Campanhas",
    breadcrumb: "Campanhas",
    section: "dispatch",
    shortcut: "4",
    access: "operator",
    showInSidebar: true,
  },
  {
    path: "/automations",
    label: "Automações",
    breadcrumb: "Automações",
    section: "dispatch",
    shortcut: "5",
    access: "operator",
    showInSidebar: true,
  },
  {
    path: "/chatbots",
    label: "Chatbots",
    breadcrumb: "Chatbots",
    section: "dispatch",
    shortcut: "6",
    access: "operator",
    showInSidebar: true,
  },
  {
    path: "/",
    label: "Painel",
    breadcrumb: "Painel",
    section: "system",
    shortcut: "1",
    access: "admin",
    showInSidebar: true,
  },
  {
    path: "/operations",
    label: "Operações",
    breadcrumb: "Operações",
    section: "system",
    shortcut: "o",
    access: "admin",
    showInSidebar: true,
  },
  {
    path: "/jobs",
    label: "Fila de envio",
    breadcrumb: "Fila de envio",
    section: "system",
    shortcut: "7",
    access: "admin",
    showInSidebar: true,
  },
  {
    path: "/settings",
    label: "Configurações",
    breadcrumb: "Configurações",
    section: "system",
    shortcut: "9",
    access: "admin",
    showInSidebar: true,
  },
  {
    path: "/implementation",
    label: "Implementação",
    breadcrumb: "Implementação",
    section: "dev",
    shortcut: "8",
    access: "dev",
    showInSidebar: true,
  },
  {
    path: "/evidence",
    label: "Evidências",
    breadcrumb: "Evidências",
    section: "dev",
    shortcut: "v",
    access: "dev",
    showInSidebar: true,
  },
  {
    path: "/dev/components",
    label: "Componentes",
    breadcrumb: "Componentes",
    section: "dev",
    shortcut: "0",
    access: "dev",
    showInSidebar: true,
  },
];

export function canAccessShellRoute(
  route: Pick<ShellRouteEntry, "access">,
  input: { isAdmin: boolean; isDev?: boolean },
): boolean {
  if (route.access === "admin") return input.isAdmin;
  if (route.access === "dev") return input.isDev ?? import.meta.env.DEV;
  return true;
}

export function getShellNavSections(input: {
  isAdmin: boolean;
  isDev?: boolean;
}): ShellNavSection[] {
  const items = SHELL_ROUTE_REGISTRY.filter(
    (route) => route.showInSidebar && canAccessShellRoute(route, input),
  );
  return (Object.keys(SECTION_LABELS) as ShellNavSectionId[])
    .map((id) => ({
      id,
      label: SECTION_LABELS[id],
      items: items.filter((item) => item.section === id),
    }))
    .filter((section) => section.items.length > 0);
}

export function getShellShortcutItems(isAdmin: boolean, isDev = import.meta.env.DEV) {
  return getShellNavSections({ isAdmin, isDev })
    .flatMap((section) => section.items)
    .filter((item) => item.shortcut);
}

export function shellRouteByPath(pathname: string): ShellRouteEntry | null {
  return (
    SHELL_ROUTE_REGISTRY.find((route) =>
      route.path === "/"
        ? pathname === "/"
        : pathname === route.path || pathname.startsWith(`${route.path}/`),
    ) ?? null
  );
}

export function shellBreadcrumbForLocation(pathname: string, search = ""): string {
  const route = shellRouteByPath(pathname);
  if (!route) return pathname;
  if (pathname === "/campaigns") {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const tab = params.get("tab");
    if (tab === "builder") return "Campanhas / Builder";
    if (tab === "dispatch" || params.get("intent") === "enqueue") return "Campanhas / Disparo";
    if (tab === "recipients") return "Campanhas / Destinatários";
    return "Campanhas / Visão geral";
  }
  return route.breadcrumb;
}
