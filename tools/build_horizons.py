"""Download the Moon's sub-solar and sub-Earth points from NASA JPL Horizons and pack them for the browser.

Source: https://ssd.jpl.nasa.gov/api/horizons.api  (target 301 = Moon, observer 500@399 = Earth's centre)
Quantities: 14 = sub-observer (sub-Earth) longitude and latitude, 15 = sub-solar longitude and latitude,
            20 = observer range (Earth-Moon distance, au). Longitudes are east-positive, degrees.

Output:
  public/data/horizons.bin   float32 little-endian rows of [sunLon, sunLat, earthLon, earthLat, rangeAU]
  public/data/horizons.json  start time, step and row count

Usage:  python tools/build_horizons.py
"""
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import struct

START, STOP, STEP_H = "2026-11-01", "2028-01-01", 1
MON = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
out_dir = Path(__file__).resolve().parent.parent / "public" / "data"

q = {"format": "text", "COMMAND": "'301'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
     "CENTER": "'500@399'", "START_TIME": f"'{START}'", "STOP_TIME": f"'{STOP}'", "STEP_SIZE": f"'{STEP_H} h'",
     "QUANTITIES": "'14,15,20'", "CSV_FORMAT": "'YES'", "ANG_FORMAT": "'DEG'"}
url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q)
text = urllib.request.urlopen(url, timeout=120).read().decode()
body = text[text.index("$$SOE") + 5:text.index("$$EOE")]
head = [l for l in text[:text.index("$$SOE")].splitlines() if "ObsSub-LON" in l][-1]
print("columns:", head.strip())

rows, times = [], []
for line in body.strip().splitlines():
    c = [s.strip() for s in line.split(",")]
    d, hm = c[0].split()
    y, mo, da = d.split("-")
    t = datetime(int(y), MON[mo], int(da), int(hm[:2]), int(hm[3:5]), tzinfo=timezone.utc)
    obs_lon, obs_lat, sun_lon, sun_lat, rng = (float(c[i]) for i in (3, 4, 5, 6, 7))
    rows.append((sun_lon, sun_lat, obs_lon, obs_lat, rng))
    times.append(t)

step_ms = int((times[1] - times[0]).total_seconds() * 1000)
assert all(int((b - a).total_seconds() * 1000) == step_ms for a, b in zip(times, times[1:])), "uneven time steps"
raw = b"".join(struct.pack("<5f", *r) for r in rows)
(out_dir / "horizons.bin").write_bytes(raw)
meta = {"start_ms": int(times[0].timestamp() * 1000), "step_ms": step_ms, "rows": len(rows),
        "columns": ["sun_sub_lon_deg_east", "sun_sub_lat_deg", "earth_sub_lon_deg_east", "earth_sub_lat_deg", "earth_moon_range_au"],
        "source": "NASA JPL Horizons API, target 301 (Moon), observer 500@399 (geocentre), quantities 14, 15, 20",
        "start_utc": times[0].isoformat(), "stop_utc": times[-1].isoformat()}
(out_dir / "horizons.json").write_text(json.dumps(meta, indent=2))
print(json.dumps(meta, indent=2))
print("first row:", rows[0], "\nlast row :", rows[-1], "\nbytes:", len(raw))
