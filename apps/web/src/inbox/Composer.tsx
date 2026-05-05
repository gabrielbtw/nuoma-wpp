import { motion } from "framer-motion";
import {
  AudioWaveform,
  CheckCircle2,
  File,
  Forward,
  Image,
  Mic,
  MessageSquareText,
  Paperclip,
  Reply,
  Save,
  Send,
  Smile,
  StopCircle,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useToast,
} from "@nuoma/ui";

import type { QuickReply } from "@nuoma/contracts";

import { API_URL } from "../lib/api-url.js";
import { csrfFromCookie } from "../lib/csrf.js";
import { trpc } from "../lib/trpc.js";
import type { MessageActionDraft } from "./message-action-draft.js";
import type { OptimisticMessageResult } from "./optimistic-message.js";

interface ComposerProps {
  conversationId: number | null;
  actionDraft?: MessageActionDraft | null;
  onCreateOptimisticSend?: (input: {
    body: string;
    conversationId: number;
  }) => OptimisticMessageResult;
  onClearActionDraft?: () => void;
  onOptimisticSendFailed?: (clientMutationId: string, errorMessage: string) => void;
  onOptimisticSendQueued?: (clientMutationId: string, jobId: number) => void;
}

interface VoicePreview {
  blob: Blob;
  durationMs: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

type RecordingState = "idle" | "recording" | "recorded";
type EmojiCategoryId = "recent" | "faces" | "gestures" | "heart" | "objects" | "symbols";

interface EmojiEntry {
  emoji: string;
  label: string;
  keywords: string[];
}

interface EmojiCategory {
  id: Exclude<EmojiCategoryId, "recent">;
  label: string;
  icon: string;
  items: EmojiEntry[];
}

const voiceRecorderMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

const emojiRecentStorageKey = "nuoma:composer:recent-emojis:v1";
const emojiRecentLimit = 12;

const emojiCategories: EmojiCategory[] = [
  {
    id: "faces",
    label: "Rostos",
    icon: "🙂",
    items: [
      emoji("😀", "feliz", "sorriso alegria"),
      emoji("😄", "sorrindo", "feliz alegria"),
      emoji("😂", "rindo", "risada gargalhada"),
      emoji("😊", "gentil", "sorriso leve"),
      emoji("😍", "apaixonado", "amor olhos"),
      emoji("🥰", "carinho", "amor feliz"),
      emoji("😎", "confiante", "oculos legal"),
      emoji("🤔", "pensando", "duvida pensar"),
      emoji("😅", "alivio", "nervoso suor"),
      emoji("🙏", "grato", "obrigado gratidao"),
      emoji("🥹", "emocionado", "fofo gratidao"),
      emoji("😇", "tranquilo", "calmo anjo"),
    ],
  },
  {
    id: "gestures",
    label: "Gestos",
    icon: "👍",
    items: [
      emoji("👍", "ok", "positivo beleza"),
      emoji("👎", "negativo", "nao ruim"),
      emoji("👏", "palmas", "parabens aplauso"),
      emoji("🙌", "comemorando", "celebrar festa"),
      emoji("🤝", "acordo", "parceria combinado"),
      emoji("💪", "forca", "forte foco"),
      emoji("✌️", "paz", "vitoria"),
      emoji("👌", "perfeito", "ok bom"),
      emoji("👀", "olhando", "ver acompanhar"),
      emoji("🤞", "torcendo", "sorte"),
      emoji("🫶", "coracao maos", "amor carinho"),
      emoji("👉", "apontar", "direita aqui"),
    ],
  },
  {
    id: "heart",
    label: "Afeto",
    icon: "💚",
    items: [
      emoji("❤️", "coracao vermelho", "amor"),
      emoji("💚", "coracao verde", "nuoma amor"),
      emoji("💙", "coracao azul", "confianca"),
      emoji("💜", "coracao roxo", "carinho"),
      emoji("✨", "brilho", "sparkle especial"),
      emoji("🌟", "estrela", "destaque"),
      emoji("🎉", "festa", "comemorar parabens"),
      emoji("🎁", "presente", "gift oferta"),
      emoji("🌹", "flor", "rosa"),
      emoji("☀️", "sol", "bom dia"),
      emoji("🔥", "fogo", "quente fire"),
      emoji("💎", "diamante", "premium valor"),
    ],
  },
  {
    id: "objects",
    label: "Objetos",
    icon: "📎",
    items: [
      emoji("📎", "clipe", "anexo arquivo"),
      emoji("📄", "documento", "arquivo pdf"),
      emoji("📷", "camera", "foto imagem"),
      emoji("🎥", "video", "filmagem"),
      emoji("🎙️", "microfone", "audio voz"),
      emoji("📅", "calendario", "agenda data"),
      emoji("⏰", "alarme", "hora lembrete"),
      emoji("📍", "local", "pin endereco"),
      emoji("💬", "mensagem", "chat conversa"),
      emoji("📌", "fixar", "pin prioridade"),
      emoji("✅", "feito", "ok concluido"),
      emoji("⚠️", "alerta", "atenção aviso"),
    ],
  },
  {
    id: "symbols",
    label: "Símbolos",
    icon: "#",
    items: [
      emoji("✅", "confirmado", "check ok"),
      emoji("❌", "cancelado", "x erro"),
      emoji("⚠️", "atenção", "alerta aviso"),
      emoji("🔴", "vermelho", "status parar"),
      emoji("🟡", "amarelo", "pendente atencao"),
      emoji("🟢", "verde", "ativo ok"),
      emoji("🔵", "azul", "info"),
      emoji("⭐", "favorito", "estrela"),
      emoji("➡️", "proximo", "seta direita"),
      emoji("⬅️", "voltar", "seta esquerda"),
      emoji("➕", "mais", "adicionar"),
      emoji("🔎", "buscar", "lupa pesquisa"),
    ],
  },
];

const allEmojiEntries = uniqueEmojiEntries(emojiCategories.flatMap((category) => category.items));

export function Composer({
  conversationId,
  actionDraft,
  onClearActionDraft,
  onCreateOptimisticSend,
  onOptimisticSendFailed,
  onOptimisticSendQueued,
}: ComposerProps) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingMs, setRecordingMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voicePreview, setVoicePreview] = useState<VoicePreview | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [emojiCategory, setEmojiCategory] = useState<EmojiCategoryId>("faces");
  const [recentEmojis, setRecentEmojis] = useState<EmojiEntry[]>(readRecentEmojis);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [quickReplyQuery, setQuickReplyQuery] = useState("");
  const [quickReplyTitle, setQuickReplyTitle] = useState("");
  const [quickReplyShortcut, setQuickReplyShortcut] = useState("");
  const [quickReplyCategory, setQuickReplyCategory] = useState("");
  const [quickReplyBody, setQuickReplyBody] = useState("");
  const [mediaUploading, setMediaUploading] = useState<"image" | "video" | "document" | null>(
    null,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastActionDraftKindRef = useRef<MessageActionDraft["kind"] | null>(null);

  const send = trpc.messages.send.useMutation();

  const sendVoice = trpc.messages.sendVoice.useMutation();
  const sendMedia = trpc.messages.sendMedia.useMutation();
  const quickReplies = trpc.quickReplies.list.useQuery(
    {
      query: quickReplyQuery.trim() || undefined,
      limit: 8,
    },
    {
      enabled: conversationId != null && quickRepliesOpen,
    },
  );
  const createQuickReply = trpc.quickReplies.create.useMutation({
    onSuccess() {
      setQuickReplyTitle("");
      setQuickReplyShortcut("");
      setQuickReplyCategory("");
      setQuickReplyBody("");
      void utils.quickReplies.list.invalidate();
      toast.push({
        title: "Resposta rápida salva",
        description: "Ela já aparece no Composer para reutilização.",
        variant: "success",
      });
    },
    onError(error) {
      toast.push({
        title: "Falha ao salvar resposta",
        description: error.message,
        variant: "danger",
      });
    },
  });
  const markQuickReplyUsed = trpc.quickReplies.markUsed.useMutation({
    onSuccess() {
      void utils.quickReplies.list.invalidate();
    },
  });

  const visibleEmojiEntries = useMemo(() => {
    const query = normalizeEmojiSearch(emojiQuery);
    const fallbackEntries = emojiCategories[0]?.items ?? [];
    if (query) {
      return allEmojiEntries.filter((entry) => emojiMatchesQuery(entry, query)).slice(0, 30);
    }
    if (emojiCategory === "recent") {
      return recentEmojis.length > 0 ? recentEmojis : fallbackEntries;
    }
    return (
      emojiCategories.find((category) => category.id === emojiCategory)?.items ?? fallbackEntries
    );
  }, [emojiCategory, emojiQuery, recentEmojis]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
    }
  }, [text]);

  useEffect(() => {
    if (!actionDraft) {
      if (lastActionDraftKindRef.current === "forward" || lastActionDraftKindRef.current === "edit") {
        setText("");
      }
      lastActionDraftKindRef.current = null;
      return;
    }
    lastActionDraftKindRef.current = actionDraft.kind;
    if (actionDraft.kind === "forward" || actionDraft.kind === "edit") {
      setText(actionDraft.text);
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [actionDraft?.draftId, actionDraft?.kind, actionDraft?.text]);

  useEffect(() => {
    return () => {
      stopRecorderRuntime();
      setVoicePreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return null;
      });
    };
  }, []);

  useEffect(() => {
    discardVoiceRecording();
  }, [conversationId]);

  function submit() {
    if (!conversationId || !text.trim() || send.isPending) return;
    const body = text.trim();
    const optimistic = onCreateOptimisticSend?.({ conversationId, body });
    setText("");
    onClearActionDraft?.();
    send.mutate(
      { conversationId, body },
      {
        onSuccess(result) {
          if (optimistic && result.job) {
            onOptimisticSendQueued?.(optimistic.clientMutationId, result.job.id);
          }
          void utils.conversations.list.invalidate();
          void utils.jobs.list.invalidate();
        },
        onError(error) {
          if (optimistic) {
            onOptimisticSendFailed?.(optimistic.clientMutationId, error.message);
          } else {
            setText(body);
          }
          toast.push({ title: "Falha ao enviar", description: error.message, variant: "danger" });
        },
      },
    );
  }

  function insertTextAtCursor(value: string) {
    const textarea = inputRef.current;
    setText((current) => {
      const start = textarea?.selectionStart ?? current.length;
      const end = textarea?.selectionEnd ?? current.length;
      const next = `${current.slice(0, start)}${value}${current.slice(end)}`;
      window.requestAnimationFrame(() => {
        textarea?.focus();
        const cursor = start + value.length;
        textarea?.setSelectionRange(cursor, cursor);
      });
      return next;
    });
  }

  function insertEmoji(entry: EmojiEntry) {
    insertTextAtCursor(entry.emoji);
    setRecentEmojis((current) => {
      const next = [entry, ...current.filter((item) => item.emoji !== entry.emoji)].slice(
        0,
        emojiRecentLimit,
      );
      writeRecentEmojis(next);
      return next;
    });
    window.requestAnimationFrame(() => setEmojiOpen(true));
  }

  function insertQuickReply(reply: QuickReply) {
    insertTextAtCursor(reply.body);
    markQuickReplyUsed.mutate({ id: reply.id });
  }

  function saveQuickReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickReplyTitle.trim() || !quickReplyBody.trim() || createQuickReply.isPending) return;
    createQuickReply.mutate({
      title: quickReplyTitle,
      body: quickReplyBody,
      shortcut: quickReplyShortcut.trim() || null,
      category: quickReplyCategory.trim() || null,
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  async function toggleRecording() {
    if (recordingState === "recording") {
      stopRecording();
      return;
    }
    await startRecording();
  }

  async function startRecording() {
    if (!conversationId) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.push({
        title: "Gravação indisponível",
        description: "Este navegador não expôs MediaRecorder/getUserMedia.",
        variant: "danger",
      });
      return;
    }

    try {
      clearVoicePreview();
      discardRecordingRef.current = false;
      recordingChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      startVoiceMeter(stream);

      const mimeType = preferredVoiceMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const elapsed = Math.max(1_000, Date.now() - (recordingStartedAtRef.current ?? Date.now()));
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        stopRecorderRuntime();
        if (discardRecordingRef.current) {
          recordingChunksRef.current = [];
          discardRecordingRef.current = false;
          setRecordingState("idle");
          setRecordingMs(0);
          return;
        }
        if (blob.size === 0) {
          setRecordingState("idle");
          toast.push({
            title: "Áudio vazio",
            description: "Nenhum dado de áudio foi capturado.",
            variant: "danger",
          });
          return;
        }
        replaceVoicePreview({
          blob,
          durationMs: elapsed,
          fileName: voiceFileName(blob.type),
          mimeType: blob.type || "audio/webm",
          sizeBytes: blob.size,
          url: URL.createObjectURL(blob),
        });
        setRecordingState("recorded");
        setRecordingMs(elapsed);
      };

      const startedAt = Date.now();
      recordingStartedAtRef.current = startedAt;
      setRecordingMs(0);
      setRecordingState("recording");
      recorder.start(250);
      timerRef.current = window.setInterval(() => {
        setRecordingMs(Date.now() - startedAt);
      }, 250);
    } catch (error) {
      stopRecorderRuntime();
      setRecordingState("idle");
      toast.push({
        title: "Falha ao gravar",
        description:
          error instanceof Error ? error.message : "Permissão ou dispositivo indisponível.",
        variant: "danger",
      });
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }

  function discardVoiceRecording() {
    if (recordingState === "recording") {
      discardRecordingRef.current = true;
      stopRecording();
    } else {
      stopRecorderRuntime();
      clearVoicePreview();
      setRecordingState("idle");
      setRecordingMs(0);
    }
  }

  async function uploadVoicePreview() {
    if (!conversationId || !voicePreview || voiceUploading || sendVoice.isPending) return;
    setVoiceUploading(true);
    try {
      const formData = new FormData();
      formData.set("type", "voice");
      formData.set("durationMs", String(Math.round(voicePreview.durationMs)));
      formData.set("file", voicePreview.blob, voicePreview.fileName);

      const csrfToken = csrfFromCookie();
      const response = await fetch(`${API_URL}/api/media/upload`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const mediaAssetId = readUploadedMediaAssetId(await response.json());
      await sendVoice.mutateAsync({ conversationId, mediaAssetId });
      clearVoicePreview();
      setRecordingState("idle");
      setRecordingMs(0);
      toast.push({
        title: "Áudio enfileirado",
        description: "O worker vai preparar o WAV com ffprobe/ffmpeg antes de enviar.",
        variant: "success",
      });
      void utils.messages.listByConversation.invalidate();
      void utils.conversations.list.invalidate();
      void utils.jobs.list.invalidate();
    } catch (error) {
      toast.push({
        title: "Falha ao enviar áudio",
        description:
          error instanceof Error ? error.message : "Não foi possível enfileirar o voice.",
        variant: "danger",
      });
    } finally {
      setVoiceUploading(false);
    }
  }

  async function uploadComposerMedia(file: File, type: "image" | "video" | "document") {
    if (!conversationId || mediaUploading || sendMedia.isPending) return;
    setMediaUploading(type);
    try {
      const formData = new FormData();
      formData.set("type", type);
      formData.set("conversationId", String(conversationId));
      formData.set("file", file, file.name);

      const csrfToken = csrfFromCookie();
      const response = await fetch(`${API_URL}/api/media/upload`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const mediaAssetId = readUploadedMediaAssetId(await response.json());
      const caption = text.trim() || null;
      await sendMedia.mutateAsync({ conversationId, mediaAssetId, caption });
      if (caption) {
        setText("");
      }
      toast.push({
        title:
          type === "image"
            ? "Foto enfileirada"
            : type === "video"
              ? "Vídeo enfileirado"
              : "Documento enfileirado",
        description: "O worker vai anexar o arquivo no WhatsApp com a política de envio ativa.",
        variant: "success",
      });
      void utils.messages.listByConversation.invalidate();
      void utils.conversations.list.invalidate();
      void utils.jobs.list.invalidate();
    } catch (error) {
      toast.push({
        title: "Falha ao anexar",
        description: error instanceof Error ? error.message : "Não foi possível enfileirar mídia.",
        variant: "danger",
      });
    } finally {
      setMediaUploading(null);
    }
  }

  function replaceVoicePreview(next: VoicePreview) {
    setVoicePreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return next;
    });
  }

  function clearVoicePreview() {
    setVoicePreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  function startVoiceMeter(stream: MediaStream) {
    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    audioContextRef.current = audioContext;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      setVoiceLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      meterFrameRef.current = window.requestAnimationFrame(draw);
    };
    draw();
  }

  function stopRecorderRuntime() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (meterFrameRef.current != null) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    recordingStartedAtRef.current = null;
    setVoiceLevel(0);
  }

  if (conversationId == null) return null;

  const voiceBusy = recordingState === "recording" || voiceUploading || sendVoice.isPending;
  const canSendVoice = Boolean(voicePreview) && !voiceBusy;

  return (
    <div className="rounded-xxl bg-bg-base shadow-raised-md p-3">
      {actionDraft ? (
        <div
          data-testid="composer-action-draft"
          data-action-kind={actionDraft.kind}
          className={cn(
            "mb-3 flex items-start gap-3 rounded-xl border border-brand-cyan/18 bg-white/[0.045] px-3 py-2.5",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl",
          )}
        >
          <div className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-cyan/10 text-brand-cyan">
            {actionDraft.kind === "reply" ? (
              <Reply className="h-3.5 w-3.5" />
            ) : actionDraft.kind === "edit" ? (
              <Save className="h-3.5 w-3.5" />
            ) : (
              <Forward className="h-3.5 w-3.5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.62rem] uppercase tracking-widest text-brand-cyan">
              {actionDraft.kind === "reply"
                ? "Respondendo"
                : actionDraft.kind === "edit"
                  ? "Editando rascunho"
                  : "Encaminhando"}{" "}
              · #{actionDraft.messageId}
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-muted">
              {actionDraft.excerpt}
            </div>
          </div>
          <button
            type="button"
            aria-label="Cancelar ação da mensagem"
            onClick={onClearActionDraft}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none transition hover:bg-white/[0.07] hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-brand-cyan/45"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {recordingState !== "idle" || voicePreview ? (
        <VoiceRecorderPanel
          state={recordingState}
          elapsedMs={recordingMs}
          level={voiceLevel}
          preview={voicePreview}
          sending={voiceUploading || sendVoice.isPending}
          canSend={canSendVoice}
          onStop={stopRecording}
          onDiscard={discardVoiceRecording}
          onSend={uploadVoicePreview}
        />
      ) : null}
      <div className="flex items-end gap-2">
        <div className="flex items-center gap-1">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadComposerMedia(file, "image");
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadComposerMedia(file, "video");
            }}
          />
          <input
            ref={documentInputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadComposerMedia(file, "document");
            }}
          />
          {[
            {
              icon: Image,
              label: "Foto",
              testId: "composer-attach-image",
              onClick: () => imageInputRef.current?.click(),
              active: mediaUploading === "image",
            },
            {
              icon: Video,
              label: "Vídeo",
              testId: "composer-attach-video",
              onClick: () => videoInputRef.current?.click(),
              active: mediaUploading === "video",
            },
            {
              icon: File,
              label: "Documento",
              testId: "composer-attach-document",
              onClick: () => documentInputRef.current?.click(),
              active: mediaUploading === "document",
            },
            {
              icon: recordingState === "recording" ? StopCircle : Mic,
              label: recordingState === "recording" ? "Parar gravação" : "Gravar áudio",
              onClick: toggleRecording,
              testId: "composer-voice-record-button",
              active: recordingState === "recording",
            },
          ].map(({ icon: Icon, label, onClick, active, testId }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 1, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 380, damping: 22 }}
                  onClick={onClick}
                  aria-label={label}
                  data-testid={testId}
                  data-recording-state={recordingState}
                  data-uploading={active ? "true" : undefined}
                  disabled={Boolean(mediaUploading)}
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bg-base shadow-flat transition-shadow",
                    "text-fg-muted hover:shadow-raised-sm hover:text-fg-primary",
                    "disabled:cursor-wait disabled:opacity-60",
                    active && "text-brand-cyan shadow-glow-cyan",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
          <EmojiPicker
            open={emojiOpen}
            onOpenChange={setEmojiOpen}
            query={emojiQuery}
            onQueryChange={setEmojiQuery}
            category={emojiCategory}
            onCategoryChange={setEmojiCategory}
            recentCount={recentEmojis.length}
            entries={visibleEmojiEntries}
            onSelect={insertEmoji}
          />
          <QuickRepliesPicker
            open={quickRepliesOpen}
            onOpenChange={setQuickRepliesOpen}
            query={quickReplyQuery}
            onQueryChange={setQuickReplyQuery}
            replies={quickReplies.data?.quickReplies ?? []}
            loading={quickReplies.isLoading}
            title={quickReplyTitle}
            shortcut={quickReplyShortcut}
            category={quickReplyCategory}
            body={quickReplyBody}
            saving={createQuickReply.isPending}
            onTitleChange={setQuickReplyTitle}
            onShortcutChange={setQuickReplyShortcut}
            onCategoryChange={setQuickReplyCategory}
            onBodyChange={setQuickReplyBody}
            onSave={saveQuickReply}
            onSelect={insertQuickReply}
          />
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Mensagem… (enter envia · shift+enter quebra)"
          data-testid="composer-textarea"
          rows={1}
          className={cn(
            "flex-1 resize-none bg-bg-base shadow-pressed-sm rounded-lg",
            "px-4 py-2.5 text-sm placeholder:text-fg-dim outline-none",
            "focus:ring-2 focus:ring-brand-cyan/40 transition-shadow",
          )}
          style={{ minHeight: "2.5rem", maxHeight: "10rem" }}
        />
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ y: 1, scale: 0.96 }}
                onClick={() => documentInputRef.current?.click()}
                aria-label="Anexar"
                data-testid="composer-attach-menu"
                disabled={Boolean(mediaUploading)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bg-base shadow-flat hover:shadow-raised-sm text-fg-muted hover:text-fg-primary transition-shadow"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </motion.button>
            </TooltipTrigger>
            <TooltipContent>Anexar</TooltipContent>
          </Tooltip>
          <Button
            size="md"
            variant="accent"
            onClick={submit}
            loading={send.isPending}
            disabled={!text.trim()}
            leftIcon={<Send className="h-3.5 w-3.5" />}
            data-testid="composer-send-button"
          >
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

function VoiceRecorderPanel({
  state,
  elapsedMs,
  level,
  preview,
  sending,
  canSend,
  onStop,
  onDiscard,
  onSend,
}: {
  state: RecordingState;
  elapsedMs: number;
  level: number;
  preview: VoicePreview | null;
  sending: boolean;
  canSend: boolean;
  onStop: () => void;
  onDiscard: () => void;
  onSend: () => void;
}) {
  const isRecording = state === "recording";
  const normalizedLevel = Math.max(level, isRecording ? 0.08 : 0);
  return (
    <div
      data-testid="composer-voice-preview"
      data-recording-state={state}
      className={cn(
        "mb-3 rounded-xl border px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl",
        isRecording
          ? "border-brand-cyan/30 bg-brand-cyan/10"
          : "border-emerald-300/20 bg-emerald-300/8",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            isRecording ? "bg-brand-cyan/12 text-brand-cyan" : "bg-emerald-300/12 text-emerald-200",
          )}
        >
          {isRecording ? (
            <AudioWaveform className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">
              {isRecording ? "Gravando áudio" : "Áudio pronto"}
            </span>
            <span className="font-mono text-[0.68rem] text-fg-muted tabular-nums">
              {formatDuration(elapsedMs)}
            </span>
          </div>
          <div className="mt-2 flex h-7 items-end gap-1" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, index) => {
              const wave = Math.sin(index * 0.85 + elapsedMs / 160) * 0.5 + 0.5;
              const height = 18 + Math.round((wave * 0.55 + normalizedLevel * 0.45) * 58);
              return (
                <span
                  key={index}
                  className={cn(
                    "w-1 rounded-full transition-[height,background-color]",
                    isRecording ? "bg-brand-cyan/75" : "bg-emerald-200/65",
                  )}
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
          {preview ? (
            <audio
              data-testid="composer-voice-audio"
              className="mt-2 h-8 w-full max-w-sm"
              src={preview.url}
              controls
              preload="metadata"
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {preview ? (
            <span className="hidden font-mono text-[0.65rem] text-fg-dim sm:inline">
              {formatFileSize(preview.sizeBytes)}
            </span>
          ) : null}
          {isRecording ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onStop}
              leftIcon={<StopCircle className="h-3.5 w-3.5" />}
            >
              Parar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="accent"
              onClick={onSend}
              loading={sending}
              disabled={!canSend}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              data-testid="composer-voice-send-button"
            >
              Enviar áudio
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Descartar áudio"
                onClick={onDiscard}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted outline-none transition hover:bg-white/[0.07] hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-brand-cyan/45"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Descartar áudio</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function EmojiPicker({
  open,
  onOpenChange,
  query,
  onQueryChange,
  category,
  onCategoryChange,
  recentCount,
  entries,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  category: EmojiCategoryId;
  onCategoryChange: (category: EmojiCategoryId) => void;
  recentCount: number;
  entries: EmojiEntry[];
  onSelect: (entry: EmojiEntry) => void;
}) {
  const tabs: Array<{ id: EmojiCategoryId; label: string; icon: string }> = [
    ...(recentCount > 0 ? [{ id: "recent" as const, label: "Recentes", icon: "↺" }] : []),
    ...emojiCategories.map((item) => ({ id: item.id, label: item.label, icon: item.icon })),
  ];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ y: 1, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          aria-label="Emoji"
          data-testid="composer-emoji-button"
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bg-base shadow-flat transition-shadow",
            "text-fg-muted hover:shadow-raised-sm hover:text-fg-primary",
            open && "text-brand-cyan shadow-glow-cyan",
          )}
        >
          <Smile className="h-3.5 w-3.5" />
        </motion.button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(21rem,calc(100vw-2rem))] border border-contour-line/40 bg-bg-base/95 p-3 shadow-lift backdrop-blur-xl"
        data-testid="composer-emoji-picker"
      >
        <div className="space-y-3">
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar emoji"
            data-testid="composer-emoji-search"
            className={cn(
              "h-9 w-full rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm",
              "outline-none transition-shadow placeholder:text-fg-dim focus:ring-2 focus:ring-brand-cyan/40",
            )}
          />
          <div className="flex gap-1" role="tablist" aria-label="Categorias de emoji">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={category === tab.id}
                aria-label={tab.label}
                title={tab.label}
                onClick={() => onCategoryChange(tab.id)}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-base text-sm shadow-flat transition-shadow",
                  category === tab.id
                    ? "text-brand-cyan shadow-raised-sm"
                    : "text-fg-muted hover:text-fg-primary hover:shadow-raised-sm",
                )}
              >
                {tab.icon}
              </button>
            ))}
          </div>
          <div
            className="grid max-h-52 grid-cols-6 gap-1 overflow-y-auto pr-1"
            data-testid="composer-emoji-grid"
          >
            {entries.map((entry) => (
              <button
                key={`${entry.emoji}-${entry.label}`}
                type="button"
                aria-label={`Inserir emoji ${entry.label}`}
                title={entry.label}
                data-testid="composer-emoji-option"
                data-emoji={entry.emoji}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(entry)}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-lg bg-bg-base text-xl shadow-flat transition",
                  "hover:scale-[1.04] hover:shadow-raised-sm focus-visible:ring-2 focus-visible:ring-brand-cyan/45",
                )}
              >
                {entry.emoji}
              </button>
            ))}
          </div>
          {entries.length === 0 ? (
            <div className="rounded-lg bg-bg-base p-3 text-center text-xs text-fg-muted shadow-flat">
              Nenhum emoji
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QuickRepliesPicker({
  open,
  onOpenChange,
  query,
  onQueryChange,
  replies,
  loading,
  title,
  shortcut,
  category,
  body,
  saving,
  onTitleChange,
  onShortcutChange,
  onCategoryChange,
  onBodyChange,
  onSave,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  replies: QuickReply[];
  loading: boolean;
  title: string;
  shortcut: string;
  category: string;
  body: string;
  saving: boolean;
  onTitleChange: (title: string) => void;
  onShortcutChange: (shortcut: string) => void;
  onCategoryChange: (category: string) => void;
  onBodyChange: (body: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (reply: QuickReply) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ y: 1, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          aria-label="Respostas rápidas"
          data-testid="composer-quick-replies-button"
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bg-base shadow-flat transition-shadow",
            "text-fg-muted hover:shadow-raised-sm hover:text-fg-primary",
            open && "text-brand-cyan shadow-glow-cyan",
          )}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
        </motion.button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(25rem,calc(100vw-2rem))] border border-contour-line/40 bg-bg-base/95 p-3 shadow-lift backdrop-blur-xl"
        data-testid="composer-quick-replies-panel"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-cyan/10 text-brand-cyan">
              <MessageSquareText className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg-primary">Respostas rápidas</div>
              <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                salvas no crm
              </div>
            </div>
          </div>

          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar resposta"
            data-testid="composer-quick-reply-search"
            className={cn(
              "h-9 w-full rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm",
              "outline-none transition-shadow placeholder:text-fg-dim focus:ring-2 focus:ring-brand-cyan/40",
            )}
          />

          <div
            className="max-h-44 space-y-1 overflow-y-auto pr-1"
            data-testid="composer-quick-replies-list"
          >
            {loading ? (
              <div className="rounded-lg bg-bg-base p-3 text-xs text-fg-muted shadow-flat">
                Carregando respostas...
              </div>
            ) : replies.length === 0 ? (
              <div className="rounded-lg bg-bg-base p-3 text-xs text-fg-muted shadow-flat">
                Nenhuma resposta salva
              </div>
            ) : (
              replies.map((reply) => (
                <button
                  key={reply.id}
                  type="button"
                  data-testid="composer-quick-reply-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(reply)}
                  className={cn(
                    "w-full rounded-lg bg-bg-base px-3 py-2 text-left shadow-flat transition",
                    "hover:shadow-raised-sm focus-visible:ring-2 focus-visible:ring-brand-cyan/45",
                  )}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg-primary">
                      {reply.title}
                    </span>
                    {reply.shortcut ? (
                      <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-widest text-brand-cyan">
                        /{reply.shortcut}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-fg-muted">
                    {reply.body}
                  </span>
                </button>
              ))
            )}
          </div>

          <form
            className="space-y-2 border-t border-contour-line/30 pt-3"
            data-testid="composer-quick-reply-form"
            onSubmit={onSave}
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_0.82fr]">
              <input
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Título"
                data-testid="composer-quick-reply-title"
                className={cn(
                  "h-9 rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm",
                  "outline-none transition-shadow placeholder:text-fg-dim focus:ring-2 focus:ring-brand-cyan/40",
                )}
              />
              <input
                value={shortcut}
                onChange={(event) => onShortcutChange(event.target.value)}
                placeholder="Atalho"
                data-testid="composer-quick-reply-shortcut"
                className={cn(
                  "h-9 rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm",
                  "outline-none transition-shadow placeholder:text-fg-dim focus:ring-2 focus:ring-brand-cyan/40",
                )}
              />
            </div>
            <input
              value={category}
              onChange={(event) => onCategoryChange(event.target.value)}
              placeholder="Categoria"
              data-testid="composer-quick-reply-category"
              className={cn(
                "h-9 w-full rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm",
                "outline-none transition-shadow placeholder:text-fg-dim focus:ring-2 focus:ring-brand-cyan/40",
              )}
            />
            <textarea
              value={body}
              onChange={(event) => onBodyChange(event.target.value)}
              placeholder="Texto da resposta"
              rows={3}
              data-testid="composer-quick-reply-body"
              className={cn(
                "min-h-20 w-full resize-none rounded-lg bg-bg-base px-3 py-2 text-sm shadow-pressed-sm",
                "outline-none transition-shadow placeholder:text-fg-dim focus:ring-2 focus:ring-brand-cyan/40",
              )}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={saving}
              disabled={!title.trim() || !body.trim()}
              leftIcon={saving ? undefined : <Save className="h-3.5 w-3.5" />}
              data-testid="composer-save-quick-reply"
            >
              Salvar resposta
            </Button>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function preferredVoiceMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return voiceRecorderMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function voiceFileName(mimeType: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  return `nuoma-voice-${stamp}.${extension}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readUploadedMediaAssetId(payload: unknown): number {
  const asset = (payload as { asset?: { id?: unknown } }).asset;
  if (typeof asset?.id !== "number") {
    throw new Error("Upload de áudio não retornou mediaAssetId");
  }
  return asset.id;
}

function emoji(emojiValue: string, label: string, keywords: string): EmojiEntry {
  return {
    emoji: emojiValue,
    label,
    keywords: [label, ...keywords.split(/\s+/).filter(Boolean)],
  };
}

function uniqueEmojiEntries(entries: EmojiEntry[]): EmojiEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.emoji)) {
      return false;
    }
    seen.add(entry.emoji);
    return true;
  });
}

function normalizeEmojiSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function emojiMatchesQuery(entry: EmojiEntry, query: string): boolean {
  if (entry.emoji === query) {
    return true;
  }
  return entry.keywords.some((keyword) => normalizeEmojiSearch(keyword).includes(query));
}

function readRecentEmojis(): EmojiEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(emojiRecentStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const byEmoji = new Map(allEmojiEntries.map((entry) => [entry.emoji, entry]));
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => byEmoji.get(value))
      .filter((entry): entry is EmojiEntry => Boolean(entry))
      .slice(0, emojiRecentLimit);
  } catch {
    return [];
  }
}

function writeRecentEmojis(entries: EmojiEntry[]): void {
  try {
    window.localStorage.setItem(
      emojiRecentStorageKey,
      JSON.stringify(entries.slice(0, emojiRecentLimit).map((entry) => entry.emoji)),
    );
  } catch {
    // Recent emojis are a convenience cache; failure should not block composing.
  }
}
