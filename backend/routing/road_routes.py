"""Keyless road-snapped route alternatives via the public OSRM API.

TomTom is the primary routing engine, but it needs an API key. Without one
the backend used to fall back to straight-line synthetic paths that cut
through buildings. This module produces real road geometry instead:

1. One direct OSRM request with ``alternatives`` (usually 1-3 routes).
2. Several via-point requests that force the route through a nearby zone
   centre, giving geographically distinct alternatives through areas with
   different coverage -- exactly what signal-aware ranking needs.

Results are de-duplicated, filtered for silly detours, and cached.
"""

from __future__ import annotations

import asyncio
import datetime
import os
import time

import httpx

from backend.core.logging import logger
from backend.utils.geo import haversine

OSRM_URL: str = os.getenv("OSRM_URL", "https://router.project-osrm.org").rstrip("/")
_TIMEOUT_S = 10.0
_MAX_CONCURRENCY = 4          # be polite to the public demo server
_MAX_DETOUR_RATIO = 1.7       # drop via-routes longer than 1.7x the shortest
_DUPLICATE_OVERLAP = 0.85     # >85% shared points => same road
_CACHE_TTL_S = 600
_cache: dict[str, tuple[float, list[dict]]] = {}


def traffic_factor(hour: float) -> float:
    """Time-of-day congestion multiplier for free-flow OSRM durations (Bengaluru)."""
    if 8 <= hour < 11:
        return 1.5
    if 17 <= hour < 21:
        return 1.6
    if 11 <= hour < 17:
        return 1.25
    return 1.05


def _path_length_km(path: list[dict]) -> float:
    return sum(
        haversine(path[i]["lat"], path[i]["lng"], path[i + 1]["lat"], path[i + 1]["lng"])
        for i in range(len(path) - 1)
    ) / 1000.0


def _overlap(a: list[dict], b: list[dict], tol_m: float = 150.0) -> float:
    """Fraction of sampled points of ``a`` lying within ``tol_m`` of ``b``."""
    step_a = max(1, len(a) // 40)
    step_b = max(1, len(b) // 200)
    sample_a = a[::step_a]
    sample_b = b[::step_b]
    hits = 0
    for p in sample_a:
        if any(haversine(p["lat"], p["lng"], q["lat"], q["lng"]) <= tol_m for q in sample_b):
            hits += 1
    return hits / max(1, len(sample_a))


async def _osrm(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    points: list[tuple[float, float]],
    alternatives: int = 0,
) -> list[dict]:
    coords = ";".join(f"{lng},{lat}" for lat, lng in points)
    params = {"overview": "full", "geometries": "geojson"}
    if alternatives:
        params["alternatives"] = str(alternatives)
    async with sem:
        try:
            resp = await client.get(f"{OSRM_URL}/route/v1/driving/{coords}", params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # network error, 429, bad JSON...
            logger.warning("OSRM request failed: %s", exc)
            return []
    if data.get("code") != "Ok":
        return []
    out = []
    for r in data.get("routes", []):
        path = [{"lat": round(lat, 6), "lng": round(lng, 6)} for lng, lat in r["geometry"]["coordinates"]]
        if len(path) >= 2:
            out.append({"duration_s": r["duration"], "distance_km": r["distance"] / 1000.0, "path": path})
    return out


async def get_road_routes(
    src: tuple[float, float],
    dst: tuple[float, float],
    via_candidates: list[tuple[str, tuple[float, float]]],
    max_routes: int = 7,
) -> list[dict]:
    """Return up to ``max_routes`` distinct road routes, fastest first.

    Each route dict has ``name``, ``eta`` (min, traffic-adjusted), ``distance``
    (km), ``path`` and ``traffic_delay`` (min). Returns ``[]`` if OSRM is
    unreachable so the caller can fall back further.
    """
    key = f"{src[0]:.4f},{src[1]:.4f}|{dst[0]:.4f},{dst[1]:.4f}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL_S:
        return [dict(r) for r in hit[1]]

    sem = asyncio.Semaphore(_MAX_CONCURRENCY)
    async with httpx.AsyncClient(timeout=_TIMEOUT_S, headers={"User-Agent": "CellularMaze/1.0"}) as client:
        direct_task = _osrm(client, sem, [src, dst], alternatives=3)
        via_tasks = [_osrm(client, sem, [src, c, dst]) for _, c in via_candidates]
        results = await asyncio.gather(direct_task, *via_tasks)

    direct = results[0]
    if not direct:
        return []

    labelled: list[tuple[str, dict]] = []
    for i, r in enumerate(direct):
        labelled.append(("Direct Route" if i == 0 else f"Direct Alternative {i}", r))
    for (zone_name, _), rs in zip(via_candidates, results[1:]):
        if rs:
            labelled.append((f"Via {zone_name}", rs[0]))

    shortest = min(r["distance_km"] for _, r in labelled)
    kept: list[tuple[str, dict]] = []
    for name, r in sorted(labelled, key=lambda x: x[1]["duration_s"]):
        if r["distance_km"] > shortest * _MAX_DETOUR_RATIO:
            continue
        if any(
            abs(r["distance_km"] - k["distance_km"]) / k["distance_km"] < 0.05
            and _overlap(r["path"], k["path"]) > _DUPLICATE_OVERLAP
            for _, k in kept
        ):
            continue
        kept.append((name, r))
        if len(kept) >= max_routes:
            break

    now = datetime.datetime.now()
    factor = traffic_factor(now.hour + now.minute / 60.0)
    routes = []
    for name, r in kept:
        free_flow_min = r["duration_s"] / 60.0
        routes.append({
            "name": name,
            "eta": round(free_flow_min * factor, 1),
            "distance": round(r["distance_km"], 1),
            "path": r["path"],
            "traffic_delay": round(free_flow_min * (factor - 1), 1),
            "source": "osrm",
        })

    logger.info("OSRM produced %d road routes (%d candidates)", len(routes), len(labelled))
    _cache[key] = (time.time(), [dict(r) for r in routes])
    return routes
