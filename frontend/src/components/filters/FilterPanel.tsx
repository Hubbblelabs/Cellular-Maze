"use client";

import { MessageCircle, Signal, Car, Check, X } from "lucide-react";
import { useState } from "react";
import type { TelecomMode } from "@/src/types/route";
import type { WeatherInfo } from "@/src/types/route";
import { ChatBot } from "@/src/components/chat/ChatBot";
import { WeatherBadge } from "@/src/components/common/WeatherBadge";
import type { HeatmapFilterType } from "@/src/components/map/MapContainer";

const ISP_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: "jio",    label: "Jio",    color: "#3b82f6" },
  { id: "airtel", label: "Airtel", color: "#ef4444" },
  { id: "vi",     label: "Vi",     color: "#8b5cf6" },
  { id: "bsnl",   label: "BSNL",   color: "#eab308" },
];

const HEATMAP_OPTIONS: {
  value: HeatmapFilterType;
  label: string;
  icon: typeof Signal;
  color: string;
  activeBg: string;
}[] = [
  { value: "signal",  label: "Signal",  icon: Signal,   color: "#22c55e", activeBg: "rgba(34,197,94,0.15)" },
  { value: "traffic", label: "Traffic", icon: Car,       color: "#f97316", activeBg: "rgba(249,115,22,0.15)" },
];

type Props = {
  selectedIsps: string[];
  onIspsChange: (isps: string[]) => void;
  onChatApply?: (source: string, destination: string, preference: number, telecom: TelecomMode) => void;
  detectedNetwork: string;
  heatmapFilter?: HeatmapFilterType;
  onHeatmapFilterChange?: (v: HeatmapFilterType) => void;
  weather?: WeatherInfo | null;
};

export function FilterPanel({
  selectedIsps,
  onIspsChange,
  onChatApply,
  detectedNetwork,
  heatmapFilter = "none",
  onHeatmapFilterChange,
  weather,
}: Props) {
  const [chatOpen, setChatOpen] = useState(false);

  function toggleIsp(id: string) {
    if (selectedIsps.includes(id)) {
      onIspsChange(selectedIsps.filter((x) => x !== id));
    } else {
      onIspsChange([...selectedIsps, id]);
    }
  }

  const activeIspCount = selectedIsps.length;

  return (
    <>
      {/* Floating chatbot panel -- rendered in portal-like fixed position */}
      {chatOpen && (
        <div className="absolute top-4 right-72 z-[1001] w-80 glass-card rounded-2xl overflow-hidden shadow-2xl animate-slide-up">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <MessageCircle size={14} className="text-cyan-400" />
              </div>
              <span className="text-sm font-semibold text-white/90">Route Assistant</span>
            </div>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="text-white/30 hover:text-white/70 cursor-pointer transition-colors p-1 rounded-md hover:bg-white/10"
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ height: 400 }}>
            <ChatBot
              onClose={() => setChatOpen(false)}
              onApply={(src, dest, pref, tel) => {
                onChatApply?.(src, dest, pref, tel);
                setChatOpen(false);
              }}
              detectedNetwork={detectedNetwork}
            />
          </div>
        </div>
      )}

      {/* Right-side control panel */}
      <div id="filter-panel" className="absolute top-4 right-4 z-[1000] w-56 flex flex-col gap-2">

        {/* Personalised route button */}
        <button
          id="chatbot-btn"
          type="button"
          onClick={() => setChatOpen((v) => !v)}
          className={`w-full rounded-xl px-3 py-2.5 flex items-center gap-2.5 text-sm font-medium cursor-pointer transition-all ${
            chatOpen
              ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40 shadow-lg shadow-cyan-500/10"
              : "glass-card text-white/80 hover:text-white hover:bg-white/10"
          }`}
        >
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${chatOpen ? "bg-cyan-500/30" : "bg-white/10"}`}>
            <MessageCircle size={13} className={chatOpen ? "text-cyan-400" : "text-white/60"} />
          </div>
          <span>Personalised Route</span>
        </button>

        {/* Heatmap + ISP card */}
        <div className="glass-card rounded-xl overflow-hidden">

          {/* Heatmap section */}
          {onHeatmapFilterChange && (
            <div className="p-3 border-b border-white/[0.06]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-2">Heatmap</p>
              <div className="grid grid-cols-2 gap-1">
                {HEATMAP_OPTIONS.map((opt) => {
                  const isActive = heatmapFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onHeatmapFilterChange(isActive ? "none" : opt.value)}
                      title={opt.label}
                      style={isActive ? { background: opt.activeBg, borderColor: opt.color + "66", color: opt.color } : {}}
                      className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-[9px] font-semibold cursor-pointer transition-all ${
                        isActive
                          ? "shadow-sm ring-0"
                          : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] text-white/40 hover:text-white/60"
                      }`}
                    >
                      <opt.icon size={12} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ISP section */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Network</p>
              {activeIspCount > 0 && (
                <button
                  type="button"
                  onClick={() => onIspsChange([])}
                  className="text-[10px] text-white/25 hover:text-white/55 cursor-pointer transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {ISP_OPTIONS.map((isp) => {
                const isActive = selectedIsps.includes(isp.id);
                return (
                  <button
                    key={isp.id}
                    type="button"
                    onClick={() => toggleIsp(isp.id)}
                    style={isActive ? { background: isp.color + "1a", borderColor: isp.color + "55", color: isp.color } : {}}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all ring-0 border ${
                      isActive
                        ? ""
                        : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] text-white/45 hover:text-white/65"
                    }`}
                  >
                    <div
                      style={isActive ? { background: isp.color, borderColor: isp.color } : {}}
                      className={`w-3 h-3 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                        isActive ? "" : "border-white/20"
                      }`}
                    >
                      {isActive && <Check size={8} strokeWidth={3.5} className="text-black" />}
                    </div>
                    {isp.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-white/20 mt-2 leading-tight">
              {activeIspCount === 0
                ? "All carriers"
                : activeIspCount === 1
                ? ISP_OPTIONS.find((i) => i.id === selectedIsps[0])?.label
                : `${activeIspCount} carriers`}
            </p>
          </div>

          {/* Detected network pill */}
          {detectedNetwork && detectedNetwork !== "unknown" && (
            <div className="px-3 pb-3">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-cyan-500/[0.08] rounded-lg border border-cyan-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                <p className="text-[10px] text-cyan-400/90 truncate">
                  <span className="text-white/30">On: </span>{detectedNetwork}
                </p>
              </div>
            </div>
          )}

          {/* Weather section */}
          {weather && weather.source !== "fallback" && (
            <div className="px-3 pb-3 border-t border-white/[0.06] pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-2">Weather</p>
              <WeatherBadge weather={weather} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}