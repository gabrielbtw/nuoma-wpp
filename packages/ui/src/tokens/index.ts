/**
 * Nuoma Carvão & Cobre — design tokens.
 *
 * Identidade única dark: canvas carvão quente, tinta off-white quente,
 * separadores hairline e UM acento cobre reservado a ação, foco e estado
 * vivo. Superfícies numeradas por elevação, status separado de acento,
 * paleta de gráfico dedicada. Sem glass, sem glow, sem gradiente atrás
 * de dado denso, sem segunda cor de marca.
 *
 * O preset Tailwind lê CSS variables (definidas em apps/web
 * src/styles/tokens.css) por nome; estes valores JS são a fonte da verdade
 * para tipografia, forma, espaçamento e motion — os triplets de cor vivem
 * no stylesheet ao lado.
 */

export const colors = {
  /** Elevação numérica: deep < 0 (canvas) < 1..5 (modal/hover). */
  surface: {
    deep: "10 9 8",
    0: "14 13 11",
    1: "21 19 16",
    2: "26 24 20",
    3: "31 28 24",
    4: "37 33 28",
    5: "45 41 35",
  },
  ink: {
    strong: "245 242 236",
    base: "178 171 159",
    soft: "148 141 130",
    faint: "132 126 115",
  },
  /** Acento único — cobre. `on` é a tinta sobre superfícies cobre (AA). */
  accent: {
    base: "232 100 44",
    hover: "255 122 69",
    muted: "156 74 38",
    on: "26 13 6",
  },
  line: {
    hairline: "42 38 33",
    soft: "58 53 45",
    strong: "82 75 65",
  },
  status: {
    ok: "52 199 123",
    warn: "230 176 28",
    error: "240 90 86",
    info: "92 162 250",
  },
  channel: {
    wa: "43 209 126",
    ig: "225 86 143",
    sys: "232 100 44",
  },
  chart: {
    1: "232 100 44",
    2: "217 164 91",
    3: "92 162 250",
    4: "52 199 123",
    5: "196 145 220",
    6: "240 90 86",
    grid: "42 38 33",
    label: "141 134 123",
  },
} as const;

/**
 * Washes de gradiente quase invisíveis. Reservados a empty states e à tela
 * de auth — nunca atrás de dado denso. Resolvem para CSS vars.
 */
export const gradients = {
  accent: "var(--gradient-accent)",
  aura: "var(--gradient-aura)",
  glass: "var(--gradient-glass)",
} as const;

/** Letter-spacing: display aperta; eyebrows (labels mono) abrem. */
export const letterSpacing = {
  tight: "-0.01em",
  display: "-0.02em",
  displayTight: "-0.03em",
  normal: "0",
  wide: "0.02em",
  eyebrow: "0.08em",
  widest: "0.14em",
} as const;

/** Raios contidos — cards 10px, pill só em badge/contagem. */
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

/** Escala de espaçamento fluida — respira em telas maiores. */
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
 * Escala tipográfica fluida. `eyebrow` é o label mono; `body` o tamanho de
 * leitura. Display/h1/h2 são servidos em Space Grotesk via font-display.
 * Tupla = [size, { lineHeight, letterSpacing, fontWeight }].
 */
export const fontSize = {
  eyebrow: ["0.6875rem", { lineHeight: "1", letterSpacing: "0.08em", fontWeight: "560" }],
  caption: ["0.75rem", { lineHeight: "1.4", letterSpacing: "0" }],
  small: ["0.8125rem", { lineHeight: "1.45", letterSpacing: "0" }],
  body: ["0.9375rem", { lineHeight: "1.55", letterSpacing: "0" }],
  lead: ["1.0625rem", { lineHeight: "1.5", letterSpacing: "-0.005em" }],
  h3: ["1.0625rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
  h2: [
    "clamp(1.15rem, 1.05rem + 0.5vw, 1.25rem)",
    { lineHeight: "1.25", letterSpacing: "-0.015em", fontWeight: "600" },
  ],
  h1: [
    "clamp(1.35rem, 1.2rem + 0.8vw, 1.5rem)",
    { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "620" },
  ],
  display: [
    "clamp(1.7rem, 1.4rem + 1.6vw, 2.1rem)",
    { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "640" },
  ],
  "display-lg": [
    "clamp(2.1rem, 1.6rem + 2.6vw, 2.75rem)",
    { lineHeight: "1.04", letterSpacing: "-0.03em", fontWeight: "660" },
  ],
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
 * Profundidade: hairline rings + sombras baixas e macias. Sem neon/glow.
 * Nomes "glow" são aliases de compatibilidade (resolvem para rings contidos)
 * e morrem junto com o CSS legado.
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
    accent: "0 0 0 1px rgb(232 100 44 / 0.5)",
    violet: "0 0 0 1px rgb(232 100 44 / 0.5)",
    gold: "0 0 0 1px rgb(232 100 44 / 0.5)",
    cyan: "0 0 0 1px rgb(232 100 44 / 0.5)",
    lime: "0 0 0 1px rgb(52 199 123 / 0.45)",
    danger: "0 0 0 1px rgb(240 90 86 / 0.55)",
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
  display: '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", system-ui, sans-serif',
  serif: '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
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
