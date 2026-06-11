import {
  Animate,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  SegmentedControl,
  Textarea,
  TimeAgo,
  useToast,
} from "@nuoma/ui";
import {
  Clock3,
  Instagram,
  MessageCircle,
  MoreVertical,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Tag,
  UserRound,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";

import { trpc } from "../lib/trpc.js";

export function ContactsPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const contacts = trpc.contacts.list.useQuery({});
  const conversations = trpc.conversations.listUnified.useQuery(
    { limit: 500 },
    { staleTime: 30_000 },
  );
  const toast = useToast();
  const intent = usePageIntent();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [showCreateForm, setShowCreateForm] = useState(() => intent === "create");
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const filteredContacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (contacts.data?.contacts ?? []).filter((contact) => {
      const matchesChannel =
        channelFilter === "all" ||
        (channelFilter === "whatsapp" && contact.primaryChannel === "whatsapp") ||
        (channelFilter === "instagram" && contact.primaryChannel === "instagram");
      if (!matchesChannel) return false;
      if (!normalizedQuery) return true;
      return [
        contact.name,
        contact.phone,
        contact.email,
        contact.instagramHandle ? `@${contact.instagramHandle}` : "",
        contact.status,
        contact.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [channelFilter, contacts.data?.contacts, query]);
  const channelCounts = useMemo(() => {
    const allContacts = contacts.data?.contacts ?? [];
    return {
      all: allContacts.length,
      whatsapp: allContacts.filter((contact) => contact.primaryChannel === "whatsapp").length,
      instagram: allContacts.filter((contact) => contact.primaryChannel === "instagram").length,
    };
  }, [contacts.data?.contacts]);
  useEffect(() => {
    if (filteredContacts.length === 0) {
      setSelectedContactId(null);
      return;
    }
    const selectedIsVisible =
      selectedContactId != null &&
      filteredContacts.some((contact) => contact.id === selectedContactId);
    if (selectedContactId == null || !selectedIsVisible) {
      setSelectedContactId(filteredContacts[0]!.id);
    }
  }, [filteredContacts, selectedContactId]);

  const selectedContact =
    filteredContacts.find((contact) => contact.id === selectedContactId) ??
    contacts.data?.contacts.find((contact) => contact.id === selectedContactId) ??
    null;
  const selectedConversation = useMemo(() => {
    if (!selectedContact) return null;
    return (
      conversations.data?.conversations.find(
        (conversation) => conversation.contactId === selectedContact.id,
      ) ?? null
    );
  }, [conversations.data?.conversations, selectedContact]);
  const visibleContacts = filteredContacts.slice(0, 9);
  const recentContacts = filteredContacts.filter((contact) => contact.lastMessageAt).slice(0, 4);
  const createContact = trpc.contacts.create.useMutation({
    async onSuccess() {
      setName("");
      setPhone("");
      setInstagramHandle("");
      setNotes("");
      setShowCreateForm(false);
      await utils.contacts.list.invalidate();
      toast.push({ title: "Contato criado", variant: "success" });
    },
    onError(error) {
      toast.push({
        title: "Falha ao criar contato",
        description: error.message,
        variant: "danger",
      });
    },
  });

  function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanPhone = phone.replace(/\D/g, "");
    const cleanInstagram = instagramHandle.trim().replace(/^@/, "");
    createContact.mutate({
      name: name.trim(),
      phone: cleanPhone || null,
      instagramHandle: cleanInstagram || null,
      primaryChannel: cleanPhone ? "whatsapp" : "instagram",
      status: "lead",
      tagIds: [],
      notes: notes.trim() || null,
    });
  }

  function selectContact(contactId: number) {
    setSelectedContactId(contactId);
  }

  function handleContactKeyDown(event: KeyboardEvent<HTMLLIElement>, contactId: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectContact(contactId);
      return;
    }
    const currentIndex = visibleContacts.findIndex((contact) => contact.id === contactId);
    if (currentIndex < 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = visibleContacts[Math.min(currentIndex + 1, visibleContacts.length - 1)];
      if (next) selectContact(next.id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const previous = visibleContacts[Math.max(currentIndex - 1, 0)];
      if (previous) selectContact(previous.id);
    }
  }

  function openSelectedConversation() {
    if (!selectedContact) return;
    if (!selectedConversation) {
      toast.push({
        title: "Contato sem conversa",
        description: "A ação Responder fica disponível depois que existir conversa vinculada.",
        variant: "info",
      });
      return;
    }
    void navigate({
      to: "/inbox",
      search: { conversationId: selectedConversation.id },
    });
  }

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header">
          <p className="nuoma-compat-kicker">Contatos</p>
          <h1 className="nuoma-compat-display mt-2 text-3xl md:text-4xl">
            <span className="nuoma-gradient-text">Catálogo</span> ativo.
          </h1>
          <p className="text-sm text-fg-muted mt-3 max-w-xl">
            Contatos observados, criados ou importados, com busca operacional por canal.
          </p>
        </header>
      </Animate>

      {showCreateForm && (
        <Animate preset="rise-in" delaySeconds={0.08}>
          <Card>
            <CardHeader>
              <CardTitle>Criar contato</CardTitle>
              <CardDescription>
                Telefone pode ficar vazio quando o contato for só Instagram.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3 md:grid-cols-2" onSubmit={submitContact}>
                <Input
                  required
                  placeholder="Nome"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  placeholder="Telefone"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
                <Input
                  placeholder="@instagram"
                  value={instagramHandle}
                  onChange={(event) => setInstagramHandle(event.target.value)}
                />
                <Textarea
                  placeholder="Notas"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="md:col-span-2"
                />
                <div className="md:col-span-2 flex justify-end">
                  <Button
                    type="submit"
                    loading={createContact.isPending}
                    disabled={
                      !name.trim() || (!phone.replace(/\D/g, "") && !instagramHandle.trim())
                    }
                  >
                    Salvar contato
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </Animate>
      )}

      <Animate preset="rise-in" delaySeconds={0.1}>
        <section className="nuoma-ops-split nuoma-contacts-v2">
          <aside className="nuoma-ops-panel nuoma-contacts-list-panel">
            <div className="nuoma-ops-panel-head">
              <div>
                <h2>Lista ao vivo</h2>
                <p>
                  {contacts.data
                    ? `${filteredContacts.length}/${contacts.data.contacts.length} contatos`
                    : "—"}
                </p>
              </div>
              <Button
                variant="soft"
                size="sm"
                className="aspect-square px-0"
                aria-label="Criar contato"
                onClick={() => setShowCreateForm((current) => !current)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <label className="nuoma-ops-search">
              <Search className="h-4 w-4" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome, telefone, status ou nota"
                className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </label>
            <SegmentedControl
              size="sm"
              value={channelFilter}
              onValueChange={setChannelFilter}
              aria-label="Filtrar canal"
              options={[
                { value: "all", label: `Todos ${channelCounts.all}` },
                { value: "whatsapp", label: `WPP ${channelCounts.whatsapp}` },
                { value: "instagram", label: `IG ${channelCounts.instagram}` },
              ]}
            />
            {contacts.isLoading ? (
              <LoadingState />
            ) : contacts.error ? (
              <ErrorState description={contacts.error.message} />
            ) : !contacts.data || contacts.data.contacts.length === 0 ? (
              <EmptyState description="Nenhum contato encontrado. Crie um contato nesta tela ou use a importação CSV pela API." />
            ) : filteredContacts.length === 0 ? (
              <EmptyState description="Nenhum contato corresponde aos filtros atuais." />
            ) : (
              <ul className="nuoma-contact-list" role="listbox" aria-label="Lista de contatos">
                {visibleContacts.map((contact) => {
                  const active = contact.id === selectedContact?.id;
                  return (
                    <li
                      key={contact.id}
                      className={active ? "is-active" : undefined}
                      role="option"
                      aria-selected={active}
                      tabIndex={0}
                      onClick={() => selectContact(contact.id)}
                      onKeyDown={(event) => handleContactKeyDown(event, contact.id)}
                    >
                      <span className="nuoma-contact-avatar">
                        {contact.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <strong>{contact.name}</strong>
                        <em>{contact.phone ?? contact.instagramHandle ?? contact.status}</em>
                        <span>
                          <Badge
                            variant={contact.primaryChannel === "instagram" ? "warning" : "cyan"}
                          >
                            {contact.primaryChannel === "instagram" ? "IG" : "WA"}
                          </Badge>
                          <Badge variant={contact.status === "lead" ? "success" : "neutral"}>
                            {contact.status}
                          </Badge>
                        </span>
                      </span>
                      {contact.lastMessageAt ? <TimeAgo date={contact.lastMessageAt} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="nuoma-ops-panel nuoma-contact-detail-panel">
            <div className="nuoma-contact-titlebar">
              <div className="nuoma-contact-avatar is-large">
                {selectedContact ? selectedContact.name.slice(0, 2).toUpperCase() : "NC"}
              </div>
              <div className="min-w-0">
                <h2>{selectedContact?.name ?? "Nenhum contato selecionado"}</h2>
                <p>
                  {selectedContact?.phone ?? "sem telefone"} ·{" "}
                  {selectedContact?.instagramHandle
                    ? `@${selectedContact.instagramHandle}`
                    : "sem IG"}
                </p>
              </div>
              <Badge variant={selectedContact?.status === "lead" ? "success" : "neutral"}>
                {selectedContact?.status ?? "sem status"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="aspect-square px-0"
                aria-label="Mais ações"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </div>

            <div className="nuoma-contact-metrics">
              <div>
                <Phone className="h-4 w-4" />
                <span>Telefone</span>
                <strong>{selectedContact?.phone ?? "—"}</strong>
              </div>
              <div>
                <Instagram className="h-4 w-4" />
                <span>Instagram</span>
                <strong>
                  {selectedContact?.instagramHandle ? `@${selectedContact.instagramHandle}` : "—"}
                </strong>
              </div>
              <div>
                <Clock3 className="h-4 w-4" />
                <span>Última msg</span>
                <strong>
                  {selectedContact?.lastMessageAt ? (
                    <TimeAgo date={selectedContact.lastMessageAt} />
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
            </div>

            <div className="nuoma-contact-thread">
              <div className="nuoma-contact-message">
                <span>Perfil</span>
                <p>
                  {selectedContact?.notes ||
                    "Contato sem notas. Use este painel para revisar canal, status e histórico antes de acionar campanhas ou automações."}
                </p>
              </div>
              <div className="nuoma-contact-message is-outbound">
                <span>Próxima ação</span>
                <p>
                  Sem próxima ação registrada. Use uma conversa vinculada para responder ou acionar
                  rotinas pelo CRM.
                </p>
              </div>
            </div>

            <div className="nuoma-contact-composer">
              <button type="button">Detalhes</button>
              <button type="button">Histórico</button>
              <button type="button">Tags</button>
              <button type="button">Notas</button>
            </div>
          </section>

          <aside className="nuoma-ops-panel nuoma-contact-side-panel">
            <section>
              <div className="nuoma-ops-panel-head">
                <h2>Ações do contato</h2>
                <Badge variant="cyan">Catálogo</Badge>
              </div>
              <div className="nuoma-contact-action-grid">
                <button
                  type="button"
                  onClick={openSelectedConversation}
                  disabled={!selectedContact}
                >
                  <MessageCircle className="h-4 w-4" />
                  Responder
                </button>
                <button
                  type="button"
                  disabled
                  title="A edição de tags deste contato fica no CRM da Inbox."
                >
                  <Tag className="h-4 w-4" />
                  Tag
                </button>
                <button
                  type="button"
                  disabled
                  title="Seleção de campanha por contato ainda não está conectada nesta tela."
                >
                  <ShieldCheck className="h-4 w-4" />
                  Campanha
                </button>
              </div>
            </section>
            <section>
              <h2>Indicadores</h2>
              <div className="nuoma-contact-health">
                <strong>{selectedContact ? "—" : "—"}</strong>
                <span>{selectedContact ? "Sem indicador calculado" : "Sem seleção"}</span>
              </div>
              <dl className="nuoma-contact-facts">
                <dt>Canal</dt>
                <dd>{selectedContact?.primaryChannel ?? "—"}</dd>
                <dt>Status</dt>
                <dd>{selectedContact?.status ?? "—"}</dd>
                <dt>Tags</dt>
                <dd>{selectedContact?.tagIds.length ?? 0}</dd>
                <dt>ID</dt>
                <dd>#{selectedContact?.id ?? "—"}</dd>
              </dl>
            </section>
            <section>
              <h2>Trilha recente</h2>
              <ul className="nuoma-contact-audit">
                {(recentContacts.length > 0 ? recentContacts : visibleContacts.slice(0, 4)).map(
                  (contact) => (
                    <li key={contact.id}>
                      <UserRound className="h-4 w-4" />
                      <span>
                        <strong>{contact.name}</strong>
                        <em>
                          {contact.lastMessageAt ? (
                            <TimeAgo date={contact.lastMessageAt} />
                          ) : (
                            "sem interação"
                          )}
                        </em>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </section>
          </aside>
        </section>
      </Animate>
    </div>
  );
}

function usePageIntent() {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("intent");
  }, []);
}
