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
export function moonSky(date) {
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

/** Angular radius of the Sun seen from the Moon, radians (mean). */
export const SUN_RADIUS_RAD = 0.2666 * DEG;
