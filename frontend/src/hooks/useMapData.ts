"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { deadZoneService, heatmapService, predictionService, routeService, towerService, towerGeoService } from "@/src/services/api";
import type { RerouteRequest, RouteQueryParams } from "@/src/types/route";

/**
 * Fast route fetch -- geometry only, no ML scoring.
 * Returns TomTom routes in ~1-2s for instant map display.
 */
export function useFastRoutes(source: string, destination: string, enabled: boolean) {
  return useQuery({
    queryKey: ["fast-routes", source, destination],
    queryFn: () => routeService.getFastRoutes(source, destination),
    enabled: enabled && !!source && !!destination,
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * Full route scoring with ML, towers, weather, dead zones.
 * Runs in background after fast routes are displayed.
 */
export function useRoutes(params: RouteQueryParams) {
  return useQuery({
    queryKey: ["routes", params],
    queryFn: () => routeService.getRoutes(params),
    enabled: !!params.source && !!params.destination,
    staleTime: 30_000,
    retry: 1,
    // Keep showing the ML-scored routes while a slider/carrier change refetches,
    // but never carry results over to a different origin/destination.
    placeholderData: (prev, prevQuery) => {
      const prevParams = prevQuery?.queryKey[1] as RouteQueryParams | undefined;
      return prevParams?.source === params.source && prevParams?.destination === params.destination
        ? prev
        : undefined;
    },
  });
}

export function useHeatmap(layer: string = "signal", enabled = true) {
  return useQuery({
    queryKey: ["heatmap", layer],
    queryFn: () => heatmapService.getHeatmap(layer),
    staleTime: 60_000,
    enabled,
  });
}

export function usePrediction(zone: string, minutes = 15) {
  return useQuery({
    queryKey: ["prediction", zone, minutes],
    queryFn: () => predictionService.getPrediction(zone, minutes),
    enabled: !!zone,
  });
}

export function useReroute() {
  return useMutation({
    mutationFn: (request: RerouteRequest) => routeService.reroute(request),
  });
}

export function useTowers() {
  return useQuery({
    queryKey: ["towers"],
    queryFn: () => towerService.getTowers(),
    staleTime: 120_000,
  });
}

export function useTowerMarkers() {
  return useQuery({
    queryKey: ["tower-markers"],
    queryFn: () => towerGeoService.fetchAll(500),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/**
 * Early dead zone fetch — triggered as soon as Phase 1 (fast routes) completes.
 * Runs in parallel with full ML scoring so dead zone warnings appear sooner.
 * Disabled once full route data is available (routes embed dead zones directly).
 */
export function useEarlyDeadZones(source: string, destination: string, enabled: boolean) {
  return useQuery({
    queryKey: ["early-dead-zones", source, destination],
    queryFn: () => deadZoneService.predict(source, destination),
    enabled: enabled && !!source && !!destination,
    staleTime: 60_000,
    retry: 1,
  });
}
