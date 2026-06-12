import type { MediaAssetType } from "@nuoma/contracts";

import { Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nuoma/ui";

import { trpc } from "../../../../lib/trpc.js";

export interface MediaPickerProps {
  type: MediaAssetType;
  label: string;
  value: string;
  error?: string | null;
  onChange: (id: string) => void;
}

const TYPE_HINT: Record<MediaAssetType, string> = {
  voice: "Voice notes OGG/Opus enviados ou gravados no Inbox.",
  audio: "Áudios disponíveis na biblioteca de mídia.",
  image: "Imagens disponíveis na biblioteca de mídia.",
  video: "Vídeos disponíveis na biblioteca de mídia.",
  document: "Documentos disponíveis na biblioteca de mídia.",
};

export function MediaPicker({ type, label, value, error, onChange }: MediaPickerProps) {
  const assets = trpc.media.list.useQuery({ type, limit: 200 });
  const list = assets.data?.assets ?? [];
  const hasCurrent = value && list.some((asset) => String(asset.id) === value);

  return (
    <Field
      label={label}
      error={error}
      description={
        assets.isLoading
          ? "Carregando biblioteca…"
          : list.length === 0
            ? "Nenhum asset deste tipo. Faça upload pelo Inbox antes de usar este bloco."
            : TYPE_HINT[type]
      }
    >
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-10" disabled={assets.isLoading}>
          <SelectValue placeholder="Selecionar asset…" />
        </SelectTrigger>
        <SelectContent>
          {!hasCurrent && value ? (
            <SelectItem value={value}>{`Asset #${value} (fora da lista)`}</SelectItem>
          ) : null}
          {list.map((asset) => (
            <SelectItem key={asset.id} value={String(asset.id)}>
              {`#${asset.id} · ${asset.fileName}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
