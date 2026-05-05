import { Bot, Instagram, MessageCircle } from "lucide-react";
import type { LucideProps } from "lucide-react";

import { cn } from "../utils/cn.js";

export type Channel = "whatsapp" | "instagram" | "system";

export interface ChannelIconProps extends Omit<LucideProps, "color"> {
  channel: Channel;
  variant?: "icon" | "chip";
}

const ICONS: Record<Channel, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  system: Bot,
};

const COLORS: Record<Channel, string> = {
  whatsapp: "text-channel-whatsapp",
  instagram: "text-channel-instagram",
  system: "text-channel-system",
};

export function ChannelIcon({ channel, variant = "icon", className, ...props }: ChannelIconProps) {
  const Icon = ICONS[channel];
  if (variant === "chip") {
    return (
      <span
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg bg-bg-base shadow-pressed-sm",
          className,
        )}
      >
        <Icon className={cn("h-4 w-4", COLORS[channel])} {...props} />
      </span>
    );
  }
  return <Icon className={cn(COLORS[channel], className)} {...props} />;
}
