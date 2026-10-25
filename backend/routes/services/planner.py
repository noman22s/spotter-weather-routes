"""From two places, a departure time and a load to three assessed routes and a heatmap.

Steps:
  1. routes:      OSRM alternatives; when it returns fewer than three, route via a point
                  pushed sideways from the middle of the fastest route and keep the ones
                  that are genuinely different.
  2. checkpoints: every N miles along each route, with the ETA from OSRM's per-segment
                  durations.
  3. weather:     one batched Open-Meteo fetch for every checkpoint and heatmap point,
                  hourly, from departure to the end of the longest trip plus 48 hours.
  4. risk:        the assessment's rules at each checkpoint, using the weather interpolated
                  to the ETA; miles per risk level per route; ranking.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from django.conf import settings

from . import external, risk
from .geo import (bearing, cumulative_miles, interpolate, interpolate_value, offset, overlap_fraction,
                  sample_every, simplify)

CFG = settings.ROUTING
ROUTE_NAMES = ["Route A", "Route B", "Route C"]
WEATHER_CODES = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Icy fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Rain showers",
    81: "Rain showers", 82: "Violent showers", 85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
}


# --------------------------------------------------------------------------------- routes
def find_routes(origin, destination, want=3):
    """Up to `want` distinct driving routes between two points (OSRM alternatives first,
    then detours via side points)."""
    o, d = (origin["lat"], origin["lon"]), (destination["lat"], destination["lon"])
    routes = external.osrm_routes([o, d], alternatives=True)
    base = routes[0]
    kept = [base]
    for r in routes[1:]:
        if _is_new(r, kept):
            kept.append(r)
    if len(kept) < want:
        # detours: push the midpoint of the fastest route sideways and route through it;
        # the four candidates are fetched in parallel and kept only if genuinely different
        total = base["cum_miles"][-1]
        mid, _ = interpolate(base["points"], base["cum_miles"], total / 2)
        heading = bearing(*o, *d)
        vias = [offset(mid[0], mid[1], heading + turn, max(10.0, min(90.0, total * frac)))
                for frac in (0.12, 0.22, 0.35) for turn in (90, -90)]

        def via_route(v):
            try:
                return external.osrm_routes([o, v, d], alternatives=False)[0]
            except external.ExternalError:
                return None

        with ThreadPoolExecutor(max_workers=6) as ex:
            candidates = list(ex.map(via_route, vias))
        candidates = sorted((c for c in candidates if c), key=lambda r: r["duration_hours"])
        # strict pass first (clearly different, not much slower); relax for trips with one
        # obvious highway (e.g. Reno to Sacramento over Donner Pass), where the only other
        # roads are much longer but are exactly what matters when the pass closes
        for max_overlap, max_slower in ((0.75, 1.7), (0.9, 2.5)):
            for alt in candidates:
                if len(kept) >= want:
                    break
                if alt["duration_hours"] <= base["duration_hours"] * max_slower and _is_new(alt, kept, max_overlap):
                    kept.append(alt)
    kept.sort(key=lambda r: r["duration_hours"])
    return kept[:want]


def _is_new(route, kept, max_overlap=0.75):
    return all(overlap_fraction(route["points"], route["cum_miles"], k["points"], k["cum_miles"]) < max_overlap
               for k in kept)


# ---------------------------------------------------------------------------- checkpoints
def build_checkpoints(route, departure_utc, interval_miles):
    out = []
    for mile, (lat, lon) in sample_every(route["points"], route["cum_miles"], interval_miles):
        hours = interpolate_value(route["cum_miles"], route["cum_hours"], mile)
        out.append({"mile": round(mile, 1), "lat": lat, "lon": lon,
                    "eta_utc": departure_utc + timedelta(hours=hours), "hours_from_departure": hours})
    return out


def heatmap_points(routes, step_miles=20.0, side_miles=(12.0,), side_every=40.0, cap=None):
    """Corridor points: along every route plus parallel lines either side of the fastest
    route. Kept sparse on purpose (the checkpoints themselves are added to the heatmap too)
    because every point is a weighted call against the weather API's free quota."""
    pts = []
    for r in routes:
        pts += [pt for _, pt in sample_every(r["points"], r["cum_miles"], step_miles)]
    base = routes[0]
    for mile, (lat, lon) in sample_every(base["points"], base["cum_miles"], side_every):
        nxt, _ = interpolate(base["points"], base["cum_miles"], min(mile + 5, base["cum_miles"][-1]))
        prev, _ = interpolate(base["points"], base["cum_miles"], max(mile - 5, 0))
        head = bearing(prev[0], prev[1], nxt[0], nxt[1])
        for s in side_miles:
            pts.append(offset(lat, lon, head + 90, s))
            pts.append(offset(lat, lon, head - 90, s))
    cap = cap or CFG["MAX_WEATHER_POINTS"]
    if len(pts) > cap:
        stride = len(pts) / cap
        pts = [pts[int(i * stride)] for i in range(cap)]
    return pts


def _key(lat, lon):
    """Forecast cell of 0.1 degree (about 7 miles): points inside one cell share a forecast.
    The weather models behind the forecast are 3 to 25 km grids, so nothing is lost, and
    the overlapping parts of the three routes cost nothing extra against the API quota."""
    return (round(lat * 10) / 10, round(lon * 10) / 10)


# -------------------------------------------------------------------------------- weather
def fetch_weather(unique_keys, departure_utc, end_utc, stats=None):
    start = departure_utc.replace(minute=0, second=0, microsecond=0)
    points = [(k[0], k[1]) for k in unique_keys]
    data = external.weather_for(points, start.strftime("%Y-%m-%dT%H:00"), end_utc.strftime("%Y-%m-%dT%H:00"), stats)
    series = {}
    for k, loc in zip(unique_keys, data):
        times = [datetime.strptime(t, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc) for t in loc["time"]]
        hours = [(t - start).total_seconds() / 3600.0 for t in times]
        series[k] = {"t0": start, "hours": hours, **{f: _clean(loc[f]) for f in ("temp", "wind", "gust", "rain", "snow")},
                     "code": loc["code"]}
    return series


def _clean(values):
    return [0.0 if v is None else float(v) for v in values]


NO_SCENARIO = {"wind_mph": 0.0, "rain_in": 0.0, "snow_in": 0.0}


def weather_at(s, when, scenario=None):
    """Weather at an instant, linearly interpolated between the hourly values. A scenario
    (what-if offsets) is added on top of the forecast so the rules can be exercised."""
    sc = scenario or NO_SCENARIO
    h = (when - s["t0"]).total_seconds() / 3600.0
    idx = min(range(len(s["hours"])), key=lambda i: abs(s["hours"][i] - h)) if s["hours"] else 0
    return {
        "wind_mph": interpolate_value(s["hours"], s["wind"], h) + sc["wind_mph"],
        "gust_mph": interpolate_value(s["hours"], s["gust"], h) + sc["wind_mph"],
        "rain_in": interpolate_value(s["hours"], s["rain"], h) + sc["rain_in"],
        "snow_in": interpolate_value(s["hours"], s["snow"], h) + sc["snow_in"],
        "temp_f": interpolate_value(s["hours"], s["temp"], h) * 9 / 5 + 32,
        "condition": WEATHER_CODES.get(s["code"][idx] if s["code"] else None, ""),
    }


# ---------------------------------------------------------------------------------- plan
def plan(origin_q, destination_q, departure_local, load_lbs, interval_miles, with_heatmap=True, scenario=None):
    scenario = scenario or NO_SCENARIO
    timing = {}
    t = datetime.now()
    with ThreadPoolExecutor(max_workers=2) as ex:
        origin, destination = list(ex.map(external.geocode, [origin_q, destination_q]))
    tz_name = origin.get("timezone") or external.timezone_at(origin["lat"], origin["lon"])
    tz = ZoneInfo(tz_name)
    departure_utc = departure_local.replace(tzinfo=tz).astimezone(timezone.utc)
    timing["geocode_ms"] = _ms(t)

    t = datetime.now()
    routes = find_routes(origin, destination)
    timing["routing_ms"] = _ms(t)

    t = datetime.now()
    checkpoints = [build_checkpoints(r, departure_utc, interval_miles) for r in routes]
    heat_pts = heatmap_points(routes) if with_heatmap else []
    keys = []
    seen = set()
    for cps in checkpoints:
        for c in cps:
            k = _key(c["lat"], c["lon"])
            if k not in seen:
                seen.add(k)
                keys.append(k)
    for lat, lon in heat_pts:
        k = _key(lat, lon)
        if k not in seen:
            seen.add(k)
            keys.append(k)
    longest = max(r["duration_hours"] for r in routes)
    end_utc = departure_utc + timedelta(hours=max(longest, CFG["HEATMAP_HOURS"]) + 2)
    stats = {}
    series = fetch_weather(keys, departure_utc, end_utc, stats)
    timing["weather_ms"] = _ms(t)
    timing["weather_retries"] = stats.get("retries", 0)
    timing["weather_cached"] = bool(stats.get("cached"))

    t = datetime.now()
    assessed = []
    for i, (r, cps) in enumerate(zip(routes, checkpoints)):
        assessed.append(_assess(r, cps, series, load_lbs, tz, i, scenario))
    order = sorted(range(len(assessed)), key=lambda i: _rank_key(assessed[i]["summary"]))
    for rank, i in enumerate(order, 1):
        assessed[i]["rank"] = rank
        assessed[i]["recommended"] = rank == 1
    heat = _heatmap(keys, series, departure_utc, load_lbs, scenario) if with_heatmap else None   # every forecast cell, checkpoints included
    timing["assess_ms"] = _ms(t)

    return {
        "origin": {"query": origin_q, "label": origin["label"], "lat": origin["lat"], "lon": origin["lon"]},
        "destination": {"query": destination_q, "label": destination["label"], "lat": destination["lat"], "lon": destination["lon"]},
        "departure_local": departure_local.strftime("%Y-%m-%dT%H:%M"),
        "departure_utc": departure_utc.isoformat().replace("+00:00", "Z"),
        "timezone": tz_name,
        "load_lbs": load_lbs,
        "interval_miles": interval_miles,
        "scenario": {**scenario, "active": any(v > 0 for v in scenario.values())},
        "routes": assessed,
        "heatmap": heat,
        "recommendation": _explain(assessed[order[0]], [assessed[i] for i in order[1:]]),
        "rules": {"wind_mph": risk.WIND_BANDS, "rain_in_per_hour": risk.RAIN_BANDS, "snow_in_per_hour": risk.SNOW_BANDS,
                  "load": ["wind >= 55 mph: No Travel for any load", "wind 45-54 mph and load > 30,000 lb: No Travel",
                           "wind 35-44 mph and load > 40,000 lb: Severe"],
                  "ranking": ["fewest No Travel miles", "fewest Severe miles", "fewest High miles", "lowest average risk", "shortest time"]},
        "weather_points": len(keys),
        "timing_ms": timing,
    }


def _assess(route, cps, series, load_lbs, tz, index, scenario=None):
    total = route["cum_miles"][-1]
    miles_by_level = [0.0] * 5
    weighted = 0.0
    out_cps = []
    worst = None
    for i, c in enumerate(cps):
        w = weather_at(series[_key(c["lat"], c["lon"])], c["eta_utc"], scenario)
        level, driver = risk.classify(w["wind_mph"], w["rain_in"], w["snow_in"], load_lbs)
        # each checkpoint owns the stretch halfway to its neighbours
        start = 0.0 if i == 0 else (cps[i - 1]["mile"] + c["mile"]) / 2
        end = total if i == len(cps) - 1 else (c["mile"] + cps[i + 1]["mile"]) / 2
        owned = max(0.0, end - start)
        miles_by_level[level] += owned
        weighted += level * owned
        cp = {
            "mile": c["mile"], "lat": round(c["lat"], 5), "lon": round(c["lon"], 5),
            "eta_utc": c["eta_utc"].isoformat().replace("+00:00", "Z"),
            "eta_local": c["eta_utc"].astimezone(tz).strftime("%a %H:%M"),
            "hours_from_departure": round(c["hours_from_departure"], 2),
            "wind_mph": round(w["wind_mph"], 1), "gust_mph": round(w["gust_mph"], 1),
            "rain_in": round(w["rain_in"], 3), "snow_in": round(w["snow_in"], 3),
            "temp_f": round(w["temp_f"]), "condition": w["condition"],
            "level": level, "level_name": risk.LEVEL_NAMES[level], "driver": driver,
        }
        out_cps.append(cp)
        if worst is None or level > worst["level"]:
            worst = cp
    summary = {
        "distance_miles": round(total, 1),
        "duration_hours": round(route["duration_hours"], 2),
        "no_travel_miles": round(miles_by_level[4], 1),
        "severe_miles": round(miles_by_level[3], 1),
        "high_miles": round(miles_by_level[2], 1),
        "moderate_miles": round(miles_by_level[1], 1),
        "low_miles": round(miles_by_level[0], 1),
        "average_risk": round(weighted / total, 3) if total else 0.0,
        "max_level": max(c["level"] for c in out_cps),
        "max_level_name": risk.LEVEL_NAMES[max(c["level"] for c in out_cps)],
        "drivable": miles_by_level[4] == 0,
        "worst_checkpoint_mile": worst["mile"] if worst else None,
    }
    return {
        "id": index, "name": ROUTE_NAMES[index] if index < len(ROUTE_NAMES) else f"Route {index + 1}",
        "geometry": [[round(lat, 5), round(lon, 5)] for lat, lon in simplify(route["points"])],
        "summary": summary, "checkpoints": out_cps,
    }


def _rank_key(s):
    return (s["no_travel_miles"], s["severe_miles"], s["high_miles"], s["average_risk"], s["duration_hours"])


def _explain(best, others):
    s = best["summary"]
    if not s["drivable"]:
        return (f"{best['name']} is the least bad option, but every route has No Travel conditions "
                f"({s['no_travel_miles']} miles on this one). Consider a later departure.")
    reasons = []
    for o in others:
        t = o["summary"]
        if t["no_travel_miles"] > 0:
            reasons.append(f"{o['name']} has {t['no_travel_miles']} No Travel miles")
        elif t["severe_miles"] > s["severe_miles"]:
            reasons.append(f"{o['name']} has {t['severe_miles']} Severe miles vs {s['severe_miles']}")
        elif t["high_miles"] > s["high_miles"]:
            reasons.append(f"{o['name']} has {t['high_miles']} High miles vs {s['high_miles']}")
        elif t["average_risk"] > s["average_risk"]:
            reasons.append(f"{o['name']} has a higher average risk ({t['average_risk']} vs {s['average_risk']})")
        elif t["duration_hours"] > s["duration_hours"]:
            reasons.append(f"{o['name']} takes {t['duration_hours'] - s['duration_hours']:.1f} h longer")
    tail = ("; ".join(reasons)) if reasons else "the alternatives are no safer and no faster"
    return (f"{best['name']}: {s['distance_miles']} mi, {s['duration_hours']} h, worst conditions {s['max_level_name']}, "
            f"{s['severe_miles']} Severe and {s['high_miles']} High miles. {tail[0].upper() + tail[1:]}.")


def _heatmap(keys, series, departure_utc, load_lbs, scenario=None):
    hours = CFG["HEATMAP_HOURS"]
    levels = []
    for h in range(hours + 1):
        when = departure_utc + timedelta(hours=h)
        row = []
        for k in keys:
            w = weather_at(series[k], when, scenario)
            row.append(risk.classify(w["wind_mph"], w["rain_in"], w["snow_in"], load_lbs)[0])
        levels.append(row)
    return {"points": [[k[0], k[1]] for k in keys], "hours": hours, "levels": levels}


def _ms(t):
    return round((datetime.now() - t).total_seconds() * 1000)
