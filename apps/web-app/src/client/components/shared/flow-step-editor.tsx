/**
 * Shared step editor component for the unified builder.
 * Used by both campaign builder and automation editor.
 *
 * This component handles:
 * - Step type selection (text, audio, image, video, document, link, wait, tag actions)
 * - Media upload dropzone
 * - Condition editor (replied, has_tag, channel_is, outside_window)
 * - Channel scope selector
 * - Template variable hints
 * - Drag handle (parent handles DnD context)
 */

import { type ChangeEvent, useId, useState } from "react";
import {
  Clock3,
  Copy,
  FileText,
  Filter,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  Instagram,
  Link2,
  MessageSquareText,
  MessageCircleMore,
  Mic,
  Tag,
  Trash2,
  Upload,
  Video,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

// ----- Shared types -----

export type FlowStepType = "text" | "audio" | "image" | "video" | "document" | "link" | "wait" | "ADD_TAG" | "REMOVE_TAG";
export type ChannelScope = "any" | "whatsapp" | "instagram";
export type ConditionType = "replied" | "has_tag" | "channel_is" | "outside_window" | null;
export type ConditionAction = "skip" | "exit" | "jump_to_step" | "wait" | null;

export type FlowStep = {
  id?: string;
  type: FlowStepType;
  content: string;
  mediaPath?: string | null;
  waitMinutes?: number | null;
  caption?: string;
  tagName?: string | null;
  channelScope: ChannelScope;
  templateId?: string | null;
  conditionType?: ConditionType;
  conditionValue?: string | null;
  conditionAction?: ConditionAction;
  conditionJumpTo?: number | null;
};

export type FlowStepEditorConfig = {
  /** Show channel scope selector */
  showChannelScope?: boolean;
  /** Show condition editor */
  showConditions?: boolean;
  /** Show template variable hints */
  showVarHints?: boolean;
  /** Available step types to show */
  availableTypes?: FlowStepType[];
  /** Upload scope for media files */
  uploadScope?: string;
  /** Upload linked entity ID */
  uploadEntityId?: string;
};

type TagRecord = { id: string; name: string; color: string };

// ----- Constants -----

const ALL_STEP_TYPES: FlowStepType[] = ["text", "audio", "image", "video", "document", "link", "wait", "ADD_TAG", "REMOVE_TAG"];

const stepIconMap: Record<FlowStepType, LucideIcon> = {
  text: MessageSquareText,
  audio: Mic,
  image: ImageIcon,
  video: Video,
  document: FileText,
  link: Link2,
  wait: Clock3,
  ADD_TAG: Tag,
  REMOVE_TAG: Tag
};

const stepColorMap: Record<FlowStepType, string> = {
  text: "text-blue-400",
  audio: "text-cmm-purple",
  image: "text-pink-400",
  video: "text-red-400",
  document: "text-amber-400",
  link: "text-cyan-400",
  wait: "text-cmm-orange",
  ADD_TAG: "text-cmm-emerald",
  REMOVE_TAG: "text-slate-400"
};

const stepLabelMap: Record<FlowStepType, string> = {
  text: "Texto",
  audio: "Audio",
  image: "Imagem",
  video: "Video",
  document: "Doc",
  link: "Link",
  wait: "Espera",
  ADD_TAG: "+Tag",
  REMOVE_TAG: "-Tag"
};

const stepFullLabelMap: Record<FlowStepType, string> = {
  text: "Texto",
  audio: "Audio",
  image: "Imagem",
  video: "Video",
  document: "Documento",
  link: "Link",
  wait: "Espera",
  ADD_TAG: "Adicionar tag",
  REMOVE_TAG: "Remover tag"
};

const conditionTypeOptions = [
  { value: "replied", label: "Se respondeu" },
  { value: "has_tag", label: "Se tem tag" },
  { value: "channel_is", label: "Se canal e" },
  { value: "outside_window", label: "Fora da janela" }
] as const;

const conditionActionOptions = [
  { value: "skip", label: "Pular step" },
  { value: "exit", label: "Sair do fluxo" },
  { value: "jump_to_step", label: "Ir para step" },
  { value: "wait", label: "Aguardar" }
] as const;

const channelScopeOptions = [
  { value: "any" as const, label: "Todos", icon: Globe2 },
  { value: "whatsapp" as const, label: "WhatsApp", icon: MessageCircleMore },
  { value: "instagram" as const, label: "Instagram", icon: Instagram }
] as const;

// ----- Helpers -----

export function isTagStep(step: FlowStep) {
  return step.type === "ADD_TAG" || step.type === "REMOVE_TAG";
}

export function isMediaStep(step: FlowStep) {
  return step.type === "audio" || step.type === "image" || step.type === "video" || step.type === "document";
}

function mediaAcceptForType(type: FlowStepType) {
  switch (type) {
    case "audio": return "audio/*";
    case "image": return "image/*";
    case "video": return "video/*";
    case "document": return ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";
    default: return "audio/*,image/*,video/*";
  }
}

function fileNameFromPath(path?: string | null) {
  if (!path) return "";
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

export function normalizeStepForType(step: FlowStep, type: FlowStepType): FlowStep {
  if (type === "wait") {
    return { ...step, type, waitMinutes: step.waitMinutes ?? 5, mediaPath: null, caption: "", tagName: null };
  }
  if (type === "ADD_TAG" || type === "REMOVE_TAG") {
    return { ...step, type, content: "", mediaPath: null, waitMinutes: null, caption: "", tagName: step.tagName ?? "" };
  }
  if (type === "link") {
    return { ...step, type, waitMinutes: null, tagName: null, mediaPath: null };
  }
  return { ...step, type, waitMinutes: null, tagName: null };
}

export function emptyFlowStep(): FlowStep {
  return {
    type: "text", content: "", mediaPath: null, waitMinutes: null, caption: "",
    tagName: null, channelScope: "any", templateId: null,
    conditionType: null, conditionValue: null, conditionAction: null, conditionJumpTo: null
  };
}

// ----- Sub-components -----

function StepTypeSelector({
  value, onChange, availableTypes
}: {
  value: FlowStepType;
  onChange: (type: FlowStepType) => void;
  availableTypes: FlowStepType[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {availableTypes.map((type) => {
        const Icon = stepIconMap[type];
        const active = type === value;
        const colorClass = stepColorMap[type];
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={cn(
              "flex h-10 min-w-[80px] items-center gap-2 rounded-xl border px-3 text-left transition-all duration-300",
              active ? "bg-white/10 border-white/20 shadow-xl" : "bg-white/[0.02] border-transparent hover:bg-white/5"
            )}
          >
            <div className={cn("rounded-full border border-white/5 bg-white/5 p-1.5", active ? colorClass : "text-slate-500")}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <span className={cn("text-[10px] font-bold tracking-tight", active ? "text-white" : "text-slate-400")}>
              {stepLabelMap[type]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConditionEditor({
  step, stepCount, tagOptions, onChange
}: {
  step: FlowStep; stepCount: number; tagOptions: TagRecord[]; onChange: (next: FlowStep) => void;
}) {
  const hasCondition = Boolean(step.conditionType);
  const [open, setOpen] = useState(hasCondition);

  if (!open && !hasCondition) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-dashed border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-all hover:border-cmm-purple/30 hover:text-cmm-purple">
        <Filter className="h-3 w-3" /> Adicionar condicao
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-cmm-purple/20 bg-cmm-purple/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-cmm-purple">Condicao</p>
        <button type="button" onClick={() => { setOpen(false); onChange({ ...step, conditionType: null, conditionValue: null, conditionAction: null, conditionJumpTo: null }); }}
          className="text-[10px] font-bold text-red-400 hover:text-red-300">Remover</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Se...</p>
          <select className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionType ?? ""} onChange={(e) => onChange({ ...step, conditionType: (e.target.value || null) as ConditionType, conditionValue: null })}>
            <option value="" className="bg-slate-900">Selecione...</option>
            {conditionTypeOptions.map((o) => <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>)}
          </select>
        </div>
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Entao...</p>
          <select className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionAction ?? ""} onChange={(e) => onChange({ ...step, conditionAction: (e.target.value || null) as ConditionAction })}>
            <option value="" className="bg-slate-900">Selecione...</option>
            {conditionActionOptions.map((o) => <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>)}
          </select>
        </div>
      </div>
      {step.conditionType === "has_tag" && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Tag</p>
          <select className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionValue ?? ""} onChange={(e) => onChange({ ...step, conditionValue: e.target.value || null })}>
            <option value="" className="bg-slate-900">Selecione tag...</option>
            {tagOptions.map((t) => <option key={t.id} value={t.name} className="bg-slate-900">{t.name}</option>)}
          </select>
        </div>
      )}
      {step.conditionType === "channel_is" && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Canal</p>
          <select className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionValue ?? ""} onChange={(e) => onChange({ ...step, conditionValue: e.target.value || null })}>
            <option value="" className="bg-slate-900">Selecione...</option>
            <option value="whatsapp" className="bg-slate-900">WhatsApp</option>
            <option value="instagram" className="bg-slate-900">Instagram</option>
          </select>
        </div>
      )}
      {step.conditionAction === "jump_to_step" && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Ir para etapa</p>
          <select className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionJumpTo ?? ""} onChange={(e) => onChange({ ...step, conditionJumpTo: e.target.value ? Number(e.target.value) : null })}>
            <option value="" className="bg-slate-900">Selecione...</option>
            {Array.from({ length: stepCount }, (_, i) => <option key={i} value={i} className="bg-slate-900">Etapa {i + 1}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function MediaDropzone({
  stepType, uploading, error, onFile, onInputChange
}: {
  stepType: FlowStepType; uploading: boolean; error: string | null;
  onFile: (file?: File | null) => void; onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const hint = stepType === "audio" ? "Formatos .mp3, .ogg" : stepType === "document" ? "PDF, Word, Excel, etc." : "Formatos .jpg, .png, .mp4";

  return (
    <div className="space-y-2">
      <label htmlFor={inputId}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
        className={cn("flex min-h-[8rem] cursor-pointer flex-col justify-between rounded-[1.25rem] border border-dashed p-4 transition-all duration-300",
          dragging ? "border-cmm-blue bg-cmm-blue/5" : "border-white/10 bg-white/[0.01] hover:bg-white/[0.03]")}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 shadow-inner">
            <Upload className={cn("h-5 w-5 transition-colors", dragging ? "text-cmm-blue" : "text-slate-500")} />
          </div>
          <p className="text-xs font-bold text-slate-300">{uploading ? "Enviando..." : "Arraste ou selecione"}</p>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{hint}</p>
        </div>
        <input id={inputId} className="hidden" type="file" accept={mediaAcceptForType(stepType)} disabled={uploading} onChange={onInputChange} />
      </label>
      {error && <div className="text-xs font-bold text-red-400 text-center">{error}</div>}
    </div>
  );
}

// ----- Main exported component -----

export function FlowStepCard({
  step, index, isLast, stepCount, tagOptions, config,
  dragHandleProps, onChange, onDuplicate, onRemove
}: {
  step: FlowStep;
  index: number;
  isLast: boolean;
  stepCount: number;
  tagOptions: TagRecord[];
  config: FlowStepEditorConfig;
  dragHandleProps?: Record<string, unknown>;
  onChange: (next: FlowStep) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const tagListId = useId();

  const availableTypes = config.availableTypes ?? ALL_STEP_TYPES;
  const Icon = stepIconMap[step.type] ?? MessageSquareText;
  const colorClass = stepColorMap[step.type] ?? "text-blue-400";
  const hasSidePanel = step.type === "wait" || isMediaStep(step);

  const contentLabel = step.type === "text" ? "Mensagem" : step.type === "link" ? "URL + Texto" : step.type === "audio" ? "Texto do audio"
    : step.type === "document" ? "Descricao" : "Legenda";
  const contentPlaceholder = step.type === "text" ? "Digite a mensagem... Use *negrito*, _italico_, {{nome}} para variaveis"
    : step.type === "link" ? "Cole a URL e adicione uma descricao" : "Conteudo opcional";

  async function uploadMedia(file?: File | null) {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("scope", config.uploadScope ?? "campaign");
    if (config.uploadEntityId) formData.append("campaignId", config.uploadEntityId);
    setUploading(true); setUploadError(null);
    try {
      const media = await apiFetch<Record<string, unknown>>("/uploads/media", { method: "POST", body: formData });
      onChange({ ...step, mediaPath: String(media.storage_path ?? media.storagePath ?? "") });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Falha ao enviar midia.");
    } finally { setUploading(false); }
  }

  function handleMediaUpload(event: ChangeEvent<HTMLInputElement>) {
    void uploadMedia(event.target.files?.[0]);
    event.target.value = "";
  }

  const MediaIcon = step.type === "document" ? FileText : step.type === "video" ? Video : step.type === "image" ? ImageIcon : Mic;

  return (
    <div className="relative pl-9">
      {!isLast && <div className="absolute left-[1rem] top-10 h-[calc(100%-0.75rem)] w-px bg-white/[0.06]" />}
      <div className="absolute left-0 top-2 flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-[#16161a] text-white shadow-xl">
        <span className="text-[10px] font-bold tracking-widest">{String(index + 1).padStart(2, '0')}</span>
      </div>

      <div className="glass-card mb-2.5 overflow-hidden rounded-[1.4rem] border-white/5 bg-white/[0.01] p-0 shadow-sm transition-all hover:bg-white/[0.03]">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/5 bg-white/[0.02] px-3.5 py-2.5">
          <div className="flex items-center gap-3">
            {dragHandleProps && (
              <button type="button" className="rounded-xl p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-white" {...dragHandleProps}>
                <GripVertical className="h-4 w-4" />
              </button>
            )}
            <div className="flex items-center gap-2.5">
              <div className={cn("rounded-full bg-white/5 p-1.5", colorClass)}><Icon className="h-3.5 w-3.5" /></div>
              <h4 className="text-[13px] font-bold text-white tracking-tight">{stepFullLabelMap[step.type]}</h4>
            </div>
            {step.conditionType && (
              <span className="flex items-center gap-1 rounded-lg bg-cmm-purple/15 px-2 py-0.5 text-[10px] font-bold text-cmm-purple">
                <Filter className="h-2.5 w-2.5" /> Condicional
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} className="text-slate-500 hover:text-white"><Copy className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="text-slate-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 p-3.5">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <StepTypeSelector value={step.type} onChange={(type) => onChange(normalizeStepForType(step, type))} availableTypes={availableTypes} />
            {config.showChannelScope !== false && (
              <div className="flex items-center gap-2 rounded-full border border-white/5 bg-black/20 px-2 py-1.5">
                {channelScopeOptions.map((opt) => (
                  <button key={opt.value} type="button" onClick={() => onChange({ ...step, channelScope: opt.value })}
                    className={cn("flex h-8 w-8 items-center justify-center rounded-full border transition-all",
                      step.channelScope === opt.value ? "border-cmm-blue bg-cmm-blue/10 text-cmm-blue" : "border-transparent bg-white/5 text-slate-500 hover:bg-white/10"
                    )} title={opt.label}>
                    <opt.icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={cn("grid gap-3", hasSidePanel ? "lg:grid-cols-[minmax(0,1fr)_220px]" : "grid-cols-1")}>
            <div className="space-y-3">
              {step.type === "wait" ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Minutos de espera</p>
                  <Input type="number" className="h-10 rounded-xl border-white/10 bg-black/20 font-semibold"
                    value={step.waitMinutes ?? 5} onChange={(e) => onChange({ ...step, waitMinutes: Number(e.target.value) })} />
                </div>
              ) : isTagStep(step) ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tag</p>
                  <Input list={tagListId} className="h-10 rounded-xl border-white/10 bg-black/20 font-semibold"
                    value={step.tagName ?? ""} onChange={(e) => onChange({ ...step, tagName: e.target.value })} placeholder="ex: Lead Quente" />
                  <datalist id={tagListId}>{tagOptions.map((t) => <option key={t.id} value={t.name} />)}</datalist>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{contentLabel}</p>
                  <Textarea className="min-h-[80px] rounded-2xl border-white/5 bg-white/[0.03] px-3.5 py-3 text-sm leading-relaxed"
                    value={step.content} onChange={(e) => onChange({ ...step, content: e.target.value })} placeholder={contentPlaceholder} />
                  {config.showVarHints !== false && (step.type === "text" || step.type === "link") && (
                    <p className="text-[9px] text-slate-600">Variaveis: {"{{nome}} {{primeiro_nome}} {{telefone}} {{email}} {{instagram}}"}</p>
                  )}
                </div>
              )}

              {config.showConditions !== false && (
                <ConditionEditor step={step} stepCount={stepCount} tagOptions={tagOptions} onChange={onChange} />
              )}
            </div>

            {hasSidePanel && (
              <div className="flex flex-col gap-3">
                {isMediaStep(step) && (
                  <div className="flex-1">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Midia</p>
                    {step.mediaPath ? (
                      <div className="glass-card relative rounded-[1.25rem] border-white/5 bg-cmm-blue/5 p-3.5 text-center">
                        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 shadow-inner">
                          <MediaIcon className="h-6 w-6 text-cmm-blue" />
                        </div>
                        <p className="text-xs font-bold text-white truncate">{fileNameFromPath(step.mediaPath)}</p>
                        <button onClick={() => onChange({ ...step, mediaPath: null })}
                          className="mt-3 text-[10px] font-bold uppercase tracking-widest text-red-400 transition-colors hover:text-red-300">Remover midia</button>
                      </div>
                    ) : (
                      <MediaDropzone stepType={step.type} uploading={uploading} error={uploadError} onFile={uploadMedia} onInputChange={handleMediaUpload} />
                    )}
                  </div>
                )}
                {step.type === "wait" && (
                  <div className="flex h-full min-h-[96px] flex-col items-center justify-center rounded-[1.25rem] border border-white/5 bg-white/[0.03] p-3 text-center">
                    <Clock3 className="mb-2 h-6 w-6 text-cmm-orange opacity-70" />
                    <p className="text-[11px] font-medium text-slate-400">Pausa entre etapas.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
