/**
 * Nuoma Editorial · Indigo — design tokens.
 *
 * A single dark editorial signature: a cool near-black canvas tinted faintly
 * toward indigo, off-white ink, hairline separators, and ONE electric-indigo
 * accent reserved for action, focus, and live/active state. No glass, no glow,
 * no gradients behind data, no secondary accent colors.
 *
 * The Tailwind preset reads CSS variables (defined in apps/web styles.css) by
 * name, so these JS values are the source of truth for typography, shape,
 * spacing, and motion — the color triplets live alongside in the stylesheet.
 */

export const colors = {
  bg: {
    canvas: "11 11 16",
    deep: "8 8 12",
    sunken: "8 8 12",
    base: "15 15 21",
    surface: "18 18 25",
    raised: "20 20 28",
    elevated: "23 23 32",
    subtle: "30 30 40",
    panel: "15 15 21",
  },
  fg: {
    primary: "244 244 248",
    muted: "162 162 178",
    dim: "132 132 148",
    faint: "100 100 116",
  },
  channels: {
    whatsapp: "43 209 126",
    instagram: "225 86 143",
    system: "91 91 246",
  },
  semantic: {
    success: "43 184 126",
    warning: "224 163 58",
    danger: "242 86 106",
    info: "91 91 246",
  },
  /** Single accent — electric indigo. `strong` is the lighter hover/focus tone. */
  accent: {
    base: "91 91 246",
    strong: "124 124 255",
    dim: "66 66 150",
  },
  border: {
    subtle: "35 35 46",
    muted: "48 48 62",
    active: "91 91 246",
  },
  signal: {
    active: "91 91 246",
    idle: "74 74 90",
    error: "242 86 106",
    degraded: "224 163 58",
  },
} as const;

/**
 * Restrained, near-invisible gradient washes. Reserved for empty states and
 * the auth screen only — never behind dense data. Resolve to CSS vars so each
 * stays theme-driven.
 */
export const gradients = {
  accent: "var(--gradient-accent)",
  aura: "var(--gradient-aura)",
  glass: "var(--gradient-glass)",
} as const;

/**
 * Letter-spacing. Editorial display tightens; eyebrows (mono labels) open up.
 */
export const letterSpacing = {
  tight: "-0.01em",
  display: "-0.02em",
  displayTight: "-0.03em",
  normal: "0",
  wide: "0.02em",
  eyebrow: "0.08em",
  widest: "0.14em",
} as const;

/** Restrained, editorial radii — no oversized pills on cards. */
export const radii = {
  none: "0",
  xs: "0.375rem",
  sm: "0.5rem",
  md: "0.625rem",
  lg: "0.75rem",
  xl: "1rem",
  xxl: "1.25rem",
  xxxl: "1.5rem",
  full: "9999px",
} as const;

/** Fluid spacing scale — breathes on larger screens. */
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

/**
 * Editorial type scale (fluid). `eyebrow` is the mono label; `body` is the
 * comfortable reading size. Tuple = [size, { lineHeight, letterSpacing, fontWeight }].
 */
export const fontSize = {
  eyebrow: ["0.6875rem", { lineHeight: "1", letterSpacing: "0.08em", fontWeight: "560" }],
  caption: ["0.75rem", { lineHeight: "1.4", letterSpacing: "0" }],
  small: ["0.8125rem", { lineHeight: "1.45", letterSpacing: "0" }],
  body: ["0.9375rem", { lineHeight: "1.55", letterSpacing: "0" }],
  lead: ["1.0625rem", { lineHeight: "1.5", letterSpacing: "-0.005em" }],
  h3: ["1.0625rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
  h2: ["clamp(1.15rem, 1.05rem + 0.5vw, 1.25rem)", { lineHeight: "1.25", letterSpacing: "-0.015em", fontWeight: "600" }],
  h1: ["clamp(1.35rem, 1.2rem + 0.8vw, 1.5rem)", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "620" }],
  display: ["clamp(1.7rem, 1.4rem + 1.6vw, 2.1rem)", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "640" }],
  "display-lg": ["clamp(2.1rem, 1.6rem + 2.6vw, 2.75rem)", { lineHeight: "1.04", letterSpacing: "-0.03em", fontWeight: "660" }],
} as const;

export const fontWeight = {
  normal: "440",
  medium: "520",
  semibold: "600",
  bold: "660",
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
 * Editorial depth: hairline rings + low, soft shadows. No neon/glow. The "glow"
 * names are kept as compatibility aliases (consumed via CSS vars) but resolve to
 * restrained rings.
 */
export const shadows = {
  none: "none",
  raisedSm: "0 1px 2px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.04)",
  raisedMd: "0 4px 14px -6px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.05)",
  raisedLg: "0 16px 40px -16px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.06)",
  raisedXl: "0 28px 64px -24px rgb(0 0 0 / 0.66), 0 0 0 1px rgb(255 255 255 / 0.06)",
  pressedSm: "inset 0 1px 2px rgb(0 0 0 / 0.36)",
  pressedMd: "inset 0 2px 6px rgb(0 0 0 / 0.42)",
  pressedLg: "inset 0 4px 12px rgb(0 0 0 / 0.48)",
  flat: "0 0 0 1px rgb(255 255 255 / 0.06)",
  flatSubtle: "0 0 0 1px rgb(255 255 255 / 0.04)",
  lift: "0 28px 64px -24px rgb(0 0 0 / 0.7)",
  glow: {
    accent: "0 0 0 1px rgb(91 91 246 / 0.5)",
    violet: "0 0 0 1px rgb(91 91 246 / 0.5)",
    gold: "0 0 0 1px rgb(91 91 246 / 0.5)",
    cyan: "0 0 0 1px rgb(91 91 246 / 0.5)",
    lime: "0 0 0 1px rgb(43 184 126 / 0.45)",
    danger: "0 0 0 1px rgb(242 86 106 / 0.55)",
    aura: "0 16px 40px -16px rgb(0 0 0 / 0.6)",
  },
} as const;

export const motion = {
  durations: {
    instant: "80ms",
    fast: "140ms",
    base: "220ms",
    slow: "360ms",
    layout: "520ms",
  },
  easings: {
    out: "cubic-bezier(0.22, 1, 0.36, 1)",
    inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
    spring: "cubic-bezier(0.32, 0.72, 0, 1)",
    quartOut: "cubic-bezier(0.165, 0.84, 0.44, 1)",
    expoOut: "cubic-bezier(0.16, 1, 0.3, 1)",
    bouncy: "cubic-bezier(0.34, 1.2, 0.64, 1)",
  },
  spring: {
    soft: { stiffness: 180, damping: 28, mass: 1 },
    snappy: { stiffness: 280, damping: 24, mass: 1 },
    bouncy: { stiffness: 360, damping: 22, mass: 0.9 },
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
  size: "32px",
  lineWidth: "1px",
  color: "rgb(255 255 255 / 0.03)",
} as const;

export const fontFamily = {
  sans: '"Inter Variable", "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  display: '"Inter Variable", "Inter", system-ui, sans-serif',
  serif: '"Inter Variable", "Inter", system-ui, sans-serif',
  mono: '"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export const tokens = {
  colors,
  radii,
  spacing,
  blurs,
  gradients,
  letterSpacing,
  fontSize,
  fontWeight,
  shadows,
  motion,
  zIndex,
  microGrid,
  fontFamily,
} as const;

export type Tokens = typeof tokens;
