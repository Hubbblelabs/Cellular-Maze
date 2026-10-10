import axios from "axios";

import type {
  CongestionAlert,
  HeatmapResponse,
  OfflineBundle,
  PredictionResponse,
  RerouteRequest,
  RerouteResponse,
  RouteQueryParams,
  RoutesResponse,
  FastRoutesResponse,
  TowerSummary,
  TowerMarker,
  TowerMarkersResponse,
  WeatherInfo,
  CarrierDeadZone,
} from "@/src/types/route";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 180_000,
});

export const routeService = {
  /** Full route scoring with ML, towers, weather, dead zones. Slow (~30-60s). */
  async getRoutes(params: RouteQueryParams): Promise<RoutesResponse> {
    const { data } = await client.get<RoutesResponse>("/api/routes", { params });
    return data;
  },

  /** Fast geometry-only routes from TomTom. No signal scoring. Returns in ~1-2s. */
  async getFastRoutes(source: string, destination: string): Promise<FastRoutesResponse> {
    const { data } = await client.get<FastRoutesResponse>("/api/routes/fast", {
      params: { source, destination },
    });
    return data;
  },

  async reroute(request: RerouteRequest): Promise<RerouteResponse> {
    const { data } = await client.post<RerouteResponse>("/api/reroute", request);
    return data;
  },
};

export const heatmapService = {
  async getHeatmap(layer: string = "signal"): Promise<HeatmapResponse> {
    const { data } = await client.get<HeatmapResponse>("/api/heatmap", {
      params: { layer },
    });
    return data;
  },
};

export const predictionService = {
  async getPrediction(zone: string, minutes = 15): Promise<PredictionResponse> {
    const { data } = await client.get<PredictionResponse>("/api/predict", {
      params: { zone, minutes },
    });
    return data;
  },
};

export const towerService = {
  async getTowers(): Promise<TowerSummary> {
    const { data } = await client.get<TowerSummary>("/api/towers");
    return data;
  },
};

export const towerGeoService = {
  async fetchAll(maxTowers = 300): Promise<TowerMarker[]> {
    const { data } = await client.get<TowerMarkersResponse>("/api/towers/geo", {
      params: { max_towers: maxTowers },
    });
    return data.towers ?? [];
  },
};

export const offlineService = {
  async downloadBundle(
    source: string,
    destination: string,
    preference = 50,
    telecom = "all",
  ): Promise<OfflineBundle> {
    const { data } = await client.get<OfflineBundle>("/api/offline-bundle", {
      params: { source, destination, preference, telecom },
    });
    return data;
  },

  saveToStorage(bundle: OfflineBundle): void {
    const key = `offline_${bundle.source}_${bundle.destination}`;
    localStorage.setItem(key, JSON.stringify(bundle));
  },

  loadFromStorage(source: string, destination: string): OfflineBundle | null {
    const key = `offline_${source}_${destination}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OfflineBundle;
    } catch {
      return null;
    }
  },

  listSavedBundles(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("offline_")) keys.push(key);
    }
    return keys;
  },
};

// ---------------------------------------------------------------------------
// Mapbox Search Box (Autocomplete) -- replaces Nominatim geocoding
// ---------------------------------------------------------------------------

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// crypto.randomUUID only exists in secure contexts (https/localhost); opening
// the dev server from a phone over http://<LAN-IP> must not crash the app.
function newSessionToken(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// One session token per search session; reset after retrieve() per Mapbox spec.
let _mbxSessionToken: string = newSessionToken();

// Coverage data, towers and the ML model are calibrated for Bengaluru, so
// autocomplete is restricted to the metro area (incl. the airport).
const BENGALURU_CENTER = { lat: 12.9716, lng: 77.5946 };
const BENGALURU_BBOX = "77.35,12.70,77.85,13.25";

export type MapboxSuggestion = {
  name: string;         // short place name, e.g. "Koramangala"
  full_address: string; // full display address
  mapbox_id: string;    // opaque ID required for the retrieve step
};

export const mapboxSearchService = {
  /** Step 1 – return autocomplete suggestions (no coordinates yet). */
  async suggest(
    q: string,
    proximity?: { lat: number; lng: number },
  ): Promise<MapboxSuggestion[]> {
    if (!q || q.trim().length < 2) return [];
    const params = new URLSearchParams({
      q: q.trim(),
      access_token: MAPBOX_TOKEN,
      session_token: _mbxSessionToken,
      country: "in",
      language: "en",
      limit: "5",
      bbox: BENGALURU_BBOX,
    });
    const bias = proximity ?? BENGALURU_CENTER;
    params.set("proximity", `${bias.lng},${bias.lat}`);
    try {
      const resp = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`,
      );
      if (!resp.ok) return [];
      const data = await resp.json() as {
        suggestions?: Array<{
          name: string;
          full_address?: string;
          place_formatted?: string;
          mapbox_id: string;
        }>;
      };
      return (data.suggestions ?? []).map((s) => ({
        name: s.name,
        full_address: s.full_address ?? s.place_formatted ?? s.name,
        mapbox_id: s.mapbox_id,
      }));
    } catch {
      return [];
    }
  },

  /** Step 2 – resolve a suggestion to exact coordinates. Resets session token. */
  async retrieve(
    mapboxId: string,
  ): Promise<{ name: string; lat: number; lng: number } | null> {
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      session_token: _mbxSessionToken,
    });
    try {
      const resp = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}?${params}`,
      );
      if (!resp.ok) return null;
      const data = await resp.json() as {
        features?: Array<{
          geometry: { coordinates: [number, number] };
          properties?: { name?: string; full_address?: string };
        }>;
      };
      // Reset session token after a successful retrieve (Mapbox billing spec)
      _mbxSessionToken = newSessionToken();
      const feature = data.features?.[0];
      if (!feature) return null;
      const [lng, lat] = feature.geometry.coordinates;
      return {
        name: feature.properties?.name ?? feature.properties?.full_address ?? "",
        lat,
        lng,
      };
    } catch {
      return null;
    }
  },

  /** Reverse-geocode lat/lng to a short human-readable place name. */
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      types: "place,neighborhood,address",
      limit: "1",
    });
    try {
      const resp = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${params}`,
      );
      if (!resp.ok) return null;
      const data = await resp.json() as {
        features?: Array<{
          text: string;
          context?: Array<{ id: string; text: string }>;
        }>;
      };
      const feature = data.features?.[0];
      if (!feature) return null;
      const placeName = feature.text;
      const ctxPart = feature.context?.find(
        (c) => c.id.startsWith("place") || c.id.startsWith("district"),
      )?.text;
      return ctxPart ? `${placeName}, ${ctxPart}` : placeName;
    } catch {
      return null;
    }
  },
};

export const weatherService = {
  async getWeather(lat: number, lng: number): Promise<WeatherInfo | null> {
    try {
      const { data } = await client.get<WeatherInfo>("/api/weather", {
        params: { lat, lng },
      });
      return data;
    } catch {
      return null;
    }
  },
};

export const alertsService = {
  async getAlerts(
    userLat: number,
    userLng: number,
    path: Array<{ lat: number; lng: number }>,
  ): Promise<{ alerts: CongestionAlert[]; count: number }> {
    try {
      // Sample path to keep URL small (max 25 points)
      const sampled =
        path.length <= 25
          ? path
          : path.filter((_, i) => i % Math.ceil(path.length / 25) === 0);
      const { data } = await client.get<{ alerts: CongestionAlert[]; count: number }>(
        "/api/alerts",
        {
          params: {
            user_lat: userLat,
            user_lng: userLng,
            path: JSON.stringify(sampled),
          },
        },
      );
      return data;
    } catch {
      return { alerts: [], count: 0 };
    }
  },
};

export type DeadZoneResponse = {
  source: string;
  destination: string;
  time_hour: number;
  weather: WeatherInfo;
  route_name: string;
  route_distance_km: number;
  carriers: Record<string, { avg: number; min: number; weak_segments: number }>;
  dead_zones: CarrierDeadZone[];
  total_dead_zones: number;
  best_carrier_per_point: string[];
};

export const deadZoneService = {
  async predict(
    source: string,
    destination: string,
    timeHour = -1,
  ): Promise<DeadZoneResponse | null> {
    try {
      const { data } = await client.get<DeadZoneResponse>("/api/dead-zones", {
        params: { source, destination, time_hour: timeHour },
      });
      return data;
    } catch {
      return null;
    }
  },
};

