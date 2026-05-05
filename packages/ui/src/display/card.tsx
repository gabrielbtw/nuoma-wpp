import { motion } from "framer-motion";
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  variant?: "raised" | "pressed";
}

/**
 * Card — flat contour tile. With `interactive`, lifts subtly on hover.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, variant = "raised", ...props }, ref) => {
    const baseShadow = variant === "pressed" ? "shadow-pressed-md" : "shadow-raised-md";
    const hoverShadow = variant === "pressed" ? "" : "hover:shadow-raised-lg";
    if (interactive) {
      return (
        <motion.div
          ref={ref}
          whileHover={{ y: -2 }}
          transition={{ type: "spring", stiffness: 280, damping: 24 }}
          className={cn(
            "bg-bg-base rounded-xxl p-6",
            baseShadow,
            "transition-shadow duration-base ease-out",
            hoverShadow,
            className,
          )}
          {...(props as Record<string, unknown>)}
        />
      );
    }
    return (
      <div
        ref={ref}
        className={cn(
          "bg-bg-base rounded-xxl p-6",
          baseShadow,
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1 mb-5", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "font-display text-base font-semibold tracking-tight text-fg-primary",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-fg-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn(className)} {...props} />,
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 mt-5", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
