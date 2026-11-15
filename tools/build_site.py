"""
Build the terrain a site outside the south-pole map needs: three nested square height grids
centred on the site, fine near it and coarser out to the true horizon distance.

    python tools/build_site.py site <id> "<name>" <lat> <lon_east> [output folder]
    python tools/build_site.py global16

`site` writes public/data/sites/<id>.json and <id>_0.bin, <id>_1.bin, <id>_2.bin:

    level 0   60 m pixels   to 20 km    SLDEM2015 512 px/deg (within 60 deg of the equator)
                                         or LOLA LDEM_512 (elsewhere)
    level 1   240 m pixels  to 80 km    SLDEM2015 128 px/deg, or LOLA LDEM_128
    level 2   960 m pixels  to 330 km   LOLA LDEM_64 (474 m), averaged 2 x 2 first

Each grid is in a stereographic projection centred on the site (x east, y north, metres), so the
NASA pixels ARE resampled here (bilinear), unlike the south-pole tiles, which keep NASA's own
pixels. Row 0 is the southern edge. Heights are int16 in units of 0.5 m above the 1737.4 km sphere.

`global16` writes public/data/global16/: the whole-Moon LOLA LDEM_16 grid (16 px/deg, about 1.9 km)
at its native pixels in 8 x 4 tiles, used for typed coordinates that have no site grids.

Only the rows that are needed are fetched from the PDS (HTTP range requests) and kept in tools/raw/.
"""
import json
import os
import sys
import urllib.request

import numpy as np
from scipy.ndimage import map_coordinates, uniform_filter

R = 1737400.0
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "public", "data")
PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/"
UNIT = 0.5

LEVELS = [  # label, pixel m, use radius m
    ("60 m", 60.0, 20000.0),
    ("240 m", 240.0, 80000.0),
    ("960 m", 960.0, 330000.0),
]


class Source:
    """One PDS simple-cylindrical grid: row 0 is its northern edge, column 0 its western edge."""

    def __init__(self, path, ppd, lat_max, lat_min, lon_min, lon_max, dtype, to_m, product, native):
        self.url = PDS + path
        self.name = os.path.basename(path)
        self.ppd, self.lat_max, self.lat_min, self.lon_min, self.lon_max = ppd, lat_max, lat_min, lon_min, lon_max
        self.dtype, self.to_m, self.product, self.native = np.dtype(dtype), to_m, product, native
        self.lines = round((lat_max - lat_min) * ppd)
        self.samples = round((lon_max - lon_min) * ppd)

    def rows(self, r0, r1):
        """Rows r0..r1-1 as metres above the reference sphere (cached in tools/raw)."""
        os.makedirs(RAW, exist_ok=True)
        cache = os.path.join(RAW, f"{self.name}.rows_{r0}_{r1}.npy")
        if os.path.exists(cache):
            a = np.load(cache)
        else:
            rb = self.samples * self.dtype.itemsize
            req = urllib.request.Request(self.url, headers={"Range": f"bytes={r0 * rb}-{r1 * rb - 1}", "User-Agent": "shadowline-build"})
            print(f"  fetching {self.name} rows {r0}..{r1} ({(r1 - r0) * rb / 1e6:.0f} MB)", flush=True)
            with urllib.request.urlopen(req, timeout=600) as resp:
                if resp.status != 206:
                    raise RuntimeError(f"{self.name}: server ignored the range request (status {resp.status})")
                buf = resp.read()
            if len(buf) != (r1 - r0) * rb:
                raise RuntimeError(f"{self.name}: short read")
            a = np.frombuffer(buf, dtype=self.dtype).reshape(r1 - r0, self.samples)
            np.save(cache, a)
        return a.astype(np.float32) * self.to_m[0] + self.to_m[1]


def lola(path, ppd, lat_max, lat_min, lon_min, lon_max):
    return Source("lola_gdr/cylindrical/img/" + path, ppd, lat_max, lat_min, lon_min, lon_max, "<i2", (0.5, 0.0),
                  "LOLA " + path.split(".")[0].upper(), 30323.3 / ppd)


def sldem(path, ppd, lat_max, lat_min, lon_min, lon_max):
    # float32 kilometres above 1737.4 km
    return Source("sldem2015/" + path, ppd, lat_max, lat_min, lon_min, lon_max, "<f4", (1000.0, 0.0),
                  "SLDEM2015 " + os.path.basename(path).split(".")[0].upper().replace("_FLOAT", ""), 30323.3 / ppd)


def band(v, edges):
    for a, b in zip(edges[:-1], edges[1:]):
        if a <= v < b:
            return a, b
    raise ValueError(v)


def ns(v):
    return f"{abs(int(v)):02d}{'n' if v > 0 else 's' if v < 0 else 'n'}"


def tile512(lat, lon, use_sldem):
    """The 512 px/deg tile holding (lat, lon)."""
    lon = lon % 360.0
    if use_sldem:
        la, lb = band(lat, [-60, -30, 0, 30, 60])
        lo, lp = band(lon, list(range(0, 361, 45)))
        # SLDEM names: 00n_30n, 30n_60n, 30s_00s, 60s_30s
        nm = f"{ns(la) if la >= 0 else ns(la)}_{ns(lb) if lb > 0 else '00s'}" if la >= 0 else f"{ns(la)}_{'00s' if lb == 0 else ns(lb)}"
        return sldem(f"tiles/float_img/sldem2015_512_{nm}_{lo:03d}_{lp:03d}_float.img", 512, lb, la, lo, lp)
    la, lb = band(lat, [-90, -45, 0, 45, 90.0001])
    lb = min(lb, 90)
    lo, lp = band(lon, [0, 90, 180, 270, 360])
    nm = f"{ns(la)}_{ns(lb)}" if la >= 0 else f"{ns(la)}_{'00s' if lb == 0 else ns(lb)}"
    return lola(f"ldem_512_{nm}_{lo:03d}_{lp:03d}.img", 512, lb, la, lo, lp)


def frame(lat, lon):
    """up / north / east at a site, in the app's pole frame (x -> lon 90E, y -> lon 0, z -> south pole)."""
    la, lo = np.radians(lat), np.radians(lon)
    up = np.array([np.cos(la) * np.sin(lo), np.cos(la) * np.cos(lo), -np.sin(la)])
    north = np.array([up[2] * up[0], up[2] * up[1], up[2] * up[2] - 1.0])
    north /= np.linalg.norm(north)
    east = np.cross(north, up)
    return up, north, east


def grid_latlon(lat, lon, n, px):
    """Latitude and longitude (deg) of every pixel centre of a site-centred stereographic grid."""
    up, north, east = frame(lat, lon)
    L = n * px / 2
    c = -L + (np.arange(n) + 0.5) * px
    x, y = np.meshgrid(c, c)
    r = np.hypot(x, y)
    ang = 2 * np.arctan(r / (2 * R))
    s = np.where(r > 0, np.sin(ang) / np.maximum(r, 1e-9), 0.0)
    d = np.cos(ang)[..., None] * up + (s * x)[..., None] * east + (s * y)[..., None] * north
    return np.degrees(np.arcsin(np.clip(-d[..., 2], -1, 1))), np.degrees(np.arctan2(d[..., 0], d[..., 1]))


def sample(sources, glat, glon, lon0, smooth=False):
    """Bilinear sample of one or more same-resolution sources at (glat, glon). lon0 = site longitude."""
    ppd = sources[0].ppd
    lat_hi, lat_lo = float(glat.max()), float(glat.min())
    dl = (glon - lon0 + 540.0) % 360.0 - 180.0            # longitude relative to the site, -180..180
    pole = lat_hi > 89.5 or lat_lo < -89.5 or (dl.max() - dl.min()) > 300
    lat_top = max(s.lat_max for s in sources)
    r0 = max(int(np.floor((lat_top - lat_hi) * ppd)) - 3, 0)
    r1 = int(np.ceil((lat_top - lat_lo) * ppd)) + 3
    out = None
    if pole:
        (s,) = sources
        if s.samples != round(360 * ppd):
            raise RuntimeError("a grid that reaches the pole needs a whole-Moon source")
        r1 = min(r1, s.lines)
        w = s.rows(r0, r1)
        w = np.concatenate([w, w[:, :2]], axis=1)          # wrap in longitude
        col = (glon % 360.0) * ppd - 0.5
        col = np.where(col < 0, col + s.samples, col)
        c0 = 0
    else:
        # continuous longitude window around the site, pulled from whichever sources hold it
        a = int(np.floor((lon0 + dl.min()) * ppd)) - 3
        b = int(np.ceil((lon0 + dl.max()) * ppd)) + 3
        w = np.full((r1 - r0, b - a), np.nan, np.float32)
        for s in sources:
            sr0 = round((lat_top - s.lat_max) * ppd)
            lo, hi = max(r0, sr0), min(r1, sr0 + s.lines)
            if hi <= lo:
                continue
            rows = s.rows(lo - sr0, hi - sr0)
            cols = np.arange(a, b) % round(360 * ppd) - round(s.lon_min * ppd)
            ok = (cols >= 0) & (cols < s.samples)
            w[lo - r0:hi - r0, ok] = rows[:, cols[ok]]
        col = (lon0 + dl) * ppd - 0.5
        c0 = a
    if smooth:
        k = 2
        kx = int(min(max(round(k / max(np.cos(np.radians(max(abs(lat_hi), abs(lat_lo)))), 0.02)), k), 64))
        w = uniform_filter(w, size=(k, kx), mode="nearest")
    row = (lat_top - glat) * ppd - 0.5
    out = map_coordinates(w, [row - r0, col - c0], order=1, mode="nearest")
    if not np.isfinite(out).all() or out.min() < -12000 or out.max() > 12000:
        raise RuntimeError("the source window has gaps or impossible heights")
    return out


def build_site(sid, name, lat, lon, out_dir=None):
    lon = (lon + 180.0) % 360.0 - 180.0
    out_dir = out_dir or os.path.join(OUT, "sites")
    os.makedirs(out_dir, exist_ok=True)
    meta = {"id": sid, "name": name, "lat": lat, "lon": lon, "unit_m": UNIT,
            "projection": "stereographic centred on the site, x east, y north, sphere radius 1737400 m",
            "levels": []}
    centre = []
    for k, (label, px, radius) in enumerate(LEVELS):
        n = int(np.ceil((radius + 4 * px) / px)) * 2
        glat, glon = grid_latlon(lat, lon, n, px)
        lo_, hi_ = float(glat.min()), float(glat.max())
        in60 = lo_ > -59.9 and hi_ < 59.9
        if k == 0:
            corners = {(glat[i, j], glon[i, j]) for i in (0, -1) for j in (0, -1)} | {(lat, lon)}
            srcs = {}
            for la, lo in corners:
                s = tile512(la, lo, in60)
                srcs[s.name] = s
            srcs = list(srcs.values())
        elif k == 1:
            srcs = [sldem("global/float_img/sldem2015_128_60s_60n_000_360_float.img", 128, 60, -60, 0, 360)] if in60 else [lola("ldem_128.img", 128, 90, -90, 0, 360)]
        else:
            srcs = [lola("ldem_64.img", 64, 90, -90, 0, 360)]
        print(f"level {k}: {label}, {n} x {n} px, from {', '.join(s.name for s in srcs)}", flush=True)
        h = sample(srcs, glat, glon, lon, smooth=(k == 2))
        dn = np.round(h / UNIT)
        if np.abs(dn).max() > 32767:
            raise RuntimeError("height out of int16 range")
        fn = f"{sid}_{k}.bin"
        dn.astype("<i2").tofile(os.path.join(out_dir, fn))
        mid = float((h[n // 2 - 1:n // 2 + 1, n // 2 - 1:n // 2 + 1]).mean())
        centre.append(mid)
        native = srcs[0].native
        meta["levels"].append({
            "label": label, "pixel_m": px, "size": n, "half_extent_m": n * px / 2, "use_radius_m": radius, "file": fn,
            "product": "; ".join(s.product for s in srcs), "source_px_per_deg": srcs[0].ppd, "source_pixel_m": round(native, 1),
            "averaged": "2 x 2 source pixels before sampling" if k == 2 else None,
            "urls": [s.url for s in srcs], "min_m": float(h.min()), "max_m": float(h.max()), "centre_m": round(mid, 1),
        })
        print(f"   height at the site {mid:.1f} m, range {h.min():.0f} .. {h.max():.0f} m", flush=True)
    with open(os.path.join(out_dir, sid + ".json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("site height by level:", ", ".join(f"{c:.1f} m" for c in centre))


def build_global16():
    s = lola("ldem_16.img", 16, 90, -90, 0, 360)
    a = np.round(s.rows(0, s.lines) / UNIT).astype("<i2")
    out_dir = os.path.join(OUT, "global16")
    os.makedirs(out_dir, exist_ok=True)
    tp = 720
    for j in range(4):
        for i in range(8):
            a[j * tp:(j + 1) * tp, i * tp:(i + 1) * tp].tofile(os.path.join(out_dir, f"t_{i}_{j}.bin"))
    meta = {"label": "1.9 km", "px_per_deg": 16, "pixel_m": round(30323.3 / 16, 1), "tile_px": tp, "tiles_x": 8, "tiles_y": 4, "unit_m": UNIT,
            "dir": "global16", "product": "LOLA LDEM_16 (whole Moon, 16 px/deg)", "url": s.url,
            "layout": "simple cylindrical; row 0 = 90 N, column 0 = longitude 0, east positive; native pixels, not resampled",
            "min_m": float(a.min() * UNIT), "max_m": float(a.max() * UNIT)}
    with open(os.path.join(out_dir, "global.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("global16:", a.shape, "range", meta["min_m"], meta["max_m"])


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "global16":
        build_global16()
    elif len(sys.argv) in (6, 7) and sys.argv[1] == "site":
        build_site(sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), sys.argv[6] if len(sys.argv) == 7 else None)
    else:
        sys.exit(__doc__)
