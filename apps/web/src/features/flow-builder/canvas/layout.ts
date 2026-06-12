import type { BuilderNode } from "./graph.js";

export const NODE_WIDTH = 312;
const END_WIDTH = 168;
const HEIGHTS = { entry: 128, block: 124, end: 52 } as const;
const GAP = 64;

/**
 * Deterministic vertical spine layout. Positions are derived from the draft
 * order and never persisted — guarantees readable, non-overlapping canvases
 * (docs/flowbuilder-v2-frontend.md §8).
 */
export function layoutVertical(nodes: BuilderNode[]): BuilderNode[] {
  let y = 0;
  return nodes.map((item) => {
    const height = HEIGHTS[item.data.kind];
    const x = item.data.kind === "end" ? (NODE_WIDTH - END_WIDTH) / 2 : 0;
    const positioned: BuilderNode = { ...item, position: { x, y } };
    y += height + GAP;
    return positioned;
  });
}

/** Estimated block centers, used to translate a drop Y into an insert index. */
export function insertIndexForY(blockNodes: BuilderNode[], y: number): number {
  let index = 0;
  for (const block of blockNodes) {
    const center = block.position.y + HEIGHTS.block / 2;
    if (y > center) index += 1;
  }
  return index;
}
