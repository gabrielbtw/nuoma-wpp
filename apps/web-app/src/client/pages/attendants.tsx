import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Plus, Trash2, Upload, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { apiFetch, toJsonBody } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type AttendantRecord = {
  id: string;
  name: string;
  voiceSamples: string[];
  xttsModelPath: string | null;
  status: "active" | "error";
  createdAt: string;
  updatedAt: string;
};

function fileBaseName(filePath: string) {
  return filePath.split("/").pop() ?? filePath;
}

function AttendantDialog({
  attendant,
  onClose
}: {
  attendant?: AttendantRecord;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEdit = Boolean(attendant?.id);

  const [name, setName] = useState(attendant?.name ?? "");
  const [uploading, setUploading] = useState(false);
  const [samples, setSamples] = useState<string[]>(attendant?.voiceSamples ?? []);
  const [attendantId, setAttendantId] = useState<string | null>(attendant?.id ?? null);

  const createMutation = useMutation({
    mutationFn: (n: string) =>
      apiFetch<AttendantRecord>("/attendants", { method: "POST", body: toJsonBody({ name: n }) }),
    onSuccess: (data) => {
      setAttendantId(data.id);
      qc.invalidateQueries({ queryKey: ["attendants"] });
    },
    onError: () => toast("error", "Erro ao criar atendente.")
  });

  const updateNameMutation = useMutation({
    mutationFn: (n: string) =>
      apiFetch<AttendantRecord>(`/attendants/${attendantId}`, { method: "PATCH", body: toJsonBody({ name: n }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendants"] }),
    onError: () => toast("error", "Erro ao salvar nome.")
  });

  const removeSampleMutation = useMutation({
    mutationFn: (samplePath: string) =>
      apiFetch<AttendantRecord>(`/attendants/${attendantId}/samples`, {
        method: "DELETE",
        body: toJsonBody({ samplePath })
      }),
    onSuccess: (data) => {
      setSamples(data.voiceSamples);
      qc.invalidateQueries({ queryKey: ["attendants"] });
    },
    onError: () => toast("error", "Erro ao remover amostra.")
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/attendants/${attendantId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendants"] });
      onClose();
    },
    onError: () => toast("error", "Erro ao excluir atendente.")
  });

  async function saveName() {
    if (!name.trim()) {
      toast("error", "Informe um nome.");
      return;
    }
    if (!attendantId) {
      await createMutation.mutateAsync(name);
    } else if (isEdit) {
      await updateNameMutation.mutateAsync(name);
    }
  }

  async function uploadSample(file: File) {
    const currentId = attendantId;
    if (!currentId) {
      if (!name.trim()) {
        toast("error", "Informe um nome antes de enviar amostras.");
        return;
      }
      const created = await createMutation.mutateAsync(name);
      await uploadSampleToId(file, created.id);
      return;
    }
    await uploadSampleToId(file, currentId);
  }

  async function uploadSampleToId(file: File, id: string) {
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    try {
      const updated = await apiFetch<AttendantRecord>(`/attendants/${id}/samples`, {
        method: "POST",
        body: formData
      });
      setSamples(updated.voiceSamples);
      setAttendantId(id);
      qc.invalidateQueries({ queryKey: ["attendants"] });
      toast("success", "Amostra enviada.");
    } catch {
      toast("error", "Erro ao enviar amostra.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-n-border/60 bg-n-surface p-6 shadow-2xl ring-1 ring-white/[0.04]">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-n-border/60 bg-n-surface-2">
              <Mic className="h-4.5 w-4.5 text-cmm-purple" />
            </div>
            <span className="text-h4 font-semibold text-n-text">
              {isEdit ? "Editar Atendente" : "Novo Atendente"}
            </span>
          </div>
          <button type="button" onClick={onClose} className="text-n-text-muted hover:text-n-text transition-all duration-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-micro font-semibold uppercase tracking-wider text-n-text-dim">Nome</p>
            <div className="flex gap-2">
              <Input
                className="h-10 flex-1 rounded-xl border-n-border bg-n-surface-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Maria"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-10 rounded-xl"
                onClick={saveName}
                disabled={createMutation.isPending || updateNameMutation.isPending}
              >
                Salvar
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-micro font-semibold uppercase tracking-wider text-n-text-dim">
              Amostras de voz ({samples.length})
            </p>
            <p className="text-micro text-n-text-dim">
              Envie arquivos de audio com a voz que deseja clonar. Quanto mais amostras, melhor a qualidade.
            </p>

            <div className="space-y-1.5">
              {samples.map((s) => (
                <div
                  key={s}
                  className="flex items-center justify-between rounded-xl border border-n-border bg-n-surface-2 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Mic className="h-3.5 w-3.5 text-cmm-purple" />
                    <span className="max-w-[280px] truncate text-xs text-n-text-muted">{fileBaseName(s)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSampleMutation.mutate(s)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadSample(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-n-border/60 py-3 text-caption font-semibold text-n-text-dim transition-all duration-200",
                uploading ? "opacity-50" : "hover:border-cmm-purple/40 hover:text-cmm-purple"
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Enviando..." : "Adicionar amostra de voz"}
            </button>
          </div>
        </div>

        {isEdit && attendantId && (
          <div className="mt-6 flex justify-end border-t border-n-border pt-4">
            <button
              type="button"
              onClick={() => {
                if (confirm("Excluir este atendente?")) deleteMutation.mutate();
              }}
              className="text-micro font-semibold uppercase tracking-wider text-n-red hover:text-n-red/80 transition-all duration-200"
            >
              Excluir atendente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AttendantsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AttendantRecord | undefined>(undefined);

  const { data: attendants = [], isLoading } = useQuery({
    queryKey: ["attendants"],
    queryFn: () => apiFetch<AttendantRecord[]>("/attendants")
  });

  function openCreate() {
    setEditTarget(undefined);
    setDialogOpen(true);
  }

  function openEdit(a: AttendantRecord) {
    setEditTarget(a);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Atendentes Virtuais"
        description="Crie perfis de voz para converter audios de campanhas usando XTTS v2 local."
        actions={
          <Button onClick={openCreate} className="gap-2 rounded-xl">
            <Plus className="h-4 w-4" />
            Novo atendente
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-n-border bg-n-surface-2" />
          ))}
        </div>
      ) : attendants.length === 0 ? (
        <EmptyState
          icon={Mic}
          title="Nenhum atendente criado"
          description="Crie um atendente virtual para clonar uma voz e usar em campanhas de audio."
          actionLabel="Criar atendente"
          onAction={openCreate}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attendants.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => openEdit(a)}
              className="group rounded-2xl border border-n-border/60 bg-n-surface p-4 text-left transition-all duration-200 hover:bg-n-surface-2 ring-1 ring-white/[0.04]"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-n-border/60 bg-n-surface-2">
                  <Mic className="h-4 w-4 text-cmm-purple" />
                </div>
                <Badge tone={a.status === "active" ? "success" : "danger"}>
                  {a.status === "active" ? "Ativo" : "Erro"}
                </Badge>
              </div>
              <p className="text-body font-semibold text-n-text">{a.name}</p>
              <p className="mt-0.5 text-micro text-n-text-dim">
                {a.voiceSamples.length} amostra{a.voiceSamples.length !== 1 ? "s" : ""} de voz
              </p>
            </button>
          ))}
        </div>
      )}

      {dialogOpen && (
        <AttendantDialog attendant={editTarget} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}
