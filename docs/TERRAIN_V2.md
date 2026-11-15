# Shadowline terrain, version 2

Working notes for the `terrain-v2` branch. The submitted version (`main`, tag `submitted-v1`) is frozen and is not changed by anything here.

Rule followed throughout: every number the app shows says which terrain grid it came from, and nothing generated is mixed into the measured data. All heights in this branch are NASA LOLA measurements kept at their native pixels.

## 1. What finer NASA height data exists for the south pole

Checked on 2026-11-15. "HEAD" means the URL answered HTTP 200 with a TIFF or binary content type and the byte count shown. "Header" means the GeoTIFF tags (size, pixel size, projection) were also read with a small range request. The PGDA server answers HTTP 200 with a 3,789-byte HTML page for files that do not exist, so a 200 alone proves nothing; only the byte count does.

All PGDA grids below use the same south polar stereographic projection as Shadowline (latitude of origin -90, central meridian 0, sphere of 1737.4 km), with heights in metres above that sphere. That means they can be tiled without resampling.

### 1a. LOLA polar grids, 2023 (PGDA product 90) — used by this branch

"A New View of the Lunar South Pole from LOLA". Page: https://pgda.gsfc.nasa.gov/products/90. Files: `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/<file>`. Cloud-optimised GeoTIFF, float32.
Citation: Barker et al. 2023, Planetary Science Journal 4, 183, https://doi.org/10.3847/PSJ/acf3e1. Data DOI 10.60903/gsfcpgda-lola-spole.

| File | Pixel | Coverage | Size | Confirmed |
|---|---|---|---|---|
| `LDEM_83S_10MPP_ADJ.TIF` | 10 m | 83°S to pole, 43,280 px square (±216.4 km) | 5.12 GB | HEAD + header |
| `LDEM_80S_20MPP_ADJ.TIF` | 20 m | 80°S to pole, 30,400 px square (±304 km) | 2.70 GB | HEAD + header, and read (used for the 20 m tiles) |
| `LDEM_75S_30MPP_ADJ.TIF` | 30 m | 75°S to pole | 2.80 GB | HEAD |
| `LDEM_80S_40MPP_ADJ.TIF` | 40 m | 80°S to pole | 716 MB | HEAD |
| `LDEM_60S_60MPP_ADJ.TIF` | 60 m | 60°S to pole | 3.09 GB | HEAD |
| `LDEM_80S_80MPP_ADJ.TIF` | 80 m | 80°S to pole, 7,600 px square | 189 MB | HEAD, and read (used for the 80 m tiles) |
| `LDEM_60S_120MPP_ADJ.TIF` | 120 m | 60°S to pole | 822 MB | HEAD |
| `LDEM_60S_240MPP_ADJ.TIF` | 240 m | 60°S to pole | 219 MB | HEAD, and read (the 250 m base map) |

Companion files exist for each grid: height error (`_ERR`), effective resolution (`_EFFRES`), hillshade (`_HILL`), slope (`LDSM_…`), slope error and shot counts (`LDEC_…`). HEAD-checked examples: `LDEM_83S_10MPP_ADJ_ERR.TIF` 7.96 GB, `LDEM_80S_20MPP_ADJ_ERR.TIF` 3.95 GB, `LDSM_80S_20MPP_ADJ.TIF` 3.78 GB, `LDEC_83S_10MPP_ADJ.TIF` 435 MB. The others are listed on the product page but were not individually checked.

Checked and **not** there (soft 404): `LDEM_80S_10MPP_ADJ.TIF`, `LDEM_85S_10MPP_ADJ.TIF`, `LDEM_85S_5MPP_ADJ.TIF`, `LDEM_87S_5MPP_ADJ.TIF`, `LDEM_88S_5MPP_ADJ.TIF`, `LDEM_85S_20MPP_ADJ.TIF`.

### 1b. 5 m mosaic, 87°S to the pole (PGDA product 81)

"South Pole LOLA DEM Mosaic". Page: https://pgda.gsfc.nasa.gov/products/81. Files: `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/<file>`.

| File | Pixel | Coverage | Size | Confirmed |
|---|---|---|---|---|
| `ldem_87s_5mpp.tif` | 5 m | 40,000 px square, ±100 km of the pole | 3.47 GB | HEAD + header (tiled BigTIFF) |
| `ldsm_87s_5mpp.tif` (slope) | 5 m | same | 5.26 GB | HEAD |
| `ldec_87s_5mpp.tif` (shot counts) | 5 m | same | 146 MB | HEAD |
| `ldem_87s_5mpp_hillshade.tif` | 5 m | same | 859 MB | HEAD |

No error map is published for the mosaic. It covers five of the eight named sites (Shackleton ridge, de Gerlache rim, Chang'e-7 candidate, Haworth, Shackleton floor); the IM-2, Malapert and Cabeus sites are north of 87°S.

### 1c. 5 m site grids (PGDA product 78)

"High-Resolution LOLA Topography for Lunar South Pole Sites". Page: https://pgda.gsfc.nasa.gov/products/78.
URL pattern: `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/<ID>/<ID>_final_adj_5mpp_surf.tif` (also `_slp`, `_toterr`, `_slperr`, `_ldec`). 5 m pixels, float32, same polar stereographic projection (read from the headers). All 27 `_surf.tif` files were HEAD- and header-checked.
Citation: Barker et al. 2021, Planetary and Space Science 203, 105119, https://doi.org/10.1016/j.pss.2020.105119.

| Extent | Size each | Sites (centre x, y in km on the Shadowline map) |
|---|---|---|
| 16 km square | about 41 MB | Site01 connecting ridge (-11, -12); Site04 Shackleton rim (-1, -7); Site07 peak near Shackleton (30, -20); Site11 de Gerlache rim (-37, 15); Site20 Leibnitz beta plateau (73, 118) |
| 20 km square | about 64 MB | Site06, Site42, Shoemaker, DM1, DM2, SL2, SL3, NPA, NPB, NPC, NPD, LM1 to LM8 (rims of Nobile, Amundsen, de Gerlache, Shoemaker, Faustini, Shackleton, Cabeus, Malapert crater and others) |
| 21 km square | 71 MB | Site23 Malapert massif (-0.5, 121.5) |
| 26 km square | 108 MB | Site20v2 (73, 118) |
| 29.8 km square | 142 MB | Haworth (-38, 90.5) |

These come with per-pixel height error maps (`_toterr`), which the 5 m mosaic lacks.

### 1d. Older PDS LOLA polar grids (2017, not track-adjusted)

Directory: https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/ (sizes from the directory listing; those marked HEAD were also checked directly).

| File | Pixel | Coverage | Size | Confirmed |
|---|---|---|---|---|
| `FLOAT_IMG/LDEM_875S_5M_FLOAT.IMG` | 5 m | 87.5°S to pole | 3.68 GB | HEAD |
| `JP2/LDEM_875S_5M.JP2` | 5 m | 87.5°S to pole | 185 MB | HEAD |
| `IMG/LDEM_85S_10M.IMG` | 10 m | 85°S to pole | 1.84 GB | HEAD |
| `IMG/LDEM_80S_20M.IMG` | 20 m | 80°S to pole | 1.85 GB | listing only |

The 2021/2023 PGDA grids above are re-adjusted versions of the same laser tracks and are the better choice.

### 1e. Other products

| Product | Pixel | Coverage | Status |
|---|---|---|---|
| LOLA + LROC NAC shape-from-shading DEMs, Bertone et al. (PGDA product 104, Zenodo https://doi.org/10.5281/zenodo.17954508) | 5 m | 13 Artemis III candidate regions, 13 zip files of 1.1 to 4.4 GB | Page text and Zenodo file list seen; files not opened |
| LROC `NAC_POLE_SOUTH` image mosaic (https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH) | 1 m, uncontrolled | 85.5°S to pole, 40 tiles | Page text only; no file URL confirmed. Imagery, not heights |
| LROC NAC stereo DTMs (2 to 5 m) | | site-specific | **Not confirmed** for the south pole |
| ShadowCam products (https://pds.shadowcam.im-ldi.com/) | | | **Not confirmed**; host answers, contents not examined |
| LROC WAC polar mosaic | | | **Not confirmed**; the guessed name returned 404 |

### What this means

The finest whole-area height grids that really exist are 10 m to 83°S and 5 m to 87°S. Beyond that there are 27 site grids at 5 m. LOLA is a laser altimeter with gaps between ground tracks, so pixel size overstates true detail in places; the `_EFFRES` and shot-count files say where. Nothing here reaches boulder scale.

## 2. Tile pyramid used by the site report

| Level | Source grid | Where it is bundled | Tiles | Size in the repository | Used by the site report |
|---|---|---|---|---|---|
| 20 m | `LDEM_80S_20MPP_ADJ.TIF`, native pixels | boxes of ±10.5 km around the eight named sites | 68 tiles of 512 px (10.24 km) in `public/data/fine20/` | 35.7 MB | within 10 km of the site |
| 80 m | `LDEM_80S_80MPP_ADJ.TIF`, native pixels | the whole 512 km map | 256 tiles of 400 px (32 km) in `public/data/fine/` | 81.9 MB (unchanged from `finer-terrain`) | within 20 km of the site |
| 250 m | `LDEM_60S_240MPP_ADJ.TIF` resampled to 250 m | the whole map, `public/data/heights.bin` | one file | 8.4 MB (unchanged) | everything beyond, and the 3D map, live shadows and heat maps |

`public/data/pyramid.json` lists the levels and which 20 m tiles exist. `tools/build_tiles.py` builds each level; for the 20 m level it reads only the needed windows of NASA's cloud-optimised file over HTTP, so the 2.7 GB file does not have to be downloaded. Rebuilding the 80 m level with the generalised script gives byte-identical tiles (same SHA-256 as before, `784f93c5…`).

How the report chooses a grid (`horizonProfile` in `src/terrain.js`):

- A level is used only if its tiles cover its whole use radius around the site. A pin dropped 8 km from a named site therefore gets "80 m terrain", not a part-20 m answer labelled 20 m.
- The observer's height and the slope come from the finest level used. Slope is measured over two pixels of that grid (40 m, 160 m or 500 m), and the report states the baseline.
- The horizon march steps no farther than one pixel of the grid it is reading, out to that grid's use radius, then hands over to the next grid. With the base map alone the march is the same as in the submitted version.
- The badge beside the coordinates, the note under the report, the copied summary and the CSV header all name the grids actually used.

### Comparison at the eight named sites

Produced by `node tools/compare_levels.mjs` (same code as the app, tiles read from disk). Observer 2 m above ground. The browser gives the same numbers for the sites checked by hand (Shackleton ridge, de Gerlache rim, IM-2 at 20 m).


#### Window: 2026-11-15 + 29.53 days, 1 h steps

| Site | Finest grid | Grids used | Elevation m | Sunlit % | Earth in view % | Slope ° (baseline) | Score |
|---|---|---|---|---|---|---|---|
| Shackleton ridge | 250 m | 250 m | 1944 | 100.0 | 49.5 | 3.0 (500 m) | 82 |
|  | 80 m | 80 m + 250 m | 1954 | 100.0 | 40.9 | 1.3 (160 m) | 79 |
|  | 20 m | 20 m + 80 m + 250 m | 1955 | 99.5 | 36.0 | 6.3 (40 m) | 75 |
| de Gerlache rim | 250 m | 250 m | 1755 | 65.2 | 51.1 | 6.6 (500 m) | 64 |
|  | 80 m | 80 m + 250 m | 1753 | 60.1 | 50.9 | 9.5 (160 m) | 56 |
|  | 20 m | 20 m + 80 m + 250 m | 1754 | 58.9 | 50.9 | 11.3 (40 m) | 52 |
| Chang'e-7 candidate | 250 m | 250 m | 1631 | 79.4 | 51.1 | 4.2 (500 m) | 74 |
|  | 80 m | 80 m + 250 m | 1632 | 66.2 | 50.9 | 6.1 (160 m) | 65 |
|  | 20 m | 20 m + 80 m + 250 m | 1632 | 64.3 | 50.9 | 5.2 (40 m) | 66 |
| IM-2 Athena target | 250 m | 250 m | 5307 | 52.5 | 83.1 | 2.1 (500 m) | 73 |
|  | 80 m | 80 m + 250 m | 5312 | 52.2 | 82.5 | 1.1 (160 m) | 72 |
|  | 20 m | 20 m + 80 m + 250 m | 5313 | 52.2 | 82.5 | 1.3 (40 m) | 72 |
| Malapert massif | 250 m | 250 m | 5128 | 62.7 | 100.0 | 3.7 (500 m) | 83 |
|  | 80 m | 80 m + 250 m | 5132 | 55.0 | 100.0 | 5.0 (160 m) | 80 |
|  | 20 m | 20 m + 80 m + 250 m | 5131 | 51.5 | 100.0 | 7.3 (40 m) | 74 |
| Haworth | 250 m | 250 m | -3305 | 0.0 | 0.0 | 4.1 (500 m) | 20 |
|  | 80 m | 80 m + 250 m | -3313 | 0.0 | 0.0 | 6.4 (160 m) | 17 |
|  | 20 m | 20 m + 80 m + 250 m | -3316 | 0.0 | 0.0 | 10.3 (40 m) | 9 |
| LCROSS impact, Cabeus | 250 m | 250 m | -3829 | 0.0 | 10.4 | 0.5 (500 m) | 24 |
|  | 80 m | 80 m + 250 m | -3833 | 0.0 | 10.4 | 0.2 (160 m) | 24 |
|  | 20 m | 20 m + 80 m + 250 m | -3834 | 0.0 | 10.4 | 1.6 (40 m) | 24 |
| Shackleton floor | 250 m | 250 m | -2783 | 0.0 | 0.0 | 0.5 (500 m) | 20 |
|  | 80 m | 80 m + 250 m | -2788 | 0.0 | 0.0 | 1.4 (160 m) | 20 |
|  | 20 m | 20 m + 80 m + 250 m | -2789 | 0.0 | 0.0 | 2.2 (40 m) | 20 |

#### Window: 2026-11-15 + 365 days, 6 h steps

| Site | Finest grid | Grids used | Elevation m | Sunlit % | Earth in view % | Slope ° (baseline) | Score |
|---|---|---|---|---|---|---|---|
| Shackleton ridge | 250 m | 250 m | 1944 | 63.2 | 52.8 | 3.0 (500 m) | 67 |
|  | 80 m | 80 m + 250 m | 1954 | 77.3 | 47.9 | 1.3 (160 m) | 72 |
|  | 20 m | 20 m + 80 m + 250 m | 1955 | 65.1 | 41.9 | 6.3 (40 m) | 61 |
| de Gerlache rim | 250 m | 250 m | 1755 | 44.9 | 56.4 | 6.6 (500 m) | 57 |
|  | 80 m | 80 m + 250 m | 1753 | 42.4 | 56.4 | 9.5 (160 m) | 50 |
|  | 20 m | 20 m + 80 m + 250 m | 1754 | 41.6 | 56.4 | 11.3 (40 m) | 46 |
| Chang'e-7 candidate | 250 m | 250 m | 1631 | 60.7 | 56.9 | 4.2 (500 m) | 67 |
|  | 80 m | 80 m + 250 m | 1632 | 56.5 | 56.9 | 6.1 (160 m) | 63 |
|  | 20 m | 20 m + 80 m + 250 m | 1632 | 55.4 | 56.9 | 5.2 (40 m) | 64 |
| IM-2 Athena target | 250 m | 250 m | 5307 | 46.7 | 81.9 | 2.1 (500 m) | 70 |
|  | 80 m | 80 m + 250 m | 5312 | 46.5 | 81.6 | 1.1 (160 m) | 69 |
|  | 20 m | 20 m + 80 m + 250 m | 5313 | 46.5 | 81.6 | 1.3 (40 m) | 69 |
| Malapert massif | 250 m | 250 m | 5128 | 52.6 | 100.0 | 3.7 (500 m) | 79 |
|  | 80 m | 80 m + 250 m | 5132 | 47.1 | 100.0 | 5.0 (160 m) | 76 |
|  | 20 m | 20 m + 80 m + 250 m | 5131 | 44.5 | 100.0 | 7.3 (40 m) | 70 |
| Haworth | 250 m | 250 m | -3305 | 0.0 | 0.0 | 4.1 (500 m) | 20 |
|  | 80 m | 80 m + 250 m | -3313 | 0.0 | 0.0 | 6.4 (160 m) | 17 |
|  | 20 m | 20 m + 80 m + 250 m | -3316 | 0.0 | 0.0 | 10.3 (40 m) | 9 |
| LCROSS impact, Cabeus | 250 m | 250 m | -3829 | 0.0 | 16.2 | 0.5 (500 m) | 26 |
|  | 80 m | 80 m + 250 m | -3833 | 0.0 | 16.2 | 0.2 (160 m) | 26 |
|  | 20 m | 20 m + 80 m + 250 m | -3834 | 0.0 | 16.1 | 1.6 (40 m) | 26 |
| Shackleton floor | 250 m | 250 m | -2783 | 0.0 | 0.0 | 0.5 (500 m) | 20 |
|  | 80 m | 80 m + 250 m | -2788 | 0.0 | 0.0 | 1.4 (160 m) | 20 |
|  | 20 m | 20 m + 80 m + 250 m | -2789 | 0.0 | 0.0 | 2.2 (40 m) | 20 |

What the table shows, honestly:

- Finer grids usually report **steeper** ground, because a shorter baseline does not average small features away. A slope over 40 m and a slope over 500 m are different measurements, so scores at different levels are not directly comparable.
- Sunlight at ridge and rim sites moves by several percentage points between levels, and not always in the same direction (Shackleton ridge over a year: 63 %, 77 %, 65 %). Near a sharp crest, the answer depends on features smaller than the coarser pixels and on exactly where the pin sits. The preset coordinates are approximate, so these rows are not the best-lit points of each ridge.
- Sites deep in shadow or on broad flat ground (Haworth, Shackleton floor, Cabeus, IM-2) barely change.
- This is a comparison between grids, not a validation against an independent illumination study. That check has not been done.
