import type { OctoVisualState } from "./types.js";

export const OCTO_CELL_WIDTH = 192;
export const OCTO_CELL_HEIGHT = 208;
export const OCTO_ATLAS_COLUMNS = 8;
export const OCTO_ATLAS_ROWS = 9;
export const OCTO_ATLAS_WIDTH = OCTO_CELL_WIDTH * OCTO_ATLAS_COLUMNS;
export const OCTO_ATLAS_HEIGHT = OCTO_CELL_HEIGHT * OCTO_ATLAS_ROWS;

export interface OctoAnimationRow {
  row: number;
  frames: number;
  durations: number[];
}

export const OCTO_ANIMATION_ROWS: Record<OctoVisualState, OctoAnimationRow> = {
  idle: { row: 0, frames: 6, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, frames: 4, durations: [140, 140, 140, 280] },
  jumping: { row: 4, frames: 5, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, frames: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, frames: 6, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, frames: 6, durations: [150, 150, 150, 150, 150, 280] },
};

export function getOctoFrameIndex(elapsedMs: number, durations: readonly number[]): number {
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  if (total <= 0) return 0;
  const normalized = ((elapsedMs % total) + total) % total;
  let cursor = 0;
  for (let index = 0; index < durations.length; index += 1) {
    cursor += durations[index] ?? 0;
    if (normalized < cursor) return index;
  }
  return Math.max(0, durations.length - 1);
}

export function getOctoBackgroundPosition(row: number, column: number): string {
  const x = column === 0 ? 0 : -column * OCTO_CELL_WIDTH;
  const y = row === 0 ? 0 : -row * OCTO_CELL_HEIGHT;
  return `${x}px ${y}px`;
}

export function getOctoSpriteStyle(
  visualState: OctoVisualState,
  elapsedMs: number,
): Pick<CSSStyleDeclaration, "backgroundPosition" | "backgroundSize"> {
  const animation = OCTO_ANIMATION_ROWS[visualState];
  const frame = getOctoFrameIndex(elapsedMs, animation.durations);
  return {
    backgroundPosition: getOctoBackgroundPosition(animation.row, frame),
    backgroundSize: `${OCTO_ATLAS_WIDTH}px ${OCTO_ATLAS_HEIGHT}px`,
  };
}
