import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

/**
 * Nuoma Carvão & Cobre ships a single dark signature theme — there is no
 * theme switcher. The provider applies the theme to <html> once and exposes a
 * minimal context for backwards compatibility with existing consumers.
 */
export type ThemePreference = "editorial";
export type ResolvedTheme = ThemePreference;

export const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  {
    value: "editorial",
    label: "Carvão & Cobre",
    description: "Assinatura escura em carvão quente com acento cobre.",
  },
];

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(pref: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME: ThemePreference = "editorial";

function applyToDom() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = THEME;
  root.classList.add("dark");
  root.style.colorScheme = "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyToDom();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference: THEME, resolved: THEME, setPreference: () => undefined }),
    [],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
