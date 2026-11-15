// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
// CPU side of the terrain: loading, map <-> sphere maths, height sampling,
// horizon profiles and per-site time series.
import { SUN_RADIUS_RAD } from './ephemeris.js?v=27';

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
 */
export function horizonProfile(terrain, x, y) {
  const { up, north, east } = localFrame(x, y);
  const rad0 = R + terrain.height(x, y) + OBSERVER_M;
  const p0 = [up[0] * rad0, up[1] * rad0, up[2] * rad0];
  const out = new Float32Array(HORIZON_N);
  for (let k = 0; k < HORIZON_N; k++) {
    const az = (k / HORIZON_N) * 2 * Math.PI;
    const ca = Math.cos(az), sa = Math.sin(az);
    const dx = north[0] * ca + east[0] * sa;
    const dy = north[1] * ca + east[1] * sa;
    const dz = north[2] * ca + east[2] * sa;
    let best = -0.5, t = 0, dt = 120;
    for (let i = 0; i < 400; i++) {
      t += dt;
      const px = p0[0] + dx * t, py = p0[1] + dy * t, pz = p0[2] + dz * t;
      const len = Math.hypot(px, py, pz);
      const kmap = 2 * R / (len + pz);
      const mx = px * kmap, my = py * kmap;
      if (!terrain.inside(mx, my)) break;
      const s = (R + terrain.height(mx, my)) / len;
      const vx = px * s - p0[0], vy = py * s - p0[1], vz = pz * s - p0[2];
      const vu = vx * up[0] + vy * up[1] + vz * up[2];
      const vh = Math.sqrt(Math.max(vx * vx + vy * vy + vz * vz - vu * vu, 1e-6));
      const el = Math.atan2(vu, vh);
      if (el > best) best = el;
      dt = Math.min(dt * 1.02, 1500);
      if (t > 330000) break;
    }
    out[k] = best;
  }
  return { horizon: out, up, north, east, p0 };
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
export function analyseSite(terrain, x, y, samples, stepHours) {
  const profile = horizonProfile(terrain, x, y);
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
  const slope = terrain.slope(x, y);
  const sunPct = sunSum / n, earthPct = earthSum / n, bothPct = bothSum / n;
  const slopeSafe = Math.min(Math.max((15 - slope) / 10, 0), 1);
  let score = 100 * (0.45 * sunPct + 0.35 * earthPct + 0.20 * slopeSafe);
  if (slope > 15) score *= 0.5;
  const ll = mapToLatLon(x, y);
  return {
    x, y, lat: ll.lat, lon: ll.lon, elevation: terrain.height(x, y), slope,
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
