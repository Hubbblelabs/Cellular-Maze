"""Tests for TomTomClient -- no real API calls."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.routing.tomtom_client import (
    TomTomClient,
    TomTomRoute,
    _generate_mock_routes,
    _parse_routes,
)

# -----------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------

ORIGIN = (12.9716, 77.5946)
DESTINATION = (12.8399, 77.6670)

SAMPLE_TOMTOM_RESPONSE = {
    "routes": [
        {
            "summary": {
                "travelTimeInSeconds": 1800,
                "trafficDelayInSeconds": 120,
                "lengthInMeters": 18500,
            },
            "legs": [
                {
                    "points": [
                        {"latitude": 12.9716, "longitude": 77.5946},
                        {"latitude": 12.9500, "longitude": 77.6100},
                        {"latitude": 12.9200, "longitude": 77.6350},
                        {"latitude": 12.8399, "longitude": 77.6670},
                    ]
                }
            ],
        },
        {
            "summary": {
                "travelTimeInSeconds": 2100,
                "trafficDelayInSeconds": 300,
                "lengthInMeters": 21000,
            },
            "legs": [
                {
                    "points": [
                        {"latitude": 12.9716, "longitude": 77.5946},
                        {"latitude": 12.9600, "longitude": 77.5800},
                        {"latitude": 12.9100, "longitude": 77.6200},
                        {"latitude": 12.8700, "longitude": 77.6500},
                        {"latitude": 12.8399, "longitude": 77.6670},
                    ]
                }
            ],
        },
        {
            "summary": {
                "travelTimeInSeconds": 2400,
                "trafficDelayInSeconds": 180,
                "lengthInMeters": 23000,
            },
            "legs": [
                {
                    "points": [
                        {"latitude": 12.9716, "longitude": 77.5946},
                        {"latitude": 12.9300, "longitude": 77.6000},
                        {"latitude": 12.8399, "longitude": 77.6670},
                    ]
                }
            ],
        },
    ]
}


@pytest.fixture
def client() -> TomTomClient:
    return TomTomClient(api_key="test-key", base_url="https://api.tomtom.com")


def _mock_response(json_data: dict, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json=json_data,
        request=httpx.Request("GET", "https://api.tomtom.com/routing/1/calculateRoute/test/json"),
    )


# -----------------------------------------------------------------------
# 1. Successful API response
# -----------------------------------------------------------------------


class TestSuccessfulResponse:
    @pytest.mark.asyncio
    async def test_returns_parsed_routes(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            return_value=_mock_response(SAMPLE_TOMTOM_RESPONSE)
        )
        mock_http.is_closed = False

        client._client = mock_http

        routes = await client.get_routes(ORIGIN, DESTINATION)

        assert len(routes) == 3
        assert routes[0]["eta"] == 30.0  # 1800s / 60
        assert routes[0]["traffic_delay"] == 2.0  # 120s / 60
        assert routes[1]["eta"] == 35.0  # 2100s / 60
        assert routes[1]["traffic_delay"] == 5.0  # 300s / 60

    @pytest.mark.asyncio
    async def test_api_called_with_correct_params(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            return_value=_mock_response(SAMPLE_TOMTOM_RESPONSE)
        )
        mock_http.is_closed = False

        client._client = mock_http

        await client.get_routes(ORIGIN, DESTINATION)

        mock_http.get.assert_called_once()
        call_args = mock_http.get.call_args
        url = call_args[0][0]
        params = call_args[1]["params"]

        assert "12.9716,77.5946:12.8399,77.667" in url
        assert params["key"] == "test-key"
        assert params["maxAlternatives"] == "5"
        assert params["traffic"] == "true"


# -----------------------------------------------------------------------
# 2. API failure -> fallback
# -----------------------------------------------------------------------


class TestFallbackOnFailure:
    @pytest.mark.asyncio
    async def test_returns_mock_routes_on_http_error(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        mock_http.is_closed = False

        client._client = mock_http

        routes = await client.get_routes(ORIGIN, DESTINATION)

        # Fallback returns 7 mock routes
        assert len(routes) == 7
        for r in routes:
            assert "eta" in r
            assert "geometry" in r
            assert "traffic_delay" in r
            assert r["eta"] > 0

    @pytest.mark.asyncio
    async def test_returns_mock_routes_on_timeout(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            side_effect=httpx.ReadTimeout("Read timed out")
        )
        mock_http.is_closed = False

        client._client = mock_http

        routes = await client.get_routes(ORIGIN, DESTINATION)
        assert len(routes) == 7

    @pytest.mark.asyncio
    async def test_retries_once_before_fallback(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        mock_http.is_closed = False

        client._client = mock_http

        await client.get_routes(ORIGIN, DESTINATION)

        # Should have been called exactly 2 times (1 initial + 1 retry)
        assert mock_http.get.call_count == 2

    @pytest.mark.asyncio
    async def test_returns_real_on_retry_success(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            side_effect=[
                httpx.ConnectError("Connection refused"),
                _mock_response(SAMPLE_TOMTOM_RESPONSE),
            ]
        )
        mock_http.is_closed = False

        client._client = mock_http

        routes = await client.get_routes(ORIGIN, DESTINATION)
        assert len(routes) == 3  # real data, not fallback
        assert routes[0]["eta"] == 30.0

    @pytest.mark.asyncio
    async def test_fallback_on_non_200(self, client: TomTomClient):
        error_response = _mock_response(
            {"detailedError": {"code": "INVALID_KEY", "message": "Unauthorized"}},
            status_code=403,
        )
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(return_value=error_response)
        mock_http.is_closed = False

        client._client = mock_http

        routes = await client.get_routes(ORIGIN, DESTINATION)
        assert len(routes) == 7  # fallback


# -----------------------------------------------------------------------
# 3. Geometry parsing
# -----------------------------------------------------------------------


class TestGeometryParsing:
    def test_parse_routes_extracts_points(self):
        routes = _parse_routes(SAMPLE_TOMTOM_RESPONSE)

        assert len(routes) == 3

        first = routes[0]
        assert len(first.geometry) == 4
        assert first.geometry[0] == {"lat": 12.9716, "lng": 77.5946}
        assert first.geometry[-1] == {"lat": 12.8399, "lng": 77.6670}

    def test_parse_routes_multi_leg(self):
        data = {
            "routes": [
                {
                    "summary": {
                        "travelTimeInSeconds": 600,
                        "trafficDelayInSeconds": 0,
                    },
                    "legs": [
                        {
                            "points": [
                                {"latitude": 10.0, "longitude": 20.0},
                                {"latitude": 10.5, "longitude": 20.5},
                            ]
                        },
                        {
                            "points": [
                                {"latitude": 10.5, "longitude": 20.5},
                                {"latitude": 11.0, "longitude": 21.0},
                            ]
                        },
                    ],
                }
            ]
        }
        routes = _parse_routes(data)
        assert len(routes) == 1
        # Points from both legs concatenated
        assert len(routes[0].geometry) == 4

    def test_parse_empty_response(self):
        assert _parse_routes({}) == []
        assert _parse_routes({"routes": []}) == []

    def test_eta_conversion(self):
        routes = _parse_routes(SAMPLE_TOMTOM_RESPONSE)
        assert routes[0].eta == 30.0
        assert routes[1].eta == 35.0
        assert routes[2].eta == 40.0

    def test_traffic_delay_conversion(self):
        routes = _parse_routes(SAMPLE_TOMTOM_RESPONSE)
        assert routes[0].traffic_delay == 2.0
        assert routes[1].traffic_delay == 5.0
        assert routes[2].traffic_delay == 3.0


# -----------------------------------------------------------------------
# 4. Multiple routes handled
# -----------------------------------------------------------------------


class TestMultipleRoutes:
    @pytest.mark.asyncio
    async def test_all_routes_have_required_keys(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            return_value=_mock_response(SAMPLE_TOMTOM_RESPONSE)
        )
        mock_http.is_closed = False
        client._client = mock_http

        routes = await client.get_routes(ORIGIN, DESTINATION)
        for r in routes:
            assert set(r.keys()) == {"eta", "geometry", "traffic_delay"}
            assert isinstance(r["eta"], float)
            assert isinstance(r["traffic_delay"], float)
            assert isinstance(r["geometry"], list)
            assert len(r["geometry"]) >= 2

    @pytest.mark.asyncio
    async def test_routes_sorted_by_eta(self, client: TomTomClient):
        mock_http = AsyncMock(spec=httpx.AsyncClient)
        mock_http.get = AsyncMock(
            return_value=_mock_response(SAMPLE_TOMTOM_RESPONSE)
        )
        mock_http.is_closed = False
        client._client = mock_http

        routes = await client.get_routes(ORIGIN, DESTINATION)
        etas = [r["eta"] for r in routes]
        # TomTom returns routes in decreasing optimality (fastest first)
        assert etas == sorted(etas)


# -----------------------------------------------------------------------
# 5. Mock fallback generator
# -----------------------------------------------------------------------


class TestMockFallback:
    def test_generates_seven_routes(self):
        routes = _generate_mock_routes(ORIGIN, DESTINATION)
        assert len(routes) == 7

    def test_geometry_starts_and_ends_correctly(self):
        routes = _generate_mock_routes(ORIGIN, DESTINATION)
        for r in routes:
            assert r.geometry[0]["lat"] == ORIGIN[0]
            assert r.geometry[0]["lng"] == ORIGIN[1]
            assert r.geometry[-1]["lat"] == DESTINATION[0]
            assert r.geometry[-1]["lng"] == DESTINATION[1]

    def test_second_route_slower(self):
        routes = _generate_mock_routes(ORIGIN, DESTINATION)
        assert routes[1].eta > routes[0].eta

    def test_traffic_delay_positive(self):
        routes = _generate_mock_routes(ORIGIN, DESTINATION)
        for r in routes:
            assert r.traffic_delay > 0


# -----------------------------------------------------------------------
# 6. Lifecycle
# -----------------------------------------------------------------------


class TestLifecycle:
    @pytest.mark.asyncio
    async def test_startup_creates_client(self):
        client = TomTomClient(api_key="k")
        assert client._client is None

        await client.startup()
        assert client._client is not None
        assert not client._client.is_closed

        await client.shutdown()
        assert client._client is None

    @pytest.mark.asyncio
    async def test_shutdown_idempotent(self):
        client = TomTomClient(api_key="k")
        await client.shutdown()  # no-op when not started
        await client.startup()
        await client.shutdown()
        await client.shutdown()  # second call is safe
