import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const Select = RadixSelect.Root;
export const SelectGroup = RadixSelect.Group;
export const SelectValue = RadixSelect.Value;

export const SelectTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <RadixSelect.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-11 w-full items-center justify-between gap-2 px-4 text-sm",
      "rounded-lg bg-bg-base text-fg-primary shadow-pressed-sm",
      "outline-none focus:ring-2 focus:ring-brand-cyan/60 focus:ring-offset-2 focus:ring-offset-bg-base",
      "transition-shadow duration-base",
      "disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
    <RadixSelect.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-60" />
    </RadixSelect.Icon>
  </RadixSelect.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixSelect.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      ref={ref}
      position={position}
      sideOffset={6}
      className={cn(
        "z-dropdown overflow-hidden",
        "bg-bg-base shadow-lift rounded-xl",
        "min-w-[10rem] p-2",
        className,
      )}
      {...props}
    >
      <RadixSelect.ScrollUpButton className="flex items-center justify-center p-1">
        <ChevronUp className="h-4 w-4" />
      </RadixSelect.ScrollUpButton>
      <RadixSelect.Viewport>{children}</RadixSelect.Viewport>
      <RadixSelect.ScrollDownButton className="flex items-center justify-center p-1">
        <ChevronDown className="h-4 w-4" />
      </RadixSelect.ScrollDownButton>
    </RadixSelect.Content>
  </RadixSelect.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixSelect.Item>
>(({ className, children, ...props }, ref) => (
  <RadixSelect.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-8 py-2 text-sm",
      "text-fg-muted outline-none",
      "data-[highlighted]:bg-bg-elevated data-[highlighted]:text-fg-primary data-[highlighted]:shadow-flat",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      "transition-shadow duration-fast",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <RadixSelect.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-brand-cyan" />
      </RadixSelect.ItemIndicator>
    </span>
    <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
  </RadixSelect.Item>
));
SelectItem.displayName = "SelectItem";
