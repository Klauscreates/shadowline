// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { moonSky, loadHorizons, horizonsRange } from './ephemeris.js?v=26';
import { loadTerrain, analyseSite, skyAt, mapToLatLon, latLonToMap, scoreOf, HORIZON_N, TilePyramid } from './terrain.js?v=26';
import { Gpu } from './gpu.js?v=26';
import { LocalPatch, gridSurface } from './patch.js?v=26';

// If the browser kept an older copy of the page next to this newer script, reload once to get a matching set.
const BUILD = '26';
if (document.querySelector('meta[name="build"]')?.content !== BUILD) {
  if (!/[?&]fresh=/.test(location.search)) location.replace(location.pathname + '?fresh=' + Date.now());
  throw new Error('This page is out of date. Please reload.');
}

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const DAY = 86400000;
const EXAG_VIEW = 3;      // default display stretch of heights; 1 = true scale
let EXAG = EXAG_VIEW;     // display only: every sunlight / Earth / slope number uses true heights
const PIN_COLORS = ['#ffc65a', '#5db4ff', '#58e0a0', '#ff8fb1'];
const BASE_MESH_N = 768;  // vertices a side of the whole-map mesh
const coarse = matchMedia('(pointer: coarse)').matches;
const FEATURES = [
  ['South Pole', -90, 0, 'pole'],
  ['Shackleton', -89.67, 129.78], ['de Gerlache', -88.5, -87.1], ['Shoemaker', -88.14, 45.91],
  ['Faustini', -87.18, 84.31], ['Haworth', -87.45, -5.17], ['Cabeus', -85.33, -42.13],
  ['Nobile', -85.28, 53.27], ['Amundsen', -84.44, 85.76], ['Sverdrup', -88.3, -152.0],
  ['Slater', -88.08, 111.29], ['Malapert', -85.99, 2.9], ['Wiechert', -83.9, 163.0],
];

// ---------- renderer / scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x020308, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 30000);
camera.position.set(0, 1500, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 10;
controls.maxDistance = 1400;
controls.maxPolarAngle = 86 * DEG;
controls.zoomSpeed = 0.9;
controls.enabled = false;

const toWorldDir = (d) => new THREE.Vector3(d[0], d[2], -d[1]);
let terrain, gpu, pyramid = null;

/** Height (m) of the surface as drawn: a finer patch where one is shown, otherwise the 250 m map. Display only. */
function surfaceH(x, y) {
  if (detail.inner && detail.inner.contains(x, y)) return detail.inner.surface(x, y);
  if (detail.outer && detail.outer.contains(x, y)) return detail.outer.surface(x, y);
  return terrain.height(x, y);
}
function mapToWorld(x, y, lift = 0) {
  return new THREE.Vector3(x / 1000, surfaceH(x, y) * EXAG / 1000 + lift, -y / 1000);
}

// ---------- sharper visible terrain near the camera target ----------
// Two nested mesh patches follow the point the camera looks at: an 80 m patch, and inside it a
// 20 m patch where 20 m tiles are bundled. They change the picture only. Shadows on them still
// come from the 250 m light map, and no number in the report is taken from them.
const detail = { outer: null, inner: null, L80: null, L20: null, last: 0, busy80: false, busy20: false, label: '' };
const NO_HOLE = [1, 1, -1, -1];
function initDetail() {
  if (!pyramid) return;
  detail.L80 = pyramid.levels.find((l) => l.px === 80) || null;
  detail.L20 = pyramid.levels.find((l) => l.px === 20) || null;
  if (!detail.L80) return;
  const n = coarse ? 385 : 513;
  detail.outer = new LocalPatch(gpu, n, 80, 1);
  scene.add(detail.outer.mesh);
  if (detail.L20) { detail.inner = new LocalPatch(gpu, n, 20, 2); scene.add(detail.inner.mesh); }
  // the drawn surface of the base mesh (768 x 768 vertices over the whole map)
  const bn = BASE_MESH_N, bc = terrain.L * 2 / (bn - 1);
  detail.baseSurface = (x, y) => gridSurface(-terrain.L, -terrain.L, bc, bn, (i, j) => terrain.height(-terrain.L + i * bc, -terrain.L + j * bc), x, y);
}
function updateDetail(now) {
  const o = detail.outer; if (!o || now - detail.last < 200) return;
  detail.last = now;
  const dist = camera.position.distanceTo(controls.target);
  const cx = controls.target.x * 1000, cy = -controls.target.z * 1000;
  const L80 = detail.L80, L20 = detail.L20, inn = detail.inner;
  let changed = false;
  // 80 m patch
  const wantO = dist < 170 && Math.hypot(cx, cy) < terrain.L * 0.85;
  if (!wantO) { if (o.active) { o.hide(); changed = true; } }
  else if (!o.active || Math.max(Math.abs(cx - o.cx), Math.abs(cy - o.cy)) > o.span / 4) {
    const r = o.span / 2 + 400;
    if (L80.covers(cx, cy, r)) {
      o.build(cx, cy, (x, y) => { const h = L80.height(x, y); return h === h ? h : terrain.height(x, y); }, detail.baseSurface, -L80.L + 40);
      if (inn) inn.hide();          // its edge was fitted to the old 80 m patch
      changed = true;
    } else if (!detail.busy80) {
      detail.busy80 = true;
      L80.ensure(cx, cy, r).catch(() => {}).then(() => { detail.busy80 = false; });
    }
  }
  // 20 m patch, only where 20 m tiles are bundled and it fits inside the 80 m patch
  if (inn) {
    const r = inn.span / 2 + 100;
    const fits = o.active && Math.max(Math.abs(cx - (o.x0 + o.span / 2)), Math.abs(cy - (o.y0 + o.span / 2))) < o.span / 2 - r - 3000;
    const wantI = wantO && fits && dist < 70 && L20.exists(cx, cy, r);
    if (!wantI) { if (inn.active) { inn.hide(); changed = true; } }
    else if (!inn.active || Math.max(Math.abs(cx - inn.cx), Math.abs(cy - inn.cy)) > inn.span / 4) {
      if (L20.covers(cx, cy, r)) {
        inn.build(cx, cy, (x, y) => { const h = L20.height(x, y); return h === h ? h : o.surface(x, y); }, (x, y) => o.surface(x, y), -L20.L + 10);
        changed = true;
      } else if (!detail.busy20) {
        detail.busy20 = true;
        L20.ensure(cx, cy, r).catch(() => {}).then(() => { detail.busy20 = false; });
      }
    }
  }
  if (!changed) return;
  if (o.active) o.hole(gpu.terrainUniforms.uHole.value); else gpu.terrainUniforms.uHole.value.fromArray(NO_HOLE);
  if (inn && inn.active) inn.hole(o.uniforms.uHole.value); else o.uniforms.uHole.value.fromArray(NO_HOLE);
  for (const p of state.pins) placePin(p);
  const g = inn && inn.active ? '20 m' : o.active ? '80 m' : '250 m';
  if (g !== detail.label) {
    detail.label = g;
    $('detail').innerHTML = `Surface near the view centre drawn from the <b>${g}</b> grid${g === '250 m' ? '' : ' · shadows still from the 250 m map'}`;
  }
}

// stars
{
  const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * 2 * Math.PI, s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(a) * 9000, u * 9000, s * Math.sin(a) * 9000], i * 3);
    const b = 0.35 + Math.random() ** 3 * 0.65, w = Math.random();
    col.set([b * (0.85 + 0.15 * w), b * 0.92, b * (1 - 0.15 * w)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
}

// sun glow
const sunSprite = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.06, 'rgba(255,248,225,1)');
  grd.addColorStop(0.12, 'rgba(255,220,150,0.55)'); grd.addColorStop(0.4, 'rgba(255,170,70,0.12)'); grd.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.set(420, 420, 1);
  scene.add(s);
  return s;
})();

// earth
const earthUniforms = { uSunW: { value: new THREE.Vector3(1, 0, 0) } };
const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.ShaderMaterial({
  uniforms: earthUniforms,
  vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform vec3 uSunW; varying vec3 vN; varying vec3 vW;
    void main(){
      vec3 n = normalize(vN);
      float d = max(dot(n, uSunW), 0.0);
      float c = sin(n.x*7.0+1.3)*sin(n.y*9.0+0.4)*sin(n.z*6.0+2.1) + 0.35*sin(n.x*17.0)*sin(n.z*15.0+n.y*9.0);
      vec3 base = mix(vec3(0.04,0.17,0.50), vec3(0.16,0.40,0.20), smoothstep(0.08,0.24,c));
      float cl = smoothstep(0.15,0.65, sin(n.x*12.0+n.y*5.0+1.0)*sin(n.y*10.0-n.z*7.0) + 0.3*sin(n.z*23.0+n.x*9.0));
      base = mix(base, vec3(1.0), cl*0.7);
      vec3 v = normalize(cameraPosition - vW);
      float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
      vec3 col = base * (0.015 + d*1.25) + vec3(0.25,0.55,1.0) * rim * (0.08 + d);
      gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
    }`,
}));
scene.add(earthMesh);

// ---------- labels ----------
const labelRoot = $('labels');
const labels = [];   // { el, pos(Vector3) | getPos() }
function addLabel(text, cls, getPos) {
  const el = document.createElement('div');
  el.className = 'lbl ' + (cls || '');
  el.textContent = text;
  labelRoot.appendChild(el);
  const l = { el, getPos };
  labels.push(l);
  return l;
}
function removeLabel(l) { l.el.remove(); labels.splice(labels.indexOf(l), 1); }
const tmpV = new THREE.Vector3();
function updateLabels() {
  const w = innerWidth, h = innerHeight;
  for (const l of labels) {
    tmpV.copy(l.getPos()).project(camera);
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
    l.el.style.display = vis ? '' : 'none';
    if (vis) { l.el.style.left = ((tmpV.x * 0.5 + 0.5) * w).toFixed(1) + 'px'; l.el.style.top = ((-tmpV.y * 0.5 + 0.5) * h).toFixed(1) + 'px'; }
  }
}

// ---------- state ----------
const state = {
  start: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
  spanDays: 29.53,
  t: 0,
  playing: false,
  speed: 1,          // days per second
  layer: 0,
  samples: [], stepHours: 1,
  sky: null,
  pins: [], selected: -1, nextLetter: 0,
  accumList: [], accumIdx: 0, heat: null,
  lightDirty: true,
  wantBest: false,
  compare: false,
  missionDays: 14, windows: null,
};
state.t = state.start;

function sampleAt(ms) {
  const s = moonSky(new Date(ms));
  return { t: ms, source: s.source, sunDir: s.sun.dir, earthPos: s.earth.pos, earthDir: s.earth.dir, sunLat: s.sun.lat, sunLon: s.sun.lon, earthLat: s.earth.lat, earthLon: s.earth.lon };
}

// Named sites. Coordinates are approximate (lat, lon east, degrees).
const PRESETS = [
  ['Shackleton ridge', 'Long-sunlight ridge beside Shackleton', -89.45, -137.31],
  ['de Gerlache rim', 'Sunlit rim, Artemis III candidate area', -88.71, -68.10],
  ["Chang'e-7 candidate", 'Peak near Shackleton, not final', -88.80, 123.40],
  ['IM-2 Athena target', 'Mons Mouton, CLPS, 2025', -84.78, 29.13],
  ['Malapert massif', 'High ground facing Earth', -85.99, 2.90],
  ['Haworth', 'Artemis III candidate area', -87.45, -5.17],
  ['LCROSS impact, Cabeus', 'Water found here in 2009', -84.68, -48.72],
  ['Shackleton floor', 'Permanent shadow, for contrast', -89.67, 129.78],
];

function rebuildWindow() {
  const span = state.spanDays;
  state.stepHours = span <= 31 ? 1 : span <= 100 ? 2 : 6;
  const n = Math.round(span * 24 / state.stepHours);
  state.samples = [];
  for (let i = 0; i < n; i++) state.samples.push(sampleAt(state.start + i * state.stepHours * 3600000));
  // heat maps use at most ~300 evenly spaced samples
  const k = Math.max(1, Math.ceil(n / 300));
  state.accumList = state.samples.filter((_, i) => i % k === 0);
  state.accumIdx = 0;
  state.heat = null; state.heatMax = null;
  gpu.terrainUniforms.uHeatMax.value.set(1, 1, 1);
  gpu.resetAccum();
  state.t = Math.min(Math.max(state.t, state.start), state.start + span * DAY - 1);
  for (const p of state.pins) p.report = analyseSite(terrain, p.x, p.y, state.samples, state.stepHours, p.fine ? pyramid : null);
  // show the window's start and end under the time slider
  $('winStart').textContent = dayLabelY(state.start);
  $('winEnd').textContent = dayLabelY(state.start + span * DAY);
  $('winMid').textContent = span <= 31 ? '1 lunar day · 29.5 days' : 'window: ' + windowName();
  renderPanel();
  updateLegend();
}

// ---------- pins ----------
function nearestFeature(x, y) {
  let best = null, bd = 30000;
  for (const f of FEATURES) {
    const [fx, fy] = latLonToMap(f[1], f[2]);
    const d = Math.hypot(fx - x, fy - y);
    if (d < bd) { bd = d; best = f[0]; }
  }
  return best;
}

/** Fetch the finer tiles around a site, then redo its horizon, slope and report with the finest grid available there. */
async function refinePin(pin) {
  if (!pyramid) return;
  try {
    await pyramid.ensure(pin.x, pin.y);
    if (!state.pins.includes(pin)) return;
    pin.fine = true; pin.mis = null;
    pin.report = analyseSite(terrain, pin.x, pin.y, state.samples, state.stepHours, pyramid);
    state.windows = null;
    renderPanel();
  } catch (e) { console.warn('fine terrain not used for site ' + pin.letter, e); }
}
/** Put a pin's marker on the drawn surface (depends on the vertical scale in use). */
function placePin(pin) {
  pin.group.position.copy(mapToWorld(pin.x, pin.y));
  sizePins();
}
/** Markers shrink as the camera comes closer, so they do not hide the ground they mark. */
function sizePins() {
  const s = Math.min(1, Math.max(0.06, camera.position.distanceTo(controls.target) / 170));
  for (const p of state.pins) {
    p.group.scale.setScalar(s);
    p.top.copy(p.group.position); p.top.y += 46 * s;
  }
}
function addPin(x, y, select = true, name = null) {
  if (state.pins.length >= PIN_COLORS.length) removePin(0);
  const used = new Set(state.pins.map((p) => p.color));
  const color = PIN_COLORS.find((c) => !used.has(c));
  const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[state.nextLetter++ % 26];
  const group = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 46, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  beam.position.y = 23;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.4;
  group.add(beam, ring);
  scene.add(group);
  const top = new THREE.Vector3();
  const label = addLabel(letter, 'pin', () => top);
  label.el.style.background = color; label.el.style.color = '#0a0d14';
  const pin = { x, y, color, letter, name, group, beam, ring, top, label, near: nearestFeature(x, y), report: analyseSite(terrain, x, y, state.samples, state.stepHours) };
  state.pins.push(pin);
  placePin(pin);
  refinePin(pin);
  if (select || state.selected < 0) state.selected = state.pins.length - 1;
  $('hint').classList.add('gone');
  renderPanel();
  return pin;
}
function removePin(i) {
  const p = state.pins[i];
  scene.remove(p.group); removeLabel(p.label);
  state.pins.splice(i, 1);
  state.selected = Math.min(state.selected, state.pins.length - 1);
  if (state.selected < 0 && state.pins.length) state.selected = 0;
  renderPanel();
}

// ---------- panel ----------
const fmtDur = (h) => (h >= 48 ? (h / 24).toFixed(1) + ' d' : Math.round(h) + ' h');
const fmtLat = (v) => Math.abs(v).toFixed(2) + '°' + (v < 0 ? 'S' : 'N');
const fmtLon = (v) => Math.abs(v).toFixed(1) + '°' + (v < 0 ? 'W' : 'E');
const pct = (v) => Math.round(v * 100) + '%';
const pct1 = (v) => (v * 100).toFixed(v > 0.9995 || v < 0.0005 ? 0 : 1) + '%';
const dayLabel = (ms) => { const d = new Date(ms); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); };
const dayLabelY = (ms) => { const d = new Date(ms); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); };
const windowName = () => (state.spanDays >= 100 ? '1 year' : state.spanDays > 31 ? '3 months' : '29.53 days');

const siteLabel = (p) => (p.name ? ' · ' + p.name : p.near ? ' · near ' + p.near : '');
const SUN_R_DEG = 0.2666;
const fmtIn = (h) => (h < 1 ? 'under 1 h' : h >= 48 ? (h / 24).toFixed(1) + ' days' : Math.round(h) + ' h');

/** Time from the selected moment to the next change of Sun / Earth visibility at a site. */
function nextEvents(r, sunOn, earthOn) {
  const S = r.series, n = S.sun.length;
  const f = (state.t - state.start) / (state.stepHours * 3600000);
  const i0 = Math.min(n - 1, Math.max(0, Math.floor(f)));
  const scan = (cur, on) => {
    for (let j = i0 + 1; j < n; j++) if (on(j) !== cur) return (j - f) * state.stepHours;
    return null;
  };
  return { sunH: scan(sunOn, (i) => S.sun[i] > 0.05), earthH: scan(earthOn, (i) => S.earth[i] === 1) };
}
const sunEventText = (on, h) => (h === null ? (on ? 'No sunset in this window' : 'No sunrise in this window') : (on ? 'Sunset in ' : 'Sunrise in ') + fmtIn(h));
const earthEventText = (on, h) => (h === null ? (on ? 'No Earthset in this window' : 'No Earthrise in this window') : (on ? 'Earthset in ' : 'Earthrise in ') + fmtIn(h));
const clearText = (el, hor) => { const d = (el - hor) / DEG; return `${Math.abs(d).toFixed(1)}° ${d >= 0 ? 'above' : 'below'} the terrain`; };

// ---------- mission scenario: arrival date, mission length, launch slips ----------
const SLIPS = [0, 1, 3, 7];
const SEARCH_DAYS = 60;
let ephCache = { start: 0, list: [] };
function ephHours(n) {
  if (ephCache.start !== state.start) ephCache = { start: state.start, list: [] };
  for (let i = ephCache.list.length; i < n; i++) ephCache.list.push(sampleAt(state.start + i * 3600000));
  return ephCache.list;
}
function pinHours(p, n) {
  if (!p.mis || p.mis.start !== state.start) p.mis = { start: state.start, sun: [], earth: [] };
  const L = ephHours(n);
  for (let i = p.mis.sun.length; i < n; i++) {
    const s = skyAt(p.report.profile, L[i]);
    p.mis.sun.push(s.sunFrac); p.mis.earth.push(s.earthVis);
  }
  return p.mis;
}
/** Sunlight / Earth contact for one site over a mission starting offH hours after the arrival date. */
function missionStats(p, offH, lenH) {
  const mm = pinHours(p, offH + lenH);
  let su = 0, ea = 0, bo = 0, run = 0, best = 0;
  for (let i = offH; i < offH + lenH; i++) {
    const a = mm.sun[i], b = mm.earth[i];
    su += a; ea += b; bo += a * b;
    if (a < 0.05) { run++; if (run > best) best = run; } else run = 0;
  }
  return { sun: su / lenH, earth: ea / lenH, both: bo / lenH, darkH: best };
}
const missionPins = () => (state.compare ? state.pins : [state.pins[state.selected]]);
const windowsKey = () => state.start + '|' + state.missionDays + '|' + missionPins().map((p) => p.letter).join('');
function findWindows() {
  const P = missionPins(), lenH = Math.round(state.missionDays * 24), res = [];
  for (let d = 0; d < SEARCH_DAYS; d++) {
    let su = 0, ea = 0, bo = 0;
    for (const p of P) { const s = missionStats(p, d * 24, lenH); su += s.sun; ea += s.earth; bo += s.both; }
    res.push({ d, sun: su / P.length, earth: ea / P.length, both: bo / P.length });
  }
  const top = [];
  for (const r of [...res].sort((a, b) => b.both - a.both || b.sun - a.sun)) {
    if (top.every((t) => Math.abs(t.d - r.d) >= 4)) top.push(r);
    if (top.length === 3) break;
  }
  state.windows = { key: windowsKey(), res, top };
}
function missionHtml() {
  const P = missionPins(), lenH = Math.round(state.missionDays * 24), multi = P.length > 1;
  const slipName = (d) => (d ? `+${d} d` : 'On time');
  const rows = SLIPS.map((d) => ({ d, st: P.map((p) => missionStats(p, d * 24, lenH)) }));
  let table;
  if (multi) {
    table = `<table class="mis"><thead><tr><th>Arrival</th>${P.map((p) => `<td><span class="pin-dot" style="background:${p.color}">${p.letter}</span></td>`).join('')}</tr></thead><tbody>
      ${rows.map((r) => `<tr><th>${slipName(r.d)}<small>${dayLabel(state.start + r.d * DAY)}</small></th>${r.st.map((s) => `<td><span class="on-s">${pct(s.sun)}</span> <span class="on-e">${pct(s.earth)}</span><small>dark ${fmtDur(s.darkH)}</small></td>`).join('')}</tr>`).join('')}
      </tbody></table><div class="key"><span><i style="background:var(--sun)"></i>Sunlit share</span><span><i style="background:var(--earth)"></i>Earth in view</span><span class="dimkey">over the mission</span></div>`;
  } else {
    const base = rows[0].st[0];
    const delta = (v, b) => { const x = Math.round((v - b) * 100); return x ? `<small class="${x > 0 ? 'up' : 'down'}">${x > 0 ? '+' : ''}${x}</small>` : ''; };
    table = `<table class="mis"><thead><tr><th>Arrival</th><td>Sunlit</td><td>Earth</td><td>Both</td><td>Longest dark</td></tr></thead><tbody>
      ${rows.map((r) => { const s = r.st[0]; return `<tr><th>${slipName(r.d)}<small>${dayLabel(state.start + r.d * DAY)}</small></th><td><span class="on-s">${pct(s.sun)}</span>${r.d ? delta(s.sun, base.sun) : ''}</td><td><span class="on-e">${pct(s.earth)}</span>${r.d ? delta(s.earth, base.earth) : ''}</td><td>${pct(s.both)}${r.d ? delta(s.both, base.both) : ''}</td><td>${fmtDur(s.darkH)}</td></tr>`; }).join('')}
      </tbody></table>`;
  }
  let win = '';
  const W = state.windows && state.windows.key === windowsKey() ? state.windows : null;
  if (W) {
    win = `<div class="block-title">Best arrival dates <span>next ${SEARCH_DAYS} days, ${state.missionDays}-day mission</span></div>
      <div class="arrbars" title="Share of the mission with sunlight and Earth contact together, by arrival date">${W.res.map((r) => `<i data-arr="${r.d}" class="${W.top.includes(r) ? 'top' : ''}" style="height:${Math.max(4, Math.round(r.both * 100))}%"></i>`).join('')}</div>
      <div class="axis" style="padding-left:6px"><span>${dayLabel(state.start)}</span><span>${dayLabel(state.start + 30 * DAY)}</span><span>${dayLabel(state.start + (SEARCH_DAYS - 1) * DAY)}</span></div>
      <div class="arrlist">${W.top.map((r, k) => `<button data-arr="${r.d}"><b>${k + 1}. Arrive ${dayLabel(state.start + r.d * DAY)}</b><span><span class="on-s">Sun ${pct(r.sun)}</span> · <span class="on-e">Earth ${pct(r.earth)}</span> · both ${pct(r.both)}</span><em>${r.d ? 'Use this date' : 'Current date'}</em></button>`).join('')}</div>
      <div class="note">Bar height is the share of the mission with sunlight and Earth contact together${multi ? ', averaged over the pinned sites' : ''}. ${coarse ? 'Tap' : 'Click'} a bar or a date to move the arrival there.</div>`;
  }
  return `<div class="block-title">Mission and launch slip <span>${dayLabel(state.start)} → ${dayLabel(state.start + state.missionDays * DAY)} if on time</span></div>
    <div class="mis-row"><label>Mission length <input id="misDays" type="number" inputmode="numeric" min="1" max="60" step="1" value="${state.missionDays}"> days</label><button data-act="windows">Find arrival windows</button></div>
    ${table}
    <div class="note">Each row is the same ${state.missionDays}-day mission starting that many days late. The arrival date is the Start date in the time bar.</div>
    ${win}`;
}

function compareHtml() {
  const P = state.pins, R = P.map((p) => p.report);
  const row = (label, vals, fmt, hi, cls = '') => {
    const m = hi ? Math.max(...vals) : Math.min(...vals), mixed = vals.some((v) => v !== m);
    return `<tr class="${cls}"><th>${label}</th>${vals.map((v) => `<td class="${hi !== null && mixed && v === m ? 'best' : ''}">${fmt(v)}</td>`).join('')}</tr>`;
  };
  const sec = (t) => `<tr class="sec"><th colspan="${P.length + 1}">${t}</th></tr>`;
  return `<div class="cmp-wrap"><table class="cmp">
    <thead><tr><th></th>${P.map((p, i) => `<td data-i="${i}" title="Open full report"><span class="pin-dot" style="background:${p.color}">${p.letter}</span><div class="cmp-name">${p.name || (p.near ? 'near ' + p.near : '')}</div></td>`).join('')}</tr></thead>
    <tbody>
    ${row('Score', R.map((r) => r.score), (v) => v, true, 'big')}
    ${sec('At the selected time')}
    <tr><th>Sun</th>${P.map((_, i) => `<td id="cmpSun${i}"></td>`).join('')}</tr>
    <tr><th>Earth</th>${P.map((_, i) => `<td id="cmpEarth${i}"></td>`).join('')}</tr>
    ${sec('Power')}
    ${row('Sunlit', R.map((r) => r.sunPct), pct1, true)}
    ${row('Longest dark', R.map((r) => r.longestDarkH), fmtDur, false)}
    ${sec('Communications')}
    ${row('Earth in view', R.map((r) => r.earthPct), pct1, true)}
    ${row('Longest gap', R.map((r) => r.longestMuteH), fmtDur, false)}
    ${row('Sun + Earth', R.map((r) => r.bothPct), pct1, true)}
    ${sec('Ground')}
    ${row('Slope', R.map((r) => r.slope), (v) => v.toFixed(1) + '°', false)}
    <tr><th>Slope baseline</th>${R.map((r) => `<td>${Math.round(r.slopeBaseM / 10) * 10} m</td>`).join('')}</tr>
    <tr><th>Terrain grid</th>${R.map((r) => `<td>${r.terrain.label}</td>`).join('')}</tr>
    ${row('Elevation', R.map((r) => r.elevation), (v) => Math.round(v).toLocaleString() + ' m', null)}
    ${row('Latitude', R.map((r) => r.lat), (v) => Math.abs(v).toFixed(2) + '°S', null)}
    ${row('Longitude', R.map((r) => r.lon), (v) => Math.abs(v).toFixed(1) + '°' + (v < 0 ? 'W' : 'E'), null)}
    </tbody></table></div>
    ${missionHtml()}
    <div class="note">Green marks the best value in each row. ${coarse ? 'Tap' : 'Click'} a site letter to open its full report. Window: ${new Date(state.start).toISOString().slice(0, 10)} + ${windowName()}.</div>`;
}
function drawCompare() {
  state.pins.forEach((p, i) => {
    const s = $('cmpSun' + i), e = $('cmpEarth' + i); if (!s || !e) return;
    const now = skyAt(p.report.profile, state.sky), sunOn = now.sunFrac > 0.05, earthOn = !!now.earthVis;
    const ev = nextEvents(p.report, sunOn, earthOn);
    s.innerHTML = `<span class="${sunOn ? 'on-s' : 'off'}">${sunOn ? 'Lit' : 'Dark'}</span><small>${sunEventText(sunOn, ev.sunH).replace(' in this window', '').replace(' in ', '<br>in ')}</small>`;
    e.innerHTML = `<span class="${earthOn ? 'on-e' : 'off'}">${earthOn ? 'In view' : 'Hidden'}</span><small>${earthEventText(earthOn, ev.earthH).replace(' in this window', '').replace(' in ', '<br>in ')}</small>`;
  });
}

function dataSourceText() {
  const rng = horizonsRange();
  if (!rng) return 'computed in the browser (checked against NASA JPL Horizons)';
  const end = state.start + state.spanDays * DAY;
  if (state.start >= rng[0] && end <= rng[1]) return 'NASA JPL Horizons, hourly';
  return 'NASA JPL Horizons where available (Nov 2026 to Dec 2027), computed in the browser outside that';
}
function scoreParts(r) {
  const slopeSafe = Math.min(Math.max((15 - r.slope) / 10, 0), 1);
  return { sun: 45 * r.sunPct, earth: 35 * r.earthPct, slope: 20 * slopeSafe, slopeSafe, halved: r.slope > 15 };
}
function scoreTable(r) {
  const s = scoreParts(r);
  return `<table class="sum">
    <tr><td>Sunlight</td><td>${pct1(r.sunPct)} × 45</td><td>${s.sun.toFixed(1)}</td></tr>
    <tr><td>Earth contact</td><td>${pct1(r.earthPct)} × 35</td><td>${s.earth.toFixed(1)}</td></tr>
    <tr><td>Gentle slope</td><td>${s.slopeSafe.toFixed(2)} × 20</td><td>${s.slope.toFixed(1)}</td></tr>
    ${s.halved ? '<tr class="pen"><td>Steeper than 15°</td><td>total × 0.5</td><td></td></tr>' : ''}
    <tr class="tot"><td>Score</td><td>out of 100</td><td>${r.score}</td></tr></table>
    <div class="note">Example weights, not a NASA standard: power counts most, then Earth contact, then safe ground. Use the separate numbers above if your mission weighs them differently.</div>`;
}
function siteSummary(p) {
  const r = p.report;
  return [
    `Shadowline site ${p.letter}${siteLabel(p)}`,
    `Latitude ${r.lat.toFixed(4)} deg, longitude ${r.lon.toFixed(4)} deg E, elevation ${Math.round(r.elevation)} m`,
    `Window: ${new Date(state.start).toISOString().slice(0, 10)} UTC + ${windowName()}, step ${state.stepHours} h`,
    `Sunlit ${pct1(r.sunPct)} of window, longest dark stretch ${fmtDur(r.longestDarkH)}`,
    `Earth in view ${pct1(r.earthPct)} of window, longest loss of contact ${fmtDur(r.longestMuteH)}`,
    `Sunlight and Earth contact together ${pct1(r.bothPct)}`,
    `Slope ${r.slope.toFixed(1)} deg (${Math.round(r.slopeBaseM / 10) * 10} m baseline)`,
    `Score ${r.score}/100 (45% sunlight, 35% Earth contact, 20% slope)`,
    `Terrain: ${r.terrain.products}; observer 2 m above ground`,
  ].join('\n');
}
function siteCsv(p) {
  const r = p.report, S = r.series, deg = (v) => (v / DEG);
  const az = (v) => ((deg(v) % 360) + 360) % 360;
  const L = [
    '# Shadowline site time series',
    `# site,${p.letter}`,
    `# latitude_deg,${r.lat.toFixed(5)}`,
    `# longitude_deg_east,${r.lon.toFixed(5)}`,
    `# elevation_m,${r.elevation.toFixed(1)}`,
    `# slope_deg,${r.slope.toFixed(2)}`,
    `# sunlit_fraction,${r.sunPct.toFixed(4)}`,
    `# earth_visible_fraction,${r.earthPct.toFixed(4)}`,
    `# both_fraction,${r.bothPct.toFixed(4)}`,
    `# score,${r.score}`,
    `# step_hours,${state.stepHours}`,
    `# terrain,${r.terrain.products.replace(/,/g, ';')}`,
    `# slope_baseline_m,${Math.round(r.slopeBaseM)}`,
    '# observer_height_m,2',
    `# sun_earth_positions,${dataSourceText()}`,
    '# notes,elevations are of the body centre above the local horizontal; azimuth is clockwise from north; sun_visible_fraction is the share of the solar disk diameter above the terrain horizon',
    'utc,sun_visible_fraction,sun_elevation_deg,sun_azimuth_deg,earth_visible,earth_elevation_deg,earth_azimuth_deg',
  ];
  for (let i = 0; i < S.sun.length; i++) {
    L.push([new Date(state.samples[i].t).toISOString().slice(0, 19) + 'Z', S.sun[i].toFixed(3), deg(S.sunEl[i]).toFixed(3), az(S.sunAz[i]).toFixed(2),
      S.earth[i], deg(S.earthEl[i]).toFixed(3), az(S.earthAz[i]).toFixed(2)].join(','));
  }
  return L.join('\n') + '\n';
}

function verdict(r) {
  const weak = [];
  if (r.sunPct < 0.5) weak.push(`little sunlight (${pct(r.sunPct)})`);
  else if (r.longestDarkH > 120) weak.push(`${fmtDur(r.longestDarkH)} of unbroken darkness`);
  if (r.earthPct < 0.5) weak.push(`poor Earth contact (${pct(r.earthPct)})`);
  if (r.slope > 10) weak.push(`steep ground (${r.slope.toFixed(0)}°)`);
  if (!weak.length) {
    return r.sunPct > 0.7 && r.earthPct > 0.7
      ? '<span style="color:var(--good)">Strong candidate.</span> Long sunlight, steady Earth contact, gentle ground.'
      : '<span style="color:var(--good)">Workable.</span> No major weakness in this window.';
  }
  return `<span style="color:var(--bad)">Weak on:</span> ${weak.join(', ')}.`;
}

let chartCache = null;   // { horizonBg, stripBg, range }
function renderPanel() {
  const panel = $('panel');
  $('clearPins').hidden = !state.pins.length;
  if (!state.pins.length) { panel.hidden = true; chartCache = null; updateViewOffset(); return; }
  panel.hidden = false;
  $('pinTabs').innerHTML = state.pins.map((p, i) =>
    `<button class="pin-tab ${i === state.selected ? 'on' : ''}" data-i="${i}">
       <span class="pin-dot" style="background:${p.color}">${p.letter}</span>
       <b>${p.report.score}</b><span class="x" data-x="${i}" title="Remove">✕</span>
     </button>`).join('') + (state.pins.length > 1 ? `<button class="pin-tab cmp ${state.compare ? 'on' : ''}" data-cmp="1">Compare</button>` : '');
  if (state.pins.length < 2) state.compare = false;
  if (state.selected < 0 || state.selected >= state.pins.length) state.selected = 0;
  if (state.compare) {
    $('pinTabs').querySelectorAll('[data-i]').forEach((b) => b.classList.remove('on'));
    $('siteBody').innerHTML = compareHtml();
    chartCache = null;
    updateViewOffset();
    drawCompare();
    return;
  }
  const p = state.pins[state.selected], r = p.report;
  const circ = 2 * Math.PI * 34;
  $('siteBody').innerHTML = `
    <div class="site-head">
      <div class="score-ring">
        <svg viewBox="0 0 82 82"><circle cx="41" cy="41" r="34" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/>
        <circle cx="41" cy="41" r="34" fill="none" stroke="${p.color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(circ * r.score / 100).toFixed(1)} ${circ.toFixed(1)}"/></svg>
        <div class="num"><div>${r.score}<small>SCORE</small></div></div>
      </div>
      <div>
        <div class="site-name">Site ${p.letter}${siteLabel(p)}</div>
        <div class="site-coord"><span class="res ${r.terrain.hi ? 'hi' : ''}" title="${r.terrain.note}">${r.terrain.label} terrain</span>${Math.abs(r.lat).toFixed(3)}°${r.lat < 0 ? 'S' : 'N'} · ${Math.abs(r.lon).toFixed(2)}°${r.lon < 0 ? 'W' : 'E'}</div>
        <div class="verdict">${verdict(r)}</div>
      </div>
    </div>
    <div class="block-title">At the selected time</div>
    <div class="now-row"><div class="now-chip sun" id="nowSun"></div><div class="now-chip earth" id="nowEarth"></div></div>
    <div class="look"><button data-act="hview">Horizon view (eye level)</button><button data-act="lookSun">3D toward Sun</button><button data-act="lookEarth">3D toward Earth</button></div>
    <div class="step"><div class="step-h"><i>1</i><b>Power</b><span>sunlight over the window</span></div>
      <div class="metrics">
        <div class="metric sun"><div class="k">Sunlit</div><div class="v">${pct1(r.sunPct)}</div><div class="s">of the window</div></div>
        <div class="metric"><div class="k">Longest dark stretch</div><div class="v">${fmtDur(r.longestDarkH)}</div><div class="s">Sun behind terrain</div></div>
      </div></div>
    <div class="step"><div class="step-h"><i>2</i><b>Communications</b><span>direct line to Earth</span></div>
      <div class="metrics">
        <div class="metric earth"><div class="k">Earth in view</div><div class="v">${pct1(r.earthPct)}</div><div class="s">of the window</div></div>
        <div class="metric"><div class="k">Longest loss of contact</div><div class="v">${fmtDur(r.longestMuteH)}</div><div class="s">Earth behind terrain</div></div>
      </div></div>
    <div class="step"><div class="step-h"><i>3</i><b>Ground</b><span>is it safe to set down</span></div>
      <div class="metrics">
        <div class="metric"><div class="k">Slope</div><div class="v" style="color:${r.slope > 15 ? 'var(--bad)' : r.slope > 10 ? 'var(--sun)' : 'var(--good)'}">${r.slope.toFixed(1)}°</div><div class="s">over a ${Math.round(r.slopeBaseM / 10) * 10} m baseline</div></div>
        <div class="metric"><div class="k">Elevation</div><div class="v">${Math.round(r.elevation).toLocaleString()} m</div><div class="s">vs 1,737.4 km sphere</div></div>
      </div></div>
    <div class="step"><div class="step-h"><i>4</i><b>Both at once</b><span>powered and in contact</span></div>
      <div class="metrics one">
        <div class="metric"><div class="k">Sunlight and Earth contact together</div><div class="v">${pct1(r.bothPct)}</div><div class="s">of the window</div></div>
      </div></div>
    ${missionHtml()}
    <div class="block-title">Window timeline <span>${coarse ? 'tap' : 'click'} to jump</span></div>
    <canvas class="chart" id="strip" height="58"></canvas>
    <div class="axis"><span>${dayLabel(state.start)}</span><span>${dayLabel(state.start + state.spanDays * DAY / 2)}</span><span>${dayLabel(state.start + state.spanDays * DAY)}</span></div>
    <div class="block-title">Sky from this site <span>looking north, full circle</span></div>
    <canvas class="chart" id="horizon" height="150"></canvas>
    <div class="key"><span><i style="background:var(--sun)"></i>Sun path</span><span><i style="background:var(--earth)"></i>Earth path</span><span><i style="background:#7c8490"></i>Terrain horizon</span><span class="dimkey">faint = hidden</span></div>
    <div class="block-title">How the score adds up</div>
    ${scoreTable(r)}
    <div class="export"><button data-act="csv">Download data (CSV)</button><button data-act="copy">Copy summary</button></div>
    <div class="note">Window: ${new Date(state.start).toISOString().slice(0, 10)} + ${windowName()}, sampled every ${state.stepHours} h. Terrain: ${r.terrain.note}${!p.fine && pyramid ? ' (loading finer grids…)' : ''}; antenna 2 m above ground. Sun and Earth positions: ${dataSourceText()}.</div>`;
  updateViewOffset();
  if (panel.classList.contains('mini')) { chartCache = null; return; }
  buildCharts();
  drawCharts();
}

function setupCanvas(c) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = c.clientWidth, h = +c.getAttribute('height');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  c.style.height = h + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h, dpr };
}
function offscreen(w, h, dpr) {
  const c = document.createElement('canvas'); c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, g };
}

function buildCharts() {
  const p = state.pins[state.selected]; if (!p) return;
  const r = p.report, S = r.series, n = S.sun.length;
  // timeline strip
  const sc = setupCanvas($('strip'));
  const sb = offscreen(sc.w, sc.h, sc.dpr);
  const rowH = 19, x0 = 44, ww = sc.w - x0 - 6;
  sb.g.font = '10.5px system-ui'; sb.g.textBaseline = 'middle';
  sb.g.fillStyle = '#ffc65a'; sb.g.fillText('Sun', 8, 8 + rowH / 2);
  sb.g.fillStyle = '#5db4ff'; sb.g.fillText('Earth', 8, 8 + rowH + 4 + rowH / 2);
  for (let px = 0; px < ww; px++) {
    const i0 = Math.floor(px / ww * n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / ww * n));
    let a = 0, b = 0;
    for (let i = i0; i < i1; i++) { a += S.sun[i]; b += S.earth[i]; }
    a /= i1 - i0; b /= i1 - i0;
    sb.g.fillStyle = `rgba(255,198,90,${0.08 + 0.92 * a})`; sb.g.fillRect(x0 + px, 8, 1.2, rowH);
    sb.g.fillStyle = `rgba(93,180,255,${0.08 + 0.92 * b})`; sb.g.fillRect(x0 + px, 8 + rowH + 4, 1.2, rowH);
  }
  // horizon panorama, centred on north (toward Earth for most polar sites)
  const hc = setupCanvas($('horizon'));
  const hb = offscreen(hc.w, hc.h, hc.dpr);
  let maxEl = 4 * DEG;
  for (let i = 0; i < n; i++) maxEl = Math.max(maxEl, S.earthEl[i]);
  for (let k = 0; k < HORIZON_N; k++) maxEl = Math.max(maxEl, r.profile.horizon[k]);
  const lo = -3 * DEG, hi = Math.min(maxEl + 1.5 * DEG, 30 * DEG);
  const X = (az) => { let a = az; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return (a / (2 * Math.PI) + 0.5) * hc.w; };
  const Y = (el) => hc.h - 16 - (el - lo) / (hi - lo) * (hc.h - 22);
  const g = hb.g;
  const sky = g.createLinearGradient(0, 0, 0, hc.h); sky.addColorStop(0, '#05070d'); sky.addColorStop(1, '#0b1220');
  g.fillStyle = sky; g.fillRect(0, 0, hc.w, hc.h);
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(hc.w, Y(0)); g.stroke(); g.setLineDash([]);
  for (let i = 0; i < n; i++) {
    g.fillStyle = S.earth[i] ? 'rgba(93,180,255,.75)' : 'rgba(93,180,255,.18)';
    g.fillRect(X(S.earthAz[i]) - 0.8, Y(S.earthEl[i]) - 0.8, 1.6, 1.6);
    g.fillStyle = S.sun[i] > 0.5 ? 'rgba(255,198,90,.85)' : 'rgba(255,198,90,.16)';
    g.fillRect(X(S.sunAz[i]) - 0.8, Y(S.sunEl[i]) - 0.8, 1.6, 1.6);
  }
  g.beginPath(); g.moveTo(0, hc.h);
  for (let px = 0; px <= hc.w; px++) {
    const az = (px / hc.w - 0.5) * 2 * Math.PI;
    let f = ((az / (2 * Math.PI)) * HORIZON_N + HORIZON_N) % HORIZON_N;
    const i = f | 0, a = f - i;
    const el = r.profile.horizon[i] * (1 - a) + r.profile.horizon[(i + 1) % HORIZON_N] * a;
    g.lineTo(px, Y(Math.max(el, lo)));
  }
  g.lineTo(hc.w, hc.h); g.closePath();
  const gr = g.createLinearGradient(0, 0, 0, hc.h); gr.addColorStop(0, 'rgba(120,128,140,.95)'); gr.addColorStop(1, 'rgba(30,34,42,.98)');
  g.fillStyle = gr; g.fill();
  g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '10px system-ui'; g.textAlign = 'center';
  [['S', -180], ['W', -90], ['N', 0], ['E', 90], ['S', 180]].forEach(([t, a]) => g.fillText(t, Math.min(Math.max(X(a * DEG * 0.9999), 7), hc.w - 7), hc.h - 4));
  g.textAlign = 'left'; g.fillText((hi / DEG).toFixed(0) + '°', 4, 11); g.fillText('0°', 4, Y(0) - 3);
  chartCache = { strip: sb.c, horizon: hb.c, x0, ww, X, Y };
}

function drawCharts() {
  drawHview();
  if (state.compare) { drawCompare(); return; }
  const p = state.pins[state.selected]; if (!p || !chartCache || !chartCache.strip.width || !chartCache.horizon.width) return;
  const now = skyAt(p.report.profile, state.sky);
  const f = (state.t - state.start) / (state.spanDays * DAY);
  const strip = $('strip'), hor = $('horizon'); if (!strip || !hor) return;
  let g = strip.getContext('2d'); const dpr = Math.min(devicePixelRatio, 2);
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, strip.width, strip.height); g.drawImage(chartCache.strip, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#fff'; g.fillRect(chartCache.x0 + f * chartCache.ww - 0.75, 3, 1.5, 52);
  g = hor.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, hor.width, hor.height); g.drawImage(chartCache.horizon, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dot = (az, el, col, rad) => {
    const x = chartCache.X(az), y = chartCache.Y(el);
    g.beginPath(); g.arc(x, y, rad + 4, 0, 7); g.fillStyle = col + '33'; g.fill();
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
  };
  dot(now.earthAz, now.earthEl, '#5db4ff', 5);
  dot(now.sunAz, now.sunEl, '#ffc65a', 4);
  const ns = $('nowSun'), ne = $('nowEarth');
  const sunOn = now.sunFrac > 0.05, earthOn = !!now.earthVis;
  const ev = nextEvents(p.report, sunOn, earthOn);
  ns.className = 'now-chip sun ' + (sunOn ? 'on' : 'off');
  ns.innerHTML = `<b>${now.sunFrac > 0.95 ? 'In sunlight' : sunOn ? 'Partial sun ' + pct(now.sunFrac) : 'In shadow'}</b><span>Sun ${clearText(now.sunEl, now.sunHor)}</span><em>${sunEventText(sunOn, ev.sunH)}</em>`;
  ne.className = 'now-chip earth ' + (earthOn ? 'on' : 'off');
  ne.innerHTML = `<b>${earthOn ? 'Earth in view' : 'No Earth contact'}</b><span>Earth ${clearText(now.earthEl, now.earthHor)}</span><em>${earthEventText(earthOn, ev.earthH)}</em>`;
}

$('pinTabs').addEventListener('click', (e) => {
  const x = e.target.closest('[data-x]');
  if (x) { removePin(+x.dataset.x); return; }
  if (e.target.closest('[data-cmp]')) { state.compare = !state.compare; renderPanel(); return; }
  const b = e.target.closest('[data-i]');
  if (b) { state.selected = +b.dataset.i; state.compare = false; renderPanel(); flyTo(state.pins[state.selected]); }
});
$('siteBody').addEventListener('click', (e) => {
  const col = e.target.closest('table.cmp thead [data-i]');
  if (col) { state.selected = +col.dataset.i; state.compare = false; renderPanel(); flyTo(state.pins[state.selected]); return; }
  const arr = e.target.closest('[data-arr]');
  if (arr) {
    const d = +arr.dataset.arr;
    if (d > 0) {
      const v = state.start + d * DAY;
      state.start = v; state.t = v; state.windows = null;
      $('startDate').value = new Date(v).toISOString().slice(0, 10);
      rebuildWindow(); setTime(v);
    }
    return;
  }
  if (e.target.dataset?.act === 'windows') {
    e.target.textContent = 'Searching…';
    setTimeout(() => { findWindows(); renderPanel(); }, 30);
    return;
  }
  const act = e.target.dataset?.act, pin = state.pins[state.selected];
  if (act === 'hview' && pin) { openHview('sun'); return; }
  if ((act === 'lookSun' || act === 'lookEarth') && pin) { lookFrom(pin, act === 'lookSun' ? 'sun' : 'earth'); return; }
  if (act === 'csv' && pin) {
    const url = URL.createObjectURL(new Blob([siteCsv(pin)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `shadowline-site-${pin.letter}-${new Date(state.start).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  if (act === 'copy' && pin) {
    const btn = e.target, done = (ok) => { btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = 'Copy summary'; }, 1600); };
    (navigator.clipboard ? navigator.clipboard.writeText(siteSummary(pin)) : Promise.reject()).then(() => done(true), () => done(false));
    return;
  }
  if (e.target.id !== 'strip' || !chartCache) return;
  const rect = e.target.getBoundingClientRect();
  const f = Math.min(Math.max((e.clientX - rect.left - chartCache.x0) / chartCache.ww, 0), 0.9999);
  setTime(state.start + f * state.spanDays * DAY);
});
$('siteBody').addEventListener('change', (e) => {
  if (e.target.id !== 'misDays') return;
  state.missionDays = Math.min(60, Math.max(1, Math.round(+e.target.value || 14)));
  state.windows = null;
  renderPanel();
});
$('clearPins').addEventListener('click', () => { while (state.pins.length) removePin(0); });
$('panelToggle').addEventListener('click', () => {
  const mini = $('panel').classList.toggle('mini');
  $('panelToggle').textContent = mini ? '▴' : '▾';
  if (!mini) renderPanel();
  updateViewOffset();
});

// Keep the map centred in the part of the screen the report does not cover.
function updateViewOffset() {
  const w = innerWidth, h = innerHeight, panel = $('panel');
  let ox = 0, oy = 0;
  if (!panel.hidden) {
    const r = panel.getBoundingClientRect();
    if (r.width > w * 0.7) oy = Math.max(0, Math.round(h / 2 - (84 + r.top) / 2));
    else ox = Math.max(0, Math.round(w / 2 - r.left / 2));
  }
  if (ox || oy) camera.setViewOffset(w, h, ox, oy, w, h); else camera.clearViewOffset();
}

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
function pick(cx, cy) {
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  if (d.y >= -1e-4) return null;
  const yMax = terrain.meta.max_m * EXAG / 1000, yMin = terrain.meta.min_m * EXAG / 1000;
  let t = o.y > yMax ? (yMax - o.y) / d.y : 0;
  const tEnd = (yMin - o.y) / d.y, step = detail.outer && detail.outer.active ? 0.1 : 0.3;
  const below = (tt) => {
    const mx = (o.x + d.x * tt) * 1000, my = -(o.z + d.z * tt) * 1000;
    if (Math.hypot(mx, my) > terrain.L * 0.97) return null;
    return o.y + d.y * tt <= surfaceH(mx, my) * EXAG / 1000;
  };
  for (; t <= tEnd + step; t += step) {
    if (below(t)) {
      let a = t - step, b = t;
      for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (below(m)) b = m; else a = m; }
      return { x: (o.x + d.x * b) * 1000, y: -(o.z + d.z * b) * 1000 };
    }
  }
  return null;
}

let down = null, hoverXY = null;
const activePtrs = new Set();
canvas.addEventListener('pointerdown', (e) => {
  activePtrs.add(e.pointerId);
  // a second finger means pinch / pan, never a tap
  down = activePtrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  if (e.pointerType !== 'mouse') hoverXY = null;
});
canvas.addEventListener('pointerup', (e) => {
  activePtrs.delete(e.pointerId);
  if (down && terrain) {
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const tol = e.pointerType === 'mouse' ? 6 : 12;
    if (moved < tol && performance.now() - down.t < 600) {
      const hit = pick(e.clientX, e.clientY);
      if (hit) addPin(hit.x, hit.y);
    }
  }
  down = null;
});
canvas.addEventListener('pointercancel', (e) => { activePtrs.delete(e.pointerId); down = null; });
canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') hoverXY = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerleave', () => { hoverXY = null; });

function updateHover() {
  const el = $('hover');
  if (!hoverXY || !gpu || down) { el.hidden = true; if (gpu) gpu.terrainUniforms.uHover.value.z = 0; return; }
  const hit = pick(hoverXY.x, hoverXY.y);
  if (!hit) { el.hidden = true; gpu.terrainUniforms.uHover.value.z = 0; return; }
  gpu.terrainUniforms.uHover.value.set((hit.x / terrain.L) * 0.5 + 0.5, (hit.y / terrain.L) * 0.5 + 0.5, 1);
  const ll = mapToLatLon(hit.x, hit.y);
  let extra = '';
  if (state.heat && state.layer >= 1 && state.layer <= 3) {
    const n = state.heat.size;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((hit.x / terrain.L) * 0.5 + 0.5) * n)));
    const j = Math.min(n - 1, Math.max(0, Math.floor(((hit.y / terrain.L) * 0.5 + 0.5) * n)));
    const v = state.heat.data[(j * n + i) * 4 + state.layer - 1] / 255;
    extra = `<br><b>${['Sunlight', 'Earth in view', 'Power + link'][state.layer - 1]} ${pct(v)}</b>`;
  } else if (state.layer === 4) extra = `<br><b>Slope ${terrain.slope(hit.x, hit.y).toFixed(1)}°</b>`;
  el.innerHTML = `${fmtLat(ll.lat)} · ${fmtLon(ll.lon)}<br>${Math.round(terrain.height(hit.x, hit.y)).toLocaleString()} m${extra}`;
  el.hidden = false;
  el.style.left = Math.min(hoverXY.x + 16, innerWidth - 150) + 'px';
  el.style.top = (hoverXY.y + 16) + 'px';
}

// ---------- vertical scale: 3x stretched (default) or true scale ----------
const featureLabels = [];
function setExag(v) {
  if (!terrain || v === EXAG) return;
  const groundY = () => surfaceH(controls.target.x * 1000, -controls.target.z * 1000) * EXAG / 1000;
  const before = groundY();
  EXAG = v;
  gpu.terrainUniforms.uExag.value = v;
  // keep the camera the same distance above the ground it is looking at
  const dy = groundY() - before;
  tween = null; controls.enabled = true;
  controls.target.y += dy; camera.position.y += dy;
  for (const fl of featureLabels) fl.pos.copy(mapToWorld(fl.x, fl.y, fl.lift));
  for (const p of state.pins) placePin(p);
  const b = $('scaleBtn'), real = v === 1;
  b.classList.toggle('true', real);
  b.setAttribute('aria-pressed', String(real));
  b.querySelector('b').textContent = real ? 'True scale' : 'Heights ×' + EXAG_VIEW;
  b.querySelector('span').textContent = real ? '1 : 1' : 'exaggerated';
  b.title = real ? 'Heights are drawn at true scale. Click to stretch them ' + EXAG_VIEW + '× again.' : 'Heights are drawn ' + EXAG_VIEW + '× taller than real so craters read clearly. Click for true scale.';
}
$('scaleBtn').addEventListener('click', () => setExag(EXAG === 1 ? EXAG_VIEW : 1));

// ---------- camera moves ----------
let tween = null;
// ---------- eye-level horizon view ----------
// A first-person panorama drawn from the same 720-direction terrain horizon the numbers use,
// so what is seen here is exactly what the site test measured. Equal angular scale on both axes.
const hv = { open: false, az: 0, fov: 70, track: 'sun' };
const EARTH_R_M = 6371000;
function hvHorizon(profile, az) {
  let f = (az / (2 * Math.PI)) * HORIZON_N;
  f = ((f % HORIZON_N) + HORIZON_N) % HORIZON_N;
  const i = f | 0, a = f - i;
  return profile.horizon[i] * (1 - a) + profile.horizon[(i + 1) % HORIZON_N] * a;
}
function openHview(track) {
  hv.open = true; hv.track = track; hv.fov = innerWidth < 900 ? 50 : 70;
  $('hview').hidden = false;
  if (innerWidth < 900 && !$('panel').classList.contains('mini')) { $('panel').classList.add('mini'); $('panelToggle').textContent = '▴'; }
  drawHview();
}
function closeHview() { hv.open = false; $('hview').hidden = true; }
function drawHview() {
  if (!hv.open) return;
  const p = state.pins[state.selected];
  if (!p || !state.sky) { closeHview(); return; }
  const c = $('hvCanvas'), dpr = Math.min(devicePixelRatio, 2), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const prof = p.report.profile, now = skyAt(prof, state.sky);
  if (hv.track === 'sun') hv.az = now.sunAz; else if (hv.track === 'earth') hv.az = now.earthAz;
  const ppd = w / hv.fov, span = h / ppd, elLo = -span * 0.36;      // pixels per degree; degrees at the bottom edge
  const dAz = (az) => { const d = (az - hv.az) / DEG; return ((d + 540) % 360) - 180; };
  const X = (az) => w / 2 + dAz(az) * ppd, Y = (elRad) => h - (elRad / DEG - elLo) * ppd;

  g.fillStyle = '#02030a'; g.fillRect(0, 0, w, h);
  // stars (fixed pattern, decoration only)
  for (let i = 0; i < 260; i++) {
    const a = ((i * 137.508) % 360) * DEG, e = (((i * 61.8034) % 100) / 100) * 62 - 4, s = 0.5 + ((i * 7) % 5) * 0.22;
    const x = X(a), y = h - (e - elLo) * ppd;
    if (x > -2 && x < w + 2 && y > 0 && y < h) { g.fillStyle = `rgba(255,255,255,${0.25 + ((i * 13) % 7) * 0.09})`; g.fillRect(x, y, s, s); }
  }
  // elevation grid
  const stepEl = [1, 2, 5, 10, 20].find((v) => v * ppd >= 34) || 20;   // keep labels at least 34 px apart
  g.font = '10.5px system-ui'; g.textBaseline = 'middle';
  for (let e = Math.ceil(elLo / stepEl) * stepEl; e < elLo + span; e += stepEl) {
    const y = h - (e - elLo) * ppd;
    g.strokeStyle = e === 0 ? 'rgba(255,255,255,.34)' : 'rgba(255,255,255,.09)'; g.setLineDash(e === 0 ? [6, 5] : [2, 5]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.5)'; g.textAlign = 'left'; g.fillText((e > 0 ? '+' : '') + e + '°' + (e === 0 ? ' level' : ''), 6, y - 7);
  }
  g.setLineDash([]);

  // Sun: glow and true-size disk
  const sx = X(now.sunAz), sy = Y(now.sunEl), sr = Math.max(SUN_R_DEG * ppd, 1.6);
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 14);
  glow.addColorStop(0, 'rgba(255,236,190,.55)'); glow.addColorStop(0.25, 'rgba(255,198,90,.16)'); glow.addColorStop(1, 'rgba(255,198,90,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(sx, sy, sr * 14, 0, 7); g.fill();
  g.fillStyle = '#fff6dc'; g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.fill();

  // Earth: true-size disk with the right phase
  const eDist = Math.hypot(state.sky.earthPos[0], state.sky.earthPos[1], state.sky.earthPos[2]);
  const er = Math.max(Math.asin(EARTH_R_M / eDist) / DEG * ppd, 2.5), ex = X(now.earthAz), ey = Y(now.earthEl);
  const sd = state.sky.sunDir, ed = state.sky.earthDir;
  const lit = (1 - (sd[0] * ed[0] + sd[1] * ed[1] + sd[2] * ed[2])) / 2;      // share of Earth's disk that is sunlit
  g.save(); g.translate(ex, ey); g.rotate(Math.atan2(sy - ey, sx - ex));
  g.fillStyle = '#0b1b33'; g.beginPath(); g.arc(0, 0, er, 0, 7); g.fill();
  const b = er * (2 * lit - 1);
  g.fillStyle = '#6fb8ff'; g.beginPath(); g.arc(0, 0, er, -Math.PI / 2, Math.PI / 2);
  if (b >= 0) g.ellipse(0, 0, Math.abs(b), er, 0, Math.PI / 2, Math.PI * 1.5, false); else g.ellipse(0, 0, Math.abs(b), er, 0, Math.PI / 2, -Math.PI / 2, true);
  g.fill(); g.restore();

  // terrain skyline (drawn last so it hides whatever is behind it)
  g.beginPath(); g.moveTo(0, h);
  for (let px = 0; px <= w; px += 1) g.lineTo(px, Y(hvHorizon(prof, hv.az + ((px - w / 2) / ppd) * DEG)));
  g.lineTo(w, h); g.closePath();
  const tg = g.createLinearGradient(0, Y(8 * DEG), 0, h); tg.addColorStop(0, '#565a63'); tg.addColorStop(0.5, '#23262d'); tg.addColorStop(1, '#0b0c10');
  g.fillStyle = tg; g.fill();
  g.strokeStyle = now.sunFrac > 0.05 ? 'rgba(255,236,200,.75)' : 'rgba(170,180,196,.55)'; g.lineWidth = 1.2;
  g.beginPath();
  for (let px = 0; px <= w; px += 1) { const y = Y(hvHorizon(prof, hv.az + ((px - w / 2) / ppd) * DEG)); if (px) g.lineTo(px, y); else g.moveTo(px, y); }
  g.stroke();

  // labels on the bodies when they clear the terrain; edge arrows when they are out of view
  g.font = '600 11.5px system-ui'; g.textAlign = 'center';
  const tag = (x, y, r, text, col, above) => { if (x < 30 || x > w - 30) return; g.fillStyle = col; g.fillText(text, x, above ? y - r - 11 : y + r + 12); };
  tag(sx, sy, sr, now.sunFrac > 0.05 ? 'Sun' : 'Sun (behind terrain)', '#ffc65a', true);
  tag(ex, ey, er, now.earthVis ? 'Earth' : 'Earth (behind terrain)', '#5db4ff', true);
  const arrow = (az, name, col, row) => {
    const d = dAz(az); if (Math.abs(d) < hv.fov / 2) return;
    g.fillStyle = col; g.textAlign = d > 0 ? 'right' : 'left';
    g.fillText(d > 0 ? `${name}: turn ${Math.round(Math.abs(d))}° right ▶` : `◀ ${name}: turn ${Math.round(Math.abs(d))}° left`, d > 0 ? w - 8 : 8, 16 + row * 16);
  };
  arrow(now.sunAz, 'Sun', '#ffc65a', 0); arrow(now.earthAz, 'Earth', '#5db4ff', 1);

  // compass along the bottom
  const stepAz = hv.fov > 90 ? 30 : hv.fov > 40 ? 15 : 5, names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  g.font = '10.5px system-ui'; g.textAlign = 'center';
  const c0 = hv.az / DEG - hv.fov / 2;
  for (let a = Math.ceil(c0 / stepAz) * stepAz; a <= c0 + hv.fov; a += stepAz) {
    const x = w / 2 + (a - hv.az / DEG) * ppd, aa = ((a % 360) + 360) % 360;
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, h - 16, 1, 5);
    g.fillStyle = names[aa] ? '#fff' : 'rgba(255,255,255,.55)'; g.fillText(names[aa] || aa + '°', x, h - 6);
  }

  $('hvTitle').textContent = `Horizon view · Site ${p.letter}`;
  $('hvRead').innerHTML = `<span class="s">Sun ${clearText(now.sunEl, now.sunHor)}</span> · <span class="e">Earth ${clearText(now.earthEl, now.earthHor)}</span>`;
  $('hview').querySelector('[data-hv="sun"]').classList.toggle('on', hv.track === 'sun');
  $('hview').querySelector('[data-hv="earth"]').classList.toggle('on', hv.track === 'earth');
}
$('hview').addEventListener('click', (e) => {
  const a = e.target.closest('[data-hv]')?.dataset.hv; if (!a) return;
  if (a === 'close') { closeHview(); return; }
  if (a === 'sun' || a === 'earth') hv.track = a;
  if (a === 'in') hv.fov = Math.max(8, hv.fov / 1.4);
  if (a === 'out') hv.fov = Math.min(140, hv.fov * 1.4);
  drawHview();
});
{
  const cv = $('hvCanvas'); let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, az: hv.az }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; hv.track = null; hv.az = drag.az - ((e.clientX - drag.x) / (cv.clientWidth / hv.fov)) * DEG; drawHview(); });
  const end = () => { drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); hv.fov = Math.min(140, Math.max(8, hv.fov * (e.deltaY > 0 ? 1.15 : 0.87))); drawHview(); }, { passive: false });
  new ResizeObserver(() => drawHview()).observe(cv);
}

/** Low third-person view across a site toward the Sun or Earth, so the horizon and long shadows are seen from near ground level. */
function lookFrom(pin, body) {
  const w = toWorldDir(body === 'sun' ? state.sky.sunDir : state.sky.earthDir);
  const l = Math.hypot(w.x, w.z) || 1, back = 34;
  const tgt = mapToWorld(pin.x, pin.y);
  const px = tgt.x - (w.x / l) * back, pz = tgt.z - (w.z / l) * back;
  let py = tgt.y + 3.2;
  const mx = px * 1000, my = -pz * 1000;
  if (terrain.inside(mx, my)) py = Math.max(py, surfaceH(mx, my) * EXAG / 1000 + 1.6);
  flyCamera(new THREE.Vector3(px, py, pz), tgt, 1500);
}
function flyCamera(toPos, toTarget, ms = 1600) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: toPos, t1: toTarget, start: performance.now(), ms };
}
function flyTo(pin) {
  const tgt = mapToWorld(pin.x, pin.y);
  const off = camera.position.clone().sub(controls.target);
  const dist = Math.min(off.length(), 170);
  off.setLength(dist);
  flyCamera(tgt.clone().add(off), tgt, 1200);
}
function stepTween(now) {
  if (!tween) return;
  let k = Math.min((now - tween.start) / tween.ms, 1);
  k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.lerpVectors(tween.p0, tween.p1, k);
  controls.target.lerpVectors(tween.t0, tween.t1, k);
  if (k >= 1) { tween = null; controls.enabled = true; }
}
canvas.addEventListener('pointerdown', () => { if (tween && controls.enabled) tween = null; });

// ---------- time ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function setTime(ms) {
  const end = state.start + state.spanDays * DAY;
  if (ms >= end) ms = state.start + ((ms - state.start) % (state.spanDays * DAY));
  if (ms < state.start) ms = state.start;
  state.t = ms;
  state.sky = sampleAt(ms);
  state.lightDirty = true;
  const d = new Date(ms);
  $('clock').textContent = `${d.getUTCFullYear()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  $('skyRead').innerHTML = `<span class="s">Sun ${(-state.sky.sunLat).toFixed(2)}°</span> and <span class="e">Earth ${(-state.sky.earthLat).toFixed(2)}°</span> above the pole's flat horizon · <span class="src-tag">${state.sky.source === 'horizons' ? 'NASA JPL Horizons' : 'computed in browser'}</span>`;
  if (document.activeElement !== $('scrub')) $('scrub').value = Math.round((ms - state.start) / (state.spanDays * DAY) * 1000);
  // sky objects
  const sw = toWorldDir(state.sky.sunDir);
  sunSprite.position.copy(sw).multiplyScalar(4000);
  earthUniforms.uSunW.value.copy(sw);
  earthMesh.position.copy(toWorldDir(state.sky.earthDir)).multiplyScalar(4000);
  earthMesh.scale.setScalar(4000 * Math.tan(0.95 * DEG) * 1.6);
  drawCharts();
}
$('play').addEventListener('click', () => { state.playing = !state.playing; $('play').textContent = state.playing ? '❚❚' : '▶'; });
$('scrub').addEventListener('input', (e) => { setTime(state.start + (+e.target.value / 1000) * state.spanDays * DAY * 0.9999); });
$('speed').addEventListener('change', (e) => { state.speed = +e.target.value; });
$('span').addEventListener('change', (e) => { state.spanDays = +e.target.value; rebuildWindow(); setTime(state.t); });
$('startDate').addEventListener('change', (e) => {
  const v = Date.parse(e.target.value + 'T00:00:00Z');
  if (!isFinite(v)) return;
  state.start = v; state.t = v; rebuildWindow(); setTime(v);
});
addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); $('play').click(); } });

// ---------- layers / legend ----------
const LEGENDS = {
  1: ['Share of the window in sunlight', 'linear-gradient(90deg,#08081f,#5c126e,#db404c,#fca633,#fffab8)', '0%', '100%'],
  2: ['Share of the window with Earth above the horizon', 'linear-gradient(90deg,#050812,#0f3385,#339ef2,#e0faff)', '0%', '100%'],
  3: ['Share of the window with sunlight and Earth together', 'linear-gradient(90deg,#050d0f,#0a6161,#59e0a1,#f2ffe0)', '0%', '100%'],
  4: ['Ground slope over a 500 m baseline', 'linear-gradient(90deg,#4ddb99 0%,#4ddb99 12%,#fad652 25%,#fa8038 37%,#b31f2e 62%,#290a14 100%)', '0°', '40°'],
};
function updateLegend() {
  const L = LEGENDS[state.layer];
  $('legend').hidden = !L;
  if (!L) return;
  $('legendTitle').textContent = L[0]; $('legendBar').style.background = L[1]; $('legendLo').textContent = L[2]; $('legendHi').textContent = state.layer < 4 && state.heatMax ? pct(state.heatMax[state.layer - 1]) + ' (best on map)' : L[3];
  const done = state.accumIdx >= state.accumList.length;
  $('legendProgress').textContent = state.layer < 4 && !done ? `Adding up the window… ${Math.round(state.accumIdx / state.accumList.length * 100)}%` : '';
}
$('layers').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.layer = +b.dataset.layer;
  for (const x of $('layers').children) x.classList.toggle('on', x === b);
  gpu.terrainUniforms.uLayer.value = state.layer;
  updateLegend();
});

// ---------- best sites ----------
function findBest() {
  const { data, size } = state.heat;
  const cands = [];
  const rMax = 150000;   // keep clear of the map edge so horizons are complete
  for (let j = 2; j < size - 2; j += 1) {
    for (let i = 2; i < size - 2; i += 1) {
      const x = ((i + 0.5) / size * 2 - 1) * terrain.L, y = ((j + 0.5) / size * 2 - 1) * terrain.L;
      if (x * x + y * y > rMax * rMax) continue;
      const k = (j * size + i) * 4;
      const sun = data[k] / 255, earth = data[k + 1] / 255;
      if (sun < 0.2 || earth < 0.2) continue;
      const slope = terrain.slope(x, y);
      if (slope > 10) continue;
      cands.push([scoreOf(sun, earth, slope), x, y]);
    }
  }
  cands.sort((a, b) => b[0] - a[0]);
  const chosen = [];
  for (const c of cands) {
    if (chosen.every((o) => Math.hypot(o[1] - c[1], o[2] - c[2]) > 25000)) chosen.push(c);
    if (chosen.length === 3) break;
  }
  while (state.pins.length) removePin(0);
  for (const c of chosen) addPin(c[1], c[2], false);
  if (state.pins.length) {
    let best = 0;
    state.pins.forEach((p, i) => { if (p.report.score > state.pins[best].report.score) best = i; });
    state.selected = best; renderPanel(); flyTo(state.pins[best]);
  }
  $('findBest').textContent = '✦ Find best sites';
  $('findBest').disabled = false;
}
$('findBest').addEventListener('click', () => {
  if (state.heat) { findBest(); return; }
  state.wantBest = true; $('findBest').disabled = true; $('findBest').textContent = 'Scanning the window…';
});
$('aboutBtn').addEventListener('click', () => $('about').showModal());

// ---------- add a site: named sites and typed coordinates ----------
const fmtPreset = (lat, lon) => `${Math.abs(lat).toFixed(2)}°S · ${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`;
$('presetList').innerHTML = PRESETS.map((s, i) => `<button type="button" data-p="${i}"><b>${s[0]}</b><span>${s[1]}</span><i>${fmtPreset(s[2], s[3])}</i></button>`).join('');
function dropSite(lat, lon, name) {
  const [x, y] = latLonToMap(lat, lon);
  if (!terrain || !terrain.inside(x, y)) return false;
  const pin = addPin(x, y, true, name);
  $('sites').close();
  flyTo(pin);
  return true;
}
const coordMsg = (t, err) => { $('coordMsg').textContent = t; $('coordMsg').classList.toggle('err', !!err); };
$('addSite').addEventListener('click', () => { coordMsg('The map covers the south pole out to about 81.6°S.'); $('sites').showModal(); });
$('sitesClose').addEventListener('click', () => $('sites').close());
$('sites').addEventListener('click', (e) => { if (e.target === $('sites')) $('sites').close(); });
$('presetList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  const s = PRESETS[+b.dataset.p];
  dropSite(s[2], s[3], s[0]);
});
$('coordForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const num = (v) => parseFloat(String(v).replace(',', '.').replace(/[^0-9.+-]/g, ''));
  let lat = num($('latIn').value), lon = num($('lonIn').value);
  if (!isFinite(lat) || !isFinite(lon)) { coordMsg('Enter both numbers, for example 89.45 and 137.31.', true); return; }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 360) { coordMsg('Latitude must be 0 to 90 and longitude 0 to 360.', true); return; }
  lat = -Math.abs(lat);
  if (/w/i.test($('lonIn').value) || $('lonHemi').value === 'W') lon = -Math.abs(lon);
  lon = ((lon + 540) % 360) - 180;
  if (!dropSite(lat, lon, null)) coordMsg('That point is off this map, which covers the south pole out to about 81.6°S.', true);
});

// ---------- loop ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  updateViewOffset();
}
const timebarEl = $('timebar');
const syncTimebar = () => document.documentElement.style.setProperty('--tbh', timebarEl.offsetHeight + 'px');
new ResizeObserver(() => { syncTimebar(); updateViewOffset(); }).observe(timebarEl);
syncTimebar();
if (coarse) $('hint').textContent = 'Three sites are loaded. Tap the surface to test your own.';
addEventListener('resize', () => { resize(); if (state.pins.length) renderPanel(); });

let last = performance.now(), slow = 0, frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(now - last, 100); last = now;
  if (!gpu) return;
  if (state.playing) setTime(state.t + (dt / 1000) * state.speed * DAY);

  // heat maps: a few time samples per frame
  if (state.accumIdx < state.accumList.length) {
    for (let k = 0; k < 3 && state.accumIdx < state.accumList.length; k++) gpu.accumulate(state.accumList[state.accumIdx++]);
    state.lightDirty = true;
    if (state.accumIdx >= state.accumList.length) {
      state.heat = gpu.readAccum();
      // stretch each heat map to the best value actually present, so the top areas stand out
      const hd = state.heat.data, mxs = [1, 1, 1];
      for (let i = 0; i < hd.length; i += 4) { if (hd[i] > mxs[0]) mxs[0] = hd[i]; if (hd[i + 1] > mxs[1]) mxs[1] = hd[i + 1]; if (hd[i + 2] > mxs[2]) mxs[2] = hd[i + 2]; }
      state.heatMax = mxs.map((v) => Math.max(v / 255, 0.05));
      gpu.terrainUniforms.uHeatMax.value.set(state.heatMax[0], state.heatMax[1], state.heatMax[2]);
      updateLegend();
      if (state.wantBest) { state.wantBest = false; findBest(); }
    }
    if (state.layer) updateLegend();
  }
  if (state.lightDirty) { gpu.setSky(state.sky); gpu.renderLight(); state.lightDirty = false; }

  stepTween(now);
  controls.update();
  updateDetail(now);
  updateHover();
  sizePins();
  for (const p of state.pins) p.ring.scale.setScalar(1 + 0.12 * Math.sin(now / 400 + p.x));
  renderer.render(scene, camera);
  updateLabels();

  // drop light-map resolution on slow GPUs
  frames++; if (dt > 45) slow++;
  if (frames === 240) { if (slow > 120 && gpu.lightSize > 512) { gpu.lightSize = 512; gpu.light.setSize(512, 512); state.lightDirty = true; } frames = slow = 0; }
}

async function boot() {
  resize();
  $('startDate').value = new Date(state.start).toISOString().slice(0, 10);
  try { await loadHorizons(); } catch (e) { console.warn('JPL Horizons table not loaded; positions are computed in the browser', e); }
  terrain = await loadTerrain((f) => { $('loadText').textContent = `Loading NASA terrain… ${Math.round(f * 100)}%`; });
  try { pyramid = await TilePyramid.open(); } catch (e) { pyramid = null; }
  gpu = new Gpu(renderer, terrain, 1024);
  gpu.terrainUniforms.uExag.value = EXAG;
  const size = terrain.L * 2 / 1000;
  const geo = new THREE.PlaneGeometry(size, size, BASE_MESH_N - 1, BASE_MESH_N - 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, gpu.terrainMat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  initDetail();

  for (const f of FEATURES) {
    const [x, y] = latLonToMap(f[1], f[2]);
    const fl = { x, y, lift: f[3] ? 9 : 5, pos: mapToWorld(x, y, f[3] ? 9 : 5) };
    featureLabels.push(fl);
    addLabel(f[0], f[3] || '', () => fl.pos);
  }
  addLabel('SUN', 'sky sun', () => sunSprite.position);
  addLabel('EARTH', 'sky earth', () => earthMesh.position);

  state.sky = sampleAt(state.t);
  rebuildWindow();
  setTime(state.t);
  for (const i of [0, 1, 3]) { const s = PRESETS[i], [sx, sy] = latLonToMap(s[2], s[3]); addPin(sx, sy, false, s[0]); }
  state.selected = 0;
  if (innerWidth < 900) { $('panel').classList.add('mini'); $('panelToggle').textContent = '▴'; }
  else $('hint').classList.remove('gone');
  renderPanel();
  requestAnimationFrame(frame);
  $('loadText').textContent = 'Ready';
  setTimeout(() => {
    $('intro').classList.add('gone');
    flyCamera(new THREE.Vector3(-170, 210, 330), new THREE.Vector3(0, 0, 0), 3600);
  }, 500);
  window.__shadowline = { state, terrain, gpu, pyramid, detail, surfaceH, addPin, camera, controls, pick, setExag, get exag() { return EXAG; } };
}
boot().catch((err) => {
  console.error(err);
  $('loadText').textContent = 'Could not start: ' + err.message + ' Please reload the page.';
  $('loadText').style.color = '#ff6b6b';
});
