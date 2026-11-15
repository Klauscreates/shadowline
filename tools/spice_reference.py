"""Reference sub-solar / sub-Earth points from NASA SPICE (DE440, MOON_ME frame).

Used only to check the in-browser ephemeris (tools/check_ephemeris.mjs).
Usage:  python tools/spice_reference.py <kernel_dir>  > tools/spice_reference.json
Kernels: de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf, naif0012.tls, pck00011.tpc
"""
import json
import sys
from pathlib import Path

import numpy as np
import spiceypy as sp

kdir = Path(sys.argv[1])
for k in ["naif0012.tls", "pck00011.tpc", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf"]:
    sp.furnsh(str(kdir / k))

rows = []
for i in range(0, 400, 3):  # every 3 days for ~13 months
    utc = f"2026-11-01T00:00:00"
    et = sp.str2et(utc) + i * 86400.0 + (i % 7) * 3600.0
    out = {"utc": sp.et2utc(et, "ISOC", 3) + "Z"}
    for name, target in (("sun", "SUN"), ("earth", "EARTH")):
        pos, _ = sp.spkpos(target, et, "MOON_ME", "LT+S", "MOON")
        _, lon, lat = sp.reclat(pos)
        out[name] = {"lat": float(np.degrees(lat)), "lon": float(np.degrees(lon))}
    rows.append(out)
print(json.dumps(rows))
