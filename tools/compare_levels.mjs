// Compare the site report for the eight named sites at each terrain level of the tile pyramid:
//   250 m base map only | 80 m to 20 km + base | 20 m to 10 km + 80 m to 20 km + base
// Uses the same code as the app (src/terrain.js, src/ephemeris.js) and the tiles on disk.
// Usage: node tools/compare_levels.mjs [start YYYY-MM-DD]      (default 2026-11-15)
import { readFileSync } from 'node:fs';
import { moonSky } from '../src/ephemeris.js';
import { Terrain, TilePyramid, analyseSite, latLonToMap } from '../src/terrain.js';

const root = new URL('../public/data/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('terrain.json', root)));
const raw = new Int16Array(readFileSync(new URL('heights.bin', root)).buffer.slice(0));
const h = new Float32Array(raw.length);
for (let i = 0; i < raw.length; i++) h[i] = raw[i] * meta.unit_m;
const terrain = new Terrain(h, meta);

const loader = async (p) => { const b = readFileSync(new URL(p, root)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pyramid = await TilePyramid.open('', loader, async (p) => JSON.parse(readFileSync(new URL(p, root))));

// the named sites, read from the app so the two never drift apart
const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const block = js.slice(js.indexOf('const PRESETS = ['), js.indexOf('];', js.indexOf('const PRESETS = [')));
const sites = [...block.matchAll(/\[\s*(['"])(.+?)\1\s*,\s*(['"]).*?\3\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map((m) => ({ name: m[2], lat: +m[4], lon: +m[5] }));
if (sites.length !== 8) throw new Error('expected 8 named sites, found ' + sites.length);

const start = Date.parse((process.argv[2] || '2026-11-15') + 'T00:00:00Z');
const windows = [['29.53 days, 1 h steps', 29.53, 1], ['365 days, 6 h steps', 365, 6]];
const configs = [['250 m', null], ['80 m', pyramid.only(['80 m'])], ['20 m', pyramid]];
const sampleAt = (ms) => { const s = moonSky(new Date(ms)); return { t: ms, sunDir: s.sun.dir, earthPos: s.earth.pos, earthDir: s.earth.dir }; };
const p1 = (v) => (v * 100).toFixed(1);

for (const s of sites) { [s.x, s.y] = latLonToMap(s.lat, s.lon); await pyramid.ensure(s.x, s.y); }

for (const [wname, days, step] of windows) {
  const samples = [];
  for (let i = 0; i < Math.round(days * 24 / step); i++) samples.push(sampleAt(start + i * step * 3600000));
  console.log(`\n### Window: ${new Date(start).toISOString().slice(0, 10)} + ${wname}\n`);
  console.log('| Site | Finest grid | Grids used | Elevation m | Sunlit % | Earth in view % | Slope ° (baseline) | Score |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const s of sites) {
    for (const [want, pyr] of configs) {
      const r = analyseSite(terrain, s.x, s.y, samples, step, pyr);
      if (r.terrain.label !== want) throw new Error(`${s.name}: wanted ${want}, got ${r.terrain.label}`);
      console.log(`| ${want === '250 m' ? s.name : ''} | ${r.terrain.label} | ${r.terrain.levels.join(' + ')} | ${r.elevation.toFixed(0)} | ${p1(r.sunPct)} | ${p1(r.earthPct)} | ${r.slope.toFixed(1)} (${Math.round(r.slopeBaseM)} m) | ${r.score} |`);
    }
  }
}
