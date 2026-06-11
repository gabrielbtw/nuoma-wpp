/**
 * Reusable AND/OR segment filter builder.
 * Used in: contacts page, campaign recipient selector, automation trigger criteria.
 */
import { useState } from "react";
import { Filter, Plus, Trash2, ToggleLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SegmentFilterField = "tag" | "status" | "channel" | "procedure" | "created_after" | "created_before" | "last_interaction_after" | "last_interaction_before" | "has_phone" | "has_instagram";
export type SegmentFilterOperator = "equals" | "not_equals" | "has" | "not_has";

export type SegmentFilter = {
  field: SegmentFilterField;
  operator: SegmentFilterOperator;
  value: string;
};

export type SegmentQuery = {
  logic: "and" | "or";
  filters: SegmentFilter[];
};

const fieldOptions: Array<{ value: SegmentFilterField; label: string; operators: SegmentFilterOperator[] }> = [
  { value: "tag", label: "Tag", operators: ["has", "not_has"] },
  { value: "status", label: "Status", operators: ["equals", "not_equals"] },
  { value: "channel", label: "Canal", operators: ["has", "not_has"] },
  { value: "procedure", label: "Procedimento", operators: ["equals", "not_equals"] },
  { value: "created_after", label: "Criado apos", operators: ["equals"] },
  { value: "created_before", label: "Criado antes", operators: ["equals"] },
  { value: "last_interaction_after", label: "Ultima interacao apos", operators: ["equals"] },
  { value: "last_interaction_before", label: "Ultima interacao antes", operators: ["equals"] },
  { value: "has_phone", label: "Tem telefone", operators: ["equals"] },
  { value: "has_instagram", label: "Tem Instagram", operators: ["equals"] }
];

const operatorLabels: Record<SegmentFilterOperator, string> = {
  equals: "e igual a",
  not_equals: "nao e",
  has: "tem",
  not_has: "nao tem"
};

const statusValues = [
  { value: "novo", label: "Novo" },
  { value: "aguardando_resposta", label: "Aguardando resposta" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "cliente", label: "Cliente" },
  { value: "sem_retorno", label: "Sem retorno" },
  { value: "perdido", label: "Perdido" }
];

const channelValues = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" }
];

const procedureValues = [
  { value: "yes", label: "Sim" },
  { value: "no", label: "Nao" },
  { value: "unknown", label: "Indefinido" }
];

const boolValues = [
  { value: "true", label: "Sim" },
  { value: "false", label: "Nao" }
];

function getValueOptions(field: SegmentFilterField) {
  switch (field) {
    case "status": return statusValues;
    case "channel": return channelValues;
    case "procedure": return procedureValues;
    case "has_phone":
    case "has_instagram": return boolValues;
    default: return null; // free text or date
  }
}

function isDateField(field: SegmentFilterField) {
  return ["created_after", "created_before", "last_interaction_after", "last_interaction_before"].includes(field);
}

function emptyFilter(): SegmentFilter {
  return { field: "tag", operator: "has", value: "" };
}

export function SegmentBuilder({
  value,
  onChange,
  tagOptions
}: {
  value: SegmentQuery;
  onChange: (next: SegmentQuery) => void;
  tagOptions?: Array<{ name: string }>;
}) {
  function addFilter() {
    onChange({ ...value, filters: [...value.filters, emptyFilter()] });
  }

  function removeFilter(index: number) {
    onChange({ ...value, filters: value.filters.filter((_, i) => i !== index) });
  }

  function updateFilter(index: number, patch: Partial<SegmentFilter>) {
    onChange({
      ...value,
      filters: value.filters.map((f, i) => i === index ? { ...f, ...patch } : f)
    });
  }

  function toggleLogic() {
    onChange({ ...value, logic: value.logic === "and" ? "or" : "and" });
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-cmm-purple" />
          <span className="text-xs font-bold text-white">Filtros</span>
          {value.filters.length > 1 && (
            <button onClick={toggleLogic}
              className={cn("flex items-center gap-1 rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border transition-all",
                value.logic === "and"
                  ? "border-cmm-blue/30 bg-cmm-blue/10 text-cmm-blue"
                  : "border-cmm-orange/30 bg-cmm-orange/10 text-cmm-orange")}>
              <ToggleLeft className="h-3 w-3" />
              {value.logic === "and" ? "E (AND)" : "OU (OR)"}
            </button>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={addFilter} className="text-[10px] font-bold text-cmm-purple hover:text-white">
          <Plus className="h-3 w-3 mr-1" /> Filtro
        </Button>
      </div>

      {/* Filter rows */}
      {value.filters.map((filter, index) => {
        const fieldDef = fieldOptions.find((f) => f.value === filter.field);
        const operators = fieldDef?.operators ?? ["equals"];
        const valOpts = filter.field === "tag" ? (tagOptions ?? []).map((t) => ({ value: t.name, label: t.name })) : getValueOptions(filter.field);
        const isDate = isDateField(filter.field);

        return (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-n-border bg-n-surface p-2.5">
            {/* Field */}
            <select className="h-8 rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
              value={filter.field} onChange={(e) => {
                const newField = e.target.value as SegmentFilterField;
                const newFieldDef = fieldOptions.find((f) => f.value === newField);
                updateFilter(index, {
                  field: newField,
                  operator: newFieldDef?.operators[0] ?? "equals",
                  value: ""
                });
              }}>
              {fieldOptions.map((f) => <option key={f.value} value={f.value} className="bg-slate-900">{f.label}</option>)}
            </select>

            {/* Operator */}
            {operators.length > 1 && (
              <select className="h-8 rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
                value={filter.operator} onChange={(e) => updateFilter(index, { operator: e.target.value as SegmentFilterOperator })}>
                {operators.map((op) => <option key={op} value={op} className="bg-slate-900">{operatorLabels[op]}</option>)}
              </select>
            )}

            {/* Value */}
            {valOpts ? (
              <select className="h-8 flex-1 min-w-[120px] rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
                value={filter.value} onChange={(e) => updateFilter(index, { value: e.target.value })}>
                <option value="" className="bg-slate-900">Selecione...</option>
                {valOpts.map((v) => <option key={v.value} value={v.value} className="bg-slate-900">{v.label}</option>)}
              </select>
            ) : isDate ? (
              <input type="date" className="h-8 flex-1 min-w-[140px] rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
                value={filter.value} onChange={(e) => updateFilter(index, { value: e.target.value })} />
            ) : (
              <input type="text" className="h-8 flex-1 min-w-[120px] rounded-lg border border-n-border bg-black/30 px-2 text-xs font-semibold text-white outline-none"
                placeholder="Valor..." value={filter.value} onChange={(e) => updateFilter(index, { value: e.target.value })} />
            )}

            {/* Remove */}
            <button onClick={() => removeFilter(index)} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            {/* Logic connector */}
            {index < value.filters.length - 1 && (
              <div className="w-full flex justify-center py-0.5">
                <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                  value.logic === "and" ? "text-cmm-blue bg-cmm-blue/10" : "text-cmm-orange bg-cmm-orange/10")}>
                  {value.logic === "and" ? "E" : "OU"}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {value.filters.length === 0 && (
        <div className="rounded-xl border border-dashed border-n-border bg-n-surface px-4 py-6 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
            Nenhum filtro aplicado. Clique em "+ Filtro" para comecar.
          </p>
        </div>
      )}
    </div>
  );
}
