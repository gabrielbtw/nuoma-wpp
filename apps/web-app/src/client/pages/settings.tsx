import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, HardDriveUpload, Pencil, Search, ServerCog, ShieldCheck, Tags, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { TagPill } from "@/components/tags/tag-pill";
import { apiFetch, toJsonBody } from "@/lib/api";
import { cn } from "@/lib/utils";

const TAG_COLORS = [
  { label: "Verde", value: "#3ddc97" },
  { label: "Azul", value: "#38bdf8" },
  { label: "Laranja", value: "#f59e0b" },
  { label: "Rosa", value: "#fb7185" },
  { label: "Índigo", value: "#818cf8" },
  { label: "Âmbar", value: "#fbbf24" },
  { label: "Ciano", value: "#22d3ee" },
  { label: "Cinza", value: "#94a3b8" }
] as const;

const TAG_TYPES = [
  { value: "manual", label: "Manual" },
  { value: "canal", label: "Canal" },
  { value: "automacao", label: "Automação" },
  { value: "sistema", label: "Sistema" }
] as const;

type TagDraft = {
  name: string;
  color: string;
  type: string;
  active: boolean;
};

type TagRecord = {
  id: string;
  name: string;
  color: string;
  type: string;
  active: boolean;
  contactCount: number;
};

const emptyTag: TagDraft = {
  name: "",
  color: TAG_COLORS[0].value,
  type: "manual",
  active: true
};

const SETTINGS_GROUPS = [
  {
    id: "general",
    title: "Operação local",
    description: "Preferências gerais da instalação, identidade local e chaves sem impacto direto no worker.",
    icon: Cog,
    match: (key: string) => ["default_", "app_", "timezone", "host", "port", "debug", "log_"].some((token) => key.includes(token))
  },
  {
    id: "runtime",
    title: "Worker e canais",
    description: "Comportamento do Chromium, sincronização, watchdog e integrações de canal.",
    icon: ServerCog,
    match: (key: string) => ["chromium", "wa_", "ig_", "worker_", "watchdog"].some((token) => key.includes(token))
  },
  {
    id: "automation",
    title: "Automação e fila",
    description: "Parâmetros de scheduler, campanhas e regras automáticas.",
    icon: Workflow,
    match: (key: string) => ["scheduler", "campaign", "automation", "post_procedure"].some((token) => key.includes(token))
  },
  {
    id: "storage",
    title: "Arquivos e storage",
    description: "Diretórios e limites locais para uploads, mídia e temporários.",
    icon: HardDriveUpload,
    match: (key: string) => ["upload", "media", "temp", "database", "screenshot", "profile_dir"].some((token) => key.includes(token))
  }
] as const;

function tagTypeLabel(type: string) {
  return TAG_TYPES.find((item) => item.value === type)?.label ?? type;
}

function humanizeSettingKey(key: string) {
  return key
    .split(/[_.-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveSettingGroup(key: string) {
  const normalizedKey = key.toLowerCase();
  return SETTINGS_GROUPS.find((group) => group.match(normalizedKey)) ?? SETTINGS_GROUPS[0];
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Array<{ key: string; value: unknown; source?: "env" | "database" }>>("/settings")
  });
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  const [activeTab, setActiveTab] = useState<"general" | "tags" | "advanced">("general");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState<TagDraft>(emptyTag);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const [tagStatusFilter, setTagStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const merged = useMemo(
    () =>
      (settingsQuery.data ?? []).reduce(
        (accumulator, item) => ({
          ...accumulator,
          [item.key]: draft[item.key] ?? JSON.stringify(item.value)
        }),
        draft
      ),
    [draft, settingsQuery.data]
  );

  const filteredTags = useMemo(
    () =>
      (tagsQuery.data ?? []).filter((tag) => {
        const matchesSearch = tag.name.toLowerCase().includes(tagSearch.toLowerCase());
        const matchesStatus = tagStatusFilter === "all" ? true : tagStatusFilter === "active" ? tag.active : !tag.active;
        return matchesSearch && matchesStatus;
      }),
    [tagSearch, tagStatusFilter, tagsQuery.data]
  );

  const groupedSettings = useMemo(() => {
    const groups = new Map(
      SETTINGS_GROUPS.map((group) => [
        group.id,
        {
          ...group,
          items: [] as Array<{ key: string; value: string }>
        }
      ])
    );

    Object.entries(merged).forEach(([key, value]) => {
      const group = resolveSettingGroup(key);
      groups.get(group.id)?.items.push({
        key,
        value: String(value)
      });
    });

    return [...groups.values()].filter((group) => group.items.length > 0);
  }, [merged]);

  const settingsSourceMap = useMemo(
    () => new Map((settingsQuery.data ?? []).map((item) => [item.key, item.source ?? "env"])),
    [settingsQuery.data]
  );

  const databasePath = useMemo(() => {
    const databaseItem = (settingsQuery.data ?? []).find((item) => item.key === "DATABASE_PATH");
    return typeof databaseItem?.value === "string" ? databaseItem.value : null;
  }, [settingsQuery.data]);

  const persistedOverrides = useMemo(
    () => (settingsQuery.data ?? []).filter((item) => (item.source ?? "env") === "database").length,
    [settingsQuery.data]
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch("/settings", {
        method: "PATCH",
        body: toJsonBody(
          Object.fromEntries(
            Object.entries(merged).map(([key, value]) => {
              try {
                return [key, JSON.parse(value)];
              } catch {
                return [key, value];
              }
            })
          )
        )
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  });

  const saveTagMutation = useMutation({
    mutationFn: (payload: TagDraft) =>
      apiFetch(editingTagId ? `/tags/${editingTagId}` : "/tags", {
        method: editingTagId ? "PATCH" : "POST",
        body: toJsonBody(payload)
      }),
    onSuccess: async () => {
      setEditingTagId(null);
      setTagDraft(emptyTag);
      await queryClient.invalidateQueries({ queryKey: ["tags"] });
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  });

  return (
    <div className="flex flex-col gap-8 pb-20 animate-in fade-in duration-700">
      <PageHeader
        eyebrow="Preferências do Sistema"
        title="Configurações"
        description="Ajuste parâmetros do ambiente local e mantenha tags e integrações com uma leitura objetiva do que está salvo."
      />

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        {/* Sidebar macOS Style */}
        <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-4 h-fit sticky top-8">
          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab("general")}
              className={cn("w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all",
                activeTab === "general" ? "bg-cmm-blue text-white shadow-lg shadow-blue-500/20" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
              )}
            >
              <ServerCog className="h-4 w-4" />
              Geral e Worker
            </button>
            <button
              onClick={() => setActiveTab("tags")}
              className={cn("w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all",
                activeTab === "tags" ? "bg-cmm-blue text-white shadow-lg shadow-blue-500/20" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
              )}
            >
              <Tags className="h-4 w-4" />
              Taxonomia (Tags)
            </button>
            <button
              onClick={() => setActiveTab("advanced")}
              className={cn("w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all",
                activeTab === "advanced" ? "bg-cmm-blue text-white shadow-lg shadow-blue-500/20" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              Avançado
            </button>
          </nav>

          <div className="mt-8 border-t border-white/5 pt-6 px-4 space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Base de Dados</p>
              <p className="text-xs font-bold text-slate-400">SQLite local{databasePath ? ` · ${databasePath.split("/").pop()}` : ""}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Overrides persistidos</p>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-cmm-emerald animate-pulse" />
                <span className="text-xs font-bold text-cmm-emerald uppercase tracking-tighter">{persistedOverrides} item(ns)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
          {activeTab === "general" && (
            <div className="space-y-8">
              <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-10 space-y-10">
                <div className="space-y-2">
                  <h2 className="font-display text-3xl font-bold text-white tracking-tight">Ambiente de Execução</h2>
                  <p className="text-sm font-medium text-slate-400">Ajuste os parâmetros fundamentais do worker e canais de comunicação.</p>
                </div>

                <div className="grid gap-10">
                  {groupedSettings.filter(g => ["general", "runtime"].includes(g.id)).map(group => (
                    <div key={group.id} className="space-y-6">
                      <div className="flex items-center gap-3 px-2">
                        <group.icon className="h-4 w-4 text-cmm-blue" />
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">{group.title}</h3>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {group.items.map(item => (
                          <div key={item.key} className="group glass-card rounded-3xl border-white/5 bg-black/20 p-5 space-y-3 transition-colors hover:bg-black/30">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{humanizeSettingKey(item.key)}</label>
                              <Badge tone={settingsSourceMap.get(item.key) === "database" ? "info" : "default"} className="scale-75 origin-right">
                                {settingsSourceMap.get(item.key) === "database" ? "DB" : "ENV"}
                              </Badge>
                            </div>
                            <Input
                              className="h-10 rounded-xl border-white/5 bg-white/[0.02] px-4 font-bold text-white tracking-tight text-xs focus:border-cmm-blue/30"
                              value={item.value}
                              onChange={(e) => setDraft({ ...merged, [item.key]: e.target.value })}
                            />
                            <p className="text-[9px] font-bold text-slate-600 truncate">{item.key}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-4 border-t border-white/5">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    className="h-12 rounded-2xl bg-cmm-blue px-10 text-xs font-black uppercase tracking-widest shadow-xl shadow-blue-500/20"
                  >
                    {saveMutation.isPending ? "SALVANDO..." : "SALVAR ALTERAÇÕES"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tags" && (
            <div className="space-y-8">
              <div className="grid gap-8 lg:grid-cols-[400px_1fr]">
                {/* Tag Editor */}
                <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-8 space-y-8 h-fit">
                  <div className="space-y-2">
                    <h3 className="font-display text-2xl font-bold text-white tracking-tight">{editingTagId ? "Refinar Tag" : "Nova Tag"}</h3>
                    <p className="text-xs font-medium text-slate-400">Defina a identidade visual e o comportamento da taxonomia.</p>
                  </div>

                  <div className="space-y-6">
                    <div className="flex justify-center p-8 rounded-3xl bg-black/40 border border-white/5 shadow-inner">
                      <TagPill name={tagDraft.name || "NOME DA TAG"} color={tagDraft.color} muted={!tagDraft.active} className="scale-125" />
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Etiqueta</label>
                        <Input className="h-12 rounded-2xl border-white/5 bg-white/[0.02] px-4 font-bold text-white focus:border-cmm-blue/30" placeholder="Ex: VIP" value={tagDraft.name} onChange={(e) => setTagDraft({ ...tagDraft, name: e.target.value })} />
                      </div>

                      <div className="space-y-1.5">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Paleta macOS</label>
                        <div className="grid grid-cols-4 gap-2">
                          {TAG_COLORS.map((c) => (
                            <button
                              key={c.value}
                              className={cn("h-10 rounded-xl border-2 transition-all", tagDraft.color === c.value ? "border-cmm-blue scale-110 shadow-lg" : "border-transparent scale-100")}
                              style={{ backgroundColor: c.value }}
                              onClick={() => setTagDraft({ ...tagDraft, color: c.value })}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Origem</label>
                          <select className="w-full h-12 rounded-2xl border border-white/5 bg-black/20 px-4 text-xs font-bold text-white outline-none" value={tagDraft.type} onChange={(e) => setTagDraft({ ...tagDraft, type: e.target.value })}>
                            {TAG_TYPES.map(o => <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Estado</label>
                          <div className="flex h-12 items-center justify-between rounded-2xl border border-white/5 bg-black/20 px-4">
                            <span className="text-[10px] font-bold text-white uppercase">{tagDraft.active ? "Ativa" : "Muda"}</span>
                            <Switch checked={tagDraft.active} onCheckedChange={(v) => setTagDraft({ ...tagDraft, active: v })} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4">
                      {editingTagId && <Button variant="ghost" className="h-12 flex-1 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400" onClick={() => { setEditingTagId(null); setTagDraft(emptyTag); }}>Cancelar</Button>}
                      <Button
                        className="h-12 flex-[2] rounded-2xl bg-cmm-blue text-[10px] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20"
                        disabled={saveTagMutation.isPending || !tagDraft.name.trim()}
                        onClick={() => saveTagMutation.mutate(tagDraft)}
                      >
                        {editingTagId ? "SALVAR TAG" : "CRIAR TAG"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Tag List */}
                <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-8 space-y-8">
                  <div className="flex items-center justify-between gap-6">
                    <div className="relative flex-1 group">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-cmm-blue transition-colors" />
                      <Input
                        className="h-14 rounded-2xl border-white/5 bg-white/[0.02] pl-12 pr-4 font-bold text-white tracking-tight focus:border-cmm-blue/30 focus:bg-white/[0.04] shadow-inner transition-all"
                        placeholder="Filtrar base de tags..."
                        value={tagSearch}
                        onChange={(e) => setTagSearch(e.target.value)}
                      />
                    </div>
                    <select className="h-14 rounded-2xl border border-white/5 bg-white/[0.02] px-6 text-xs font-black uppercase tracking-widest text-slate-500 outline-none hover:bg-white/[0.04]" value={tagStatusFilter} onChange={(e) => setTagStatusFilter(e.target.value as any)}>
                      <option value="all" className="bg-slate-900">Todas</option>
                      <option value="active" className="bg-slate-900">Ativas</option>
                      <option value="inactive" className="bg-slate-900">Inativas</option>
                    </select>
                  </div>

                  <div className="grid gap-3 max-h-[600px] overflow-auto custom-scrollbar pr-2">
                    {filteredTags.map((tag) => (
                      <div key={tag.id} className="group relative glass-card rounded-3xl border-white/5 bg-black/20 p-5 flex items-center justify-between transition-all hover:bg-black/30">
                        <div className="flex items-center gap-5">
                          <div className="h-12 w-12 rounded-2xl bg-white/5 flex items-center justify-center text-xl font-black" style={{ color: tag.color }}>
                            {tag.name.charAt(0)}
                          </div>
                          <div className="space-y-1">
                            <TagPill name={tag.name} color={tag.color} muted={!tag.active} />
                            <div className="flex gap-3 text-[9px] font-black text-slate-600 uppercase tracking-widest">
                              <span>{tagTypeLabel(tag.type)}</span>
                              <span>{tag.contactCount} Registros</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            className="h-10 w-10 rounded-xl bg-white/5 hover:bg-cmm-blue/20 hover:text-cmm-blue"
                            onClick={() => {
                              setEditingTagId(tag.id);
                              setTagDraft({ ...tag });
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {filteredTags.length === 0 && (
                      <div className="py-20 text-center space-y-4">
                        <div className="h-16 w-16 rounded-3xl bg-white/5 flex items-center justify-center mx-auto opacity-20">
                          <Tags className="h-8 w-8 text-white" />
                        </div>
                        <p className="text-sm font-bold text-slate-600 uppercase tracking-widest">Nenhuma tag correspondente</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "advanced" && (
            <div className="space-y-8 animate-in zoom-in-95 duration-500">
              <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-10 space-y-10">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <h2 className="font-display text-3xl font-bold text-white tracking-tight">Núcleo do Sistema</h2>
                    <p className="text-sm font-medium text-slate-400">Ajustes de baixo nível para infraestrutura e storage.</p>
                  </div>
                  <Badge tone="danger" className="rounded-full px-4 py-1 text-[9px] font-black uppercase tracking-widest animate-pulse">
                    Zona Crítica
                  </Badge>
                </div>

                <div className="grid gap-10">
                  {groupedSettings.filter(g => ["automation", "storage"].includes(g.id)).map(group => (
                    <div key={group.id} className="space-y-6">
                      <div className="flex items-center gap-3 px-2">
                        <group.icon className="h-4 w-4 text-cmm-orange" />
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">{group.title}</h3>
                      </div>
                      <div className="grid gap-4">
                        {group.items.map(item => (
                          <div key={item.key} className="group glass-card rounded-3xl border-white/5 bg-black/20 p-6 flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{humanizeSettingKey(item.key)}</label>
                                <p className="text-[9px] font-bold text-slate-700 font-mono">{item.key}</p>
                              </div>
                              <Badge tone={settingsSourceMap.get(item.key) === "database" ? "info" : "default"} className="scale-75 origin-right">
                                {settingsSourceMap.get(item.key) === "database" ? "OVERRIDE" : "DEFAULT"}
                              </Badge>
                            </div>
                            {item.value.length > 50 ? (
                              <Textarea className="min-h-[80px] rounded-xl border-white/5 bg-white/[0.02] px-4 font-bold text-white tracking-tight text-xs focus:border-cmm-orange/30" value={item.value} onChange={(e) => setDraft({ ...merged, [item.key]: e.target.value })} />
                            ) : (
                              <Input className="h-12 rounded-xl border-white/5 bg-white/[0.02] px-4 font-bold text-white tracking-tight text-xs focus:border-cmm-orange/30" value={item.value} onChange={(e) => setDraft({ ...merged, [item.key]: e.target.value })} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-4 border-t border-white/5">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    className="h-12 rounded-2xl bg-cmm-orange text-white px-10 text-xs font-black uppercase tracking-widest shadow-xl shadow-orange-500/20"
                  >
                    {saveMutation.isPending ? "SALVANDO..." : "SALVAR NÚCLEO"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
