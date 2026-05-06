import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "void-flow" | "aurora" | "ocean";
export type ResolvedTheme = ThemePreference;

export const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  {
    value: "void-flow",
    label: "Void Flow",
    description: "Controle tecnico, profundo e compacto.",
  },
  {
    value: "aurora",
    label: "Aurora",
    description: "Escuro suave com acentos organicos.",
  },
  {
    value: "ocean",
    label: "Ocean",
    description: "Azul-petroleo calmo para sessoes longas.",
  },
];

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(pref: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "nuoma:theme";
const DEFAULT_THEME: ThemePreference = "void-flow";
const validThemes = new Set<ThemePreference>(THEME_OPTIONS.map((theme) => theme.value));

function readStored(): ThemePreference {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  const value = localStorage.getItem(STORAGE_KEY);
  if (validThemes.has(value as ThemePreference)) return value as ThemePreference;
  return DEFAULT_THEME;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return validThemes.has(pref) ? pref : DEFAULT_THEME;
}

function applyToDom(theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme = "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStored());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(preference));

  useEffect(() => {
    setResolved(resolve(preference));
  }, [preference]);

  useEffect(() => {
    applyToDom(resolved);
  }, [resolved]);

  const setPreference = useCallback((pref: ThemePreference) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, pref);
    setPreferenceState(pref);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
