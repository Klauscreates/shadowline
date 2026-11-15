// Compare the in-browser ephemeris with NASA SPICE reference values.
// Usage: node tools/check_ephemeris.mjs
import { readFileSync } from 'node:fs';
import { moonSky } from '../src/ephemeris.js';

const ref = JSON.parse(readFileSync(new URL('./spice_reference.json', import.meta.url)));
const wrap = (d) => ((d + 540) % 360) - 180;
const stats = { sun: { lat: 0, lon: 0 }, earth: { lat: 0, lon: 0 } };
for (const row of ref) {
  const sky = moonSky(new Date(row.utc));
  for (const body of ['sun', 'earth']) {
    stats[body].lat = Math.max(stats[body].lat, Math.abs(sky[body].lat - row[body].lat));
    stats[body].lon = Math.max(stats[body].lon, Math.abs(wrap(sky[body].lon - row[body].lon)));
  }
}
console.log(`epochs compared: ${ref.length}`);
for (const body of ['sun', 'earth']) {
  console.log(`${body.padEnd(5)} max |dlat| = ${stats[body].lat.toFixed(4)} deg, max |dlon| = ${stats[body].lon.toFixed(4)} deg`);
}
const worst = Math.max(stats.sun.lat, stats.earth.lat);
if (worst > 0.05) { console.error('FAIL: latitude error above 0.05 deg'); process.exit(1); }
console.log('OK');
