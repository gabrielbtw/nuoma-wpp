import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-n-bg disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-n-blue text-white shadow-sm shadow-n-blue/25 hover:bg-n-blue/90 hover:shadow-md hover:shadow-n-blue/30 active:scale-[0.98]",
        secondary: "bg-n-surface-2 text-n-text ring-1 ring-white/[0.06] hover:bg-n-surface-2/80 hover:ring-white/[0.1] active:scale-[0.98]",
        ghost: "bg-transparent text-n-text-muted hover:bg-n-surface-2/60 hover:text-n-text active:scale-[0.98]",
        outline: "bg-transparent border border-n-border text-n-text hover:bg-n-surface-2/40 hover:border-n-border/80 active:scale-[0.98]",
        danger: "bg-n-red/90 text-white shadow-sm shadow-n-red/20 hover:bg-n-red hover:shadow-md hover:shadow-n-red/25 active:scale-[0.98]"
      },
      size: {
        default: "h-9 px-4 py-2 text-body",
        sm: "h-8 px-3 text-caption",
        lg: "h-11 px-6 text-body-lg",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { }

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));

Button.displayName = "Button";
