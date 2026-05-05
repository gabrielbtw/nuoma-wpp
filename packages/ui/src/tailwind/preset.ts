/**
 * Tailwind 3 preset mapping V2.8 Cartographic Operations tokens to theme keys.
 */
import type { Config } from "tailwindcss";

import {
  blurs,
  colors,
  fontFamily,
  motion,
  radii,
  shadows,
  spacing,
  zIndex,
} from "../tokens/index.js";

function flatColors() {
  return {
    bg: colors.bg,
    fg: colors.fg,
    channel: colors.channels,
    semantic: colors.semantic,
    brand: colors.brand,
    contour: colors.contour,
    signal: colors.signal,
    shadow: colors.shadow,
    transparent: "transparent",
    current: "currentColor",
  } as const;
}

function flatBoxShadow() {
  return {
    none: "none",
    "raised-sm": shadows.raisedSm,
    "raised-md": shadows.raisedMd,
    "raised-lg": shadows.raisedLg,
    "raised-xl": shadows.raisedXl,
    "pressed-sm": shadows.pressedSm,
    "pressed-md": shadows.pressedMd,
    "pressed-lg": shadows.pressedLg,
    flat: shadows.flat,
    "flat-subtle": shadows.flatSubtle,
    lift: shadows.lift,
    "glow-violet": shadows.glow.violet,
    "glow-cyan": shadows.glow.cyan,
    "glow-lime": shadows.glow.lime,
    "glow-danger": shadows.glow.danger,
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
