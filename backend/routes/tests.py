from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .services import planner, risk
from .services.geo import cumulative_miles, haversine, interpolate, interpolate_value, offset, overlap_fraction, sample_every


class RiskRuleTests(SimpleTestCase):
    def test_wind_bands(self):
        self.assertEqual([risk.wind_level(v) for v in (0, 24.9, 25, 34.9, 35, 44.9, 45, 54.9, 55, 80)],
                         [0, 0, 1, 1, 2, 2, 3, 3, 4, 4])

    def test_rain_bands(self):
        self.assertEqual([risk.rain_level(v) for v in (0, 0.09, 0.10, 0.24, 0.25, 0.49, 0.50, 1.00, 1.01)],
                         [0, 0, 1, 1, 2, 2, 3, 3, 4])

    def test_snow_bands(self):
        self.assertEqual([risk.snow_level(v) for v in (0, 0.4, 0.5, 0.9, 1.0, 1.9, 2.0, 3.0, 3.1)],
                         [0, 0, 1, 1, 2, 2, 3, 3, 4])

    def test_worst_condition_wins(self):
        self.assertEqual(risk.classify(10, 0.3, 0, 10000)[0], risk.HIGH)
        self.assertEqual(risk.classify(30, 0.0, 2.5, 10000)[0], risk.SEVERE)

    def test_load_rules(self):
        self.assertEqual(risk.classify(55, 0, 0, 0)[0], risk.NO_TRAVEL)                 # any load
        self.assertEqual(risk.classify(50, 0, 0, 30000)[0], risk.SEVERE)                # not over 30,000
        self.assertEqual(risk.classify(50, 0, 0, 30001)[0], risk.NO_TRAVEL)             # heavy load
        self.assertEqual(risk.classify(40, 0, 0, 40000)[0], risk.HIGH)                  # not over 40,000
        self.assertEqual(risk.classify(40, 0, 0, 40001)[0], risk.SEVERE)                # heavy load
        self.assertEqual(risk.classify(40, 2.0, 0, 40001)[0], risk.NO_TRAVEL)           # rain already worse


class GeoTests(SimpleTestCase):
    def test_sample_every_includes_end(self):
        pts = [(30.0, -97.0), (30.0, -96.0)]      # about 60 miles
        cum = cumulative_miles(pts)
        s = sample_every(pts, cum, 25)
        self.assertEqual([round(m) for m, _ in s], [0, 25, 50, round(cum[-1])])

    def test_interpolate_midpoint(self):
        pts = [(30.0, -97.0), (30.0, -96.0)]
        cum = cumulative_miles(pts)
        (lat, lon), _ = interpolate(pts, cum, cum[-1] / 2)
        self.assertAlmostEqual(lon, -96.5, places=3)

    def test_interpolate_value(self):
        self.assertEqual(interpolate_value([0, 1, 2], [0, 10, 30], 1.5), 20)
        self.assertEqual(interpolate_value([0, 1], [5, 6], -1), 5)

    def test_offset_distance(self):
        lat, lon = offset(40.0, -100.0, 90, 50)
        self.assertAlmostEqual(haversine(40.0, -100.0, lat, lon), 50, delta=0.1)

    def test_overlap_fraction(self):
        a = [(35.0, -100.0 - i * 0.1) for i in range(50)]
        b = [(35.0 + (0.5 if i > 25 else 0.0), -100.0 - i * 0.1) for i in range(50)]
        ca, cb = cumulative_miles(a), cumulative_miles(b)
        self.assertEqual(overlap_fraction(a, ca, a, ca), 1.0)
        self.assertLess(overlap_fraction(a, ca, b, cb), 0.6)


def fake_route(points, hours):
    cum = cumulative_miles(points)
    total = cum[-1]
    return {"points": points, "cum_miles": cum, "cum_hours": [hours * m / total for m in cum],
            "distance_miles": total, "duration_hours": hours}


class PlannerTests(SimpleTestCase):
    def test_checkpoints_have_increasing_etas(self):
        r = fake_route([(40.0, -100.0), (40.0, -98.0)], hours=2.0)
        dep = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
        cps = planner.build_checkpoints(r, dep, 25)
        self.assertEqual(cps[0]["mile"], 0)
        self.assertAlmostEqual(cps[-1]["mile"], r["distance_miles"], places=1)
        self.assertTrue(all(a["eta_utc"] < b["eta_utc"] for a, b in zip(cps, cps[1:])))
        self.assertAlmostEqual((cps[-1]["eta_utc"] - dep).total_seconds() / 3600, 2.0, places=3)

    def test_ranking_prefers_fewest_severe_then_high_then_time(self):
        mk = lambda nt, sev, high, avg, dur: {"no_travel_miles": nt, "severe_miles": sev, "high_miles": high,
                                             "average_risk": avg, "duration_hours": dur}
        routes = [mk(0, 10, 0, 0.5, 8), mk(0, 0, 50, 1.0, 9), mk(0, 0, 50, 1.0, 8.5), mk(5, 0, 0, 0.1, 7)]
        order = sorted(range(4), key=lambda i: planner._rank_key(routes[i]))
        self.assertEqual(order, [2, 1, 0, 3])

    def test_weather_interpolation_between_hours(self):
        t0 = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
        s = {"t0": t0, "hours": [0, 1, 2], "wind": [10, 30, 50], "gust": [0, 0, 0], "rain": [0, 0, 0],
             "snow": [0, 0, 0], "temp": [20, 20, 20], "code": [0, 0, 0]}
        self.assertAlmostEqual(planner.weather_at(s, t0 + timedelta(minutes=90))["wind_mph"], 40)
        windy = planner.weather_at(s, t0 + timedelta(minutes=90), {"wind_mph": 20, "rain_in": 0.3, "snow_in": 0})
        self.assertAlmostEqual(windy["wind_mph"], 60)
        self.assertAlmostEqual(windy["rain_in"], 0.3)


class ApiTests(SimpleTestCase):
    @patch("routes.services.planner.fetch_weather")
    @patch("routes.services.planner.find_routes")
    @patch("routes.services.external.timezone_at", return_value="America/Chicago")
    @patch("routes.services.external.geocode")
    def test_plan_endpoint(self, geocode, tz, find_routes, fetch_weather):
        geocode.side_effect = lambda q: {"label": q, "lat": 41.0 if "Chicago" in q else 39.0, "lon": -87.0 if "Chicago" in q else -86.0, "timezone": None}
        a = fake_route([(41.0, -87.0), (40.0, -86.5), (39.0, -86.0)], hours=3.0)
        b = fake_route([(41.0, -87.0), (40.5, -85.5), (39.0, -86.0)], hours=3.5)
        find_routes.return_value = [a, b]
        t0 = datetime(2026, 10, 27, 13, 0, tzinfo=timezone.utc)

        def weather(keys, dep, end, stats=None):
            out = {}
            for k in keys:
                windy = k[1] > -86.2            # the eastern detour is in a gale
                out[k] = {"t0": t0, "hours": list(range(60)), "wind": [60 if windy else 10] * 60, "gust": [0] * 60,
                          "rain": [0] * 60, "snow": [0] * 60, "temp": [15] * 60, "code": [0] * 60}
            return out
        fetch_weather.side_effect = weather

        res = APIClient().post(reverse("plan"), {"origin": "Chicago, IL", "destination": "Indy", "departure": "2026-10-27T08:00",
                                                 "load_lbs": 35000, "interval_miles": 25}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["timezone"], "America/Chicago")
        self.assertEqual(body["departure_utc"], "2026-10-27T13:00:00Z")
        self.assertEqual(len(body["routes"]), 2)
        rec = [r for r in body["routes"] if r["recommended"]][0]
        self.assertEqual(rec["name"], "Route A")
        other = [r for r in body["routes"] if not r["recommended"]][0]
        self.assertGreater(other["summary"]["no_travel_miles"], 0)
        self.assertFalse(other["summary"]["drivable"])
        self.assertIn("No Travel", body["recommendation"])
        self.assertEqual(body["heatmap"]["hours"], 48)
        self.assertEqual(len(body["heatmap"]["levels"]), 49)

    def test_validation(self):
        res = APIClient().post(reverse("plan"), {"origin": "A"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("destination", res.json()["errors"])
