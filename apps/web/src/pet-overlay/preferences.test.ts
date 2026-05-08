import { describe, expect, it } from "vitest";

import {
  DEFAULT_OCTO_PREFERENCES,
  OCTO_STORAGE_KEY,
  readOctoPreferences,
  writeOctoPreferences,
} from "./preferences.js";

function createStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial != null) values.set(OCTO_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("Octo preferences", () => {
  it("defaults to enabled and collapsed", () => {
    expect(readOctoPreferences(createStorage())).toEqual(DEFAULT_OCTO_PREFERENCES);
  });

  it("recovers from invalid JSON", () => {
    expect(readOctoPreferences(createStorage("{"))).toEqual(DEFAULT_OCTO_PREFERENCES);
  });

  it("persists preferences", () => {
    const storage = createStorage();
    writeOctoPreferences({ enabled: false, muted: true, expanded: true }, storage);
    expect(readOctoPreferences(storage)).toEqual({ enabled: false, muted: true, expanded: true });
  });
});
