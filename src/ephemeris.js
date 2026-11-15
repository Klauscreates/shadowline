// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
// Sun and Earth directions as seen from the Moon, in a Moon-fixed frame.
// Uses astronomy-engine (MIT) for the Moon's orbit and IAU rotation model.
import * as A from '../vendor/astronomy.js';

const DEG = Math.PI / 180;
const AU_M = 1.495978707e11;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Sub-solar and sub-Earth points on the Moon at a given Date.
 * Returns selenographic latitude/longitude in degrees (east positive), plus
 * unit vectors in the "pole frame" used by the renderer:
 *   x -> lon 90E on the equator, y -> lon 0 on the equator, z -> south pole.
 */
export function moonSkyComputed(date) {
  const t = A.MakeTime(date);
  const axis = A.RotationAxis(A.Body.Moon, t);
  const zb = norm([axis.north.x, axis.north.y, axis.north.z]);
  // IAU convention: node Q lies at RA = ra0 + 90 deg on the J2000 equator.
  const q = norm(cross([0, 0, 1], zb));
  const w = axis.spin * DEG;
  const zq = cross(zb, q);
  const xb = [
    q[0] * Math.cos(w) + zq[0] * Math.sin(w),
    q[1] * Math.cos(w) + zq[1] * Math.sin(w),
    q[2] * Math.cos(w) + zq[2] * Math.sin(w),
  ];
  const yb = cross(zb, xb);

  const moon = A.GeoMoon(t);                        // Earth -> Moon, AU, J2000 equatorial
  const sun = A.GeoVector(A.Body.Sun, t, true);     // Earth -> Sun
  const toSun = [sun.x - moon.x, sun.y - moon.y, sun.z - moon.z];
  const toEarth = [-moon.x, -moon.y, -moon.z];

  const sub = (v) => {
    const u = norm(v);
    const lat = Math.asin(dot(u, zb));
    const lon = Math.atan2(dot(u, yb), dot(u, xb));
    const c = Math.cos(lat);
    const dir = [c * Math.sin(lon), c * Math.cos(lon), -Math.sin(lat)];
    const dist = Math.hypot(v[0], v[1], v[2]) * AU_M;
    return {
      lat: lat / DEG,
      lon: lon / DEG,
      dir,
      pos: [dir[0] * dist, dir[1] * dist, dir[2] * dist],   // metres from the Moon's centre
    };
  };
  return { sun: sub(toSun), earth: sub(toEarth) };
}

// ---- NASA JPL Horizons table (hourly sub-solar and sub-Earth points, Earth-Moon range) ----
let HZ = null;   // { start, step, rows, data: Float32Array of [sunLon, sunLat, earthLon, earthLat, rangeAU] }
/** Load the Horizons table. Until this resolves (or if it fails) positions are computed in the browser. */
export async function loadHorizons() {
  const meta = await (await fetch('public/data/horizons.json')).json();
  const buf = await (await fetch('public/data/horizons.bin')).arrayBuffer();
  const data = new Float32Array(buf);
  if (data.length !== meta.rows * 5) throw new Error('Horizons table has the wrong size');
  HZ = { start: meta.start_ms, step: meta.step_ms, rows: meta.rows, data, meta };
  return meta;
}
export function setHorizonsTable(t) { HZ = t; }
/** The time span the Horizons table covers, or null. */
export function horizonsRange() { return HZ ? [HZ.start, HZ.start + (HZ.rows - 1) * HZ.step] : null; }
const dirOf = (lonDeg, latDeg) => { const lon = lonDeg * DEG, lat = latDeg * DEG, c = Math.cos(lat); return [c * Math.sin(lon), c * Math.cos(lon), -Math.sin(lat)]; };
function fromDir(d, dist) {
  const u = norm(d);
  return { lat: Math.asin(-u[2]) / DEG, lon: Math.atan2(u[0], u[1]) / DEG, dir: u, pos: [u[0] * dist, u[1] * dist, u[2] * dist] };
}
/**
 * Sun and Earth as seen from the Moon. Inside the Horizons table's time span the values
 * are NASA JPL Horizons data, interpolated between hourly rows; outside it they are
 * computed in the browser. `source` says which one was used.
 */
export function moonSky(date) {
  const ms = +date;
  if (HZ) {
    const f = (ms - HZ.start) / HZ.step;
    if (f >= 0 && f <= HZ.rows - 1) {
      const i = Math.min(Math.floor(f), HZ.rows - 2), a = f - i, d = HZ.data, k = i * 5;
      const mix = (p, q) => [p[0] * (1 - a) + q[0] * a, p[1] * (1 - a) + q[1] * a, p[2] * (1 - a) + q[2] * a];
      const sun = mix(dirOf(d[k], d[k + 1]), dirOf(d[k + 5], d[k + 6]));
      const earth = mix(dirOf(d[k + 2], d[k + 3]), dirOf(d[k + 7], d[k + 8]));
      const range = (d[k + 4] * (1 - a) + d[k + 9] * a) * AU_M;
      return { sun: fromDir(sun, AU_M), earth: fromDir(earth, range), source: 'horizons' };
    }
  }
  const s = moonSkyComputed(date);
  s.source = 'computed';
  return s;
}

/** Angular radius of the Sun seen from the Moon, radians (mean). */
export const SUN_RADIUS_RAD = 0.2666 * DEG;
