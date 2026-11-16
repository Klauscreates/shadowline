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

## 3. What the 3D view shows

### True-scale switch

The button at the top right switches the drawn heights between **Heights ×3 (exaggerated)**, the default, and **True scale 1 : 1**. It changes the mesh, picking, pins, labels and the "view from site" camera together. It is drawing only: sunlight, Earth contact, slope and elevation were always computed from true heights and are identical in both modes (checked: the report numbers do not change when the switch is flipped, and a click lands on the same map point in both modes).

### Sharper surface near the view centre

When the camera is within 170 km of the point it looks at, the surface around that point is redrawn from finer grids (`src/patch.js`):

- an **80 m patch**, 41 km across (513 × 513 vertices; 385 on touch devices), anywhere on the map;
- inside it a **20 m patch**, 10 km across, when the camera is within 70 km and 20 m tiles are bundled there (the eight named sites).

Patch vertices sit on the source grid's own pixel centres, so the heights drawn are the NASA values, not resampled ones (checked against the 20 m tiles: largest difference 0.6 m, which is the difference between triangle and bilinear interpolation between pixels). At its edge each patch is fitted to the triangles of the coarser mesh around it: the outer 3 cells lie exactly on that surface and the finer heights fade in over the next 24 cells, and the coarser mesh is not drawn underneath. Measured mismatch along the edges: under 1 mm. No gaps or seams were visible in the views tested.

A line under the title states which grid the surface near the view centre is drawn from.

**Limits, stated plainly:**

- **Shadows on the patches still come from the 250 m light map.** The live shadow ray-march and the heat maps read only the 250 m height map. On a patch the *shape* is 20 m or 80 m data and the direct-light shading uses the finer surface normal, but a shadow edge is where the 250 m terrain puts it, which can be a few hundred metres from where the finer terrain would. Small craters therefore show shading but do not cast their own shadows.
- The Slope layer keeps using the 250 m map (500 m baseline) on the patches too, so that one legend stays true for the whole picture.
- The fade-in band at a patch edge (about 0.5 km wide on the 20 m patch, 2 km on the 80 m patch) is a blend of two real grids, not a measurement.
- The surface colour is a plain grey tone by height. It is not imagery.
- Pin markers shrink as the camera comes closer so they do not hide the ground; the closest zoom is now 10 km instead of 25 km.

## 4. Plan for full streamed terrain (not started)

This is a plan only. Nothing below is implemented.

1. **Streamed level-of-detail mesh.** Replace the single 768² mesh plus two patches with a quadtree of tiles (or geometry clipmaps) chosen by screen-space error, drawing 250 m → 80 m → 20 m → 10 m (`LDEM_83S_10MPP_ADJ`) → 5 m (`ldem_87s_5mpp`, and the 27 site grids, which add error maps). Tiles would be fetched on demand from a tile store rather than bundled: the 20 m grid alone is about 1.3 GB as int16 for the 512 km map, the 5 m mosaic about 3.2 GB, so they cannot live in the repository or on GitHub Pages. That needs separate hosting (object storage with range requests) and the user's decision on where. The edge-fitting used by the patches generalises to neighbouring tiles of different levels.
2. **Shadow ray-march on streamed tiles.** Keep the 250 m map for the far field and add a near-field height texture (a clipmap level or virtual-texture page table) around the camera target, so a ray first marches the fine texture and continues in the coarse one, the same hand-over the CPU horizon march already does by distance. The light map would become a set of nested targets as well. Each level has to be validated against the CPU site analysis at the same level before any number from it is shown, and the app must keep saying which grid a shadow came from.
3. **Real orbiter imagery.** The LROC `NAC_POLE_SOUTH` mosaic (1 m, uncontrolled, 85.5°S to the pole) is the candidate; its file URLs are not yet confirmed (section 1e). Two cautions: a polar mosaic has its own sunlight and shadows baked in, taken at many different Sun directions, so draping it under computed lighting shows two sets of shadows; and permanently shadowed areas are black in it. It should be an optional, clearly labelled "photo" layer rather than the base colour under live light. An uncontrolled mosaic can also be offset from the LOLA grid by tens of metres.
4. **Lunar-style reflectance.** Replace the Lambert-like term with a Lunar-Lambert (Lommel-Seeliger) or Hapke function, which brightens toward the limb the way regolith does, and add the opposition surge near zero phase. A normal-albedo map (for example from LOLA 1064 nm reflectance, to be surveyed) would give measured brightness instead of the grey tone. This changes appearance only; the sunlit/shadowed numbers do not depend on it.
5. **Order of work and checks.** (a) tile store and hosting decision; (b) LOD mesh with the existing 250 m light map; (c) near-field shadow march, validated against the CPU analysis; (d) reflectance; (e) imagery layer last. Real-phone performance needs measuring at each step.

## 5. What was verified, and what was not

Verified on 2026-11-15:

- `node tools/check_ephemeris.mjs` and `node tools/check_horizons.mjs` pass (worst difference from JPL Horizons 0.0079°), unchanged.
- The 80 m tiles rebuilt by the generalised script are byte-identical to the previous ones (same SHA-256).
- Spot heights agree between the grids (Shackleton floor: -2787 m at 80 m, -2789 m at 20 m; Malapert massif 4798 m and 4801 m).
- The app loads with no console errors at 1280 × 800 and at 375 × 812 in the local preview after each step; the badge shows "20 m terrain" at the named sites and "80 m terrain" at a pin away from them; the browser reports match `compare_levels.mjs`.
- Picking stays exact with the patches shown and in both vertical scales (0 px error at three screen points).

Not verified:

- Performance and memory on a real phone. Only a desktop browser in a phone-sized window was used. The patches roughly double the triangles drawn while zoomed in.
- Devices without linear filtering of float textures use a half-float path for the patches that was not exercised.
- No comparison against an independent illumination study (for example published average-illumination maps); the table in section 2 compares grids with each other only.
- LOLA height error at each site (the `_ERR` and `_EFFRES` files were surveyed but not used).
- Long interactive sessions (many pans across tile borders) were not soak-tested; tiles are fetched and kept in memory without eviction.

---

# Version 2, next round (branch `v2-next`, builds 40 to 43)

Three additions made on 2026-11-15, on top of the live build 28. Every number below is from a run made on that day with the tools named.

## 6. Ten-minute time steps

| Window | Step before | Step now | Samples now |
|---|---|---|---|
| 1 lunar day (29.53 days) | 1 h | 10 min | 4,252 |
| 3 months | 2 h | 1 h | 2,160 |
| 1 year | 6 h | 6 h | 1,460 |
| Mission, launch-slip and arrival-window tables | 1 h | 10 min | up to about 17,100 a site (60 arrival dates, missions up to 60 days) |

The NASA JPL Horizons table bundled with the app has one row an hour. Times between rows are interpolated (straight line between the two direction vectors, then renormalised). Measured against the in-browser model at 1,372 epochs, the largest angle is the same half-way between rows as at the rows themselves (Sun 0.0040°, Earth 0.0079°), so the interpolation adds nothing visible at four decimals. The Sun moves about 0.5° an hour in the lunar sky, so an hourly step could place a sunrise up to an hour off; a 10-minute step brings that to 10 minutes.

Countdowns ("Sunset in 2 h 40 min"), the longest dark stretch and longest gap, the CSV header (`step_hours,0.166667` and `step_minutes,10`), the timeline strip and the "sampled every 10 min" note all use the fractional step. Rebuilding the lunar-day window for three pinned sites took about 0.3 s on the development desktop, and 0.5 s for a start date outside the Horizons table, where every sample is computed in the browser.

### Change against hourly sampling (`node tools/compare_steps.mjs`)

#### Lunar-day window: 2026-11-15 + 29.53 days, hourly (709 samples) against 10-minute (4252 samples)

| Site (finest grid) | Sunlit % 1 h | 10 min | change | Earth in view % 1 h | 10 min | change | Longest dark h 1 h | 10 min | Longest gap h 1 h | 10 min | Score 1 h | 10 min |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Shackleton ridge (20 m) | 99.55 | 99.54 | -0.00 | 35.97 | 35.89 | -0.08 | 0.00 | 0.00 | 367.00 | 367.50 | 75 | 75 |
| de Gerlache rim (20 m) | 58.91 | 58.89 | -0.02 | 50.92 | 50.96 | +0.05 | 282.00 | 282.17 | 306.00 | 305.83 | 52 | 52 |
| Chang'e-7 candidate (20 m) | 64.28 | 64.27 | -0.02 | 50.92 | 51.06 | +0.14 | 244.00 | 244.83 | 307.00 | 306.67 | 66 | 66 |
| IM-2 Athena target (20 m) | 52.18 | 52.20 | +0.02 | 82.51 | 82.46 | -0.06 | 325.00 | 325.00 | 124.00 | 124.33 | 72 | 72 |
| Malapert massif (20 m) | 51.50 | 51.48 | -0.02 | 100.00 | 100.00 | +0.00 | 335.00 | 335.00 | 0.00 | 0.00 | 74 | 74 |
| Haworth (20 m) | 0.00 | 0.00 | +0.00 | 0.00 | 0.00 | +0.00 | 709.00 | 708.67 | 709.00 | 708.67 | 9 | 9 |
| LCROSS impact, Cabeus (20 m) | 0.00 | 0.00 | +0.00 | 10.44 | 10.44 | +0.00 | 709.00 | 708.67 | 478.00 | 478.17 | 24 | 24 |
| Shackleton floor (20 m) | 0.00 | 0.00 | +0.00 | 0.00 | 0.00 | +0.00 | 709.00 | 708.67 | 709.00 | 708.67 | 20 | 20 |

Largest change: sunlit 0.02 points, Earth in view 0.14 points, longest dark 0.83 h, longest gap 0.50 h, score 0.

#### 14-day mission arriving on the start date, hourly against 10-minute

| Site | Sunlit % 1 h | 10 min | Earth % 1 h | 10 min | Both % 1 h | 10 min | Longest dark h 1 h | 10 min |
|---|---|---|---|---|---|---|---|---|
| Shackleton ridge | 99.04 | 99.04 | 74.11 | 74.16 | 73.15 | 73.20 | 0.00 | 0.00 |
| de Gerlache rim | 96.28 | 96.16 | 87.50 | 87.60 | 83.78 | 83.76 | 9.00 | 9.17 |
| Chang'e-7 candidate | 87.01 | 86.88 | 87.80 | 88.05 | 74.81 | 74.93 | 39.00 | 39.83 |
| IM-2 Athena target | 97.43 | 97.55 | 100.00 | 100.00 | 97.43 | 97.55 | 3.00 | 2.67 |
| Malapert massif | 99.23 | 99.14 | 100.00 | 100.00 | 99.23 | 99.14 | 0.00 | 0.00 |
| Haworth | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 336.00 | 336.00 |
| LCROSS impact, Cabeus | 0.00 | 0.00 | 22.02 | 22.02 | 0.00 | 0.00 | 336.00 | 336.00 |
| Shackleton floor | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 336.00 | 336.00 |

Horizons table against the in-browser model, largest angle over 1372 epochs: at table rows Sun 0.0040 deg, Earth 0.0079 deg; half-way between rows (interpolated) Sun 0.0040 deg, Earth 0.0079 deg.

The percentages move by at most 0.14 points and no score changes. What does change is the timing: the longest dark stretch and longest gap shift by up to 0.83 h because their ends are now found to 10 minutes instead of an hour.

## 7. Sites beyond the polar map

The 3D map is a 512 km square on the south pole (out to about 81.6°S along the axes). Odysseus / IM-1 at 80.13°S is just outside it, and anything near the equator is far outside.

### 7a. NASA height data away from the pole (URLs checked 2026-11-15, each answered HTTP 200 with `Accept-Ranges: bytes`)

All under `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/` (NASA PDS Geosciences Node). All are simple cylindrical (latitude / longitude) raw grids, row 0 at the northern edge, heights above a 1737.4 km sphere.

| Product | Coverage | Pixels per degree (size at the equator) | File(s) | Size | Used here |
|---|---|---|---|---|---|
| LOLA `LDEM_16` | whole Moon | 16 (1.9 km) | `lola_gdr/cylindrical/img/ldem_16.img` | 33 MB | yes, bundled whole for typed coordinates |
| LOLA `LDEM_64` | whole Moon | 64 (474 m) | `…/ldem_64.img` | 531 MB | yes, far field of site grids |
| LOLA `LDEM_128` | whole Moon | 128 (237 m) | `…/ldem_128.img` | 2.1 GB | yes, middle ring beyond 60° latitude |
| LOLA `LDEM_256` | whole Moon, 4 tiles | 256 (118 m) | `…/ldem_256_*.img` | listed, not opened | no |
| LOLA `LDEM_512` | whole Moon, 16 tiles of 45° × 90° | 512 (59 m) | `…/ldem_512_90s_45s_000_090.img` and others | 2.1 GB each | yes, near field beyond 60° latitude |
| LOLA `LDEM_1024` | whole Moon, 144 tiles of 15° × 30° | 1024 (30 m) | `…/ldem_1024_*.img` | listed, not opened | no (see below) |
| `SLDEM2015` tiles | 60°S to 60°N, 32 tiles of 30° × 45° | 512 (59 m) | `sldem2015/tiles/float_img/sldem2015_512_00n_30n_000_045_float.img` and others | 1.4 GB each | yes, near field within 60° of the equator |
| `SLDEM2015` global | 60°S to 60°N | 128 (237 m) | `sldem2015/global/float_img/sldem2015_128_60s_60n_000_360_float.img` | 2.8 GB | yes, middle ring within 60° of the equator |
| LOLA polar `LDEM_75S_120M` | 75°S to the pole | 120 m | `lola_gdr/polar/img/ldem_75s_120m.img` | 116 MB | no |

Also answered: the USGS mosaic `https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif` (8.5 GB, redirects to S3, accepts ranges). Not used. The USGS SLDEM2015 GeoTIFF name I tried returned 404, so no USGS copy of SLDEM2015 is confirmed.

Why SLDEM2015 near the equator: LOLA's tracks are far apart at low latitude, so the plain LOLA grids are interpolated between them there. SLDEM2015 fills those gaps with Kaguya Terrain Camera stereo heights tied to LOLA. It stops at 60° latitude, so Odysseus uses the LOLA grids.

Not used and why: `LDEM_1024` (30 m) would double the detail near a site but is mostly interpolation away from the poles; LROC NAC stereo models (2 to 5 m, Apollo 17 has one) were not surveyed; nothing here was downloaded whole. `tools/build_site.py` fetches only the rows it needs by HTTP range request (about 260 MB a site) into `tools/raw/`.

### 7b. What was built

**Site grids** (`tools/build_site.py site <id> "<name>" <lat> <lon>`, output in `public/data/sites/`): three square height grids in a stereographic projection centred on the site, x east and y north.

| Level | Pixel | Used out to | Size | Source within 60° of the equator | Source elsewhere |
|---|---|---|---|---|---|
| 0 | 60 m | 20 km | 676 × 676 | SLDEM2015 512 px/deg (59 m) | LOLA LDEM_512 (59 m) |
| 1 | 240 m | 80 km | 676 × 676 | SLDEM2015 128 px/deg (237 m) | LOLA LDEM_128 (237 m) |
| 2 | 960 m | 330 km | 696 × 696 | LOLA LDEM_64 (474 m), averaged 2 × 2 | same |

Unlike the south-pole tiles, these grids are **resampled** (bilinear) from NASA's latitude / longitude pixels into the site's own projection, and the report says so. The pixel sizes were chosen close to the source's so that little is lost. 330 km is the same search distance the polar map uses; a peak has to stand more than 30 km above the observer's level to be seen from farther. Each site is 2.8 MB.

**Named sites added**

| Site | Coordinates used | Source of the coordinates | Height in the 60 m grid | Published |
|---|---|---|---|---|
| Odysseus / IM-1 | 80.13°S, 1.44°E | NASA / LROC: "Odysseus came to rest at 80.13°S, 1.44°E, 2579 m elevation" (LROC image post 1360; same text on nasa.gov, "NASA's LRO Images Intuitive Machines' Odysseus Lander") | 2,595 m | 2,579 m; "the local terrain is sloped at a sporty 12°" (the grid gives 12.3°) |
| Apollo 17 lunar module | 20.1911°N, 30.7723°E | NASA NSSDC "Apollo Landing Site Coordinates" (from Wagner et al., Icarus 283, 2017) | −2,627 m | not checked against a published height |

Two more sanity checks on the Apollo 17 report, from the app: the Sun peaks at 68.3° elevation (90° minus the 20.19° latitude minus the 1.5° tilt of the Moon's axis gives 68.3°), and Earth stays between 45.0° and 61.9° elevation toward azimuth 238° (west-south-west, over the South Massif, whose skyline there is 11.3°), never setting. The centre of that range, 53.5°, is close to the 53° expected for a point about 36° from the middle of the near side.

The Odysseus coordinates are published to 0.01°, about 300 m, on ground the same page calls 12° steep, so a 16 m height difference is within what the rounding allows.

**Typed coordinates anywhere** use the whole-Moon `LDEM_16` grid at its native pixels (`public/data/global16/`, 32 tiles, 33 MB, fetched only around the site). This is a coarse fallback and the report says "Coarse terrain: treat these numbers as rough", shows the badge "1.9 km terrain", gives the slope baseline as 3,790 m and does not assess hazards.

**In the app.** A site beyond the map has no marker on the 3D map. It has the full report (score, Sun and Earth now, countdowns, power, communications, ground, mission and launch slip, arrival windows, compare, CSV, summary), the eye-level horizon view (which now also looks up, because away from the poles the Sun and Earth climb high), the first-person 3D view (section 8), and a shaded-relief map of the ground around it with slopes over 15° in red. That map is relief shading lit from the Sun's side at a fixed 25°; it draws no cast shadows and no number is taken from it.

### 7c. Checks (`node tools/check_site.mjs`)

```
1. marchHorizon(polarSampler) against horizonProfile
   Shackleton ridge, 250 m only: largest difference 0.0e+0 deg
   Shackleton ridge, tile pyramid: largest difference 0.0e+0 deg
   IM-2 Athena target, 250 m only: largest difference 0.0e+0 deg
   IM-2 Athena target, tile pyramid: largest difference 0.0e+0 deg
   Shackleton floor, 250 m only: largest difference 0.0e+0 deg
   Shackleton floor, tile pyramid: largest difference 0.0e+0 deg
```

2-3. Sites on the polar map, analysed three ways (2026-11-15 + 29.53 days, 10-minute steps)

| Site | Route | Finest grid | Elevation m | Slope ° | Sunlit % | Earth in view % | Longest dark h | Horizon vs polar route: largest / RMS ° |
|---|---|---|---|---|---|---|---|---|
| IM-2 Athena target | polar map (LOLA 20 / 80 / 250 m polar grids) | 20 m | 5313 | 1.3 | 52.2 | 82.5 | 325.0 | reference |
| IM-2 Athena target | site grids (LDEM_512 / 128 / 64, whole-Moon files) | 60 m | 5312 | 1.4 | 52.2 | 82.4 | 323.8 | 0.11 / 0.023 |
| IM-2 Athena target | whole-Moon 1.9 km grid (LDEM_16) | 1.9 km | 5281 | 1.8 | 55.6 | 83.6 | 301.3 | 2.16 / 0.705 |
| de Gerlache rim | polar map (LOLA 20 / 80 / 250 m polar grids) | 20 m | 1754 | 11.3 | 58.9 | 51.0 | 282.2 | reference |
| de Gerlache rim | site grids (LDEM_512 / 128 / 64, whole-Moon files) | 60 m | 1754 | 10.1 | 63.1 | 51.1 | 255.3 | 2.00 / 0.685 |
| de Gerlache rim | whole-Moon 1.9 km grid (LDEM_16) | 1.9 km | 1686 | 5.2 | 97.8 | 51.2 | 0.0 | 11.77 / 5.072 |

Heights of those site grids against the polar grids at the same places (finest polar grid loaded there)

| Site | Site-grid level and ring | Points | Mean difference m | RMS difference m | Largest m |
|---|---|---|---|---|---|
| IM-2 Athena target | 60 m, 0 to 20 km | 4000 | -0.2 | 1.7 | 64 |
| IM-2 Athena target | 240 m, 20 to 80 km | 4000 | -4.1 | 22.7 | 107 |
| IM-2 Athena target | 960 m, 80 to 330 km | 2052 | -1.7 | 53.3 | 275 |
| de Gerlache rim | 60 m, 0 to 20 km | 4000 | 0.1 | 1.6 | 33 |
| de Gerlache rim | 240 m, 20 to 80 km | 4000 | 0.9 | 17.8 | 84 |
| de Gerlache rim | 960 m, 80 to 330 km | 2718 | -1.1 | 61.2 | 467 |

4. Bundled sites beyond the polar map (2026-11-15 + 29.53 days, 10-minute steps)

| Site | Route | Finest grid | Elevation m | Slope ° | Sunlit % | Earth in view % | Longest dark h | Longest gap h | Score | Horizon vs site grids: largest / RMS ° |
|---|---|---|---|---|---|---|---|---|---|---|
| Odysseus / IM-1 | site grids | 60 m | 2595 | 12.3 | 36.8 | 100.0 | 304.5 | 0.0 | 57 | reference |
| Odysseus / IM-1 | whole-Moon 1.9 km grid | 1.9 km | 2620 | 2.1 | 48.4 | 100.0 | 299.0 | 0.0 | 77 | 14.81 / 4.961 |
|  | horizon -0.25° to 15.31°; steepest ground within 1 km 41.5°, 11% over 15° | | | | | | | | | |
| Apollo 17 | site grids | 60 m | -2628 | 1.9 | 47.6 | 100.0 | 370.2 | 0.0 | 76 | reference |
| Apollo 17 | whole-Moon 1.9 km grid | 1.9 km | -2617 | 2.1 | 47.7 | 100.0 | 369.3 | 0.0 | 76 | 3.13 / 1.189 |
|  | horizon 0.28° to 14.18°; steepest ground within 1 km 18.4°, 2% over 15° | | | | | | | | | |


Reading these:

- **The site-grid route is geometrically right.** Two points that are on the polar map were rebuilt as site grids from the whole-Moon files (a different product, projection and code path). Within 20 km the heights agree with the 20 m and 80 m polar grids to 1.7 m RMS, with no offset. At the IM-2 point the horizon agrees to 0.11° at worst and the sunlit and Earth shares to 0.1 point.
- **Resolution still matters on a narrow rim.** At the de Gerlache rim point the 60 m site grid gives 63.1 % sunlit against 58.9 % from the 20 m polar grid. Swapping one ring at a time shows the whole difference comes from the nearest 20 km (60 m against 20 m pixels); the 240 m and 960 m rings change the horizon by 0.06° at most. So a 60 m site grid can be several points off on a sharp crest, in the same way the 80 m grid is in section 2.
- **The 1.9 km fallback is rough, and very rough in polar terrain.** Sunlit share against the finer route: Apollo 17 47.7 % against 47.6 %; IM-2 55.6 % against 52.2 %; Odysseus 48.4 % against 36.8 % (score 77 against 57); de Gerlache rim 97.8 % against 58.9 %. Near the equator the Sun rises high and the horizon matters little; near the poles it is everything.

## 8. First-person 3D view

"First-person 3D" in a site report (`src/fpv.js`) draws the real ground around the site from the observer's eye, 2 m above the surface.

- **True scale, true curvature.** The ground is a mesh whose points are the ones the horizon calculation samples: 720 directions (360 on touch devices), and along each direction the same steps on the same grids (20 m, 80 m, 250 m on the polar map; 60 m, 240 m, 960 m for site grids; 1.9 km for the fallback), each point placed in 3D at its real height on the 1737.4 km sphere. Heights are not exaggerated. At the named polar sites that is 702,001 points and about 1.36 million triangles, built in 1.1 to 1.8 s on the development desktop.
- **Drawing order instead of a depth buffer.** Rings are drawn from the farthest to the nearest. For a height field seen from its centre that is exact, and it avoids the depth-precision problem of a scene that runs from 2 m to 330 km.
- **Sun and Earth.** Discs of true angular radius (Sun 0.2666°, Earth from its distance at that moment, with the right phase) at the positions the report computes, drawn before the ground, so the ground hides them exactly as far as the calculation says.
- **Controls.** Drag to look around (any direction, up to 88° up), wheel or ＋ / − to zoom, Track Sun, Track Earth.
- **Steep ground.** Ground steeper than 15° over two pixels of the grid in use there is painted red (toggle "Steep ground"). Beyond 20 km the grids are coarse, so distant slopes are averages over hundreds of metres.
- **Not physical:** brightness is slope-facing (Lambert) shading with a faint fill light. Cast shadows are not drawn, there is no surface texture and no stars. Whether the Sun is hidden at the site is shown by the disc going behind the skyline, not by the ground going dark.
- The 2D "Horizon view" stays as the reference: it draws the calculated horizon itself.

### Agreement check

The "Check" button renders the ground alone, in flat white, into a strip 4 × 2048 pixels and 8° tall centred on the calculated horizon, reads the pixels back, finds the top of the ground and compares it with `horizonProfile`. One pixel is 0.0039°, so a difference under that cannot be told from zero. It does this in 72 directions that lie on the mesh's own directions, and in 72 more half-way between two of them (offset 0.25°), where the picture interpolates the ground between two columns and the calculation interpolates the horizon angle.

Run in the preview on 2026-11-15 (desktop, 720 directions, start date 2026-11-15):

| Site | Grids | Points | Build time | 72 mesh directions: largest difference | 72 in-between directions: largest / RMS |
|---|---|---|---|---|---|
| Shackleton ridge | 20 / 80 / 250 m | 702,001 | 1.8 s | under one pixel (0.004°) | 0.004° / 0.001° |
| de Gerlache rim | 20 / 80 / 250 m | 702,001 | 1.5 s | under one pixel (0.004°) | 0.031° / 0.005° |
| IM-2 Athena target | 20 / 80 / 250 m | 702,001 | 1.7 s | under one pixel (0.004°) | 0.008° / 0.002° |
| Odysseus / IM-1 | 60 / 240 / 960 m | 661,681 | 1.2 s | 0.004° (one pixel) | 0.055° / 0.007° |
| Apollo 17 | 60 / 240 / 960 m | 661,681 | 1.1 s | under one pixel (0.004°) | 0.047° / 0.007° |
| Typed 0.674°N 23.473°E | 1.9 km | 133,201 | 0.5 s | under one pixel (0.004°) | under one pixel |

**Largest difference: 0.004° (one test pixel) in the mesh's directions, 0.055° between them.** For scale, the Sun's disc is 0.53° across.

Two things back this up. `tools/check_site.mjs` part 1 shows the ground lookup the mesh uses reproduces `horizonProfile` exactly (difference 0 in all 720 directions, with and without the tile pyramid). And the check does detect errors: with the calculated horizon shifted by 0.05° on purpose, it reported 0.051°.

In the phone-sized preview (360 directions, 351,001 points, built in 0.9 s) the same check gave under one pixel on the mesh directions and 0.035° between them.

## 9. Verified and not verified (this round)

Verified on 2026-11-15, after each of the three features:

- `node tools/check_ephemeris.mjs`, `node tools/check_horizons.mjs` (worst 0.0079°) and `node tools/check_site.mjs` pass.
- The app loads with no console errors at 1280 × 800 and at 375 × 812 in the `shadowline-finer` preview.
- Still working, exercised in the preview: launch-slip table, arrival-window search, compare table, CSV export (4,252 rows plus header), score bands, hazards line, true-scale switch, tile-pyramid badges (20 m at the named sites), Slope layer legend, eye-level horizon view.
- The browser's numbers for the pinned sites match `compare_steps.mjs` and `check_site.mjs` (for example de Gerlache rim 58.89 % sunlit, Odysseus 36.8 % sunlit and 304.5 h longest dark).
- Refactoring the report code did not change any number: `compare_steps.mjs` output was identical before and after.
- Odysseus and Apollo 17 open from the site list; a typed point (0.674°N, 23.473°E) opens from the form with the North option; all three show report, horizon view, local map and first-person view.

Not verified:

- **Real phones.** Only a desktop browser in a phone-sized window was used. The first-person view opens a second WebGL context and, on touch devices, builds 351,001 points; its speed and memory on a real phone are unknown. If the second context cannot start, the view shows a message and the 2D horizon view still works (that fallback path was not exercised).
- Odysseus and Apollo 17 illumination against any independent study or mission record. The only outside checks are Odysseus's published height and slope.
- Site grids near a pole or across longitude 0 are covered by the two check sites and Odysseus; a site within 20 km of a pole, or straddling 60° latitude, was not built.
- The 1.9 km fallback at more than the five places listed in 7c.
- The 3-month and 1-year windows were only spot-checked for the new step (they load, the note reads "sampled every 1 h" and "every 6 h").
- Frame rate while playing time with the first-person view open was not measured on anything but the development desktop (about 5 ms of script time a time step there).

### Size added to the repository

Tracked files went from 129.3 MB (`origin/main`, build 28) to 168.1 MB: **+38.9 MB**, of which `public/data/global16/` is 33.2 MB (the whole-Moon grid), `public/data/sites/` 5.6 MB (two sites), and code, tools and this document the rest. `tools/raw/` (about 950 MB of fetched rows and the two check sites) is not committed.
