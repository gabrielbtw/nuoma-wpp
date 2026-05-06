/**
 * Tailwind 3 preset mapping V2.8 Cartographic Operations tokens to theme keys.
 */
import type { Config } from "tailwindcss";

import {
  blurs,
  fontFamily,
  motion,
  radii,
  spacing,
  zIndex,
} from "../tokens/index.js";

const withOpacity = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

function flatColors() {
  return {
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
    channel: {
      whatsapp: withOpacity("--color-channel-whatsapp"),
      instagram: withOpacity("--color-channel-instagram"),
      system: withOpacity("--color-channel-system"),
    },
    semantic: {
      success: withOpacity("--color-semantic-success"),
      warning: withOpacity("--color-semantic-warning"),
      danger: withOpacity("--color-semantic-danger"),
      info: withOpacity("--color-semantic-info"),
    },
    brand: {
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
    "raised-sm": "var(--shadow-raised-sm)",
    "raised-md": "var(--shadow-raised-md)",
    "raised-lg": "var(--shadow-raised-lg)",
    "raised-xl": "var(--shadow-raised-xl)",
    "pressed-sm": "var(--shadow-pressed-sm)",
    "pressed-md": "var(--shadow-pressed-md)",
    "pressed-lg": "var(--shadow-pressed-lg)",
    flat: "var(--shadow-flat)",
    "flat-subtle": "var(--shadow-flat-subtle)",
    lift: "var(--shadow-lift)",
    "glow-violet": "var(--shadow-glow-violet)",
    "glow-cyan": "var(--shadow-glow-cyan)",
    "glow-lime": "var(--shadow-glow-lime)",
    "glow-danger": "var(--shadow-glow-danger)",
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
      borderRadius: radii,
      spacing,
      blur: blurs,
      backdropBlur: blurs,
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
