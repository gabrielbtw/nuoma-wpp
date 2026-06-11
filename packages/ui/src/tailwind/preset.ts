/**
 * Tailwind 3 preset — Nuoma Carvão & Cobre.
 *
 * Vocabulário novo (--nw-*): superfícies numeradas, tinta por intensidade,
 * um acento, linhas, status, canais e paleta de gráfico. As escalas da era
 * Editorial·Indigo (bg/fg/border/semantic/brand/contour/signal) permanecem
 * como ALIASES DEPRECATED — resolvem para os mesmos tokens via a camada
 * compat de styles/tokens.css — e morrem junto com o CSS legado.
 */
import type { Config } from "tailwindcss";

import {
  blurs,
  fontFamily,
  fontSize,
  fontWeight,
  gradients,
  letterSpacing,
  motion,
  radii,
  spacing,
  zIndex,
} from "../tokens/index.js";

const withOpacity = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

function flatColors() {
  return {
    /* ------------------------------------------------------------------ */
    /* Vocabulário Carvão & Cobre                                          */
    /* ------------------------------------------------------------------ */
    surface: {
      deep: withOpacity("--nw-surface-deep"),
      0: withOpacity("--nw-surface-0"),
      1: withOpacity("--nw-surface-1"),
      2: withOpacity("--nw-surface-2"),
      3: withOpacity("--nw-surface-3"),
      4: withOpacity("--nw-surface-4"),
      5: withOpacity("--nw-surface-5"),
    },
    ink: {
      DEFAULT: withOpacity("--nw-ink-base"),
      strong: withOpacity("--nw-ink-strong"),
      base: withOpacity("--nw-ink-base"),
      soft: withOpacity("--nw-ink-soft"),
      faint: withOpacity("--nw-ink-faint"),
    },
    accent: {
      DEFAULT: withOpacity("--nw-accent"),
      hover: withOpacity("--nw-accent-hover"),
      muted: withOpacity("--nw-accent-muted"),
      on: withOpacity("--nw-accent-on"),
      /* deprecated (Editorial·Indigo) */
      strong: withOpacity("--nw-accent-hover"),
      soft: withOpacity("--nw-accent-hover"),
      dim: withOpacity("--nw-accent-muted"),
    },
    line: {
      hairline: withOpacity("--nw-line-hairline"),
      soft: withOpacity("--nw-line-soft"),
      strong: withOpacity("--nw-line-strong"),
    },
    status: {
      ok: withOpacity("--nw-status-ok"),
      warn: withOpacity("--nw-status-warn"),
      error: withOpacity("--nw-status-error"),
      info: withOpacity("--nw-status-info"),
    },
    channel: {
      wa: withOpacity("--nw-channel-wa"),
      ig: withOpacity("--nw-channel-ig"),
      sys: withOpacity("--nw-channel-sys"),
      /* deprecated (nomes longos) */
      whatsapp: withOpacity("--nw-channel-wa"),
      instagram: withOpacity("--nw-channel-ig"),
      system: withOpacity("--nw-channel-sys"),
    },
    chart: {
      1: withOpacity("--nw-chart-1"),
      2: withOpacity("--nw-chart-2"),
      3: withOpacity("--nw-chart-3"),
      4: withOpacity("--nw-chart-4"),
      5: withOpacity("--nw-chart-5"),
      6: withOpacity("--nw-chart-6"),
      grid: withOpacity("--nw-chart-grid"),
      label: withOpacity("--nw-chart-label"),
    },

    /* ------------------------------------------------------------------ */
    /* DEPRECATED — escalas Editorial·Indigo (resolvem via camada compat). */
    /* Não usar em código novo; removidas quando styles/legacy.css morrer. */
    /* ------------------------------------------------------------------ */
    bg: {
      base: withOpacity("--color-bg-base"),
      deep: withOpacity("--color-bg-deep"),
      surface: withOpacity("--color-bg-surface"),
      elevated: withOpacity("--color-bg-elevated"),
      sunken: withOpacity("--color-bg-sunken"),
      raised: withOpacity("--color-bg-raised"),
      subtle: withOpacity("--color-bg-subtle"),
      panel: withOpacity("--color-bg-panel"),
      canvas: withOpacity("--color-bg-canvas"),
    },
    fg: {
      primary: withOpacity("--color-fg-primary"),
      muted: withOpacity("--color-fg-muted"),
      dim: withOpacity("--color-fg-dim"),
      faint: withOpacity("--color-fg-faint"),
    },
    semantic: {
      success: withOpacity("--color-semantic-success"),
      warning: withOpacity("--color-semantic-warning"),
      danger: withOpacity("--color-semantic-danger"),
      info: withOpacity("--color-semantic-info"),
    },
    brand: {
      blue: withOpacity("--color-brand-blue"),
      blueSoft: withOpacity("--color-brand-blue-soft"),
      blueGlow: withOpacity("--color-brand-blue-glow"),
      green: withOpacity("--color-brand-green"),
      greenSoft: withOpacity("--color-brand-green-soft"),
      greenGlow: withOpacity("--color-brand-green-glow"),
      teal: withOpacity("--color-brand-teal"),
      tealSoft: withOpacity("--color-brand-teal-soft"),
      tealGlow: withOpacity("--color-brand-teal-glow"),
      gold: withOpacity("--color-brand-gold"),
      goldSoft: withOpacity("--color-brand-gold-soft"),
      goldGlow: withOpacity("--color-brand-gold-glow"),
      violet: withOpacity("--color-brand-violet"),
      violetSoft: withOpacity("--color-brand-violet-soft"),
      violetGlow: withOpacity("--color-brand-violet-glow"),
      cyan: withOpacity("--color-brand-cyan"),
      cyanSoft: withOpacity("--color-brand-cyan-soft"),
      cyanGlow: withOpacity("--color-brand-cyan-glow"),
      lime: withOpacity("--color-brand-lime"),
      limeGlow: withOpacity("--color-brand-lime-glow"),
    },
    contour: {
      line: withOpacity("--color-contour-line"),
      lineMuted: withOpacity("--color-contour-line-muted"),
      accent: withOpacity("--color-contour-accent"),
      grid: withOpacity("--color-contour-grid"),
    },
    border: {
      subtle: withOpacity("--color-border-subtle"),
      muted: withOpacity("--color-border-muted"),
      active: withOpacity("--color-border-active"),
    },
    signal: {
      active: withOpacity("--color-signal-active"),
      idle: withOpacity("--color-signal-idle"),
      error: withOpacity("--color-signal-error"),
      degraded: withOpacity("--color-signal-degraded"),
    },
    shadow: {
      light: withOpacity("--color-shadow-light"),
      lightSoft: withOpacity("--color-shadow-light-soft"),
      dark: withOpacity("--color-shadow-dark"),
      darkSoft: withOpacity("--color-shadow-dark-soft"),
    },
    transparent: "transparent",
    current: "currentColor",
  } as const;
}

function flatBoxShadow() {
  return {
    none: "none",
    flat: "var(--nw-shadow-flat)",
    raised: "var(--nw-shadow-raised)",
    lifted: "var(--nw-shadow-lifted)",
    inset: "var(--nw-shadow-inset)",
    /* deprecated (Editorial·Indigo) */
    "raised-sm": "var(--shadow-raised-sm)",
    "raised-md": "var(--shadow-raised-md)",
    "raised-lg": "var(--shadow-raised-lg)",
    "raised-xl": "var(--shadow-raised-xl)",
    "pressed-sm": "var(--shadow-pressed-sm)",
    "pressed-md": "var(--shadow-pressed-md)",
    "pressed-lg": "var(--shadow-pressed-lg)",
    "flat-subtle": "var(--shadow-flat-subtle)",
    lift: "var(--shadow-lift)",
    "glow-violet": "var(--shadow-glow-violet)",
    "glow-gold": "var(--shadow-glow-gold)",
    "glow-cyan": "var(--shadow-glow-cyan)",
    "glow-lime": "var(--shadow-glow-lime)",
    "glow-danger": "var(--shadow-glow-danger)",
    "glow-aura": "var(--shadow-glow-aura)",
  } as const;
}

const preset: Config = {
  content: [],
  darkMode: "class",
  theme: {
    extend: {
      colors: flatColors(),
      fontFamily: {
        sans: fontFamily.sans.split(",").map((s) => s.trim().replace(/^"|"$/g, "")),
        display: fontFamily.display.split(",").map((s) => s.trim().replace(/^"|"$/g, "")),
        serif: fontFamily.serif.split(",").map((s) => s.trim().replace(/^"|"$/g, "")),
        mono: fontFamily.mono.split(",").map((s) => s.trim().replace(/^"|"$/g, "")),
      },
      fontSize: fontSize as unknown as Record<string, [string, Record<string, string>]>,
      fontWeight,
      borderRadius: radii,
      spacing,
      blur: blurs,
      backdropBlur: blurs,
      letterSpacing,
      backgroundImage: {
        "gradient-accent": gradients.accent,
        "gradient-aura": gradients.aura,
        "gradient-glass": gradients.glass,
      },
      boxShadow: flatBoxShadow(),
      zIndex: Object.fromEntries(
        Object.entries(zIndex).map(([key, value]) => [key, String(value)]),
      ),
      transitionDuration: motion.durations,
      transitionTimingFunction: motion.easings,
    },
  },
  plugins: [],
};

export default preset;
