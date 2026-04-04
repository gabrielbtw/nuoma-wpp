import { useEffect, useMemo, useState } from "react";
import {
  ActivitySquare, Bot, BriefcaseBusiness, ContactRound, FileArchive,
  LayoutDashboard, LineChart, Logs, Menu, MessageCircle, MessageSquareMore,
  Settings, X, Zap
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ChannelSessionStrip } from "@/components/shared/channel-session-strip";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, color: "text-n-blue" },
  { to: "/inbox", label: "Inbox", icon: MessageSquareMore, color: "text-n-wa" },
  { to: "/contacts", label: "Contatos", icon: ContactRound, color: "text-cmm-purple" },
  { to: "/automations", label: "Automacoes", icon: Bot, color: "text-n-amber" },
  { to: "/campaigns", label: "Campanhas", icon: BriefcaseBusiness, color: "text-pink-400" },
  { to: "/chatbot", label: "Chatbot", icon: MessageCircle, color: "text-n-ig" },
  { to: "/trends", label: "Tendencias", icon: LineChart, color: "text-yellow-400" },
  { to: "/imports", label: "Importacoes", icon: FileArchive, color: "text-n-text-dim" },
  { to: "/health", label: "Saude", icon: ActivitySquare, color: "text-n-red" },
  { to: "/logs", label: "Logs", icon: Logs, color: "text-n-text-dim" },
  { to: "/settings", label: "Config", icon: Settings, color: "text-n-text-dim" }
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-0.5">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-body font-medium transition-fast",
                isActive
                  ? "bg-n-surface-2 text-n-text"
                  : "text-n-text-muted hover:bg-n-surface-2/50 hover:text-n-text"
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? item.color : "text-n-text-dim")} />
                <span className="truncate">{item.label}</span>
                {isActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-n-blue" />}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const currentSection = useMemo(
    () =>
      navItems.find((item) => {
        if (item.to === "/") return location.pathname === "/";
        return location.pathname.startsWith(item.to);
      }) ?? navItems[0],
    [location.pathname]
  );
  const showHeaderSessionStrip = location.pathname !== "/campaigns";

  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-n-bg font-body text-n-text">
      {/* Sidebar - Desktop */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-n-border bg-n-bg lg:flex">
        {/* Brand */}
        <div className="flex items-center gap-2.5 border-b border-n-border px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-n-blue">
            <Zap className="h-3.5 w-3.5 text-white" fill="currentColor" />
          </div>
          <div>
            <div className="text-h4 text-n-text">Nuoma</div>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto p-2">
          <NavItems />
        </div>

        {/* Footer */}
        <div className="border-t border-n-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="signal-dot active" />
            <span className="text-micro uppercase text-n-text-dim">Local</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Mobile Top Bar */}
        <div className="flex items-center justify-between border-b border-n-border bg-n-surface px-4 py-2.5 lg:hidden">
          <button type="button" onClick={() => setMobileNavOpen(true)} className="rounded-md p-1.5 text-n-text-muted hover:bg-n-surface-2">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-h4 text-n-text">Nuoma</span>
          <div className="h-6 w-6 rounded-md bg-n-surface-2" />
        </div>

        {/* Desktop Header - minimal */}
        <header className="hidden items-center justify-between border-b border-n-border bg-n-surface px-4 py-1 lg:flex">
          <span className="text-caption text-n-text-muted">{currentSection.label}</span>
          <div className={cn("hidden xl:flex items-center gap-2", !showHeaderSessionStrip && "xl:hidden")}>
            <ChannelSessionStrip compact />
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="px-3 py-3 lg:px-4 lg:py-3">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileNavOpen(false)} />
          <nav className="relative flex w-[260px] flex-col bg-n-bg border-r border-n-border shadow-2xl">
            <div className="flex items-center justify-between border-b border-n-border px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-n-blue">
                  <Zap className="h-3.5 w-3.5 text-white" fill="currentColor" />
                </div>
                <span className="text-h4 text-n-text">Nuoma</span>
              </div>
              <button onClick={() => setMobileNavOpen(false)} className="text-n-text-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <NavItems onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
