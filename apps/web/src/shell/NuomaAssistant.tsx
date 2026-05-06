import { Alignment, Fit, Layout, useRive } from "@rive-app/react-canvas";
import { useEffect, useState } from "react";

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@nuoma/ui";

const ASSISTANT_SRC = "/mascot/nuoma-assistant.riv";

type AssetState = "checking" | "rive" | "fallback";

export function NuomaAssistant({ className }: { className?: string }) {
  const [assetState, setAssetState] = useState<AssetState>("checking");

  useEffect(() => {
    let cancelled = false;
    void fetch(ASSISTANT_SRC, { method: "HEAD", cache: "no-store" })
      .then((response) => {
        const contentType = response.headers.get("content-type") ?? "";
        const isRiveAsset = response.ok && !contentType.includes("text/html");
        if (!cancelled) setAssetState(isRiveAsset ? "rive" : "fallback");
      })
      .catch(() => {
        if (!cancelled) setAssetState("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Tooltip delayDuration={180}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "nuoma-assistant-motion botforge-surface relative h-14 w-14 shrink-0 rounded-[1.25rem]",
            "transition-shadow hover:shadow-glow-cyan",
            className,
          )}
          role="img"
          aria-label="Assistente Nuoma"
          style={{ animation: "nuoma-assistant-float 4.8s ease-in-out infinite" }}
        >
          {assetState === "rive" ? <RiveAssistant /> : <FallbackAssistant />}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">Nuoma</TooltipContent>
    </Tooltip>
  );
}

function RiveAssistant() {
  const { RiveComponent } = useRive({
    src: ASSISTANT_SRC,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  return <RiveComponent className="h-full w-full" />;
}

function FallbackAssistant() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        className="absolute inset-1 rounded-[1rem] border border-white/15"
        style={{
          background:
            "linear-gradient(145deg, rgba(255,255,255,.52), rgba(255,255,255,.14) 35%, var(--robot-body) 72%)",
          boxShadow:
            "inset 0 2px 2px rgba(255,255,255,.34), inset 0 -2px 3px rgba(0,0,0,.16), 0 16px 34px var(--glow-active)",
        }}
      />
      <div
        className="relative h-7 w-9 rounded-2xl border border-white/15"
        style={{
          background:
            "linear-gradient(180deg, rgb(var(--color-brand-cyan) / 0.18), var(--robot-face))",
          boxShadow: "inset 0 0 0 1px rgb(var(--color-border-active) / 0.22)",
        }}
      >
        <span
          className="nuoma-assistant-motion absolute left-2 top-2 h-1.5 w-1.5 rounded-full"
          style={{
            background: "var(--robot-eye)",
            boxShadow: "0 0 10px var(--robot-eye)",
            animation: "nuoma-assistant-eye 5.2s ease-in-out infinite",
          }}
        />
        <span
          className="nuoma-assistant-motion absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
          style={{
            background: "var(--robot-eye)",
            boxShadow: "0 0 10px var(--robot-eye)",
            animation: "nuoma-assistant-eye 5.2s ease-in-out infinite",
          }}
        />
      </div>
      <span className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full bg-brand-cyan/55 shadow-glow-cyan" />
      <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-brand-violet/55" />
      <span className="absolute bottom-2 h-1 w-6 rounded-full bg-brand-cyan/55" />
    </div>
  );
}
