# Weather-Aware Truck Routing

A React + Django web app that helps a truck driver choose the safest route. Enter an
origin, a destination, a departure time and the load weight; the app finds three routes,
samples the weather forecast along each one at the time the truck will actually be there,
scores every checkpoint with the given risk and load rules, recommends the best route, and
shows everything on a map with a 0 to 48 hour corridor risk heatmap.

Built for the Spotter AI full-stack assessment.

**Live:** see the link in the submission. **Stack:** Django 6 + Django REST Framework,
React 19 + TypeScript + Vite, Leaflet. Routing by OSRM, weather by Open-Meteo, geocoding by
Open-Meteo's place index and Nominatim. All free, no API keys.

## How it works

1. **Geocoding.** Origin and destination are resolved to coordinates (US only). The
   origin's time zone is resolved too, so "depart 08:00" means 08:00 at the origin.
2. **Three routes.** One OSRM call asks for alternatives. OSRM often returns only one or
   two, so the app also routes through points pushed 12 to 90 miles sideways from the
   middle of the fastest route (four candidates, fetched in parallel) and keeps the ones
   that are genuinely different (less than 75 % overlap with routes already kept, and no
   more than 1.7 times the fastest time). Routes come back with per-segment durations, so
   the ETA at any point along the road is known.
3. **Checkpoints.** Every 10, 25 or 50 miles (plus the destination), each with its ETA.
4. **Weather.** One batched Open-Meteo request set (100 locations per call, in parallel)
   returns hourly wind, gusts, rain, snowfall, temperature and conditions for every
   checkpoint and every heatmap point, from departure to the end of the longest route plus
   48 hours. Values at the exact ETA are linearly interpolated between the hourly samples.
   Points within about 3 miles of each other share one forecast, so the parts of the three
   routes that overlap cost nothing extra.
5. **Risk.** At each checkpoint the wind, rain and snow bands give a level (Low, Moderate,
   High, Severe, No Travel); the worst one wins; then the load rules apply. Each checkpoint
   owns the stretch of road halfway to its neighbours, which gives miles per risk level.
6. **Recommendation.** Routes are ranked by fewest No Travel miles, then fewest Severe
   miles, then fewest High miles, then lowest distance-weighted average risk, then shortest
   time. (No Travel is treated as worse than Severe, since those miles cannot be driven.)
7. **Heatmap.** For every forecast point the risk level is computed for each of the 48
   hours after departure. The slider recolours the corridor instantly; nothing is fetched
   again.

A typical plan takes 3 to 6 seconds, almost all of it waiting on the free routing and
weather servers; the computation itself takes well under half a second.

### Risk rules (from the brief)

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind | < 25 mph | 25 to 34 | 35 to 44 | 45 to 54 | >= 55 mph |
| Rain | < 0.10 in/h | 0.10 to 0.25 | 0.25 to 0.50 | 0.50 to 1.00 | > 1.00 |
| Snow | < 0.5 in/h | 0.5 to 1.0 | 1.0 to 2.0 | 2.0 to 3.0 | > 3.0 |

Load rules: wind >= 55 mph is No Travel for any load; wind 45 to 54 mph with a load over
30,000 lb is No Travel; wind 35 to 44 mph with a load over 40,000 lb is Severe. Where two
bands meet, the boundary value belongs to the higher band (0.25 in/h of rain is High) and
the Severe band keeps its upper edge (1.00 in/h is Severe). See `backend/routes/services/risk.py`.

## Run it locally

Backend (Python 3.12+):

```bash
python -m venv .venv
.venv\Scripts\activate                 # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cd backend
python manage.py runserver 8001
```

Frontend (Node 20+), in a second terminal:

```bash
cd frontend
npm install
npm run dev                            # http://localhost:5173, proxies /api to port 8001
```

Tests: `cd backend && python manage.py test` (risk rules, geometry, checkpoints, ranking,
weather interpolation, and the endpoint with mocked services).

## API

`POST /api/plan`

```json
{ "origin": "Denver, CO", "destination": "Seattle, WA", "departure": "2026-10-27T08:00",
  "load_lbs": 35000, "interval_miles": 25, "heatmap": true }
```

Response (trimmed):

```json
{
  "origin": {"label": "Denver, Colorado", "lat": 39.74, "lon": -104.98},
  "destination": {"label": "Seattle, Washington", "lat": 47.6, "lon": -122.33},
  "departure_utc": "2026-10-27T14:00:00Z", "timezone": "America/Denver",
  "routes": [
    {"id": 0, "name": "Route A", "rank": 1, "recommended": true,
     "geometry": [[39.74, -104.98], ...],
     "summary": {"distance_miles": 1303.1, "duration_hours": 22.66, "no_travel_miles": 0, "severe_miles": 0,
                 "high_miles": 48.2, "moderate_miles": 120.5, "low_miles": 1134.4, "average_risk": 0.17,
                 "max_level": 2, "max_level_name": "High", "drivable": true},
     "checkpoints": [{"mile": 25, "lat": 40.1, "lon": -105.1, "eta_local": "Mon 08:32", "wind_mph": 7.6,
                      "gust_mph": 14.5, "rain_in": 0, "snow_in": 0, "temp_f": 43, "condition": "Overcast",
                      "level": 0, "level_name": "Low", "driver": "wind 8 mph"}, ...]}
  ],
  "heatmap": {"points": [[lat, lon], ...], "hours": 48, "levels": [[0, 0, 1, ...], ...]},
  "recommendation": "Route A: 1303.1 mi, 22.66 h, worst conditions High, ...",
  "rules": {...}, "weather_points": 350, "timing_ms": {"geocode_ms": 160, "routing_ms": 2100, "weather_ms": 1400, "assess_ms": 120}
}
```

`GET /api/geocode?q=Den` returns place suggestions for the form. `GET /api/health` returns `{"ok": true}`.

Errors: `400` with field errors, `404` when a place is not found in the US, `502` when a
free service is down or rate-limited (the message says which).

## Project layout

```
api/index.py                  Vercel entry: Django served as one Python function
backend/
  config/settings.py          no database; caches; service URLs
  routes/views.py             PlanView, GeocodeView
  routes/services/external.py geocoding, OSRM, batched Open-Meteo (all cached)
  routes/services/planner.py  routes + detours, checkpoints, weather at ETA, assessment, ranking, heatmap
  routes/services/risk.py     the risk and load rules
  routes/services/geo.py      haversine, interpolation, sampling, overlap test
  routes/tests.py
frontend/src/
  App.tsx                     state and layout
  components/PlanForm.tsx     form with place suggestions, load presets, 10/25/50 mi switch
  components/RouteCard.tsx    summary, miles-by-level bar, recommended tag
  components/CheckpointList.tsx
  components/MapView.tsx      routes, colour-coded checkpoints, popups, fit/fly
  components/HeatCorridor.tsx blurred canvas discs recoloured per slider hour
  components/ForecastSlider.tsx  0-48 h slider with play
vercel.json                   static build + /api -> Python function
```

## Design notes and limits

- The weather heatmap is drawn as soft discs on a blurred canvas pane, one per forecast
  point, recoloured when the slider moves. It stays smooth because moving the slider never
  touches the network or recreates layers.
- Open-Meteo's free tier is rate-limited per minute. The app keeps the number of forecast
  points per plan modest (a few hundred), merges nearby points, caches results for 15
  minutes, and retries with back-off; if the limit is still hit it says so.
- The public OSRM demo server is used for routing; it is fine for a demo but not for
  production traffic. `OSRM_URL` and `WEATHER_URL` can point at your own instances.
- Forecasts are available up to 16 days ahead; departures are accepted up to 10 days ahead.
- Checkpoint ETAs assume continuous driving at OSRM's estimated speeds (no rest breaks).
