import type { Message } from "@nuoma/contracts";

export interface OptimisticMessageInput {
  body: string;
  contactId: number | null;
  conversationId: number;
}

export interface OptimisticMessageResult {
  clientMutationId: string;
  message: Message;
}

export function createOptimisticTextMessage(
  input: OptimisticMessageInput,
): OptimisticMessageResult {
  const now = new Date();
  const observedAtUtc = now.toISOString();
  const localId = -(now.getTime() * 1000 + Math.floor(Math.random() * 1000));
  const clientMutationId = `optimistic:${input.conversationId}:${now.getTime()}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  return {
    clientMutationId,
    message: {
      id: localId,
      userId: 1,
      conversationId: input.conversationId,
      contactId: input.contactId,
      externalId: null,
      direction: "outbound",
      contentType: "text",
      status: "pending",
      body: input.body,
      media: null,
      quotedMessageId: null,
      waDisplayedAt: observedAtUtc,
      timestampPrecision: "second",
      messageSecond: now.getSeconds(),
      waInferredSecond: null,
      observedAtUtc,
      editedAt: null,
      deletedAt: null,
      createdAt: observedAtUtc,
      updatedAt: observedAtUtc,
      raw: {
        optimistic: true,
        clientMutationId,
      },
    },
  };
}

export function isOptimisticMessage(message: Message): boolean {
  return message.raw?.optimistic === true;
}

export function optimisticClientMutationId(message: Message): string | null {
  return typeof message.raw?.clientMutationId === "string" ? message.raw.clientMutationId : null;
}

export function mergeOptimisticMessages(
  serverMessages: Message[],
  optimisticMessages: Message[],
  conversationId: number | null,
): Message[] {
  if (conversationId == null) return serverMessages;
  const visibleOptimistic = optimisticMessages.filter(
    (message) =>
      message.conversationId === conversationId &&
      !hasMatchingServerMessage(serverMessages, message),
  );
  return [...serverMessages, ...visibleOptimistic];
}

function hasMatchingServerMessage(serverMessages: Message[], optimistic: Message): boolean {
  const clientMutationId = optimisticClientMutationId(optimistic);
  const optimisticAt = Date.parse(optimistic.observedAtUtc);

  return serverMessages.some((message) => {
    if (isOptimisticMessage(message)) return false;
    if (clientMutationId && message.raw?.clientMutationId === clientMutationId) return true;
    if (message.direction !== "outbound" || message.contentType !== optimistic.contentType) {
      return false;
    }
    if ((message.body ?? "") !== (optimistic.body ?? "")) {
      return false;
    }
    const messageAt = Date.parse(message.observedAtUtc);
    if (!Number.isFinite(messageAt) || !Number.isFinite(optimisticAt)) {
      return true;
    }
    return messageAt >= optimisticAt - 60_000;
  });
}
