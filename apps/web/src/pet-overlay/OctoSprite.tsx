import { useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@nuoma/ui";

import { OCTO_CELL_HEIGHT, OCTO_CELL_WIDTH, getOctoSpriteStyle } from "./sprite.js";
import type { OctoVisualState } from "./types.js";

const DEFAULT_SPRITE_SRC = "/assets/pets/octo/spritesheet.webp";
const DEFAULT_FALLBACK_SRC = "/assets/pets/octo/fallback.png";

interface OctoSpriteProps {
  state: OctoVisualState;
  className?: string;
  spriteSrc?: string;
  fallbackSrc?: string;
}

export function OctoSprite({
  state,
  className,
  spriteSrc = DEFAULT_SPRITE_SRC,
  fallbackSrc = DEFAULT_FALLBACK_SRC,
}: OctoSpriteProps) {
  const reduceMotion = useReducedMotion();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [assetMode, setAssetMode] = useState<"checking" | "sprite" | "fallback">("checking");

  useEffect(() => {
    let cancelled = false;
    void fetch(spriteSrc, { method: "HEAD", cache: "no-store" })
      .then((response) => {
        const contentType = response.headers.get("content-type") ?? "";
        if (!cancelled)
          setAssetMode(response.ok && !contentType.includes("text/html") ? "sprite" : "fallback");
      })
      .catch(() => {
        if (!cancelled) setAssetMode("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, [spriteSrc]);

  useEffect(() => {
    if (reduceMotion || assetMode !== "sprite") {
      setElapsedMs(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    function tick(now: number) {
      setElapsedMs(now - start);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [assetMode, reduceMotion, state]);

  useEffect(() => {
    setElapsedMs(0);
  }, [state]);

  const spriteStyle = useMemo(
    () => getOctoSpriteStyle(state, reduceMotion ? 0 : elapsedMs),
    [elapsedMs, reduceMotion, state],
  );

  return (
    <div
      className={cn("octo-sprite-frame", className)}
      data-testid="octo-sprite"
      data-state={state}
      data-asset-mode={assetMode}
      style={{ aspectRatio: `${OCTO_CELL_WIDTH} / ${OCTO_CELL_HEIGHT}` }}
    >
      {assetMode === "sprite" ? (
        <div
          className="h-full w-full bg-no-repeat"
          aria-hidden="true"
          style={{
            backgroundImage: `url(${spriteSrc})`,
            backgroundPosition: spriteStyle.backgroundPosition,
            backgroundSize: spriteStyle.backgroundSize,
            imageRendering: "pixelated",
          }}
        />
      ) : (
        <img
          src={fallbackSrc}
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
          onError={() => setAssetMode("fallback")}
        />
      )}
    </div>
  );
}
