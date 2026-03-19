import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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

const actionOptions = [
  "send-text",
  "send-audio",
  "send-image",
  "send-video",
  "wait",
  "apply-tag",
  "remove-tag",
  "create-reminder"
];

const categoryOptions = [
  { value: "instagram-incoming", label: "Instagram · resposta automática" },
  { value: "follow-up", label: "Follow-up" },
  { value: "reativacao", label: "Reativação" },
  { value: "lead-antigo", label: "Lead antigo" },
  { value: "lista-fria", label: "Lista fria" },
  { value: "pos-procedimento", label: "Pós-procedimento" },
  { value: "remarketing", label: "Remarketing" }
];

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

  return (
    <div className="space-y-5">
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
              <option key={item.value} value={item.value} className="bg-slate-950 text-slate-100">
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isInstagramIncoming ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-sm text-emerald-100">
          Dispara quando entra uma nova mensagem no Instagram e responde pelo thread já sincronizado, sem CSV.
        </div>
      ) : null}

      <label className="block space-y-2 text-sm">
        <span className="text-slate-300">Descrição</span>
        <Textarea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">Tags obrigatórias</span>
          <Input
            placeholder="vip, follow-up"
            value={tagsValue}
            onChange={(event) => onChange({ ...value, triggerTags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">Tags de bloqueio</span>
          <Input
            placeholder="nao_insistir"
            value={excludeTagsValue}
            onChange={(event) => onChange({ ...value, excludeTags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
          />
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
            <Input
              type="number"
              value={value.randomDelayMinSeconds}
              onChange={(event) => onChange({ ...value, randomDelayMinSeconds: Number(event.target.value) })}
            />
          </label>
        )}
        <label className="space-y-2 text-sm">
          <span className="text-slate-300">{isInstagramIncoming ? "Delay max (s)" : "Intervalo mínimo (h)"}</span>
          <Input
            type="number"
            value={isInstagramIncoming ? value.randomDelayMaxSeconds : value.minimumIntervalHours}
            onChange={(event) =>
              onChange(
                isInstagramIncoming
                  ? { ...value, randomDelayMaxSeconds: Number(event.target.value) }
                  : { ...value, minimumIntervalHours: Number(event.target.value) }
              )
            }
          />
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
          ...(!isInstagramIncoming
            ? [
                { label: "Exigir última mensagem minha", key: "requireLastOutgoing" },
                { label: "Exigir ausência de resposta", key: "requireNoReply" },
                { label: "Somente pós-procedimento", key: "procedureOnly" }
              ]
            : [])
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

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-white">Sequência de ações</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              onChange({
                ...value,
                actions: [...value.actions, { type: "send-text", content: "", mediaPath: null, waitSeconds: null, tagName: null, reminderText: null, metadata: {} }]
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar ação
          </Button>
        </div>
        <div className="space-y-3">
          {value.actions.map((action, index) => (
            <Card key={`${action.id ?? "new"}-${index}`}>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-200">Ação {index + 1}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onChange({ ...value, actions: value.actions.filter((_, actionIndex) => actionIndex !== index) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <select
                  className="flex h-11 w-full items-center rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/20"
                  value={action.type}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      actions: value.actions.map((current, actionIndex) =>
                        actionIndex === index ? { ...current, type: event.target.value } : current
                      )
                    })
                  }
                >
                  {actionOptions.map((option) => (
                    <option key={option} value={option} className="bg-slate-950 text-slate-100">
                      {option}
                    </option>
                  ))}
                </select>
                <Textarea
                  placeholder="Conteúdo da ação"
                  value={action.content}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      actions: value.actions.map((current, actionIndex) => (actionIndex === index ? { ...current, content: event.target.value } : current))
                    })
                  }
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
