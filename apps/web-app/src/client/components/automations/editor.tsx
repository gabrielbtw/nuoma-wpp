import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Workflow } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import {
  FlowStepCard,
  emptyFlowStep,
  type FlowStep,
  type FlowStepEditorConfig
} from "@/components/shared/flow-step-editor";

// ----- Types -----

type AutomationAction = {
  id?: string;
  type: string;
  content: string;
  mediaPath?: string | null;
  waitSeconds?: number | null;
  tagName?: string | null;
  reminderText?: string | null;
  metadata?: Record<string, unknown>;
};

export type AutomationDraft = {
  id?: string;
  name: string;
  category: string;
  enabled: boolean;
  description: string;
  triggerTags: string[];
  excludeTags: string[];
  requiredStatus: string | null;
  procedureOnly: boolean;
  requireLastOutgoing: boolean;
  requireNoReply: boolean;
  timeWindowHours: number;
  minimumIntervalHours: number;
  randomDelayMinSeconds: number;
  randomDelayMaxSeconds: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  templateKey?: string | null;
  actions: AutomationAction[];
};

type TagRecord = { id: string; name: string; color: string };

// ----- Action <-> FlowStep mapping -----

const actionTypeToFlowStep: Record<string, FlowStep["type"]> = {
  "send-text": "text",
  "send-audio": "audio",
  "send-image": "image",
  "send-video": "video",
  "wait": "wait",
  "apply-tag": "ADD_TAG",
  "remove-tag": "REMOVE_TAG",
  "create-reminder": "text"
};

const flowStepToActionType: Record<string, string> = {
  "text": "send-text",
  "audio": "send-audio",
  "image": "send-image",
  "video": "send-video",
  "document": "send-text",
  "link": "send-text",
  "wait": "wait",
  "ADD_TAG": "apply-tag",
  "REMOVE_TAG": "remove-tag"
};

function actionToFlowStep(action: AutomationAction, index: number): FlowStep {
  const stepType = actionTypeToFlowStep[action.type] ?? "text";
  return {
    id: action.id ?? `action-${index}`,
    type: stepType,
    content: action.content ?? "",
    mediaPath: action.mediaPath ?? null,
    waitMinutes: action.waitSeconds != null ? Math.ceil(action.waitSeconds / 60) : null,
    caption: "",
    tagName: action.tagName ?? null,
    channelScope: "any",
    templateId: null,
    conditionType: null,
    conditionValue: null,
    conditionAction: null,
    conditionJumpTo: null
  };
}

function flowStepToAction(step: FlowStep): AutomationAction {
  const actionType = flowStepToActionType[step.type] ?? "send-text";
  return {
    id: step.id,
    type: actionType,
    content: step.content ?? "",
    mediaPath: step.mediaPath ?? null,
    waitSeconds: step.waitMinutes != null ? step.waitMinutes * 60 : null,
    tagName: step.tagName ?? null,
    reminderText: null,
    metadata: {}
  };
}

// ----- Sortable wrapper -----

function SortableActionStep({
  step, index, isLast, stepCount, tagOptions, config, onChange, onDuplicate, onRemove
}: {
  step: FlowStep; index: number; isLast: boolean; stepCount: number;
  tagOptions: TagRecord[]; config: FlowStepEditorConfig;
  onChange: (next: FlowStep) => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const sortableId = step.id ?? `action-${index}`;
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: sortableId });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <FlowStepCard
        step={step}
        index={index}
        isLast={isLast}
        stepCount={stepCount}
        tagOptions={tagOptions}
        config={config}
        dragHandleProps={{ ...attributes, ...listeners }}
        onChange={onChange}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </div>
  );
}

// ----- Category options -----

const categoryOptions = [
  { value: "instagram-incoming", label: "Instagram - resposta automatica" },
  { value: "follow-up", label: "Follow-up" },
  { value: "reativacao", label: "Reativacao" },
  { value: "lead-antigo", label: "Lead antigo" },
  { value: "lista-fria", label: "Lista fria" },
  { value: "pos-procedimento", label: "Pos-procedimento" },
  { value: "remarketing", label: "Remarketing" }
];

const AUTOMATION_STEP_TYPES: FlowStep["type"][] = ["text", "audio", "image", "video", "wait", "ADD_TAG", "REMOVE_TAG"];

const automationStepConfig: FlowStepEditorConfig = {
  showChannelScope: false,
  showConditions: true,
  showVarHints: true,
  availableTypes: AUTOMATION_STEP_TYPES,
  uploadScope: "rule"
};

// ----- Main component -----

export function AutomationEditor({
  value,
  onChange
}: {
  value: AutomationDraft;
  onChange: (next: AutomationDraft) => void;
}) {
  const tagsValue = useMemo(() => value.triggerTags.join(", "), [value.triggerTags]);
  const excludeTagsValue = useMemo(() => value.excludeTags.join(", "), [value.excludeTags]);
  const isInstagramIncoming = value.category === "instagram-incoming";

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  // Convert actions to flow steps for the shared editor
  const flowSteps = useMemo(() => value.actions.map(actionToFlowStep), [value.actions]);
  const sortableIds = useMemo(() => flowSteps.map((s, i) => s.id ?? `action-${i}`), [flowSteps]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function updateActions(newFlowSteps: FlowStep[]) {
    onChange({ ...value, actions: newFlowSteps.map(flowStepToAction) });
  }

  function handleStepChange(index: number, next: FlowStep) {
    const newSteps = flowSteps.map((s, i) => i === index ? next : s);
    updateActions(newSteps);
  }

  function addStep() {
    const newStep = emptyFlowStep();
    updateActions([...flowSteps, newStep]);
  }

  function duplicateStep(index: number) {
    const step = flowSteps[index];
    const clone = { ...step, id: undefined };
    updateActions([...flowSteps.slice(0, index + 1), clone, ...flowSteps.slice(index + 1)]);
  }

  function removeStep(index: number) {
    if (flowSteps.length <= 1) {
      updateActions([emptyFlowStep()]);
    } else {
      updateActions(flowSteps.filter((_, i) => i !== index));
    }
  }

  return (
    <div className="space-y-5">
      {/* Config section */}
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">Nome</span>
          <Input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">Categoria</span>
          <select
            className="flex h-11 w-full items-center rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/20"
            value={value.category}
            onChange={(event) => onChange({ ...value, category: event.target.value })}
          >
            {categoryOptions.map((item) => (
              <option key={item.value} value={item.value} className="bg-slate-950 text-slate-100">{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      {isInstagramIncoming && (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-sm text-emerald-100">
          Dispara quando entra uma nova mensagem no Instagram e responde pelo thread ja sincronizado.
        </div>
      )}

      <label className="block space-y-2 text-sm">
        <span className="text-slate-300">Descricao</span>
        <Textarea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">Tags obrigatorias</span>
          <Input placeholder="vip, follow-up" value={tagsValue}
            onChange={(event) => onChange({ ...value, triggerTags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">Tags de bloqueio</span>
          <Input placeholder="nao_insistir" value={excludeTagsValue}
            onChange={(event) => onChange({ ...value, excludeTags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {!isInstagramIncoming ? (
          <label className="space-y-2 text-sm">
            <span className="text-slate-300">Janela (h)</span>
            <Input type="number" value={value.timeWindowHours} onChange={(event) => onChange({ ...value, timeWindowHours: Number(event.target.value) })} />
          </label>
        ) : (
          <label className="space-y-2 text-sm">
            <span className="text-slate-300">Delay min (s)</span>
            <Input type="number" value={value.randomDelayMinSeconds}
              onChange={(event) => onChange({ ...value, randomDelayMinSeconds: Number(event.target.value) })} />
          </label>
        )}
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">{isInstagramIncoming ? "Delay max (s)" : "Intervalo minimo (h)"}</span>
          <Input type="number" value={isInstagramIncoming ? value.randomDelayMaxSeconds : value.minimumIntervalHours}
            onChange={(event) => onChange(isInstagramIncoming
              ? { ...value, randomDelayMaxSeconds: Number(event.target.value) }
              : { ...value, minimumIntervalHours: Number(event.target.value) })} />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">Responder entre</span>
          <Input value={value.sendWindowStart} onChange={(event) => onChange({ ...value, sendWindowStart: event.target.value })} />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">e</span>
          <Input value={value.sendWindowEnd} onChange={(event) => onChange({ ...value, sendWindowEnd: event.target.value })} />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { label: "Ativa", key: "enabled" },
          ...(!isInstagramIncoming ? [
            { label: "Exigir ultima mensagem minha", key: "requireLastOutgoing" },
            { label: "Exigir ausencia de resposta", key: "requireNoReply" },
            { label: "Somente pos-procedimento", key: "procedureOnly" }
          ] : [])
        ].map((item) => (
          <div key={item.key} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-slate-300">{item.label}</span>
            <Switch
              checked={Boolean(value[item.key as keyof AutomationDraft])}
              onCheckedChange={(checked) => onChange({ ...value, [item.key]: checked } as AutomationDraft)}
            />
          </div>
        ))}
      </div>

      {/* Unified step list using shared FlowStepCard */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/5 bg-white/5 shadow-inner">
              <Workflow className="h-4.5 w-4.5 text-cmm-purple" />
            </div>
            <div className="font-display text-base font-bold text-white tracking-tight">Sequencia de acoes</div>
          </div>
          <button type="button" onClick={addStep}
            className="flex h-10 items-center gap-2 rounded-2xl bg-gradient-to-r from-cmm-purple to-indigo-600 px-4 text-sm font-bold text-white shadow-xl shadow-purple-500/20 transition-transform hover:scale-105 active:scale-95">
            <Plus className="h-4 w-4" /> Nova acao
          </button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => {
          if (!e.over || e.active.id === e.over.id) return;
          const oldIdx = sortableIds.indexOf(String(e.active.id));
          const newIdx = sortableIds.indexOf(String(e.over.id));
          updateActions(arrayMove(flowSteps, oldIdx, newIdx));
        }}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {flowSteps.map((step, index) => (
                <SortableActionStep
                  key={step.id ?? `action-${index}`}
                  step={step}
                  index={index}
                  isLast={index === flowSteps.length - 1}
                  stepCount={flowSteps.length}
                  tagOptions={tagsQuery.data ?? []}
                  config={automationStepConfig}
                  onChange={(next) => handleStepChange(index, next)}
                  onDuplicate={() => duplicateStep(index)}
                  onRemove={() => removeStep(index)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
