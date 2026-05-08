export const OCTO_STORAGE_KEY = "nuoma:octo-pet";
export const OCTO_STORAGE_EVENT = "nuoma:octo-pet-change";

export interface OctoPreferences {
  enabled: boolean;
  muted: boolean;
  expanded: boolean;
}

export const DEFAULT_OCTO_PREFERENCES: OctoPreferences = {
  enabled: true,
  muted: false,
  expanded: false,
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readOctoPreferences(storage = getBrowserStorage()): OctoPreferences {
  if (!storage) return DEFAULT_OCTO_PREFERENCES;
  const raw = storage.getItem(OCTO_STORAGE_KEY);
  if (!raw) return DEFAULT_OCTO_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<OctoPreferences>;
    return {
      enabled:
        typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_OCTO_PREFERENCES.enabled,
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_OCTO_PREFERENCES.muted,
      expanded:
        typeof parsed.expanded === "boolean" ? parsed.expanded : DEFAULT_OCTO_PREFERENCES.expanded,
    };
  } catch {
    return DEFAULT_OCTO_PREFERENCES;
  }
}

export function writeOctoPreferences(
  preferences: OctoPreferences,
  storage = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(OCTO_STORAGE_KEY, JSON.stringify(preferences));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OCTO_STORAGE_EVENT, { detail: preferences }));
  }
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
