import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, Cog, HardDriveUpload, Pencil, Plus, Save, Search,
  ServerCog, Shield, Tags, Trash2, Workflow, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { TagPill } from "@/components/tags/tag-pill";
import { apiFetch, toJsonBody } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// ----- Constants -----

const TAG_COLORS = [
  { label: "Verde", value: "#3ddc97" },
  { label: "Azul", value: "#38bdf8" },
  { label: "Laranja", value: "#f59e0b" },
  { label: "Rosa", value: "#fb7185" },
  { label: "Indigo", value: "#818cf8" },
  { label: "Amber", value: "#fbbf24" },
  { label: "Ciano", value: "#22d3ee" },
  { label: "Cinza", value: "#94a3b8" }
] as const;

const TAG_TYPES = [
  { value: "manual", label: "Manual" },
  { value: "canal", label: "Canal" },
  { value: "automacao", label: "Automacao" },
  { value: "sistema", label: "Sistema" }
] as const;

type TagDraft = { name: string; color: string; type: string; active: boolean };
type TagRecord = { id: string; name: string; color: string; type: string; active: boolean; contactCount: number };

const emptyTag: TagDraft = { name: "", color: TAG_COLORS[0].value, type: "manual", active: true };

const SECTIONS = [
  { id: "general", label: "Geral", icon: Cog, description: "Identidade local e preferencias", match: (k: string) => ["default_", "app_", "timezone", "host", "port", "debug", "log_"].some((t) => k.includes(t)) },
  { id: "runtime", label: "Worker & Canais", icon: ServerCog, description: "Chromium, sync, watchdog", match: (k: string) => ["chromium", "wa_", "ig_", "worker_", "watchdog"].some((t) => k.includes(t)) },
  { id: "automation", label: "Automacao", icon: Workflow, description: "Scheduler, campanhas, regras", match: (k: string) => ["scheduler", "campaign", "automation", "post_procedure"].some((t) => k.includes(t)) },
  { id: "storage", label: "Storage", icon: HardDriveUpload, description: "Uploads, midia, diretorios", match: (k: string) => ["upload", "media", "temp", "database", "screenshot", "profile_dir"].some((t) => k.includes(t)) },
  { id: "tags", label: "Tags", icon: Tags, description: "Taxonomia de contatos" },
] as const;

function humanize(key: string) {
  return key.split(/[_.-]/g).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function resolveSection(key: string) {
  const k = key.toLowerCase();
  return SECTIONS.find((s) => s.id !== "tags" && "match" in s && s.match(k))?.id ?? "general";
}

// ----- Component -----

export function SettingsPage() {
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useState("general");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState<TagDraft>(emptyTag);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Array<{ key: string; value: unknown; source?: "env" | "database" }>>("/settings")
  });
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  const merged = useMemo(() => {
    return (settingsQuery.data ?? []).reduce((acc, item) => ({
      ...acc, [item.key]: draft[item.key] ?? JSON.stringify(item.value)
    }), {} as Record<string, string>);
  }, [settingsQuery.data, draft]);

  const settingsBySection = useMemo(() => {
    const groups: Record<string, Array<{ key: string; value: string; source?: string }>> = {};
    for (const item of settingsQuery.data ?? []) {
      const section = resolveSection(item.key);
      if (!groups[section]) groups[section] = [];
      groups[section].push({ key: item.key, value: merged[item.key] ?? "", source: item.source });
    }
    return groups;
  }, [settingsQuery.data, merged]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) => apiFetch("/settings", { method: "PATCH", body: toJsonBody(data) }),
    onSuccess: async () => {
      toast("success", "Configuracoes salvas.");
      setDraft({});
      await qc.invalidateQueries({ queryKey: ["settings"] });
    }
  });

  const tagMutation = useMutation({
    mutationFn: (data: { id?: string; payload: TagDraft }) =>
      data.id
        ? apiFetch(`/tags/${data.id}`, { method: "PATCH", body: toJsonBody(data.payload) })
        : apiFetch("/tags", { method: "POST", body: toJsonBody(data.payload) }),
    onSuccess: async () => {
      toast("success", editingTagId ? "Tag atualizada." : "Tag criada.");
      setTagDraft(emptyTag);
      setEditingTagId(null);
      await qc.invalidateQueries({ queryKey: ["tags"] });
    }
  });

  const hasPendingChanges = Object.keys(draft).length > 0;
  const filteredTags = (tagsQuery.data ?? []).filter((t) =>
    !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const currentSettings = settingsBySection[activeSection] ?? [];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-n-text">Configuracoes</h1>
          <p className="text-caption text-n-text-muted mt-0.5">Gerencie preferencias, worker, automacao e tags</p>
        </div>
        {hasPendingChanges && (
          <Button onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}
            className="bg-n-blue text-white text-label">
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? "Salvando..." : "Salvar alteracoes"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[200px_1fr]">
        {/* Sidebar sections */}
        <nav className="space-y-0.5">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button key={section.id} onClick={() => setActiveSection(section.id)}
                className={cn("w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-fast",
                  isActive ? "bg-n-surface-2 text-n-text" : "text-n-text-muted hover:bg-n-surface-2/50 hover:text-n-text")}>
                <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-n-blue" : "text-n-text-dim")} />
                <div className="min-w-0">
                  <p className="text-body font-medium truncate">{section.label}</p>
                  <p className="text-micro text-n-text-dim truncate">{section.description}</p>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="rounded-xl border border-n-border bg-n-surface overflow-hidden">
          {activeSection === "tags" ? (
            /* Tags section */
            <div className="grid xl:grid-cols-[1fr_280px] divide-x divide-n-border">
              {/* Tag list */}
              <div>
                <div className="flex items-center gap-2 border-b border-n-border px-4 py-2.5">
                  <Search className="h-3.5 w-3.5 text-n-text-dim" />
                  <input className="flex-1 bg-transparent text-body text-n-text outline-none placeholder:text-n-text-dim"
                    placeholder="Buscar tag..." value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} />
                  <span className="text-micro text-n-text-dim">{filteredTags.length}</span>
                </div>
                <div className="max-h-[calc(100vh-20rem)] overflow-y-auto custom-scrollbar divide-y divide-n-border-subtle">
                  {filteredTags.map((tag) => (
                    <div key={tag.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-n-surface-2/50 transition-fast">
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-body font-medium text-n-text truncate">{tag.name}</p>
                        <p className="text-micro text-n-text-dim">{TAG_TYPES.find((t) => t.value === tag.type)?.label} | {tag.contactCount} contatos</p>
                      </div>
                      {!tag.active && <Badge tone="default" className="text-micro">Inativa</Badge>}
                      <button onClick={() => { setEditingTagId(tag.id); setTagDraft({ name: tag.name, color: tag.color, type: tag.type, active: tag.active }); }}
                        className="text-n-text-dim hover:text-n-text transition-fast"><Pencil className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  {filteredTags.length === 0 && <div className="py-8 text-center text-caption text-n-text-dim">Nenhuma tag encontrada</div>}
                </div>
              </div>

              {/* Tag editor */}
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-label text-n-text">{editingTagId ? "Editar tag" : "Nova tag"}</h3>
                  {editingTagId && (
                    <button onClick={() => { setEditingTagId(null); setTagDraft(emptyTag); }} className="text-n-text-dim hover:text-n-text">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-micro text-n-text-dim mb-1">Nome</p>
                    <Input className="h-8 text-body" value={tagDraft.name} onChange={(e) => setTagDraft({ ...tagDraft, name: e.target.value })} placeholder="ex: Lead Quente" />
                  </div>

                  <div>
                    <p className="text-micro text-n-text-dim mb-1">Cor</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TAG_COLORS.map((c) => (
                        <button key={c.value} onClick={() => setTagDraft({ ...tagDraft, color: c.value })}
                          className={cn("h-6 w-6 rounded-md transition-fast", tagDraft.color === c.value && "ring-2 ring-white ring-offset-1 ring-offset-n-surface")}
                          style={{ backgroundColor: c.value }} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-micro text-n-text-dim mb-1">Tipo</p>
                    <div className="flex flex-wrap gap-1">
                      {TAG_TYPES.map((t) => (
                        <button key={t.value} onClick={() => setTagDraft({ ...tagDraft, type: t.value })}
                          className={cn("rounded-md px-2 py-1 text-micro transition-fast",
                            tagDraft.type === t.value ? "bg-n-blue/10 text-n-blue border border-n-blue/20" : "bg-n-surface-2 text-n-text-muted border border-transparent")}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-n-surface-2 px-3 py-2">
                    <span className="text-caption text-n-text-muted">Ativa</span>
                    <Switch checked={tagDraft.active} onCheckedChange={(v) => setTagDraft({ ...tagDraft, active: v })} />
                  </div>

                  {tagDraft.name && (
                    <div className="rounded-lg bg-n-surface-2 p-3">
                      <p className="text-micro text-n-text-dim mb-1.5">Preview</p>
                      <TagPill name={tagDraft.name} color={tagDraft.color} />
                    </div>
                  )}

                  <Button className="w-full bg-n-blue text-white text-label" disabled={!tagDraft.name.trim() || tagMutation.isPending}
                    onClick={() => tagMutation.mutate({ id: editingTagId ?? undefined, payload: tagDraft })}>
                    {tagMutation.isPending ? "Salvando..." : editingTagId ? "Atualizar tag" : "Criar tag"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Settings section */
            <div>
              <div className="border-b border-n-border px-4 py-2.5">
                <h3 className="text-label text-n-text">{SECTIONS.find((s) => s.id === activeSection)?.label}</h3>
                <p className="text-micro text-n-text-dim">{SECTIONS.find((s) => s.id === activeSection)?.description}</p>
              </div>
              <div className="divide-y divide-n-border-subtle max-h-[calc(100vh-18rem)] overflow-y-auto custom-scrollbar">
                {currentSettings.map((setting) => {
                  const isLong = String(setting.value).length > 60;
                  return (
                    <div key={setting.key} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-n-surface-2/30 transition-fast">
                      <div className="flex items-center gap-2">
                        <span className="text-body font-medium text-n-text">{humanize(setting.key)}</span>
                        {setting.source && (
                          <span className={cn("text-micro px-1.5 py-0.5 rounded",
                            setting.source === "env" ? "bg-n-blue/10 text-n-blue" : "bg-n-amber/10 text-n-amber")}>{setting.source}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-micro text-n-text-dim">{setting.key}</span>
                      </div>
                      {isLong ? (
                        <Textarea className="mt-1 min-h-[60px] font-mono text-caption bg-n-bg border-n-border"
                          value={merged[setting.key] ?? ""} onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })} />
                      ) : (
                        <Input className="mt-1 h-8 font-mono text-caption bg-n-bg border-n-border"
                          value={merged[setting.key] ?? ""} onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })} />
                      )}
                    </div>
                  );
                })}
                {currentSettings.length === 0 && (
                  <div className="py-12 text-center text-caption text-n-text-dim">Nenhuma configuracao nesta secao</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
