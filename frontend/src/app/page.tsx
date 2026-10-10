"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionButtons } from "@/src/components/actions/ActionButtons";
import { HeatmapLegend } from "@/src/components/common/HeatmapLegend";
import { Toast } from "@/src/components/common/Toast";
import { OnboardingTour } from "@/src/components/common/OnboardingTour";
import { FilterPanel } from "@/src/components/filters/FilterPanel";
import { MapContainer, type HeatmapFilterType } from "@/src/components/map/MapContainer";
import { SearchBar, type PlaceSelection } from "@/src/components/search/SearchBar";
import { RouteSidebar, type NavigationInfo, type OfflineStatus } from "@/src/components/sidebar/RouteSidebar";
import { useGeolocation } from "@/src/hooks/useGeolocation";
import { useFastRoutes, useEarlyDeadZones, useHeatmap, useReroute, useRoutes, useTowerMarkers } from "@/src/hooks/useMapData";
import { useNetworkDetect } from "@/src/hooks/useNetworkDetect";
import { closestOnPath, cumulativeKm, useTracking } from "@/src/hooks/useTracking";
import { offlineService, mapboxSearchService, routeService, alertsService } from "@/src/services/api";
import type { TelecomMode, CallDropStats, Coordinate, RouteOption } from "@/src/types/route";

/** Sentinel for "highlight whatever the backend recommends" (set by the chatbot). */
const RECOMMENDED = "__recommended__";

const MAX_DETOUR_OPTIONS: { value: number; label: string }[] = [
  { value: 1.25, label: "1.25×" },
  { value: 1.5, label: "1.5×" },
  { value: 2, label: "2×" },
  { value: 0, label: "Any" },
];

/** Warn the driver this far ahead of a weak-signal stretch. */
const ZONE_WARNING_KM = 1.5;

const toQuery = (c: Coordinate) => `@${c.lat},${c.lng}`;

export default function Home() {
  // Search state -- empty on load
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // Geocoded coordinate state (set when user selects an autocomplete result)
  const [sourceCoords, setSourceCoords] = useState<Coordinate | null>(null);
  const [destCoords, setDestCoords] = useState<Coordinate | null>(null);

  // Filter state
  const [preference, setPreference] = useState(50);
  // Multi-ISP selection: [] = all networks, one = specific carrier, 2+ = multi-SIM mode
  const [selectedIsps, setSelectedIsps] = useState<string[]>([]);
  const [maxEtaFactor, setMaxEtaFactor] = useState(1.5);
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilterType>("none");

  // Derive telecom API param from selectedIsps
  const telecom: TelecomMode = useMemo(() => {
    if (selectedIsps.length === 0) return "all";
    if (selectedIsps.length === 1) {
      const id = selectedIsps[0];
      if (id === "jio" || id === "airtel" || id === "vi") return id;
      return "all"; // bsnl → all (backend does not score bsnl separately)
    }
    return "multi";
  }, [selectedIsps]);

  // UI state
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [trackingActive, setTrackingActive] = useState(false);
  const [suggestedRoute, setSuggestedRoute] = useState<string>("");
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus>("idle");
  const [alertToast, setAlertToast] = useState<string | null>(null);

  // Geolocation
  const geo = useGeolocation();

  // Network detection (uses both browser API and ISP detection)
  const networkInfo = useNetworkDetect();

  // Snapshot: source/dest resolved at search-time to prevent React Query cancels
  const [snapshotSrc, setSnapshotSrc] = useState("");
  const [snapshotDst, setSnapshotDst] = useState("");

  // Route query params -- source/dest are snapshotted, filters are reactive
  const queryParams = useMemo(
    () =>
      hasSearched && snapshotSrc && snapshotDst
        ? { source: snapshotSrc, destination: snapshotDst, preference, telecom, max_eta_factor: maxEtaFactor }
        : null,
    [hasSearched, snapshotSrc, snapshotDst, preference, telecom, maxEtaFactor],
  );

  // -----------------------------------------------------------------------
  // Two-phase route loading:
  //   Phase 1 (fast): routing-engine geometry only -- shows routes in ~2s
  //   Phase 2 (full): ML signal scoring, dead zones, weather -- enriches UI
  // -----------------------------------------------------------------------
  const { data: fastRouteData, isLoading: fastLoading, isError: fastError } = useFastRoutes(
    snapshotSrc, snapshotDst, hasSearched,
  );
  const { data: routeData, isLoading: fullLoading, isFetching: fullFetching, isError: fullError } = useRoutes(
    queryParams ?? { source: "", destination: "", preference: 50, telecom: "all" },
  );
  const { data: heatmapData } = useHeatmap(heatmapFilter, heatmapFilter !== "none");
  const { data: towerMarkersData } = useTowerMarkers();
  const reroute = useReroute();

  // Use full routes if available, otherwise show fast routes (heuristic scoring)
  const hasFull = !!routeData?.routes?.length;
  const weatherInfo = routeData?.weather ?? null;

  // Early dead zone fetch -- starts as soon as the search is triggered (in
  // parallel with both fast-route and full-ML requests). Disabled once full
  // routes arrive (they embed dead zones directly).
  const earlyDzEnabled = hasSearched && !!snapshotSrc && !!snapshotDst && !hasFull;
  const { data: earlyDeadZoneData } = useEarlyDeadZones(snapshotSrc, snapshotDst, earlyDzEnabled);
  const routes: RouteOption[] = useMemo(() => {
    if (!hasSearched) return [];
    if (hasFull) return routeData.routes;
    // Convert fast routes to RouteOption shape with heuristic scores.
    // When early dead zone data is available, inject it into the matching
    // route so the map renders dead zone overlays before full ML scoring.
    if (fastRouteData?.routes?.length) {
      const earlyDz = earlyDeadZoneData?.dead_zones;
      const earlyRouteName = earlyDeadZoneData?.route_name;
      return fastRouteData.routes.map((r, i) => ({
        name: r.name,
        eta: r.eta,
        distance: r.distance,
        path: r.path,
        signal_score: r.signal_score,
        weighted_score: r.weighted_score,
        zones: r.zones ?? [],
        ...(earlyDz?.length && (i === 0 || r.name === earlyRouteName)
          ? { carrier_dead_zones: earlyDz }
          : {}),
      }));
    }
    return [];
  }, [hasSearched, hasFull, routeData, fastRouteData, earlyDeadZoneData]);

  const recommendedRoute = (hasFull ? routeData?.recommended_route : fastRouteData?.recommended_route) ?? "";
  const routesLoading = hasSearched && !routes.length && (fastLoading || fullLoading);
  const routesFailed = hasSearched && !routes.length && fastError && fullError;

  // Client-side preference re-ranking: instantly resort displayed routes when
  // the slider moves, before the new backend query resolves. Rejected
  // ("too slow") routes always sink to the bottom.
  const sortedRoutes = useMemo(() => {
    if (!hasFull || routes.length < 2) return routes;
    const maxEta = Math.max(...routes.map((r) => r.eta), 1);
    const w = preference / 100;
    const score = (r: RouteOption) =>
      (r.rejected ? -1000 : 0) + w * r.signal_score + (1 - w) * ((maxEta - r.eta) / maxEta) * 100;
    return [...routes].sort((a, b) => score(b) - score(a));
  }, [routes, preference, hasFull]);

  // When preference changes and we have full routes, reset selection to new top route
  const prevPreferenceRef = useRef(preference);
  useEffect(() => {
    if (prevPreferenceRef.current !== preference && hasFull && sortedRoutes.length > 0) {
      setSelectedRouteIndex(0);
    }
    prevPreferenceRef.current = preference;
  }, [preference, hasFull, sortedRoutes]);

  const heatmapZones = heatmapFilter !== "none" ? (heatmapData?.zones ?? []) : [];
  const towerMarkers = towerMarkersData ?? [];

  const selectedRoute = sortedRoutes[selectedRouteIndex] ?? sortedRoutes[0];
  const trackingPath = useMemo(() => selectedRoute?.path ?? [], [selectedRoute]);
  const tracking = useTracking(trackingPath, trackingActive);
  const trackingPosition = tracking.position;

  // Latest values for interval callbacks, so timers aren't torn down on every GPS tick
  const liveRef = useRef({ tracking, selectedRoute, preference, telecom, maxEtaFactor, snapshotDst });
  useEffect(() => {
    liveRef.current = { tracking, selectedRoute, preference, telecom, maxEtaFactor, snapshotDst };
  });

  // Dynamic call drop stats: selected route's drop count vs the worst alternative.
  const callDropStats: CallDropStats | null = useMemo(() => {
    if (!sortedRoutes.length || !hasFull) return null;
    const selDrops = selectedRoute?.segment_drop_count ?? 0;
    const altDrops = sortedRoutes
      .filter((_, i) => i !== selectedRouteIndex)
      .map((r) => r.segment_drop_count ?? 0);
    const worstAlt = altDrops.length > 0 ? Math.max(...altDrops) : selDrops;
    const avoided = Math.max(0, worstAlt - selDrops);
    let message: string;
    if (avoided > 0) {
      message = `~${avoided} potential call drop(s) avoided by choosing this route`;
    } else if (selDrops === 0) {
      message = "No call drop risk on this route";
    } else {
      message = `${selDrops} weak segment(s) with potential call drop risk`;
    }
    return { drops_avoided: avoided, recommended_drops: selDrops, worst_alternative_drops: worstAlt, message };
  }, [sortedRoutes, selectedRouteIndex, selectedRoute, hasFull]);

  // -----------------------------------------------------------------------
  // Weak-signal stretches on the selected route, positioned by route distance
  // -----------------------------------------------------------------------
  const routeZones = useMemo(() => {
    if (!selectedRoute || selectedRoute.path.length < 2) return [];
    const path = selectedRoute.path;
    const cum = cumulativeKm(path);
    const zones = [
      ...(selectedRoute.carrier_dead_zones ?? []).map((z) => ({
        kind: "dead" as const,
        label: z.area ? `near ${z.area}` : "Dead zone",
        start: z.start_coord,
        lengthKm: z.length_km,
      })),
      ...(selectedRoute.bad_zones ?? []).map((z) => ({
        kind: "weak" as const,
        label: z.edge_zone_name || (z.area ? `near ${z.area}` : "Weak signal"),
        start: z.start_coord,
        lengthKm: z.length_km,
      })),
    ];
    return zones
      .map((z) => ({ ...z, atKm: cum[closestOnPath(path, z.start).index] }))
      .sort((a, b) => a.atKm - b.atKm);
  }, [selectedRoute]);

  const navInfo: NavigationInfo | null = useMemo(() => {
    if (!trackingActive || !selectedRoute) return null;
    const traveled = tracking.traveledKm;
    const next = routeZones.find((z) => z.atKm + z.lengthKm > traveled);
    const totalKm = selectedRoute.distance;
    return {
      mode: tracking.mode,
      progress: tracking.progress,
      remainingKm: Math.max(0, totalKm * (1 - tracking.progress)),
      remainingMin: Math.max(0, selectedRoute.eta * (1 - tracking.progress)),
      nextZone: next
        ? {
            label: next.label,
            kind: next.kind,
            lengthKm: next.lengthKm,
            distanceKm: Math.max(0, next.atKm - traveled),
            inside: traveled >= next.atKm,
          }
        : null,
    };
  }, [trackingActive, selectedRoute, tracking, routeZones]);

  const zoneToast = useMemo(() => {
    const z = navInfo?.nextZone;
    if (!z) return null;
    const what = z.kind === "dead" ? "No-coverage zone" : "Weak signal";
    if (z.inside) return `${what} now (${z.label}) -- connectivity may drop for ~${z.lengthKm.toFixed(1)} km`;
    if (z.distanceKm <= ZONE_WARNING_KM) {
      return `${what} in ${z.distanceKm.toFixed(1)} km (${z.label}) -- finish calls and cache content now`;
    }
    return null;
  }, [navInfo]);

  // -----------------------------------------------------------------------
  // Reroute: ask the backend for a signal-biased route and apply it
  // -----------------------------------------------------------------------
  const applyReroute = useCallback(
    (from: string, bump: number) => {
      const live = liveRef.current;
      if (!from || !live.snapshotDst) return;
      reroute.mutate(
        {
          source: from,
          destination: live.snapshotDst,
          current_zone: live.selectedRoute?.zones?.[0] ?? "",
          preference: Math.min(live.preference + bump, 100),
          telecom: live.telecom,
        },
        {
          onSuccess: (data) => {
            const name = data.selected_route.name;
            const idx = sortedRoutes.findIndex((r) => r.name === name);
            if (from === snapshotSrc && idx >= 0) {
              setSelectedRouteIndex(idx);
              setSuggestedRoute(name);
            } else {
              // Rerouting from the current position: search again from here
              setSnapshotSrc(from);
              setSelectedRouteIndex(0);
              setSuggestedRoute(RECOMMENDED);
            }
          },
        },
      );
    },
    [reroute, sortedRoutes, snapshotSrc],
  );

  const handleReroute = useCallback(() => {
    const pos = liveRef.current.tracking.position;
    applyReroute(pos ? toQuery(pos) : snapshotSrc, 20);
  }, [applyReroute, snapshotSrc]);

  // -----------------------------------------------------------------------
  // Periodic re-prediction during active navigation
  // -----------------------------------------------------------------------
  // Re-evaluates the route every ~20% of the trip (2 min minimum). If
  // conditions changed, a better route from the current position is applied.
  const etaMinutes = selectedRoute?.eta ?? 10;
  useEffect(() => {
    if (!trackingActive) return;
    let lastProgress = 0;
    const intervalMs = Math.max(2 * 60_000, etaMinutes * 60_000 * 0.2);

    const timer = setInterval(() => {
      const live = liveRef.current;
      const { progress, position } = live.tracking;
      if (progress - lastProgress < 0.15 || progress > 0.9 || !position || !live.snapshotDst) return;
      lastProgress = progress;

      const src = toQuery(position);
      routeService
        .getRoutes({
          source: src,
          destination: live.snapshotDst,
          preference: Math.min(live.preference + 10, 100),
          telecom: live.telecom,
          max_eta_factor: live.maxEtaFactor,
        })
        .then((newData) => {
          const best = newData?.routes?.[0];
          const current = liveRef.current.selectedRoute;
          if (!best) return;
          // Apply if signal improved by >10 or ETA dropped by >15%
          if (!current || best.signal_score > current.signal_score + 10 || best.eta < current.eta * 0.85) {
            setSnapshotSrc(src);
            setSelectedRouteIndex(0);
            setSuggestedRoute(best.name);
          }
        })
        .catch(() => {});
    }, intervalMs);

    return () => clearInterval(timer);
  }, [trackingActive, etaMinutes]);

  // -----------------------------------------------------------------------
  // Congestion / crowd alert polling during active navigation (every 30 s)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!trackingActive) return;

    const checkAlerts = () => {
      const live = liveRef.current;
      const pos = live.tracking.position;
      if (!pos) return;
      alertsService
        .getAlerts(pos.lat, pos.lng, live.selectedRoute?.path ?? [])
        .then((res) => {
          if (res.alerts.length === 0) {
            setAlertToast(null);
            return;
          }
          const top = res.alerts[0];
          setAlertToast(top.message);
          if (top.suggest_reroute && top.severity === "high") {
            applyReroute(toQuery(pos), 20);
          }
        })
        .catch(() => {});
    };

    const first = setTimeout(checkAlerts, 3_000);
    const timer = setInterval(checkAlerts, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      setAlertToast(null);
    };
  }, [trackingActive, applyReroute]);

  // Dead zone warning: prefer per-route data from full response, fall back to
  // early dead zone fetch (arrives before full ML scoring).
  const offlineAlert = selectedRoute?.offline_alerts?.[0]?.message ?? null;
  const fullDeadZoneCount = selectedRoute?.carrier_dead_zones?.length ?? 0;
  const earlyDeadZoneCount = (!hasFull && earlyDeadZoneData) ? (earlyDeadZoneData.total_dead_zones ?? 0) : 0;
  const deadZoneCount = fullDeadZoneCount > 0 ? fullDeadZoneCount : earlyDeadZoneCount;
  const deadZoneWarning = deadZoneCount > 0
    ? `${deadZoneCount} dead zone(s) ahead where all carriers are weak`
    : null;
  const badZoneWarning = selectedRoute?.bad_zones?.[0]?.warning ?? null;
  const errorMessage = routesFailed
    ? "Couldn't reach the routing service. Is the backend running?"
    : null;

  // Toast priority: error > live zone warning > offline > crowd > dead zone > reroute > bad zone
  const toastMessage = trackingActive
    ? (zoneToast ?? alertToast ?? reroute.data?.advisory ?? null)
    : (errorMessage ?? offlineAlert ?? alertToast ?? deadZoneWarning ?? reroute.data?.advisory ?? badZoneWarning);
  const toastType =
    errorMessage || zoneToast || offlineAlert || alertToast || deadZoneWarning
      ? ("warning" as const)
      : reroute.data
        ? ("reroute" as const)
        : ("info" as const);

  // When geolocation resolves, reverse-geocode GPS coords to a readable name via Mapbox
  useEffect(() => {
    if (geo.location && !source) {
      const { lat, lng } = geo.location;
      mapboxSearchService
        .reverseGeocode(lat, lng)
        .then((name) => {
          if (name) {
            setSource(name);
            setSourceCoords({ lat, lng });
          }
        })
        .catch(() => {/* silently ignore */});
    }
  }, [geo.location, source]);

  const startSearch = useCallback((src: string, dst: string) => {
    setSnapshotSrc(src);
    setSnapshotDst(dst);
    setHasSearched(true);
    setSidebarOpen(true);
    setSelectedRouteIndex(0);
    setSuggestedRoute("");
    setOfflineStatus("idle");
  }, []);

  const handleSearch = useCallback(
    (selection?: PlaceSelection) => {
      // A just-picked place wins over state that may not have re-rendered yet
      const srcCoords = selection?.field === "source" ? selection : sourceCoords;
      const dstCoords = selection?.field === "dest" ? selection : destCoords;
      const srcName = selection?.field === "source" ? selection.name : source;
      const dstName = selection?.field === "dest" ? selection.name : destination;
      if (!srcName || !dstName) return;
      startSearch(srcCoords ? toQuery(srcCoords) : srcName, dstCoords ? toQuery(dstCoords) : dstName);
    },
    [source, destination, sourceCoords, destCoords, startSearch],
  );

  const handleSwap = useCallback(() => {
    setSource(destination);
    setDestination(source);
    setSourceCoords(destCoords);
    setDestCoords(sourceCoords);
  }, [source, destination, sourceCoords, destCoords]);

  const handleRouteSelect = useCallback((index: number) => {
    setSelectedRouteIndex(index);
    setTrackingActive(false);
    setOfflineStatus("idle");
  }, []);

  const handleStartNavigation = useCallback(() => {
    setTrackingActive(true);
  }, []);

  const handleLocateMe = useCallback(() => {
    // Clearing the source lets the geolocation effect fill it in again
    setSource("");
    setSourceCoords(null);
    geo.request();
  }, [geo]);

  const handleChatApply = useCallback(
    (chatSource: string, chatDest: string, pref: number, tel: TelecomMode) => {
      setSource(chatSource);
      setDestination(chatDest);
      setSourceCoords(null);
      setDestCoords(null);
      setPreference(pref);
      // Map single TelecomMode from chatbot back to selectedIsps
      setSelectedIsps(tel === "all" || tel === "multi" ? [] : [tel]);
      startSearch(chatSource, chatDest);
      setSuggestedRoute(RECOMMENDED);
    },
    [startSearch],
  );

  const handleDownloadOffline = useCallback(async () => {
    if (!snapshotSrc || !snapshotDst) return;
    setOfflineStatus("saving");
    try {
      const bundle = await offlineService.downloadBundle(snapshotSrc, snapshotDst, preference, telecom);
      offlineService.saveToStorage({ ...bundle, source: source || bundle.source, destination: destination || bundle.destination });
      setOfflineStatus("saved");
    } catch {
      setOfflineStatus("error");
    }
  }, [snapshotSrc, snapshotDst, preference, telecom, source, destination]);

  // Dragging an A/B pin re-runs the search from the dropped point
  const handlePinDrag = useCallback(
    (type: "source" | "destination", lat: number, lng: number) => {
      const coords = { lat, lng };
      if (type === "source") {
        setSourceCoords(coords);
        setSnapshotSrc(toQuery(coords));
        mapboxSearchService.reverseGeocode(lat, lng).then((name) => {
          if (name) setSource(name);
        }).catch(() => {});
      } else {
        setDestCoords(coords);
        setSnapshotDst(toQuery(coords));
        mapboxSearchService.reverseGeocode(lat, lng).then((name) => {
          if (name) setDestination(name);
        }).catch(() => {});
      }
      setSelectedRouteIndex(0);
      setTrackingActive(false);
      setOfflineStatus("idle");
    },
    [],
  );

  const sidebarSuggested = suggestedRoute === RECOMMENDED ? recommendedRoute : suggestedRoute;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      {/* Full-screen map */}
      <MapContainer
        routes={sortedRoutes}
        selectedRouteIndex={selectedRouteIndex}
        heatmapZones={heatmapZones}
        towerMarkers={towerMarkers}
        onRouteClick={handleRouteSelect}
        trackingPosition={trackingPosition}
        userLocation={geo.location}
        heatmapFilter={heatmapFilter}
        onPinDrag={handlePinDrag}
      />

      {/* Search bar (top-left) */}
      <SearchBar
        source={source}
        destination={destination}
        onSourceChange={(v) => { setSource(v); if (!v) setSourceCoords(null); }}
        onDestinationChange={(v) => { setDestination(v); if (!v) setDestCoords(null); }}
        onSourceCoords={(lat, lon) =>
          setSourceCoords(lat !== null && lon !== null ? { lat, lng: lon } : null)
        }
        onDestCoords={(lat, lon) =>
          setDestCoords(lat !== null && lon !== null ? { lat, lng: lon } : null)
        }
        onSearch={handleSearch}
        onSwap={handleSwap}
        onUseMyLocation={handleLocateMe}
        geoLoading={geo.loading}
      />

      {/* Signal vs Speed preference slider + detour cap */}
      <div className="absolute top-[120px] left-4 z-[1000] w-[360px] glass-card rounded-xl px-3 pt-2.5 pb-2.5">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[11px] text-white/45 font-medium">Speed</span>
          <span className="text-[11px] font-semibold text-cyan-400">
            {preference <= 25 ? "Fastest Route" : preference >= 75 ? "Best Signal" : "Balanced"}
            {hasSearched && hasFull && fullFetching && (
              <span className="ml-1.5 text-white/35 animate-pulse">updating…</span>
            )}
          </span>
          <span className="text-[11px] text-white/45 font-medium">Signal</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={preference}
          aria-label="Speed versus signal preference"
          onChange={(e) => setPreference(Number(e.target.value))}
          className="w-full cursor-pointer accent-cyan-400"
        />
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[10px] text-white/35 mr-auto" title="Routes slower than this multiple of the fastest are marked Too Slow">
            Max detour vs fastest
          </span>
          {MAX_DETOUR_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setMaxEtaFactor(opt.value)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold cursor-pointer transition-colors ${
                maxEtaFactor === opt.value
                  ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
                  : "bg-white/[0.05] text-white/40 hover:text-white/70"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading indicator while the first routes are computed */}
      {routesLoading && (
        <div className="absolute top-[215px] left-4 z-[900] glass-card rounded-lg px-3 py-2 text-xs text-white/60 flex items-center gap-2 animate-fade-in">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          Finding road routes and predicting signal…
        </div>
      )}

      {/* Filter panel (top-right) */}
      <FilterPanel
        selectedIsps={selectedIsps}
        onIspsChange={setSelectedIsps}
        onChatApply={handleChatApply}
        detectedNetwork={networkInfo.type}
        heatmapFilter={heatmapFilter}
        onHeatmapFilterChange={setHeatmapFilter}
        weather={weatherInfo}
      />

      {/* Call-drop stats badge */}
      {!trackingActive && callDropStats && callDropStats.drops_avoided > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] glass-card rounded-xl px-4 py-2 text-sm whitespace-nowrap">
          <p className="font-medium text-emerald-400">{callDropStats.message}</p>
        </div>
      )}

      {/* Route sidebar (left) */}
      <RouteSidebar
        routes={sortedRoutes}
        selectedIndex={selectedRouteIndex}
        recommendedRoute={recommendedRoute}
        suggestedRoute={sidebarSuggested}
        onSelect={handleRouteSelect}
        onClose={() => setSidebarOpen(false)}
        visible={sidebarOpen && sortedRoutes.length > 0}
        enriching={hasSearched && !hasFull && fullLoading}
        tracking={trackingActive}
        navigation={navInfo}
        onStartNavigation={handleStartNavigation}
        onStopNavigation={() => setTrackingActive(false)}
        offlineStatus={offlineStatus}
        onDownloadOffline={hasFull ? handleDownloadOffline : undefined}
      />

      {/* Heatmap color legend (bottom-right) -- only when a layer is active */}
      {heatmapFilter !== "none" && (
        <div className="absolute bottom-44 right-4 z-[900]">
          <HeatmapLegend filter={heatmapFilter} />
        </div>
      )}

      {/* Action buttons (bottom-right) */}
      <div id="action-btns">
        <ActionButtons
          tracking={trackingActive}
          loading={routesLoading || reroute.isPending}
          canNavigate={sortedRoutes.length > 0}
          onToggleTracking={() => setTrackingActive((v) => !v)}
          onReroute={handleReroute}
          onLocateMe={handleLocateMe}
          geoLoading={geo.loading}
          geoError={geo.error}
        />
      </div>

      {/* Toast notifications */}
      <Toast message={toastMessage} type={toastType} />

      {/* Onboarding tour (after first signup) */}
      <OnboardingTour onComplete={() => {}} />
    </div>
  );
}
