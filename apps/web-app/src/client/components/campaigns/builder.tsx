import { type ChangeEvent, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  FileText,
  Filter,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  Instagram,
  Link2,
  MessageSquareText,
  MessageCircleMore,
  Mic,
  Plus,
  RefreshCw,
  Settings2,
  Tag,
  Target,
  Timer,
  Trash2,
  Upload,
  Video,
  Workflow,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import {
  campaignStatusOptions,
  campaignStepOptions,
  conditionTypeOptions,
  conditionActionOptions,
  emptyCampaignStep,
  normalizeCampaignStepForType,
  estimateCampaignDuration,
  formatDuration,
  type CampaignDraft,
  type CampaignStepDraft,
  type ConditionType,
  type ConditionAction
} from "@/lib/campaign-utils";
import { cn } from "@/lib/utils";

type TagRecord = {
  id: string;
  name: string;
  color: string;
};

type AttendantRecord = {
  id: string;
  name: string;
  status: string;
  voiceSamples: string[];
};

const channelOptions = [
  {
    value: "whatsapp" as const,
    label: "WhatsApp",
    icon: MessageCircleMore,
    color: "text-emerald-400"
  },
  {
    value: "instagram" as const,
    label: "Instagram assistido",
    icon: Instagram,
    color: "text-cmm-orange"
  }
] as const;

const stepChannelOptions = [
  { value: "any" as const, label: "Todos os canais", icon: Globe2 },
  { value: "whatsapp" as const, label: "So WhatsApp", icon: MessageCircleMore },
  { value: "instagram" as const, label: "So Instagram", icon: Instagram }
] as const;

const stepIconMap = {
  text: MessageSquareText,
  audio: Mic,
  image: ImageIcon,
  video: Video,
  document: FileText,
  link: Link2,
  wait: Clock3,
  ADD_TAG: Tag,
  REMOVE_TAG: Tag
} as const;

const stepColorMap = {
  text: "text-blue-400",
  audio: "text-cmm-purple",
  image: "text-pink-400",
  video: "text-red-400",
  document: "text-amber-400",
  link: "text-cyan-400",
  wait: "text-cmm-orange",
  ADD_TAG: "text-cmm-emerald",
  REMOVE_TAG: "text-slate-400"
} as const;

const stepShortLabelMap: Record<CampaignStepDraft["type"], string> = {
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

function stepSortableId(step: CampaignStepDraft, index: number) {
  return step.id ?? `step-${index}`;
}

function isTagStep(step: CampaignStepDraft) {
  return step.type === "ADD_TAG" || step.type === "REMOVE_TAG";
}

function isMediaStep(step: CampaignStepDraft) {
  return step.type === "audio" || step.type === "image" || step.type === "video" || step.type === "document";
}

function mediaAcceptForType(type: CampaignStepDraft["type"]) {
  switch (type) {
    case "audio":
      return "audio/*";
    case "image":
      return "image/*";
    case "video":
      return "video/*";
    case "document":
      return ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";
    default:
      return "audio/*,image/*,video/*";
  }
}

function fileNameFromPath(path?: string | null) {
  if (!path) return "";
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function SectionHeading({ title, icon: Icon }: { title: string; icon?: LucideIcon }) {
  return (
    <div className="flex items-center gap-2.5">
      {Icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-n-border bg-white/5 shadow-inner">
          <Icon className="h-4.5 w-4.5 text-cmm-blue" />
        </div>
      )}
      <div className="font-display text-base font-bold text-white tracking-tight">{title}</div>
    </div>
  );
}

function StepTypeSelector({
  value,
  onChange
}: {
  value: CampaignStepDraft["type"];
  onChange: (type: CampaignStepDraft["type"]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {campaignStepOptions.map((option) => {
        const Icon = stepIconMap[option.value as keyof typeof stepIconMap];
        const active = option.value === value;
        const colorClass = stepColorMap[option.value as keyof typeof stepColorMap];

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value as CampaignStepDraft["type"])}
            className={cn(
              "flex h-10 min-w-[80px] items-center gap-2 rounded-xl border px-3 text-left transition-all duration-300",
              active
                ? "bg-white/10 border-white/20 shadow-xl"
                : "bg-n-surface border-transparent hover:bg-white/5"
            )}
            title={option.description}
          >
            <div className={cn("rounded-full border border-n-border bg-white/5 p-1.5", active ? colorClass : "text-slate-500")}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <span className={cn("text-[10px] font-bold tracking-tight", active ? "text-white" : "text-slate-400")}>
              {stepShortLabelMap[option.value as CampaignStepDraft["type"]]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConditionEditor({
  step,
  stepCount,
  tagOptions,
  onChange
}: {
  step: CampaignStepDraft;
  stepCount: number;
  tagOptions: TagRecord[];
  onChange: (next: CampaignStepDraft) => void;
}) {
  const hasCondition = Boolean(step.conditionType);
  const [open, setOpen] = useState(hasCondition);

  if (!open && !hasCondition) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-dashed border-n-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-all hover:border-cmm-purple/30 hover:text-cmm-purple"
      >
        <Filter className="h-3 w-3" />
        Adicionar condicao
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-cmm-purple/20 bg-cmm-purple/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-cmm-purple">Condicao</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onChange({
              ...step,
              conditionType: null,
              conditionValue: null,
              conditionAction: null,
              conditionJumpTo: null
            });
          }}
          className="text-[10px] font-bold text-red-400 hover:text-red-300"
        >
          Remover
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Se...</p>
          <select
            className="h-9 w-full rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionType ?? ""}
            onChange={(e) =>
              onChange({
                ...step,
                conditionType: (e.target.value || null) as ConditionType,
                conditionValue: null
              })
            }
          >
            <option value="" className="bg-slate-900">Selecione...</option>
            {conditionTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-slate-900">{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Entao...</p>
          <select
            className="h-9 w-full rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionAction ?? ""}
            onChange={(e) =>
              onChange({
                ...step,
                conditionAction: (e.target.value || null) as ConditionAction
              })
            }
          >
            <option value="" className="bg-slate-900">Selecione...</option>
            {conditionActionOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-slate-900">{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {step.conditionType === "has_tag" && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Tag</p>
          <select
            className="h-9 w-full rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionValue ?? ""}
            onChange={(e) => onChange({ ...step, conditionValue: e.target.value || null })}
          >
            <option value="" className="bg-slate-900">Selecione tag...</option>
            {tagOptions.map((t) => (
              <option key={t.id} value={t.name} className="bg-slate-900">{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {step.conditionType === "channel_is" && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Canal</p>
          <select
            className="h-9 w-full rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionValue ?? ""}
            onChange={(e) => onChange({ ...step, conditionValue: e.target.value || null })}
          >
            <option value="" className="bg-slate-900">Selecione...</option>
            <option value="whatsapp" className="bg-slate-900">WhatsApp</option>
            <option value="instagram" className="bg-slate-900">Instagram</option>
          </select>
        </div>
      )}

      {step.conditionAction === "jump_to_step" && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Ir para etapa</p>
          <select
            className="h-9 w-full rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
            value={step.conditionJumpTo ?? ""}
            onChange={(e) => onChange({ ...step, conditionJumpTo: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="" className="bg-slate-900">Selecione...</option>
            {Array.from({ length: stepCount }, (_, i) => (
              <option key={i} value={i} className="bg-slate-900">Etapa {i + 1}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function MediaDropzone({
  stepType,
  uploading,
  error,
  onFile,
  onInputChange
}: {
  stepType: CampaignStepDraft["type"];
  uploading: boolean;
  error: string | null;
  onFile: (file?: File | null) => void;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const formatHint = stepType === "audio" ? "Formatos .mp3, .ogg"
    : stepType === "document" ? "PDF, Word, Excel, etc."
    : "Formatos .jpg, .png, .mp4";

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); onFile(event.dataTransfer.files?.[0]); }}
        className={cn(
          "flex min-h-[8rem] cursor-pointer flex-col justify-between rounded-[1.25rem] border border-dashed p-4 transition-all duration-300",
          dragging ? "border-cmm-blue bg-cmm-blue/5" : "border-n-border bg-n-surface hover:bg-n-surface-2"
        )}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 shadow-inner">
            <Upload className={cn("h-5 w-5 transition-colors", dragging ? "text-cmm-blue" : "text-slate-500")} />
          </div>
          <p className="text-xs font-bold text-slate-300">
            {uploading ? "Enviando arquivo..." : "Arraste ou selecione"}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{formatHint}</p>
        </div>
        <input id={inputId} className="hidden" type="file" accept={mediaAcceptForType(stepType)} disabled={uploading} onChange={onInputChange} />
      </label>
      {error ? <div className="text-xs font-bold text-red-400 text-center">{error}</div> : null}
    </div>
  );
}

function SortableStep({
  campaignId,
  step,
  index,
  isLast,
  stepCount,
  tagOptions,
  attendants,
  onChange,
  onDuplicate,
  onRemove
}: {
  campaignId?: string;
  step: CampaignStepDraft;
  index: number;
  isLast: boolean;
  stepCount: number;
  tagOptions: TagRecord[];
  attendants: AttendantRecord[];
  onChange: (next: CampaignStepDraft) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const sortableId = stepSortableId(step, index);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: sortableId });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showCondition, setShowCondition] = useState(Boolean(step.conditionType));
  const tagListId = useId();
  const Icon = stepIconMap[step.type as keyof typeof stepIconMap];
  const colorClass = stepColorMap[step.type as keyof typeof stepColorMap];

  const contentFieldLabel =
    step.type === "text" ? "Mensagem"
    : step.type === "link" ? "URL + Texto"
    : step.type === "audio" ? "Texto do audio"
    : step.type === "image" ? "Legenda da imagem"
    : step.type === "video" ? "Legenda do video"
    : step.type === "document" ? "Descricao do documento"
    : "Conteudo";

  const contentPlaceholder =
    step.type === "text" ? "Digite a mensagem... Use *negrito*, _italico_, {{nome}} para variaveis"
    : step.type === "link" ? "Cole a URL e adicione uma descricao"
    : step.type === "audio" ? "Texto opcional para acompanhar o audio"
    : step.type === "document" ? "Descricao opcional do documento"
    : "Legenda opcional";

  const hasSidePanel = step.type === "wait" || isMediaStep(step);

  async function uploadMedia(file?: File | null) {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("scope", "campaign");
    if (campaignId) formData.append("campaignId", campaignId);

    setUploading(true);
    setUploadError(null);
    try {
      const media = await apiFetch<Record<string, unknown>>("/uploads/media", { method: "POST", body: formData });
      onChange({ ...step, mediaPath: String(media.storage_path ?? media.storagePath ?? "") });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Falha ao enviar midia.");
    } finally {
      setUploading(false);
    }
  }

  function handleMediaUpload(event: ChangeEvent<HTMLInputElement>) {
    void uploadMedia(event.target.files?.[0]);
    event.target.value = "";
  }

  const mediaIcon = step.type === "document" ? FileText
    : step.type === "video" ? Video
    : step.type === "image" ? ImageIcon
    : Mic;

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="relative pl-9">
      {!isLast && <div className="absolute left-[1rem] top-10 h-[calc(100%-0.75rem)] w-px bg-white/[0.06]" />}

      <div className={cn(
        "absolute left-0 top-2 flex h-8 w-8 items-center justify-center rounded-xl border border-n-border bg-[#16161a] text-white shadow-xl"
      )}>
        <span className="text-[10px] font-bold tracking-widest">{String(index + 1).padStart(2, '0')}</span>
      </div>

      <div className="glass-card mb-2.5 overflow-hidden rounded-[1.4rem] border-n-border bg-n-surface p-0 shadow-sm transition-all hover:bg-n-surface-2">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-n-border bg-n-surface px-3.5 py-2.5">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-xl p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-white" {...attributes} {...listeners}>
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className={cn("rounded-full bg-white/5 p-1.5", colorClass)}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div>
                <h4 className="text-[13px] font-bold text-white tracking-tight">{campaignStepOptions.find((opt) => opt.value === step.type)?.label}</h4>
              </div>
            </div>
            {step.conditionType && (
              <span className="flex items-center gap-1 rounded-lg bg-cmm-purple/15 px-2 py-0.5 text-[10px] font-bold text-cmm-purple">
                <Filter className="h-2.5 w-2.5" />
                Condicional
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} className="text-slate-500 hover:text-white">
              <Copy className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="text-slate-500 hover:text-red-400">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3 p-3.5">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <StepTypeSelector value={step.type} onChange={(type) => onChange(normalizeCampaignStepForType(step, type))} />
            <div className="flex items-center gap-2 rounded-full border border-n-border bg-black/20 px-2 py-1.5">
              {stepChannelOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...step, channelScope: opt.value })}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border transition-all",
                    step.channelScope === opt.value ? "border-cmm-blue bg-cmm-blue/10 text-cmm-blue" : "border-transparent bg-white/5 text-slate-500 hover:bg-white/10"
                  )}
                  title={opt.label}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>

          <div className={cn("grid gap-3", hasSidePanel ? "lg:grid-cols-[minmax(0,1fr)_220px]" : "grid-cols-1")}>
            <div className="space-y-3">
              {step.type === "wait" ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Minutos de espera</p>
                  <Input
                    type="number"
                    className="h-10 rounded-xl border-n-border bg-black/20 font-semibold"
                    value={step.waitMinutes ?? 5}
                    onChange={(e) => onChange({ ...step, waitMinutes: Number(e.target.value) })}
                  />
                </div>
              ) : isTagStep(step) ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tag</p>
                  <Input
                    list={tagListId}
                    className="h-10 rounded-xl border-n-border bg-black/20 font-semibold"
                    value={step.tagName ?? ""}
                    onChange={(e) => onChange({ ...step, tagName: e.target.value })}
                    placeholder="ex: Lead Quente"
                  />
                  <datalist id={tagListId}>
                    {tagOptions.map((t) => <option key={t.id} value={t.name} />)}
                  </datalist>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{contentFieldLabel}</p>
                  <Textarea
                    className="min-h-[80px] rounded-2xl border-n-border bg-n-surface-2 px-3.5 py-3 text-sm leading-relaxed"
                    value={step.content}
                    onChange={(e) => onChange({ ...step, content: e.target.value, caption: step.type === "text" || step.type === "link" ? step.caption : e.target.value })}
                    placeholder={contentPlaceholder}
                  />
                  {(step.type === "text" || step.type === "link") && (
                    <p className="text-[9px] text-slate-600">
                      Variaveis: {"{{nome}} {{primeiro_nome}} {{telefone}} {{email}} {{instagram}}"}
                    </p>
                  )}
                </div>
              )}

              {/* Condition editor */}
              <ConditionEditor
                step={step}
                stepCount={stepCount}
                tagOptions={tagOptions}
                onChange={onChange}
              />
            </div>

            {hasSidePanel && (
              <div className="flex flex-col gap-3">
                {!isTagStep(step) && step.type !== "wait" && isMediaStep(step) && (
                  <div className="flex-1">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Midia</p>
                    {step.mediaPath ? (
                      <div className="glass-card relative rounded-[1.25rem] border-n-border bg-cmm-blue/5 p-3.5 text-center">
                        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 shadow-inner">
                          {(() => { const MI = mediaIcon; return <MI className="h-6 w-6 text-cmm-blue" />; })()}
                        </div>
                        <p className="text-xs font-bold text-white truncate">{fileNameFromPath(step.mediaPath)}</p>
                        <button
                          onClick={() => onChange({ ...step, mediaPath: null })}
                          className="mt-3 text-[10px] font-bold uppercase tracking-widest text-red-400 transition-colors hover:text-red-300"
                        >
                          Remover midia
                        </button>
                      </div>
                    ) : (
                      <MediaDropzone stepType={step.type} uploading={uploading} error={uploadError} onFile={uploadMedia} onInputChange={handleMediaUpload} />
                    )}
                  </div>
                )}
                {step.type === "audio" && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Voz</p>
                    <select
                      className="h-10 w-full rounded-xl border border-n-border bg-black/20 px-3 text-sm text-white outline-none focus:border-cmm-purple/40"
                      value={step.attendantId ?? ""}
                      onChange={(e) => onChange({ ...step, attendantId: e.target.value || null })}
                    >
                      <option value="">Usar voz original</option>
                      {attendants
                        .filter((a) => a.status === "active")
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            Atendente: {a.name}
                          </option>
                        ))}
                    </select>
                    {step.attendantId && (
                      <p className="text-[9px] text-cmm-purple">Audio sera convertido para a voz do atendente.</p>
                    )}
                  </div>
                )}
                {step.type === "wait" && (
                  <div className="flex h-full min-h-[96px] flex-col items-center justify-center rounded-[1.25rem] border border-n-border bg-n-surface-2 p-3 text-center">
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

export function CampaignBuilder({ value, onChange }: { value: CampaignDraft; onChange: (next: CampaignDraft) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const sortableIds = useMemo(() => value.steps.map((step, index) => stepSortableId(step, index)), [value.steps]);
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  const attendantsQuery = useQuery({
    queryKey: ["attendants"],
    queryFn: () => apiFetch<AttendantRecord[]>("/attendants")
  });

  const duration = estimateCampaignDuration(value.steps);
  const stepCount = value.steps.length;
  const conditionCount = value.steps.filter((s) => s.conditionType).length;

  function updateChannels(channel: "whatsapp" | "instagram") {
    const hasChannel = value.eligibleChannels.includes(channel);
    const nextChannels: Array<"whatsapp" | "instagram"> = hasChannel
      ? value.eligibleChannels.filter((item): item is "whatsapp" | "instagram" => item !== channel)
      : [...value.eligibleChannels, channel];

    const normalizedChannels: Array<"whatsapp" | "instagram"> = nextChannels.length > 0 ? nextChannels : ["whatsapp"];
    const nextSteps: CampaignStepDraft[] = value.steps.map((step) => {
      if (step.channelScope !== "any" && !normalizedChannels.includes(step.channelScope)) {
        return { ...step, channelScope: normalizedChannels[0] ?? "whatsapp" };
      }
      return step;
    });

    onChange({ ...value, eligibleChannels: normalizedChannels, steps: nextSteps });
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Config base */}
      <div className="glass-card rounded-[2rem] border-n-border bg-n-surface p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-4">
            <SectionHeading icon={Target} title="Configuracao base" />
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Nome da campanha</p>
                <Input
                  className="h-11 rounded-2xl border-n-border bg-n-surface-2 text-sm font-semibold focus:border-cmm-blue/30"
                  value={value.name}
                  onChange={(e) => onChange({ ...value, name: e.target.value })}
                  placeholder="ex: Follow-up Vendas"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</p>
                <select
                  className="h-11 w-full rounded-2xl border border-n-border bg-n-surface-2 px-4 text-sm font-semibold text-white outline-none focus:border-cmm-blue/30"
                  value={value.status}
                  onChange={(e) => onChange({ ...value, status: e.target.value })}
                >
                  {campaignStatusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-slate-900 text-white">{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Descricao</p>
              <Textarea
                className="min-h-[84px] rounded-2xl border-n-border bg-n-surface-2 px-4 py-3 text-sm focus:border-cmm-blue/30"
                value={value.description}
                onChange={(e) => onChange({ ...value, description: e.target.value })}
                placeholder="Resumo curto da campanha"
              />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Canais</p>
            <div className="flex items-center gap-2.5">
              {channelOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateChannels(opt.value)}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-full border transition-all",
                    value.eligibleChannels.includes(opt.value)
                      ? opt.value === "instagram"
                        ? "border-cmm-orange/40 bg-cmm-orange/10 text-cmm-orange"
                        : "border-cmm-emerald/40 bg-cmm-emerald/10 text-cmm-emerald"
                      : "border-n-border bg-n-surface text-slate-600 hover:bg-white/[0.05]"
                  )}
                  title={opt.label}
                >
                  <opt.icon className="h-5 w-5" />
                </button>
              ))}
            </div>

            {/* Evergreen toggle */}
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => onChange({ ...value, isEvergreen: !value.isEvergreen })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all",
                  value.isEvergreen
                    ? "border-cmm-emerald/30 bg-cmm-emerald/10"
                    : "border-n-border bg-n-surface hover:bg-n-surface-2"
                )}
              >
                <InfinityIcon className={cn("h-4 w-4", value.isEvergreen ? "text-cmm-emerald" : "text-slate-500")} />
                <div>
                  <p className={cn("text-[11px] font-bold", value.isEvergreen ? "text-cmm-emerald" : "text-slate-400")}>Evergreen</p>
                  <p className="text-[9px] text-slate-500">Auto-adiciona novos contatos</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Janela e cadencia */}
      <div className="glass-card rounded-[2rem] border-n-border bg-n-surface p-5">
        <SectionHeading icon={Settings2} title="Janela e cadencia" />

        <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Inicio Janela", value: value.sendWindowStart, field: "sendWindowStart", placeholder: "08:00" },
            { label: "Fim Janela", value: value.sendWindowEnd, field: "sendWindowEnd", placeholder: "20:00" },
            { label: "Limite (Envios)", value: value.rateLimitCount, field: "rateLimitCount", type: "number" },
            { label: "Janela (Min)", value: value.rateLimitWindowMinutes, field: "rateLimitWindowMinutes", type: "number" }
          ].map((f) => (
            <div key={f.field} className="rounded-[1.25rem] border border-n-border bg-n-surface-2 p-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{f.label}</p>
              <Input
                type={f.type || "text"}
                className="h-10 rounded-xl border-n-border bg-black/20 font-semibold text-center"
                value={f.value}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ ...value, [f.field]: f.type === "number" ? Number(e.target.value) : e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
          {[
            { label: "Delay Minimo (s)", value: value.randomDelayMinSeconds, field: "randomDelayMinSeconds" },
            { label: "Delay Maximo (s)", value: value.randomDelayMaxSeconds, field: "randomDelayMaxSeconds" }
          ].map((f) => (
            <div key={f.field} className="flex items-center justify-between rounded-[1.25rem] border border-n-border bg-n-surface-2 p-3">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 leading-none">{f.label}</p>
                <p className="text-xs text-slate-400 font-medium">Delay aleatorio</p>
              </div>
              <Input
                type="number"
                className="h-10 w-24 rounded-xl border-n-border bg-black/20 font-semibold text-center"
                value={f.value}
                onChange={(e) => onChange({ ...value, [f.field]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Workflow builder */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeading icon={Workflow} title="Workflow builder" />
          <div className="flex items-center gap-3">
            {/* Stats badges */}
            <div className="hidden md:flex items-center gap-2">
              {duration > 0 && (
                <span className="flex items-center gap-1.5 rounded-lg border border-n-border bg-n-surface-2 px-2.5 py-1 text-[10px] font-bold text-slate-400">
                  <Timer className="h-3 w-3 text-cmm-orange" />
                  {formatDuration(duration)}
                </span>
              )}
              <span className="flex items-center gap-1.5 rounded-lg border border-n-border bg-n-surface-2 px-2.5 py-1 text-[10px] font-bold text-slate-400">
                <Workflow className="h-3 w-3 text-cmm-blue" />
                {stepCount} {stepCount === 1 ? "etapa" : "etapas"}
              </span>
              {conditionCount > 0 && (
                <span className="flex items-center gap-1.5 rounded-lg border border-cmm-purple/20 bg-cmm-purple/10 px-2.5 py-1 text-[10px] font-bold text-cmm-purple">
                  <Filter className="h-3 w-3" />
                  {conditionCount} {conditionCount === 1 ? "condicao" : "condicoes"}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => onChange({ ...value, steps: [...value.steps, emptyCampaignStep()] })}
              className="flex h-10 items-center gap-2 rounded-2xl bg-gradient-to-r from-cmm-blue to-indigo-600 px-4 text-sm font-bold text-white shadow-xl shadow-blue-500/20 transition-transform hover:scale-105 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Nova etapa
            </button>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => {
          if (!e.over || e.active.id === e.over.id) return;
          const oldIdx = sortableIds.indexOf(String(e.active.id));
          const newIdx = sortableIds.indexOf(String(e.over.id));
          onChange({ ...value, steps: arrayMove(value.steps, oldIdx, newIdx) });
        }}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {value.steps.map((step, index) => (
                <SortableStep
                  key={stepSortableId(step, index)}
                  campaignId={value.id}
                  step={step}
                  index={index}
                  isLast={index === value.steps.length - 1}
                  stepCount={stepCount}
                  tagOptions={tagsQuery.data ?? []}
                  attendants={attendantsQuery.data ?? []}
                  onChange={(next) => onChange({ ...value, steps: value.steps.map((c, i) => i === index ? next : c) })}
                  onDuplicate={() => onChange({ ...value, steps: [...value.steps.slice(0, index + 1), { ...step, id: undefined }, ...value.steps.slice(index + 1)] })}
                  onRemove={() => onChange({ ...value, steps: value.steps.length === 1 ? [emptyCampaignStep()] : value.steps.filter((_, i) => i !== index) })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
