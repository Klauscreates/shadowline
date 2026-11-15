import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { moonSky } from './ephemeris.js';
import { loadTerrain, analyseSite, skyAt, mapToLatLon, latLonToMap, scoreOf, HORIZON_N } from './terrain.js';
import { Gpu } from './gpu.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const DAY = 86400000;
const EXAG = 3;
const PIN_COLORS = ['#ffc65a', '#5db4ff', '#58e0a0', '#ff8fb1'];
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
controls.minDistance = 25;
controls.maxDistance = 1400;
controls.maxPolarAngle = 86 * DEG;
controls.zoomSpeed = 0.9;
controls.enabled = false;

const toWorldDir = (d) => new THREE.Vector3(d[0], d[2], -d[1]);
let terrain, gpu;

function mapToWorld(x, y, lift = 0) {
  return new THREE.Vector3(x / 1000, terrain.height(x, y) * EXAG / 1000 + lift, -y / 1000);
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
};
state.t = state.start;

function sampleAt(ms) {
  const s = moonSky(new Date(ms));
  return { t: ms, sunDir: s.sun.dir, earthPos: s.earth.pos, earthDir: s.earth.dir, sunLat: s.sun.lat, sunLon: s.sun.lon, earthLat: s.earth.lat, earthLon: s.earth.lon };
}

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
  state.heat = null;
  gpu.resetAccum();
  state.t = Math.min(Math.max(state.t, state.start), state.start + span * DAY - 1);
  for (const p of state.pins) p.report = analyseSite(terrain, p.x, p.y, state.samples, state.stepHours);
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

function addPin(x, y, select = true) {
  if (state.pins.length >= PIN_COLORS.length) removePin(0);
  const used = new Set(state.pins.map((p) => p.color));
  const color = PIN_COLORS.find((c) => !used.has(c));
  const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[state.nextLetter++ % 26];
  const base = mapToWorld(x, y);
  const group = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 46, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  beam.position.set(base.x, base.y + 23, base.z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(base.x, base.y + 0.4, base.z);
  group.add(beam, ring);
  scene.add(group);
  const top = new THREE.Vector3(base.x, base.y + 46, base.z);
  const label = addLabel(letter, 'pin', () => top);
  label.el.style.background = color; label.el.style.color = '#0a0d14';
  const pin = { x, y, color, letter, group, ring, label, near: nearestFeature(x, y), report: analyseSite(terrain, x, y, state.samples, state.stepHours) };
  state.pins.push(pin);
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
const coarse = matchMedia('(pointer: coarse)').matches;
const dayLabel = (ms) => { const d = new Date(ms); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); };
const windowName = () => (state.spanDays >= 100 ? '1 year' : state.spanDays > 31 ? '3 months' : '29.53 days');

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
    <tr class="tot"><td>Score</td><td>out of 100</td><td>${r.score}</td></tr></table>`;
}
function siteSummary(p) {
  const r = p.report;
  return [
    `Shadowline site ${p.letter}${p.near ? ' (near ' + p.near + ')' : ''}`,
    `Latitude ${r.lat.toFixed(4)} deg, longitude ${r.lon.toFixed(4)} deg E, elevation ${Math.round(r.elevation)} m`,
    `Window: ${new Date(state.start).toISOString().slice(0, 10)} UTC + ${windowName()}, step ${state.stepHours} h`,
    `Sunlit ${pct1(r.sunPct)} of window, longest dark stretch ${fmtDur(r.longestDarkH)}`,
    `Earth in view ${pct1(r.earthPct)} of window, longest loss of contact ${fmtDur(r.longestMuteH)}`,
    `Sunlight and Earth contact together ${pct1(r.bothPct)}`,
    `Slope ${r.slope.toFixed(1)} deg (500 m baseline)`,
    `Score ${r.score}/100 (45% sunlight, 35% Earth contact, 20% slope)`,
    `Terrain: LOLA LDEM_60S_240MPP_ADJ resampled to 250 m; observer 2 m above ground`,
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
    '# terrain,LOLA LDEM_60S_240MPP_ADJ resampled to 250 m per pixel',
    '# observer_height_m,2',
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
     </button>`).join('');
  if (state.selected < 0 || state.selected >= state.pins.length) state.selected = 0;
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
        <div class="site-name">Site ${p.letter}${p.near ? ' · near ' + p.near : ''}</div>
        <div class="site-coord">${Math.abs(r.lat).toFixed(3)}°${r.lat < 0 ? 'S' : 'N'} · ${Math.abs(r.lon).toFixed(2)}°${r.lon < 0 ? 'W' : 'E'}</div>
        <div class="verdict">${verdict(r)}</div>
      </div>
    </div>
    <div class="block-title">At the selected time</div>
    <div class="now-row"><div class="now-chip sun" id="nowSun"></div><div class="now-chip earth" id="nowEarth"></div></div>
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
        <div class="metric"><div class="k">Slope</div><div class="v" style="color:${r.slope > 15 ? 'var(--bad)' : r.slope > 10 ? 'var(--sun)' : 'var(--good)'}">${r.slope.toFixed(1)}°</div><div class="s">over a 500 m baseline</div></div>
        <div class="metric"><div class="k">Elevation</div><div class="v">${Math.round(r.elevation).toLocaleString()} m</div><div class="s">vs 1,737.4 km sphere</div></div>
      </div></div>
    <div class="step"><div class="step-h"><i>4</i><b>Both at once</b><span>powered and in contact</span></div>
      <div class="metrics one">
        <div class="metric"><div class="k">Sunlight and Earth contact together</div><div class="v">${pct1(r.bothPct)}</div><div class="s">of the window</div></div>
      </div></div>
    <div class="block-title">Window timeline <span>${coarse ? 'tap' : 'click'} to jump</span></div>
    <canvas class="chart" id="strip" height="58"></canvas>
    <div class="axis"><span>${dayLabel(state.start)}</span><span>${dayLabel(state.start + state.spanDays * DAY / 2)}</span><span>${dayLabel(state.start + state.spanDays * DAY)}</span></div>
    <div class="block-title">Sky from this site <span>looking north, full circle</span></div>
    <canvas class="chart" id="horizon" height="150"></canvas>
    <div class="key"><span><i style="background:var(--sun)"></i>Sun path</span><span><i style="background:var(--earth)"></i>Earth path</span><span><i style="background:#7c8490"></i>Terrain horizon</span><span class="dimkey">faint = hidden</span></div>
    <div class="block-title">How the score adds up</div>
    ${scoreTable(r)}
    <div class="export"><button data-act="csv">Download data (CSV)</button><button data-act="copy">Copy summary</button></div>
    <div class="note">Window: ${new Date(state.start).toISOString().slice(0, 10)} + ${windowName()}, sampled every ${state.stepHours} h. Terrain at 250 m per pixel; antenna 2 m above ground.</div>`;
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
  const p = state.pins[state.selected]; if (!p || !chartCache) return;
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
  ns.className = 'now-chip sun ' + (now.sunFrac > 0.05 ? 'on' : 'off');
  ns.innerHTML = `<b>${now.sunFrac > 0.95 ? 'In sunlight' : now.sunFrac > 0.05 ? 'Partial sun ' + pct(now.sunFrac) : 'In shadow'}</b>Sun ${(now.sunEl / DEG).toFixed(1)}° high`;
  ne.className = 'now-chip earth ' + (now.earthVis ? 'on' : 'off');
  ne.innerHTML = `<b>${now.earthVis ? 'Earth in view' : 'No Earth contact'}</b>Earth ${(now.earthEl / DEG).toFixed(1)}° high`;
}

$('pinTabs').addEventListener('click', (e) => {
  const x = e.target.closest('[data-x]');
  if (x) { removePin(+x.dataset.x); return; }
  const b = e.target.closest('[data-i]');
  if (b) { state.selected = +b.dataset.i; renderPanel(); flyTo(state.pins[state.selected]); }
});
$('siteBody').addEventListener('click', (e) => {
  const act = e.target.dataset?.act, pin = state.pins[state.selected];
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
  const tEnd = (yMin - o.y) / d.y, step = 0.3;
  const below = (tt) => {
    const mx = (o.x + d.x * tt) * 1000, my = -(o.z + d.z * tt) * 1000;
    if (Math.hypot(mx, my) > terrain.L * 0.97) return null;
    return o.y + d.y * tt <= terrain.height(mx, my) * EXAG / 1000;
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

// ---------- camera moves ----------
let tween = null;
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
  $('skyRead').innerHTML = `<span class="s">Sun ${(-state.sky.sunLat).toFixed(2)}°</span> and <span class="e">Earth ${(-state.sky.earthLat).toFixed(2)}°</span> above the pole's flat horizon`;
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
  4: ['Ground slope over 250 m', 'linear-gradient(90deg,#4ddb99 0%,#4ddb99 12%,#fad652 25%,#fa8038 37%,#b31f2e 62%,#290a14 100%)', '0°', '40°'],
};
function updateLegend() {
  const L = LEGENDS[state.layer];
  $('legend').hidden = !L;
  if (!L) return;
  $('legendTitle').textContent = L[0]; $('legendBar').style.background = L[1]; $('legendLo').textContent = L[2]; $('legendHi').textContent = L[3];
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
if (coarse) $('hint').textContent = 'Tap the surface to test a landing site';
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
      if (state.wantBest) { state.wantBest = false; findBest(); }
    }
    if (state.layer) updateLegend();
  }
  if (state.lightDirty) { gpu.setSky(state.sky); gpu.renderLight(); state.lightDirty = false; }

  stepTween(now);
  controls.update();
  updateHover();
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
  terrain = await loadTerrain((f) => { $('loadText').textContent = `Loading NASA terrain… ${Math.round(f * 100)}%`; });
  gpu = new Gpu(renderer, terrain, 1024);
  gpu.terrainUniforms.uExag.value = EXAG;
  const size = terrain.L * 2 / 1000;
  const geo = new THREE.PlaneGeometry(size, size, 767, 767);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, gpu.terrainMat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  for (const f of FEATURES) {
    const [x, y] = latLonToMap(f[1], f[2]);
    const pos = mapToWorld(x, y, f[3] ? 9 : 5);
    addLabel(f[0], f[3] || '', () => pos);
  }
  addLabel('SUN', 'sky sun', () => sunSprite.position);
  addLabel('EARTH', 'sky earth', () => earthMesh.position);

  state.sky = sampleAt(state.t);
  rebuildWindow();
  setTime(state.t);
  requestAnimationFrame(frame);
  $('loadText').textContent = 'Ready';
  setTimeout(() => {
    $('intro').classList.add('gone');
    flyCamera(new THREE.Vector3(-170, 210, 330), new THREE.Vector3(0, 0, 0), 3600);
  }, 500);
  window.__shadowline = { state, terrain, gpu, addPin, camera, controls, pick };
}
boot().catch((err) => {
  console.error(err);
  $('loadText').textContent = 'Could not start: ' + err.message;
  $('loadText').style.color = '#ff6b6b';
});
