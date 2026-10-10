"use client";

import { useEffect, useState } from "react";
import type { Coordinate } from "@/src/types/route";

export type TrackingMode = "gps" | "simulated";

export type TrackingState = {
  position: Coordinate | null;
  /** Fraction of route distance covered, 0..1 */
  progress: number;
  /** Distance travelled along the route, km */
  traveledKm: number;
  mode: TrackingMode | null;
};

const IDLE: TrackingState = { position: null, progress: 0, traveledKm: 0, mode: null };

/** If the first GPS fix is further than this from the route, simulate instead. */
const OFF_ROUTE_KM = 1.5;
const SIM_TICK_MS = 500;
/** Simulated trips are compressed to roughly this long, whatever the distance. */
const SIM_TRIP_SECONDS = 90;

function haversineKm(a: Coordinate, b: Coordinate): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Cumulative distance (km) at each path vertex. */
export function cumulativeKm(path: Coordinate[]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversineKm(path[i - 1], path[i]));
  return cum;
}

/** Index of the path vertex closest to ``pt`` and its distance in km. */
export function closestOnPath(path: Coordinate[], pt: Coordinate): { index: number; distKm: number } {
  let index = 0;
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineKm(path[i], pt);
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return { index, distKm: best };
}

function pointAtKm(path: Coordinate[], cum: number[], km: number): Coordinate {
  if (km <= 0) return path[0];
  const total = cum[cum.length - 1];
  if (km >= total) return path[path.length - 1];
  let i = 1;
  while (i < cum.length && cum[i] < km) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (km - cum[i - 1]) / segLen;
  return {
    lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
    lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
  };
}

/**
 * Tracks the vehicle along ``path`` while ``active``.
 *
 * Uses real GPS (watchPosition) when the user is actually on the route. When
 * geolocation is unavailable, denied, or the first fix is far from the route
 * (e.g. demoing the Bengaluru app from elsewhere), it falls back to a
 * simulated drive along the route so dead-zone alerts can be experienced.
 */
export function useTracking(path: Coordinate[], active: boolean): TrackingState {
  const [state, setState] = useState<TrackingState>(IDLE);

  useEffect(() => {
    if (!active || path.length < 2) return;

    const cum = cumulativeKm(path);
    const totalKm = cum[cum.length - 1] || 1;
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const clearWatch = () => {
      if (watchId !== null) geo?.clearWatch(watchId);
      watchId = null;
    };

    const startSimulation = () => {
      if (timer) return;
      clearWatch();
      const kmPerTick = totalKm / ((SIM_TRIP_SECONDS * 1000) / SIM_TICK_MS);
      let traveled = 0;
      const tick = () => {
        traveled = Math.min(totalKm, traveled + kmPerTick);
        setState({
          position: pointAtKm(path, cum, traveled),
          progress: traveled / totalKm,
          traveledKm: traveled,
          mode: "simulated",
        });
        if (traveled >= totalKm && timer) {
          clearInterval(timer);
        }
      };
      timer = setInterval(tick, SIM_TICK_MS);
    };

    if (!geo) {
      startSimulation();
    } else {
      watchId = geo.watchPosition(
        (pos) => {
          const coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const { index, distKm } = closestOnPath(path, coord);
          if (distKm > OFF_ROUTE_KM) {
            startSimulation();
            return;
          }
          setState({
            position: coord,
            progress: cum[index] / totalKm,
            traveledKm: cum[index],
            mode: "gps",
          });
        },
        () => startSimulation(),
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 8000 },
      );
    }

    return () => {
      clearWatch();
      if (timer) clearInterval(timer);
      setState(IDLE);
    };
  }, [active, path]);

  return active ? state : IDLE;
}
