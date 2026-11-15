// How much do the headline numbers change when the lunar-day window is stepped every 10 minutes
// instead of every hour? Eight named sites, finest terrain grids, same code as the app.
// Also measures the error of interpolating the hourly JPL Horizons table to in-between times.
// Usage: node tools/compare_steps.mjs [start YYYY-MM-DD]      (default 2026-11-15)
import { readFileSync } from 'node:fs';
import { moonSky, moonSkyComputed, setHorizonsTable } from '../src/ephemeris.js';
import { Terrain, TilePyramid, analyseSite, skyAt, latLonToMap } from '../src/terrain.js';

const root = new URL('../public/data/', import.meta.url);
const hm = JSON.parse(readFileSync(new URL('horizons.json', root)));
const hb = readFileSync(new URL('horizons.bin', root));
setHorizonsTable({ start: hm.start_ms, step: hm.step_ms, rows: hm.rows, data: new Float32Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength)) });
const meta = JSON.parse(readFileSync(new URL('terrain.json', root)));
const raw = new Int16Array(readFileSync(new URL('heights.bin', root)).buffer.slice(0));
const h = new Float32Array(raw.length);
for (let i = 0; i < raw.length; i++) h[i] = raw[i] * meta.unit_m;
const terrain = new Terrain(h, meta);
const loader = async (p) => { const b = readFileSync(new URL(p, root)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pyramid = await TilePyramid.open('', loader, async (p) => JSON.parse(readFileSync(new URL(p, root))));
const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const block = js.slice(js.indexOf('const PRESETS = ['), js.indexOf('];', js.indexOf('const PRESETS = [')));
const sites = [...block.matchAll(/\[\s*(['"])(.+?)\1\s*,\s*(['"]).*?\3\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map((m) => ({ name: m[2], lat: +m[4], lon: +m[5] }));
if (sites.length !== 8) throw new Error('expected 8 named sites, found ' + sites.length);

const start = Date.parse((process.argv[2] || '2026-11-15') + 'T00:00:00Z');
const sampleAt = (ms) => { const s = moonSky(new Date(ms)); if (s.source !== 'horizons') throw new Error('outside the Horizons table'); return { t: ms, sunDir: s.sun.dir, earthPos: s.earth.pos, earthDir: s.earth.dir }; };
const series = (stepMs, days) => { const a = []; for (let i = 0; i < Math.round(days * 86400000 / stepMs); i++) a.push(sampleAt(start + i * stepMs)); return a; };
const hours = series(3600000, 29.53), tens = series(600000, 29.53);
const p1 = (v) => (v * 100).toFixed(2), d1 = (a, b) => ((b - a) * 100 >= 0 ? '+' : '') + ((b - a) * 100).toFixed(2);
const hr = (v) => v.toFixed(2);

console.log(`\n### Lunar-day window: ${new Date(start).toISOString().slice(0, 10)} + 29.53 days, hourly (${hours.length} samples) against 10-minute (${tens.length} samples)\n`);
console.log('| Site (finest grid) | Sunlit % 1 h | 10 min | change | Earth in view % 1 h | 10 min | change | Longest dark h 1 h | 10 min | Longest gap h 1 h | 10 min | Score 1 h | 10 min |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const worst = { sun: 0, earth: 0, dark: 0, gap: 0, score: 0 };
for (const s of sites) {
  [s.x, s.y] = latLonToMap(s.lat, s.lon); await pyramid.ensure(s.x, s.y);
  const a = analyseSite(terrain, s.x, s.y, hours, 1, pyramid), b = analyseSite(terrain, s.x, s.y, tens, 1 / 6, pyramid);
  s.profile = b.profile;
  worst.sun = Math.max(worst.sun, Math.abs(b.sunPct - a.sunPct) * 100); worst.earth = Math.max(worst.earth, Math.abs(b.earthPct - a.earthPct) * 100);
  worst.dark = Math.max(worst.dark, Math.abs(b.longestDarkH - a.longestDarkH)); worst.gap = Math.max(worst.gap, Math.abs(b.longestMuteH - a.longestMuteH));
  worst.score = Math.max(worst.score, Math.abs(b.score - a.score));
  console.log(`| ${s.name} (${a.terrain.label}) | ${p1(a.sunPct)} | ${p1(b.sunPct)} | ${d1(a.sunPct, b.sunPct)} | ${p1(a.earthPct)} | ${p1(b.earthPct)} | ${d1(a.earthPct, b.earthPct)} | ${hr(a.longestDarkH)} | ${hr(b.longestDarkH)} | ${hr(a.longestMuteH)} | ${hr(b.longestMuteH)} | ${a.score} | ${b.score} |`);
}
console.log(`\nLargest change: sunlit ${worst.sun.toFixed(2)} points, Earth in view ${worst.earth.toFixed(2)} points, longest dark ${worst.dark.toFixed(2)} h, longest gap ${worst.gap.toFixed(2)} h, score ${worst.score}.`);

// the 14-day mission table (on-time row), hourly against 10-minute
const mission = (prof, list, perH, lenH) => {
  let su = 0, ea = 0, bo = 0, run = 0, best = 0; const n = lenH * perH;
  for (let i = 0; i < n; i++) { const k = skyAt(prof, list[i]); su += k.sunFrac; ea += k.earthVis; bo += k.sunFrac * k.earthVis; if (k.sunFrac < 0.05) { run++; if (run > best) best = run; } else run = 0; }
  return { sun: su / n, earth: ea / n, both: bo / n, dark: best / perH };
};
console.log('\n### 14-day mission arriving on the start date, hourly against 10-minute\n');
console.log('| Site | Sunlit % 1 h | 10 min | Earth % 1 h | 10 min | Both % 1 h | 10 min | Longest dark h 1 h | 10 min |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const s of sites) {
  const a = mission(s.profile, hours, 1, 336), b = mission(s.profile, tens, 6, 336);
  console.log(`| ${s.name} | ${p1(a.sun)} | ${p1(b.sun)} | ${p1(a.earth)} | ${p1(b.earth)} | ${p1(a.both)} | ${p1(b.both)} | ${hr(a.dark)} | ${hr(b.dark)} |`);
}

// interpolation of the hourly table: compare half-hour values with the in-browser model, and the same at table rows
const ang = (u, v) => Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])) * 180 / Math.PI;
let onS = 0, onE = 0, midS = 0, midE = 0, cnt = 0;
for (let k = 0; k < 24 * 400; k += 7) {
  const t0 = hm.start_ms + k * 3600000;
  const a = moonSky(new Date(t0)), b = moonSkyComputed(new Date(t0));
  onS = Math.max(onS, ang(a.sun.dir, b.sun.dir)); onE = Math.max(onE, ang(a.earth.dir, b.earth.dir));
  const c = moonSky(new Date(t0 + 1800000)), d = moonSkyComputed(new Date(t0 + 1800000));
  midS = Math.max(midS, ang(c.sun.dir, d.sun.dir)); midE = Math.max(midE, ang(c.earth.dir, d.earth.dir));
  cnt++;
}
console.log(`\nHorizons table against the in-browser model, largest angle over ${cnt} epochs: at table rows Sun ${onS.toFixed(4)} deg, Earth ${onE.toFixed(4)} deg; half-way between rows (interpolated) Sun ${midS.toFixed(4)} deg, Earth ${midE.toFixed(4)} deg.`);
