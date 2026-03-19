import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  pending = false,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "secondary" | "ghost" | "danger";
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="w-[min(460px,92vw)]">
        <div className="space-y-5">
          <div>
            <DialogTitle className="font-display text-2xl text-white">{title}</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-400">{description}</DialogDescription>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel}>
              Voltar
            </Button>
            <Button variant={confirmVariant} disabled={pending} onClick={() => void onConfirm()}>
              {pending ? "Processando..." : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
