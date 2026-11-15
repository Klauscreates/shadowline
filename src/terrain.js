// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
// CPU side of the terrain: loading, map <-> sphere maths, height sampling,
// horizon profiles and per-site time series.
import { SUN_RADIUS_RAD } from './ephemeris.js?v=26';

export const R = 1737400;          // lunar reference radius, m
const DEG = Math.PI / 180;
export const OBSERVER_M = 2;       // antenna / panel height above ground

export async function loadTerrain(onProgress) {
  const meta = await (await fetch('public/data/terrain.json')).json();
  const res = await fetch('public/data/heights.bin');
  if (!res.ok) throw new Error('The terrain file did not download (' + res.status + ').');
  const total = +res.headers.get('content-length') || meta.size * meta.size * 2;
  const reader = res.body.getReader();
  const bytes = new Uint8Array(meta.size * meta.size * 2);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, got);
    got += value.length;
    onProgress?.(got / total);
  }
  const raw = new Int16Array(bytes.buffer);
  const h = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] * meta.unit_m;
  return new Terrain(h, meta);
}

export class Terrain {
  constructor(heights, meta) {
    this.h = heights;
    this.n = meta.size;
    this.L = meta.half_extent_m;
    this.px = meta.pixel_m;
    this.meta = meta;
  }

  /** Bilinear height (m) at map coordinates (m). Matches GPU linear filtering. */
  height(x, y) {
    const n = this.n;
    let fx = (x + this.L) / (2 * this.L) * n - 0.5;
    let fy = (y + this.L) / (2 * this.L) * n - 0.5;
    fx = Math.min(Math.max(fx, 0), n - 1.001);
    fy = Math.min(Math.max(fy, 0), n - 1.001);
    const i = fx | 0, j = fy | 0, a = fx - i, b = fy - j;
    const k = j * n + i, h = this.h;
    return (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) + (h[k + n] * (1 - a) + h[k + n + 1] * a) * b;
  }

  inside(x, y) { return Math.abs(x) < this.L && Math.abs(y) < this.L; }

  /** Slope in degrees over a one-pixel baseline. */
  slope(x, y) {
    const d = this.px;
    const gx = (this.height(x + d, y) - this.height(x - d, y)) / (2 * d);
    const gy = (this.height(x, y + d) - this.height(x, y - d)) / (2 * d);
    return Math.atan(Math.hypot(gx, gy)) / DEG;
  }
}

/**
 * Finer terrain as a small tile pyramid. Each level is one NASA LOLA polar grid kept at its
 * native pixels (no resampling) and cut into tiles that are fetched only around the sites
 * being tested. public/data/pyramid.json lists the levels. A level may cover the whole map
 * (80 m) or only boxes around the named sites (20 m). The 250 m base map (Terrain above)
 * is always the last fallback.
 */
export const BASE_LABEL = '250 m';
const BASE_PRODUCT = 'LDEM_60S_240MPP_ADJ resampled to 250 m';
const fetchTile = (path) => fetch(path).then((r) => {
  if (!r.ok) throw new Error('tile ' + r.status);
  return r.arrayBuffer();
});
const fetchJson = (path) => fetch(path).then((r) => {
  if (!r.ok) throw new Error('no tile pyramid');
  return r.json();
});

export class TileLevel {
  constructor(meta, root = 'public/data/', loader = fetchTile) {
    this.meta = meta;
    this.label = meta.label; this.product = meta.product; this.radius = meta.use_radius_m;
    this.nt = meta.tiles; this.tp = meta.tile_px; this.px = meta.pixel_m; this.L = meta.half_extent_m; this.unit = meta.unit_m;
    this.n = this.nt * this.tp;
    this.dir = root + meta.dir + '/';
    this.loader = loader;
    // tiles that exist on the server; null = every tile
    this.present = meta.present ? new Set(meta.present.map((s) => { const [i, j] = s.split('_').map(Number); return j * this.nt + i; })) : null;
    this.tiles = new Array(this.nt * this.nt).fill(null);
    this.pending = new Map();
  }
  has(i, j) { return i >= 0 && j >= 0 && i < this.nt && j < this.nt && (!this.present || this.present.has(j * this.nt + i)); }
  loadTile(i, j) {
    const k = j * this.nt + i;
    if (this.tiles[k]) return Promise.resolve();
    if (!this.pending.has(k)) {
      this.pending.set(k, this.loader(`${this.dir}t_${i}_${j}.bin`).then((buf) => { this.tiles[k] = new Int16Array(buf); this.pending.delete(k); }));
    }
    return this.pending.get(k);
  }
  _range(x, y, radius) {
    const span = this.tp * this.px;
    return [Math.floor((x - radius + this.L) / span), Math.floor((x + radius + this.L) / span),
      Math.floor((y - radius + this.L) / span), Math.floor((y + radius + this.L) / span)];
  }
  /** Fetch every existing tile within `radius` metres of a map point. */
  ensure(x, y, radius) {
    const [i0, i1, j0, j1] = this._range(x, y, radius), jobs = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.has(i, j)) jobs.push(this.loadTile(i, j));
    return Promise.all(jobs);
  }
  /** True when every tile touching the square of half-width `radius` around a point exists on the server. */
  exists(x, y, radius) {
    const [i0, i1, j0, j1] = this._range(x, y, radius);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!this.has(i, j)) return false;
    return true;
  }
  /** True when every tile touching the square of half-width `radius` around a point is loaded. */
  covers(x, y, radius) {
    const [i0, i1, j0, j1] = this._range(x, y, radius);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!this.has(i, j) || !this.tiles[j * this.nt + i]) return false;
    return true;
  }
  /** One native pixel, or NaN if its tile is not loaded. */
  at(gi, gj) {
    if (gi < 0 || gj < 0 || gi >= this.n || gj >= this.n) return NaN;
    const tp = this.tp, ti = (gi / tp) | 0, tj = (gj / tp) | 0;
    const tile = this.tiles[tj * this.nt + ti];
    return tile ? tile[(gj - tj * tp) * tp + (gi - ti * tp)] * this.unit : NaN;
  }
  /** Bilinear height (m), or NaN where the tiles are not loaded. */
  height(x, y) {
    const fx = (x + this.L) / this.px - 0.5, fy = (y + this.L) / this.px - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    return (this.at(i, j) * (1 - a) + this.at(i + 1, j) * a) * (1 - b) + (this.at(i, j + 1) * (1 - a) + this.at(i + 1, j + 1) * a) * b;
  }
  /** Slope in degrees over a two-pixel baseline, or NaN. */
  slope(x, y) {
    const d = this.px;
    const gx = (this.height(x + d, y) - this.height(x - d, y)) / (2 * d);
    const gy = (this.height(x, y + d) - this.height(x, y - d)) / (2 * d);
    return Math.atan(Math.hypot(gx, gy)) / DEG;
  }
}

export class TilePyramid {
  /** levels: TileLevel[]; kept finest first. */
  constructor(levels) { this.levels = [...levels].sort((a, b) => a.px - b.px); }
  static async open(root = 'public/data/', loader = fetchTile, readJson = fetchJson) {
    const meta = await readJson(root + 'pyramid.json');
    return new TilePyramid(meta.levels.map((m) => new TileLevel(m, root, loader)));
  }
  /** The same loaded tiles, restricted to the levels whose label is listed (for comparing levels). */
  only(labels) { return new TilePyramid(this.levels.filter((l) => labels.includes(l.label))); }
  /** Fetch what a site analysis at (x, y) can use from every level. */
  ensure(x, y, extra = 2000) { return Promise.all(this.levels.map((l) => l.ensure(x, y, l.radius + extra))); }
  /** Levels that fully cover their own use radius around a site, finest first. */
  usable(x, y) { return this.levels.filter((l) => l.covers(x, y, l.radius + l.px * 2)); }
  /** Height from the finest loaded level at a point, or NaN if none has it. */
  height(x, y) {
    for (const l of this.levels) { const h = l.height(x, y); if (h === h) return h; }
    return NaN;
  }
}

/** Plain-language record of which grids a site analysis used. */
function describeTerrain(used) {
  if (!used.length) return { label: BASE_LABEL, hi: false, levels: [BASE_LABEL], note: 'NASA LOLA 240 m data on a 250 m grid', products: 'LOLA ' + BASE_PRODUCT };
  const where = (l, k) => (k ? 'to ' : 'within ') + (l.radius / 1000) + ' km' + (k ? '' : ' of the site');
  return {
    label: used[0].label, hi: true, levels: [...used.map((l) => l.label), BASE_LABEL],
    note: 'NASA LOLA ' + used.map((l, k) => `${l.label} grid ${where(l, k)}`).join(', ') + ', 250 m grid beyond',
    products: 'LOLA ' + used.map((l, k) => `${l.product} (${l.label}) ${where(l, k)}`).join(', ') + ', ' + BASE_PRODUCT + ' beyond',
  };
}

// --- map <-> sphere (south polar stereographic, pole frame: z toward the south pole) ---
export function mapToLatLon(x, y) {
  const r = Math.hypot(x, y);
  const c = 2 * Math.atan(r / (2 * R));
  let lon = Math.atan2(x, y) / DEG;
  return { lat: -90 + c / DEG, lon };
}
export function latLonToMap(lat, lon) {
  const c = (90 + lat) * DEG;
  const r = 2 * R * Math.tan(c / 2);
  return [r * Math.sin(lon * DEG), r * Math.cos(lon * DEG)];
}
function mapToNormal(x, y) {
  const r = Math.hypot(x, y);
  const t = r / (2 * R), t2 = t * t;
  const s = 2 * t / (1 + t2), c = (1 - t2) / (1 + t2);
  return r > 1e-6 ? [s * x / r, s * y / r, c] : [0, 0, 1];
}

/** Local east / north / up unit vectors at a map position. */
export function localFrame(x, y) {
  const up = mapToNormal(x, y);
  // "north" = toward the north pole = -z projected onto the tangent plane
  let nx = up[2] * up[0], ny = up[2] * up[1], nz = up[2] * up[2] - 1;
  let l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) { nx = 0; ny = 1; nz = 0; l = 1; }   // at the pole: north along lon 0
  const north = [nx / l, ny / l, nz / l];
  const east = [
    north[1] * up[2] - north[2] * up[1],
    north[2] * up[0] - north[0] * up[2],
    north[0] * up[1] - north[1] * up[0],
  ];
  return { up, north, east };
}

export const HORIZON_N = 720;

/**
 * Terrain horizon elevation (radians) in HORIZON_N azimuths (clockwise from north)
 * for an observer OBSERVER_M above the ground. Lunar curvature is included because
 * the march is done in true 3D.
 *
 * With a tile pyramid, each finer level is read out to its own use radius (20 m grid to
 * 10 km, 80 m grid to 20 km) and the 250 m base map beyond. A finer level is used only
 * when it covers its whole use radius around the site, so the report never names a grid
 * that supplied only part of the near horizon.
 */
export function horizonProfile(terrain, x, y, pyramid = null) {
  const { up, north, east } = localFrame(x, y);
  const used = pyramid ? pyramid.usable(x, y) : [];
  const lead = used[0] || null;
  const h0 = lead ? lead.height(x, y) : terrain.height(x, y);
  const rad0 = R + h0 + OBSERVER_M;
  const p0 = [up[0] * rad0, up[1] * rad0, up[2] * rad0];
  const out = new Float32Array(HORIZON_N);
  // Base map alone: 120 m first step, growing 2 % a step up to 1500 m.
  // With finer levels: start at half a pixel and never step farther than one pixel of the grid being read.
  const dt0 = lead ? lead.px / 2 : 120, maxSteps = lead ? 6000 : 560;
  for (let k = 0; k < HORIZON_N; k++) {
    const az = (k / HORIZON_N) * 2 * Math.PI;
    const ca = Math.cos(az), sa = Math.sin(az);
    const dx = north[0] * ca + east[0] * sa;
    const dy = north[1] * ca + east[1] * sa;
    const dz = north[2] * ca + east[2] * sa;
    let best = -0.5, t = 0, dt = dt0;
    for (let i = 0; i < maxSteps; i++) {
      t += dt;
      const px = p0[0] + dx * t, py = p0[1] + dy * t, pz = p0[2] + dz * t;
      const len = Math.hypot(px, py, pz);
      const kmap = 2 * R / (len + pz);
      const mx = px * kmap, my = py * kmap;
      if (!terrain.inside(mx, my)) break;
      let hh = NaN, cap = 1500;
      for (let q = 0; q < used.length; q++) {
        if (t < used[q].radius) { hh = used[q].height(mx, my); if (hh === hh) { cap = used[q].px; break; } }
      }
      if (hh !== hh) hh = terrain.height(mx, my);
      const s = (R + hh) / len;
      const vx = px * s - p0[0], vy = py * s - p0[1], vz = pz * s - p0[2];
      const vu = vx * up[0] + vy * up[1] + vz * up[2];
      const vh = Math.sqrt(Math.max(vx * vx + vy * vy + vz * vz - vu * vu, 1e-6));
      const el = Math.atan2(vu, vh);
      if (el > best) best = el;
      dt = Math.min(dt * 1.02, cap);
      if (t > 330000) break;
    }
    out[k] = best;
  }
  return { horizon: out, up, north, east, p0, fine: !!lead, lead, terrain: describeTerrain(used), height: h0 };
}

function horizonAt(h, az) {
  let f = (az / (2 * Math.PI)) * HORIZON_N;
  f = ((f % HORIZON_N) + HORIZON_N) % HORIZON_N;
  const i = f | 0, a = f - i;
  return h[i] * (1 - a) + h[(i + 1) % HORIZON_N] * a;
}

/** Where a body sits in the local sky, and how much of it clears the terrain. */
export function skyAt(profile, sample) {
  const { up, north, east, p0, horizon } = profile;
  const s = sample.sunDir;
  const sunEl = Math.asin(s[0] * up[0] + s[1] * up[1] + s[2] * up[2]);
  const sunAz = Math.atan2(s[0] * east[0] + s[1] * east[1] + s[2] * east[2], s[0] * north[0] + s[1] * north[1] + s[2] * north[2]);
  const sunHor = horizonAt(horizon, sunAz);
  const sunFrac = Math.min(Math.max((sunEl - sunHor + SUN_RADIUS_RAD) / (2 * SUN_RADIUS_RAD), 0), 1);
  // Earth is close enough that the observer's position on the Moon matters (~0.26 deg).
  const e = sample.earthPos;
  const ex = e[0] - p0[0], ey = e[1] - p0[1], ez = e[2] - p0[2];
  const el = Math.hypot(ex, ey, ez);
  const earthEl = Math.asin((ex * up[0] + ey * up[1] + ez * up[2]) / el);
  const earthAz = Math.atan2(ex * east[0] + ey * east[1] + ez * east[2], ex * north[0] + ey * north[1] + ez * north[2]);
  const earthHor = horizonAt(horizon, earthAz);
  return { sunEl, sunAz, sunFrac, earthEl, earthAz, earthVis: earthEl > earthHor ? 1 : 0, sunHor, earthHor };
}

function longestRun(flags, stepHours) {
  let best = 0, run = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) { run++; if (run > best) best = run; } else run = 0;
  }
  return best * stepHours;
}

/** Full site report over a list of ephemeris samples. */
export function analyseSite(terrain, x, y, samples, stepHours, pyramid = null) {
  const profile = horizonProfile(terrain, x, y, pyramid);
  const n = samples.length;
  const sun = new Float32Array(n), earth = new Uint8Array(n);
  const sunAz = new Float32Array(n), sunEl = new Float32Array(n);
  const earthAz = new Float32Array(n), earthEl = new Float32Array(n);
  let sunSum = 0, earthSum = 0, bothSum = 0;
  const dark = new Uint8Array(n), mute = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = skyAt(profile, samples[i]);
    sun[i] = s.sunFrac; earth[i] = s.earthVis;
    sunAz[i] = s.sunAz; sunEl[i] = s.sunEl; earthAz[i] = s.earthAz; earthEl[i] = s.earthEl;
    sunSum += s.sunFrac; earthSum += s.earthVis; bothSum += s.sunFrac * s.earthVis;
    dark[i] = s.sunFrac < 0.05 ? 1 : 0;
    mute[i] = s.earthVis ? 0 : 1;
  }
  // slope over a two-pixel baseline of the finest grid used at the site
  let slope = terrain.slope(x, y), slopeBaseM = 2 * terrain.px;
  if (profile.lead) { const sf = profile.lead.slope(x, y); if (sf === sf) { slope = sf; slopeBaseM = 2 * profile.lead.px; } }
  const sunPct = sunSum / n, earthPct = earthSum / n, bothPct = bothSum / n;
  const slopeSafe = Math.min(Math.max((15 - slope) / 10, 0), 1);
  let score = 100 * (0.45 * sunPct + 0.35 * earthPct + 0.20 * slopeSafe);
  if (slope > 15) score *= 0.5;
  const ll = mapToLatLon(x, y);
  return {
    x, y, lat: ll.lat, lon: ll.lon, elevation: profile.height, slope, slopeBaseM, fine: profile.fine, terrain: profile.terrain,
    sunPct, earthPct, bothPct, score: Math.round(score),
    longestDarkH: longestRun(dark, stepHours), longestMuteH: longestRun(mute, stepHours),
    profile, series: { sun, earth, sunAz, sunEl, earthAz, earthEl },
  };
}

export function scoreOf(sunPct, earthPct, slope) {
  const slopeSafe = Math.min(Math.max((15 - slope) / 10, 0), 1);
  let s = 100 * (0.45 * sunPct + 0.35 * earthPct + 0.20 * slopeSafe);
  if (slope > 15) s *= 0.5;
  return s;
}
