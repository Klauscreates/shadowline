// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
// First-person 3D view from the observer's eye, 2 m above the ground, at true scale.
//
// The terrain is a mesh of the real ground around the site, out to where the horizon search
// stops (330 km or the edge of the data). Its vertices are the very points the horizon march
// samples: 720 directions, and along each one the same steps on the same height grids, placed in
// true 3D on the curved Moon. So the picture and the numbers read the same ground, and check()
// renders the mesh and measures its skyline against the calculated horizon.
//
// What is NOT physical here: ground brightness is slope-facing (Lambert) shading only. Cast
// shadows are not drawn, and there is no texture. The Sun and Earth discs are at their computed
// positions and true angular sizes; the terrain hides them exactly as it does in the calculation.
import * as THREE from 'three';
import { R, OBSERVER_M, HORIZON_N } from './terrain.js?v=43';

const DEG = Math.PI / 180;
const SUN_R = 0.2666 * DEG;
const EARTH_R_M = 6371000;
const FAR = 1.0e6;       // distance the Sun and Earth discs are drawn at, m

/**
 * Mesh of the ground around an observer. `S` is a sampler (polarSampler or SiteTerrain.sampler).
 * `azStep` 1 = all 720 directions, 2 = every second one.
 */
export function buildGround(S, azStep = 1) {
  const { up, north, east, p0 } = S;
  const azN = HORIZON_N / azStep;
  // march every direction exactly as the horizon search does, keeping each sample
  const cols = [];
  let M = 0;
  for (let c = 0; c < azN; c++) {
    const az = (c * azStep / HORIZON_N) * 2 * Math.PI, ca = Math.cos(az), sa = Math.sin(az);
    const dx = north[0] * ca + east[0] * sa, dy = north[1] * ca + east[1] * sa, dz = north[2] * ca + east[2] * sa;
    const pos = [], slope = [];
    let t = 0, dt = S.dt0;
    for (let i = 0; i < S.maxSteps; i++) {
      t += dt;
      const px = p0[0] + dx * t, py = p0[1] + dy * t, pz = p0[2] + dz * t, len = Math.hypot(px, py, pz);
      const hh = S.ground(px, py, pz, len, t);
      if (hh !== hh) break;
      const cap = S.cap, d = S.gpx || cap, s = (R + hh) / len;
      const qx = px * s, qy = py * s, qz = pz * s;
      const vx = qx - p0[0], vy = qy - p0[1], vz = qz - p0[2];
      pos.push(vx * east[0] + vy * east[1] + vz * east[2], vx * up[0] + vy * up[1] + vz * up[2], -(vx * north[0] + vy * north[1] + vz * north[2]));
      // slope over two pixels of the grid in use at this point
      const g = (ex, ey, ez) => {
        const ax = qx + ex * d, ay = qy + ey * d, az_ = qz + ez * d, bx = qx - ex * d, by = qy - ey * d, bz = qz - ez * d;
        const a = S.ground(ax, ay, az_, Math.hypot(ax, ay, az_), t), b = S.ground(bx, by, bz, Math.hypot(bx, by, bz), t);
        return (a - b) / (2 * d);
      };
      const ge = g(east[0], east[1], east[2]), gn = g(north[0], north[1], north[2]);
      const sl = Math.atan(Math.hypot(ge, gn)) / DEG;
      slope.push(sl === sl ? sl : 0);
      dt = Math.min(dt * 1.02, cap);
      if (t > S.tMax) break;
    }
    cols.push({ pos, slope });
    if (slope.length > M) M = slope.length;
  }
  const nv = 1 + azN * M;
  const P = new Float32Array(nv * 3), SL = new Float32Array(nv);
  P[1] = -OBSERVER_M;                                          // the ground under the eye
  for (let c = 0; c < azN; c++) {
    const { pos, slope } = cols[c], n = slope.length;
    for (let i = 0; i < M; i++) {
      const j = Math.min(i, n - 1), v = (1 + i * azN + c) * 3;      // past the end of the data: repeat the last point (no triangles use it)
      if (n) { P[v] = pos[j * 3]; P[v + 1] = pos[j * 3 + 1]; P[v + 2] = pos[j * 3 + 2]; SL[1 + i * azN + c] = slope[j]; }
    }
  }
  SL[0] = SL[1];
  // far rings first, the ring at the observer's feet last: nearer ground is drawn over farther ground,
  // which is exact for a height field seen from its centre and needs no depth buffer
  const idx = [];
  for (let i = M - 2; i >= 0; i--) {
    for (let c = 0; c < azN; c++) {
      const c1 = (c + 1) % azN;
      if (cols[c].slope.length <= i + 1 || cols[c1].slope.length <= i + 1) continue;
      const a = 1 + i * azN + c, b = 1 + i * azN + c1, e = a + azN, f = b + azN;
      idx.push(a, b, e, b, f, e);
    }
  }
  for (let c = 0; c < azN; c++) if (cols[c].slope.length && cols[(c + 1) % azN].slope.length) idx.push(0, 1 + (c + 1) % azN, 1 + c);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('aSlope', new THREE.BufferAttribute(SL, 1));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  geo.computeVertexNormals();
  return { geo, azN, rings: M, vertices: nv, triangles: idx.length / 3 };
}

const GROUND_VERT = `
  attribute float aSlope; varying vec3 vN; varying float vSlope; varying float vDist;
  void main() { vN = normal; vSlope = aSlope; vDist = length(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FRAG = `
  precision highp float;
  uniform vec3 uSun; uniform float uSteep; uniform float uFlat; uniform float uFill;
  varying vec3 vN; varying float vSlope; varying float vDist;
  void main() {
    if (uFlat > 0.5) { gl_FragColor = vec4(1.0); return; }
    vec3 n = normalize(vN); if (n.y < 0.0) n = -n;
    float lam = max(dot(n, uSun), 0.0);
    float fill = uFill * (0.55 + 0.45 * n.y);                      // faint even light so unlit ground keeps its shape
    vec3 col = vec3(0.46, 0.45, 0.43) * (lam * 1.7 + fill);
    col = pow(col, vec3(1.0 / 2.2));
    if (uSteep > 0.5 && vSlope > 15.0) col = mix(col, vec3(0.92, 0.26, 0.22), 0.62);
    gl_FragColor = vec4(col, 1.0);
  }`;
const DISC_VERT = `varying vec2 vP; varying vec3 vX; varying vec3 vY; varying vec3 vZ;
  void main() { vP = position.xy; vX = normalize(mat3(modelMatrix) * vec3(1.,0.,0.)); vY = normalize(mat3(modelMatrix) * vec3(0.,1.,0.)); vZ = normalize(mat3(modelMatrix) * vec3(0.,0.,1.));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const EARTH_FRAG = `precision highp float; uniform vec3 uSun; varying vec2 vP; varying vec3 vX; varying vec3 vY; varying vec3 vZ;
  void main() { float r2 = dot(vP, vP); if (r2 > 1.0) discard;
    vec3 n = vP.x * vX + vP.y * vY + sqrt(1.0 - r2) * vZ;
    float lit = smoothstep(-0.02, 0.02, dot(n, uSun));
    gl_FragColor = vec4(mix(vec3(0.043, 0.106, 0.2), vec3(0.435, 0.722, 1.0), lit), 1.0); }`;

export class FirstPerson {
  constructor(canvas, overlay) {
    this.canvas = canvas; this.overlay = overlay;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 4e6);
    this.az = 0; this.el = 0; this.fov = 60; this.track = 'sun'; this.steep = true;
    this.uniforms = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uSteep: { value: 1 }, uFlat: { value: 0 }, uFill: { value: 0.035 } };
    this.groundMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.CircleGeometry(1, 64);
    this.sun = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: 0xfff6dc, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.earthU = { uSun: { value: new THREE.Vector3(0, 1, 0) } };
    this.earth = new THREE.Mesh(disc, new THREE.ShaderMaterial({ uniforms: this.earthU, vertexShader: DISC_VERT, fragmentShader: EARTH_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.sun.renderOrder = 0; this.earth.renderOrder = 1;
    this.sun.frustumCulled = this.earth.frustumCulled = false;
    this.scene.add(this.sun, this.earth);
    this.ground = null; this.info = null; this.now = null; this.profile = null;
  }
  static dir(az, el, out = new THREE.Vector3()) { const c = Math.cos(el); return out.set(Math.sin(az) * c, Math.sin(el), -Math.cos(az) * c); }

  /** Show the ground of one site. */
  setGround(S, profile, azStep) {
    this.clearGround();
    this.info = buildGround(S, azStep);
    this.ground = new THREE.Mesh(this.info.geo, this.groundMat);
    this.ground.frustumCulled = false; this.ground.renderOrder = 2;
    this.scene.add(this.ground);
    this.profile = profile;
  }
  clearGround() {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); this.ground = null; }
  }
  /** `now` = skyAt() for the site; `sky` = the ephemeris sample (for the Earth's distance). */
  setSky(now, sky) {
    this.now = now;
    const s = FirstPerson.dir(now.sunAz, now.sunEl), e = FirstPerson.dir(now.earthAz, now.earthEl);
    this.uniforms.uSun.value.copy(s); this.earthU.uSun.value.copy(s);
    this.sun.position.copy(s).multiplyScalar(FAR); this.sun.scale.setScalar(FAR * Math.tan(SUN_R)); this.sun.lookAt(0, 0, 0);
    const eDist = Math.hypot(sky.earthPos[0], sky.earthPos[1], sky.earthPos[2]);
    this.earthR = Math.asin(EARTH_R_M / eDist);
    this.earth.position.copy(e).multiplyScalar(FAR); this.earth.scale.setScalar(FAR * Math.tan(this.earthR)); this.earth.lookAt(0, 0, 0);
    if (this.track === 'sun') { this.az = now.sunAz; this.el = now.sunEl; }
    else if (this.track === 'earth') { this.az = now.earthAz; this.el = now.earthEl; }
  }
  aim() {
    this.el = Math.min(88 * DEG, Math.max(-60 * DEG, this.el));
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(FirstPerson.dir(this.az, this.el));
  }
  draw() {
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h || !this.ground || !this.now) return;
    const pr = this.renderer.getPixelRatio();
    if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) this.renderer.setSize(w, h, false);
    this.camera.fov = this.fov; this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.aim();
    this.uniforms.uSteep.value = this.steep ? 1 : 0; this.uniforms.uFlat.value = 0;
    this.sun.visible = this.earth.visible = true;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(w, h);
  }
  /** Compass, body labels and turn arrows, drawn on a 2D canvas over the 3D picture. */
  drawOverlay(w, h) {
    const o = this.overlay, dpr = Math.min(devicePixelRatio, 2);
    if (o.width !== Math.round(w * dpr) || o.height !== Math.round(h * dpr)) { o.width = Math.round(w * dpr); o.height = Math.round(h * dpr); }
    const g = o.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const v = new THREE.Vector3(), fwd = FirstPerson.dir(this.az, this.el);
    const proj = (az, el) => { FirstPerson.dir(az, el, v); if (v.dot(fwd) <= 0.05) return null; v.project(this.camera); return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h]; };
    // level line and compass
    g.font = '10.5px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const step = this.fov > 40 ? 15 : 5;
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.setLineDash([5, 5]); g.lineWidth = 1; g.beginPath();
    let pen = false;
    for (let a = 0; a <= 360; a += 1) { const p = proj(a * DEG, 0); if (p && p[0] > -50 && p[0] < w + 50) { if (pen) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); pen = true; } else pen = false; }
    g.stroke(); g.setLineDash([]);
    for (let a = 0; a < 360; a += step) {
      const p = proj(a * DEG, 0); if (!p || p[0] < 12 || p[0] > w - 12 || p[1] < 30 || p[1] > h - 6) continue;
      g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(p[0], p[1] - 4, 1, 8);
      g.fillStyle = names[a] ? '#fff' : 'rgba(255,255,255,.6)';
      g.fillText(names[a] || a + '°', p[0], p[1] + 13);
    }
    // bodies
    const now = this.now, ppd = h / this.fov;
    g.font = '600 11.5px system-ui';
    const tag = (az, el, rad, text, col) => { const p = proj(az, el); if (!p || p[0] < 30 || p[0] > w - 30 || p[1] < 24) return; g.fillStyle = col; g.fillText(text, p[0], p[1] - Math.max(rad / DEG * ppd, 2) - 11); };
    tag(now.sunAz, now.sunEl, SUN_R, now.sunFrac > 0.05 ? 'Sun' : 'Sun (behind terrain)', '#ffc65a');
    tag(now.earthAz, now.earthEl, this.earthR, now.earthVis ? 'Earth' : 'Earth (behind terrain)', '#5db4ff');
    const hfov = 2 * Math.atan(Math.tan(this.fov * DEG / 2) * w / h) / DEG;
    const arrow = (az, el, name, col, row) => {
      const d = ((((az - this.az) / DEG + 540) % 360) + 360) % 360 - 180, up = (el - this.el) / DEG;
      if (Math.abs(d) < hfov / 2 && Math.abs(up) < this.fov / 2) return;
      g.fillStyle = col; g.textAlign = d > 0 ? 'right' : 'left';
      const vert = Math.abs(up) > this.fov / 2 ? `, ${Math.round(Math.abs(up))}° ${up > 0 ? 'up' : 'down'}` : '';
      const turn = Math.abs(d) >= hfov / 2 ? `turn ${Math.round(Math.abs(d))}° ${d > 0 ? 'right' : 'left'}` : 'look';
      g.fillText(d > 0 ? `${name}: ${turn}${vert} ▶` : `◀ ${name}: ${turn}${vert}`, d > 0 ? w - 8 : 8, 16 + row * 16);
    };
    arrow(now.sunAz, now.sunEl, 'Sun', '#ffc65a', 0); arrow(now.earthAz, now.earthEl, 'Earth', '#5db4ff', 1);
  }

  /**
   * Render the terrain alone and measure its skyline in `n` directions, then compare with the
   * calculated horizon. `offset` (deg) shifts the directions off the mesh's own columns.
   * Each direction: a 4 x 2048 pixel strip 8 deg tall centred on the calculated horizon,
   * so one pixel is 0.004 deg. Returns degrees.
   */
  check(n = 72, offset = 0) {
    if (!this.ground || !this.profile) return null;
    const H = 2048, W = 4, FOV = 8, hor = this.profile.horizon;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.3, 4e6), buf = new Uint8Array(W * H * 4);
    const horizonAt = (az) => { let f = (az / (2 * Math.PI)) * HORIZON_N; f = ((f % HORIZON_N) + HORIZON_N) % HORIZON_N; const i = f | 0, a = f - i; return hor[i] * (1 - a) + hor[(i + 1) % HORIZON_N] * a; };
    this.uniforms.uFlat.value = 1; this.sun.visible = this.earth.visible = false;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    let max = 0, sq = 0, worstAz = 0, missed = 0;
    const rows = [];
    for (let k = 0; k < n; k++) {
      const az = (k / n * 360 + offset) * DEG, calc = horizonAt(az);
      cam.position.set(0, 0, 0); cam.up.set(0, 1, 0); cam.lookAt(FirstPerson.dir(az, calc)); cam.updateMatrixWorld();
      this.renderer.clear(); this.renderer.render(this.scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      let top = -1;
      for (let j = H - 1; j >= 0; j--) if (buf[(j * W + 1) * 4] > 127 || buf[(j * W + 2) * 4] > 127) { top = j; break; }
      if (top < 0 || top === H - 1) { missed++; rows.push({ az: az / DEG, calc: calc / DEG, seen: NaN }); continue; }   // skyline outside the strip: more than 4 deg off
      const seen = calc + Math.atan((((top + 1) / H) * 2 - 1) * Math.tan(FOV * DEG / 2));
      const d = Math.abs(seen - calc) / DEG;
      rows.push({ az: az / DEG, calc: calc / DEG, seen: seen / DEG });
      sq += d * d; if (d > max) { max = d; worstAz = az / DEG; }
    }
    this.renderer.setRenderTarget(prev); rt.dispose();
    this.uniforms.uFlat.value = 0; this.sun.visible = this.earth.visible = true;
    return { n, offset, max, rms: Math.sqrt(sq / Math.max(1, n - missed)), worstAz, missed, pixelDeg: FOV / H, rows };
  }
}
