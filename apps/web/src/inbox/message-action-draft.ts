import type { Message } from "@nuoma/contracts";

export type MessageActionKind = "reply" | "forward" | "edit";

export interface MessageActionDraft {
  draftId: number;
  kind: MessageActionKind;
  messageId: number;
  text: string;
  excerpt: string;
  contentType: Message["contentType"];
  direction: Message["direction"];
}

export function createMessageActionDraft(
  kind: MessageActionKind,
  message: Message,
): MessageActionDraft {
  const text = messageActionText(message);
  return {
    draftId: Date.now(),
    kind,
    messageId: message.id,
    text,
    excerpt: messageActionExcerpt(text),
    contentType: message.contentType,
    direction: message.direction,
  };
}

export function messageActionText(message: Message): string {
  const body = message.body?.trim();
  if (body) return body;
  const fileName = message.media?.fileName?.trim();
  if (fileName) return fileName;
  return `[${message.contentType}]`;
}

function messageActionExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}
