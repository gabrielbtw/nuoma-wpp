import {
  OCTO_EVENT_PRIORITY,
  OCTO_EVENT_TO_STATE,
  OCTO_STATE_TIMEOUTS,
  type OctoEvent,
  type OctoVisualState,
} from "./types.js";

export interface OctoRuntimeSnapshot {
  visualState: OctoVisualState;
  activeEvent: OctoEvent | null;
}

export function shouldAcceptOctoEvent(current: OctoRuntimeSnapshot, nextEvent: OctoEvent): boolean {
  if (current.visualState === "failed" && OCTO_EVENT_TO_STATE[nextEvent] === "jumping") {
    return false;
  }
  const currentPriority = current.activeEvent
    ? OCTO_EVENT_PRIORITY[current.activeEvent]
    : OCTO_EVENT_PRIORITY.idle;
  return OCTO_EVENT_PRIORITY[nextEvent] >= currentPriority;
}

export function resolveOctoStateAfterTimeout(visualState: OctoVisualState): OctoVisualState {
  return OCTO_STATE_TIMEOUTS[visualState] == null ? visualState : "idle";
}

export function getOctoTimeout(visualState: OctoVisualState): number | null {
  return OCTO_STATE_TIMEOUTS[visualState] ?? null;
}
