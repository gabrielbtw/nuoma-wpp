import * as RadixRadio from "@radix-ui/react-radio-group";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const RadioGroup = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixRadio.Root>
>(({ className, ...props }, ref) => (
  <RadixRadio.Root ref={ref} className={cn("flex flex-col gap-3", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

export const RadioItem = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixRadio.Item>
>(({ className, ...props }, ref) => (
  <RadixRadio.Item
    ref={ref}
    className={cn(
      "h-5 w-5 rounded-full bg-surface-1 shadow-inset",
      "data-[state=checked]:shadow-flat",
      "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
      "transition-shadow duration-base",
      "disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadixRadio.Indicator className="flex items-center justify-center after:block after:h-2 after:w-2 after:rounded-full after:bg-accent" />
  </RadixRadio.Item>
));
RadioItem.displayName = "RadioItem";
