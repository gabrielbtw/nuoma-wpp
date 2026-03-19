import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[110px] w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-slate-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";
