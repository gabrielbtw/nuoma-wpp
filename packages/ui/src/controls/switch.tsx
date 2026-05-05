import * as RadixSwitch from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const Switch = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(({ className, ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    className={cn(
      "relative h-6 w-11 rounded-full bg-bg-base shadow-pressed-sm",
      "outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
      "data-[state=checked]:shadow-glow-cyan",
      "transition-shadow duration-base",
      "disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadixSwitch.Thumb
      className={cn(
        "block h-4 w-4 rounded-full bg-bg-base shadow-raised-sm",
        "transition-transform duration-base ease-out",
        "translate-x-1 data-[state=checked]:translate-x-6 data-[state=checked]:bg-brand-cyan",
      )}
    />
  </RadixSwitch.Root>
));
Switch.displayName = "Switch";
