"""Geometry helpers. Coordinates are (lat, lon) in degrees; distances are miles."""
import math

EARTH_RADIUS_MILES = 3958.7613


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(min(1.0, a)))


def cumulative_miles(points):
    out = [0.0]
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        out.append(out[-1] + haversine(lat1, lon1, lat2, lon2))
    return out


def interpolate(points, cum, target):
    """Point on the polyline at `target` miles from the start (clamped), and the segment index."""
    if target <= 0:
        return points[0], 0
    if target >= cum[-1]:
        return points[-1], len(points) - 2
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:                       # binary search for the segment containing target
        mid = (lo + hi) // 2
        if cum[mid] <= target:
            lo = mid
        else:
            hi = mid
    seg = cum[hi] - cum[lo]
    t = (target - cum[lo]) / seg if seg else 0.0
    lat = points[lo][0] + t * (points[hi][0] - points[lo][0])
    lon = points[lo][1] + t * (points[hi][1] - points[lo][1])
    return (lat, lon), lo


def interpolate_value(xs, ys, x):
    """Linear interpolation of ys over monotonic xs (clamped at the ends)."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xs[mid] <= x:
            lo = mid
        else:
            hi = mid
    span = xs[hi] - xs[lo]
    t = (x - xs[lo]) / span if span else 0.0
    return ys[lo] + t * (ys[hi] - ys[lo])


def sample_every(points, cum, step_miles, include_end=True):
    """Points every `step_miles` along the line (plus the end). Returns [(mile, (lat, lon))]."""
    total = cum[-1]
    out = []
    mile = 0.0
    while mile < total:
        pt, _ = interpolate(points, cum, mile)
        out.append((mile, pt))
        mile += step_miles
    if include_end and (not out or out[-1][0] < total):
        out.append((total, points[-1]))
    return out


def bearing(lat1, lon1, lat2, lon2):
    """Initial bearing in degrees from point 1 to point 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def offset(lat, lon, bearing_deg, miles):
    """Destination point `miles` away along `bearing_deg`."""
    d = miles / EARTH_RADIUS_MILES
    b = math.radians(bearing_deg)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def simplify(points, max_points=1200):
    """Thin a polyline evenly so responses stay small."""
    if len(points) <= max_points:
        return list(points)
    stride = len(points) / max_points
    out = [points[int(i * stride)] for i in range(max_points)]
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out


class PointGrid:
    """Buckets points into lat/lon cells for cheap nearest-point queries."""

    def __init__(self, points, cell_deg=0.25):
        self.cell = cell_deg
        self.points = points
        self.cells = {}
        for idx, (lat, lon) in enumerate(points):
            self.cells.setdefault(self._key(lat, lon), []).append(idx)

    def _key(self, lat, lon):
        return (math.floor(lat / self.cell), math.floor(lon / self.cell))

    def within(self, lat, lon, max_miles):
        """True if any point lies within max_miles."""
        ky, kx = self._key(lat, lon)
        reach = int(math.ceil(max_miles / (self.cell * 69.0))) + 1
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                for idx in self.cells.get((ky + dy, kx + dx), ()):
                    plat, plon = self.points[idx]
                    if haversine(lat, lon, plat, plon) <= max_miles:
                        return True
        return False


def overlap_fraction(points_a, cum_a, points_b, cum_b, step_miles=5.0, tolerance_miles=2.0):
    """Fraction of route A (sampled every step) that lies within tolerance of route B."""
    grid = PointGrid([pt for _, pt in sample_every(points_b, cum_b, step_miles)])
    samples = sample_every(points_a, cum_a, step_miles)
    hits = sum(1 for _, (lat, lon) in samples if grid.within(lat, lon, tolerance_miles))
    return hits / max(1, len(samples))
