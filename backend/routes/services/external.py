"""Outbound calls: geocoding (Open-Meteo place index, Nominatim), routing (OSRM) and
weather (Open-Meteo). All free, no keys. Results are cached in the process cache."""
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor

import requests
from django.conf import settings
from django.core.cache import cache

from .geo import cumulative_miles

CFG = settings.ROUTING
UA = {"User-Agent": CFG["USER_AGENT"]}
LATLON = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")
CITY_STATE = re.compile(r"^\s*([A-Za-z .'\-]+?)\s*,\s*([A-Za-z]{2})\s*(?:,\s*USA?)?\s*$")
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


class ExternalError(Exception):
    pass


_session = requests.Session()
_session.headers.update(UA)


def _get(url, params, timeout=None):
    import time
    try:
        for wait in (0, 3, 8):                        # Open-Meteo's per-minute limit: back off and retry
            if wait:
                time.sleep(wait)
            r = _session.get(url, params=params, timeout=timeout or CFG["HTTP_TIMEOUT"])
            if r.status_code != 429:
                break
        if r.status_code == 429:
            raise ExternalError("the weather service is busy (rate limit reached); please try again in a minute")
        r.raise_for_status()
        return r.json()
    except (requests.RequestException, ValueError) as e:
        raise ExternalError(f"{url.split('/')[2]} failed: {str(e)[:120]}") from e


def _ckey(prefix, *parts):
    return prefix + ":" + hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()


# ----------------------------------------------------------------------------- geocoding
def geocode(query):
    """{"label", "lat", "lon", "timezone" (may be None)} for a US place, address or 'lat,lon'."""
    m = LATLON.match(query)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if not (18.0 <= lat <= 72.0 and -180.0 <= lon <= -65.0):
            raise ExternalError(f"{query!r} is not inside the United States")
        return {"label": f"{lat:.4f}, {lon:.4f}", "lat": lat, "lon": lon, "timezone": None}

    key = _ckey("geocode", query.strip().lower())
    hit = cache.get(key)
    if hit:
        return hit
    out = None
    m = CITY_STATE.match(query)
    if m and m.group(2).upper() in STATE_NAMES:
        want = STATE_NAMES[m.group(2).upper()]
        data = _get(CFG["PLACES_URL"], {"name": m.group(1), "countryCode": "US", "count": 10})
        for res in data.get("results") or []:
            if res.get("admin1") == want:
                out = {"label": f"{res['name']}, {want}", "lat": res["latitude"], "lon": res["longitude"],
                       "timezone": res.get("timezone")}
                break
    if out is None:
        results = _get(CFG["NOMINATIM_URL"], {"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "us"})
        if not results:
            raise ExternalError(f"could not find {query!r} in the United States")
        res = results[0]
        if not re.search(r"\d", query) and res.get("addresstype") in ("road", "house", "building", "residential"):
            raise ExternalError(f"could not find {query!r} in the United States")
        out = {"label": res.get("display_name", query), "lat": float(res["lat"]), "lon": float(res["lon"]), "timezone": None}
    cache.set(key, out, CFG["GEOCODE_CACHE_SECONDS"])
    return out


def suggest(query, limit=6):
    """Place suggestions for the form's autocomplete (US only)."""
    data = _get(CFG["PLACES_URL"], {"name": query, "countryCode": "US", "count": limit})
    out = []
    for res in data.get("results") or []:
        admin = res.get("admin1") or ""
        out.append({"label": f"{res['name']}, {admin}" if admin else res["name"], "lat": res["latitude"], "lon": res["longitude"]})
    return out


def timezone_at(lat, lon):
    """IANA time zone name for a point (Open-Meteo resolves it for free)."""
    key = _ckey("tz", f"{lat:.2f}", f"{lon:.2f}")
    hit = cache.get(key)
    if hit:
        return hit
    data = _get(CFG["WEATHER_URL"], {"latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 1})
    tz = data.get("timezone") or "UTC"
    cache.set(key, tz, CFG["GEOCODE_CACHE_SECONDS"])
    return tz


# ------------------------------------------------------------------------------- routing
def _parse_route(rt):
    """OSRM route -> points, cumulative miles and hours per point (from per-segment annotations)."""
    points = [(lat, lon) for lon, lat in rt["geometry"]["coordinates"]]
    dist, dur = [0.0], [0.0]
    for leg in rt.get("legs", []):
        ann = leg.get("annotation") or {}
        for d, t in zip(ann.get("distance", []), ann.get("duration", [])):
            dist.append(dist[-1] + d / 1609.344)
            dur.append(dur[-1] + t / 3600.0)
    if len(dist) != len(points):
        # annotations did not line up with the geometry: fall back to distance-proportional time
        dist = cumulative_miles(points)
        total = dist[-1] or 1.0
        dur = [rt["duration"] / 3600.0 * d / total for d in dist]
    return {"points": points, "cum_miles": dist, "cum_hours": dur,
            "distance_miles": rt["distance"] / 1609.344, "duration_hours": rt["duration"] / 3600.0}


def osrm_routes(coords, alternatives=True):
    """One OSRM call. coords: [(lat, lon), ...] origin, optional via points, destination.
    Returns a list of parsed routes (several when alternatives exist)."""
    path = ";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in coords)
    key = _ckey("osrm", path, alternatives)
    hit = cache.get(key)
    if hit:
        return hit
    data = _get(f"{CFG['OSRM_URL']}/route/v1/driving/{path}", {
        "alternatives": "3" if alternatives else "false", "overview": "full", "geometries": "geojson",
        "steps": "false", "annotations": "distance,duration", "continue_straight": "default",
    })
    if data.get("code") != "Ok" or not data.get("routes"):
        raise ExternalError(f"routing service could not find a road route ({data.get('code')})")
    out = [_parse_route(rt) for rt in data["routes"]]
    cache.set(key, out, CFG["ROUTE_CACHE_SECONDS"])
    return out


# ------------------------------------------------------------------------------- weather
HOURLY = "temperature_2m,wind_speed_10m,wind_gusts_10m,rain,snowfall,weather_code"


def _weather_chunk(points, start_hour, end_hour):
    data = _get(CFG["WEATHER_URL"], {
        "latitude": ",".join(f"{lat:.4f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.4f}" for _, lon in points),
        "hourly": HOURLY, "wind_speed_unit": "mph", "precipitation_unit": "inch", "timezone": "UTC",
        "start_hour": start_hour, "end_hour": end_hour,
    }, timeout=45)
    if isinstance(data, dict):
        data = [data]
    out = []
    for loc in data:
        h = loc["hourly"]
        snow_unit = (loc.get("hourly_units") or {}).get("snowfall", "inch")
        snow = h.get("snowfall") or []
        if snow_unit == "cm":
            snow = [v / 2.54 if v is not None else None for v in snow]
        out.append({
            "time": h["time"],
            "temp": h.get("temperature_2m") or [],
            "wind": h.get("wind_speed_10m") or [],
            "gust": h.get("wind_gusts_10m") or [],
            "rain": h.get("rain") or [],
            "snow": snow,
            "code": h.get("weather_code") or [],
        })
    return out


def weather_for(points, start_hour, end_hour):
    """Hourly weather for many points in a few parallel batched calls.
    start_hour/end_hour: 'YYYY-MM-DDTHH:00' in UTC. Returns a list aligned with `points`."""
    key = _ckey("wx", json.dumps([points, start_hour, end_hour]))
    hit = cache.get(key)
    if hit:
        return hit
    size = CFG["WEATHER_BATCH_SIZE"]
    chunks = [points[i:i + size] for i in range(0, len(points), size)]
    with ThreadPoolExecutor(max_workers=CFG["WEATHER_PARALLEL"]) as ex:
        results = list(ex.map(lambda c: _weather_chunk(c, start_hour, end_hour), chunks))
    out = [loc for chunk in results for loc in chunk]
    cache.set(key, out, CFG["WEATHER_CACHE_SECONDS"])
    return out
