// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
// Sites outside the south-pole map. Each such site has its own terrain: height grids in a
// stereographic projection centred on the site (x east, y north), fine near the site and coarser
// out to the true horizon distance (tools/build_site.py), or, for typed coordinates with no
// grids of their own, NASA's whole-Moon LOLA grid at 16 pixels per degree (about 1.9 km).
// The horizon march, Sun / Earth visibility and the report are the same code the polar map uses.
import { R, OBSERVER_M, marchHorizon, reportFrom } from './terrain.js?v=41';

const DEG = Math.PI / 180;
const TMAX = 330000;      // how far the horizon is searched, m (same as the polar map)

const getJson = (path) => fetch(path).then((r) => { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
const getBin = (path) => fetch(path).then((r) => { if (!r.ok) throw new Error(path + ' ' + r.status); return r.arrayBuffer(); });

/** up / north / east unit vectors at a latitude and east longitude (deg), in the pole frame. */
export function frameAt(lat, lon) {
  const la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
  const up = [c * Math.sin(lo), c * Math.cos(lo), -Math.sin(la)];
  let nx = up[2] * up[0], ny = up[2] * up[1], nz = up[2] * up[2] - 1;
  let l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) { nx = 0; ny = 1; nz = 0; l = 1; }
  const north = [nx / l, ny / l, nz / l];
  const east = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  return { up, north, east };
}

/** One square height grid centred on the site. Pixel centres at -L + (i + 0.5) px; row 0 is the southern edge. */
export class GridLevel {
  constructor(meta, dn, unit) {
    this.meta = meta; this.label = meta.label; this.product = meta.product;
    this.n = meta.size; this.px = meta.pixel_m; this.L = meta.half_extent_m; this.radius = meta.use_radius_m;
    this.sourcePx = meta.source_pixel_m;
    const h = new Float32Array(dn.length);
    for (let i = 0; i < dn.length; i++) h[i] = dn[i] * unit;
    this.h = h;
  }
  /** Bilinear height (m) at local map coordinates, or NaN outside the grid. */
  height(x, y) {
    const n = this.n, fx = (x + this.L) / this.px - 0.5, fy = (y + this.L) / this.px - 0.5;
    if (!(fx >= 0 && fy >= 0 && fx <= n - 1 && fy <= n - 1)) return NaN;
    const i = Math.min(fx | 0, n - 2), j = Math.min(fy | 0, n - 2), a = fx - i, b = fy - j, k = j * n + i, h = this.h;
    return (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) + (h[k + n] * (1 - a) + h[k + n + 1] * a) * b;
  }
}

/** NASA LOLA LDEM_16, the whole Moon at 16 pixels per degree, at its own pixels, in tiles fetched on demand. */
export class GlobalGrid {
  constructor(meta, root) {
    this.meta = meta; this.ppd = meta.px_per_deg; this.tp = meta.tile_px; this.nx = meta.tiles_x; this.ny = meta.tiles_y;
    this.w = this.nx * this.tp; this.hgt = this.ny * this.tp; this.unit = meta.unit_m; this.px = meta.pixel_m;
    this.label = meta.label; this.product = meta.product;
    this.dir = root + meta.dir + '/'; this.tiles = new Array(this.nx * this.ny).fill(null); this.pending = new Map();
  }
  static async open(root = 'public/data/') { return new GlobalGrid(await getJson(root + 'global16/global.json'), root); }
  loadTile(i, j) {
    const k = j * this.nx + i;
    if (this.tiles[k]) return Promise.resolve();
    if (!this.pending.has(k)) this.pending.set(k, getBin(`${this.dir}t_${i}_${j}.bin`).then((b) => { this.tiles[k] = new Int16Array(b); this.pending.delete(k); }));
    return this.pending.get(k);
  }
  /** Fetch every tile within `radius` metres of a point. */
  ensure(lat, lon, radius) {
    const dLat = radius / R / DEG + 0.2, lat0 = Math.max(lat - dLat, -90), lat1 = Math.min(lat + dLat, 90);
    const worst = Math.max(Math.abs(lat0), Math.abs(lat1));
    const dLon = worst > 88 ? 180 : Math.min(180, dLat / Math.cos(worst * DEG) + 0.2);
    const span = this.tp / this.ppd, jobs = [];
    const j0 = Math.max(0, Math.floor((90 - lat1) / span)), j1 = Math.min(this.ny - 1, Math.floor((90 - lat0) / span));
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < this.nx; i++) {
        const mid = (i + 0.5) * span, d = Math.abs(((mid - lon + 540) % 360) - 180);
        if (dLon >= 180 || d <= dLon + span / 2) jobs.push(this.loadTile(i, j));
      }
    }
    return Promise.all(jobs);
  }
  at(ci, ri) {
    ci = ((ci % this.w) + this.w) % this.w; ri = Math.min(Math.max(ri, 0), this.hgt - 1);
    const tp = this.tp, ti = (ci / tp) | 0, tj = (ri / tp) | 0, t = this.tiles[tj * this.nx + ti];
    return t ? t[(ri - tj * tp) * tp + (ci - ti * tp)] * this.unit : NaN;
  }
  /** Bilinear height (m) at latitude / east longitude in radians, or NaN where tiles are not loaded. */
  height(latR, lonR) {
    const fr = (90 - latR / DEG) * this.ppd - 0.5, fc = (((lonR / DEG) % 360) + 360) % 360 * this.ppd - 0.5;
    const j = Math.floor(fr), i = Math.floor(fc), a = fc - i, b = fr - j;
    return (this.at(i, j) * (1 - a) + this.at(i + 1, j) * a) * (1 - b) + (this.at(i, j + 1) * (1 - a) + this.at(i + 1, j + 1) * a) * b;
  }
}

/** The terrain of one site outside the polar map. */
export class SiteTerrain {
  constructor(lat, lon, name) {
    this.lat = lat; this.lon = lon; this.name = name;
    Object.assign(this, frameAt(lat, lon));
    this.levels = [];        // GridLevel[], finest first
    this.global = null;      // GlobalGrid, when there are no site grids
    this.id = null;
  }
  /** Site grids built by tools/build_site.py. */
  static async load(id, root = 'public/data/') {
    const meta = await getJson(`${root}sites/${id}.json`);
    const st = new SiteTerrain(meta.lat, meta.lon, meta.name);
    st.id = id; st.meta = meta;
    const bins = await Promise.all(meta.levels.map((l) => getBin(`${root}sites/${l.file}`)));
    st.levels = meta.levels.map((l, k) => {
      const dn = new Int16Array(bins[k]);
      if (dn.length !== l.size * l.size) throw new Error('site grid has the wrong size');
      return new GridLevel(l, dn, meta.unit_m);
    }).sort((a, b) => a.px - b.px);
    return st;
  }
  /** Any point of the Moon, from the whole-Moon 1.9 km grid. */
  static async fromGlobal(global, lat, lon) {
    await global.ensure(lat, lon, TMAX + 4000);
    const st = new SiteTerrain(lat, lon, null);
    st.global = global;
    return st;
  }
  /** Local map coordinates (m east, m north) of a pole-frame point. */
  toLocal(px, py, pz, len) {
    const e = this.east, n = this.north, u = this.up;
    const k = 2 * R / (len + px * u[0] + py * u[1] + pz * u[2]);
    return [(px * e[0] + py * e[1] + pz * e[2]) * k, (px * n[0] + py * n[1] + pz * n[2]) * k];
  }
  /** Pole-frame unit vector of a local map point. */
  dirOf(x, y) {
    const r = Math.hypot(x, y), c = 2 * Math.atan(r / (2 * R)), s = r > 1e-9 ? Math.sin(c) / r : 0, cc = Math.cos(c);
    const e = this.east, n = this.north, u = this.up;
    return [cc * u[0] + s * (x * e[0] + y * n[0]), cc * u[1] + s * (x * e[1] + y * n[1]), cc * u[2] + s * (x * e[2] + y * n[2])];
  }
  /** Height (m) at local map coordinates from the finest grid that has the point, and the pixel of that grid. */
  heightLocal(x, y) {
    for (const l of this.levels) { const h = l.height(x, y); if (h === h) return h; }
    if (this.global) { const d = this.dirOf(x, y); return this.global.height(Math.asin(-d[2]), Math.atan2(d[0], d[1])); }
    return NaN;
  }
  finestPx() { return this.levels.length ? this.levels[0].px : this.global.px; }
  /** Slope (deg) over a two-pixel baseline of the finest grid at a local map point. */
  slopeLocal(x, y, d = this.finestPx()) {
    const gx = (this.heightLocal(x + d, y) - this.heightLocal(x - d, y)) / (2 * d);
    const gy = (this.heightLocal(x, y + d) - this.heightLocal(x, y - d)) / (2 * d);
    return Math.atan(Math.hypot(gx, gy)) / DEG;
  }
  /** The object the horizon march and the first-person view read the ground from (see polarSampler). */
  sampler() {
    const st = this, { up, north, east } = this, levels = this.levels, global = this.global;
    const h0 = this.heightLocal(0, 0), rad0 = R + h0 + OBSERVER_M, px0 = this.finestPx();
    return {
      up, north, east, h0, p0: [up[0] * rad0, up[1] * rad0, up[2] * rad0],
      dt0: px0 / 2, maxSteps: 6000, tMax: TMAX, cap: px0,
      ground(px, py, pz, len, t) {
        if (levels.length) {
          const k = 2 * R / (len + px * up[0] + py * up[1] + pz * up[2]);
          const mx = (px * east[0] + py * east[1] + pz * east[2]) * k, my = (px * north[0] + py * north[1] + pz * north[2]) * k;
          for (let q = 0; q < levels.length; q++) {
            if (t < levels[q].radius || q === levels.length - 1) { const hh = levels[q].height(mx, my); if (hh === hh) { this.cap = levels[q].px; return hh; } }
          }
          return NaN;
        }
        this.cap = global.px;
        return global.height(Math.asin(-pz / len), Math.atan2(px, py));
      },
      site: st,
    };
  }
  /** Which grids this site's numbers come from, in plain words. */
  describe() {
    if (!this.levels.length) {
      return {
        label: this.global.label, hi: false, coarse: true, levels: [this.global.label],
        note: 'NASA LOLA whole-Moon grid at 16 pixels per degree, about 1.9 km a pixel. This is coarse: hills and craters smaller than a few kilometres are missing, so the horizon is approximate and the slope is an average over 3.8 km',
        products: this.global.product + ' (about 1.9 km), native pixels, out to 330 km',
      };
    }
    const L = this.levels, where = (l, k) => (k ? 'to ' : 'within ') + Math.round(l.radius / 1000) + ' km' + (k ? '' : ' of the site');
    return {
      label: L[0].label, hi: true, coarse: false, levels: L.map((l) => l.label),
      note: 'NASA ' + L.map((l, k) => `${l.product.split(' ')[0]} ${l.label} grid ${where(l, k)}`).join(', ') + '; resampled to grids centred on the site',
      products: L.map((l, k) => `${l.product} (source ${l.sourcePx} m, resampled to ${l.label}) ${where(l, k)}`).join(', '),
    };
  }
  /** Horizon profile in the same shape horizonProfile returns. */
  profile() {
    const S = this.sampler();
    return { horizon: marchHorizon(S), up: S.up, north: S.north, east: S.east, p0: S.p0, fine: true, lead: null, terrain: this.describe(), height: S.h0 };
  }
  /** Steepest ground and share of steep ground within 1 km, on the finest grid. Null when the grid is too coarse to say. */
  hazard() {
    if (!this.levels.length) return null;
    const d = this.levels[0].px, R1 = 1000;
    let max = 0, steep = 0, n = 0;
    for (let y = -R1; y <= R1; y += d) for (let x = -R1; x <= R1; x += d) {
      if (x * x + y * y > R1 * R1) continue;
      const s = this.slopeLocal(x, y);
      if (s > max) max = s;
      if (s > 15) steep++;
      n++;
    }
    return { max, share: n ? steep / n : 0, px: d };
  }
}

/** Site report for a site with its own terrain. Same fields as analyseSite. */
export function analyseLocal(site, samples, stepHours) {
  if (!site._profile) site._profile = site.profile();     // the horizon does not depend on time
  const px = site.finestPx();
  return reportFrom(site._profile, { x: NaN, y: NaN, lat: site.lat, lon: site.lon, slope: site.slopeLocal(0, 0), slopeBaseM: 2 * px }, samples, stepHours);
}
