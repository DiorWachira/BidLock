// Shared 3D helpers for every game in the arcade: small maths, canvas textures, a mesh
// shortcut, disposal, and a pooled square-particle system (sparks, confetti, coins).

import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function disposeTree(obj, keep = new Set()) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!keep.has(m)) m.dispose();
  });
}

// ---------- pooled square particles (sparks, confetti, coins) ----------
export class ParticlePool {
  constructor(scene, max, size, additive) {
    this.max = max;
    this.additive = additive;
    this.pos = new Float32Array(max * 3).fill(-999);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tmp = new THREE.Color();
  }

  emit({ x, y, z, n = 20, speed = 3, up = 1, spread = 1, colors = [0xffffff], life = 1, gravity = 6, drag = 0.6, radius = 0 }) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * TAU;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.35 + Math.random() * 0.65);
      const r = Math.sqrt(1 - u * u);
      this.pos[i * 3] = x + Math.cos(a) * radius * Math.random();
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + Math.sin(a) * radius * Math.random();
      this.vel[i * 3] = Math.cos(a) * r * s * spread;
      this.vel[i * 3 + 1] = Math.abs(u) * s * up + s * 0.2 * up;
      this.vel[i * 3 + 2] = Math.sin(a) * r * s * spread;
      this.tmp.set(colors[Math.floor(Math.random() * colors.length)]);
      this.base[i * 3] = this.tmp.r;
      this.base[i * 3 + 1] = this.tmp.g;
      this.base[i * 3 + 2] = this.tmp.b;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.4);
      this.grav[i] = gravity;
      this.drag[i] = drag;
    }
  }

  update(dt) {
    let alive = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      alive = true;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0 || this.pos[j + 1] < 0.05) {
        this.life[i] = 0;
        this.pos[j + 1] = -999;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= d;
      this.vel[j + 2] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = this.additive ? clamp(this.life[i] / this.maxLife[i], 0, 1) : 1;
      this.col[j] = this.base[j] * f;
      this.col[j + 1] = this.base[j + 1] * f;
      this.col[j + 2] = this.base[j + 2] * f;
    }
    if (alive || this.dirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    this.dirty = alive;
  }
}
