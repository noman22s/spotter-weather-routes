"""The assessment's risk rules, applied exactly as given.

Weather thresholds (per checkpoint):

    Condition  Low        Moderate    High        Severe      No Travel
    Wind       <25 mph    25-34       35-44       45-54       >=55 mph
    Rain       <0.10 in/h 0.10-0.25   0.25-0.50   0.50-1.00   >1.00
    Snow       <0.5 in/h  0.5-1.0     1.0-2.0     2.0-3.0     >3.0

Where two bands share a boundary value, the value belongs to the higher band for the
lower boundary (0.25 in/h of rain is High) and the Severe band keeps its upper edge
(1.00 in/h is Severe, anything above is No Travel), matching the table's "<" and ">" signs.

Load rules:
    wind >= 55 mph                      -> No Travel for any load
    wind 45-54 mph and load > 30,000 lb -> No Travel
    wind 35-44 mph and load > 40,000 lb -> Severe
"""

LOW, MODERATE, HIGH, SEVERE, NO_TRAVEL = 0, 1, 2, 3, 4
LEVEL_NAMES = ["Low", "Moderate", "High", "Severe", "No Travel"]

WIND_BANDS = (25.0, 35.0, 45.0, 55.0)      # mph; a value >= band[i] is at least level i+1
RAIN_BANDS = (0.10, 0.25, 0.50, 1.00)      # in/h
SNOW_BANDS = (0.5, 1.0, 2.0, 3.0)          # in/h


def wind_level(mph):
    if mph >= WIND_BANDS[3]:
        return NO_TRAVEL
    if mph >= WIND_BANDS[2]:
        return SEVERE
    if mph >= WIND_BANDS[1]:
        return HIGH
    if mph >= WIND_BANDS[0]:
        return MODERATE
    return LOW


def _precip_level(value, bands):
    if value > bands[3]:
        return NO_TRAVEL
    if value >= bands[2]:
        return SEVERE
    if value >= bands[1]:
        return HIGH
    if value >= bands[0]:
        return MODERATE
    return LOW


def rain_level(in_per_hour):
    return _precip_level(in_per_hour, RAIN_BANDS)


def snow_level(in_per_hour):
    return _precip_level(in_per_hour, SNOW_BANDS)


def classify(wind_mph, rain_in, snow_in, load_lbs):
    """Return (level, driver) where driver names what set the level, e.g. 'wind 48 mph'."""
    parts = [(wind_level(wind_mph), f"wind {wind_mph:.0f} mph"),
             (rain_level(rain_in), f"rain {rain_in:.2f} in/h"),
             (snow_level(snow_in), f"snow {snow_in:.2f} in/h")]
    level, driver = max(parts, key=lambda p: p[0])
    if wind_mph >= 55:
        return NO_TRAVEL, f"wind {wind_mph:.0f} mph: no travel for any load"
    if 45 <= wind_mph < 55 and load_lbs > 30000:
        return NO_TRAVEL, f"wind {wind_mph:.0f} mph with a {load_lbs:,} lb load: no travel"
    if 35 <= wind_mph < 45 and load_lbs > 40000 and level < SEVERE:
        return SEVERE, f"wind {wind_mph:.0f} mph with a {load_lbs:,} lb load"
    return level, driver
