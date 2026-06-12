import type { ChannelType } from "@nuoma/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CircleAlert, Eye, Rocket, Save } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Button,
  ChannelIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
  type BadgeVariant,
} from "@nuoma/ui";

export interface BuilderTopBarProps {
  backTo: string;
  name: string;
  onNameChange: (name: string) => void;
  channel: ChannelType | "";
  statusLabel: string;
  statusVariant: BadgeVariant;
  dirty: boolean;
  errorCount: number;
  saving: boolean;
  publishing: boolean;
  previewOpen: boolean;
  publishLabel: string;
  publishConfirmTitle: string;
  publishConfirmDescription: string;
  onSave: () => void;
  onPublish: () => void;
  onTogglePreview: () => void;
  onShowErrors: () => void;
}

export function BuilderTopBar({
  backTo,
  name,
  onNameChange,
  channel,
  statusLabel,
  statusVariant,
  dirty,
  errorCount,
  saving,
  publishing,
  previewOpen,
  publishLabel,
  publishConfirmTitle,
  publishConfirmDescription,
  onSave,
  onPublish,
  onTogglePreview,
  onShowErrors,
}: BuilderTopBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-line-hairline bg-surface-1 px-3 pr-4"
      data-testid="builder-topbar"
    >
      <Link
        to={backTo}
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-ink-strong/[0.06] hover:text-ink-strong"
        title="Voltar"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Nome do fluxo"
          aria-label="Nome do fluxo"
          className={cn(
            "min-w-0 max-w-[26rem] flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1.5",
            "font-display text-[0.95rem] font-semibold text-ink-strong outline-none",
            "transition-colors hover:border-line-hairline focus:border-accent focus:bg-surface-0",
          )}
        />
        {channel ? (
          <span className="hidden items-center gap-1.5 rounded-md bg-ink-strong/[0.05] px-2 py-1 text-[0.68rem] text-ink-soft sm:flex">
            <ChannelIcon channel={channel} className="h-3.5 w-3.5" />
            {channel === "whatsapp" ? "WhatsApp" : "Instagram"}
          </span>
        ) : (
          <span className="hidden rounded-md bg-ink-strong/[0.05] px-2 py-1 text-[0.68rem] text-ink-soft sm:flex">
            Qualquer canal
          </span>
        )}
        <Badge variant={statusVariant}>{statusLabel}</Badge>
        {dirty ? (
          <span
            className="flex items-center gap-1.5 text-[0.68rem] text-status-warn"
            title="Alterações não salvas"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-status-warn" />
            <span className="hidden md:inline">Não salvo</span>
          </span>
        ) : null}
      </div>

      {errorCount > 0 ? (
        <button
          type="button"
          onClick={onShowErrors}
          className="flex items-center gap-1.5 rounded-md bg-status-error/10 px-2.5 py-1.5 text-[0.7rem] font-medium text-status-error transition-colors hover:bg-status-error/15"
          title="Ver pendências do fluxo"
        >
          <CircleAlert className="h-3.5 w-3.5" />
          {errorCount === 1 ? "1 pendência" : `${errorCount} pendências`}
        </button>
      ) : null}

      <Button
        variant={previewOpen ? "soft" : "ghost"}
        size="sm"
        leftIcon={<Eye className="h-4 w-4" />}
        onClick={onTogglePreview}
        data-testid="builder-open-preview"
      >
        Prévia
      </Button>
      <Button
        variant="secondary"
        size="sm"
        loading={saving}
        leftIcon={<Save className="h-4 w-4" />}
        onClick={onSave}
        data-testid="builder-save"
      >
        Salvar
      </Button>
      <Button
        variant="primary"
        size="sm"
        loading={publishing}
        leftIcon={<Rocket className="h-4 w-4" />}
        onClick={() => setConfirmOpen(true)}
        data-testid="builder-publish"
      >
        {publishLabel}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{publishConfirmTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-ink">
            {publishConfirmDescription}
          </DialogDescription>
          {errorCount > 0 ? (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-status-error/10 px-3 py-2 text-xs leading-5 text-status-error">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              O fluxo tem {errorCount} pendência(s). Resolva antes de publicar.
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={errorCount > 0}
              onClick={() => {
                setConfirmOpen(false);
                onPublish();
              }}
              data-testid="builder-publish-confirm"
            >
              {publishLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
