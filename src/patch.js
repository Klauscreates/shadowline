// Shadowline. Written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by Nikolai Klaus Stoloff.
// Sharper visible terrain: a square mesh patch drawn from a finer NASA LOLA grid around the
// point the camera is looking at, laid into the coarser surface around it without gaps.
// This is drawing only. Sunlight, Earth-contact and slope numbers do not come from here.
import * as THREE from 'three';

const EDGE = 3;      // outermost cells sit exactly on the coarser surface around the patch
const BLEND = 24;    // cells over which the finer heights fade in

/**
 * Height of a regular grid drawn as a three.js PlaneGeometry (each cell split along the
 * diagonal from its minimum corner to its maximum corner), i.e. the surface the GPU really draws.
 */
export function gridSurface(x0, y0, cell, n, hAt, x, y) {
  const fu = (x - x0) / cell, fv = (y - y0) / cell;
  const i = Math.min(Math.max(Math.floor(fu), 0), n - 2), j = Math.min(Math.max(Math.floor(fv), 0), n - 2);
  const a = fu - i, b = fv - j;
  const h00 = hAt(i, j), h11 = hAt(i + 1, j + 1);
  if (b > a) { const h01 = hAt(i, j + 1); return h00 + (h11 - h01) * a + (h01 - h00) * b; }
  const h10 = hAt(i + 1, j);
  return h00 + (h10 - h00) * a + (h11 - h10) * b;
}

export class LocalPatch {
  /** n vertices a side, `cell` metres apart; `order` 1 = drawn over the base map, 2 = over another patch. */
  constructor(gpu, n, cell, order) {
    this.n = n; this.cell = cell; this.span = (n - 1) * cell;
    this.h = new Float32Array(n * n);
    this.x0 = 0; this.y0 = 0; this.cx = 0; this.cy = 0;
    this.active = false;
    this.half = !gpu.floatLinear;
    this.data = this.half ? new Uint16Array(n * n) : new Float32Array(n * n);
    this.tex = new THREE.DataTexture(this.data, n, n, THREE.RedFormat, this.half ? THREE.HalfFloatType : THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.uniforms = {
      ...gpu.terrainUniforms,                                   // shared: light map, layer, hover, vertical scale…
      uHole: { value: new THREE.Vector4(1, 1, -1, -1) },
      uPatchH: { value: this.tex },
      uPN: { value: n },
      uPH0: { value: 0 },
      uPSpan: { value: this.span },
      uP0: { value: new THREE.Vector2() },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, n - 1, n - 1), gpu.patchMaterial(this.uniforms, order));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = order;
  }

  contains(x, y) { return this.active && x >= this.x0 && y >= this.y0 && x <= this.x0 + this.span && y <= this.y0 + this.span; }
  at(i, j) { return this.h[j * this.n + i]; }
  /** The drawn surface of this patch (m). */
  surface(x, y) { return gridSurface(this.x0, this.y0, this.cell, this.n, (i, j) => this.h[j * this.n + i], x, y); }
  /** Map rectangle the coarser surface underneath must leave out. */
  hole(v) { const m = this.cell * EDGE * 0.5; return v.set(this.x0 + m, this.y0 + m, this.x0 + this.span - m, this.y0 + this.span - m); }

  /**
   * Fill the patch around (cx, cy). `source(x, y)` gives the finer height; `parent(x, y)` gives the
   * drawn surface of whatever lies around the patch. Vertices are placed on the source grid's own
   * pixel centres (`origin` = map coordinate of a pixel centre), so no height is resampled.
   */
  build(cx, cy, source, parent, origin) {
    const n = this.n, c = this.cell;
    this.x0 = origin + Math.round((cx - this.span / 2 - origin) / c) * c;
    this.y0 = origin + Math.round((cy - this.span / 2 - origin) / c) * c;
    this.cx = cx; this.cy = cy;
    const h = this.h;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const y = this.y0 + j * c, dj = Math.min(j, n - 1 - j);
      for (let i = 0; i < n; i++) {
        const x = this.x0 + i * c, d = Math.min(dj, i, n - 1 - i);
        let v;
        if (d < EDGE) v = parent(x, y);
        else {
          v = source(x, y);
          if (d < EDGE + BLEND) { let w = (d - EDGE) / BLEND; w = w * w * (3 - 2 * w); v = parent(x, y) * (1 - w) + v * w; }
        }
        h[j * n + i] = v; sum += v;
      }
    }
    // store heights relative to the patch mean so half-float textures keep sub-metre precision
    const h0 = Math.round(sum / (n * n));
    if (this.half) for (let k = 0; k < h.length; k++) this.data[k] = THREE.DataUtils.toHalfFloat(h[k] - h0);
    else for (let k = 0; k < h.length; k++) this.data[k] = h[k] - h0;
    this.tex.needsUpdate = true;
    this.uniforms.uPH0.value = h0;
    this.uniforms.uP0.value.set(this.x0, this.y0);
    this.active = true; this.mesh.visible = true;
  }
  hide() { this.active = false; this.mesh.visible = false; }
}
