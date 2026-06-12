import { Plus, X } from "lucide-react";

import {
  Button,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nuoma/ui";

import { segmentFields, segmentOperators } from "../../../../flow-builder/lib/builder-options.js";
import type { SegmentDraft } from "../../../../flow-builder/lib/segment.js";
import { newSegmentDraft } from "../../state/hydrate.js";

export interface SegmentEditorProps {
  enabled: boolean;
  operator: "and" | "or";
  segments: SegmentDraft[];
  compact?: boolean;
  onPatch: (patch: {
    segmentEnabled?: boolean;
    segmentOperator?: "and" | "or";
    segments?: SegmentDraft[];
  }) => void;
}

export function SegmentEditor({
  enabled,
  operator,
  segments,
  compact = false,
  onPatch,
}: SegmentEditorProps) {
  const updateRow = (id: string, patch: Partial<SegmentDraft>) => {
    onPatch({
      segments: segments.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  };

  if (compact) {
    if (!enabled) {
      return (
        <p className="rounded-md border border-dashed border-line-hairline px-3 py-2 text-[0.68rem] leading-4 text-ink-faint">
          Nenhum filtro ativo. Todos os contatos elegíveis do canal podem entrar no fluxo.
        </p>
      );
    }

    return (
      <div className="grid gap-2.5">
        <SegmentedControl
          size="sm"
          aria-label="Operador do segmento"
          value={operator}
          className="w-full"
          onValueChange={(value) => onPatch({ segmentOperator: value as "and" | "or" })}
          options={[
            { value: "and", label: "Todas (E)" },
            { value: "or", label: "Qualquer (OU)" },
          ]}
        />
        {segments.map((row) => {
          const needsValue = row.operator !== "exists" && row.operator !== "not_exists";
          return (
            <div
              key={row.id}
              className="grid gap-1.5 rounded-md border border-line-hairline bg-surface-2/60 p-2"
            >
              <div className="flex items-center gap-1.5">
                <Select
                  value={row.field}
                  onValueChange={(value) =>
                    updateRow(row.id, { field: value as SegmentDraft["field"] })
                  }
                >
                  <SelectTrigger className="h-8 flex-1 px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentFields.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.operator}
                  onValueChange={(value) =>
                    updateRow(row.id, { operator: value as SegmentDraft["operator"] })
                  }
                >
                  <SelectTrigger className="h-8 w-[5.1rem] shrink-0 px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentOperators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <IconButton
                  label="Remover regra"
                  size="xs"
                  icon={<X className="h-3.5 w-3.5" />}
                  disabled={segments.length <= 1}
                  onClick={() =>
                    onPatch({ segments: segments.filter((item) => item.id !== row.id) })
                  }
                />
              </div>
              {needsValue ? (
                <Input
                  value={row.value}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                  placeholder="valor"
                  className="h-8 px-2 text-xs"
                />
              ) : null}
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="xs"
          className="justify-self-start"
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => onPatch({ segments: [...segments, newSegmentDraft()] })}
        >
          Adicionar regra
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-line-hairline bg-surface-1/60 p-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-soft">Segmento</p>
          <p className="mt-0.5 text-[0.68rem] leading-4 text-ink-faint">
            Restringe quem entra no fluxo.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onPatch({ segmentEnabled: checked })}
          aria-label="Ativar segmento"
        />
      </header>

      {enabled ? (
        <div className="mt-3 grid gap-2.5">
          <SegmentedControl
            size="sm"
            aria-label="Operador do segmento"
            value={operator}
            onValueChange={(value) => onPatch({ segmentOperator: value as "and" | "or" })}
            options={[
              { value: "and", label: "Todas as regras (E)" },
              { value: "or", label: "Qualquer regra (OU)" },
            ]}
          />
          {segments.map((row) => {
            const needsValue = row.operator !== "exists" && row.operator !== "not_exists";
            return (
              <div key={row.id} className="flex items-center gap-1.5">
                <Select
                  value={row.field}
                  onValueChange={(value) =>
                    updateRow(row.id, { field: value as SegmentDraft["field"] })
                  }
                >
                  <SelectTrigger className="h-9 flex-1 px-2.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentFields.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.operator}
                  onValueChange={(value) =>
                    updateRow(row.id, { operator: value as SegmentDraft["operator"] })
                  }
                >
                  <SelectTrigger className="h-9 w-[5.4rem] shrink-0 px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentOperators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsValue ? (
                  <Input
                    value={row.value}
                    onChange={(event) => updateRow(row.id, { value: event.target.value })}
                    placeholder="valor"
                    className="h-9 flex-1 px-2.5 text-xs"
                  />
                ) : null}
                <IconButton
                  label="Remover regra"
                  size="xs"
                  icon={<X className="h-3.5 w-3.5" />}
                  disabled={segments.length <= 1}
                  onClick={() =>
                    onPatch({ segments: segments.filter((item) => item.id !== row.id) })
                  }
                />
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="xs"
            className="justify-self-start"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => onPatch({ segments: [...segments, newSegmentDraft()] })}
          >
            Adicionar regra
          </Button>
        </div>
      ) : null}
    </section>
  );
}
