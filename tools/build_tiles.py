"""Cut NASA LOLA south-pole elevation models into small tiles for the browser (the tile pyramid).

Sources (public, NASA PGDA / LRO LOLA team), all south polar stereographic,
heights in metres above a 1737.4 km sphere:
  https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF   80 m/pixel
  https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF   20 m/pixel

Levels (finest level is listed first in public/data/pyramid.json):
  80   every tile of the 512 km map              -> public/data/fine/     (400 px tiles, 32 km)
  20   only tiles within BOX_M of a named site   -> public/data/fine20/   (512 px tiles, 10.24 km)
The named sites are read from PRESETS in src/main.js so the two never drift apart.

Tile format: t_<i>_<j>.bin, int16 little-endian, TILE x TILE, row 0 = most negative map y;
i counts tiles along +x, j along +y, both from the -HALF corner. One count = 0.5 m.
The native pixels are kept as they are: no resampling.

Usage:
  python tools/build_tiles.py 80 tools/raw/LDEM_80S_80MPP_ADJ.TIF
  python tools/build_tiles.py 20 tools/raw/LDEM_80S_20MPP_ADJ.TIF
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
HALF = 256_000.0     # map half-width kept around the pole, m
UNIT_M = 0.5         # one int16 count = 0.5 m
R_MOON = 1_737_400.0
BOX_M = 10_500.0     # half-width of the box of 20 m tiles kept around each named site

LEVELS = {
    "80": dict(label="80 m", dir="fine", tile_px=400, use_radius_m=20000, sites_only=False,
               product="LDEM_80S_80MPP_ADJ", source="https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"),
    "20": dict(label="20 m", dir="fine20", tile_px=512, use_radius_m=10000, sites_only=True,
               product="LDEM_80S_20MPP_ADJ", source="https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"),
}


def presets():
    """Named sites from src/main.js: [(name, lat, lon_east)]."""
    js = (ROOT / "src" / "main.js").read_text(encoding="utf-8")
    block = js[js.index("const PRESETS = ["):]
    block = block[:block.index("];")]
    out = []
    for m in re.finditer(r"\[\s*(['\"])(.+?)\1\s*,\s*(['\"]).*?\3\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]", block):
        out.append((m.group(2), float(m.group(4)), float(m.group(5))))
    assert len(out) == 8, out
    return out


def to_map(lat, lon):
    r = 2 * R_MOON * math.tan(math.radians(90 + lat) / 2)
    return r * math.sin(math.radians(lon)), r * math.cos(math.radians(lon))


def main():
    key, src_path = sys.argv[1], sys.argv[2]   # a local file, or /vsicurl/<url> to read only the needed windows
    lv = LEVELS[key]
    out_dir = DATA / lv["dir"]
    out_dir.mkdir(parents=True, exist_ok=True)
    tp = lv["tile_px"]

    if src_path.startswith("http"):
        src_path = "/vsicurl/" + src_path
    with rasterio.open(src_path) as src:
        print("crs      :", src.crs)
        print("transform:", tuple(src.transform)[:6])
        print("size     :", src.width, src.height, src.dtypes, "nodata", src.nodata)
        print("scales   :", src.scales, src.offsets)
        res = float(src.transform.a)
        assert abs(res + src.transform.e) < 1e-6, "pixels are not square"
        n = int(round(2 * HALF / res))
        assert n % tp == 0, (n, tp)
        nt = n // tp
        span = tp * res
        # column / row of the map corner (-HALF, +HALF) in the source raster
        c0 = int(round((-HALF - src.transform.c) / res))
        r0 = int(round((src.transform.f - HALF) / res))
        assert abs(src.transform.c + c0 * res + HALF) < 1e-3 and abs(src.transform.f - r0 * res - HALF) < 1e-3, "crop is not pixel aligned"

        # are the stored values metres or kilometres?
        probe = src.read(1, window=Window(src.width // 2 - 256, src.height // 2 - 256, 512, 512)).astype(np.float64) * src.scales[0] + src.offsets[0]
        to_m = 1000.0 if np.nanmax(np.abs(probe)) < 50 else 1.0
        print("unit     :", "km -> converting to m" if to_m == 1000.0 else "m")

        sites = presets()
        wanted = None
        if lv["sites_only"]:
            wanted = set()
            for name, lat, lon in sites:
                x, y = to_map(lat, lon)
                for j in range(int((y - BOX_M + HALF) // span), int((y + BOX_M + HALF) // span) + 1):
                    for i in range(int((x - BOX_M + HALF) // span), int((x + BOX_M + HALF) // span) + 1):
                        assert 0 <= i < nt and 0 <= j < nt, (name, i, j)
                        wanted.add((i, j))
            # remove tiles left over from an earlier site list
            for old in out_dir.glob("t_*.bin"):
                old.unlink()

        h = hashlib.sha256()
        lo, hi, count, total = 1e9, -1e9, 0, 0
        for j in range(nt):
            for i in range(nt):
                if wanted is not None and (i, j) not in wanted:
                    continue
                # tile j spans map y from -HALF + j*span upward; raster rows run downward from +HALF
                win = Window(c0 + i * tp, r0 + (nt - 1 - j) * tp, tp, tp)
                d = src.read(1, window=win).astype(np.float64) * src.scales[0] + src.offsets[0]
                assert d.shape == (tp, tp), d.shape
                if src.nodata is not None:
                    assert not np.any(d == src.nodata), f"nodata in tile {i},{j}"
                assert np.all(np.isfinite(d)), f"non-finite value in tile {i},{j}"
                d = d[::-1, :] * to_m                    # row 0 = min y
                q = np.clip(np.round(d / UNIT_M), -32768, 32767).astype("<i2")
                raw = np.ascontiguousarray(q).tobytes()
                h.update(raw)
                (out_dir / f"t_{i}_{j}.bin").write_bytes(raw)
                lo, hi, count, total = min(lo, float(d.min())), max(hi, float(d.max())), count + 1, total + len(raw)

        def sample(lat, lon):
            x, y = to_map(lat, lon)
            col = c0 + int((x + HALF) / res)
            row = r0 + (n - 1 - int((y + HALF) / res))
            return float(src.read(1, window=Window(col, row, 1, 1))[0, 0] * src.scales[0] + src.offsets[0]) * to_m

        print(f"{count} tiles, {total / 1e6:.1f} MB, heights {lo:.1f} .. {hi:.1f} m")
        print("Shackleton floor (-89.67,129.8):", sample(-89.67, 129.8), "m")
        print("Pole                            :", sample(-89.999, 0), "m")
        print("Malapert massif (-86.0, 0)      :", sample(-86.0, 0.0), "m")
        print("Cabeus floor (-85.33,-42.13)    :", sample(-85.33, -42.13), "m")

    meta = {
        "label": lv["label"],
        "dir": lv["dir"],
        "product": lv["product"],
        "source": lv["source"],
        "pixel_m": res,
        "tile_px": tp,
        "tiles": nt,
        "half_extent_m": n * res / 2,
        "unit_m": UNIT_M,
        "use_radius_m": lv["use_radius_m"],
        "coverage": "boxes around the named sites" if wanted is not None else "whole map",
        "tile_count": count,
        "bytes": total,
        "sha256_all_tiles": h.hexdigest(),
    }
    if wanted is not None:
        meta["box_half_width_m"] = BOX_M
        meta["sites"] = [{"name": s[0], "lat": s[1], "lon": s[2]} for s in sites]
        meta["present"] = [f"{i}_{j}" for (i, j) in sorted(wanted, key=lambda t: (t[1], t[0]))]

    pyr_path = DATA / "pyramid.json"
    pyr = json.loads(pyr_path.read_text()) if pyr_path.exists() else {
        "projection": "south polar stereographic, true scale at pole; +y toward lon 0, +x toward lon 90E",
        "row_order": "row 0 = minimum y; tile t_i_j has i along +x and j along +y",
        "tile_format": "int16 little-endian, tile_px x tile_px, one count = unit_m metres above a 1737.4 km sphere",
        "base": "public/data/heights.bin (250 m, see terrain.json) is the fallback below every level",
        "levels": [],
    }
    pyr["levels"] = sorted([l for l in pyr["levels"] if l["label"] != meta["label"]] + [meta], key=lambda l: l["pixel_m"])
    pyr_path.write_text(json.dumps(pyr, indent=1))
    print(json.dumps({k: v for k, v in meta.items() if k != "present"}, indent=2))


main()
