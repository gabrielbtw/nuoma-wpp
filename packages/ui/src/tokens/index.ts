/**
 * Nuoma premium dark/glass design tokens.
 *
 * Nuoma 2026 uses a matte graphite canvas. Gold is reserved for brand
 * accents, while cyan marks operational focus and live state.
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
    whatsapp: "oklch(0.78 0.10 215)",
    instagram: "oklch(0.72 0.12 55)",
    system: "oklch(0.78 0.10 195)",
  },
  semantic: {
    success: "oklch(0.78 0.10 215)",
    warning: "oklch(0.78 0.12 82)",
    danger: "oklch(0.64 0.18 28)",
    info: "oklch(0.78 0.10 195)",
  },
  brand: {
    green: "oklch(0.52 0.018 260)",
    greenSoft: "oklch(0.66 0.020 260)",
    greenGlow: "oklch(0.66 0.020 260 / 0.22)",
    gold: "oklch(0.72 0.115 82)",
    goldSoft: "oklch(0.84 0.095 86)",
    goldGlow: "oklch(0.72 0.115 82 / 0.34)",
    cyan: "oklch(0.78 0.10 195)",
    cyanSoft: "oklch(0.88 0.065 190)",
    cyanGlow: "oklch(0.78 0.10 195 / 0.28)",
    violet: "oklch(0.72 0.115 82)",
    violetSoft: "oklch(0.84 0.095 86)",
    violetGlow: "oklch(0.72 0.115 82 / 0.34)",
    lime: "oklch(0.78 0.10 215)",
    limeGlow: "oklch(0.78 0.10 215 / 0.22)",
  },
  shadow: {
    light: "oklch(0.72 0.115 82 / 0.20)",
    lightSoft: "oklch(0.72 0.115 82 / 0.12)",
    dark: "oklch(0.04 0.010 260 / 0.68)",
    darkSoft: "oklch(0.04 0.010 260 / 0.42)",
  },
  contour: {
    line: "oklch(0.72 0.115 82 / 0.38)",
    lineMuted: "oklch(0.62 0.018 260 / 0.28)",
    accent: "oklch(0.72 0.115 82 / 0.58)",
    grid: "oklch(0.64 0.018 260 / 0.12)",
  },
  signal: {
    active: "oklch(0.78 0.10 215)",
    idle: "oklch(0.52 0.018 260)",
    error: "oklch(0.68 0.20 28)",
    degraded: "oklch(0.80 0.13 82)",
  },
} as const;

export const glass = {
  subtle: {
    background: "oklch(0.18 0.012 260 / 0.92)",
    border: "oklch(0.72 0.115 82 / 0.14)",
    blur: "8px",
  },
  panel: {
    background: "oklch(0.19 0.012 260 / 0.95)",
    border: "oklch(0.72 0.115 82 / 0.20)",
    blur: "10px",
  },
  elevated: {
    background: "oklch(0.22 0.014 260 / 0.96)",
    border: "oklch(0.78 0.10 195 / 0.24)",
    blur: "12px",
  },
  modal: {
    background: "oklch(0.14 0.010 260 / 0.98)",
    border: "oklch(0.84 0.095 86 / 0.30)",
    blur: "16px",
  },
  /** Layered feature surface — Orielo 2026, permitted on feature cards. */
  layered: {
    background: "oklch(0.20 0.013 260 / 0.94)",
    border: "oklch(0.78 0.10 195 / 0.20)",
    blur: "20px",
  },
} as const;

/**
 * Orielo 2026 accent gradients. Built from theme color vars at runtime so they
 * shift with each theme. Reserved for headers, KPIs, empty states and hero
 * accents — never behind dense data.
 */
export const gradients = {
  accent: "var(--gradient-accent)",
  aura: "var(--gradient-aura)",
  glass: "var(--gradient-glass)",
} as const;

/**
 * Letter-spacing scale. Negative tracking is permitted on display type only
 * (Orielo 2026 contract).
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
 * Premium glass shadow recipes. Names stay stable for compatibility with
 * existing components.
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
    violet: "0 0 0 1px oklch(0.72 0.115 82 / 0.64), 0 0 24px oklch(0.72 0.115 82 / 0.18)",
    gold: "0 0 0 1px oklch(0.72 0.115 82 / 0.64), 0 0 24px oklch(0.72 0.115 82 / 0.18)",
    cyan: "0 0 0 1px oklch(0.78 0.10 195 / 0.62), 0 0 24px oklch(0.78 0.10 195 / 0.16)",
    lime: "0 0 0 1px oklch(0.78 0.10 215 / 0.48), 0 0 16px oklch(0.78 0.10 215 / 0.10)",
    danger: "0 0 0 1px oklch(0.64 0.18 28 / 0.74), 0 0 24px oklch(0.64 0.18 28 / 0.18)",
    aura: "0 0 0 1px oklch(0.78 0.10 195 / 0.40), 0 0 40px oklch(0.78 0.10 195 / 0.20), 0 0 80px oklch(0.72 0.115 82 / 0.10)",
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
