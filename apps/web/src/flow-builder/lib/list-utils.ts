export function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const copy = [...items];
  const current = copy[index];
  const target = copy[nextIndex];
  if (current === undefined || target === undefined) return items;
  copy[index] = target;
  copy[nextIndex] = current;
  return copy;
}

export function moveItemById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
  const copy = [...items];
  const [moved] = copy.splice(sourceIndex, 1);
  if (!moved) return items;
  copy.splice(targetIndex, 0, moved);
  return copy;
}
