import * as RadixAccordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn.js";

export const Accordion = RadixAccordion.Root;

export const AccordionItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixAccordion.Item>
>(({ className, ...props }, ref) => (
  <RadixAccordion.Item
    ref={ref}
    className={cn(
      "rounded-xl bg-surface-1 shadow-flat data-[state=open]:shadow-inset transition-shadow",
      className,
    )}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

export const AccordionTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixAccordion.Trigger>
>(({ className, children, ...props }, ref) => (
  <RadixAccordion.Header className="flex">
    <RadixAccordion.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between px-4 py-3 text-sm font-medium text-ink-strong",
        "outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        "[&[data-state=open]>svg]:rotate-180",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 transition-transform duration-base text-ink" />
    </RadixAccordion.Trigger>
  </RadixAccordion.Header>
));
AccordionTrigger.displayName = "AccordionTrigger";

export const AccordionContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixAccordion.Content>
>(({ className, children, ...props }, ref) => (
  <RadixAccordion.Content
    ref={ref}
    className={cn("overflow-hidden text-sm text-ink", className)}
    {...props}
  >
    <div className="px-4 pb-3">{children}</div>
  </RadixAccordion.Content>
));
AccordionContent.displayName = "AccordionContent";
