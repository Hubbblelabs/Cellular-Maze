"use client";

import { AlertTriangle, Info, X } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  message: string | null;
  type?: "info" | "warning" | "reroute";
};

export function Toast({ message, type = "info" }: Props) {
  // Remember which message was dismissed, so a new message shows again
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const dismissed = message !== null && message === dismissedMessage;

  useEffect(() => {
    if (!message || dismissed) return;
    const timer = setTimeout(() => setDismissedMessage(message), 8000);
    return () => clearTimeout(timer);
  }, [message, dismissed]);

  if (!message || dismissed) return null;

  const Icon = type === "warning" || type === "reroute" ? AlertTriangle : Info;
  const accent =
    type === "warning"
      ? "border-l-amber-400 text-amber-300"
      : type === "reroute"
        ? "border-l-cyan-400 text-cyan-300"
        : "border-l-white/40 text-white/80";

  return (
    <div
      className={`absolute bottom-24 left-4 z-[1100] max-w-sm glass-card rounded-xl border-l-4 px-4 py-3 flex items-start gap-3 animate-slide-up ${accent}`}
    >
      <Icon size={18} className="shrink-0 mt-0.5 opacity-80" />
      <p className="text-sm flex-1">{message}</p>
      <button
        type="button"
        onClick={() => setDismissedMessage(message)}
        aria-label="Dismiss notification"
        className="shrink-0 text-white/30 hover:text-white/70 cursor-pointer transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}