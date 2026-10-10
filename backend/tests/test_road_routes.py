"""Tests for the keyless OSRM road-route fallback and bad-zone placement."""

from unittest.mock import patch

import pytest

from backend.routing import road_routes
from backend.routing.road_routes import get_road_routes, traffic_factor
from model.bad_zones import detect_bad_zones

SRC = (12.9756, 77.6070)
DST = (12.8450, 77.6700)


def _line(lat0, lng0, lat1, lng1, n=50, bend=0.0):
    """Straight-ish path with an optional sideways bend in the middle."""
    pts = []
    for i in range(n):
        t = i / (n - 1)
        off = bend * (1 - abs(2 * t - 1))
        pts.append({"lat": lat0 + (lat1 - lat0) * t, "lng": lng0 + (lng1 - lng0) * t + off})
    return pts


def _route(duration_s, distance_km, path):
    return {"duration_s": duration_s, "distance_km": distance_km, "path": path}


@pytest.fixture(autouse=True)
def _clear_cache():
    road_routes._cache.clear()
    yield
    road_routes._cache.clear()


def _fake_osrm(responses):
    """Return an _osrm replacement that answers calls in order."""
    calls = iter(responses)

    async def fake(client, sem, points, alternatives=0):
        return next(calls)

    return fake


@pytest.mark.asyncio
async def test_returns_empty_when_osrm_unreachable():
    with patch.object(road_routes, "_osrm", _fake_osrm([[]])):
        assert await get_road_routes(SRC, DST, []) == []


@pytest.mark.asyncio
async def test_names_sorts_and_dedupes_routes():
    direct = _route(1500, 18.7, _line(*SRC, *DST))
    duplicate_via = _route(1520, 18.9, _line(*SRC, *DST))  # same road as direct
    distinct_via = _route(1800, 21.5, _line(*SRC, *DST, bend=0.03))
    with patch.object(road_routes, "_osrm", _fake_osrm([[direct], [duplicate_via], [distinct_via]])):
        routes = await get_road_routes(
            SRC, DST, [("Silk Board", (12.91, 77.62)), ("Koramangala", (12.93, 77.63))],
        )
    names = [r["name"] for r in routes]
    assert names == ["Direct Route", "Via Koramangala"]
    assert routes[0]["eta"] < routes[1]["eta"]
    assert all(r["source"] == "osrm" for r in routes)


@pytest.mark.asyncio
async def test_drops_absurd_detours():
    direct = _route(1500, 18.0, _line(*SRC, *DST))
    huge_detour = _route(4000, 40.0, _line(*SRC, *DST, bend=0.2))
    with patch.object(road_routes, "_osrm", _fake_osrm([[direct], [huge_detour]])):
        routes = await get_road_routes(SRC, DST, [("Far Away", (13.1, 77.9))])
    assert [r["name"] for r in routes] == ["Direct Route"]


def test_traffic_factor_peaks():
    assert traffic_factor(9) > traffic_factor(14) > traffic_factor(2)
    assert traffic_factor(18.5) >= 1.5


def test_bad_zone_maps_subsampled_signals_onto_full_path():
    # score_route subsamples a 400-point path to 60 signal samples; a weak
    # sample at the middle must produce a zone in the middle of the route.
    path = [{"lat": 12.9 + i * 0.001, "lng": 77.6} for i in range(400)]
    signals = [80.0] * 60
    signals[30] = 10.0
    zones = detect_bad_zones(path, signals)
    assert len(zones) == 1
    z = zones[0]
    assert 180 <= z["start_index"] <= 220
    assert z["length_km"] > 0.3          # a single weak sample still spans ground
    assert z["start_coord"] == path[z["start_index"]]


def test_bad_zone_with_full_resolution_signals():
    path = [{"lat": 12.9 + i * 0.001, "lng": 77.6} for i in range(20)]
    signals = [80.0] * 20
    signals[5:8] = [10.0, 12.0, 9.0]
    zones = detect_bad_zones(path, signals)
    assert len(zones) == 1
    assert zones[0]["start_index"] <= 5 <= 7 <= zones[0]["end_index"] + 1
