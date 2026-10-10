"""Production-grade TomTom routing client.

Async HTTP client with connection reuse, retry, and fallback.
Designed for FastAPI dependency injection and easy integration
into a fallback chain (TomTom -> OSRM -> mock).
"""

import os
from dataclasses import dataclass, field

import httpx

from backend.core.logging import logger

TOMTOM_API_KEY: str = os.getenv("TOMTOM_API_KEY", "")
TOMTOM_BASE_URL: str = os.getenv(
    "TOMTOM_BASE_URL", "https://api.tomtom.com"
).rstrip("/")

_REQUEST_TIMEOUT_S: float = 5.0
# TomTom calculateRoute supports up to 5 alternatives (6 routes total).
_MAX_ALTERNATIVES: int = 5


@dataclass(frozen=True)
class TomTomRoute:
    """Parsed route returned by TomTom."""

    eta: float  # minutes
    geometry: list[dict[str, float]]  # [{"lat": ..., "lng": ...}, ...]
    traffic_delay: float  # minutes


def _parse_routes(data: dict) -> list[TomTomRoute]:
    """Extract routes from the TomTom calculateRoute JSON response."""
    routes: list[TomTomRoute] = []
    for route in data.get("routes", []):
        summary = route.get("summary", {})
        travel_time_s = summary.get("travelTimeInSeconds", 0)
        traffic_delay_s = summary.get("trafficDelayInSeconds", 0)

        points: list[dict[str, float]] = []
        for leg in route.get("legs", []):
            for pt in leg.get("points", []):
                points.append(
                    {"lat": pt["latitude"], "lng": pt["longitude"]}
                )

        routes.append(
            TomTomRoute(
                eta=round(travel_time_s / 60.0, 2),
                geometry=points,
                traffic_delay=round(traffic_delay_s / 60.0, 2),
            )
        )
    return routes


def _generate_mock_routes(
    origin: tuple[float, float],
    destination: tuple[float, float],
) -> list[TomTomRoute]:
    """Straight-line interpolation fallback producing 7 geometrically diverse routes."""
    o_lat, o_lon = origin
    d_lat, d_lon = destination
    mid_lat = (o_lat + d_lat) / 2
    mid_lon = (o_lon + d_lon) / 2

    dlat = abs(d_lat - o_lat)
    dlon = abs(d_lon - o_lon)
    approx_km = ((dlat ** 2 + dlon ** 2) ** 0.5) * 111.0
    base_eta = max(approx_km / 40.0 * 60.0, 5.0)  # minutes at ~40 km/h

    # Lateral offsets to create distinct paths (scaled to route length)
    lat_off = max(dlat * 0.35, 0.008)
    lon_off = max(dlon * 0.35, 0.008)

    return [
        # Route 1: direct (fastest)
        TomTomRoute(
            eta=round(base_eta, 2),
            geometry=[
                {"lat": o_lat, "lng": o_lon},
                {"lat": mid_lat, "lng": mid_lon},
                {"lat": d_lat, "lng": d_lon},
            ],
            traffic_delay=round(base_eta * 0.08, 2),
        ),
        # Route 2: slight northern detour
        TomTomRoute(
            eta=round(base_eta * 1.10, 2),
            geometry=[
                {"lat": o_lat, "lng": o_lon},
                {"lat": mid_lat + lat_off * 0.5, "lng": mid_lon - lon_off * 0.3},
                {"lat": d_lat, "lng": d_lon},
            ],
            traffic_delay=round(base_eta * 0.12, 2),
        ),
        # Route 3: slight southern detour
        TomTomRoute(
            eta=round(base_eta * 1.15, 2),
            geometry=[
                {"lat": o_lat, "lng": o_lon},
                {"lat": mid_lat - lat_off * 0.5, "lng": mid_lon + lon_off * 0.3},
                {"lat": d_lat, "lng": d_lon},
            ],
            traffic_delay=round(base_eta * 0.15, 2),
        ),
        # Route 4: wider northern arc
        TomTomRoute(
            eta=round(base_eta * 1.22, 2),
            geometry=[
                {"lat": o_lat, "lng": o_lon},
                {"lat": o_lat + lat_off * 0.6, "lng": mid_lon},
                {"lat": mid_lat + lat_off, "lng": mid_lon},
                {"lat": d_lat, "lng": d_lon},
            ],
            traffic_delay=round(base_eta * 0.10, 2),
        ),
        # Route 5: wider southern arc
        TomTomRoute(
            eta=round(base_eta * 1.28, 2),
            geometry=[
                {"lat": o_lat, "lng": o_lon},
                {"lat": o_lat - lat_off * 0.6, "lng": mid_lon},
                {"lat": mid_lat - lat_off, "lng": mid_lon},
                {"lat": d_lat, "lng": d_lon},
            ],
            traffic_delay=round(base_eta * 0.20, 2),
        ),
        # Route 6: eastern bypass
        TomTomRoute(
            eta=round(base_eta * 1.33, 2),
            geometry=[
                {"lat": o_lat, "lng": o_lon},
                {"lat": mid_lat - lat_off * 0.3, "lng": mid_lon + lon_off},
                {"lat": mid_lat + lat_off * 0.3, "lng": mid_lon + lon_off * 0.8},
                {"lat": d_lat, "lng": d_lon},
            ],
            traffic_delay=round(base_eta * 0.22, 2),
        ),
        # Route 7: western bypass
        TomTomRoute(
            eta=round(base_eta * 1.40, 2),
            geometry=[
                {"lat": o_lat, "lng": o_lon},
                {"lat": mid_lat + lat_off * 0.3, "lng": mid_lon - lon_off},
                {"lat": mid_lat - lat_off * 0.3, "lng": mid_lon - lon_off * 0.8},
                {"lat": d_lat, "lng": d_lon},
            ],
            traffic_delay=round(base_eta * 0.25, 2),
        ),
    ]


class TomTomClient:
    """Async TomTom routing client with retry and fallback.

    Usage with FastAPI dependency injection::

        client = TomTomClient()          # app startup
        await client.startup()
        ...
        routes = await client.get_routes((12.97, 77.59), (12.84, 77.67))
        ...
        await client.shutdown()          # app shutdown
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = _REQUEST_TIMEOUT_S,
    ) -> None:
        self._api_key = api_key or TOMTOM_API_KEY
        self._base_url = (base_url or TOMTOM_BASE_URL).rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def startup(self) -> None:
        """Create a shared ``httpx.AsyncClient`` for connection reuse."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout),
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                ),
            )

    async def shutdown(self) -> None:
        """Close the underlying HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_routes(
        self,
        origin: tuple[float, float],
        destination: tuple[float, float],
        mock_fallback: bool = True,
    ) -> list[dict]:
        """Fetch routes from TomTom.

        Returns a list of dicts::

            [{"eta": float, "geometry": [...], "traffic_delay": float}, ...]

        On failure (after one retry), returns mock fallback routes, or an
        empty list when ``mock_fallback`` is False so callers can try other
        routing engines first.
        """
        try:
            parsed = await self._fetch_with_retry(origin, destination)
            if parsed:
                return [self._route_to_dict(r) for r in parsed]
        except Exception:
            logger.exception("TomTom routing failed after retry")

        if not mock_fallback:
            return []

        logger.warning(
            "TomTom API unavailable -- returning mock fallback routes"
        )
        return [
            self._route_to_dict(r)
            for r in _generate_mock_routes(origin, destination)
        ]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _fetch_with_retry(
        self,
        origin: tuple[float, float],
        destination: tuple[float, float],
    ) -> list[TomTomRoute]:
        """Call TomTom API; retry once on failure."""
        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                return await self._call_api(origin, destination)
            except Exception as exc:
                last_exc = exc
                if attempt == 0:
                    logger.warning(
                        "TomTom request failed (attempt 1), retrying: %s", exc
                    )
        if last_exc is not None:
            raise last_exc
        return []  # unreachable

    async def _call_api(
        self,
        origin: tuple[float, float],
        destination: tuple[float, float],
    ) -> list[TomTomRoute]:
        """Execute a single HTTP GET to TomTom calculateRoute."""
        await self.startup()  # ensure client exists
        assert self._client is not None

        o_lat, o_lon = origin
        d_lat, d_lon = destination
        locations = f"{o_lat},{o_lon}:{d_lat},{d_lon}"
        url = (
            f"{self._base_url}/routing/1/calculateRoute/{locations}/json"
        )
        params = {
            "key": self._api_key,
            "maxAlternatives": str(_MAX_ALTERNATIVES),
            "traffic": "true",
        }

        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

        routes = _parse_routes(data)
        if not routes:
            logger.warning("TomTom returned 200 but no routes in payload")
        return routes

    @staticmethod
    def _route_to_dict(route: TomTomRoute) -> dict:
        return {
            "eta": route.eta,
            "geometry": route.geometry,
            "traffic_delay": route.traffic_delay,
        }
