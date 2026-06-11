import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "../utils/cn.js";

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;
export const SheetTitle = RadixDialog.Title;
export const SheetDescription = RadixDialog.Description;

const SIDE: Record<"left" | "right" | "top" | "bottom", string> = {
  left: "left-3 top-3 bottom-3 w-full max-w-md rounded-xxl",
  right: "right-3 top-3 bottom-3 w-full max-w-md rounded-xxl",
  top: "top-3 left-3 right-3 max-h-[85vh] rounded-xxl",
  bottom: "bottom-3 left-3 right-3 max-h-[85vh] rounded-xxl",
};

export interface SheetContentProps extends ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  side?: keyof typeof SIDE;
  showClose?: boolean;
  children?: ReactNode;
}

export const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  ({ side = "right", className, children, showClose = true, ...props }, ref) => (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-overlay bg-surface-deep/70" />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          "fixed z-drawer bg-surface-1 shadow-lifted",
          "p-7 outline-none",
          SIDE[side],
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <RadixDialog.Close
            aria-label="Fechar"
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-1 text-ink shadow-flat hover:shadow-raised hover:text-ink-strong transition-shadow"
          >
            <X className="h-3.5 w-3.5" />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  ),
);
SheetContent.displayName = "SheetContent";
