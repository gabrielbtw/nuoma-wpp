import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-xl border border-n-border bg-n-bg px-3 text-body text-n-text outline-none transition-all duration-200 placeholder:text-n-text-dim/60 focus:border-n-blue/40 focus:ring-2 focus:ring-n-blue/15",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";
