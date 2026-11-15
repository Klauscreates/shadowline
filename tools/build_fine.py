"""Cut NASA's 80 m LOLA south-pole elevation model into small tiles for the browser.

Source (public, NASA PGDA / LRO LOLA team):
  https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF
  South polar stereographic, 80 m/pixel, heights in metres above a 1737.4 km sphere.

Output:
  public/data/fine/t_<i>_<j>.bin  int16 little-endian, TILE_PX x TILE_PX, row 0 = most negative map y
                                  i counts tiles along +x, j along +y, both from the -HALF corner
  public/data/fine/fine.json      grid description

The native 80 m pixels are kept as they are: no resampling.

Usage:  python tools/build_fine.py tools/raw/LDEM_80S_80MPP_ADJ.TIF
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

HALF = 256_000.0     # map half-width kept around the pole, m
TILE_PX = 400        # 400 px x 80 m = 32 km per tile
UNIT_M = 0.5         # one int16 count = 0.5 m

src_path = Path(sys.argv[1])
out_dir = Path(__file__).resolve().parent.parent / "public" / "data" / "fine"
out_dir.mkdir(parents=True, exist_ok=True)

with rasterio.open(src_path) as src:
    print("crs      :", src.crs)
    print("transform:", tuple(src.transform)[:6])
    print("size     :", src.width, src.height, src.dtypes, "nodata", src.nodata)
    print("scales   :", src.scales, src.offsets)
    res = float(src.transform.a)
    win = from_bounds(-HALF, -HALF, HALF, HALF, src.transform).round_offsets().round_lengths()
    data = src.read(1, window=win).astype(np.float64) * src.scales[0] + src.offsets[0]
    nodata = src.nodata

if np.nanmax(np.abs(data)) < 50:
    print("values look like km -> converting to m")
    data *= 1000.0
n = data.shape[0]
assert data.shape == (n, n) and n % TILE_PX == 0, data.shape
print("crop:", data.shape, "at", res, "m/px; range", float(data.min()), float(data.max()))

data = data[::-1, :]                      # row 0 = min y
q = np.clip(np.round(data / UNIT_M), -32768, 32767).astype("<i2")
nt = n // TILE_PX
h = hashlib.sha256()
for j in range(nt):
    for i in range(nt):
        tile = np.ascontiguousarray(q[j * TILE_PX:(j + 1) * TILE_PX, i * TILE_PX:(i + 1) * TILE_PX])
        raw = tile.tobytes()
        h.update(raw)
        (out_dir / f"t_{i}_{j}.bin").write_bytes(raw)

meta = {
    "tiles": nt,
    "tile_px": TILE_PX,
    "pixel_m": res,
    "half_extent_m": n * res / 2,
    "unit_m": UNIT_M,
    "projection": "south polar stereographic, true scale at pole; +y toward lon 0, +x toward lon 90E",
    "row_order": "row 0 = minimum y; tile t_i_j has i along +x and j along +y",
    "source": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF",
    "sha256_all_tiles": h.hexdigest(),
}
(out_dir / "fine.json").write_text(json.dumps(meta, indent=2))
print(json.dumps(meta, indent=2))


def sample(lat, lon):
    c = np.radians(90 + lat)
    r = 2 * 1_737_400.0 * np.tan(c / 2)
    x, y = r * np.sin(np.radians(lon)), r * np.cos(np.radians(lon))
    half = n * res / 2
    return q[int((y + half) / res), int((x + half) / res)] * UNIT_M


print("Shackleton floor (-89.67,129.8):", sample(-89.67, 129.8), "m")
print("Pole                            :", sample(-89.999, 0), "m")
print("Malapert massif (-86.0, 0)      :", sample(-86.0, 0.0), "m")
print("Cabeus floor (-85.33,-42.13)    :", sample(-85.33, -42.13), "m")
