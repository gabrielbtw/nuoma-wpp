/**
 * V2.8 Cartographic Operations design tokens.
 *
 * Flat operational surfaces, contour lines, micro-grid texture and signal dots.
 * Liquid glass is reserved for floating overlays only.
 */

export const colors = {
  bg: {
    base: "oklch(0.19 0.024 198)",
    deep: "oklch(0.15 0.024 205)",
    surface: "oklch(0.22 0.026 196)",
    elevated: "oklch(0.25 0.030 192)",
    sunken: "oklch(0.16 0.024 205)",
    raised: "oklch(0.23 0.026 196)",
  },
  fg: {
    primary: "oklch(0.94 0.010 175)",
    muted: "oklch(0.72 0.018 182)",
    dim: "oklch(0.66 0.018 188)",
    faint: "oklch(0.47 0.018 194)",
  },
  channels: {
    whatsapp: "oklch(0.76 0.17 154)",
    instagram: "oklch(0.76 0.16 74)",
    system: "oklch(0.76 0.13 224)",
  },
  semantic: {
    success: "oklch(0.78 0.16 154)",
    warning: "oklch(0.78 0.15 74)",
    danger: "oklch(0.66 0.19 29)",
    info: "oklch(0.76 0.13 224)",
  },
  brand: {
    violet: "oklch(0.78 0.13 84)",
    violetSoft: "oklch(0.84 0.10 84)",
    violetGlow: "oklch(0.78 0.13 84 / 0.32)",
    cyan: "oklch(0.74 0.12 202)",
    cyanSoft: "oklch(0.82 0.09 202)",
    cyanGlow: "oklch(0.74 0.12 202 / 0.34)",
    lime: "oklch(0.80 0.15 146)",
    limeGlow: "oklch(0.80 0.15 146 / 0.34)",
  },
  shadow: {
    light: "oklch(0.36 0.026 190 / 0.24)",
    lightSoft: "oklch(0.36 0.026 190 / 0.16)",
    dark: "oklch(0.06 0.020 205 / 0.58)",
    darkSoft: "oklch(0.06 0.020 205 / 0.36)",
  },
  contour: {
    line: "oklch(0.38 0.030 186 / 0.62)",
    lineMuted: "oklch(0.31 0.026 190 / 0.42)",
    accent: "oklch(0.74 0.12 202 / 0.55)",
    grid: "oklch(0.36 0.026 190 / 0.26)",
  },
  signal: {
    active: "oklch(0.85 0.20 130)",
    idle: "oklch(0.56 0.016 270)",
    error: "oklch(0.70 0.22 26)",
    degraded: "oklch(0.85 0.18 86)",
  },
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
 * Contour shadow recipes. Names stay stable for compatibility with existing
 * components, but visual output is flat, bordered and operational.
 */
export const shadows = {
  none: "none",
  raisedSm:
    "0 0 0 1px oklch(0.38 0.030 186 / 0.44), 0 8px 20px oklch(0.06 0.020 205 / 0.18)",
  raisedMd:
    "0 0 0 1px oklch(0.38 0.030 186 / 0.52), 0 14px 32px oklch(0.06 0.020 205 / 0.24)",
  raisedLg:
    "0 0 0 1px oklch(0.42 0.032 186 / 0.58), 0 20px 52px oklch(0.06 0.020 205 / 0.30)",
  raisedXl:
    "0 0 0 1px oklch(0.46 0.034 186 / 0.62), 0 28px 72px oklch(0.06 0.020 205 / 0.36)",
  pressedSm:
    "inset 0 0 0 1px oklch(0.30 0.026 190 / 0.62), inset 0 1px 8px oklch(0.06 0.020 205 / 0.30)",
  pressedMd:
    "inset 0 0 0 1px oklch(0.30 0.026 190 / 0.70), inset 0 2px 14px oklch(0.06 0.020 205 / 0.38)",
  pressedLg:
    "inset 0 0 0 1px oklch(0.30 0.026 190 / 0.76), inset 0 4px 24px oklch(0.06 0.020 205 / 0.42)",
  flat: "0 0 0 1px oklch(0.38 0.030 186 / 0.62)",
  flatSubtle: "0 0 0 1px oklch(0.31 0.026 190 / 0.42)",
  glow: {
    violet:
      "0 0 0 1px oklch(0.78 0.13 84 / 0.72), 0 0 24px oklch(0.78 0.13 84 / 0.18)",
    cyan:
      "0 0 0 1px oklch(0.74 0.12 202 / 0.78), 0 0 24px oklch(0.74 0.12 202 / 0.18)",
    lime: "0 0 0 1px oklch(0.80 0.15 146 / 0.78), 0 0 20px oklch(0.80 0.15 146 / 0.18)",
    danger: "0 0 0 1px oklch(0.66 0.19 29 / 0.78), 0 0 24px oklch(0.66 0.19 29 / 0.18)",
  },
  lift:
    "0 0 0 1px oklch(0.58 0.040 188 / 0.42), 0 24px 80px oklch(0.06 0.020 205 / 0.62)",
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
  color: "oklch(0.36 0.026 190 / 0.26)",
} as const;

export const fontFamily = {
  sans:
    '"Geist Variable", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  display: '"Geist Variable", "Geist", system-ui, sans-serif',
  serif: '"Geist Variable", "Geist", system-ui, sans-serif',
  mono:
    '"Geist Mono Variable", "Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export const tokens = {
  colors,
  radii,
  spacing,
  blurs,
  shadows,
  motion,
  zIndex,
  microGrid,
  fontFamily,
} as const;

export type Tokens = typeof tokens;
