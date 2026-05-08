import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_OCTO_PREFERENCES,
  OCTO_STORAGE_EVENT,
  readOctoPreferences,
  writeOctoPreferences,
  type OctoPreferences,
} from "./preferences.js";
import { getOctoTimeout, resolveOctoStateAfterTimeout, shouldAcceptOctoEvent } from "./state.js";
import {
  OCTO_EVENT_MESSAGES,
  OCTO_EVENT_NAME,
  OCTO_EVENT_TO_STATE,
  OCTO_STATE_LABELS,
  type OctoEvent,
  type OctoEventDetail,
  type OctoVisualState,
} from "./types.js";

export interface OctoPetContextValue {
  visualState: OctoVisualState;
  activeEvent: OctoEvent | null;
  message: string;
  badgeCount: number;
  preferences: OctoPreferences;
  dispatch: (event: OctoEvent) => void;
  setState: (state: OctoVisualState) => void;
  setEnabled: (enabled: boolean) => void;
  setMuted: (muted: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
  clearBadge: () => void;
}

const OctoPetContext = createContext<OctoPetContextValue | null>(null);

export function OctoPetProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState<OctoPreferences>(readOctoPreferences);
  const [visualState, setVisualState] = useState<OctoVisualState>("idle");
  const [activeEvent, setActiveEvent] = useState<OctoEvent | null>(null);
  const [message, setMessage] = useState(OCTO_STATE_LABELS.idle);
  const [badgeCount, setBadgeCount] = useState(0);

  const setPreferences = useCallback((next: OctoPreferences) => {
    setPreferencesState(next);
    writeOctoPreferences(next);
  }, []);

  useEffect(() => {
    function refresh() {
      setPreferencesState(readOctoPreferences());
    }
    window.addEventListener("storage", refresh);
    window.addEventListener(OCTO_STORAGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(OCTO_STORAGE_EVENT, refresh);
    };
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => setPreferences({ ...preferences, enabled }),
    [preferences, setPreferences],
  );

  const setMuted = useCallback(
    (muted: boolean) => setPreferences({ ...preferences, muted }),
    [preferences, setPreferences],
  );

  const setExpanded = useCallback(
    (expanded: boolean) => setPreferences({ ...preferences, expanded }),
    [preferences, setPreferences],
  );

  const toggleExpanded = useCallback(() => {
    setPreferences({ ...preferences, expanded: !preferences.expanded });
  }, [preferences, setPreferences]);

  const setState = useCallback((state: OctoVisualState) => {
    setVisualState(state);
    setActiveEvent(null);
    setMessage(OCTO_STATE_LABELS[state]);
    setBadgeCount((count) => (state === "idle" ? count : count + 1));
  }, []);

  const dispatch = useCallback(
    (event: OctoEvent) => {
      setVisualState((currentState) => {
        const current = { visualState: currentState, activeEvent };
        if (!shouldAcceptOctoEvent(current, event)) return currentState;
        setActiveEvent(event);
        setMessage(OCTO_EVENT_MESSAGES[event]);
        setBadgeCount((count) => count + 1);
        return OCTO_EVENT_TO_STATE[event];
      });
    },
    [activeEvent],
  );

  useEffect(() => {
    function onOctoEvent(event: Event) {
      const detail = (event as CustomEvent<OctoEventDetail>).detail;
      if (detail?.event) dispatch(detail.event);
    }
    window.addEventListener(OCTO_EVENT_NAME, onOctoEvent);
    return () => window.removeEventListener(OCTO_EVENT_NAME, onOctoEvent);
  }, [dispatch]);

  useEffect(() => {
    const timeout = getOctoTimeout(visualState);
    if (timeout == null) return;
    const handle = window.setTimeout(() => {
      const next = resolveOctoStateAfterTimeout(visualState);
      setVisualState(next);
      setActiveEvent(null);
      setMessage(OCTO_STATE_LABELS[next]);
    }, timeout);
    return () => window.clearTimeout(handle);
  }, [visualState]);

  const clearBadge = useCallback(() => setBadgeCount(0), []);

  const value = useMemo<OctoPetContextValue>(
    () => ({
      visualState,
      activeEvent,
      message,
      badgeCount,
      preferences: preferences ?? DEFAULT_OCTO_PREFERENCES,
      dispatch,
      setState,
      setEnabled,
      setMuted,
      setExpanded,
      toggleExpanded,
      clearBadge,
    }),
    [
      activeEvent,
      badgeCount,
      clearBadge,
      dispatch,
      message,
      preferences,
      setEnabled,
      setExpanded,
      setMuted,
      setState,
      toggleExpanded,
      visualState,
    ],
  );

  return <OctoPetContext.Provider value={value}>{children}</OctoPetContext.Provider>;
}

export function useOctoPet(): OctoPetContextValue {
  const value = useContext(OctoPetContext);
  if (!value) {
    throw new Error("useOctoPet must be used inside OctoPetProvider");
  }
  return value;
}
