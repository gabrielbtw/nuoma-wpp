import { useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@nuoma/ui";

type ConfirmDangerActionProps = {
  buttonLabel: string;
  confirmText: string;
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
  description?: string;
  disabled?: boolean;
  loading?: boolean;
  testId?: string;
};

export function ConfirmDangerAction({
  buttonLabel,
  confirmText,
  value,
  onValueChange,
  onConfirm,
  description,
  disabled = false,
  loading = false,
  testId,
}: ConfirmDangerActionProps) {
  const [open, setOpen] = useState(false);
  const confirmed = value === confirmText;
  return (
    <div className="grid min-w-[10rem] gap-1.5" data-testid={testId}>
      <Dialog open={open} onOpenChange={setOpen}>
        <Button variant="danger" size="sm" loading={loading} disabled={disabled} onClick={() => setOpen(true)}>
          {buttonLabel}
        </Button>
        <DialogContent
          className="max-w-md border border-line-hairline bg-surface-1 text-ink-strong"
          aria-describedby={`${testId ?? "danger-action"}-description`}
        >
          <DialogTitle className="font-display text-xl font-semibold text-ink-strong">
            Confirmar ação
          </DialogTitle>
          <DialogDescription
            id={`${testId ?? "danger-action"}-description`}
            className="mt-2 text-sm leading-6 text-ink-base"
          >
            {description ?? "Esta ação cria um efeito real no sistema."}
          </DialogDescription>
          <div className="mt-5 grid gap-2">
            <label
              className="font-mono text-[0.65rem] uppercase tracking-widest text-ink-faint"
              htmlFor={`${testId ?? "danger-action"}-confirm`}
            >
              Digite {confirmText} para liberar
            </label>
            <Input
              id={`${testId ?? "danger-action"}-confirm`}
              monospace
              value={value}
              placeholder={confirmText}
              disabled={disabled || loading}
              aria-label={`Digite ${confirmText} para confirmar`}
              onChange={(event) => onValueChange(event.target.value)}
            />
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="soft" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={loading}
              disabled={disabled || !confirmed}
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              {buttonLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {description ? <p className="text-xs text-fg-muted">{description}</p> : null}
    </div>
  );
}
