import {
  Animate,
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
import { Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { trpc } from "../lib/trpc.js";

export function ContactsPage() {
  const utils = trpc.useUtils();
  const contacts = trpc.contacts.list.useQuery({});
  const toast = useToast();
  const intent = usePageIntent();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
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
  const createContact = trpc.contacts.create.useMutation({
    async onSuccess() {
      setName("");
      setPhone("");
      setInstagramHandle("");
      setNotes("");
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

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header">
          <p className="botforge-kicker">Contatos</p>
          <h1 className="botforge-display mt-2 text-3xl md:text-4xl">
            <span className="nuoma-gradient-text">Catálogo</span> ativo.
          </h1>
          <p className="text-sm text-fg-muted mt-3 max-w-xl">
            Contatos observados, criados ou importados, com busca operacional por canal.
          </p>
        </header>
      </Animate>

      {intent === "create" && (
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
        <Card>
          <CardHeader>
            <CardTitle>Lista</CardTitle>
            <CardDescription>
              {contacts.data
                ? `${filteredContacts.length}/${contacts.data.contacts.length} contatos`
                : "—"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-bg-sunken/76 px-3 py-2 shadow-pressed-sm">
                <Search className="h-4 w-4 shrink-0 text-fg-dim" aria-hidden="true" />
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
            </div>
            {contacts.isLoading ? (
              <LoadingState />
            ) : contacts.error ? (
              <ErrorState description={contacts.error.message} />
            ) : !contacts.data || contacts.data.contacts.length === 0 ? (
              <EmptyState description="Nenhum contato encontrado. Crie um contato nesta tela ou use a importação CSV pela API." />
            ) : filteredContacts.length === 0 ? (
              <EmptyState description="Nenhum contato corresponde aos filtros atuais." />
            ) : (
              <ul className="flex flex-col gap-1">
                {filteredContacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-base hover:shadow-flat transition-shadow"
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">{contact.name}</div>
                      {contact.phone && (
                        <div className="font-mono text-[0.65rem] text-fg-dim">{contact.phone}</div>
                      )}
                    </div>
                    {contact.lastMessageAt && <TimeAgo date={contact.lastMessageAt} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
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
