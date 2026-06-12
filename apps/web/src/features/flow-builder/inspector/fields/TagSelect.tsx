import {
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nuoma/ui";

import { trpc } from "../../../../lib/trpc.js";

export interface TagSelectProps {
  label: string;
  value: string;
  error?: string | null;
  description?: string;
  onChange: (id: string) => void;
}

export function TagSelect({ label, value, error, description, onChange }: TagSelectProps) {
  const tags = trpc.tags.list.useQuery();
  const list = tags.data?.tags ?? [];

  return (
    <Field
      label={label}
      error={error}
      description={
        tags.isLoading
          ? "Carregando tags…"
          : list.length === 0
            ? "Nenhuma tag criada ainda. Crie tags na tela de Contatos."
            : description
      }
    >
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-10" disabled={tags.isLoading}>
          <SelectValue placeholder="Selecionar tag…" />
        </SelectTrigger>
        <SelectContent>
          {list.map((tag) => (
            <SelectItem key={tag.id} value={String(tag.id)}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
