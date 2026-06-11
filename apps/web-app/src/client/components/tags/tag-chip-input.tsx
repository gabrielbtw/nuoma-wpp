import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TagPill } from "./tag-pill";

type TagOption = {
  id: string;
  name: string;
  color?: string;
  active?: boolean;
};

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function TagChipInput({
  value,
  onChange,
  options,
  placeholder = "Adicionar tag"
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: TagOption[];
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState("");

  const valueMap = useMemo(() => new Set(value.map((item) => normalizeTagName(item))), [value]);
  const suggested = useMemo(
    () =>
      options.filter((option) => option.active !== false && !valueMap.has(normalizeTagName(option.name)) && option.name.toLowerCase().includes(inputValue.toLowerCase())),
    [inputValue, options, valueMap]
  );

  const colorMap = useMemo(
    () =>
      new Map(
        options.map((option) => [normalizeTagName(option.name), option.color ?? "#38bdf8"])
      ),
    [options]
  );

  function commitTag(rawValue: string) {
    const normalized = rawValue.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return;
    }

    if (valueMap.has(normalizeTagName(normalized))) {
      setInputValue("");
      return;
    }

    onChange([...value, normalized]);
    setInputValue("");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[1.25rem] border border-white/10 bg-slate-950/50 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex flex-wrap gap-2">
          {value.map((tag) => (
            <TagPill key={tag} name={tag} color={colorMap.get(normalizeTagName(tag))} removable onRemove={() => onChange(value.filter((item) => item !== tag))} />
          ))}
          <div className="flex min-w-[14rem] flex-1 items-center gap-2">
            <Input
              placeholder={placeholder}
              value={inputValue}
              className="border-none bg-transparent px-0 focus:border-none focus:ring-0"
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  commitTag(inputValue);
                }
              }}
            />
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/6 text-slate-200 transition hover:border-primary/30 hover:bg-primary/12"
              onClick={() => commitTag(inputValue)}
              aria-label="Adicionar tag"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
          <span>Enter ou vírgula adicionam a tag</span>
          <span>{value.length} selecionada(s)</span>
        </div>
      </div>

      {suggested.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggested.slice(0, 8).map((option) => (
            <button
              key={option.id}
              type="button"
              className={cn("rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-primary/40 hover:bg-primary/10")}
              onClick={() => commitTag(option.name)}
            >
              {option.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
