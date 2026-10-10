"""Crowd and traffic persistence tracker.

Real-time congestion is sourced from the TomTom Traffic Flow API
(https://developer.tomtom.com/traffic-api/documentation/traffic-flow).
The Flow Segment Data endpoint returns current vs free-flow speed for any
road point.  Congestion ratio = 1 - (currentSpeed / freeFlowSpeed).

When the TomTom API is unavailable (network error, quota, no key), the
module falls back to a time-of-day + zone-density simulation so the
system degrades gracefully.

Flow data is cached per ~500 m grid cell for 90 seconds to avoid hammering
the API on every route request.

An *alert* is raised when:
  - congestion OR crowd level exceeds HIGH_* thresholds
  - condition has persisted >= MIN_PERSIST_MINUTES
  - at least MIN_SAMPLES independent observations have been recorded
  - event is within ALERT_RADIUS_KM of the user OR directly on the path

Edge-case handling:
  - Short-lived spikes (< MIN_PERSIST_MINUTES) are silently ignored
  - Stale observations (> STALE_EVICT_MINUTES with no update) are evicted
  - On-route alerts persisting > 8 min trigger a reroute suggestion
"""
import asyncio
import math
import os
import time
import logging
from dataclasses import dataclass, field

import httpx

from model.config import ZONES
from model.utils import haversine

logger = logging.getLogger("cellularmaze")

# -----------------------------------------------------------------------
# Config from environment
# -----------------------------------------------------------------------
_TOMTOM_API_KEY: str = os.getenv("TOMTOM_API_KEY", "")
_TOMTOM_BASE_URL: str = os.getenv("TOMTOM_BASE_URL", "https://api.tomtom.com")
_FLOW_URL = f"{_TOMTOM_BASE_URL}/traffic/services/4/flowSegmentData/absolute/10/json"

# -----------------------------------------------------------------------
# Thresholds
# -----------------------------------------------------------------------
MIN_PERSIST_MINUTES: float = 5.0
STALE_EVICT_MINUTES: float = 30.0
ALERT_RADIUS_KM: float = 2.5
ON_PATH_RADIUS_KM: float = 0.40   # 400 m
HIGH_CONGESTION: float = 0.65
HIGH_CROWD: float = 0.65
MIN_SAMPLES: int = 2
_FLOW_CACHE_TTL: int = 300         # seconds; also bounds TomTom quota use

_DENSITY_SCORE = {"high": 0.85, "medium": 0.55, "low": 0.25}

_COMMERCIAL_KEYWORDS = frozenset(
    ["mg road", "commercial", "market", "mall", "brigade", "church st", "city"]
)


# -----------------------------------------------------------------------
# Data model
# -----------------------------------------------------------------------
@dataclass
class CongestionEvent:
    lat: float
    lng: float
    area_name: str
    congestion_level: float      # 0–1 running average
    crowd_level: float           # 0–1 running average
    first_seen: float            # unix timestamp
    last_updated: float          # unix timestamp
    sample_count: int = 1
    source: str = "tomtom"       # "tomtom" | "fallback"
    current_speed_kmh: float = 0.0
    free_flow_speed_kmh: float = 0.0
    confidence: float = 1.0


# -----------------------------------------------------------------------
# In-memory stores
# -----------------------------------------------------------------------
_store: dict[str, CongestionEvent] = {}

# Flow cache: grid_key -> (timestamp, congestion_ratio, raw_data)
_flow_cache: dict[str, tuple[float, float, dict]] = {}


# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------
def _grid_key(lat: float, lng: float) -> str:
    """~500 m precision key."""
    return f"{round(lat * 200) / 200:.3f},{round(lng * 200) / 200:.3f}"


def _nearest_zone(lat: float, lng: float) -> tuple[str, dict]:
    best_name, best_info, best_d = "MG Road", ZONES["MG Road"], math.inf
    for name, info in ZONES.items():
        d = haversine(lat, lng, info["center"][0], info["center"][1])
        if d < best_d:
            best_name, best_info, best_d = name, info, d
    return best_name, best_info


# -----------------------------------------------------------------------
# TomTom Traffic Flow  (async)
# -----------------------------------------------------------------------
async def get_flow(lat: float, lng: float) -> dict | None:
    """Fetch TomTom Flow Segment Data for a road point.

    Returns a dict with:
        current_speed_kmh, free_flow_speed_kmh, confidence,
        congestion_ratio (0=free-flow, 1=standstill),
        source="tomtom"
    Returns None on any error or missing API key.
    """
    if not _TOMTOM_API_KEY:
        return None

    key = _grid_key(lat, lng)
    now = time.time()

    # Serve from cache if fresh
    if key in _flow_cache:
        ts, ratio, raw = _flow_cache[key]
        if now - ts < _FLOW_CACHE_TTL:
            return raw

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                _FLOW_URL,
                params={
                    "point": f"{lat},{lng}",
                    "unit": "KMPH",
                    "key": _TOMTOM_API_KEY,
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.debug("TomTom flow fetch failed for (%.4f,%.4f): %s", lat, lng, exc)
        return None

    segment = data.get("flowSegmentData", {})
    current = float(segment.get("currentSpeed", 0) or 0)
    free_flow = float(segment.get("freeFlowSpeed", 0) or 0)
    confidence = float(segment.get("confidence", 1.0) or 1.0)

    if free_flow <= 0:
        return None

    # Congestion ratio: 0 = free-flowing, 1 = complete standstill
    ratio = max(0.0, min(1.0, 1.0 - current / free_flow))

    result = {
        "current_speed_kmh": round(current, 1),
        "free_flow_speed_kmh": round(free_flow, 1),
        "confidence": round(confidence, 2),
        "congestion_ratio": round(ratio, 3),
        "source": "tomtom",
    }
    _flow_cache[key] = (now, ratio, result)
    return result


# -----------------------------------------------------------------------
# TomTom Traffic Incidents  (async, batch bounding box)
# -----------------------------------------------------------------------
async def get_incidents_bbox(
    min_lat: float, min_lng: float, max_lat: float, max_lng: float
) -> list[dict]:
    """Fetch traffic incidents within a bounding box.

    Returns a list of incident dicts with lat, lng, type, severity, description.
    """
    if not _TOMTOM_API_KEY:
        return []

    bbox = f"{min_lng},{min_lat},{max_lng},{max_lat}"
    url = f"{_TOMTOM_BASE_URL}/traffic/services/5/incidentDetails"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                url,
                params={
                    "key": _TOMTOM_API_KEY,
                    "bbox": bbox,
                    "fields": "{incidents{type,geometry{type,coordinates},properties{id,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity}}}",
                    "language": "en-GB",
                    "categoryFilter": "0,1,2,3,4,5,6,7,8,9,10,11,14",
                    "timeValidityFilter": "present",
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.debug("TomTom incidents fetch failed: %s", exc)
        return []

    incidents = []
    for inc in data.get("incidents", []):
        geom = inc.get("geometry", {})
        coords = geom.get("coordinates", [])
        props = inc.get("properties", {})

        # Geometry may be Point [lng,lat] or LineString [[lng,lat],...]
        if geom.get("type") == "Point" and len(coords) >= 2:
            inc_lng, inc_lat = coords[0], coords[1]
        elif geom.get("type") == "LineString" and coords:
            mid = coords[len(coords) // 2]
            inc_lng, inc_lat = mid[0], mid[1]
        else:
            continue

        events = props.get("events", [])
        description = events[0].get("description", "Traffic incident") if events else "Traffic incident"
        magnitude = int(props.get("magnitudeOfDelay", 0) or 0)
        # magnitudeOfDelay: 0=unknown,1=minor,2=moderate,3=major,4=undefined
        severity_map = {0: "unknown", 1: "low", 2: "medium", 3: "high", 4: "high"}

        incidents.append({
            "lat": inc_lat,
            "lng": inc_lng,
            "type": inc.get("type", "UNKNOWN"),
            "description": description,
            "magnitude": magnitude,
            "severity": severity_map.get(magnitude, "medium"),
            "from": props.get("from", ""),
            "to": props.get("to", ""),
            "delay_seconds": int(props.get("delay", 0) or 0),
        })

    return incidents


# -----------------------------------------------------------------------
# Fallback: time-of-day + zone-density simulation
# -----------------------------------------------------------------------
def _fallback_crowd(lat: float, lng: float, hour: float) -> float:
    """Estimate crowd density (0–1) when TomTom is unavailable."""
    zone_name, zone_info = _nearest_zone(lat, lng)
    base = _DENSITY_SCORE.get(zone_info.get("density", "medium"), 0.55)
    terrain = zone_info.get("terrain", "")

    if 8.0 <= hour < 10.5 or 17.0 <= hour < 20.5:
        mult = 1.00
    elif 12.0 <= hour < 14.0:
        mult = 0.75
    elif hour >= 22.0 or hour < 6.0:
        mult = 0.12
    elif 10.5 <= hour < 12.0 or 14.0 <= hour < 17.0:
        mult = 0.50
    else:
        mult = 0.40

    zone_lower = zone_name.lower()
    if any(kw in zone_lower for kw in _COMMERCIAL_KEYWORDS):
        if 10.0 <= hour < 21.0:
            mult = min(mult * 1.35, 1.0)

    if terrain == "highway":
        mult *= 0.35

    return round(min(base * mult, 1.0), 3)


# -----------------------------------------------------------------------
# Recording observations
# -----------------------------------------------------------------------
def record_congestion(
    lat: float,
    lng: float,
    congestion: float,
    crowd: float,
    area_name: str = "",
    source: str = "tomtom",
    current_speed_kmh: float = 0.0,
    free_flow_speed_kmh: float = 0.0,
    confidence: float = 1.0,
) -> None:
    """Record or update a congestion observation (running average)."""
    key = _grid_key(lat, lng)
    now = time.time()
    if key in _store:
        ev = _store[key]
        n = ev.sample_count
        ev.congestion_level = (ev.congestion_level * n + congestion) / (n + 1)
        ev.crowd_level = (ev.crowd_level * n + crowd) / (n + 1)
        ev.sample_count = n + 1
        ev.last_updated = now
        ev.current_speed_kmh = current_speed_kmh
        ev.free_flow_speed_kmh = free_flow_speed_kmh
        ev.confidence = confidence
    else:
        _store[key] = CongestionEvent(
            lat=lat,
            lng=lng,
            area_name=area_name or _grid_key(lat, lng),
            congestion_level=congestion,
            crowd_level=crowd,
            first_seen=now,
            last_updated=now,
            source=source,
            current_speed_kmh=current_speed_kmh,
            free_flow_speed_kmh=free_flow_speed_kmh,
            confidence=confidence,
        )


# -----------------------------------------------------------------------
# Seeding from routes  (async — queries TomTom flow per sampled point)
# -----------------------------------------------------------------------
_SEED_MAX_POINTS = 30       # TomTom free tier is ~2,500 requests/day
_SEED_CONCURRENCY = 6


async def seed_from_routes(route_dicts: list[dict], hour: float) -> None:
    """Seed the tracker with real TomTom flow data for route path points.

    Points are de-duplicated on the ~500 m flow grid across all routes
    (alternatives overlap heavily), capped, and fetched concurrently.
    Falls back to time-based simulation where the API call fails.
    """
    points: dict[str, tuple[float, float, float | None]] = {}
    for route in route_dicts:
        path = route.get("path", [])
        if not path:
            continue
        segs = route.get("connectivity", {}).get("segment_signals", [])
        step = max(1, len(path) // 12)
        for i in range(0, len(path), step):
            lat, lng = path[i]["lat"], path[i]["lng"]
            sig = segs[min(i * len(segs) // len(path), len(segs) - 1)] / 100.0 if segs else None
            points.setdefault(_grid_key(lat, lng), (lat, lng, sig))

    sampled = list(points.values())
    if len(sampled) > _SEED_MAX_POINTS:
        stride = len(sampled) / _SEED_MAX_POINTS
        sampled = [sampled[int(i * stride)] for i in range(_SEED_MAX_POINTS)]

    sem = asyncio.Semaphore(_SEED_CONCURRENCY)

    async def _seed_point(lat: float, lng: float, sig: float | None) -> None:
        async with sem:
            flow = await get_flow(lat, lng)

        if flow:
            congestion = flow["congestion_ratio"]
            # crowd is a blend of congestion + time-of-day (pedestrian density)
            crowd = min(congestion * 0.7 + _fallback_crowd(lat, lng, hour) * 0.3, 1.0)
            source = "tomtom"
            current_spd = flow["current_speed_kmh"]
            free_flow_spd = flow["free_flow_speed_kmh"]
            confidence = flow["confidence"]
        else:
            # Fallback: derive from model signal + time simulation
            crowd = _fallback_crowd(lat, lng, hour)
            congestion = max(0.0, (1.0 - sig) * crowd) if sig is not None else crowd * 0.30
            source = "fallback"
            current_spd = free_flow_spd = confidence = 0.0

        if crowd > 0.40 or congestion > 0.35:
            zone_name, _ = _nearest_zone(lat, lng)
            record_congestion(
                lat, lng, congestion, crowd, zone_name, source,
                current_spd, free_flow_spd, confidence,
            )

    await asyncio.gather(*(_seed_point(*pt) for pt in sampled))


# -----------------------------------------------------------------------
# Alert generation
# -----------------------------------------------------------------------
def get_active_alerts(
    user_lat: float,
    user_lng: float,
    path: list[dict],
) -> list[dict]:
    """Return current congestion/crowd alerts relevant to the user.

    Evicts stale entries, then filters by thresholds, persistence,
    and proximity (user position or upcoming path).
    """
    now = time.time()

    stale = [
        k for k, ev in _store.items()
        if now - ev.last_updated > STALE_EVICT_MINUTES * 60
    ]
    for k in stale:
        del _store[k]

    alerts: list[dict] = []

    for ev in _store.values():
        persist_min = (now - ev.first_seen) / 60.0

        if persist_min < MIN_PERSIST_MINUTES:
            continue
        if ev.sample_count < MIN_SAMPLES:
            continue
        if ev.congestion_level < HIGH_CONGESTION and ev.crowd_level < HIGH_CROWD:
            continue

        dist_user = haversine(user_lat, user_lng, ev.lat, ev.lng)
        on_path = any(
            haversine(ev.lat, ev.lng, pt["lat"], pt["lng"]) < ON_PATH_RADIUS_KM
            for pt in path
        )

        if dist_user > ALERT_RADIUS_KM and not on_path:
            continue

        types: list[str] = []
        if ev.congestion_level >= HIGH_CONGESTION:
            types.append("heavy traffic")
        if ev.crowd_level >= HIGH_CROWD:
            types.append("large crowd")

        severity = (
            "high" if ev.congestion_level > 0.82 or ev.crowd_level > 0.82
            else "medium"
        )
        persist_str = (
            f"{int(persist_min)} min" if persist_min < 60
            else f"{persist_min / 60:.1f} hr"
        )
        condition = " & ".join(types) or "congestion"
        suggest_reroute = on_path and persist_min >= 8.0

        speed_note = ""
        if ev.source == "tomtom" and ev.free_flow_speed_kmh > 0:
            speed_note = (
                f" (current {ev.current_speed_kmh:.0f} km/h vs "
                f"free-flow {ev.free_flow_speed_kmh:.0f} km/h)"
            )

        if on_path:
            message = (
                f"Your route has {condition} ahead near {ev.area_name}"
                f"{speed_note}, persisting for {persist_str}."
                + (" Consider an alternate route." if suggest_reroute else "")
            )
        else:
            message = (
                f"{condition.capitalize()} detected {dist_user:.1f} km away "
                f"near {ev.area_name}{speed_note}, active for {persist_str}."
            )

        alerts.append(
            {
                "lat": ev.lat,
                "lng": ev.lng,
                "area": ev.area_name,
                "type": condition,
                "congestion_level": round(ev.congestion_level, 2),
                "crowd_level": round(ev.crowd_level, 2),
                "current_speed_kmh": ev.current_speed_kmh,
                "free_flow_speed_kmh": ev.free_flow_speed_kmh,
                "confidence": ev.confidence,
                "source": ev.source,
                "persist_minutes": round(persist_min, 1),
                "distance_km": round(dist_user, 2),
                "on_route": on_path,
                "severity": severity,
                "message": message,
                "suggest_reroute": suggest_reroute,
            }
        )

    alerts.sort(key=lambda a: (not a["on_route"], a["distance_km"]))
    return alerts
