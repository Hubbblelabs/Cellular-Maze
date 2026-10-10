"use client";

import { useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronLeft, Clock, Download, Loader2, MapPin, Navigation, Shield,
  SignalZero, Square, Wifi,
} from "lucide-react";
import type { RouteOption } from "@/src/types/route";

export type OfflineStatus = "idle" | "saving" | "saved" | "error";

export type NavigationInfo = {
  mode: "gps" | "simulated" | null;
  progress: number;
  remainingKm: number;
  remainingMin: number;
  nextZone: {
    label: string;
    kind: "dead" | "weak";
    lengthKm: number;
    distanceKm: number;
    inside: boolean;
  } | null;
};

const CARRIER_COLORS: Record<string, string> = {
  Jio: "#3b82f6",
  Airtel: "#ef4444",
  Vi: "#8b5cf6",
  BSNL: "#eab308",
};

type Props = {
  routes: RouteOption[];
  selectedIndex: number;
  recommendedRoute: string;
  suggestedRoute?: string;
  tracking?: boolean;
  onStartNavigation?: () => void;
  onStopNavigation?: () => void;
  onSelect: (index: number) => void;
  onClose: () => void;
  visible: boolean;
  enriching?: boolean;
  navigation?: NavigationInfo | null;
  offlineStatus?: OfflineStatus;
  onDownloadOffline?: () => void;
};

function signalInfo(score: number) {
  if (score >= 70) return { filled: 4, color: "#22c55e", glow: "rgba(34,197,94,0.25)", label: "Strong" };
  if (score >= 50) return { filled: 3, color: "#eab308", glow: "rgba(234,179,8,0.25)", label: "Good" };
  if (score >= 30) return { filled: 2, color: "#f97316", glow: "rgba(249,115,22,0.25)", label: "Fair" };
  return { filled: 1, color: "#ef4444", glow: "rgba(239,68,68,0.25)", label: "Weak" };
}

/** Signal bars icon: 4 bars, filled count based on score, colored by strength. */
function SignalBars({ score, size = 16 }: { score: number; size?: number }) {
  const info = signalInfo(score);
  const heights = [5, 8, 11, 14];
  const scale = size / 16;
  return (
    <svg width={16 * scale} height={14 * scale} viewBox="0 0 16 14" fill="none" className="shrink-0">
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 4}
          y={14 - h}
          width="3"
          height={h}
          rx="0.5"
          fill={i < info.filled ? info.color : "rgba(255,255,255,0.12)"}
        />
      ))}
    </svg>
  );
}

function stabilityLabel(score: number | undefined) {
  if (score === undefined) return null;
  if (score >= 70) return { label: "Stable", color: "text-emerald-400" };
  if (score >= 40) return { label: "Variable", color: "text-amber-400" };
  return { label: "Unstable", color: "text-red-400" };
}

export function RouteSidebar({
  routes,
  selectedIndex,
  recommendedRoute,
  suggestedRoute,
  onSelect,
  onClose,
  visible,
  enriching,
  tracking,
  onStartNavigation,
  onStopNavigation,
  navigation,
  offlineStatus = "idle",
  onDownloadOffline,
}: Props) {
  // "detail" view: shows selected route info with start/back buttons
  // "list" view: shows all routes
  const [view, setView] = useState<"list" | "detail">("list");

  if (!visible || routes.length === 0) return null;

  const selectedRoute = routes[selectedIndex] ?? routes[0];
  const sig = signalInfo(selectedRoute.signal_score);
  const isSuggested = selectedRoute.name === suggestedRoute;

  // When tracking is active, always show the detail/navigation view
  const showDetail = tracking || view === "detail";

  // Data-driven badges so names like "Via Koramangala" are easy to compare
  const active = routes.filter((r) => !r.rejected);
  const fastestName = active.length ? active.reduce((a, b) => (b.eta < a.eta ? b : a)).name : "";
  const bestSignalName = active.length ? active.reduce((a, b) => (b.signal_score > a.signal_score ? b : a)).name : "";
  const carriers = Object.entries(selectedRoute.carrier_summary ?? {}).sort((a, b) => b[1].avg - a[1].avg);
  const nav = tracking ? navigation : null;

  return (
    <div className="absolute top-[207px] left-3 z-[800] max-h-[calc(100vh-217px)] w-[360px] glass-card flex flex-col rounded-2xl overflow-hidden animate-slide-in-left">
      {showDetail ? (
        /* ========== DETAIL / NAVIGATION VIEW ========== */
        <>
          {/* Signal strength strip */}
          <div
            className="h-[3px] w-full shrink-0"
            style={{ background: `linear-gradient(90deg, ${sig.color}00 0%, ${sig.color} 30%, ${sig.color} 70%, ${sig.color}00 100%)` }}
          />

          <div className="px-4 pt-3 pb-4">
            {/* Back + route info row */}
            <div className="flex items-center gap-3 mb-4">
              {!tracking && (
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className="p-1.5 hover:bg-white/10 rounded-full cursor-pointer transition-colors shrink-0"
                >
                  <ArrowLeft size={18} className="text-white/60" />
                </button>
              )}
              {tracking && (
                <button
                  type="button"
                  onClick={() => { onStopNavigation?.(); setView("list"); }}
                  className="p-1.5 hover:bg-white/10 rounded-full cursor-pointer transition-colors shrink-0"
                >
                  <ArrowLeft size={18} className="text-white/60" />
                </button>
              )}

              {/* Signal bars with glow */}
              <div
                className="flex items-end gap-[2px] p-2 rounded-lg shrink-0"
                style={{ background: sig.glow }}
              >
                {[6, 10, 14, 18].map((h, i) => (
                  <div
                    key={i}
                    className="w-[4px] rounded-[1px]"
                    style={{
                      height: h,
                      backgroundColor: i < sig.filled ? sig.color : "rgba(255,255,255,0.1)",
                    }}
                  />
                ))}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-white/35 leading-none mb-1">
                  {tracking ? "Navigating" : "Selected route"}
                </p>
                <p className="text-[13px] font-semibold text-white truncate leading-none">
                  {selectedRoute.name}
                </p>
              </div>

              {isSuggested && (
                <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full shrink-0">
                  Suggested
                </span>
              )}
            </div>

            {/* Stats */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800/80 rounded-lg py-2.5">
                <Clock size={12} className="text-cyan-400" />
                <span className="text-[13px] font-bold text-white">{selectedRoute.eta}</span>
                <span className="text-[10px] text-white/35">min</span>
              </div>
              <div className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800/80 rounded-lg py-2.5">
                <MapPin size={12} className="text-blue-400" />
                <span className="text-[13px] font-bold text-white">{selectedRoute.distance}</span>
                <span className="text-[10px] text-white/35">km</span>
              </div>
            </div>

            {nav && (
              <div className="mb-4 space-y-2.5">
                <div>
                  <div className="flex items-center justify-between text-[10px] text-white/40 mb-1">
                    <span>
                      {Math.round(nav.remainingMin)} min · {nav.remainingKm.toFixed(1)} km left
                    </span>
                    {nav.mode === "simulated" && (
                      <span
                        className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-semibold"
                        title="GPS is unavailable or you are not on this route, so the drive is simulated"
                      >
                        Simulated drive
                      </span>
                    )}
                    {nav.mode === "gps" && <span className="text-emerald-400 font-semibold">Live GPS</span>}
                    {nav.mode === null && <span className="animate-pulse">Locating…</span>}
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-[width] duration-500"
                      style={{ width: `${Math.round(nav.progress * 100)}%` }}
                    />
                  </div>
                </div>

                {nav.nextZone ? (
                  <div
                    className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 border ${
                      nav.nextZone.inside || nav.nextZone.distanceKm <= 1.5
                        ? "bg-red-500/10 border-red-500/30"
                        : "bg-amber-500/[0.07] border-amber-500/20"
                    }`}
                  >
                    <SignalZero
                      size={16}
                      className={`shrink-0 mt-0.5 ${
                        nav.nextZone.inside || nav.nextZone.distanceKm <= 1.5 ? "text-red-400" : "text-amber-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-white/90">
                        {nav.nextZone.inside
                          ? "In weak-signal zone"
                          : `${nav.nextZone.kind === "dead" ? "No-coverage zone" : "Weak signal"} in ${nav.nextZone.distanceKm.toFixed(1)} km`}
                      </p>
                      <p className="text-[10px] text-white/45 truncate">
                        {nav.nextZone.label} · ~{nav.nextZone.lengthKm.toFixed(1)} km long
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-emerald-500/[0.07] border border-emerald-500/20 text-[12px] text-emerald-300">
                    <Wifi size={14} /> Good coverage for the rest of the trip
                  </div>
                )}
              </div>
            )}

            {!tracking && (
              <div className="mb-4 space-y-3">
                {/* Reliability summary */}
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="bg-slate-800/60 rounded-lg py-2">
                    <p className="text-[13px] font-bold" style={{ color: sig.color }}>
                      {Math.round(selectedRoute.signal_score)}
                    </p>
                    <p className="text-[9px] text-white/35">signal</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg py-2">
                    <p className="text-[13px] font-bold text-white/85">
                      {selectedRoute.stability_score !== undefined ? Math.round(selectedRoute.stability_score) : "--"}
                    </p>
                    <p className="text-[9px] text-white/35">stability</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg py-2">
                    <p className="text-[13px] font-bold text-white/85">
                      {(selectedRoute.bad_zones?.length ?? 0) + (selectedRoute.carrier_dead_zones?.length ?? 0)}
                    </p>
                    <p className="text-[9px] text-white/35">weak zones</p>
                  </div>
                </div>

                {/* Per-carrier comparison: which SIM works best on this route */}
                {carriers.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-1.5">
                      Signal by carrier on this route
                    </p>
                    <div className="space-y-1">
                      {carriers.map(([name, c], i) => (
                        <div key={name} className="flex items-center gap-2 text-[11px]">
                          <span className="w-11 text-white/60">{name}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, c.avg)}%`, background: CARRIER_COLORS[name] ?? "#94a3b8" }}
                            />
                          </div>
                          <span className="w-7 text-right text-white/70 tabular-nums">{Math.round(c.avg)}</span>
                          <span className={`w-6 text-[9px] font-semibold ${i === 0 ? "text-emerald-400" : "text-transparent"}`}>
                            best
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {onDownloadOffline && (
                  <button
                    type="button"
                    onClick={onDownloadOffline}
                    disabled={offlineStatus === "saving"}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-colors bg-white/[0.05] hover:bg-white/[0.1] text-white/70 disabled:opacity-60"
                  >
                    {offlineStatus === "saving" && <Loader2 size={13} className="animate-spin" />}
                    {offlineStatus === "saved" && <Check size={13} className="text-emerald-400" />}
                    {(offlineStatus === "idle" || offlineStatus === "error") && <Download size={13} />}
                    {offlineStatus === "saving"
                      ? "Saving route for offline use…"
                      : offlineStatus === "saved"
                        ? "Saved for offline use"
                        : offlineStatus === "error"
                          ? "Save failed -- retry"
                          : "Save route for offline use"}
                  </button>
                )}
              </div>
            )}

            {/* Start / Stop button */}
            {tracking ? (
              <button
                type="button"
                onClick={() => { onStopNavigation?.(); setView("list"); }}
                className="group w-full flex items-center justify-center gap-2.5 py-3 bg-red-500/15 hover:bg-red-500/25 text-red-400 text-sm font-semibold rounded-xl cursor-pointer transition-all border border-red-500/30 hover:border-red-500/50"
              >
                <Square size={14} />
                Stop Navigation
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartNavigation}
                className="group w-full flex items-center justify-center gap-2.5 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-bold rounded-xl cursor-pointer transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_28px_rgba(6,182,212,0.45)]"
              >
                <Navigation size={14} />
                Start Navigation
              </button>
            )}
          </div>
        </>
      ) : (
        /* ========== ROUTE LIST VIEW ========== */
        <>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/60">
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 hover:bg-white/10 rounded-full cursor-pointer transition-colors"
        >
          <ChevronLeft size={18} className="text-white/60" />
        </button>
        <h2 className="text-sm font-semibold text-white/90">Routes</h2>
        <span className="ml-auto text-xs text-white/40">
          {routes.length} options
          {enriching && (
            <span className="ml-1.5 text-cyan-400 animate-pulse">refining...</span>
          )}
        </span>
      </div>

      {/* Route list */}
      <div className="flex-1 overflow-y-auto">
        {routes.map((route, i) => {
          const isSelected = i === selectedIndex;
          const isSuggested = route.name === suggestedRoute;
          const stability = stabilityLabel(route.stability_score);
          const isRejected = route.rejected === true;
          const hasBadZones = (route.bad_zones?.length ?? 0) > 0;
          const hasMultiSim = !!route.multi_sim;

          return (
            <button
              key={route.name}
              type="button"
              onClick={() => { onSelect(i); setView("detail"); }}
              className={`w-full text-left px-4 py-3.5 border-b border-slate-700/30 cursor-pointer transition-all duration-200 ${
                isRejected
                  ? "bg-red-500/10 border-l-4 border-l-red-500/50 opacity-60"
                  : isSelected
                  ? "bg-cyan-500/10 border-l-4 border-l-cyan-400"
                  : "hover:bg-slate-800/70 border-l-4 border-l-transparent"
              }`}
            >
              {/* Route name & badges */}
              <div className="flex items-center gap-2 mb-1.5">
                <Navigation
                  size={14}
                  className={isSelected ? "text-cyan-400" : "text-white/30"}
                />
                <span
                  className={`text-sm font-medium ${
                    isRejected ? "text-red-400 line-through" : isSelected ? "text-cyan-300" : "text-white/85"
                  }`}
                >
                  {route.name}
                </span>
                {isRejected && (
                  <span className="text-[10px] font-semibold bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">
                    Too Slow
                  </span>
                )}
                {isSuggested && (
                  <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">
                    Suggested
                  </span>
                )}
              </div>
              {!isRejected && (route.name === recommendedRoute || route.name === fastestName || route.name === bestSignalName) && (
                <div className="flex flex-wrap gap-1 mb-1 ml-[22px]">
                  {route.name === recommendedRoute && (
                    <span className="text-[9px] font-semibold bg-cyan-500/15 text-cyan-300 px-1.5 py-0.5 rounded">Recommended</span>
                  )}
                  {route.name === fastestName && (
                    <span className="text-[9px] font-semibold bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">Fastest</span>
                  )}
                  {route.name === bestSignalName && (
                    <span className="text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">Best signal</span>
                  )}
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-2 mt-2">
                {/* ETA chip */}
                <div className="flex items-center gap-1.5 bg-slate-800 rounded-lg px-2.5 py-1.5 min-w-0">
                  <Clock size={11} className="text-cyan-400 shrink-0" />
                  <span className="text-sm font-bold text-white leading-none">{route.eta}</span>
                  <span className="text-[10px] text-white/40 leading-none">min</span>
                </div>
                {/* Distance chip */}
                <div className="flex items-center gap-1.5 bg-slate-800 rounded-lg px-2.5 py-1.5 min-w-0">
                  <MapPin size={11} className="text-blue-400 shrink-0" />
                  <span className="text-sm font-bold text-white leading-none">{route.distance}</span>
                  <span className="text-[10px] text-white/40 leading-none">km</span>
                </div>
                {/* Signal bars -- color only, no number */}
                <div className="flex items-end gap-[2px] bg-slate-800 rounded-lg px-2.5 py-[7px] min-w-0">
                  <SignalBars score={route.signal_score} />
                  {enriching && <span className="ml-1 text-white/30 animate-pulse text-[10px]">~</span>}
                </div>
              </div>

              {/* Stability row */}
              {stability && (
                <div className="flex items-center gap-3 mt-1.5 text-xs">
                  <span className={`flex items-center gap-1 ${stability.color}`}>
                    <Shield size={10} />
                    {stability.label} ({Math.round(route.stability_score ?? 0)})
                  </span>
                  {route.longest_stable_window !== undefined && route.longest_stable_window > 0 && (
                    <span className="text-white/30">
                      {route.longest_stable_window} stable segments
                    </span>
                  )}
                </div>
              )}

              {/* Multi-SIM info */}
              {hasMultiSim && route.multi_sim && (
                <div className="mt-1.5 px-2 py-1 bg-purple-500/15 rounded text-[10px] text-purple-300 flex items-center gap-1.5">
                  <Wifi size={10} />
                  Best: <span className="font-semibold">{route.multi_sim.best_carrier}</span>
                  <span className="text-purple-400/60 ml-1">
                    (signal {route.multi_sim.combined_avg_signal})
                  </span>
                </div>
              )}

              {/* Bad zone warnings */}
              {hasBadZones && (
                <div className="mt-1.5 space-y-0.5">
                  {route.bad_zones!.slice(0, 2).map((bz, j) => (
                    <div
                      key={j}
                      className="flex items-start gap-1 text-[10px] text-orange-400 bg-orange-500/10 px-2 py-1 rounded"
                    >
                      <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                      <span>
                        Dead zone in ~{Math.round(bz.time_to_zone_min)} min
                        ({bz.length_km} km, ~{bz.zone_duration_min.toFixed(1)} min)
                        {bz.edge_zone_name ? ` -- ${bz.edge_zone_name}` : ""}
                      </span>
                    </div>
                  ))}
                  {(route.bad_zones?.length ?? 0) > 2 && (
                    <span className="text-[10px] text-orange-500/60 pl-2">
                      +{(route.bad_zones?.length ?? 0) - 2} more zones
                    </span>
                  )}
                </div>
              )}

              {/* Zones */}
              <div className="mt-2 flex flex-wrap gap-1">
                {route.zones.map((z) => (
                  <span
                    key={z}
                    className="text-[10px] bg-slate-800 text-white/40 px-1.5 py-0.5 rounded"
                  >
                    {z}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Start / Stop navigation footer */}
      <div className="px-4 py-3.5 border-t border-slate-700/60 shrink-0">
        {tracking ? (
          <button
            type="button"
            onClick={() => { onStopNavigation?.(); }}
            className="group w-full flex items-center justify-center gap-2.5 py-3 bg-red-500/15 hover:bg-red-500/25 text-red-400 text-sm font-semibold rounded-xl cursor-pointer transition-all border border-red-500/30 hover:border-red-500/50"
          >
            <div className="p-1 bg-red-500/20 rounded-lg group-hover:bg-red-500/30 transition-colors">
              <Square size={14} />
            </div>
            Stop Navigation
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setView("detail")}
            className="group w-full relative flex items-center justify-center gap-2.5 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-bold rounded-xl cursor-pointer transition-all shadow-[0_0_20px_rgba(6,182,212,0.25)] hover:shadow-[0_0_28px_rgba(6,182,212,0.35)]"
          >
            <div className="p-1 bg-white/15 rounded-lg group-hover:bg-white/25 transition-colors">
              <Navigation size={14} />
            </div>
            View Route
          </button>
        )}
      </div>
        </>
      )}
    </div>
  );
}
