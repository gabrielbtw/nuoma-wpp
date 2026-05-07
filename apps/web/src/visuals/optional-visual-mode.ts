import { useCallback, useEffect, useState } from "react";

export const OPTIONAL_VISUAL_STORAGE_KEY = "nuoma:v214a-visual";

const OPTIONAL_VISUAL_EVENT = "nuoma:v214a-visual-change";

export function readOptionalVisualMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(OPTIONAL_VISUAL_STORAGE_KEY) === "enabled";
}

export function writeOptionalVisualMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPTIONAL_VISUAL_STORAGE_KEY, enabled ? "enabled" : "disabled");
  window.dispatchEvent(new CustomEvent(OPTIONAL_VISUAL_EVENT, { detail: { enabled } }));
}

export function useOptionalVisualMode() {
  const [enabled, setEnabledState] = useState(readOptionalVisualMode);

  useEffect(() => {
    function refresh() {
      setEnabledState(readOptionalVisualMode());
    }
    window.addEventListener("storage", refresh);
    window.addEventListener(OPTIONAL_VISUAL_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(OPTIONAL_VISUAL_EVENT, refresh);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    writeOptionalVisualMode(next);
    setEnabledState(next);
  }, []);

  return { enabled, setEnabled };
}
