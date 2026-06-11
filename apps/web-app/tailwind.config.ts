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
        // Nuoma brand palette
        "n-bg": "#0a0a0c",
        "n-surface": "#111114",
        "n-surface-2": "#18181c",
        "n-border": "#232328",
        "n-border-subtle": "#1c1c21",
        "n-text": "#e4e4e7",
        "n-text-muted": "#71717a",
        "n-text-dim": "#52525b",
        // Semantic
        "n-wa": "#22c55e",
        "n-ig": "#e879f9",
        "n-blue": "#3b82f6",
        "n-amber": "#f59e0b",
        "n-red": "#ef4444",
        "n-cyan": "#06b6d4",
        // Legacy compat
        "cmm-blue": "#3b82f6",
        "cmm-emerald": "#22c55e",
        "cmm-purple": "#8b5cf6",
        "cmm-orange": "#f59e0b",
      },
      borderRadius: {
        "3xl": "1.5rem",
        "4xl": "2rem",
        xl: "0.75rem"
      },
      fontSize: {
        // Typography scale
        "h1": ["1.75rem", { lineHeight: "2rem", fontWeight: "700", letterSpacing: "-0.025em" }],
        "h2": ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600", letterSpacing: "-0.02em" }],
        "h3": ["1rem", { lineHeight: "1.5rem", fontWeight: "600", letterSpacing: "-0.01em" }],
        "h4": ["0.875rem", { lineHeight: "1.25rem", fontWeight: "600" }],
        "body-lg": ["0.9375rem", { lineHeight: "1.5rem", fontWeight: "400" }],
        "body": ["0.8125rem", { lineHeight: "1.375rem", fontWeight: "400" }],
        "caption": ["0.75rem", { lineHeight: "1rem", fontWeight: "500" }],
        "label": ["0.6875rem", { lineHeight: "1rem", fontWeight: "600", letterSpacing: "0.02em" }],
        "micro": ["0.625rem", { lineHeight: "0.875rem", fontWeight: "600", letterSpacing: "0.04em" }],
      },
      boxShadow: {
        panel: "0 24px 80px rgba(0, 0, 0, 0.4)",
        glass: "inset 0 1px 0 0 rgba(255, 255, 255, 0.05)",
        "soft": "0 1px 3px rgba(0,0,0,0.3)",
        "glow-wa": "0 0 20px rgba(34, 197, 94, 0.15)",
        "glow-ig": "0 0 20px rgba(232, 121, 249, 0.15)",
        "glow-blue": "0 0 20px rgba(59, 130, 246, 0.15)",
      },
      fontFamily: {
        display: ["\"SF Pro Display\"", "Inter", "system-ui", "sans-serif"],
        body: ["\"SF Pro Text\"", "Inter", "system-ui", "sans-serif"],
        mono: ["\"SF Mono\"", "\"JetBrains Mono\"", "monospace"]
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "slide-down": "slideDown 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        slideOutRight: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
    }
  },
  plugins: []
};

export default config;
