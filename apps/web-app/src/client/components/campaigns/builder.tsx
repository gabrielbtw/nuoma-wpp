import { type ChangeEvent, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Clock3,
  Copy,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  Instagram,
  MessageSquareText,
  MessageCircleMore,
  Mic,
  Plus,
  Tag,
  Trash2,
  Upload,
  Video,
  Target,
  Settings2,
  Workflow
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import {
  campaignStatusOptions,
  campaignStepOptions,
  emptyCampaignStep,
  normalizeCampaignStepForType,
  type CampaignDraft,
  type CampaignStepDraft
} from "@/lib/campaign-utils";
import { cn } from "@/lib/utils";

type TagRecord = {
  id: string;
  name: string;
  color: string;
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
  { value: "whatsapp" as const, label: "Só WhatsApp", icon: MessageCircleMore },
  { value: "instagram" as const, label: "Só Instagram", icon: Instagram }
] as const;

const stepIconMap = {
  text: MessageSquareText,
  audio: Mic,
  image: ImageIcon,
  video: Video,
  wait: Clock3,
  ADD_TAG: Tag,
  REMOVE_TAG: Tag
} as const;

const stepColorMap = {
  text: "text-blue-400",
  audio: "text-cmm-purple",
  image: "text-pink-400",
  video: "text-red-400",
  wait: "text-cmm-orange",
  ADD_TAG: "text-cmm-emerald",
  REMOVE_TAG: "text-slate-400"
} as const;

const stepShortLabelMap: Record<CampaignStepDraft["type"], string> = {
  text: "Texto",
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
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
  return step.type === "audio" || step.type === "image" || step.type === "video";
}

function mediaAcceptForType(type: CampaignStepDraft["type"]) {
  switch (type) {
    case "audio":
      return "audio/*";
    case "image":
      return "image/*";
    case "video":
      return "video/*";
    default:
      return "audio/*,image/*,video/*";
  }
}

function fileNameFromPath(path?: string | null) {
  if (!path) {
    return "";
  }

  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function SectionTitle({ title, icon: Icon }: { title: string; icon?: any }) {
  return (
    <div className="flex items-center gap-2.5">
      {Icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/5 bg-white/5 shadow-inner">
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
              "flex h-10 min-w-[88px] items-center gap-2 rounded-xl border px-3 text-left transition-all duration-300",
              active
                ? "bg-white/10 border-white/20 shadow-xl"
                : "bg-white/[0.02] border-transparent hover:bg-white/5"
            )}
            title={option.label}
          >
            <div className={cn("rounded-full border border-white/5 bg-white/5 p-1.5", active ? colorClass : "text-slate-500")}>
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

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onFile(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex min-h-[8rem] cursor-pointer flex-col justify-between rounded-[1.25rem] border border-dashed p-4 transition-all duration-300",
          dragging ? "border-cmm-blue bg-cmm-blue/5" : "border-white/10 bg-white/[0.01] hover:bg-white/[0.03]"
        )}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 shadow-inner">
            <Upload className={cn("h-5 w-5 transition-colors", dragging ? "text-cmm-blue" : "text-slate-500")} />
          </div>
          <p className="text-xs font-bold text-slate-300">
            {uploading ? "Enviando arquivo..." : "Arraste ou selecione a mídia"}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            {stepType === "audio" ? "Formatos .mp3, .ogg" : "Formatos .jpg, .png, .mp4"}
          </p>
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
  tagOptions,
  onChange,
  onDuplicate,
  onRemove
}: {
  campaignId?: string;
  step: CampaignStepDraft;
  index: number;
  isLast: boolean;
  tagOptions: TagRecord[];
  onChange: (next: CampaignStepDraft) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const sortableId = stepSortableId(step, index);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: sortableId });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const tagListId = useId();
  const Icon = stepIconMap[step.type as keyof typeof stepIconMap];
  const colorClass = stepColorMap[step.type as keyof typeof stepColorMap];
  const contentFieldLabel =
    step.type === "text"
      ? "Mensagem"
      : step.type === "audio"
        ? "Texto do áudio"
        : step.type === "image"
          ? "Legenda da imagem"
          : step.type === "video"
            ? "Legenda do vídeo"
            : "Conteúdo";
  const contentPlaceholder =
    step.type === "text"
      ? "Digite a mensagem desta etapa"
      : step.type === "audio"
        ? "Texto opcional para acompanhar o áudio"
        : step.type === "image"
          ? "Legenda opcional da imagem"
          : "Legenda opcional do vídeo";
  const hasSidePanel = step.type === "wait" || isMediaStep(step);

  async function uploadMedia(file?: File | null) {
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("scope", "campaign");
    if (campaignId) {
      formData.append("campaignId", campaignId);
    }

    setUploading(true);
    setUploadError(null);
    try {
      const media = await apiFetch<Record<string, unknown>>("/uploads/media", {
        method: "POST",
        body: formData
      });
      onChange({
        ...step,
        mediaPath: String(media.storage_path ?? media.storagePath ?? "")
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Falha ao enviar mídia.");
    } finally {
      setUploading(false);
    }
  }

  function handleMediaUpload(event: ChangeEvent<HTMLInputElement>) {
    void uploadMedia(event.target.files?.[0]);
    event.target.value = "";
  }

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="relative pl-9">
      {!isLast ? (
        <div className="absolute left-[1rem] top-10 h-[calc(100%-0.75rem)] w-px bg-white/[0.06]" />
      ) : null}

      <div className={cn(
        "absolute left-0 top-2 flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-[#16161a] text-white shadow-xl transition-all duration-500",
        "before:absolute before:inset-0 before:rounded-xl before:bg-cmm-blue/5 before:opacity-0 group-hover:before:opacity-100"
      )}>
        <span className="text-[10px] font-bold tracking-widest">{String(index + 1).padStart(2, '0')}</span>
      </div>

      <div className="glass-card mb-2.5 overflow-hidden rounded-[1.4rem] border-white/5 bg-white/[0.01] p-0 shadow-sm transition-all hover:bg-white/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/5 bg-white/[0.02] px-3.5 py-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-xl p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-white"
              {...attributes}
              {...listeners}
            >
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
            <div className="flex items-center gap-2 rounded-full border border-white/5 bg-black/20 px-2 py-1.5">
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
                    className="h-10 rounded-xl border-white/10 bg-black/20 font-semibold"
                    value={step.waitMinutes ?? 5}
                    onChange={(e) => onChange({ ...step, waitMinutes: Number(e.target.value) })}
                  />
                </div>
              ) : isTagStep(step) ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tag</p>
                  <Input
                    list={tagListId}
                    className="h-10 rounded-xl border-white/10 bg-black/20 font-semibold"
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
                    className="min-h-[80px] rounded-2xl border-white/5 bg-white/[0.03] px-3.5 py-3 text-sm leading-relaxed"
                    value={step.content}
                    onChange={(e) => onChange({ ...step, content: e.target.value, caption: step.type === "text" ? step.caption : e.target.value })}
                    placeholder={contentPlaceholder}
                  />
                </div>
              )}
            </div>

            {hasSidePanel ? <div className="flex flex-col gap-3">
              {!isTagStep(step) && step.type !== "wait" && isMediaStep(step) && (
                <div className="flex-1">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Mídia</p>
                  {step.mediaPath ? (
                    <div className="glass-card relative rounded-[1.25rem] border-white/5 bg-cmm-blue/5 p-3.5 text-center">
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 shadow-inner">
                        {step.type === "video" ? <Video className="h-6 w-6 text-cmm-blue" /> : step.type === "image" ? <ImageIcon className="h-6 w-6 text-cmm-blue" /> : <Mic className="h-6 w-6 text-cmm-blue" />}
                      </div>
                      <p className="text-xs font-bold text-white truncate">{fileNameFromPath(step.mediaPath)}</p>
                      <button
                        onClick={() => onChange({ ...step, mediaPath: null })}
                        className="mt-3 text-[10px] font-bold uppercase tracking-widest text-red-400 transition-colors hover:text-red-300"
                      >
                        Remover mídia
                      </button>
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
            </div> : null}
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

    onChange({
      ...value,
      eligibleChannels: normalizedChannels,
      steps: nextSteps
    });
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="glass-card rounded-[2rem] border-white/5 bg-white/[0.01] p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-4">
            <SectionTitle icon={Target} title="Configuração base" />
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Nome da campanha</p>
                <Input
                  className="h-11 rounded-2xl border-white/5 bg-white/[0.03] text-sm font-semibold focus:border-cmm-blue/30"
                  value={value.name}
                  onChange={(e) => onChange({ ...value, name: e.target.value })}
                  placeholder="ex: Follow-up Vendas"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</p>
                <select
                  className="h-11 w-full rounded-2xl border border-white/5 bg-white/[0.03] px-4 text-sm font-semibold text-white outline-none focus:border-cmm-blue/30"
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Descrição</p>
              <Textarea
                className="min-h-[84px] rounded-2xl border-white/5 bg-white/[0.03] px-4 py-3 text-sm focus:border-cmm-blue/30"
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
                      : "border-white/8 bg-white/[0.02] text-slate-600 hover:bg-white/[0.05]"
                  )}
                  title={opt.label}
                >
                  <opt.icon className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-[2rem] border-white/5 bg-white/[0.01] p-5">
        <SectionTitle icon={Settings2} title="Janela e cadência" />

        <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Início Janela", value: value.sendWindowStart, field: "sendWindowStart", placeholder: "08:00" },
            { label: "Fim Janela", value: value.sendWindowEnd, field: "sendWindowEnd", placeholder: "20:00" },
            { label: "Limite (Envios)", value: value.rateLimitCount, field: "rateLimitCount", type: "number" },
            { label: "Janela (Min)", value: value.rateLimitWindowMinutes, field: "rateLimitWindowMinutes", type: "number" }
          ].map((f) => (
            <div key={f.field} className="rounded-[1.25rem] border border-white/5 bg-white/[0.03] p-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{f.label}</p>
              <Input
                type={f.type || "text"}
                className="h-10 rounded-xl border-white/5 bg-black/20 font-semibold text-center"
                value={f.value}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ ...value, [f.field]: f.type === "number" ? Number(e.target.value) : e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
          {[
            { label: "Delay Mínimo (s)", value: value.randomDelayMinSeconds, field: "randomDelayMinSeconds" },
            { label: "Delay Máximo (s)", value: value.randomDelayMaxSeconds, field: "randomDelayMaxSeconds" }
          ].map((f) => (
            <div key={f.field} className="flex items-center justify-between rounded-[1.25rem] border border-white/5 bg-white/[0.03] p-3">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 leading-none">{f.label}</p>
                <p className="text-xs text-slate-400 font-medium">Delay aleatório</p>
              </div>
              <Input
                type="number"
                className="h-10 w-24 rounded-xl border-white/5 bg-black/20 font-semibold text-center"
                value={f.value}
                onChange={(e) => onChange({ ...value, [f.field]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionTitle icon={Workflow} title="Workflow builder" />
          <button
            type="button"
            onClick={() => onChange({ ...value, steps: [...value.steps, emptyCampaignStep()] })}
            className="flex h-10 items-center gap-2 rounded-2xl bg-gradient-to-r from-cmm-blue to-indigo-600 px-4 text-sm font-bold text-white shadow-xl shadow-blue-500/20 transition-transform hover:scale-105 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Nova etapa
          </button>
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
                  tagOptions={tagsQuery.data ?? []}
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
