import type { ChannelType } from "@nuoma/contracts";
import { Timer } from "lucide-react";

import { ChannelIcon, cn } from "@nuoma/ui";

import { stepRegistry } from "../config/step-registry.js";
import type { SimEvent } from "./simulate.js";

const EVENT_TONE: Record<string, string> = {
  neutral: "text-ink-faint",
  info: "text-status-info",
  ok: "text-status-ok",
  warn: "text-status-warn",
};

export interface ChatSimulatorProps {
  channel: ChannelType;
  identity: string;
  events: SimEvent[];
}

/** Conversation-style rendering of the draft flow. Pure simulation. */
export function ChatSimulator({ channel, identity, events }: ChatSimulatorProps) {
  const isInstagram = channel === "instagram";
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line-hairline bg-surface-0"
      data-testid="chat-simulator"
    >
      <header
        className={cn(
          "flex items-center gap-2.5 border-b border-line-hairline px-3.5 py-2.5",
          isInstagram ? "bg-channel-ig/[0.07]" : "bg-channel-wa/[0.07]",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
            isInstagram ? "bg-channel-ig/15 text-channel-ig" : "bg-channel-wa/15 text-channel-wa",
          )}
        >
          {identity.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-ink-strong">{identity || "—"}</p>
          <p className="text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">
            {isInstagram ? "Instagram DM" : "WhatsApp"} · simulação
          </p>
        </div>
        <ChannelIcon channel={channel} className="h-4 w-4" />
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-3.5 py-4">
        {events.length === 0 ? (
          <p className="pt-6 text-center text-xs text-ink-faint">
            Adicione blocos de mensagem para ver a conversa aqui.
          </p>
        ) : (
          events.map((event, index) => {
            if (event.kind === "delay") {
              return (
                <div
                  key={index}
                  className="flex justify-center py-1"
                  data-testid="chat-simulator-event"
                >
                  <span className="flex items-center gap-1.5 rounded-full bg-ink-strong/[0.05] px-2.5 py-1 font-mono text-[0.62rem] text-ink-soft">
                    <Timer className="h-3 w-3" />
                    {event.label}
                  </span>
                </div>
              );
            }
            if (event.kind === "event") {
              return (
                <div
                  key={index}
                  className="flex justify-center py-0.5"
                  data-testid="chat-simulator-event"
                >
                  <span
                    className={cn(
                      "max-w-[90%] text-center text-[0.65rem] leading-4",
                      EVENT_TONE[event.tone],
                    )}
                  >
                    {event.text}
                  </span>
                </div>
              );
            }
            const Icon = stepRegistry[event.stepType].icon;
            const isPlainText = event.stepType === "text";
            return (
              <div key={index} className="flex justify-end" data-testid="chat-simulator-event">
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl rounded-br-sm px-3 py-2 text-xs leading-5 text-ink-strong",
                    isInstagram
                      ? "bg-channel-ig/[0.13] ring-1 ring-channel-ig/15"
                      : "bg-channel-wa/[0.13] ring-1 ring-channel-wa/15",
                  )}
                >
                  {!isPlainText ? (
                    <p className="mb-1 flex items-center gap-1.5 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-ink-soft">
                      <Icon className="h-3 w-3" />
                      {stepRegistry[event.stepType].label}
                    </p>
                  ) : null}
                  {event.lines.map((line, lineIndex) => (
                    <p key={lineIndex} className={cn(lineIndex > 0 && "mt-1 text-ink-soft")}>
                      {line}
                    </p>
                  ))}
                  <p className="mt-1 text-right font-mono text-[0.58rem] text-ink-faint">agora</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <footer className="border-t border-line-hairline px-3.5 py-2 text-center text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
        Simulação — nada foi enviado
      </footer>
    </div>
  );
}
