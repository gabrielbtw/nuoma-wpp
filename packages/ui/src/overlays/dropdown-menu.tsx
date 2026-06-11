import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const DropdownMenu = RadixDropdown.Root;
export const DropdownMenuTrigger = RadixDropdown.Trigger;
export const DropdownMenuGroup = RadixDropdown.Group;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdown.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <RadixDropdown.Portal>
    <RadixDropdown.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-dropdown min-w-[10rem] overflow-hidden",
        "bg-surface-1 rounded-xl shadow-lifted",
        "p-2 text-sm text-ink-strong outline-none",
        className,
      )}
      {...props}
    />
  </RadixDropdown.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdown.Item>
>(({ className, ...props }, ref) => (
  <RadixDropdown.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2",
      "text-ink",
      "data-[highlighted]:bg-surface-4 data-[highlighted]:text-ink-strong data-[highlighted]:shadow-flat",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      "outline-none transition-shadow duration-fast",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdown.Separator>
>(({ className, ...props }, ref) => (
  <RadixDropdown.Separator
    ref={ref}
    className={cn("my-1.5 h-px bg-line-hairline", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdown.Label>
>(({ className, ...props }, ref) => (
  <RadixDropdown.Label
    ref={ref}
    className={cn("px-3 py-1.5 text-xs uppercase tracking-wider text-ink-soft", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdown.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <RadixDropdown.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-3 text-sm",
      "text-ink data-[highlighted]:bg-surface-4 data-[highlighted]:text-ink-strong outline-none",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <RadixDropdown.ItemIndicator>
        <Check className="h-3 w-3" />
      </RadixDropdown.ItemIndicator>
    </span>
    {children}
  </RadixDropdown.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
