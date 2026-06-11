import * as RadixTooltip from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export const TooltipContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <RadixTooltip.Portal>
    <RadixTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-dropdown px-3 py-1.5 text-xs",
        "bg-surface-1 text-ink-strong rounded-md shadow-raised",
        className,
      )}
      {...props}
    />
  </RadixTooltip.Portal>
));
TooltipContent.displayName = "TooltipContent";
