import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { cn } from "../utils/cn.js";

type ToastVariant = "info" | "success" | "warning" | "danger";

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  push(toast: Omit<Toast, "id" | "variant"> & { variant?: ToastVariant }): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastContextValue["push"]>(
    (input) => {
      const id = nextId++;
      const toast: Toast = { id, variant: "info", ...input };
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const VARIANT_RING: Record<ToastVariant, string> = {
  info: "before:bg-semantic-info",
  success: "before:bg-semantic-success",
  warning: "before:bg-semantic-warning",
  danger: "before:bg-semantic-danger",
};

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      role="region"
      aria-label="Notificações"
      className="fixed bottom-5 right-5 z-toast flex flex-col gap-3 w-80 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: 32, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 32, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            role="status"
            aria-live="polite"
            className={cn(
              "botforge-surface relative flex items-start gap-3 p-4 pl-5 rounded-xl pointer-events-auto",
              "before:absolute before:left-1.5 before:top-3 before:bottom-3 before:w-1 before:rounded-full",
              VARIANT_RING[toast.variant],
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-fg-primary">{toast.title}</div>
              {toast.description && (
                <div className="text-xs text-fg-muted mt-0.5">{toast.description}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dispensar"
              className="text-fg-dim hover:text-fg-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
