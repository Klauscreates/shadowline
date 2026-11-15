// Checks on the terrain used for sites beyond the south-pole map.
//  1. marchHorizon(polarSampler) must reproduce horizonProfile exactly (the sampler the
//     first-person view uses reads the same ground as the report).
//  2. Two sites that ARE on the polar map are analysed a second way: from site-centred grids built
//     by tools/build_site.py out of NASA's whole-Moon products (LDEM_512 / LDEM_128 / LDEM_64).
//     Different files, a different projection and different code paths, so agreement shows the
//     site-grid route is geometrically right. Build them first:
//       python tools/build_site.py site chk_im2 "IM-2 (check)" -84.78 29.13 tools/raw/check_sites
//       python tools/build_site.py site chk_gerlache "de Gerlache (check)" -88.71 -68.10 tools/raw/check_sites
//  3. The same two sites from the whole-Moon 1.9 km grid, to show how rough that fallback is.
//  4. The bundled sites (Odysseus / IM-1, Apollo 17): headline numbers, and site grids against the 1.9 km grid.
// Usage: node tools/check_site.mjs
import { readFileSync, existsSync } from 'node:fs';
import { moonSky, setHorizonsTable } from '../src/ephemeris.js';
import { Terrain, TilePyramid, analyseSite, horizonProfile, polarSampler, marchHorizon, latLonToMap, HORIZON_N } from '../src/terrain.js';
import { SiteTerrain, GlobalGrid, GridLevel, analyseLocal } from '../src/site.js';

const DEG = Math.PI / 180;
const root = new URL('../public/data/', import.meta.url);
const hm = JSON.parse(readFileSync(new URL('horizons.json', root)));
const hb = readFileSync(new URL('horizons.bin', root));
setHorizonsTable({ start: hm.start_ms, step: hm.step_ms, rows: hm.rows, data: new Float32Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength)) });
const meta = JSON.parse(readFileSync(new URL('terrain.json', root)));
const raw = new Int16Array(readFileSync(new URL('heights.bin', root)).buffer.slice(0));
const h = new Float32Array(raw.length);
for (let i = 0; i < raw.length; i++) h[i] = raw[i] * meta.unit_m;
const terrain = new Terrain(h, meta);
const bin = (u) => { const b = readFileSync(u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pyramid = await TilePyramid.open('', async (p) => bin(new URL(p, root)), async (p) => JSON.parse(readFileSync(new URL(p, root))));

function loadSite(dirUrl, id) {
  const m = JSON.parse(readFileSync(new URL(id + '.json', dirUrl)));
  const st = new SiteTerrain(m.lat, m.lon, m.name);
  st.id = id; st.meta = m;
  st.levels = m.levels.map((l) => new GridLevel(l, new Int16Array(bin(new URL(l.file, dirUrl))), m.unit_m)).sort((a, b) => a.px - b.px);
  return st;
}
const gmeta = JSON.parse(readFileSync(new URL('global16/global.json', root)));
const global = new GlobalGrid(gmeta, '');
for (let j = 0; j < gmeta.tiles_y; j++) for (let i = 0; i < gmeta.tiles_x; i++) global.tiles[j * gmeta.tiles_x + i] = new Int16Array(bin(new URL(`global16/t_${i}_${j}.bin`, root)));
const fromGlobal = (lat, lon) => { const st = new SiteTerrain(lat, lon, null); st.global = global; return st; };

const start = Date.parse('2026-11-15T00:00:00Z');
const samples = [];
for (let i = 0; i < Math.round(29.53 * 144); i++) { const ms = start + i * 600000, s = moonSky(new Date(ms)); samples.push({ t: ms, sunDir: s.sun.dir, earthPos: s.earth.pos, earthDir: s.earth.dir }); }
const stats = (a, b) => { let mx = 0, sq = 0; for (let k = 0; k < HORIZON_N; k++) { const d = Math.abs(a[k] - b[k]) / DEG; if (d > mx) mx = d; sq += d * d; } return { max: mx, rms: Math.sqrt(sq / HORIZON_N) }; };
const p2 = (v) => (v * 100).toFixed(1);
let fail = false;

// 1
console.log('1. marchHorizon(polarSampler) against horizonProfile');
for (const [name, lat, lon] of [['Shackleton ridge', -89.45, -137.31], ['IM-2 Athena target', -84.78, 29.13], ['Shackleton floor', -89.67, 129.78]]) {
  const [x, y] = latLonToMap(lat, lon); await pyramid.ensure(x, y);
  for (const pyr of [null, pyramid]) {
    const a = horizonProfile(terrain, x, y, pyr).horizon, b = marchHorizon(polarSampler(terrain, x, y, pyr));
    const s = stats(a, b);
    console.log(`   ${name}, ${pyr ? 'tile pyramid' : '250 m only'}: largest difference ${s.max.toExponential(1)} deg`);
    if (s.max > 1e-9) fail = true;
  }
}

// heights of the site grids against the polar grids at the same places (random points in each level's own ring)
const heightRows = [];
function heightCheck(name, st) {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out = [];
  let r0 = 0;
  for (const l of st.levels) {
    let n = 0, sum = 0, sq = 0, mx = 0;
    for (let k = 0; k < 4000; k++) {
      const r = r0 + (l.radius - r0) * Math.sqrt(rnd()), a = rnd() * 2 * Math.PI, x = r * Math.sin(a), y = r * Math.cos(a);
      const d = st.dirOf(x, y), km = 2 * 1737400 / (1 + d[2]), mx_ = d[0] * km, my_ = d[1] * km;
      if (!terrain.inside(mx_, my_)) continue;
      let ref = pyramid.height(mx_, my_); if (ref !== ref) ref = terrain.height(mx_, my_);
      const e = l.height(x, y) - ref; n++; sum += e; sq += e * e; if (Math.abs(e) > mx) mx = Math.abs(e);
    }
    out.push(`| ${name} | ${l.label}, ${Math.round(r0 / 1000)} to ${Math.round(l.radius / 1000)} km | ${n} | ${(sum / n).toFixed(1)} | ${Math.sqrt(sq / n).toFixed(1)} | ${mx.toFixed(0)} |`);
    if (Math.abs(sum / n) > 15 || Math.sqrt(sq / n) > l.px / 6 + 10) fail = true;      // the polar reference beyond 20 km is itself the 250 m map
    r0 = l.radius;
  }
  return out.join('\n');
}

// 2 and 3
const chk = new URL('./raw/check_sites/', import.meta.url);
console.log('\n2-3. Sites on the polar map, analysed three ways (2026-11-15 + 29.53 days, 10-minute steps)\n');
console.log('| Site | Route | Finest grid | Elevation m | Slope ° | Sunlit % | Earth in view % | Longest dark h | Horizon vs polar route: largest / RMS ° |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [id, name, lat, lon] of [['chk_im2', 'IM-2 Athena target', -84.78, 29.13], ['chk_gerlache', 'de Gerlache rim', -88.71, -68.10]]) {
  const [x, y] = latLonToMap(lat, lon); await pyramid.ensure(x, y);
  const A = analyseSite(terrain, x, y, samples, 1 / 6, pyramid);
  const line = (route, r, s) => console.log(`| ${name} | ${route} | ${r.terrain.label} | ${r.elevation.toFixed(0)} | ${r.slope.toFixed(1)} | ${p2(r.sunPct)} | ${p2(r.earthPct)} | ${r.longestDarkH.toFixed(1)} | ${s ? s.max.toFixed(2) + ' / ' + s.rms.toFixed(3) : 'reference'} |`);
  line('polar map (LOLA 20 / 80 / 250 m polar grids)', A, null);
  if (existsSync(new URL(id + '.json', chk))) {
    const B = analyseLocal(loadSite(chk, id), samples, 1 / 6), s = stats(A.profile.horizon, B.profile.horizon);
    line('site grids (LDEM_512 / 128 / 64, whole-Moon files)', B, s);
    // IM-2 sits on broad ground and is the geometry test; the de Gerlache point is on a narrow rim, where 20 m and 60 m grids differ
    if (id === 'chk_im2' && (s.rms > 0.1 || Math.abs(B.sunPct - A.sunPct) > 0.01 || Math.abs(B.earthPct - A.earthPct) > 0.01)) fail = true;
    heightRows.push(heightCheck(name, loadSite(chk, id)));
  } else console.log(`| ${name} | site grids | not built (see the top of this file) | | | | | | |`);
  const C = analyseLocal(fromGlobal(lat, lon), samples, 1 / 6);
  line('whole-Moon 1.9 km grid (LDEM_16)', C, stats(A.profile.horizon, C.profile.horizon));
}

if (heightRows.length) {
  console.log('\nHeights of those site grids against the polar grids at the same places (finest polar grid loaded there)\n');
  console.log('| Site | Site-grid level and ring | Points | Mean difference m | RMS difference m | Largest m |');
  console.log('|---|---|---|---|---|---|');
  console.log(heightRows.join('\n'));
}

// 4
console.log('\n4. Bundled sites beyond the polar map (2026-11-15 + 29.53 days, 10-minute steps)\n');
console.log('| Site | Route | Finest grid | Elevation m | Slope ° | Sunlit % | Earth in view % | Longest dark h | Longest gap h | Score | Horizon vs site grids: largest / RMS ° |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const id of ['im1', 'apollo17']) {
  const st = loadSite(new URL('sites/', root), id);
  const A = analyseLocal(st, samples, 1 / 6), C = analyseLocal(fromGlobal(st.lat, st.lon), samples, 1 / 6), s = stats(A.profile.horizon, C.profile.horizon);
  const hz = st.hazard();
  const line = (route, r, q) => console.log(`| ${st.name} | ${route} | ${r.terrain.label} | ${r.elevation.toFixed(0)} | ${r.slope.toFixed(1)} | ${p2(r.sunPct)} | ${p2(r.earthPct)} | ${r.longestDarkH.toFixed(1)} | ${r.longestMuteH.toFixed(1)} | ${r.score} | ${q} |`);
  line('site grids', A, 'reference');
  line('whole-Moon 1.9 km grid', C, s.max.toFixed(2) + ' / ' + s.rms.toFixed(3));
  let hmax = -9, hmin = 9; for (const v of A.profile.horizon) { if (v > hmax) hmax = v; if (v < hmin) hmin = v; }
  console.log(`|  | horizon ${(hmin / DEG).toFixed(2)}° to ${(hmax / DEG).toFixed(2)}°; steepest ground within 1 km ${hz.max.toFixed(1)}°, ${(hz.share * 100).toFixed(0)}% over 15° | | | | | | | | | |`);
}
console.log(fail ? '\nFAIL' : '\nOK');
if (fail) process.exit(1);
