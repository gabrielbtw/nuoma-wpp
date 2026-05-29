/**
 * Nuoma solid operations design tokens.
 *
 * Nuoma V3 uses a matte graphite canvas, deep green for primary action,
 * petroleum/steel blue for product structure, and muted teal only for focus,
 * live state, and verified activity. No yellow, gold, orange, neon, or purple
 * is part of the visual language.
 */

export const colors = {
  bg: {
    base: "oklch(0.18 0.012 260)",
    deep: "oklch(0.10 0.010 260)",
    surface: "oklch(0.22 0.014 260)",
    elevated: "oklch(0.26 0.016 260)",
    sunken: "oklch(0.13 0.010 260)",
    raised: "oklch(0.24 0.014 260)",
  },
  fg: {
    primary: "oklch(0.94 0.024 94)",
    muted: "oklch(0.78 0.040 94)",
    dim: "oklch(0.61 0.035 112)",
    faint: "oklch(0.43 0.030 132)",
  },
  channels: {
    whatsapp: "oklch(0.64 0.105 151)",
    instagram: "oklch(0.62 0.105 18)",
    system: "oklch(0.63 0.055 185)",
  },
  semantic: {
    success: "oklch(0.64 0.105 151)",
    warning: "oklch(0.66 0.090 210)",
    danger: "oklch(0.59 0.155 28)",
    info: "oklch(0.63 0.055 185)",
  },
  brand: {
    blue: "oklch(0.59 0.070 222)",
    blueSoft: "oklch(0.77 0.050 218)",
    blueGlow: "oklch(0.59 0.070 222 / 0.16)",
    green: "oklch(0.58 0.105 151)",
    greenSoft: "oklch(0.76 0.070 151)",
    greenGlow: "oklch(0.58 0.105 151 / 0.16)",
    teal: "oklch(0.63 0.055 185)",
    tealSoft: "oklch(0.79 0.045 180)",
    tealGlow: "oklch(0.63 0.055 185 / 0.14)",
    /** Compatibility aliases: old gold/violet slots now resolve to blue. */
    gold: "oklch(0.59 0.070 222)",
    goldSoft: "oklch(0.77 0.050 218)",
    goldGlow: "oklch(0.59 0.070 222 / 0.16)",
    cyan: "oklch(0.63 0.055 185)",
    cyanSoft: "oklch(0.79 0.045 180)",
    cyanGlow: "oklch(0.63 0.055 185 / 0.14)",
    violet: "oklch(0.59 0.070 222)",
    violetSoft: "oklch(0.77 0.050 218)",
    violetGlow: "oklch(0.59 0.070 222 / 0.16)",
    lime: "oklch(0.58 0.105 151)",
    limeGlow: "oklch(0.58 0.105 151 / 0.16)",
  },
  shadow: {
    light: "oklch(0.59 0.070 222 / 0.16)",
    lightSoft: "oklch(0.63 0.055 185 / 0.10)",
    dark: "oklch(0.04 0.010 260 / 0.68)",
    darkSoft: "oklch(0.04 0.010 260 / 0.42)",
  },
  contour: {
    line: "oklch(0.59 0.070 222 / 0.34)",
    lineMuted: "oklch(0.62 0.018 260 / 0.28)",
    accent: "oklch(0.63 0.055 185 / 0.46)",
    grid: "oklch(0.64 0.018 260 / 0.12)",
  },
  signal: {
    active: "oklch(0.63 0.055 185)",
    idle: "oklch(0.52 0.018 260)",
    error: "oklch(0.68 0.20 28)",
    degraded: "oklch(0.80 0.13 82)",
  },
} as const;

export const glass = {
  subtle: {
    background: "oklch(0.18 0.012 260 / 0.92)",
    border: "oklch(0.59 0.070 222 / 0.12)",
    blur: "8px",
  },
  panel: {
    background: "oklch(0.19 0.012 260 / 0.95)",
    border: "oklch(0.59 0.070 222 / 0.16)",
    blur: "10px",
  },
  elevated: {
    background: "oklch(0.22 0.014 260 / 0.96)",
    border: "oklch(0.63 0.055 185 / 0.20)",
    blur: "12px",
  },
  modal: {
    background: "oklch(0.14 0.010 260 / 0.98)",
    border: "oklch(0.77 0.050 218 / 0.26)",
    blur: "16px",
  },
  /** Layered feature surface, permitted on inspector panels and overlays. */
  layered: {
    background: "oklch(0.20 0.013 260 / 0.94)",
    border: "oklch(0.63 0.055 185 / 0.16)",
    blur: "20px",
  },
} as const;

/**
 * Restrained accent gradients. Reserved for small headers, KPI emphasis,
 * and empty states; never behind dense data.
 */
export const gradients = {
  accent: "var(--gradient-accent)",
  aura: "var(--gradient-aura)",
  glass: "var(--gradient-glass)",
} as const;

/**
 * Letter-spacing scale. Product text uses normal tracking; display type can
 * tighten slightly when space is intentionally large.
 */
export const letterSpacing = {
  tight: "-0.02em",
  display: "-0.03em",
  displayTight: "-0.045em",
  normal: "0",
  wide: "0.04em",
  widest: "0.14em",
} as const;

export const radii = {
  none: "0",
  xs: "0.375rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.25rem",
  xxl: "1.75rem",
  xxxl: "2.25rem",
  full: "9999px",
} as const;

export const spacing = {
  px: "1px",
  0: "0",
  1: "clamp(0.20rem, 0.18rem + 0.1vw, 0.25rem)",
  2: "clamp(0.40rem, 0.36rem + 0.2vw, 0.5rem)",
  3: "clamp(0.65rem, 0.58rem + 0.3vw, 0.75rem)",
  4: "clamp(0.85rem, 0.78rem + 0.35vw, 1rem)",
  5: "clamp(1.10rem, 1.00rem + 0.5vw, 1.25rem)",
  6: "clamp(1.30rem, 1.20rem + 0.5vw, 1.5rem)",
  8: "clamp(1.75rem, 1.60rem + 0.75vw, 2rem)",
  10: "clamp(2.20rem, 2.00rem + 1vw, 2.5rem)",
  12: "clamp(2.65rem, 2.40rem + 1.25vw, 3rem)",
  16: "clamp(3.5rem, 3.20rem + 1.5vw, 4rem)",
  20: "clamp(4.4rem, 4rem + 2vw, 5rem)",
  24: "clamp(5.3rem, 4.8rem + 2.5vw, 6rem)",
  32: "clamp(7rem, 6.4rem + 3vw, 8rem)",
} as const;

export const blurs = {
  none: "0px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "40px",
  xxl: "64px",
} as const;

/**
 * Solid shadow recipes. Compatibility names remain, but "glow" utilities now
 * resolve to restrained rings rather than neon lighting.
 */
export const shadows = {
  none: "none",
  raisedSm: "0 0 0 1px oklch(0.70 0.018 260 / 0.18), 0 8px 20px oklch(0.04 0.010 260 / 0.24)",
  raisedMd: "0 0 0 1px oklch(0.70 0.018 260 / 0.22), 0 14px 32px oklch(0.04 0.010 260 / 0.34)",
  raisedLg: "0 0 0 1px oklch(0.78 0.10 215 / 0.20), 0 20px 52px oklch(0.04 0.010 260 / 0.42)",
  raisedXl: "0 0 0 1px oklch(0.70 0.018 260 / 0.24), 0 28px 72px oklch(0.04 0.010 260 / 0.52)",
  pressedSm:
    "inset 0 0 0 1px oklch(0.62 0.018 260 / 0.34), inset 0 1px 8px oklch(0.04 0.010 260 / 0.34)",
  pressedMd:
    "inset 0 0 0 1px oklch(0.62 0.018 260 / 0.42), inset 0 2px 14px oklch(0.04 0.010 260 / 0.42)",
  pressedLg:
    "inset 0 0 0 1px oklch(0.62 0.018 260 / 0.50), inset 0 4px 24px oklch(0.04 0.010 260 / 0.48)",
  flat: "0 0 0 1px oklch(0.70 0.018 260 / 0.28)",
  flatSubtle: "0 0 0 1px oklch(0.62 0.018 260 / 0.24)",
  glow: {
    violet: "0 0 0 1px oklch(0.59 0.070 222 / 0.50), 0 10px 26px oklch(0.04 0.010 260 / 0.18)",
    gold: "0 0 0 1px oklch(0.59 0.070 222 / 0.50), 0 10px 26px oklch(0.04 0.010 260 / 0.18)",
    cyan: "0 0 0 1px oklch(0.63 0.055 185 / 0.52), 0 10px 24px oklch(0.04 0.010 260 / 0.16)",
    lime: "0 0 0 1px oklch(0.58 0.105 151 / 0.42), 0 8px 20px oklch(0.04 0.010 260 / 0.14)",
    danger: "0 0 0 1px oklch(0.59 0.155 28 / 0.62), 0 10px 24px oklch(0.04 0.010 260 / 0.18)",
    aura: "0 0 0 1px oklch(0.63 0.055 185 / 0.36), 0 16px 38px oklch(0.04 0.010 260 / 0.22)",
  },
  lift: "0 0 0 1px oklch(0.70 0.018 260 / 0.30), 0 24px 80px oklch(0.04 0.010 260 / 0.62)",
} as const;

export const motion = {
  durations: {
    instant: "80ms",
    fast: "140ms",
    base: "240ms",
    slow: "380ms",
    layout: "560ms",
  },
  easings: {
    out: "cubic-bezier(0.22, 1, 0.36, 1)",
    inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
    spring: "cubic-bezier(0.32, 0.72, 0, 1)",
    quartOut: "cubic-bezier(0.165, 0.84, 0.44, 1)",
    expoOut: "cubic-bezier(0.16, 1, 0.3, 1)",
    bouncy: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
  },
  spring: {
    soft: { stiffness: 180, damping: 28, mass: 1 },
    snappy: { stiffness: 280, damping: 24, mass: 1 },
    bouncy: { stiffness: 380, damping: 18, mass: 0.9 },
  },
} as const;

export const zIndex = {
  base: 0,
  raised: 1,
  grid: 2,
  dropdown: 10,
  overlay: 20,
  drawer: 30,
  modal: 40,
  toast: 50,
  critical: 60,
} as const;

export const microGrid = {
  size: "28px",
  lineWidth: "1px",
  color: "oklch(0.64 0.018 260 / 0.12)",
} as const;

export const fontFamily = {
  sans: '"Geist Variable", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  display: '"Geist Variable", "Geist", system-ui, sans-serif',
  serif: '"Geist Variable", "Geist", system-ui, sans-serif',
  mono: '"Geist Mono Variable", "Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export const tokens = {
  colors,
  radii,
  spacing,
  blurs,
  glass,
  gradients,
  letterSpacing,
  shadows,
  motion,
  zIndex,
  microGrid,
  fontFamily,
} as const;

export type Tokens = typeof tokens;
