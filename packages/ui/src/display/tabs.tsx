import * as RadixTabs from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixTabs.List>>(
  ({ className, ...props }, ref) => (
    <RadixTabs.List
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-line-hairline bg-surface-deep/72 p-1",
        className,
      )}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      "rounded-lg px-4 py-1.5 text-sm font-medium text-ink",
      "data-[state=active]:bg-surface-3 data-[state=active]:text-ink-strong data-[state=active]:shadow-raised",
      "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
      "transition-shadow duration-base",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ className, ...props }, ref) => (
  <RadixTabs.Content ref={ref} className={cn("mt-5 outline-none", className)} {...props} />
));
TabsContent.displayName = "TabsContent";
