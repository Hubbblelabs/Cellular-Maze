export type TelecomMode = "all" | "jio" | "airtel" | "vi" | "multi";

export type Coordinate = {
  lat: number;
  lng: number;
};

export type BadZone = {
  start_coord: Coordinate;
  end_coord: Coordinate;
  length_km: number;
  min_signal: number;
  time_to_zone_min: number;
  zone_duration_min: number;
  edge_zone_name?: string | null;
  /** Nearest named area, for display */
  area?: string;
  warning: string;
};

export type MultiSimCarrier = {
  avg_connectivity: number;
  continuity_score: number;
  stability_score: number;
  drop_segments: number;
  signal_variance: number;
};

export type MultiSimInfo = {
  per_carrier: Record<string, MultiSimCarrier>;
  best_carrier: string;
  combined_avg_signal: number;
  combined_continuity: number;
  combined_variance: number;
  best_carrier_per_segment: string[];
};

export type RouteOption = {
  name: string;
  eta: number;
  distance: number;
  signal_score: number;
  weighted_score: number;
  zones: string[];
  path: Coordinate[];
  rejected?: boolean;
  // Stability metrics
  stability_score?: number;
  continuity_score?: number;
  signal_variance?: number;
  longest_stable_window?: number;
  // Bad zone predictions
  bad_zones?: BadZone[];
  // Per-route call drop count (segments where drop_prob > 0.5)
  segment_drop_count?: number;
  // Multi-SIM
  multi_sim?: MultiSimInfo;
  // Per-carrier dead zones
  carrier_dead_zones?: CarrierDeadZone[];
  carrier_summary?: Record<string, CarrierSignalSummary>;
  // Offline cache alerts
  offline_alerts?: OfflineCacheAlert[];
};

export type CarrierSignalSummary = {
  avg: number;
  min: number;
  weak_segments: number;
};

export type CarrierDeadZone = {
  start_coord: Coordinate;
  end_coord: Coordinate;
  length_km: number;
  time_to_zone_min: number;
  zone_duration_min: number;
  best_signal_in_zone: number;
  area: string;
  carrier_signals: Record<string, number>;
};

export type OfflineCacheAlert = {
  type: "offline_cache";
  time_to_zone_min: number;
  zone_duration_min: number;
  length_km: number;
  area: string;
  message: string;
};

export type CallDropStats = {
  drops_avoided: number;
  recommended_drops: number;
  worst_alternative_drops: number;
  message: string;
};

export type WeatherInfo = {
  condition: string;
  description: string;
  icon: string;
  temperature_c: number;
  humidity_pct: number;
  wind_speed_ms: number;
  visibility_m: number;
  weather_factor: number;
  signal_impact: string;
  weather_id: number;
};

export type CongestionAlert = {
  lat: number;
  lng: number;
  area: string;
  type: string;
  congestion_level: number;
  crowd_level: number;
  persist_minutes: number;
  distance_km: number;
  on_route: boolean;
  severity: "high" | "medium";
  message: string;
  suggest_reroute: boolean;
};

export type RoutesResponse = {
  source: string;
  destination: string;
  preference: number;
  max_eta_factor?: number;
  routes: RouteOption[];
  recommended_route: string;
  cache_hit?: boolean;
  weather?: WeatherInfo;
  call_drop_stats?: CallDropStats;
};

export type HeatmapZone = {
  name: string;
  lat: number;
  lng: number;
  score: number;
  label: string;
  color: string;
  radius_km?: number;
};

export type HeatmapResponse = {
  layer: string;
  zones: HeatmapZone[];
};

export type TowerMarker = {
  tower_id: string;
  lat: number;
  lng: number;
  operator: string;
  signal_score: number;
  zone?: string;
  radio?: string | null;
};

export type TowerMarkersResponse = {
  towers: TowerMarker[];
  count: number;
};

export type PredictionResponse = {
  zone: string;
  horizon_minutes: number;
  expected_signal_score: number;
  message: string;
};

export type RerouteRequest = {
  source: string;
  destination: string;
  current_zone?: string;
  preference: number;
  telecom: TelecomMode;
};

export type RerouteResponse = {
  message: string;
  selected_route: RouteOption;
  advisory: string;
};

export type RouteQueryParams = {
  source: string;
  destination: string;
  preference: number;
  telecom: TelecomMode;
  max_eta_factor?: number;
};

export type FastRouteOption = {
  name: string;
  eta: number;
  distance: number;
  path: Coordinate[];
  zones?: string[];
  signal_score: number;
  weighted_score: number;
  tags?: string[];
  traffic_delay?: number;
};

export type FastRoutesResponse = {
  source: string;
  destination: string;
  routes: FastRouteOption[];
  recommended_route: string;
  phase: "fast";
};

export type TowerSummary = {
  source: string;
  count: number;
  operators: Record<string, number>;
  zones: Record<string, number>;
  radio_types?: Record<string, number>;
  towers_with_signal?: number;
};

export type OfflineBundleRoute = RouteOption & {
  segment_signals?: number[];
  segment_colors?: string[];
};

export type OfflineBundle = {
  source: string;
  destination: string;
  generated_at: number;
  routes: OfflineBundleRoute[];
  heatmap: HeatmapZone[];
  offline: boolean;
};
