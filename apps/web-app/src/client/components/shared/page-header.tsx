import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-micro uppercase tracking-wider text-n-text-dim">{eyebrow}</div>}
        <h1 className="text-h1 text-n-text">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-caption text-n-text-dim">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
