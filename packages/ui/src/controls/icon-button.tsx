import { forwardRef, type ReactNode } from "react";

import { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button.js";
import { cn } from "../utils/cn.js";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "leftIcon" | "rightIcon"> {
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "h-7 w-7 min-w-7 px-0",
  sm: "h-9 w-9 min-w-9 px-0",
  md: "h-10 w-10 min-w-10 px-0",
  lg: "h-11 w-11 min-w-11 px-0",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, size = "md", variant = "ghost", className, ...props }, ref) => (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn(SIZE_CLASS[size], className)}
      {...props}
    >
      {icon}
    </Button>
  ),
);
IconButton.displayName = "IconButton";
