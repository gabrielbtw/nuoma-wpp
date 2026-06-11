import type { ReactNode } from "react";
import { Instagram, MessageCircleMore } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatChannelDisplayValue } from "@/lib/contact-utils";

function ChannelDot({
  active,
  title,
  children,
  className,
  compact = false
}: {
  active: boolean;
  title: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition",
        compact ? "h-7 w-7" : "h-9 w-9",
        active ? "border-white/15 bg-white/8 text-white" : "border-n-border bg-white/4 text-slate-500",
        className
      )}
    >
      {children}
    </div>
  );
}

type ContactChannel = {
  type: "whatsapp" | "instagram" | string;
  displayValue?: string | null;
  isActive?: boolean;
};

function getChannelState({
  channels,
  fallbackValue,
  type
}: {
  channels?: ContactChannel[];
  fallbackValue?: string | null;
  type: "whatsapp" | "instagram";
}) {
  const activeChannel = channels?.find((channel) => channel.type === type && channel.isActive !== false);
  const formattedFallback = formatChannelDisplayValue(type, fallbackValue);
  const formattedChannelValue = formatChannelDisplayValue(type, activeChannel?.displayValue ?? null);
  const value = formattedChannelValue || formattedFallback;

  return {
    hasValue: Boolean(value),
    value: value || (type === "instagram" ? "Instagram" : "WhatsApp")
  };
}

export function ChannelIndicators({
  phone,
  instagram,
  channels,
  showLabels = false,
  compact = false
}: {
  phone?: string | null;
  instagram?: string | null;
  channels?: ContactChannel[];
  showLabels?: boolean;
  compact?: boolean;
}) {
  const whatsapp = getChannelState({
    channels,
    fallbackValue: phone,
    type: "whatsapp"
  });
  const instagramChannel = getChannelState({
    channels,
    fallbackValue: instagram,
    type: "instagram"
  });

  if (compact && !showLabels) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <ChannelDot active={whatsapp.hasValue} compact title={whatsapp.hasValue ? "WhatsApp disponível" : "Sem WhatsApp"}>
          <MessageCircleMore className={cn("h-3.5 w-3.5", whatsapp.hasValue ? "text-emerald-300" : undefined)} />
        </ChannelDot>
        <ChannelDot active={instagramChannel.hasValue} compact title={instagramChannel.hasValue ? "Instagram disponível" : "Sem Instagram"}>
          <Instagram className={cn("h-3.5 w-3.5", instagramChannel.hasValue ? "text-rose-300" : undefined)} />
        </ChannelDot>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center", compact ? "gap-1.5" : "gap-2")}>
      <div className={cn("inline-flex items-center rounded-full border border-n-border bg-n-surface-2", compact ? "gap-1.5 px-1.5 py-1" : "gap-2 px-2 py-1.5")}>
        <ChannelDot active={whatsapp.hasValue} compact={compact} title={whatsapp.hasValue ? "WhatsApp disponível" : "Sem WhatsApp"}>
          <MessageCircleMore className={cn("h-4 w-4", whatsapp.hasValue ? "text-emerald-300" : undefined)} />
        </ChannelDot>
        {showLabels ? <span className="text-xs text-slate-300">{whatsapp.value}</span> : null}
      </div>
      <div className={cn("inline-flex items-center rounded-full border border-n-border bg-n-surface-2", compact ? "gap-1.5 px-1.5 py-1" : "gap-2 px-2 py-1.5")}>
        <ChannelDot active={instagramChannel.hasValue} compact={compact} title={instagramChannel.hasValue ? "Instagram disponível" : "Sem Instagram"}>
          <Instagram className={cn("h-4 w-4", instagramChannel.hasValue ? "text-rose-300" : undefined)} />
        </ChannelDot>
        {showLabels ? <span className="text-xs text-slate-300">{instagramChannel.value}</span> : null}
      </div>
    </div>
  );
}
