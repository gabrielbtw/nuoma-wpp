import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "../utils/cn.js";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
    showClose?: boolean;
    children?: ReactNode;
  }
>(({ className, children, showClose = true, ...props }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay
      className="fixed inset-0 z-overlay bg-bg-deep/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out"
    />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-modal -translate-x-1/2 -translate-y-1/2",
        "w-full max-w-lg",
        "bg-bg-base rounded-xxl shadow-lift",
        "p-7 outline-none",
        className,
      )}
      {...props}
    >
      {children}
      {showClose && (
        <RadixDialog.Close
          aria-label="Fechar"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-bg-base text-fg-muted shadow-flat hover:shadow-raised-sm hover:text-fg-primary transition-shadow"
        >
          <X className="h-3.5 w-3.5" />
        </RadixDialog.Close>
      )}
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
DialogContent.displayName = "DialogContent";
