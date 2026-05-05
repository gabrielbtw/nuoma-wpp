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
  Textarea,
  TimeAgo,
  useToast,
} from "@nuoma/ui";
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
      toast.push({ title: "Falha ao criar contato", description: error.message, variant: "danger" });
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
    <div className="flex flex-col gap-7 max-w-5xl mx-auto pt-2">
      <Animate preset="rise-in">
        <header>
          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-fg-dim font-mono">
            Contatos
          </p>
          <h1 className="font-serif italic text-5xl md:text-6xl leading-[1] mt-2 tracking-tight">
            <span className="text-brand-cyan">Catálogo</span> ativo.
          </h1>
          <p className="text-sm text-fg-muted mt-3 max-w-xl">
            Contatos observados ou importados. Filtros e segmentação chegam em V2.7.11/12.
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
                    disabled={!name.trim() || (!phone.replace(/\D/g, "") && !instagramHandle.trim())}
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
              {contacts.data ? `${contacts.data.contacts.length} contatos` : "—"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contacts.isLoading ? (
              <LoadingState />
            ) : contacts.error ? (
              <ErrorState description={contacts.error.message} />
            ) : !contacts.data || contacts.data.contacts.length === 0 ? (
              <EmptyState description="Nenhum contato. Importe via /contacts.import (em breve)." />
            ) : (
              <ul className="flex flex-col gap-1">
                {contacts.data.contacts.map((contact) => (
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
