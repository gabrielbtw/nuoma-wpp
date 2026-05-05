import type { Config } from "tailwindcss";

import nuomaPreset from "@nuoma/ui/tailwind-preset";

export default {
  presets: [nuomaPreset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
