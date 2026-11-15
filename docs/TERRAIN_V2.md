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
