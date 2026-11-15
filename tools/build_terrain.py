"""Build the browser heightmap from NASA's LOLA south-pole elevation model.

Source (public, NASA PGDA / LRO LOLA team):
  https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF
  South polar stereographic, 240 m/pixel, heights in metres above a 1737.4 km sphere.

Output:
  public/data/heights.bin  int16 little-endian, row 0 = most negative map y
  public/data/terrain.json grid description

Usage:  python tools/build_terrain.py tools/raw/LDEM_60S_240MPP_ADJ.TIF
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import zoom

HALF_EXTENT_M = 256_000.0   # map half-width kept around the pole
OUT_SIZE = 2048             # output grid is OUT_SIZE x OUT_SIZE
UNIT_M = 0.5                # one int16 count = 0.5 m
RADIUS_M = 1_737_400.0

src_path = Path(sys.argv[1])
out_dir = Path(__file__).resolve().parent.parent / "public" / "data"
out_dir.mkdir(parents=True, exist_ok=True)

with rasterio.open(src_path) as src:
    print("crs      :", src.crs)
    print("transform:", tuple(src.transform)[:6])
    print("size     :", src.width, src.height, src.dtypes, "nodata", src.nodata)
    print("scales   :", src.scales, src.offsets, src.units)
    win = from_bounds(-HALF_EXTENT_M, -HALF_EXTENT_M, HALF_EXTENT_M, HALF_EXTENT_M, src.transform)
    win = win.round_offsets().round_lengths()
    data = src.read(1, window=win).astype(np.float64)
    data = data * src.scales[0] + src.offsets[0]
    res = src.transform.a
    native_px = data.shape[0]
    if src.nodata is not None:
        bad = data == src.nodata * src.scales[0] + src.offsets[0]
        print("nodata pixels:", int(bad.sum()))

# Heights should be metres; some LOLA products are stored in km.
if np.nanmax(np.abs(data)) < 50:
    print("values look like km -> converting to m")
    data *= 1000.0

print("native crop:", data.shape, "at", res, "m/px; range", data.min(), data.max())
half = native_px * res / 2.0

# Raster row 0 is the top (max y). Flip so row 0 = min y.
data = data[::-1, :]

factor = OUT_SIZE / native_px
out = zoom(data, factor, order=1, mode="nearest", grid_mode=True)
out = out[:OUT_SIZE, :OUT_SIZE]
assert out.shape == (OUT_SIZE, OUT_SIZE), out.shape

q = np.clip(np.round(out / UNIT_M), -32768, 32767).astype("<i2")
raw = q.tobytes()
(out_dir / "heights.bin").write_bytes(raw)

meta = {
    "size": OUT_SIZE,
    "half_extent_m": half,
    "pixel_m": 2 * half / OUT_SIZE,
    "unit_m": UNIT_M,
    "radius_m": RADIUS_M,
    "min_m": float(q.min() * UNIT_M),
    "max_m": float(q.max() * UNIT_M),
    "projection": "south polar stereographic, true scale at pole; +y toward lon 0, +x toward lon 90E",
    "row_order": "row 0 = minimum y",
    "source": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF",
    "source_sha256": hashlib.sha256(src_path.read_bytes()).hexdigest(),
    "sha256": hashlib.sha256(raw).hexdigest(),
}
(out_dir / "terrain.json").write_text(json.dumps(meta, indent=2))
print(json.dumps(meta, indent=2))

# Sanity check: the south pole sits on Shackleton's rim/inner wall; the crater
# floor (~ -89.67, 129.8E) should be several km below the rim.
def sample(lat, lon):
    c = np.radians(90 + lat)
    r = 2 * RADIUS_M * np.tan(c / 2)
    x, y = r * np.sin(np.radians(lon)), r * np.cos(np.radians(lon))
    i = int((y + half) / (2 * half) * OUT_SIZE)
    j = int((x + half) / (2 * half) * OUT_SIZE)
    return q[i, j] * UNIT_M

print("Shackleton floor (-89.67,129.8):", sample(-89.67, 129.8), "m")
print("Pole                            :", sample(-89.999, 0), "m")
print("Malapert massif (-86.0, 0)      :", sample(-86.0, 0.0), "m")
print("Cabeus floor (-85.33,-42.13)    :", sample(-85.33, -42.13), "m")
