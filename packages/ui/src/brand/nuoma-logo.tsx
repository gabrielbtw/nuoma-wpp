import { forwardRef, type SVGProps } from "react";

import { cn } from "../utils/cn.js";

export type NuomaLogoVariant = "mark" | "wordmark" | "lockup" | "mono" | "gold" | "small";
export type NuomaLogoTone = "default" | "gold" | "mono";

export interface NuomaLogoProps extends SVGProps<SVGSVGElement> {
  variant?: NuomaLogoVariant;
  tone?: NuomaLogoTone;
  title?: string;
}

const tones = {
  default: {
    primary: "rgb(var(--color-brand-blue, 75 119 154))",
    secondary: "rgb(var(--color-brand-teal-soft, 176 213 222))",
    ghost: "rgb(var(--color-fg-faint, 82 88 104))",
  },
  gold: {
    primary: "rgb(var(--color-brand-blue, 75 119 154))",
    secondary: "rgb(var(--color-brand-teal-soft, 176 213 222))",
    ghost: "rgb(var(--color-brand-blue, 75 119 154))",
  },
  mono: {
    primary: "currentColor",
    secondary: "currentColor",
    ghost: "currentColor",
  },
} as const;

function resolveTone(variant: NuomaLogoVariant, tone?: NuomaLogoTone): NuomaLogoTone {
  if (tone) return tone;
  if (variant === "mono") return "mono";
  if (variant === "gold") return "gold";
  return "default";
}

function Mark({ tone, compact = false }: { tone: NuomaLogoTone; compact?: boolean }) {
  const color = tones[tone];
  const opacity = tone === "mono" ? 0.32 : 0.18;
  const strokeWidth = compact ? 7 : 6;

  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M18 118V49C18 23 31.6 10 48 10s30 13 30 39v69"
        opacity={opacity}
        stroke={color.ghost}
        strokeWidth={strokeWidth}
      />
      <path d="M27 68h16l5-7 5 7h16" stroke={color.primary} strokeWidth={strokeWidth} />
      <path d="M38 76c6 0 10 4.4 10 10.4V118" stroke={color.primary} strokeWidth={strokeWidth} />
      <path d="M58 76c-6 0-10 4.4-10 10.4V118" stroke={color.primary} strokeWidth={strokeWidth} />
      <path
        d="M48 38l15 18-15 18-15-18 15-18Z"
        opacity={tone === "mono" ? 0.5 : 0.68}
        stroke={color.secondary}
        strokeWidth={compact ? 5 : 4.5}
      />
    </g>
  );
}

function Wordmark({ tone }: { tone: NuomaLogoTone }) {
  const color = tones[tone];

  return (
    <text
      x="0"
      y="82"
      fill={color.primary}
      fontFamily="Inter Variable, Inter, Avenir Next, system-ui, sans-serif"
      fontSize="98"
      fontWeight="620"
      letterSpacing="0"
    >
      nuoma
    </text>
  );
}

export const NuomaLogo = forwardRef<SVGSVGElement, NuomaLogoProps>(
  ({ variant = "lockup", tone, title = "Nuoma", className, ...props }, ref) => {
    const resolvedTone = resolveTone(variant, tone);
    const shape =
      variant === "mark" || variant === "small"
        ? "mark"
        : variant === "wordmark"
          ? "wordmark"
          : "lockup";
    const compact = variant === "small";

    if (shape === "mark") {
      return (
        <svg
          ref={ref}
          viewBox="0 0 96 128"
          role={title ? "img" : undefined}
          aria-hidden={title ? undefined : true}
          className={cn(compact ? "h-8 w-6" : "h-12 w-9", className)}
          {...props}
        >
          {title ? <title>{title}</title> : null}
          <Mark tone={resolvedTone} compact={compact} />
        </svg>
      );
    }

    if (shape === "wordmark") {
      return (
        <svg
          ref={ref}
          viewBox="0 0 370 112"
          role={title ? "img" : undefined}
          aria-hidden={title ? undefined : true}
          className={cn("h-10 w-auto", className)}
          {...props}
        >
          {title ? <title>{title}</title> : null}
          <Wordmark tone={resolvedTone} />
        </svg>
      );
    }

    return (
      <svg
        ref={ref}
        viewBox="0 0 470 132"
        role={title ? "img" : undefined}
        aria-hidden={title ? undefined : true}
        className={cn("h-12 w-auto", className)}
        {...props}
      >
        {title ? <title>{title}</title> : null}
        <g transform="translate(0 0) scale(.9)">
          <Mark tone={resolvedTone} />
        </g>
        <g transform="translate(105 12)">
          <Wordmark tone={resolvedTone} />
        </g>
      </svg>
    );
  },
);
NuomaLogo.displayName = "NuomaLogo";

export const nuomaBrandAssets = {
  mark: "/assets/brand/nuoma-mark.svg",
  wordmark: "/assets/brand/nuoma-wordmark.svg",
  lockup: "/assets/brand/nuoma-lockup.svg",
  lockupGold: "/assets/brand/nuoma-lockup-gold.svg",
  lockupMono: "/assets/brand/nuoma-lockup-mono.svg",
  small: "/assets/brand/nuoma-small.svg",
} as const;
