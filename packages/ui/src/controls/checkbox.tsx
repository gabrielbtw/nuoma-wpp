import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const Checkbox = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixCheckbox.Root>
>(({ className, ...props }, ref) => (
  <RadixCheckbox.Root
    ref={ref}
    className={cn(
      "h-5 w-5 rounded-md bg-surface-1 shadow-inset data-[state=checked]:bg-accent data-[state=checked]:shadow-flat",
      "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
      "transition-shadow duration-base",
      "disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadixCheckbox.Indicator className="flex items-center justify-center text-accent-on">
      <Check className="h-3 w-3" strokeWidth={3} />
    </RadixCheckbox.Indicator>
  </RadixCheckbox.Root>
));
Checkbox.displayName = "Checkbox";
