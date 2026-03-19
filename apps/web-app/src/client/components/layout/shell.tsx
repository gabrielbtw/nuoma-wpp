import { useEffect, useMemo, useState } from "react";
import { ActivitySquare, Bot, BriefcaseBusiness, ContactRound, FileArchive, LayoutDashboard, LineChart, Logs, Menu, MessageSquareMore, Settings, X, Zap } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ChannelSessionStrip } from "@/components/shared/channel-session-strip";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, color: "text-blue-400" },
  { to: "/inbox", label: "Inbox", icon: MessageSquareMore, color: "text-cmm-emerald" },
  { to: "/contacts", label: "Contatos", icon: ContactRound, color: "text-cmm-purple" },
  { to: "/automations", label: "Automações", icon: Bot, color: "text-cmm-orange" },
  { to: "/campaigns", label: "Campanhas", icon: BriefcaseBusiness, color: "text-pink-400" },
  { to: "/trends", label: "Tendências", icon: LineChart, color: "text-yellow-400" },
  { to: "/imports", label: "Importações", icon: FileArchive, color: "text-slate-400" },
  { to: "/health", label: "Saúde do Sistema", icon: ActivitySquare, color: "text-red-400" },
  { to: "/logs", label: "Logs", icon: Logs, color: "text-slate-500" },
  { to: "/settings", label: "Configurações", icon: Settings, color: "text-slate-400" }
];

function BrandBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", compact ? "mb-4" : "mb-10")}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cmm-blue to-indigo-600 shadow-lg shadow-blue-500/20">
        <Zap className="h-6 w-6 text-white" fill="currentColor" />
      </div>
      {!compact && (
        <div>
          <div className="font-display text-xl font-bold tracking-tight text-white">Nuoma</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400/80">Operação local</div>
        </div>
      )}
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1.5">
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
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-cmm-blue text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)] shadow-blue-500/20"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("h-4.5 w-4.5 transition-colors", isActive ? "text-white" : item.color)} />
                <span className="flex-1">{item.label}</span>
                {!isActive && <div className="h-1.5 w-1.5 rounded-full bg-white/0 transition-all group-hover:bg-white/20" />}
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
        if (item.to === "/") {
          return location.pathname === "/";
        }

        return location.pathname.startsWith(item.to);
      }) ?? navItems[0],
    [location.pathname]
  );
  const showHeaderSessionStrip = location.pathname !== "/campaigns";

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-[#0c0c0e] font-body text-foreground">
      {/* Background Glows */}
      <div className="pointer-events-none absolute -left-[10%] -top-[10%] h-[50%] w-[50%] rounded-full bg-cmm-blue/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-[10%] -bottom-[10%] h-[50%] w-[50%] rounded-full bg-cmm-emerald/5 blur-[120px]" />

      {/* Sidebar - Desktop */}
      <aside className="hidden w-[260px] flex-col bg-transparent px-4 py-8 lg:flex">
        <BrandBlock />
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <NavItems />
        </div>

        <div className="mt-auto pt-6">
          <div className="rounded-2xl bg-white/[0.03] p-4 border border-white/5">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-slate-500" />
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Desktop Local</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area - Floating Panel Effect */}
      <main className="relative flex flex-1 flex-col overflow-hidden p-2 lg:p-4">
        <div className="flex h-full flex-col overflow-hidden rounded-[2.5rem] border border-white/10 bg-[#16161a]/60 shadow-2xl backdrop-blur-md">

          {/* Mobile Top Bar */}
          <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-6 py-4 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-200"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="text-sm font-bold tracking-tight text-white">Nuoma</div>
            <div className="h-8 w-8 rounded-full bg-cmm-blue/20 border border-cmm-blue/30" />
          </div>

          {/* Desktop Header / Breadcrumb - Minimal */}
          <header className="hidden items-center justify-between border-b border-white/5 px-8 py-5 lg:flex">
            <div>
              <h1 className="text-sm font-semibold text-slate-400 capitalize">{currentSection.label}</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className={cn("hidden min-w-[420px] xl:block", !showHeaderSessionStrip && "xl:hidden")}>
                <ChannelSessionStrip compact />
              </div>
              <div className="flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Ambiente local</span>
              </div>
              <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-slate-700 to-slate-800 border border-white/10" />
            </div>
          </header>

          {/* Page Content */}
          <div className="flex-1 overflow-y-auto px-6 py-8 lg:px-10 lg:py-10">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
          <nav className="relative flex w-[280px] flex-col bg-[#0c0c0e] p-6 shadow-2xl">
            <div className="mb-8 flex items-center justify-between">
              <BrandBlock compact />
              <button onClick={() => setMobileNavOpen(false)} className="text-slate-400">
                <X className="h-6 w-6" />
              </button>
            </div>
            <NavItems onNavigate={() => setMobileNavOpen(false)} />
          </nav>
        </div>
      )}
    </div>
  );
}
