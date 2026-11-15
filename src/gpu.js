// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
// GPU side: terrain material, live light map and time-accumulated heat maps.
import * as THREE from 'three';

const MARCH = /* glsl */`
const float RM = 1737400.0;
uniform sampler2D uHeight;
uniform float uL;

float hAt(vec2 uv) { return textureLod(uHeight, uv, 0.0).r; }

// Start point of a ray on the surface. Position is kept as (x, y, zeta) with
// zeta = z - RM so 32-bit floats stay accurate to millimetres.
void surfacePoint(vec2 uv, float lift, out vec2 pxy, out float zeta, out vec3 nrm) {
  vec2 m = (uv * 2.0 - 1.0) * uL;
  float r = length(m);
  float t = r / (2.0 * RM);
  float t2 = t * t;
  float s = 2.0 * t / (1.0 + t2);
  float omc = 2.0 * t2 / (1.0 + t2);
  vec2 e = r > 1e-3 ? m / r : vec2(0.0, 1.0);
  float rad = RM + hAt(uv) + lift;
  pxy = rad * s * e;
  zeta = (rad - RM) - rad * omc;
  nrm = vec3(s * e, 1.0 - omc);
}

// Smallest angular clearance (radians) between a ray and the terrain below it.
float clearance(vec2 pxy, float zeta, vec3 d) {
  float best = 1.0;
  float t = 0.0;
  float dt = STEP0;
  for (int i = 0; i < STEPS; i++) {
    t += dt;
    vec2 xy = pxy + d.xy * t;
    float z = zeta + d.z * t;
    float rho2 = dot(xy, xy);
    float Rz = RM + z;
    float len = sqrt(rho2 + Rz * Rz);
    float alt = (rho2 + z * (2.0 * RM + z)) / (len + RM);
    vec2 uv2 = xy * (2.0 * RM / (len + Rz)) / uL * 0.5 + 0.5;
    if (uv2.x < 0.0 || uv2.x > 1.0 || uv2.y < 0.0 || uv2.y > 1.0) break;
    best = min(best, (alt - hAt(uv2)) / t);
    dt = min(dt * GROW, STEPMAX);
  }
  return best;
}

uniform vec3 uSun;        // unit vector to the Sun, pole frame
uniform vec3 uEarthPos;   // Earth position, metres, pole frame
const float SUN_R = 0.004653;   // solar angular radius, rad

vec2 visibility(vec2 uv) {
  vec2 pxy; float zeta; vec3 nrm;
  surfacePoint(uv, 2.0, pxy, zeta, nrm);
  float cs = clearance(pxy, zeta, uSun);
  vec3 dE = normalize(uEarthPos - vec3(pxy, RM + zeta));
  float ce = clearance(pxy, zeta, dE);
  return vec2(clamp(0.5 + cs / (2.0 * SUN_R), 0.0, 1.0), smoothstep(-0.0006, 0.0006, ce));
}
`;

const QUAD_VERT = /* glsl */`
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function visMaterial(shared, { steps, stepMax, accumulate }) {
  return new THREE.ShaderMaterial({
    uniforms: shared,
    defines: { STEPS: steps, STEP0: '110.0', GROW: '1.045', STEPMAX: stepMax.toFixed(1) },
    vertexShader: QUAD_VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      in vec2 vUv;
      ${MARCH}
      void main() {
        vec2 v = visibility(vUv);
        gl_FragColor = ${accumulate ? 'vec4(v.x, v.y, v.x * v.y, 1.0)' : 'vec4(v, 0.0, 1.0)'};
      }`,
    depthTest: false,
    depthWrite: false,
    blending: accumulate ? THREE.CustomBlending : THREE.NoBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

const TERRAIN_VERT = /* glsl */`
uniform sampler2D uHeight;
uniform float uExag;
out vec2 vUv;
out float vH;
void main() {
  vUv = uv;
  float h = textureLod(uHeight, uv, 0.0).r;
  vH = h;
  vec3 p = position;
  p.y += h * 0.001 * uExag;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const TERRAIN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uHeight, uLight, uAccum;
uniform vec3 uSun;
uniform float uL, uPixel, uTexel, uAccumN;
uniform int uLayer;
uniform vec3 uHover;      // xy = map uv, z = on/off
in vec2 vUv;
in float vH;
const float RM = 1737400.0;

vec3 heat(float t) {   // dark blue -> magenta -> orange -> pale yellow
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.03, 0.03, 0.12), c1 = vec3(0.36, 0.07, 0.43), c2 = vec3(0.86, 0.25, 0.30), c3 = vec3(0.99, 0.65, 0.20), c4 = vec3(1.0, 0.98, 0.72);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}
vec3 ice(float t) {    // near black -> deep blue -> cyan -> white
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.02, 0.03, 0.07), c1 = vec3(0.06, 0.20, 0.52), c2 = vec3(0.20, 0.62, 0.95), c3 = vec3(0.88, 0.98, 1.0);
  if (t < 0.4) return mix(c0, c1, t / 0.4);
  if (t < 0.8) return mix(c1, c2, (t - 0.4) / 0.4);
  return mix(c2, c3, (t - 0.8) / 0.2);
}
vec3 mint(float t) {   // near black -> teal -> mint -> white
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.02, 0.05, 0.06), c1 = vec3(0.04, 0.38, 0.38), c2 = vec3(0.35, 0.88, 0.63), c3 = vec3(0.95, 1.0, 0.88);
  if (t < 0.4) return mix(c0, c1, t / 0.4);
  if (t < 0.8) return mix(c1, c2, (t - 0.4) / 0.4);
  return mix(c2, c3, (t - 0.8) / 0.2);
}
vec3 slopeColor(float deg) {
  vec3 g = vec3(0.30, 0.86, 0.60), y = vec3(0.98, 0.84, 0.32), o = vec3(0.98, 0.50, 0.22), r = vec3(0.70, 0.12, 0.18), k = vec3(0.16, 0.04, 0.08);
  if (deg < 5.0) return g;
  if (deg < 10.0) return mix(g, y, (deg - 5.0) / 5.0);
  if (deg < 15.0) return mix(y, o, (deg - 10.0) / 5.0);
  if (deg < 25.0) return mix(o, r, (deg - 15.0) / 10.0);
  return mix(r, k, clamp((deg - 25.0) / 15.0, 0.0, 1.0));
}

void main() {
  vec2 m = (vUv * 2.0 - 1.0) * uL;
  float r = length(m);
  if (r > uL) discard;

  float hx = (textureLod(uHeight, vUv + vec2(uTexel, 0.0), 0.0).r - textureLod(uHeight, vUv - vec2(uTexel, 0.0), 0.0).r) / (2.0 * uPixel);
  float hy = (textureLod(uHeight, vUv + vec2(0.0, uTexel), 0.0).r - textureLod(uHeight, vUv - vec2(0.0, uTexel), 0.0).r) / (2.0 * uPixel);

  // radial direction at this map point
  float t = r / (2.0 * RM), t2 = t * t;
  vec2 e = r > 1e-3 ? m / r : vec2(0.0, 1.0);
  vec3 nr = vec3(2.0 * t / (1.0 + t2) * e, (1.0 - t2) / (1.0 + t2));
  vec3 N = normalize(nr - vec3(hx, hy, 0.0));

  vec4 light = texture(uLight, vUv);
  float lambert = max(dot(N, uSun), 0.0);
  float direct = light.r * (1.0 - exp(-lambert * 10.0));

  // soft fixed "studio" light so shape stays readable in shadow and in heat maps
  float hill = clamp(dot(normalize(vec3(-hx * 3.0, -hy * 3.0, 1.0)), normalize(vec3(-0.5, 0.6, 0.62))), 0.0, 1.0);

  vec3 regolith = mix(vec3(0.62, 0.60, 0.57), vec3(0.78, 0.76, 0.72), clamp(vH / 6000.0 + 0.5, 0.0, 1.0));
  vec3 col;
  if (uLayer == 0) {
    vec3 sunCol = vec3(1.0, 0.95, 0.86);
    vec3 shade = vec3(0.020, 0.026, 0.040) * (0.35 + hill);
    vec3 earthshine = light.g * vec3(0.010, 0.022, 0.045) * (0.4 + hill);
    col = regolith * (sunCol * direct * 1.25 + shade + earthshine);
  } else if (uLayer == 4) {
    float deg = degrees(atan(length(vec2(hx, hy))));
    col = slopeColor(deg) * (0.30 + 0.80 * hill);
  } else {
    vec4 acc = texture(uAccum, vUv);
    float nrm = max(acc.a, 1.0);
    vec3 c = uLayer == 1 ? heat(acc.r / nrm) : (uLayer == 2 ? ice(acc.g / nrm) : mint(acc.b / nrm));
    col = c * (0.42 + 0.75 * hill);
    if (uAccumN < 0.5) col = vec3(0.03) * (0.4 + hill);
  }

  // graticule: latitude rings every degree, meridians every 30 degrees
  float colat = degrees(2.0 * atan(t));
  float ring = abs(fract(colat + 0.5) - 0.5) / max(fwidth(colat), 1e-6);
  float lon = degrees(atan(m.x, m.y));
  float mer = abs(fract(lon / 30.0 + 0.5) - 0.5) / max(fwidth(lon / 30.0), 1e-6);
  float grid = (1.0 - smoothstep(0.0, 1.2, ring)) * 0.10 + (1.0 - smoothstep(0.0, 1.2, mer)) * 0.07 * step(1.0, colat);
  col += vec3(0.55, 0.75, 1.0) * grid;

  // hover reticle
  if (uHover.z > 0.5) {
    float d = length((vUv - uHover.xy) * 2.0 * uL);
    float w = fwidth(d);
    float ringH = (1.0 - smoothstep(0.0, w * 1.5, abs(d - 3000.0))) + (1.0 - smoothstep(0.0, w * 1.5, abs(d - 400.0)));
    col = mix(col, vec3(1.0), clamp(ringH, 0.0, 1.0) * 0.9);
  }

  // fade the disc edge into space
  float edge = 1.0 - smoothstep(uL * 0.955, uL, r);
  col *= edge;
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Gpu {
  constructor(renderer, terrain, lightSize) {
    this.renderer = renderer;
    this.terrain = terrain;
    const n = terrain.n;

    const floatLinear = renderer.extensions.has('OES_texture_float_linear');
    let data = terrain.h, type = THREE.FloatType;
    if (!floatLinear) {
      data = new Uint16Array(terrain.h.length);
      for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(terrain.h[i]);
      type = THREE.HalfFloatType;
    }
    this.heightTex = new THREE.DataTexture(data, n, n, THREE.RedFormat, type);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    const rt = (size, t) => new THREE.WebGLRenderTarget(size, size, {
      type: t, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.lightSize = lightSize;
    this.light = rt(lightSize, THREE.UnsignedByteType);
    this.accumSize = 512;
    this.accum = rt(this.accumSize, THREE.HalfFloatType);
    this.readback = rt(this.accumSize, THREE.UnsignedByteType);
    this.readback.texture.minFilter = this.readback.texture.magFilter = THREE.NearestFilter;

    this.shared = {
      uHeight: { value: this.heightTex },
      uL: { value: terrain.L },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uEarthPos: { value: new THREE.Vector3(0, 3.8e8, 0) },
    };
    this.liveMat = visMaterial(this.shared, { steps: 170, stepMax: 2500, accumulate: false });
    this.accumMat = visMaterial(this.shared, { steps: 130, stepMax: 3600, accumulate: true });
    this.normMat = new THREE.ShaderMaterial({
        uniforms: { uAccum: { value: this.accum.texture } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uAccum;
        in vec2 vUv;         void main() { vec4 a = texture(uAccum, vUv); gl_FragColor = vec4(a.rgb / max(a.a, 1.0), 1.0); }`,
      depthTest: false, depthWrite: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.liveMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.terrainUniforms = {
      uHeight: { value: this.heightTex },
      uLight: { value: this.light.texture },
      uAccum: { value: this.accum.texture },
      uSun: this.shared.uSun,
      uL: { value: terrain.L },
      uPixel: { value: terrain.px },
      uTexel: { value: 1 / n },
      uExag: { value: 3 },
      uLayer: { value: 0 },
      uAccumN: { value: 0 },
      uHover: { value: new THREE.Vector3(0, 0, 0) },
    };
    this.terrainMat = new THREE.ShaderMaterial({
        uniforms: this.terrainUniforms,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    });
    this.accumCount = 0;
  }

  setSky(sample) {
    this.shared.uSun.value.fromArray(sample.sunDir);
    this.shared.uEarthPos.value.fromArray(sample.earthPos);
  }

  _pass(material, target, clear) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    this.quad.material = material;
    r.setRenderTarget(target);
    r.autoClear = false;
    if (clear) { r.setClearColor(0x000000, 0); r.clear(true, false, false); }
    r.render(this.quadScene, this.quadCam);
    r.autoClear = prevAuto;
    r.setRenderTarget(prev);
  }

  /** Recompute sunlight / Earth visibility for the current sky. */
  renderLight() { this._pass(this.liveMat, this.light, true); }

  resetAccum() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.accum);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setRenderTarget(prev);
    this.accumCount = 0;
    this.terrainUniforms.uAccumN.value = 0;
  }

  /** Add one time sample to the heat maps. */
  accumulate(sample) {
    this.setSky(sample);
    this._pass(this.accumMat, this.accum, false);
    this.accumCount++;
    this.terrainUniforms.uAccumN.value = this.accumCount;
  }

  /** Heat maps as bytes: r = sunlight share, g = Earth share, b = both. */
  readAccum() {
    this._pass(this.normMat, this.readback, true);
    const n = this.accumSize;
    const buf = new Uint8Array(n * n * 4);
    this.renderer.readRenderTargetPixels(this.readback, 0, 0, n, n, buf);
    return { data: buf, size: n };
  }
}
