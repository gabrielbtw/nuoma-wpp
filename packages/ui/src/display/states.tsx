import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../utils/cn.js";

interface StateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

function StateBase({
  title,
  description,
  icon,
  action,
  className,
  ...props
}: StateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 py-10 px-6",
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-bg-base shadow-pressed-sm text-fg-dim">
          {icon}
        </div>
      )}
      {title && <div className="text-base font-medium text-fg-primary mt-1">{title}</div>}
      {description && <p className="text-sm text-fg-muted max-w-md">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return (
    <StateBase
      icon={<Inbox className="h-5 w-5" />}
      title={props.title ?? "Nada por aqui"}
      {...props}
    />
  );
}

export function ErrorState(props: StateProps) {
  return (
    <StateBase
      icon={<AlertCircle className="h-5 w-5 text-semantic-danger" />}
      title={props.title ?? "Algo deu errado"}
      {...props}
    />
  );
}

export function LoadingState(props: StateProps) {
  return (
    <StateBase
      icon={<Loader2 className="h-5 w-5 animate-spin" />}
      title={props.title ?? "Carregando…"}
      {...props}
    />
  );
}
