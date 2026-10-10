"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Coordinate, RouteOption, TowerMarker } from "@/src/types/route";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BANGALORE_CENTER: [number, number] = [77.5946, 12.9716]; // [lng, lat]
const DEFAULT_ZOOM = 12;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const ROUTE_COLORS = {
  selected: "#00ffff",   // electric cyan
} as const;

const ROUTE_ALT_PALETTE = [
  "#ff3dff", // neon magenta
  "#00ff88", // neon green
  "#ff8800", // neon orange
  "#ffff00", // neon yellow
  "#ff0066", // neon hot-pink
  "#aa44ff", // neon violet
];

function getRouteColor(index: number, selectedIndex: number): string {
  if (index === selectedIndex) return ROUTE_COLORS.selected;
  const altPos = index < selectedIndex ? index : index - 1;
  return ROUTE_ALT_PALETTE[altPos % ROUTE_ALT_PALETTE.length];
}

const OPERATOR_COLORS: Record<string, string> = {
  Jio: "#0070f3",
  Airtel: "#e53e3e",
  Vi: "#d69e2e",
  BSNL: "#38a169",
};

// ---------------------------------------------------------------------------
// Types (re-export for MapContainer)
// ---------------------------------------------------------------------------
export type HeatmapFilterType = "signal" | "weather" | "traffic" | "road" | "none";

type Props = {
  routes: RouteOption[];
  selectedRouteIndex: number;
  heatmapZones: { name: string; lat: number; lng: number; score: number; label: string; color: string; radius_km?: number }[];
  towerMarkers?: TowerMarker[];
  onRouteClick?: (index: number) => void;
  trackingPosition?: Coordinate | null;
  userLocation?: Coordinate | null;
  heatmapFilter?: HeatmapFilterType;
  onPinDrag?: (type: "source" | "destination", lat: number, lng: number) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate meters per degree at Bangalore latitude (~12.97 N). */
const DEG_TO_M_LAT = 111_320;
const DEG_TO_M_LNG = 111_320 * Math.cos((12.97 * Math.PI) / 180); // ~108,500

/** Buffer distance (meters) around the route for tower visibility. */
const TOWER_BUFFER_M = 500;

/**
 * Minimum distance (meters) from a point to a polyline defined by `path`.
 * Uses flat-Earth approximation -- accurate enough at city scale.
 */
function distToPolylineM(
  ptLat: number,
  ptLng: number,
  path: Coordinate[],
): number {
  let minDist = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = (path[i].lng - ptLng) * DEG_TO_M_LNG;
    const ay = (path[i].lat - ptLat) * DEG_TO_M_LAT;
    const bx = (path[i + 1].lng - ptLng) * DEG_TO_M_LNG;
    const by = (path[i + 1].lat - ptLat) * DEG_TO_M_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((-ax) * dx + (-ay) * dy) / lenSq));
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const d = Math.sqrt(projX * projX + projY * projY);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Densify a route path by interpolating extra points every `stepM` meters
 * along each segment. This ensures that even sparse 2–3 point paths (e.g.
 * from TomTom's encoded polyline) yield enough intermediate points for an
 * accurate perpendicular-distance filter across the full road corridor.
 */
function densifyPath(path: Coordinate[], stepM: number = 150): Coordinate[] {
  if (path.length < 2) return path;
  const out: Coordinate[] = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = (b.lng - a.lng) * DEG_TO_M_LNG;
    const dy = (b.lat - a.lat) * DEG_TO_M_LAT;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(segLen / stepM));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) });
    }
  }
  return out;
}

/**
 * Return only towers within `bufferM` meters of the route polyline.
 * The path is first densified so that sparse paths (few vertices) still
 * produce an accurate corridor along the actual road.
 */
function filterTowersNearRoute(
  towers: TowerMarker[],
  path: Coordinate[],
  bufferM: number = TOWER_BUFFER_M,
): TowerMarker[] {
  if (!path || path.length < 2) return [];
  const dense = densifyPath(path, 150);
  return towers.filter((t) => distToPolylineM(t.lat, t.lng, dense) <= bufferM);
}

function pathToGeoJSON(path: Coordinate[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: path.map((p) => [p.lng, p.lat]),
    },
  };
}

function getBounds(coords: Coordinate[]): mapboxgl.LngLatBoundsLike {
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const c of coords) {
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}



// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MapView({
  routes,
  selectedRouteIndex,
  heatmapZones,
  towerMarkers,
  onRouteClick,
  trackingPosition,
  userLocation,
  heatmapFilter,
  onPinDrag,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pinMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const towerMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const trackingMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const userLocMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const routeIdsRef = useRef<string[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  const handlePinDragEnd = useCallback(
    (type: "source" | "destination", marker: mapboxgl.Marker) => {
      const lngLat = marker.getLngLat();
      onPinDrag?.(type, lngLat.lat, lngLat.lng);
    },
    [onPinDrag],
  );

  // -----------------------------------------------------------------------
  // 1. Initialize Mapbox map
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      // Satellite imagery with street labels -- vivid and geographical
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: BANGALORE_CENTER,
      // Start zoomed way out (globe view), then fly in after load
      zoom: 1.5,
      pitch: 0,
      bearing: 0,
      antialias: true,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    // Suppress missing sprite image warnings (e.g. "in-state-4" from satellite style)
    map.on("styleimagemissing", (e) => {
      if (!map.hasImage(e.id)) {
        // Create a tiny transparent placeholder so Mapbox stops warning
        map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });

    map.on("load", () => {
      // ---- Mapbox terrain DEM (actual elevation, needed for 3-D terrain) ----
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 2.0 });

      // ---- Realistic sky layer ----
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0.0, 60.0],
          "sky-atmosphere-sun-intensity": 12,
          "sky-atmosphere-color": "rgba(85, 151, 210, 0.75)",
          "sky-atmosphere-halo-color": "rgba(245, 214, 123, 0.5)",
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sky paint props missing from mapbox-gl types
      } as any);

      // ---- 3D building extrusion -- warm glass look on satellite ----
      const firstSymbol = map
        .getStyle()
        .layers?.find((l: { type: string }) => l.type === "symbol")?.id;

      map.addLayer(
        {
          id: "3d-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 13,
          paint: {
            // White-to-blue glass towers that contrast well on satellite imagery
            "fill-extrusion-color": [
              "interpolate",
              ["linear"],
              ["get", "height"],
              0,   "rgba(220,230,255,0.55)",
              30,  "rgba(160,195,255,0.65)",
              80,  "rgba(100,160,255,0.70)",
              200, "rgba(60,120,255,0.75)",
            ],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.80,
            "fill-extrusion-vertical-gradient": true,
          },
        } as mapboxgl.AnyLayer,
        firstSymbol,
      );

      setMapLoaded(true);

      // Zoom-in intro: after a short pause fly from globe view into Bangalore
      setTimeout(() => {
        map.flyTo({
          center: BANGALORE_CENTER,
          zoom: DEFAULT_ZOOM,
          pitch: 52,
          bearing: -12,
          duration: 3200,
          essential: true,
          easing: (t: number) => {
            // Cubic ease-in-out for a smooth cinematic feel
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          },
        });
      }, 800);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // -----------------------------------------------------------------------
  // 2. Draw routes: layered (glow -> casing -> main) for selected,
  //    dashed for alternatives
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    // Clean up old sources + layers
    for (const id of routeIdsRef.current) {
      for (const suffix of ["-glow", "-casing", "-main"]) {
        const layerId = `${id}${suffix}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(id)) map.removeSource(id);
    }
    routeIdsRef.current = [];

    // Clean up old pin markers
    pinMarkersRef.current.forEach((m) => m.remove());
    pinMarkersRef.current = [];

    if (routes.length === 0) return;

    // Draw alternatives first (behind), selected last (on top)
    const order = routes
      .map((_, i) => i)
      .sort((a, b) => {
        if (a === selectedRouteIndex) return 1;
        if (b === selectedRouteIndex) return -1;
        return 0;
      });

    for (const i of order) {
      const route = routes[i];
      if (!route.path || route.path.length < 2) continue;

      const isSelected = i === selectedRouteIndex;
      const color = getRouteColor(i, selectedRouteIndex);
      const srcId = `route-${i}`;

      map.addSource(srcId, {
        type: "geojson",
        data: pathToGeoJSON(route.path),
      });
      routeIdsRef.current.push(srcId);

      if (isSelected) {
        // Wide soft glow halo
        map.addLayer({
          id: `${srcId}-glow`,
          type: "line",
          source: srcId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": 28,
            "line-opacity": 0.30,
            "line-blur": 16,
          },
        });
        // Black contrast casing
        map.addLayer({
          id: `${srcId}-casing`,
          type: "line",
          source: srcId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#000000",
            "line-width": 11,
            "line-opacity": 0.65,
          },
        });
        // Bright neon main line
        map.addLayer({
          id: `${srcId}-main`,
          type: "line",
          source: srcId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": 7,
            "line-opacity": 1,
          },
        });
      } else {
        // Alt: dark casing
        map.addLayer({
          id: `${srcId}-casing`,
          type: "line",
          source: srcId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#000000",
            "line-width": 7,
            "line-opacity": 0.45,
            "line-dasharray": [2, 2],
          },
        });
        // Vivid neon dashed alt
        map.addLayer({
          id: `${srcId}-main`,
          type: "line",
          source: srcId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": 5,
            "line-opacity": 0.85,
            "line-dasharray": [4, 3],
          },
        });
      }

      // Click to select route
      const mainLayerId = `${srcId}-main`;
      map.on("click", mainLayerId, () => onRouteClick?.(i));

      // Cursor pointer on hover
      map.on("mouseenter", mainLayerId, () => {
        map.getCanvas().style.cursor = "pointer";
        if (!isSelected) {
          map.setPaintProperty(mainLayerId, "line-opacity", 0.8);
          map.setPaintProperty(mainLayerId, "line-width", 4);
        }
      });
      map.on("mouseleave", mainLayerId, () => {
        map.getCanvas().style.cursor = "";
        if (!isSelected) {
          map.setPaintProperty(mainLayerId, "line-opacity", 0.5);
          map.setPaintProperty(mainLayerId, "line-width", 3);
        }
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
      });

      // Hover popup for alternatives
      if (!isSelected) {
        map.on("mouseenter", mainLayerId, (e) => {
          const sLabel =
            route.signal_score >= 70 ? "Strong" : route.signal_score >= 40 ? "Medium" : "Weak";
          const sColor =
            route.signal_score >= 70 ? "#22c55e" : route.signal_score >= 40 ? "#eab308" : "#ef4444";
          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 14 })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:system-ui;min-width:140px;padding:2px 0;">
                <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${route.name}</div>
                <div style="display:flex;gap:10px;font-size:11px;color:#6b7280;">
                  <span>${route.eta} min</span><span>${route.distance} km</span>
                </div>
                <div style="margin-top:3px;font-size:11px;">
                  Signal: <span style="font-weight:600;color:${sColor}">${sLabel} (${Math.round(route.signal_score)})</span>
                </div>
              </div>`,
            )
            .addTo(map);
        });
      }
    }

    // Source (A) and destination (B) pins
    const selected = routes[selectedRouteIndex];
    if (selected?.path.length > 0) {
      const startPt = selected.path[0];
      const endPt = selected.path[selected.path.length - 1];

      // Pins are draggable: dropping one re-runs the search from the new point
      const srcPin = new mapboxgl.Marker({ color: "#3b82f6", draggable: !!onPinDrag })
        .setLngLat([startPt.lng, startPt.lat])
        .addTo(map);
      srcPin.on("dragend", () => handlePinDragEnd("source", srcPin));
      pinMarkersRef.current.push(srcPin);

      const dstPin = new mapboxgl.Marker({ color: "#ef4444", draggable: !!onPinDrag })
        .setLngLat([endPt.lng, endPt.lat])
        .addTo(map);
      dstPin.on("dragend", () => handlePinDragEnd("destination", dstPin));
      pinMarkersRef.current.push(dstPin);

      // Fit bounds -- preserve 3D pitch and add tilt offset so the route
      // sits in the bottom half of the viewport (natural for pitched views).
      map.fitBounds(getBounds(selected.path), {
        padding: { top: 120, bottom: 200, left: 420, right: 100 },
        pitch: 50,
        bearing: -10,
        duration: 900,
        linear: false,
      });
    }
  }, [mapLoaded, routes, selectedRouteIndex, onRouteClick, onPinDrag, handlePinDragEnd]);

  // -----------------------------------------------------------------------
  // 2b. Dead zone overlays -- drawn as thick warning segments ON the route
  // -----------------------------------------------------------------------
  const deadZoneIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    // Clean up previous dead zone layers/sources
    for (const id of deadZoneIdsRef.current) {
      if (map.getLayer(`${id}-pulse`)) map.removeLayer(`${id}-pulse`);
      if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`);
      if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
      if (map.getLayer(`${id}-glow`)) map.removeLayer(`${id}-glow`);
      if (map.getSource(id)) map.removeSource(id);
    }
    deadZoneIdsRef.current = [];

    const selected = routes[selectedRouteIndex];
    if (!selected) return;

    // Helper: get sub-path points between two coords (nearest-point matching)
    function subPath(start: { lat: number; lng: number }, end: { lat: number; lng: number }, path: Coordinate[]): [number, number][] {
      if (!path?.length) return [[start.lng, start.lat], [end.lng, end.lat]];
      let startIdx = 0, endIdx = path.length - 1;
      let minStartDist = Infinity, minEndDist = Infinity;
      for (let i = 0; i < path.length; i++) {
        const dStart = Math.hypot(path[i].lat - start.lat, path[i].lng - start.lng);
        const dEnd = Math.hypot(path[i].lat - end.lat, path[i].lng - end.lng);
        if (dStart < minStartDist) { minStartDist = dStart; startIdx = i; }
        if (dEnd < minEndDist) { minEndDist = dEnd; endIdx = i; }
      }
      if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];
      const pts = path.slice(startIdx, endIdx + 1);
      if (pts.length < 2) return [[start.lng, start.lat], [end.lng, end.lat]];
      return pts.map((p) => [p.lng, p.lat] as [number, number]);
    }

    function addDeadZoneLine(
      id: string,
      coords: [number, number][],
      color: string,
      glowColor: string,
      label: string,
      popupHtml: string,
    ) {
      if (coords.length < 2) return;
      const midCoord = coords[Math.floor(coords.length / 2)];
      map.addSource(id, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        },
      });
      deadZoneIdsRef.current.push(id);

      // Outer glow
      map.addLayer({
        id: `${id}-glow`,
        type: "line",
        source: id,
        paint: {
          "line-color": glowColor,
          "line-width": 18,
          "line-opacity": 0.25,
          "line-blur": 6,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      // Inner solid warning line
      map.addLayer({
        id: `${id}-line`,
        type: "line",
        source: id,
        paint: {
          "line-color": color,
          "line-width": 7,
          "line-opacity": 0.88,
          "line-dasharray": [2, 1.5],
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      // Click popup
      map.on("click", `${id}-line`, () => {
        new mapboxgl.Popup({ closeButton: true, offset: 6 })
          .setLngLat(midCoord)
          .setHTML(popupHtml)
          .addTo(map);
      });
      map.on("mouseenter", `${id}-line`, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", `${id}-line`, () => { map.getCanvas().style.cursor = ""; });
    }

    // Render bad_zones as dashed red/orange lines on the route
    (selected.bad_zones ?? []).forEach((bz, idx) => {
      const coords = subPath(bz.start_coord, bz.end_coord, selected.path);
      const color = bz.min_signal < 20 ? "#ff1744" : "#ff6d00";
      const glowColor = bz.min_signal < 20 ? "#ff1744" : "#ff9100";
      addDeadZoneLine(
        `dz-bad-${selectedRouteIndex}-${idx}`,
        coords,
        color,
        glowColor,
        "Dead Zone",
        `<div style="font-family:system-ui;padding:2px 0;">
          <div style="font-weight:700;font-size:12px;color:${color};margin-bottom:4px;">⚠ Dead Zone</div>
          <div style="font-size:11px;color:#374151;">${bz.warning}</div>
          <div style="display:flex;gap:8px;margin-top:4px;font-size:10px;color:#9ca3af;">
            <span>${bz.length_km.toFixed(1)} km</span>
            <span>~${Math.round(bz.time_to_zone_min)} min away</span>
            <span>Min signal: ${Math.round(bz.min_signal)}</span>
          </div>
        </div>`,
      );
    });

    // Render carrier_dead_zones (all carriers weak) as bold red lines
    (selected.carrier_dead_zones ?? []).forEach((cz, idx) => {
      const coords = subPath(cz.start_coord, cz.end_coord, selected.path);
      addDeadZoneLine(
        `dz-carrier-${selectedRouteIndex}-${idx}`,
        coords,
        "#b71c1c",
        "#f44336",
        "No Signal Zone",
        `<div style="font-family:system-ui;padding:2px 0;">
          <div style="font-weight:700;font-size:12px;color:#f44336;margin-bottom:4px;">📵 No Signal Zone</div>
          <div style="font-size:11px;color:#374151;">All carriers weak in this area</div>
          <div style="display:flex;gap:8px;margin-top:4px;font-size:10px;color:#9ca3af;">
            <span>${cz.length_km.toFixed(1)} km</span>
            <span>~${Math.round(cz.time_to_zone_min)} min away</span>
            <span>Best signal: ${Math.round(cz.best_signal_in_zone)}</span>
          </div>
        </div>`,
      );
    });
  }, [mapLoaded, routes, selectedRouteIndex]);

  // -----------------------------------------------------------------------
  // 2c. Heatmap zone overlay -- colored circles (signal/weather/traffic) or
  //     colored road lines (road layer)
  // -----------------------------------------------------------------------
  const heatmapIdsRef = useRef<string[]>([]);
  const heatmapPopupsRef = useRef<mapboxgl.Popup[]>([]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    // Clean up previous heatmap layers/sources
    for (const id of heatmapIdsRef.current) {
      for (const suffix of ["-glow", "-fill", "-outline", "-main"]) {
        if (map.getLayer(`${id}${suffix}`)) map.removeLayer(`${id}${suffix}`);
      }
      if (map.getSource(id)) map.removeSource(id);
    }
    heatmapIdsRef.current = [];
    heatmapPopupsRef.current.forEach((p) => p.remove());
    heatmapPopupsRef.current = [];

    // Nothing to render when no layer is selected or no zones
    if (!heatmapFilter || heatmapFilter === "none") return;
    if (!heatmapZones || heatmapZones.length === 0) return;

    const layerType = heatmapFilter;

    // ---- Road layer: draw colored line segments along selected route ----
    if (layerType === "road") {
      const selectedRoute = routes[selectedRouteIndex];
      if (!selectedRoute?.path || selectedRoute.path.length < 2) return;

      // Helper: squared flat-Earth distance between two lat/lng points
      function sqDistDeg(aLat: number, aLng: number, bLat: number, bLng: number) {
        const dx = (aLng - bLng) * DEG_TO_M_LNG;
        const dy = (aLat - bLat) * DEG_TO_M_LAT;
        return dx * dx + dy * dy;
      }

      // For each segment midpoint on the route, find the nearest road zone
      const path = selectedRoute.path;
      type Seg = { coords: [number, number][]; color: string; label: string };
      const segments: Seg[] = [];

      let currentColor = heatmapZones[0].color;
      let currentLabel = heatmapZones[0].label;
      let currentCoords: [number, number][] = [[path[0].lng, path[0].lat]];

      for (let i = 0; i < path.length - 1; i++) {
        const midLat = (path[i].lat + path[i + 1].lat) / 2;
        const midLng = (path[i].lng + path[i + 1].lng) / 2;

        let minDist = Infinity;
        let nearestColor = currentColor;
        let nearestLabel = currentLabel;
        for (const zone of heatmapZones) {
          const d = sqDistDeg(midLat, midLng, zone.lat, zone.lng);
          if (d < minDist) {
            minDist = d;
            nearestColor = zone.color;
            nearestLabel = zone.label;
          }
        }

        if (nearestColor !== currentColor) {
          // Flush current segment up to this point
          currentCoords.push([path[i].lng, path[i].lat]);
          segments.push({ coords: currentCoords, color: currentColor, label: currentLabel });
          currentColor = nearestColor;
          currentLabel = nearestLabel;
          currentCoords = [[path[i].lng, path[i].lat]];
        }
        currentCoords.push([path[i + 1].lng, path[i + 1].lat]);
      }
      // Flush last segment
      if (currentCoords.length >= 2) {
        segments.push({ coords: currentCoords, color: currentColor, label: currentLabel });
      }

      segments.forEach((seg, idx) => {
        const srcId = `hm-road-seg-${idx}`;
        map.addSource(srcId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: { color: seg.color, label: seg.label },
            geometry: { type: "LineString", coordinates: seg.coords },
          },
        });
        heatmapIdsRef.current.push(srcId);

        // Wide glow halo
        map.addLayer({
          id: `${srcId}-glow`,
          type: "line",
          source: srcId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": seg.color, "line-width": 22, "line-opacity": 0.18, "line-blur": 8 },
        });
        // Main colored road line (drawn over existing route line)
        map.addLayer({
          id: `${srcId}-main`,
          type: "line",
          source: srcId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": seg.color, "line-width": 9, "line-opacity": 0.80 },
        });

        // Popup on click
        map.on("click", `${srcId}-main`, (e) => {
          const popup = new mapboxgl.Popup({ closeButton: true, offset: 4 })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:system-ui;padding:2px 0;">
                <div style="font-weight:700;font-size:13px;color:${seg.color};margin-bottom:4px;">Road Segment</div>
                <div style="font-size:11px;color:#e2e8f0;">Type: <strong>${seg.label}</strong></div>
              </div>`,
            )
            .addTo(map);
          heatmapPopupsRef.current.push(popup);
        });
        map.on("mouseenter", `${srcId}-main`, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", `${srcId}-main`, () => { map.getCanvas().style.cursor = ""; });
      });

      return;
    }

    // ---- Signal / Weather / Traffic layers: colored circles ----
    heatmapZones.forEach((zone, idx) => {
      // Use actual radius_km from backend if available; fall back to score-based sizing
      const KM_TO_DEG = 1 / 111.32;  // approximate km -> degrees
      let baseRadius: number;
      if (zone.radius_km) {
        baseRadius = zone.radius_km * KM_TO_DEG;
      } else if (layerType === "traffic") {
        baseRadius = 0.008 + (zone.score / 100) * 0.012;
      } else {
        baseRadius = 0.008 + ((100 - zone.score) / 100) * 0.008;
      }

      // Build circle polygon (48 segments for smoothness)
      const steps = 48;
      const coords: [number, number][] = [];
      const lngScale = Math.cos((zone.lat * Math.PI) / 180);
      for (let s = 0; s <= steps; s++) {
        const angle = (s / steps) * 2 * Math.PI;
        coords.push([
          zone.lng + (baseRadius / lngScale) * Math.cos(angle),
          zone.lat + baseRadius * Math.sin(angle),
        ]);
      }

      const srcId = `hm-${layerType}-${idx}`;
      map.addSource(srcId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {
            name: zone.name,
            score: zone.score,
            label: zone.label,
            color: zone.color,
          },
          geometry: { type: "Polygon", coordinates: [coords] },
        },
      });
      heatmapIdsRef.current.push(srcId);

      // Outer glow
      map.addLayer({
        id: `${srcId}-glow`,
        type: "fill",
        source: srcId,
        paint: {
          "fill-color": zone.color,
          "fill-opacity": 0.1,
        },
      });

      // Main fill
      map.addLayer({
        id: `${srcId}-fill`,
        type: "fill",
        source: srcId,
        paint: {
          "fill-color": zone.color,
          "fill-opacity": 0.3,
        },
      });

      // Outline ring
      map.addLayer({
        id: `${srcId}-outline`,
        type: "line",
        source: srcId,
        paint: {
          "line-color": zone.color,
          "line-width": 1.5,
          "line-opacity": 0.6,
        },
      });

      // Popup on click
      map.on("click", `${srcId}-fill`, () => {
        const popup = new mapboxgl.Popup({ closeButton: true, offset: 4 })
          .setLngLat([zone.lng, zone.lat])
          .setHTML(
            `<div style="font-family:system-ui;padding:2px 0;">
              <div style="font-weight:700;font-size:13px;color:${zone.color};margin-bottom:4px;">${zone.name}</div>
              <div style="font-size:11px;color:#e2e8f0;margin-bottom:2px;">${layerType.charAt(0).toUpperCase() + layerType.slice(1)}: <strong>${zone.label}</strong></div>
              <div style="font-size:11px;color:#94a3b8;">Score: ${zone.score}/100</div>
            </div>`,
          )
          .addTo(map);
        heatmapPopupsRef.current.push(popup);
      });
      map.on("mouseenter", `${srcId}-fill`, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", `${srcId}-fill`, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  }, [mapLoaded, heatmapZones, heatmapFilter, routes, selectedRouteIndex]);

  // -----------------------------------------------------------------------
  // 3. Tower dot markers -- only towers near the selected route
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    towerMarkersRef.current.forEach((m) => m.remove());
    towerMarkersRef.current = [];

    if (!towerMarkers || towerMarkers.length === 0) return;

    // Filter towers to those within the buffer of the selected route
    const selectedRoute = routes[selectedRouteIndex];
    const visibleTowers =
      selectedRoute?.path?.length >= 2
        ? filterTowersNearRoute(towerMarkers, selectedRoute.path)
        : [];

    for (const tower of visibleTowers) {
      const color = OPERATOR_COLORS[tower.operator] ?? "#6b7280";
      const size = tower.signal_score >= 70 ? 9 : tower.signal_score >= 40 ? 7 : 6;
      const opacity = tower.signal_score >= 70 ? 0.95 : tower.signal_score >= 40 ? 0.80 : 0.65;

      // Fixed-size element — no scaling on hover (scaling shifts Mapbox anchor)
      const el = document.createElement("div");
      el.style.cssText = `width:${size}px;height:${size}px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;opacity:${opacity};box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer;`;
      el.title = tower.operator;

      const sLabel =
        tower.signal_score >= 70 ? "Strong" : tower.signal_score >= 40 ? "Medium" : "Weak";
      const sColor =
        tower.signal_score >= 70 ? "#22c55e" : tower.signal_score >= 40 ? "#f59e0b" : "#ef4444";

      const popupHtml = `
        <div style="font-family:system-ui;min-width:140px;padding:2px 0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <div style="width:10px;height:10px;background:${color};border-radius:50%;border:1.5px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.3);flex-shrink:0;"></div>
            <span style="font-weight:700;font-size:13px;color:#111;">${tower.operator}</span>
          </div>
          ${tower.zone ? `<div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${tower.zone}</div>` : ""}
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
            <span style="font-size:11px;font-weight:600;color:${sColor};">● ${sLabel}</span>
            <span style="font-size:11px;color:#374151;">(${Math.round(tower.signal_score)})</span>
          </div>
          ${tower.radio ? `<div style="font-size:10px;color:#9ca3af;">Type: ${tower.radio}</div>` : ""}
          <div style="font-size:10px;color:#9ca3af;margin-top:2px;">ID: ${tower.tower_id}</div>
        </div>`;

      const popup = new mapboxgl.Popup({
        offset: [0, -(size / 2) - 4],
        closeButton: false,
        closeOnClick: false,
        className: "tower-popup",
      }).setHTML(popupHtml);

      const m = new mapboxgl.Marker({ element: el })
        .setLngLat([tower.lng, tower.lat])
        .addTo(map);

      // Debounced hide so moving from dot → popup doesn't flicker
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      const showPopup = () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        // Highlight dot with stronger border (no position-shifting transform)
        el.style.border = "2.5px solid #fff";
        el.style.boxShadow = `0 0 0 3px ${color}55, 0 2px 8px rgba(0,0,0,.5)`;
        popup.setLngLat([tower.lng, tower.lat]).addTo(map);
      };

      const hidePopup = () => {
        hideTimer = setTimeout(() => {
          el.style.border = "2px solid rgba(255,255,255,0.9)";
          el.style.boxShadow = "0 1px 4px rgba(0,0,0,.35)";
          popup.remove();
        }, 120);
      };

      el.addEventListener("mouseenter", showPopup);
      el.addEventListener("mouseleave", hidePopup);

      // Keep popup open when mouse moves over it
      popup.on("open", () => {
        const popupEl = popup.getElement();
        if (popupEl) {
          popupEl.addEventListener("mouseenter", () => {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          });
          popupEl.addEventListener("mouseleave", hidePopup);
        }
      });

      towerMarkersRef.current.push(m);
    }
  }, [mapLoaded, towerMarkers, routes, selectedRouteIndex]);

  // -----------------------------------------------------------------------
  // 4. Live tracking marker (pulsing blue dot)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    if (!trackingPosition) {
      trackingMarkerRef.current?.remove();
      trackingMarkerRef.current = null;
      return;
    }

    if (!trackingMarkerRef.current) {
      const el = document.createElement("div");
      el.innerHTML = `
        <div style="position:relative;width:22px;height:22px;">
          <div style="position:absolute;inset:0;background:rgba(59,130,246,0.2);border-radius:50%;animation:mbx-pulse 2s ease-in-out infinite;"></div>
          <div style="position:absolute;top:4px;left:4px;width:14px;height:14px;background:#3b82f6;border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>
        </div>`;
      trackingMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([trackingPosition.lng, trackingPosition.lat])
        .addTo(mapRef.current);
      // Zoom in on the vehicle when navigation starts
      mapRef.current.easeTo({
        center: [trackingPosition.lng, trackingPosition.lat],
        zoom: 15,
        pitch: 55,
        duration: 1000,
      });
    } else {
      trackingMarkerRef.current.setLngLat([trackingPosition.lng, trackingPosition.lat]);
      // Follow the vehicle without fighting user zoom/rotation
      mapRef.current.easeTo({
        center: [trackingPosition.lng, trackingPosition.lat],
        duration: 450,
        easing: (t) => t,
      });
    }
  }, [mapLoaded, trackingPosition]);

  // -----------------------------------------------------------------------
  // 5. User real-location marker
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    if (!userLocation) {
      userLocMarkerRef.current?.remove();
      userLocMarkerRef.current = null;
      return;
    }

    if (!userLocMarkerRef.current) {
      const el = document.createElement("div");
      el.innerHTML = `
        <div style="width:14px;height:14px;background:#3b82f6;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px rgba(59,130,244,.3),0 1px 4px rgba(0,0,0,.3);"></div>`;
      userLocMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(mapRef.current);
    } else {
      userLocMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
    }
  }, [mapLoaded, userLocation]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <>
      {!mapLoaded && (
        <div className="absolute inset-0 z-10 bg-gray-50 flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Loading map...</p>
        </div>
      )}
      <div
        id="map-area"
        ref={containerRef}
        style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%" }}
      />
    </>
  );
}
