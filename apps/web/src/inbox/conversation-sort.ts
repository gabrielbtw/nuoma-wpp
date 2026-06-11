export function compareConversationsByLastActivity<
  T extends { id: number; lastMessageAt: string | null },
>(a: T, b: T): number {
  const aTime = Date.parse(a.lastMessageAt ?? "");
  const bTime = Date.parse(b.lastMessageAt ?? "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) {
    return Number.isFinite(bTime) ? 1 : -1;
  }
  return b.id - a.id;
}
