"""OpenWeather API integration for real-time weather-based signal adjustment.

Fetches current conditions at any lat/lng and converts them to a
weather_factor (0.0–1.0) used by the signal scoring model:
  1.0 = clear sky, no signal degradation
  0.0 = extreme weather, maximum signal degradation

Results are cached for 10 minutes per ~1 km grid cell.
"""
import os
import time
import httpx

from backend.core.logging import logger

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
_BASE_URL = "https://api.openweathermap.org/data/2.5/weather"
_CACHE_TTL = 600  # 10 minutes

# Cache: (lat_2dp, lng_2dp) -> (timestamp, result_dict)
_cache: dict[tuple[float, float], tuple[float, dict]] = {}


def _id_to_factor(weather_id: int, wind_ms: float, visibility_m: int) -> float:
    """Map OpenWeather condition ID → signal impact factor (0–1)."""
    # Thunderstorm family (200–299)
    if 200 <= weather_id < 300:
        base = 0.22
    # Drizzle (300–399)
    elif 300 <= weather_id < 400:
        base = 0.80
    # Light/moderate rain (500–501)
    elif weather_id in (500, 501):
        base = 0.62
    # Heavy/extreme/freezing rain (502–511)
    elif 502 <= weather_id < 512:
        base = 0.38
    # Shower rain (520–531)
    elif 520 <= weather_id < 532:
        base = 0.52
    # Snow (600–699)
    elif 600 <= weather_id < 700:
        base = 0.55
    # Fog (741) vs other atmosphere (mist/haze/smoke)
    elif weather_id == 741:
        base = 0.48
    elif 700 <= weather_id < 800:
        base = 0.72
    # Clear sky
    elif weather_id == 800:
        base = 1.00
    # Few/scattered clouds (801–802)
    elif weather_id in (801, 802):
        base = 0.93
    # Broken/overcast clouds (803–804)
    else:
        base = 0.86

    # Wind penalty: signal degrades above 10 m/s (36 km/h gale)
    wind_penalty = min((max(wind_ms - 10.0, 0.0) / 40.0), 0.20)
    # Visibility penalty: atmospheric scatter below 5 km
    vis_penalty = 0.0 if visibility_m >= 5_000 else (5_000 - visibility_m) / 50_000

    return round(max(0.10, base - wind_penalty - vis_penalty), 3)


def _parse(data: dict) -> dict:
    """Extract weather details from a raw OpenWeather JSON response."""
    weather_obj = data.get("weather", [{}])[0]
    main = data.get("main", {})
    wind_ms = data.get("wind", {}).get("speed", 0.0)
    vis = data.get("visibility", 10_000)
    weather_id = weather_obj.get("id", 800)
    factor = _id_to_factor(weather_id, wind_ms, vis)

    if factor >= 0.90:
        impact = "No impact on signal"
    elif factor >= 0.75:
        impact = "Minor signal reduction"
    elif factor >= 0.55:
        impact = "Moderate signal reduction"
    elif factor >= 0.35:
        impact = "Significant signal reduction"
    else:
        impact = "Severe signal reduction"

    return {
        "condition": weather_obj.get("main", "Clear"),
        "description": weather_obj.get("description", "clear sky").capitalize(),
        "icon": weather_obj.get("icon", "01d"),
        "temperature_c": round(main.get("temp", 28.0), 1),
        "humidity_pct": int(main.get("humidity", 60)),
        "wind_speed_ms": round(wind_ms, 1),
        "visibility_m": vis,
        "weather_factor": factor,
        "signal_impact": impact,
        "weather_id": weather_id,
        "source": "openweather",
    }


_FALLBACK = {
    "condition": "Clear",
    "description": "Clear sky",
    "icon": "01d",
    "temperature_c": 28.0,
    "humidity_pct": 60,
    "wind_speed_ms": 0.0,
    "visibility_m": 10_000,
    "weather_factor": 1.0,
    "signal_impact": "No impact on signal",
    "weather_id": 800,
    "source": "fallback",
}
_FALLBACK_TTL = 60  # retry a failing API at most once a minute per location


async def get_weather(lat: float, lng: float) -> dict:
    """Return current weather info for (lat, lng).

    Hits OpenWeather API (10-min cache).  Falls back to clear-weather
    defaults on any network / API error so routing is never blocked.
    """
    key = (round(lat, 2), round(lng, 2))
    now = time.time()

    ts, cached = _cache.get(key, (0.0, None))
    if cached is not None and now - ts < _CACHE_TTL:
        return cached

    if OPENWEATHER_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    _BASE_URL,
                    params={"lat": lat, "lon": lng, "appid": OPENWEATHER_API_KEY, "units": "metric"},
                )
            if resp.status_code == 200:
                result = _parse(resp.json())
                _cache[key] = (now, result)
                return result
            # Never log the URL: it carries the API key
            logger.warning("OpenWeather returned HTTP %s; using neutral weather", resp.status_code)
        except Exception as exc:
            logger.warning("OpenWeather request failed (%s); using neutral weather", type(exc).__name__)

    # Cache the fallback briefly so a bad key doesn't cost a request per call
    _cache[key] = (now - _CACHE_TTL + _FALLBACK_TTL, dict(_FALLBACK))
    return dict(_FALLBACK)
