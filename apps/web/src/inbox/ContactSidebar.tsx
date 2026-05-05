import {
  Bot,
  CalendarClock,
  CheckCircle2,
  FileText,
  Hash,
  History,
  Image as ImageIcon,
  Megaphone,
  MessageSquare,
  Mic,
  Paperclip,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  User,
  Video,
  Workflow,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import {
  Animate,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  ChannelIcon,
  EmptyState,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SignalDot,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TimeAgo,
  cn,
  useToast,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";
import { mediaAssetUrl } from "../lib/media-url.js";
import { INBOX_CONVERSATION_LIMIT } from "./conversation-list-config.js";
import { conversationDisplayTitle, conversationIdentityLine } from "./conversation-display.js";
import { MarkdownLitePreview } from "./MarkdownLitePreview.js";

interface ContactSidebarProps {
  conversationId: number | null;
}

interface AutomationTriggerFeedback {
  automationName: string;
  dryRun: boolean;
  eligible: boolean;
  reasons: string[];
  jobsCreated: number;
  wouldEnqueueJobs: boolean;
}

interface CampaignDispatchFeedback {
  campaignName: string;
  dryRun: boolean;
  eligible: boolean;
  reasons: string[];
  recipientsPlanned: number;
  recipientsCreated: number;
  jobsCreated: number | null;
}

export function ContactSidebar({ conversationId }: ContactSidebarProps) {
  const toast = useToast();
  const conversations = trpc.conversations.list.useQuery({ limit: INBOX_CONVERSATION_LIMIT });
  const conversation = conversations.data?.conversations.find((c) => c.id === conversationId);

  const [activeTab, setActiveTab] = useState("details");
  const [notesDraft, setNotesDraft] = useState("");
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [instagramDraft, setInstagramDraft] = useState("");
  const [draggedTagId, setDraggedTagId] = useState<number | null>(null);
  const [historyDepth, setHistoryDepth] = useState(3);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDueAt, setReminderDueAt] = useState(() => defaultReminderDueAt());
  const [automationPickerOpen, setAutomationPickerOpen] = useState(false);
  const [automationSearch, setAutomationSearch] = useState("");
  const [automationOnlyEligible, setAutomationOnlyEligible] = useState(true);
  const [automationFeedback, setAutomationFeedback] = useState<AutomationTriggerFeedback | null>(
    null,
  );
  const [campaignPickerOpen, setCampaignPickerOpen] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignOnlyEligible, setCampaignOnlyEligible] = useState(true);
  const [campaignFeedback, setCampaignFeedback] = useState<CampaignDispatchFeedback | null>(null);
  const utils = trpc.useUtils();
  const contactDetails = trpc.contacts.get.useQuery(
    { id: conversation?.contactId ?? 0 },
    { enabled: conversation?.contactId != null },
  );
  const tags = trpc.tags.list.useQuery(undefined, { enabled: conversationId != null });
  const reminders = trpc.reminders.list.useQuery(
    { conversationId: conversationId ?? undefined, status: "open", limit: 20 },
    { enabled: conversationId != null },
  );
  const attachmentCandidates = trpc.media.attachmentCandidatesByConversation.useQuery(
    { conversationId: conversationId ?? 0, limit: 4 },
    { enabled: conversationId != null },
  );
  const automationCandidates = trpc.automations.listForConversation.useQuery(
    {
      conversationId: conversationId ?? 0,
      search: automationSearch.trim() || undefined,
      onlyEligible: automationOnlyEligible,
      limit: 20,
    },
    { enabled: conversationId != null && automationPickerOpen },
  );
  const campaignCandidates = trpc.campaigns.listForConversation.useQuery(
    {
      conversationId: conversationId ?? 0,
      search: campaignSearch.trim() || undefined,
      onlyEligible: campaignOnlyEligible,
      limit: 20,
    },
    { enabled: conversationId != null && campaignPickerOpen },
  );
  const updateContact = trpc.contacts.update.useMutation({
    async onSuccess(result) {
      toast.push({ title: "Contato atualizado", variant: "success" });
      if (result.contact) {
        await utils.contacts.get.invalidate({ id: result.contact.id });
      }
      await utils.contacts.list.invalidate();
      await utils.conversations.list.invalidate();
    },
    onError(error) {
      toast.push({
        title: "Falha ao atualizar contato",
        description: error.message,
        variant: "danger",
      });
    },
  });
  const createReminder = trpc.reminders.create.useMutation({
    async onSuccess() {
      setReminderTitle("");
      setReminderDueAt(defaultReminderDueAt());
      toast.push({ title: "Lembrete criado", variant: "success" });
      await utils.reminders.list.invalidate({
        conversationId: conversationId ?? undefined,
        status: "open",
        limit: 20,
      });
      await reminders.refetch();
    },
    onError(error) {
      toast.push({
        title: "Falha ao criar lembrete",
        description: error.message,
        variant: "danger",
      });
    },
  });
  const completeReminder = trpc.reminders.complete.useMutation({
    async onSuccess() {
      toast.push({ title: "Lembrete concluído", variant: "success" });
      await utils.reminders.list.invalidate({
        conversationId: conversationId ?? undefined,
        status: "open",
        limit: 20,
      });
      await reminders.refetch();
    },
    onError(error) {
      toast.push({
        title: "Falha ao concluir lembrete",
        description: error.message,
        variant: "danger",
      });
    },
  });
  const forceSync = trpc.conversations.forceSync.useMutation({
    onSuccess() {
      toast.push({ title: "Sincronização enfileirada", variant: "success" });
      void utils.conversations.list.invalidate();
      void utils.messages.listByConversation.invalidate();
    },
    onError(error) {
      toast.push({ title: "Falha", description: error.message, variant: "danger" });
    },
  });

  function handleReminderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation) return;
    const title = reminderTitle.trim();
    const dueAt = parseReminderDueAt(reminderDueAt);
    if (!title || !dueAt) {
      toast.push({
        title: "Lembrete incompleto",
        description: "Preencha texto e data/hora.",
        variant: "warning",
      });
      return;
    }
    createReminder.mutate({
      conversationId: conversation.id,
      title,
      notes: null,
      dueAt,
    });
  }
  const forceHistorySync = trpc.conversations.forceHistorySync.useMutation({
    onSuccess() {
      toast.push({ title: "Histórico enfileirado", variant: "success" });
      void utils.conversations.list.invalidate();
      void utils.messages.listByConversation.invalidate();
    },
    onError(error) {
      toast.push({ title: "Falha", description: error.message, variant: "danger" });
    },
  });
  const triggerAutomation = trpc.automations.trigger.useMutation({
    onSuccess(result) {
      setAutomationFeedback({
        automationName: result.automation?.name ?? "Automação",
        dryRun: result.dryRun,
        eligible: result.eligible,
        reasons: result.reasons,
        jobsCreated: result.jobsCreated,
        wouldEnqueueJobs: result.wouldEnqueueJobs,
      });
      toast.push({
        title: result.dryRun ? "Prévia calculada" : "Automação disparada",
        description: result.dryRun
          ? result.wouldEnqueueJobs
            ? "Execução real criaria job de envio."
            : "Execução real não criaria envio."
          : `${result.jobsCreated} job(s) criado(s).`,
        variant: result.eligible ? "success" : "warning",
      });
      void utils.automations.listForConversation.invalidate();
    },
    onError(error) {
      toast.push({
        title: "Falha ao disparar automação",
        description: error.message,
        variant: "danger",
      });
    },
  });
  const executeCampaign = trpc.campaigns.execute.useMutation({
    onSuccess(result) {
      const reasons = result.rejected.map((item) => item.reason);
      setCampaignFeedback({
        campaignName: result.campaign?.name ?? "Campanha",
        dryRun: result.dryRun,
        eligible: result.recipientsPlanned > 0 && reasons.length === 0,
        reasons,
        recipientsPlanned: result.recipientsPlanned,
        recipientsCreated: result.recipientsCreated,
        jobsCreated: result.scheduler?.jobsCreated ?? null,
      });
      toast.push({
        title: result.dryRun ? "Prévia calculada" : "Campanha disparada",
        description: result.dryRun
          ? `${result.recipientsPlanned} destinatário(s) planejado(s).`
          : `${result.recipientsCreated} destinatário(s) criado(s).`,
        variant: reasons.length === 0 ? "success" : "warning",
      });
      void utils.campaigns.listForConversation.invalidate();
      void utils.campaigns.list.invalidate();
    },
    onError(error) {
      toast.push({
        title: "Falha ao disparar campanha",
        description: error.message,
        variant: "danger",
      });
    },
  });

  const contact = contactDetails.data?.contact ?? null;

  useEffect(() => {
    setNotesDraft(contact?.notes ?? "");
    setNameDraft(contact?.name ?? "");
    setPhoneDraft(contact?.phone ?? "");
    setEmailDraft(contact?.email ?? "");
    setInstagramDraft(contact?.instagramHandle ?? "");
    setDetailsEditing(false);
  }, [
    contact?.email,
    contact?.id,
    contact?.instagramHandle,
    contact?.name,
    contact?.notes,
    contact?.phone,
  ]);

  function handleAutomationTrigger(automationId: number, dryRun: boolean) {
    if (!conversation) return;
    triggerAutomation.mutate({
      id: automationId,
      conversationId: conversation.id,
      dryRun,
      allowedPhone: "5531982066263",
    });
  }

  function handleCampaignDispatch(campaignId: number, dryRun: boolean) {
    if (!conversation) return;
    executeCampaign.mutate({
      campaignId,
      conversationId: conversation.id,
      dryRun,
      allowedPhone: "5531982066263",
      maxRecipients: 1,
    });
  }

  function handleTagToggle(tagId: number) {
    if (!contact) return;
    const nextTagIds = new Set(contact.tagIds);
    if (nextTagIds.has(tagId)) {
      nextTagIds.delete(tagId);
    } else {
      nextTagIds.add(tagId);
    }
    updateContact.mutate({
      id: contact.id,
      tagIds: Array.from(nextTagIds).sort((left, right) => left - right),
    });
  }

  function handleTagDrop(targetTagId: number) {
    if (!contact || draggedTagId == null || draggedTagId === targetTagId) {
      setDraggedTagId(null);
      return;
    }
    const reordered = reorderTagIds(contact.tagIds, draggedTagId, targetTagId);
    if (reordered.join(",") !== contact.tagIds.join(",")) {
      updateContact.mutate({
        id: contact.id,
        tagIds: reordered,
      });
    }
    setDraggedTagId(null);
  }

  function handleContactDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contact) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      toast.push({
        title: "Nome obrigatório",
        description: "O contato precisa continuar com um nome visível.",
        variant: "warning",
      });
      return;
    }
    updateContact.mutate(
      {
        id: contact.id,
        name: nextName,
        phone: phoneDraft.trim() || null,
        email: emailDraft.trim() || null,
        instagramHandle: instagramDraft.trim().replace(/^@/, "") || null,
      },
      {
        onSuccess() {
          setDetailsEditing(false);
        },
      },
    );
  }

  function handleNotesSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contact) return;
    const nextNotes = notesDraft.trim() ? notesDraft : null;
    updateContact.mutate({
      id: contact.id,
      notes: nextNotes,
    });
  }

  if (!conversation) {
    return (
      <aside
        data-testid="inbox-contact-sidebar"
        className="flex flex-col h-full rounded-xxl bg-bg-base shadow-raised-md overflow-hidden"
      >
        <div className="flex-1 flex items-center justify-center">
          <EmptyState description="Selecione uma conversa." />
        </div>
      </aside>
    );
  }

  const displayTitle = conversationDisplayTitle(conversation);
  const identity = conversationIdentityLine(conversation);
  const phone = conversation.externalThreadId.replace(/\D/g, "");
  const initials = displayTitle.slice(0, 2).toUpperCase();
  const profilePhotoShortHash = conversation.profilePhotoSha256?.slice(0, 12) ?? null;
  const avatarUrl = mediaAssetUrl(
    contact?.profilePhotoMediaAssetId ?? conversation.profilePhotoMediaAssetId,
  );
  const allTags = tags.data?.tags ?? [];
  const activeTags = contact
    ? contact.tagIds
        .map((tagId) => allTags.find((tag) => tag.id === tagId))
        .filter((tag): tag is NonNullable<(typeof allTags)[number]> => Boolean(tag))
    : [];
  const availableTags = contact
    ? allTags.filter((tag) => !contact.tagIds.includes(tag.id))
    : allTags;

  return (
    <aside
      data-testid="inbox-contact-sidebar"
      className="flex flex-col h-full rounded-xxl bg-bg-base shadow-raised-md overflow-hidden"
    >
      <Animate preset="rise-in" className="p-5 border-b border-contour-line/40">
        <div className="flex items-start gap-4">
          <div className="relative">
            <Avatar className="h-14 w-14">
              {avatarUrl ? (
                <AvatarImage src={avatarUrl} alt={displayTitle} data-testid="inbox-profile-avatar-image" />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1">
              <SignalDot status="active" size="sm" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium truncate">{displayTitle}</div>
            <div className="font-mono text-[0.65rem] text-fg-dim mt-1">{identity}</div>
            <div className="flex items-center gap-2 mt-3">
              <ChannelIcon channel={conversation.channel} variant="chip" />
              {conversation.unreadCount > 0 && (
                <Badge variant="cyan">{conversation.unreadCount} não lidas</Badge>
              )}
              {conversation.profilePhotoMediaAssetId ? (
                <Badge variant="success">Foto sincronizada</Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="soft"
            loading={forceSync.isPending}
            leftIcon={<RefreshCw className="h-3 w-3" />}
            onClick={() =>
              forceSync.mutate({
                id: conversation.id,
                phone: phone.length >= 10 ? phone : undefined,
              })
            }
          >
            Ressincronizar
          </Button>
          <Button
            size="sm"
            variant="soft"
            loading={forceHistorySync.isPending}
            leftIcon={<History className="h-3 w-3" />}
            onClick={() =>
              forceHistorySync.mutate({
                id: conversation.id,
                phone: phone.length >= 10 ? phone : undefined,
                maxScrolls: historyDepth,
              })
            }
          >
            Histórico
          </Button>
          <label
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md bg-bg-base px-3 text-sm text-fg-muted shadow-flat",
              "focus-within:ring-2 focus-within:ring-brand-cyan/50",
            )}
          >
            <History className="h-3 w-3" />
            <select
              value={historyDepth}
              onChange={(event) => setHistoryDepth(Number(event.target.value))}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              aria-label="Profundidade do histórico"
            >
              <option value={3}>3 janelas</option>
              <option value={10}>10 janelas</option>
              <option value={25}>25 janelas</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="soft"
            leftIcon={<Hash className="h-3 w-3" />}
            onClick={() => setActiveTab("tags")}
            data-testid="inbox-open-tags-tab"
          >
            Tag
          </Button>
          <Popover open={automationPickerOpen} onOpenChange={setAutomationPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="soft"
                leftIcon={<Workflow className="h-3 w-3" />}
                data-testid="inbox-automation-trigger"
              >
                Automação
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(23rem,calc(100vw-2rem))] overflow-hidden p-0"
              data-testid="inbox-automation-picker"
            >
              <div className="border-b border-contour-line/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Bot className="h-4 w-4 text-brand-cyan" />
                      <span>Disparar automação</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                      {automationCandidates.data?.conversation.phone ?? (phone || "sem telefone")}
                    </div>
                  </div>
                  <Badge
                    variant={
                      automationCandidates.data?.conversation.canDispatchReal
                        ? "success"
                        : "warning"
                    }
                  >
                    {automationCandidates.data?.conversation.canDispatchReal
                      ? "real ok"
                      : "real bloqueado"}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-dim" />
                    <Input
                      value={automationSearch}
                      onChange={(event) => setAutomationSearch(event.target.value)}
                      placeholder="Buscar automação..."
                      className="h-9 pl-9"
                      data-testid="inbox-automation-search"
                    />
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-lg bg-bg-subtle px-3 py-2 shadow-pressed-sm">
                    <span className="text-xs text-fg-muted">Mostrar só elegíveis</span>
                    <Switch
                      checked={automationOnlyEligible}
                      onCheckedChange={setAutomationOnlyEligible}
                      aria-label="Mostrar só automações elegíveis"
                      data-testid="inbox-automation-only-eligible"
                    />
                  </label>
                </div>
              </div>

              <div className="max-h-[18rem] overflow-y-auto p-3">
                {automationCandidates.isLoading ? (
                  <div className="rounded-lg bg-bg-subtle p-3 text-xs text-fg-muted shadow-pressed-sm">
                    Avaliando automações...
                  </div>
                ) : automationCandidates.error ? (
                  <div className="rounded-lg bg-bg-subtle p-3 text-xs text-semantic-danger shadow-pressed-sm">
                    {automationCandidates.error.message}
                  </div>
                ) : (automationCandidates.data?.automations.length ?? 0) === 0 ? (
                  <EmptyState
                    title="Sem elegíveis"
                    description="Ajuste a busca ou desative o filtro de elegibilidade."
                  />
                ) : (
                  <div className="space-y-2">
                    {automationCandidates.data?.automations.map((item) => (
                      <div
                        key={item.automation.id}
                        data-testid="inbox-automation-option"
                        className={cn(
                          "rounded-lg bg-bg-subtle p-3 shadow-pressed-sm",
                          item.eligible && "shadow-glow-cyan",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-fg-primary">
                              {item.automation.name}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge variant={item.eligible ? "success" : "warning"}>
                                {item.eligible ? "elegível" : "bloqueada"}
                              </Badge>
                              <Badge variant="neutral">{item.automation.category}</Badge>
                              <Badge variant="neutral">{item.sendStepCount} envio(s)</Badge>
                            </div>
                          </div>
                          {!item.eligible ? (
                            <ShieldAlert className="h-4 w-4 text-semantic-warning" />
                          ) : null}
                        </div>
                        {!item.eligible && item.reasons.length > 0 ? (
                          <div className="mt-2 truncate font-mono text-[0.65rem] text-fg-dim">
                            {item.reasons.map(formatAutomationReason).join(", ")}
                          </div>
                        ) : null}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Button
                            size="xs"
                            variant="soft"
                            loading={triggerAutomation.isPending}
                            leftIcon={<PlayCircle className="h-3 w-3" />}
                            onClick={() => handleAutomationTrigger(item.automation.id, true)}
                            data-testid="inbox-automation-preview"
                          >
                            Prévia
                          </Button>
                          <Button
                            size="xs"
                            variant="accent"
                            loading={triggerAutomation.isPending}
                            disabled={
                              !item.eligible ||
                              automationCandidates.data?.conversation.canDispatchReal !== true
                            }
                            leftIcon={<Send className="h-3 w-3" />}
                            onClick={() => handleAutomationTrigger(item.automation.id, false)}
                            data-testid="inbox-automation-dispatch"
                          >
                            Disparar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {automationFeedback ? (
                <div
                  className="border-t border-contour-line/40 bg-bg-subtle p-3"
                  data-testid="inbox-automation-result"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-fg-primary">
                        {automationFeedback.automationName}
                      </div>
                      <div className="mt-1 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                        {automationFeedback.dryRun ? "prévia" : "execução"} ·{" "}
                        {automationFeedback.eligible ? "elegível" : "bloqueada"}
                      </div>
                    </div>
                    <Badge variant={automationFeedback.eligible ? "success" : "warning"}>
                      {automationFeedback.dryRun
                        ? automationFeedback.wouldEnqueueJobs
                          ? "criaria job"
                          : "sem job"
                        : `${automationFeedback.jobsCreated} job`}
                    </Badge>
                  </div>
                  {automationFeedback.reasons.length > 0 ? (
                    <div className="mt-2 truncate font-mono text-[0.65rem] text-fg-dim">
                      {automationFeedback.reasons.map(formatAutomationReason).join(", ")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
          <Popover open={campaignPickerOpen} onOpenChange={setCampaignPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="soft"
                leftIcon={<Megaphone className="h-3 w-3" />}
                data-testid="inbox-campaign-trigger"
              >
                Campanha
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(23rem,calc(100vw-2rem))] overflow-hidden p-0"
              data-testid="inbox-campaign-picker"
            >
              <div className="border-b border-contour-line/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Megaphone className="h-4 w-4 text-brand-cyan" />
                      <span>Disparar campanha</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                      {campaignCandidates.data?.conversation.phone ?? (phone || "sem telefone")}
                    </div>
                  </div>
                  <Badge
                    variant={
                      campaignCandidates.data?.conversation.canDispatchReal ? "success" : "warning"
                    }
                  >
                    {campaignCandidates.data?.conversation.canDispatchReal
                      ? "real ok"
                      : "real bloqueado"}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-dim" />
                    <Input
                      value={campaignSearch}
                      onChange={(event) => setCampaignSearch(event.target.value)}
                      placeholder="Buscar campanha..."
                      className="h-9 pl-9"
                      data-testid="inbox-campaign-search"
                    />
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-lg bg-bg-subtle px-3 py-2 shadow-pressed-sm">
                    <span className="text-xs text-fg-muted">Mostrar só elegíveis</span>
                    <Switch
                      checked={campaignOnlyEligible}
                      onCheckedChange={setCampaignOnlyEligible}
                      aria-label="Mostrar só campanhas elegíveis"
                      data-testid="inbox-campaign-only-eligible"
                    />
                  </label>
                </div>
              </div>

              <div className="max-h-[18rem] overflow-y-auto p-3">
                {campaignCandidates.isLoading ? (
                  <div className="rounded-lg bg-bg-subtle p-3 text-xs text-fg-muted shadow-pressed-sm">
                    Avaliando campanhas...
                  </div>
                ) : campaignCandidates.error ? (
                  <div className="rounded-lg bg-bg-subtle p-3 text-xs text-semantic-danger shadow-pressed-sm">
                    {campaignCandidates.error.message}
                  </div>
                ) : (campaignCandidates.data?.campaigns.length ?? 0) === 0 ? (
                  <EmptyState
                    title="Sem elegíveis"
                    description="Ajuste a busca ou desative o filtro de elegibilidade."
                  />
                ) : (
                  <div className="space-y-2">
                    {campaignCandidates.data?.campaigns.map((item) => (
                      <div
                        key={item.campaign.id}
                        data-testid="inbox-campaign-option"
                        className={cn(
                          "rounded-lg bg-bg-subtle p-3 shadow-pressed-sm",
                          item.eligible && "shadow-glow-cyan",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-fg-primary">
                              {item.campaign.name}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge variant={item.eligible ? "success" : "warning"}>
                                {item.eligible ? "elegível" : "bloqueada"}
                              </Badge>
                              <Badge variant="neutral">{item.campaign.status}</Badge>
                              <Badge variant="neutral">{item.stepsCount} step(s)</Badge>
                              {item.firstStepType ? (
                                <Badge variant="neutral">{item.firstStepType}</Badge>
                              ) : null}
                            </div>
                          </div>
                          {!item.eligible ? (
                            <ShieldAlert className="h-4 w-4 text-semantic-warning" />
                          ) : null}
                        </div>
                        {!item.eligible && item.reasons.length > 0 ? (
                          <div className="mt-2 truncate font-mono text-[0.65rem] text-fg-dim">
                            {item.reasons.map(formatCampaignReason).join(", ")}
                          </div>
                        ) : null}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Button
                            size="xs"
                            variant="soft"
                            loading={executeCampaign.isPending}
                            disabled={!item.eligible}
                            leftIcon={<PlayCircle className="h-3 w-3" />}
                            onClick={() => handleCampaignDispatch(item.campaign.id, true)}
                            data-testid="inbox-campaign-preview"
                          >
                            Prévia
                          </Button>
                          <Button
                            size="xs"
                            variant="accent"
                            loading={executeCampaign.isPending}
                            disabled={
                              !item.eligible ||
                              campaignCandidates.data?.conversation.canDispatchReal !== true
                            }
                            leftIcon={<Send className="h-3 w-3" />}
                            onClick={() => handleCampaignDispatch(item.campaign.id, false)}
                            data-testid="inbox-campaign-dispatch"
                          >
                            Disparar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {campaignFeedback ? (
                <div
                  className="border-t border-contour-line/40 bg-bg-subtle p-3"
                  data-testid="inbox-campaign-result"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-fg-primary">
                        {campaignFeedback.campaignName}
                      </div>
                      <div className="mt-1 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                        {campaignFeedback.dryRun ? "prévia" : "execução"} ·{" "}
                        {campaignFeedback.eligible ? "elegível" : "bloqueada"}
                      </div>
                    </div>
                    <Badge variant={campaignFeedback.eligible ? "success" : "warning"}>
                      {campaignFeedback.dryRun
                        ? `${campaignFeedback.recipientsPlanned} alvo`
                        : `${campaignFeedback.jobsCreated ?? 0} job`}
                    </Badge>
                  </div>
                  {campaignFeedback.reasons.length > 0 ? (
                    <div className="mt-2 truncate font-mono text-[0.65rem] text-fg-dim">
                      {campaignFeedback.reasons.map(formatCampaignReason).join(", ")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
      </Animate>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-4">
          <TabsList className="grid w-full grid-cols-5 gap-1 p-1">
            <TabsTrigger value="details" className="min-w-0 flex-1 px-2 text-[0.72rem]">
              <User className="mr-1 h-3 w-3 shrink-0" />
              <span className="truncate">Detal.</span>
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="min-w-0 flex-1 px-2 text-[0.72rem]"
              data-testid="inbox-history-tab"
              title="Histórico"
            >
              <History className="mr-1 h-3 w-3 shrink-0" />
              <span className="truncate">Hist.</span>
            </TabsTrigger>
            <TabsTrigger
              value="tags"
              className="min-w-0 flex-1 px-2 text-[0.72rem]"
              data-testid="inbox-tags-tab"
            >
              <Hash className="mr-1 h-3 w-3 shrink-0" />
              <span className="truncate">Tags</span>
            </TabsTrigger>
            <TabsTrigger
              value="notes"
              className="min-w-0 flex-1 px-2 text-[0.72rem]"
              data-testid="inbox-notes-tab"
            >
              <MessageSquare className="mr-1 h-3 w-3 shrink-0" />
              <span className="truncate">Notas</span>
            </TabsTrigger>
            <TabsTrigger
              value="reminders"
              className="min-w-0 flex-1 px-2 text-[0.72rem]"
              data-testid="inbox-reminders-tab"
              title="Lembretes"
            >
              <CalendarClock className="mr-1 h-3 w-3 shrink-0" />
              <span className="truncate">Lembr.</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <TabsContent value="details" className="mt-4 space-y-3">
            {contact ? (
              <form
                className="rounded-lg bg-bg-base p-3 shadow-flat"
                data-testid="inbox-contact-inline-edit"
                data-editing={detailsEditing ? "true" : undefined}
                onSubmit={handleContactDetailsSubmit}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-fg-primary">Contato</div>
                    <div className="mt-1 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                      edição inline
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="soft"
                    onClick={() => setDetailsEditing((value) => !value)}
                    data-testid="inbox-contact-edit-toggle"
                  >
                    {detailsEditing ? "Fechar" : "Editar"}
                  </Button>
                </div>
                {detailsEditing ? (
                  <div className="mt-3 grid gap-2">
                    <Input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder="Nome"
                      data-testid="inbox-contact-edit-name"
                    />
                    <Input
                      value={phoneDraft}
                      onChange={(event) => setPhoneDraft(event.target.value)}
                      placeholder="Telefone"
                      data-testid="inbox-contact-edit-phone"
                    />
                    <Input
                      value={emailDraft}
                      onChange={(event) => setEmailDraft(event.target.value)}
                      placeholder="Email"
                      data-testid="inbox-contact-edit-email"
                    />
                    <Input
                      value={instagramDraft}
                      onChange={(event) => setInstagramDraft(event.target.value)}
                      placeholder="@instagram"
                      data-testid="inbox-contact-edit-instagram"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="soft"
                        disabled={updateContact.isPending}
                        onClick={() => {
                          setNameDraft(contact.name);
                          setPhoneDraft(contact.phone ?? "");
                          setEmailDraft(contact.email ?? "");
                          setInstagramDraft(contact.instagramHandle ?? "");
                          setDetailsEditing(false);
                        }}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        loading={updateContact.isPending}
                        leftIcon={<CheckCircle2 className="h-3 w-3" />}
                        data-testid="inbox-contact-edit-save"
                      >
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2">
                    <Field label="Nome" value={contact.name} />
                    <Field label="Telefone" value={contact.phone ?? "sem telefone"} mono />
                    <Field label="Email" value={contact.email ?? "sem email"} mono />
                    <Field
                      label="Instagram"
                      value={contact.instagramHandle ? `@${contact.instagramHandle}` : "sem IG"}
                      mono
                    />
                  </div>
                )}
              </form>
            ) : null}
            <Field label="ID" value={`#${conversation.id}`} />
            <Field label="External" value={conversation.externalThreadId} mono />
            <Field label="Canal" value={conversation.channel} mono />
            {conversation.lastMessageAt && (
              <Field
                label="Última msg"
                value={
                  <TimeAgo date={conversation.lastMessageAt} className="text-fg-primary text-xs" />
                }
              />
            )}
            <Field label="Não lidas" value={String(conversation.unreadCount)} mono />
            <Field
              label="Contato"
              value={conversation.contactId ? `#${conversation.contactId}` : "sem vínculo"}
              mono
            />
            {contact ? (
              <Field label="Status" value={contact.status} mono />
            ) : contactDetails.isLoading ? (
              <Field label="Status" value="carregando..." mono />
            ) : null}
            <div
              data-testid="inbox-profile-photo-status"
              className={cn(
                "rounded-lg bg-bg-base p-3 shadow-flat",
                conversation.profilePhotoMediaAssetId && "shadow-glow-cyan",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-base shadow-pressed-sm text-brand-cyan">
                  <ImageIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg-primary">Foto de perfil</div>
                  {conversation.profilePhotoMediaAssetId ? (
                    <div className="mt-1 space-y-1 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                      <div className="truncate">asset #{conversation.profilePhotoMediaAssetId}</div>
                      <div className="truncate">sha {profilePhotoShortHash}</div>
                      {conversation.profilePhotoUpdatedAt ? (
                        <div className="truncate">
                          capturada{" "}
                          <TimeAgo
                            date={conversation.profilePhotoUpdatedAt}
                            className="text-[0.65rem]"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-fg-muted">Ainda sem foto capturada.</div>
                  )}
                </div>
              </div>
            </div>
            <div
              data-testid="inbox-attachment-candidates-status"
              className={cn(
                "rounded-lg bg-bg-base p-3 shadow-flat",
                (attachmentCandidates.data?.total ?? 0) > 0 && "shadow-glow-cyan",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-base shadow-pressed-sm text-brand-cyan">
                  <Paperclip className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-fg-primary">Anexos capturados</div>
                    <Badge
                      variant={(attachmentCandidates.data?.total ?? 0) > 0 ? "success" : "neutral"}
                      data-testid="inbox-attachment-candidates-total"
                    >
                      {attachmentCandidates.data?.total ?? 0}
                    </Badge>
                  </div>
                  {attachmentCandidates.isLoading ? (
                    <div className="mt-2 text-xs text-fg-muted">Carregando evidências...</div>
                  ) : attachmentCandidates.data?.candidates.length ? (
                    <div className="mt-3 space-y-2">
                      {attachmentCandidates.data.candidates.map((candidate) => {
                        const Icon = attachmentIcon(candidate.contentType);
                        const metadataFileName =
                          typeof candidate.metadata.fileName === "string"
                            ? candidate.metadata.fileName
                            : null;
                        return (
                          <div
                            key={candidate.id}
                            className="rounded-md bg-bg-subtle px-2.5 py-2 shadow-pressed-sm"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
                              <span className="truncate text-xs font-medium text-fg-primary">
                                {attachmentLabel(candidate.contentType)}
                              </span>
                              <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                                asset #{candidate.mediaAssetId}
                              </span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[0.62rem] text-fg-muted">
                              {candidate.mediaAsset?.fileName ?? metadataFileName ?? "sem arquivo"}
                            </div>
                            <div className="mt-1 flex min-w-0 items-center justify-between gap-2 font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim">
                              <span className="truncate">
                                {candidate.externalMessageId ?? "sem msg externa"}
                              </span>
                              <TimeAgo
                                date={candidate.observedAt}
                                className="shrink-0 text-[0.6rem]"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-fg-muted">
                      Ainda sem anexos capturados nesta conversa.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-3" data-testid="inbox-history-panel">
            <div className="rounded-lg bg-bg-base p-3 shadow-flat">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-base text-brand-cyan shadow-pressed-sm">
                  <RefreshCw className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg-primary">Sincronização atual</div>
                  <div className="mt-1 text-xs text-fg-muted">
                    Enfileira leitura rápida da conversa selecionada.
                  </div>
                  <Button
                    size="sm"
                    variant="soft"
                    className="mt-3 w-full"
                    loading={forceSync.isPending}
                    leftIcon={<RefreshCw className="h-3 w-3" />}
                    onClick={() =>
                      forceSync.mutate({
                        id: conversation.id,
                        phone: phone.length >= 10 ? phone : undefined,
                      })
                    }
                    data-testid="inbox-history-force-sync"
                  >
                    Ressincronizar conversa
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-bg-base p-3 shadow-flat">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-base text-brand-cyan shadow-pressed-sm">
                  <History className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg-primary">Histórico antigo</div>
                  <div className="mt-1 text-xs text-fg-muted">
                    Enfileira scroll bounded no WhatsApp Web para tentar capturar mensagens
                    anteriores.
                  </div>
                  <label className="mt-3 block space-y-1.5">
                    <span className="font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                      Janelas
                    </span>
                    <select
                      value={historyDepth}
                      onChange={(event) => setHistoryDepth(Number(event.target.value))}
                      className="h-10 w-full rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm outline-none focus:ring-2 focus:ring-brand-cyan/40"
                      aria-label="Profundidade do histórico"
                      data-testid="inbox-history-depth"
                    >
                      <option value={3}>3 janelas</option>
                      <option value={10}>10 janelas</option>
                      <option value={25}>25 janelas</option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="soft"
                    className="mt-3 w-full"
                    loading={forceHistorySync.isPending}
                    leftIcon={<History className="h-3 w-3" />}
                    onClick={() =>
                      forceHistorySync.mutate({
                        id: conversation.id,
                        phone: phone.length >= 10 ? phone : undefined,
                        maxScrolls: historyDepth,
                      })
                    }
                    data-testid="inbox-history-force-history"
                  >
                    Enfileirar histórico
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-bg-base p-3 shadow-flat">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Canal" value={conversation.channel} mono />
                <Field label="Thread" value={conversation.externalThreadId} mono />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="tags" className="mt-4 space-y-4" data-testid="inbox-tags-panel">
            {!contact ? (
              <EmptyState
                title="Sem contato vinculado"
                description="Vincule a conversa a um contato para editar tags."
              />
            ) : tags.isLoading ? (
              <div className="rounded-lg bg-bg-base p-3 text-xs text-fg-muted shadow-flat">
                Carregando tags...
              </div>
            ) : (tags.data?.tags.length ?? 0) === 0 ? (
              <EmptyState
                title="Sem tags cadastradas"
                description="Crie tags na área de contatos para usar neste chat."
              />
            ) : (
              <>
                <div className="rounded-lg bg-bg-base p-3 shadow-flat">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-fg-primary">Tags ativas</div>
                      <div className="mt-1 text-xs text-fg-muted">
                        Clique para remover ou adicionar.
                      </div>
                    </div>
                    <Badge variant="cyan" data-testid="inbox-active-tags-count">
                      {contact.tagIds.length}
                    </Badge>
                  </div>
                  <div
                    className="mt-3 flex flex-wrap gap-2"
                    data-testid="inbox-active-tags-sortable"
                  >
                    {activeTags.length === 0 ? (
                      <div className="rounded-md bg-bg-subtle px-2.5 py-2 text-xs text-fg-muted shadow-pressed-sm">
                        Nenhuma tag ativa.
                      </div>
                    ) : (
                      activeTags.map((tag, index) => (
                        <button
                          key={tag.id}
                          type="button"
                          draggable
                          onDragStart={() => setDraggedTagId(tag.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => handleTagDrop(tag.id)}
                          onDragEnd={() => setDraggedTagId(null)}
                          onClick={() => handleTagToggle(tag.id)}
                          disabled={updateContact.isPending}
                          data-testid="inbox-tag-active"
                          data-tag-order={index}
                          className={cn(
                            "inline-flex min-h-8 max-w-full cursor-grab items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-flat",
                            "outline-none transition-shadow hover:shadow-raised-sm focus-visible:ring-2 focus-visible:ring-brand-cyan/60",
                            "border-brand-cyan/35 bg-brand-cyan/10 text-fg-primary",
                            draggedTagId === tag.id && "cursor-grabbing opacity-70",
                          )}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="truncate">{tag.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                  {availableTags.length > 0 ? (
                    <div className="mt-3 border-t border-contour-line/30 pt-3">
                      <div className="mb-2 font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                        Disponíveis
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableTags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleTagToggle(tag.id)}
                            disabled={updateContact.isPending}
                            data-testid="inbox-tag-available"
                            className={cn(
                              "inline-flex min-h-8 max-w-full items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-flat",
                              "border-contour-line/50 bg-bg-subtle text-fg-muted outline-none transition-shadow",
                              "hover:shadow-raised-sm focus-visible:ring-2 focus-visible:ring-brand-cyan/60",
                            )}
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="truncate">{tag.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg bg-bg-base p-3 shadow-flat">
                  <div className="text-sm font-medium text-fg-primary">Resumo</div>
                  <div className="mt-2 space-y-1 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                    <div>contato #{contact.id}</div>
                    <div>{contact.tagIds.length} tag(s) aplicada(s)</div>
                    <div>{tags.data?.tags.length ?? 0} tag(s) disponíveis</div>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="notes" className="mt-4 space-y-3" data-testid="inbox-notes-panel">
            {!contact ? (
              <EmptyState
                title="Sem contato vinculado"
                description="Vincule a conversa a um contato para salvar notas."
              />
            ) : (
              <form className="space-y-3" onSubmit={handleNotesSubmit}>
                <label className="block space-y-1.5">
                  <span className="font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                    Editor
                  </span>
                  <textarea
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    placeholder="# Resumo&#10;- Próximo passo&#10;[Link](https://exemplo.com)"
                    data-testid="inbox-contact-notes-input"
                    className={cn(
                      "min-h-[132px] w-full resize-y rounded-lg bg-bg-base p-3 text-sm shadow-pressed-sm",
                      "outline-none transition-shadow focus:ring-2 focus:ring-brand-cyan/40",
                    )}
                  />
                </label>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                      Preview
                    </span>
                    <Badge variant="neutral">markdown lite</Badge>
                  </div>
                  <MarkdownLitePreview value={notesDraft} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p
                    className="font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim"
                    data-testid="inbox-contact-notes-count"
                  >
                    persistente · {notesDraft.length} chars
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="soft"
                      disabled={notesDraft === (contact.notes ?? "") || updateContact.isPending}
                      onClick={() => setNotesDraft(contact.notes ?? "")}
                    >
                      Reverter
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      loading={updateContact.isPending}
                      disabled={notesDraft === (contact.notes ?? "")}
                      leftIcon={<CheckCircle2 className="h-3 w-3" />}
                      data-testid="inbox-contact-notes-save"
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </TabsContent>

          <TabsContent value="reminders" className="mt-4 space-y-4">
            <form
              className="space-y-3"
              onSubmit={handleReminderSubmit}
              data-testid="inbox-reminder-form"
            >
              <label className="block space-y-1.5">
                <span className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
                  Texto
                </span>
                <input
                  value={reminderTitle}
                  onChange={(event) => setReminderTitle(event.target.value)}
                  placeholder="Retornar orçamento"
                  data-testid="inbox-reminder-title"
                  className={cn(
                    "h-10 w-full rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm",
                    "outline-none transition-shadow focus:ring-2 focus:ring-brand-cyan/40",
                  )}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
                  Data e hora
                </span>
                <input
                  type="datetime-local"
                  value={reminderDueAt}
                  onChange={(event) => setReminderDueAt(event.target.value)}
                  data-testid="inbox-reminder-due-at"
                  className={cn(
                    "h-10 w-full rounded-lg bg-bg-base px-3 text-sm shadow-pressed-sm",
                    "outline-none transition-shadow focus:ring-2 focus:ring-brand-cyan/40",
                  )}
                />
              </label>

              <Button
                type="submit"
                size="sm"
                className="w-full"
                loading={createReminder.isPending}
                leftIcon={<Plus className="h-3 w-3" />}
                data-testid="inbox-create-reminder"
              >
                Criar lembrete
              </Button>
            </form>

            <div className="space-y-2" data-testid="inbox-reminders-list">
              {reminders.isLoading ? (
                <div className="rounded-lg bg-bg-base p-3 text-xs text-fg-muted shadow-flat">
                  Carregando lembretes…
                </div>
              ) : (reminders.data?.reminders.length ?? 0) === 0 ? (
                <EmptyState
                  title="Sem lembretes abertos"
                  description="Crie um lembrete com texto e data para este chat."
                />
              ) : (
                reminders.data?.reminders.map((reminder) => (
                  <div
                    key={reminder.id}
                    data-testid="inbox-reminder-row"
                    className="rounded-lg bg-bg-base p-3 shadow-flat"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg-primary">
                          {reminder.title}
                        </div>
                        <div className="mt-1 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
                          {formatReminderDueAt(reminder.dueAt)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="soft"
                        title="Concluir lembrete"
                        loading={completeReminder.isPending}
                        leftIcon={<CheckCircle2 className="h-3 w-3" />}
                        onClick={() => completeReminder.mutate({ id: reminder.id })}
                        data-testid="inbox-complete-reminder"
                      >
                        OK
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

function defaultReminderDueAt(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return toDatetimeLocalValue(date);
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function parseReminderDueAt(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const reminderDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatReminderDueAt(value: string): string {
  return reminderDateFormatter.format(new Date(value));
}

function attachmentLabel(contentType: string): string {
  switch (contentType) {
    case "image":
      return "Imagem";
    case "video":
      return "Vídeo";
    case "voice":
      return "Voz";
    case "audio":
      return "Áudio";
    case "document":
      return "Documento";
    default:
      return "Anexo";
  }
}

function attachmentIcon(contentType: string) {
  switch (contentType) {
    case "image":
      return ImageIcon;
    case "video":
      return Video;
    case "audio":
    case "voice":
      return Mic;
    case "document":
      return FileText;
    default:
      return Paperclip;
  }
}

function formatAutomationReason(reason: string): string {
  switch (reason) {
    case "status_not_active":
      return "status inativo";
    case "trigger_type_mismatch":
      return "trigger diferente";
    case "channel_mismatch":
      return "canal diferente";
    case "outside_24h_window":
      return "fora da janela 24h";
    case "segment_mismatch":
      return "segmento não atende";
    case "invalid_phone":
      return "telefone inválido";
    case "not_allowlisted_for_test_execution":
      return "fora da allowlist";
    case "not_in_production_canary_allowlist":
      return "fora da canary";
    default:
      return reason.replaceAll("_", " ");
  }
}

function formatCampaignReason(reason: string): string {
  switch (reason) {
    case "status_not_runnable":
      return "status bloqueado";
    case "channel_not_supported":
      return "canal sem executor";
    case "channel_mismatch":
      return "canal diferente";
    case "invalid_phone":
      return "telefone inválido";
    case "duplicate_recipient":
      return "destinatário já existe";
    case "not_allowlisted_for_test_execution":
      return "fora da allowlist";
    case "not_in_production_canary_allowlist":
      return "fora da canary";
    default:
      return reason.replaceAll("_", " ");
  }
}

function reorderTagIds(tagIds: number[], draggedId: number, targetId: number): number[] {
  const next = [...tagIds];
  const from = next.indexOf(draggedId);
  const to = next.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return next;
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
        {label}
      </span>
      <span
        className={cn("text-sm text-fg-primary truncate text-right", mono && "font-mono text-xs")}
      >
        {value}
      </span>
    </div>
  );
}
