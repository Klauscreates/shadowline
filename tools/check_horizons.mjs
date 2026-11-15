// Compare Shadowline's sub-solar and sub-Earth points with NASA JPL Horizons
// (Moon, geocentric observer, quantities 14 and 15, daily for 13 months).
// Data file: tools/horizons_reference.txt, downloaded from https://ssd.jpl.nasa.gov/api/horizons.api
import { readFileSync } from 'node:fs';
import { moonSky } from '../src/ephemeris.js';
const txt = readFileSync(new URL('./horizons_reference.txt', import.meta.url), 'utf8');
const body = txt.slice(txt.indexOf('$$SOE') + 5, txt.indexOf('$$EOE'));
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const wrap = (d) => ((d + 540) % 360) - 180;
let n = 0; const mx = { eLat: 0, eLon: 0, sLat: 0, sLon: 0 };
for (const line of body.split('\n')) {
  const c = line.split(',').map((s) => s.trim());
  if (c.length < 7) continue;
  const m = c[0].match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) continue;
  const date = new Date(Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]));
  const s = moonSky(date);
  const cosE = Math.cos(s.earth.lat * Math.PI / 180), cosS = Math.cos(s.sun.lat * Math.PI / 180);
  mx.eLon = Math.max(mx.eLon, Math.abs(wrap(s.earth.lon - +c[3])) * cosE);
  mx.eLat = Math.max(mx.eLat, Math.abs(s.earth.lat - +c[4]));
  mx.sLon = Math.max(mx.sLon, Math.abs(wrap(s.sun.lon - +c[5])) * cosS);
  mx.sLat = Math.max(mx.sLat, Math.abs(s.sun.lat - +c[6]));
  n++;
}
console.log(`${n} dates compared with JPL Horizons`);
console.log(`sub-Earth point: max |dlat| = ${mx.eLat.toFixed(4)} deg, max |dlon| = ${mx.eLon.toFixed(4)} deg`);
console.log(`sub-solar point: max |dlat| = ${mx.sLat.toFixed(4)} deg, max |dlon| = ${mx.sLon.toFixed(4)} deg`);
const worst = Math.max(mx.eLat, mx.eLon, mx.sLat, mx.sLon);
console.log(worst < 0.02 ? 'OK' : 'FAIL', `worst = ${worst.toFixed(4)} deg`);
