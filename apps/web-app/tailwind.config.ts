import type { Config } from "tailwindcss";

const withOpacity = (variable: string) => `hsl(var(${variable}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: withOpacity("--background"),
        foreground: withOpacity("--foreground"),
        card: withOpacity("--card"),
        border: withOpacity("--border"),
        muted: withOpacity("--muted"),
        accent: withOpacity("--accent"),
        primary: withOpacity("--primary"),
        secondary: withOpacity("--secondary"),
        success: withOpacity("--success"),
        warning: withOpacity("--warning"),
        danger: withOpacity("--danger"),
        "cmm-blue": "#007AFF",
        "cmm-emerald": "#10b981",
        "cmm-purple": "#8b5cf6",
        "cmm-orange": "#f59e0b",
      },
      borderRadius: {
        "3xl": "1.5rem",
        "4xl": "2rem",
        xl: "1rem"
      },
      boxShadow: {
        panel: "0 24px 80px rgba(0, 0, 0, 0.4)",
        glass: "inset 0 1px 0 0 rgba(255, 255, 255, 0.05)",
      },
      fontFamily: {
        display: ["\"SF Pro Display\"", "Inter", "system-ui", "sans-serif"],
        body: ["\"SF Pro Text\"", "Inter", "system-ui", "sans-serif"]
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      }
    }
  },
  plugins: []
};

export default config;
