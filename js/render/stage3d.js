// BIDLOCK — the 3D auction studio. Everything here is built in code: geometry from
// primitives, textures painted on canvases, lamps as instanced spheres. No model,
// image or font files are loaded.

import * as THREE from 'three';
import { drawLamps, lampTextWidth, LAMP } from '../ui/eggcrate.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const PRICE_COLORS = { cool: 0x35d6e8, amber: 0xffa51f, crimson: 0xff2d2d };
const MOOD_COLORS = { CALM: null, SWEATING: 0xffb52e, SMUG: 0xfff3d0, RAGING: 0xff3b2a };

const CAMS = {
  title: { pos: [0, 4.4, 13.5], look: [0, 2.4, -1], orbit: 0.5 },
  wide: { pos: [0, 4.3, 12], look: [0, 2.4, -1], orbit: 0.06 },
  bid: { pos: [0.7, 3.6, 9.6], look: [0, 2.4, -0.8], orbit: 0.05 },
  pedestal: { pos: [0.5, 3.0, 6.0], look: [0, 2.4, 0], orbit: 0.08 },
  gavel: { pos: [-0.9, 2.6, 5.2], look: [-2.5, 1.9, 1.2], orbit: 0.02 },
  heist: { pos: [0, 6.6, 11], look: [0, 2.2, -2], orbit: 0.12 },
  podium: { pos: [0, 3.5, 11.2], look: [0, 2.6, 0], orbit: 0.1 },
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function disposeTree(obj, keep = new Set()) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!keep.has(m)) m.dispose();
  });
}

// ---------- pooled square particles (sparks, confetti, coins) ----------
class ParticlePool {
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

// ---------- the winner's crown ----------
function buildCrown(g, m) {
  add(g, new THREE.CylinderGeometry(0.5, 0.44, 0.32, 24), m.main, 0, -0.2, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    add(g, new THREE.ConeGeometry(0.13, 0.46, 4), m.main, Math.cos(a) * 0.4, 0.18, Math.sin(a) * 0.4);
    add(g, new THREE.SphereGeometry(0.075, 10, 8), m.alt, Math.cos(a) * 0.4, 0.45, Math.sin(a) * 0.4);
  }
  add(g, new THREE.TorusGeometry(0.47, 0.04, 8, 32).rotateX(Math.PI / 2), m.alt, 0, -0.34, 0);
}

// ---------- rim light around the photo frame ----------
// A band just outside the gold frame, in the current price colour, with two highlights
// that travel round it. They run faster as the auctioneer counts down.
const RIM_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RIM_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uHeat;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec2 d = abs(p) - (uSize * 0.5 - 0.17);
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float band = smoothstep(0.17, 0.0, dist) * step(0.0, dist);
  float ang = atan(p.y, p.x);
  float speed = 1.1 + uHeat;
  float sweep = pow(max(0.0, cos(ang - uTime * speed)), 12.0) + pow(max(0.0, cos(ang + 3.14159 - uTime * speed)), 12.0);
  float a = band * (0.3 + 1.6 * sweep);
  gl_FragColor = vec4(uColor * a, a);
}`;

// ---------- the stage ----------
export class Stage3D {
  constructor(container, { media = null } = {}) {
    this.container = container;
    this.media = media;
    this.lotItem = null;
    this.lotMystery = false;
    this.flights = [];
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.flipT = 1;
    this.kick = 0;
    this.yaw = 0;
    this.oracleOn = false;
    this.focus = null;
    this.t = 0;
    this.units = [];
    this.icon = null;
    this.debris = [];
    this.price = 0;
    this.callStage = 0;
    this.shake = 0;
    this.camMode = 'title';
    this.camPos = new THREE.Vector3(0, 4.4, 13.5);
    this.camLook = new THREE.Vector3(0, 2.4, -1);
    this.theme = 'dark';
    this.celebrate = 0;
    this.celebrateAt = new THREE.Vector3();
    this.lost = false;
    this.onContextLost = null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.prepend(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      if (this.onContextLost) this.onContextLost();
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => { this.lost = false; });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080b);
    this.scene.fog = new THREE.Fog(0x06080b, 18, 42);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);

    this._buildEnvironment();
    this._buildSet();
    this._buildLights();
    this._buildPedestal();
    this._buildGavel();
    this.keepMats = new Set([this.setMat, this.brass, this.frameBackMat, this.glassMat]);
    container.addEventListener('pointermove', (e) => {
      const r = container.getBoundingClientRect();
      this.pointer.tx = clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1);
      this.pointer.ty = clamp(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1, -1, 1);
    });
    container.addEventListener('pointerleave', () => { this.pointer.tx = 0; this.pointer.ty = 0; });
    this.sparks = new ParticlePool(this.scene, 500, 0.09, true);
    this.confetti = new ParticlePool(this.scene, 700, 0.13, false);

    this.resize();
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
  }

  // A tiny lit room rendered once into a reflection map, so metals have something to reflect.
  _buildEnvironment() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x05070a);
    const panel = (color, w, h, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(0xfff1d6, 8, 3, 0, 9, 2);
    panel(0x6fb6ff, 3, 6, -9, 2, 3);
    panel(0xffb060, 3, 6, 9, 2, 3);
    panel(0xffffff, 10, 1, 0, 1, 10);
    panel(0x30363c, 20, 20, 0, -6, 0);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
  }

  _buildSet() {
    const scene = this.scene;
    // Floor: concentric game-show rings and wedges, painted on a canvas.
    const floorTex = canvasTexture(1024, 1024, (c, w, h) => {
      c.fillStyle = '#0b0d10';
      c.fillRect(0, 0, w, h);
      c.translate(w / 2, h / 2);
      for (let i = 0; i < 36; i++) {
        c.fillStyle = i % 2 ? '#101317' : '#16191e';
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, 512, (i / 36) * TAU, ((i + 1) / 36) * TAU);
        c.fill();
      }
      for (let r = 60; r < 512; r += 58) {
        c.strokeStyle = r % 116 === 60 ? '#3a3020' : '#22262c';
        c.lineWidth = r % 116 === 60 ? 5 : 2;
        c.beginPath();
        c.arc(0, 0, r, 0, TAU);
        c.stroke();
      }
    });
    this.floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.3, metalness: 0.6 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(24, 72), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    this.setMat = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.5, metalness: 0.6 });
    this.brass = new THREE.MeshStandardMaterial({ color: 0xc79a3c, roughness: 0.28, metalness: 1 });
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(7.3, 7.5, 0.18, 72), this.setMat);
    riser.position.y = 0.09;
    riser.receiveShadow = true;
    scene.add(riser);

    // Back wall: vertical slats.
    const wallTex = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#0e1013';
      c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32) {
        c.fillStyle = '#15181c';
        c.fillRect(x + 3, 0, 26, h);
        c.fillStyle = '#1d2126';
        c.fillRect(x + 3, 0, 2, h);
      }
    });
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(18, 2);
    this.wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.1, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 14, 64, 1, true), this.wallMat);
    wall.position.y = 7;
    scene.add(wall);

    // Lighting truss arch behind the pedestal.
    const arch = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.09, 8, 64, Math.PI), this.setMat);
    arch.position.set(0, 0.1, -7.2);
    scene.add(arch);
    const arch2 = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.07, 8, 64, Math.PI), this.setMat);
    arch2.position.set(0, 0.1, -8.6);
    scene.add(arch2);

    // Marquee bulbs: stage rim plus both arches. One instanced mesh, recoloured to chase.
    const spots = [];
    for (let i = 0; i < 84; i++) {
      const a = (i / 84) * TAU;
      spots.push({ x: Math.cos(a) * 7.42, y: 0.2, z: Math.sin(a) * 7.42, group: 0, i });
    }
    for (let i = 0; i <= 44; i++) {
      const a = (i / 44) * Math.PI;
      spots.push({ x: Math.cos(a) * 6.6, y: 0.1 + Math.sin(a) * 6.6, z: -7.05, group: 1, i });
    }
    for (let i = 0; i <= 56; i++) {
      const a = (i / 56) * Math.PI;
      spots.push({ x: Math.cos(a) * 8.4, y: 0.1 + Math.sin(a) * 8.4, z: -8.48, group: 2, i });
    }
    this.bulbSpots = spots;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), spots.length);
    const mtx = new THREE.Matrix4();
    spots.forEach((s, i) => {
      mtx.makeTranslation(s.x, s.y, s.z);
      this.bulbs.setMatrixAt(i, mtx);
      this.bulbs.setColorAt(i, new THREE.Color(0x332814));
    });
    scene.add(this.bulbs);
    this.bulbStep = -1;
    this.bulbOn = new THREE.Color(1.0, 0.8, 0.42);
    this.bulbOff = new THREE.Color(0.16, 0.11, 0.05);

    // Hanging eggcrate price sign: the same lamp glyphs as the HUD.
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 512;
    this.signCanvas.height = 192;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Group();
    add(sign, new THREE.BoxGeometry(4.3, 1.75, 0.2), this.setMat);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 1.5), new THREE.MeshBasicMaterial({ map: this.signTex, toneMapped: false }));
    face.position.z = 0.11;
    sign.add(face);
    for (const x of [-1.6, 1.6]) add(sign, new THREE.CylinderGeometry(0.02, 0.02, 3, 6), this.setMat, x, 2.35, 0);
    sign.position.set(0, 7.9, -7.0);
    sign.rotation.x = 0.12;
    scene.add(sign);
    this.sign = sign;
    this.setSign('CH20');
  }

  setSign(text, red = false) {
    if (this.signText === text && this.signRed === red) return;
    this.signText = text;
    this.signRed = red;
    const c = this.signCanvas.getContext('2d');
    c.fillStyle = LAMP.board;
    c.fillRect(0, 0, 512, 192);
    const cell = 18;
    const w = lampTextWidth('0000', cell);
    drawLamps(c, String(text).padStart(4, ' ').slice(-4), (512 - w) / 2, (192 - 7 * cell) / 2, cell, red ? { on: LAMP.red, hot: LAMP.redHot } : {});
    this.signTex.needsUpdate = true;
  }

  _spot(color, intensity, pos, target, angle, cone = true) {
    const s = new THREE.SpotLight(color, intensity, 40, angle, 0.55, 1.6);
    s.position.set(...pos);
    s.target.position.set(...target);
    this.scene.add(s, s.target);
    if (cone) {
      const from = new THREE.Vector3(...pos);
      const to = new THREE.Vector3(...target);
      const len = from.distanceTo(to) + 1.5;
      const geo = new THREE.ConeGeometry(Math.tan(angle) * len * 0.8, len, 32, 1, true);
      geo.translate(0, -len / 2, 0);
      const mat = new THREE.MeshBasicMaterial({
        map: this.beamTex, color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(from);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      mesh.userData.baseQ = mesh.quaternion.clone();
      mesh.userData.phase = Math.random() * TAU;
      this.scene.add(mesh);
      this.cones.push(mesh);
    }
    return s;
  }

  _buildLights() {
    this.cones = [];
    this.beamTex = canvasTexture(8, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#6a6a6a');
      g.addColorStop(1, '#000000');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    this.hemi = new THREE.HemisphereLight(0x90a8c0, 0x1a130c, 0.5);
    this.scene.add(this.hemi);
    this.key = this._spot(0xfff0d8, 900, [0, 11, 5.5], [0, 2, 0], 0.36);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0005;
    this._spot(0xbfd8ff, 420, [-7, 10, 3], [-4.7, 1.6, -2.6], 0.3);
    this._spot(0xbfd8ff, 420, [7, 10, 3], [4.7, 1.6, -2.6], 0.3);
    this._spot(0xbfd8ff, 460, [0, 13, 0], [0, 4.4, -6.2], 0.26);
    this._spot(0xffe2b0, 260, [-4.5, 8, 5], [-2.9, 1.6, 1.3], 0.26, false);
    const rim = new THREE.DirectionalLight(0x4f7dbf, 0.9);
    rim.position.set(0, 6, -10);
    this.scene.add(rim);
    this.priceLight = new THREE.PointLight(PRICE_COLORS.cool, 14, 9, 1.8);
    this.priceLight.position.set(0, 3.1, 0.6);
    this.scene.add(this.priceLight);
  }

  _buildPedestal() {
    const p = new THREE.Group();
    p.position.y = 0.18;
    this.scene.add(p);
    this.pedestal = p;
    add(p, new THREE.CylinderGeometry(1.25, 1.5, 0.3, 40), this.setMat, 0, 0.15, 0).receiveShadow = true;
    add(p, new THREE.CylinderGeometry(0.5, 0.78, 0.95, 28), this.brass, 0, 0.77, 0);
    add(p, new THREE.CylinderGeometry(1.08, 0.86, 0.16, 40), this.setMat, 0, 1.32, 0);
    add(p, new THREE.TorusGeometry(1.08, 0.035, 8, 48).rotateX(Math.PI / 2), this.brass, 0, 1.4, 0);

    this.turntable = new THREE.Group();
    this.turntable.position.y = 1.42;
    p.add(this.turntable);
    const topTex = canvasTexture(256, 256, (c, w) => {
      c.fillStyle = '#0d1014';
      c.fillRect(0, 0, w, w);
      c.translate(w / 2, w / 2);
      c.strokeStyle = '#ffffff';
      for (let r = 20; r < 128; r += 18) { c.lineWidth = r % 36 === 20 ? 3 : 1; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
      for (let i = 0; i < 24; i++) { c.rotate(TAU / 24); c.fillStyle = '#ffffff'; c.fillRect(104, -1.5, 18, 3); }
    });
    this.topMat = new THREE.MeshBasicMaterial({ map: topTex, color: PRICE_COLORS.cool, toneMapped: false });
    const top = new THREE.Mesh(new THREE.CircleGeometry(1.0, 48), this.topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.01;
    this.turntable.add(top);

    // The lot stands on the pedestal but does not ride the turntable: a photograph that
    // spun all the way round would show its back half the time.
    this.iconHolder = new THREE.Group();
    this.iconHolder.position.y = 1.44;
    p.add(this.iconHolder);
    this.frameBackMat = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.4, metalness: 0.7 });
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 1, transparent: true, opacity: 0.12, envMapIntensity: 1.6, depthWrite: false });

    this.holoMat = new THREE.MeshBasicMaterial({
      map: this.beamTex, color: PRICE_COLORS.cool, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const holo = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.95, 0.7, 40, 1, true).rotateX(Math.PI), this.holoMat);
    holo.position.y = 1.42 + 0.35;
    p.add(holo);

    // Floating price rings.
    this.ringMat = new THREE.MeshBasicMaterial({ color: PRICE_COLORS.cool, toneMapped: false });
    this.rings = [];
    [[2.02, 0.022, 0.2, 0.9], [2.22, 0.014, -0.3, -0.6], [2.44, 0.01, 0.4, 0.4]].forEach(([r, tube, tilt, speed], i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 96), this.ringMat);
      // A bead on each ring makes its spin readable.
      const bead = new THREE.Mesh(new THREE.SphereGeometry(tube * 3.2, 10, 8), this.ringMat);
      bead.position.x = r;
      ring.add(bead);
      ring.position.y = 2.8;
      ring.userData = { tilt, speed, i };
      p.add(ring);
      this.rings.push(ring);
    });
    this.priceColor = new THREE.Color(PRICE_COLORS.cool);
    this.priceTarget = new THREE.Color(PRICE_COLORS.cool);
    this.iconSpin = 0;
    this.iconScale = 1;
  }

  _buildGavel() {
    const g = new THREE.Group();
    g.position.set(-2.9, 0.18, 1.3);
    this.scene.add(g);
    this.gavelRig = g;
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3118, roughness: 0.45, metalness: 0.1 });
    add(g, new THREE.CylinderGeometry(0.34, 0.46, 0.14, 24), this.setMat, 0, 0.07, 0);
    add(g, new THREE.CylinderGeometry(0.1, 0.16, 1.2, 14), this.setMat, 0, 0.72, 0);
    this.anvil = add(g, new THREE.CylinderGeometry(0.56, 0.62, 0.22, 36), this.brass.clone(), 0, 1.42, 0);
    this.anvil.material.emissive = new THREE.Color(0xffb52e);
    this.anvil.material.emissiveIntensity = 0;
    add(g, new THREE.CylinderGeometry(0.44, 0.44, 0.03, 36), wood, 0, 1.545, 0);
    // Articulated arm: post, hinge, handle, head.
    add(g, new THREE.CylinderGeometry(0.06, 0.08, 1.9, 10), this.setMat, -1.0, 0.95, 0);
    add(g, new THREE.SphereGeometry(0.13, 16, 12), this.brass, -1.0, 1.9, 0);
    const pivot = new THREE.Group();
    pivot.position.set(-1.0, 1.9, 0);
    g.add(pivot);
    add(pivot, new THREE.CylinderGeometry(0.045, 0.06, 1.0, 12).rotateZ(Math.PI / 2), wood, 0.5, 0, 0);
    add(pivot, new THREE.CylinderGeometry(0.18, 0.18, 0.56, 22), wood, 1.0, -0.06, 0);
    for (const y of [-0.26, 0.14]) add(pivot, new THREE.TorusGeometry(0.185, 0.025, 8, 24).rotateX(Math.PI / 2), this.brass, 1.0, y, 0);
    add(pivot, new THREE.TorusGeometry(0.07, 0.02, 8, 16).rotateY(Math.PI / 2), this.brass, 0.14, 0, 0);
    this.gavel = { pivot, angle: 0.55, slam: null };
    pivot.rotation.z = 0.55;

    const wave = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 56),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    wave.rotation.x = -Math.PI / 2;
    wave.position.set(0, 1.58, 0);
    g.add(wave);
    this.wave = wave;
    this.waveT = 9;
    this.anvilWorld = new THREE.Vector3(-2.9, 1.78, 1.3);
  }

  // ---------- contenders ----------
  // Everyone at the table gets a podium. The local player is the camera, so their own
  // podium stays out of sight until the final showdown. Rivals stand in an arc behind
  // the pedestal, the middle ones raised so they can be seen over the lot.
  setContenders(list, localId = 0) {
    for (const u of this.units) { this.scene.remove(u.group); disposeTree(u.group, new Set([this.setMat, this.brass])); u.tex.dispose(); }
    this.units = [];
    const rivals = list.filter((c) => c.id !== localId);
    const k = rivals.length;
    list.forEach((c, idx) => {
      const u = this._makeUnit(c, idx);
      if (c.id === localId) {
        u.home = { pos: [0, 0.18, 9], rot: 0 };
        u.hiddenAtHome = true;
      } else {
        const i = rivals.indexOf(c);
        const x = k === 1 ? -0.72 : (i / (k - 1)) * 2 - 1;
        const lift = 1 - x * x;
        u.home = { pos: [x * 5.3, 0.18 + lift * 2.5, -2.5 - lift * 3.6], rot: -x * 0.5 };
        u.hiddenAtHome = false;
      }
      u.group.position.set(...u.home.pos);
      u.group.rotation.y = u.home.rot;
      u.target = { pos: new THREE.Vector3(...u.home.pos), rot: u.home.rot };
      u.group.visible = !u.hiddenAtHome;
      this.scene.add(u.group);
      this.units.push(u);
    });
    this.pedestal.visible = true;
    this.gavelRig.visible = true;
    this.celebrate = 0;
    this.crown = null;
    if (this.camMode === 'focus') this.camMode = 'wide';
    this.setOracle(false);
  }

  _makeUnit(c, idx) {
    const group = new THREE.Group();
    const color = new THREE.Color(c.color);
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.45), roughness: 0.6, metalness: 0.1, flatShading: true });
    const trimMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

    const riser = add(group, new THREE.CylinderGeometry(1.15, 1.25, 1, 28), this.setMat, 0, -0.5, 0);
    riser.visible = false;
    add(group, new THREE.BoxGeometry(1.6, 1.3, 0.9), this.setMat, 0, 0.65, 0);
    add(group, new THREE.BoxGeometry(1.64, 0.07, 0.94), trimMat, 0, 1.3, 0);
    add(group, new THREE.BoxGeometry(1.64, 0.04, 0.94), trimMat, 0, 0.04, 0);

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 150;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.64), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(0, 0.74, 0.456);
    group.add(screen);

    const bust = new THREE.Group();
    bust.position.set(0, 1.34, -0.1);
    group.add(bust);
    add(bust, new THREE.CylinderGeometry(0.3, 0.52, 0.85, 6), body, 0, 0.42, 0);
    add(bust, new THREE.BoxGeometry(1.0, 0.2, 0.42), body, 0, 0.78, 0);
    add(bust, new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), skin, 0, 0.95, 0);
    const head = new THREE.Group();
    head.position.y = 1.32;
    bust.add(head);
    const eyes = [];
    const eye = (x, y, z, w = 0.1, h = 0.07) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), eyeMat);
      e.position.set(x, y, z);
      head.add(e);
      eyes.push(e);
    };
    if (c.key === 'ledger') {
      add(head, new THREE.BoxGeometry(0.54, 0.6, 0.52), skin);
      add(head, new THREE.BoxGeometry(0.6, 0.16, 0.14), this.setMat, 0, 0.06, 0.24);
      eye(-0.14, 0.06, 0.32, 0.14, 0.06);
      eye(0.14, 0.06, 0.32, 0.14, 0.06);
    } else if (c.key === 'havoc') {
      add(head, new THREE.IcosahedronGeometry(0.36, 0), skin);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const spike = add(head, new THREE.ConeGeometry(0.08, 0.34, 4), body, Math.cos(a) * 0.18, 0.36, Math.sin(a) * 0.18);
        spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
      eye(-0.13, 0.04, 0.31);
      eye(0.13, 0.04, 0.31);
    } else if (c.key === 'thrift') {
      add(head, new THREE.SphereGeometry(0.34, 10, 7), skin);
      add(head, new THREE.CylinderGeometry(0.35, 0.35, 0.16, 12), body, 0, 0.22, 0);
      add(head, new THREE.BoxGeometry(0.5, 0.04, 0.3), body, 0, 0.16, 0.36);
      eye(-0.12, 0.0, 0.31, 0.09, 0.05);
      eye(0.12, 0.0, 0.31, 0.09, 0.05);
    } else {
      add(head, new THREE.SphereGeometry(0.34, 12, 9), skin);
      add(head, new THREE.TorusGeometry(0.37, 0.04, 6, 20, Math.PI), this.setMat, 0, 0.02, 0);
      add(head, new THREE.BoxGeometry(0.1, 0.2, 0.14), this.setMat, -0.37, -0.02, 0);
      add(head, new THREE.BoxGeometry(0.1, 0.2, 0.14), this.setMat, 0.37, -0.02, 0);
      eye(-0.12, 0.03, 0.31);
      eye(0.12, 0.03, 0.31);
    }

    const paddle = new THREE.Group();
    paddle.position.set(0.62, 0.6, 0.18);
    add(paddle, new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), this.setMat, 0, 0.35, 0);
    add(paddle, new THREE.CylinderGeometry(0.27, 0.27, 0.04, 24).rotateX(Math.PI / 2), trimMat, 0, 0.9, 0);
    paddle.scale.setScalar(0.001);
    bust.add(paddle);

    const u = {
      id: c.id, key: c.key, name: c.name, color, group, bust, head, paddle, eyes, eyeMat, trimMat, riser, canvas, tex,
      cash: c.cash ?? 0, mood: 'CALM', status: '',
      nod: 0, shakeT: 0, paddleT: 0, hop: 0, phase: idx * 1.7,
    };
    this._drawScreen(u);
    return u;
  }

  _drawScreen(u) {
    const c = u.canvas.getContext('2d');
    c.fillStyle = LAMP.board;
    c.fillRect(0, 0, 320, 150);
    drawLamps(c, u.name.slice(0, 8), 14, 12, 5, { on: '#f3ead6', hot: '#ffffff', off: null });
    const cash = `$${u.cash}`;
    const cell = 11;
    drawLamps(c, cash.padStart(3, ' '), 320 - 14 - lampTextWidth('000', cell), 60, cell, u.mood === 'RAGING' ? { on: LAMP.red, hot: LAMP.redHot } : {});
    if (u.status) drawLamps(c, u.status.slice(0, 6), 14, 100, 5, { on: LAMP.red, hot: LAMP.redHot, off: null });
    u.tex.needsUpdate = true;
  }

  _unit(id) { return this.units.find((u) => u.id === id) || null; }

  setCash(id, cash) {
    const u = this._unit(id);
    if (!u || u.cash === cash) return;
    u.cash = cash;
    this._drawScreen(u);
  }

  setStatus(id, status) {
    const u = this._unit(id);
    if (!u || u.status === status) return;
    u.status = status;
    this._drawScreen(u);
  }

  setMood(id, mood) {
    const u = this._unit(id);
    if (!u || u.mood === mood) return;
    u.mood = mood;
    const col = MOOD_COLORS[mood];
    u.eyeMat.color.set(col == null ? 0xffffff : col);
    this._drawScreen(u);
  }

  react(id, kind) {
    const u = this._unit(id);
    if (!u) return;
    if (kind === 'nod') u.nod = 0.7;
    else if (kind === 'shake') u.shakeT = 0.8;
    else if (kind === 'hop') u.hop = 0.6;
  }

  // ---------- lots ----------
  // Puts a lot on the pedestal: a sealed crate, or a glass-and-gold frame holding the
  // lot's photograph (or its illustrated card until, or unless, a photograph arrives).
  showLot(item, { mystery = false } = {}) {
    this.clearLot();
    this.lotItem = item;
    this.lotMystery = mystery;
    let g;
    if (mystery) {
      g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ map: this._crateTexture(), roughness: 0.8, metalness: 0.05 });
      add(g, new THREE.BoxGeometry(1.5, 1.5, 1.5), mat);
      g.position.y = 1.15;
      g.userData.crate = true;
      g.userData.baseY = 1.15;
    } else {
      const m = this.media ? this.media.texture(item, THREE) : { texture: this._blankTexture(), aspect: 1.5 };
      g = this._makeFrame(m.texture, m.aspect);
    }
    g.scale.setScalar(0.001);
    this.iconHolder.add(g);
    this.icon = g;
    this.iconScale = 0;
    this.iconDrop = false;
    this.iconWobble = 0;
    this.flipT = 0;
    this.yaw = 0;
  }

  // A photograph has just arrived for the lot that is on the pedestal: swap it in.
  refreshLot(item) {
    if (!this.icon || this.lotMystery || !this.lotItem || this.lotItem.id !== item.id) return;
    const scale = this.iconScale;
    this.showLot(item, { mystery: false });
    this.iconScale = scale;
    this.flipT = 1;
  }

  clearLot() {
    if (!this.icon) return;
    this.iconHolder.remove(this.icon);
    disposeTree(this.icon, this.keepMats);
    this.icon = null;
    this.lotItem = null;
  }

  _blankTexture() {
    if (!this.blankTex) this.blankTex = canvasTexture(8, 8, (c) => { c.fillStyle = '#14171b'; c.fillRect(0, 0, 8, 8); });
    return this.blankTex;
  }

  _makeFrame(texture, aspect) {
    const maxW = 3.2;
    const maxH = 2.15;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    const bar = 0.085;
    const depth = 0.14;
    const g = new THREE.Group();
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    g.add(photo);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.frameBackMat);
    back.rotation.y = Math.PI;
    back.position.z = -0.03;
    g.add(back);
    add(g, new THREE.BoxGeometry(w + bar * 2, bar, depth), this.brass, 0, h / 2 + bar / 2, 0);
    add(g, new THREE.BoxGeometry(w + bar * 2, bar, depth), this.brass, 0, -h / 2 - bar / 2, 0);
    add(g, new THREE.BoxGeometry(bar, h, depth), this.brass, -w / 2 - bar / 2, 0, 0);
    add(g, new THREE.BoxGeometry(bar, h, depth), this.brass, w / 2 + bar / 2, 0, 0);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.glassMat);
    glass.position.z = 0.05;
    g.add(glass);
    const size = new THREE.Vector2(w + bar * 2 + 0.34, h + bar * 2 + 0.34);
    const rimMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.priceColor.clone() }, uTime: { value: 0 }, uHeat: { value: 0 }, uSize: { value: size } },
      vertexShader: RIM_VERT, fragmentShader: RIM_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const rim = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), rimMat);
    rim.position.z = -0.01;
    g.add(rim);
    // Stand.
    add(g, new THREE.CylinderGeometry(0.05, 0.07, 0.34, 12), this.brass, 0, -h / 2 - bar - 0.16, 0);
    add(g, new THREE.CylinderGeometry(0.34, 0.4, 0.06, 28), this.brass, 0, -h / 2 - bar - 0.33, 0);
    const baseY = 0.36 + bar + h / 2;
    g.position.y = baseY;
    g.userData = { rim: rimMat, baseY, w, h };
    return g;
  }

  // A small framed copy of a lot flies from one podium to another (a steal).
  flyItem(item, fromId, toId) {
    if (!this.media) return;
    const m = this.media.texture(item, THREE);
    const w = 1.3;
    const h = Math.min(1.1, w / m.aspect);
    const g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.12, h + 0.12), new THREE.MeshBasicMaterial({ color: 0xffc94d, side: THREE.DoubleSide, toneMapped: false }));
    edge.position.z = -0.01;
    g.add(edge);
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: m.texture, side: THREE.DoubleSide, toneMapped: false })));
    const spot = (id) => {
      const u = this._unit(id);
      if (u && u.group.visible) return u.group.position.clone().add(new THREE.Vector3(0, 3.3, 0.4));
      // The local player has no podium on screen: their lots come to, and leave from, the camera.
      const dir = this.camLook.clone().sub(this.camPos).normalize();
      return this.camPos.clone().addScaledVector(dir, 2.6).add(new THREE.Vector3(0, -0.9, 0));
    };
    const from = spot(fromId);
    const to = spot(toId);
    g.position.copy(from);
    this.scene.add(g);
    this.flights.push({ g, from, to, t: 0, dur: 1.3 });
    this.sparks.emit({ x: from.x, y: from.y, z: from.z, n: 40, speed: 2.4, up: 0.8, colors: [0xffd27a, 0xff3b2a], life: 0.8, gravity: 3, drag: 1.2 });
  }

  // The Oracle takes over the studio: violet light, and the house lights drop.
  setOracle(on) {
    if (this.oracleOn === on) return;
    this.oracleOn = on;
    if (on) {
      this.bulbOn.setRGB(0.78, 0.5, 1.0);
      this.priceTarget.set(0xa56bff);
      this.key.intensity = 260;
    } else {
      this.bulbOn.setRGB(1.0, 0.8, 0.42);
      this.key.intensity = 900;
      this.setPrice(this.price);
    }
    this.bulbStep = -1;
  }

  // Point the camera at one contender's podium. `close` pushes in for the gamble.
  focusUnit(id, close = false) {
    const u = this._unit(id);
    if (!u || !u.group.visible) { this.camMode = 'pedestal'; return; }
    const p = u.target.pos;
    this.focus = { pos: [p.x * 0.72, p.y + 2.7, p.z + (close ? 4.3 : 6.4)], look: [p.x, p.y + 2.2, p.z], orbit: 0.02 };
    this.camMode = 'focus';
  }

  _crateTexture() {
    if (this.crateTex) return this.crateTex;
    this.crateTex = canvasTexture(256, 256, (c, w) => {
      c.fillStyle = '#6b4a26';
      c.fillRect(0, 0, w, w);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = i % 2 ? '#7a5730' : '#63431f';
        c.fillRect(0, i * 43, w, 40);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(0, i * 43 + 40, w, 3);
      }
      c.strokeStyle = '#3a2610';
      c.lineWidth = 22;
      c.strokeRect(11, 11, w - 22, w - 22);
      c.fillStyle = '#17120c';
      c.font = '900 150px Impact, "Arial Black", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('?', w / 2, w / 2 + 8);
    });
    return this.crateTex;
  }

  setPrice(amount) {
    this.price = amount;
    const key = amount >= 8 ? 'crimson' : amount >= 4 ? 'amber' : 'cool';
    if (!this.oracleOn) this.priceTarget.set(PRICE_COLORS[key]);
    this.setSign(amount > 0 ? `$${amount}` : '$0', amount >= 8);
  }

  setCallStage(stage) { this.callStage = stage; }

  bid(id, amount) {
    this.setPrice(amount);
    this._slam(0.55);
    const u = this._unit(id);
    if (u && u.group.visible) { u.paddleT = 1.1; u.nod = 0.4; }
    this.kick = 1;
  }

  sold(id) {
    this._slam(1.5);
    const u = this._unit(id);
    const at = u && u.group.visible ? u.group.position.clone().add(new THREE.Vector3(0, 3.4, 0)) : new THREE.Vector3(0, 4.2, 0.5);
    if (u) u.hop = 0.9;
    this.confetti.emit({ x: at.x, y: at.y, z: at.z, n: 110, speed: 4.5, up: 0.9, colors: [0xff3b2a, 0xffb52e, 0xf3ead6, 0x35d6e8], life: 2.6, gravity: 3.2, drag: 1.2 });
    this.confetti.emit({ x: 0, y: 3.6, z: 0, n: 40, speed: 3.2, up: 1.4, colors: [0xffc94d, 0xffe08a], life: 1.8, gravity: 7, drag: 0.3 });
  }

  noSale() {
    this._slam(0.35);
    this.iconDrop = true;
  }

  _slam(power) {
    this.gavel.slam = { t: 0, from: this.gavel.angle, power, hit: false };
  }

  _impact(power) {
    const p = this.anvilWorld;
    this.sparks.emit({ x: p.x, y: p.y, z: p.z, n: Math.round(26 * power), speed: 2.6 + power * 1.6, up: 0.9, colors: [0xffd27a, 0xffb52e, 0xfff1c2], life: 0.7, gravity: 7, drag: 1.0, radius: 0.35 });
    this.waveT = 0;
    this.wavePower = power;
    this.shake = Math.max(this.shake, 0.07 * power);
    this.anvil.material.emissiveIntensity = 0.9 * power;
  }

  crateShake(on) { this.iconWobble = on ? 1 : 0; }

  // The crate bursts: six panels fly, then the real lot lands in its true colours.
  crateBurst(item, good) {
    const origin = new THREE.Vector3();
    this.iconHolder.getWorldPosition(origin);
    const mat = new THREE.MeshStandardMaterial({ map: this._crateTexture(), roughness: 0.8, side: THREE.DoubleSide });
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const d of dirs) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), mat);
      m.position.copy(origin).add(new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(0.6));
      m.lookAt(origin);
      this.scene.add(m);
      this.debris.push({
        mesh: m, life: 1.8,
        vel: new THREE.Vector3(d[0] * 3.5 + (Math.random() - 0.5), d[1] * 2.5 + 4, d[2] * 3.5 + (Math.random() - 0.5)),
        spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
      });
    }
    this.showLot(item, { mystery: false });
    this.shake = Math.max(this.shake, 0.16);
    if (good) {
      this.confetti.emit({ x: origin.x, y: origin.y, z: origin.z, n: 160, speed: 6, up: 1.2, colors: [0xffc94d, 0xffe08a, 0xfff1c2], life: 2.4, gravity: 6, drag: 0.5 });
      this.sparks.emit({ x: origin.x, y: origin.y, z: origin.z, n: 120, speed: 5, up: 1, colors: [0xffd27a, 0xffffff], life: 1.2, gravity: 2, drag: 1.2 });
    } else {
      this.sparks.emit({ x: origin.x, y: origin.y, z: origin.z, n: 140, speed: 3, up: 0.6, colors: [0x6fae4f, 0x8a5fd0, 0x3b2a4a], life: 1.8, gravity: -0.6, drag: 1.6 });
    }
  }

  // ---------- camera + finale ----------
  setCamera(mode) {
    if (CAMS[mode]) this.camMode = mode;
  }

  heistFlash(thiefId, victimId) {
    for (const id of [thiefId, victimId]) {
      const u = this._unit(id);
      if (!u || !u.group.visible) continue;
      const p = u.group.position;
      this.sparks.emit({ x: p.x, y: p.y + 2.6, z: p.z, n: 50, speed: 3, up: 1, colors: [0xff3b2a, 0xffb52e], life: 0.9, gravity: 4, drag: 1 });
      if (id === victimId) u.shakeT = 1; else u.hop = 0.8;
    }
    this.shake = Math.max(this.shake, 0.08);
  }

  vaultFlash(id) {
    const u = this._unit(id);
    if (!u || !u.group.visible) return;
    const p = u.group.position;
    this.sparks.emit({ x: p.x, y: p.y + 1.4, z: p.z + 0.6, n: 24, speed: 1.6, up: 1, colors: [0x9fd6c0, 0xf3ead6], life: 0.7, gravity: 2, drag: 1.5 });
    u.nod = 0.5;
  }

  // Final podium: one step per contender by rank, winner crowned.
  showdown(ranking) {
    this.clearLot();
    this.setOracle(false);
    this.pedestal.visible = false;
    this.gavelRig.visible = false;
    const xs = [-1.35, 1.35, -4.05, 4.05, -6.75, 6.75];
    const hs = [1.7, 1.15, 0.75, 0.5, 0.35, 0.22];
    ranking.forEach((id, i) => {
      const u = this._unit(id);
      if (!u) return;
      if (!u.group.visible) {
        u.group.visible = true;
        u.group.position.set(xs[i], 0.18, 6);
      }
      u.target = { pos: new THREE.Vector3(xs[i], hs[i], -0.5), rot: -xs[i] * 0.05 };
    });
    const win = this._unit(ranking[0]);
    if (win) {
      const crown = new THREE.Group();
      buildCrown(crown, {
        main: new THREE.MeshStandardMaterial({ color: 0xffc94d, metalness: 1, roughness: 0.2 }),
        alt: new THREE.MeshStandardMaterial({ color: 0xff3b2a, metalness: 0.6, roughness: 0.3 }),
      });
      crown.scale.setScalar(0.62);
      crown.position.y = 0.62;
      win.head.add(crown);
      this.crown = crown;
      this.celebrate = 7;
      this.celebrateAt.set(xs[0], hs[0] + 4.6, -0.5);
      win.hop = 1.2;
    }
    this.setSign('WIN!', true);
    if (ranking.length > 4) {
      this.focus = { pos: [0, 4.2, 15.5], look: [0, 2.5, 0], orbit: 0.08 };
      this.camMode = 'focus';
    } else {
      this.setCamera('podium');
    }
  }

  setTheme(theme) {
    this.theme = theme;
    const light = theme === 'light';
    const bg = light ? 0x8b9197 : 0x06080b;
    this.scene.background.set(bg);
    this.scene.fog.color.set(bg);
    this.hemi.intensity = light ? 2.4 : 0.5;
    this.wallMat.color.set(light ? 0xd9dde2 : 0xffffff);
    for (const c of this.cones) c.material.opacity = light ? 0.05 : 0.12;
    this.renderer.toneMappingExposure = light ? 1.15 : 1.05;
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- frame ----------
  // Adaptive quality: if frames are slow, drop resolution and shadows rather than stutter.
  _watchPerformance(rawDt) {
    if (rawDt > 0.5 || rawDt <= 0) return; // the tab was asleep, not slow
    const p = this.perf || (this.perf = { n: 0, sum: 0, level: 0 });
    p.sum += rawDt;
    p.n++;
    if (p.n < 45) return;
    const avg = p.sum / p.n;
    p.n = 0;
    p.sum = 0;
    if (avg <= 0.04 || p.level >= 2) return;
    p.level++;
    this.renderer.setPixelRatio(p.level === 1 ? 1 : 0.6);
    this.renderer.shadowMap.enabled = false;
    this.key.castShadow = false;
    if (p.level === 2) for (const c of this.cones) c.visible = false;
    this.w = 0;
    this.resize();
  }

  update(dt, reduceMotion = false) {
    this._watchPerformance(dt);
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    const motion = reduceMotion ? 0.25 : 1;

    // Price colour: rings, turntable, holo beam and the fill light move together.
    this.priceColor.lerp(this.priceTarget, 1 - Math.exp(-6 * dt));
    this.ringMat.color.copy(this.priceColor);
    this.topMat.color.copy(this.priceColor);
    this.holoMat.color.copy(this.priceColor);
    this.priceLight.color.copy(this.priceColor);
    const heat = 1 + Math.min(this.price, 12) * 0.14 + this.callStage * 0.5;
    for (const ring of this.rings) {
      const d = ring.userData;
      ring.rotation.x = Math.PI / 2 + d.tilt * 0.45 * Math.sin(t * 0.7 + d.i);
      ring.rotation.y = d.tilt * 0.3 * Math.cos(t * 0.5 + d.i * 2);
      ring.rotation.z += d.speed * dt * heat * motion;
      ring.position.y = 2.8 + Math.sin(t * 1.3 + d.i * 2) * 0.12 * motion;
    }

    // The lot on the pedestal.
    this.turntable.rotation.y += 0.5 * dt * motion;
    this.pointer.x = damp(this.pointer.x, this.pointer.tx, 4, dt);
    this.pointer.y = damp(this.pointer.y, this.pointer.ty, 4, dt);
    this.kick = damp(this.kick, 0, 5, dt);
    this.flipT = Math.min(1, this.flipT + dt / 0.9);
    if (this.icon) {
      this.iconScale = damp(this.iconScale, this.iconDrop ? 0 : 1, 7, dt);
      this.icon.scale.setScalar(Math.max(0.001, this.iconScale));
      const d = this.icon.userData;
      this.icon.position.y = d.baseY + Math.sin(t * 1.6) * 0.05 * motion;
      if (d.crate) {
        this.yaw += 0.6 * dt * motion;
        this.icon.rotation.y = this.yaw;
        this.icon.rotation.z = this.iconWobble ? Math.sin(t * 34) * 0.07 : 0;
        this.icon.position.x = this.iconWobble ? Math.sin(t * 41) * 0.03 : 0;
      } else {
        // A slow sway, one full turn as it arrives, a shiver on every bid, and a lean
        // towards the pointer.
        const arrive = Math.pow(1 - this.flipT, 3) * -TAU * motion;
        this.icon.rotation.y = Math.sin(t * 0.45) * 0.34 * motion + arrive + Math.sin(t * 15) * 0.05 * this.kick + this.pointer.x * 0.24;
        this.icon.rotation.x = Math.sin(t * 0.8) * 0.035 * motion + this.pointer.y * 0.09;
        d.rim.uniforms.uTime.value = t;
        d.rim.uniforms.uHeat.value = this.callStage * 0.9;
        d.rim.uniforms.uColor.value.copy(this.priceColor);
      }
    }
    if (!this.icon) this.iconDrop = false;

    // Lots in flight between podiums.
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt / f.dur;
      const kf = Math.min(1, f.t);
      const e2 = kf * kf * (3 - 2 * kf);
      f.g.position.lerpVectors(f.from, f.to, e2);
      f.g.position.y += Math.sin(Math.PI * kf) * 2.8;
      f.g.lookAt(this.camera.position);
      f.g.rotateZ(kf * TAU * 1.5);
      f.g.scale.setScalar(kf > 0.85 ? Math.max(0.01, (1 - kf) / 0.15) : 1);
      if (f.t >= 1) {
        this.sparks.emit({ x: f.to.x, y: f.to.y, z: f.to.z, n: 50, speed: 3, up: 1, colors: [0xffd27a, 0xfff1c2], life: 0.9, gravity: 4, drag: 1 });
        this.scene.remove(f.g);
        disposeTree(f.g);
        this.flights.splice(i, 1);
      }
    }

    // Marquee chase. Faster as the auctioneer counts down.
    const speed = (this.oracleOn ? 11 : 4) + this.callStage * 5;
    const step = Math.floor(t * speed);
    if (step !== this.bulbStep) {
      this.bulbStep = step;
      this.bulbSpots.forEach((s, i) => {
        const lit = s.group === 0 ? (s.i + step) % 3 === 0 : (s.i + step * (s.group === 1 ? 1 : -1) + 400) % 4 < 2;
        this.bulbs.setColorAt(i, lit ? this.bulbOn : this.bulbOff);
      });
      this.bulbs.instanceColor.needsUpdate = true;
    }

    // Light cones sway a little.
    const q = this._q || (this._q = new THREE.Quaternion());
    const e = this._e || (this._e = new THREE.Euler());
    for (const c of this.cones) {
      e.set(Math.sin(t * 0.4 + c.userData.phase) * 0.035 * motion, 0, Math.cos(t * 0.33 + c.userData.phase) * 0.035 * motion);
      q.setFromEuler(e);
      c.quaternion.copy(c.userData.baseQ).multiply(q);
    }

    this._updateGavel(dt, t);
    this._updateUnits(dt, t, motion);

    // Debris from an opened crate.
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 11 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.life <= 0 || d.mesh.position.y < 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        if (!this.debris.some((o) => o !== d && o.mesh.material === d.mesh.material)) d.mesh.material.dispose();
        this.debris.splice(i, 1);
      }
    }

    if (this.celebrate > 0) {
      this.celebrate -= dt;
      if (Math.random() < dt * 14) {
        const p = this.celebrateAt;
        this.confetti.emit({ x: p.x + (Math.random() - 0.5) * 6, y: p.y, z: p.z, n: 12, speed: 1.5, up: 0.2, colors: [0xff3b2a, 0xffb52e, 0xf3ead6, 0xffc94d], life: 3.4, gravity: 2.2, drag: 1.4 });
      }
    }
    this.sparks.update(dt);
    this.confetti.update(dt);

    // Camera.
    const cam = this.camMode === 'focus' && this.focus ? this.focus : CAMS[this.camMode] || CAMS.wide;
    const fit = clamp(1.55 / this.camera.aspect, 1, 2.1); // pull back on narrow screens
    const orbit = Math.sin(t * 0.18) * cam.orbit * motion;
    const look = this._v1 || (this._v1 = new THREE.Vector3());
    const pos = this._v2 || (this._v2 = new THREE.Vector3());
    look.set(...cam.look);
    pos.set(...cam.pos).sub(look).multiplyScalar(fit);
    pos.applyAxisAngle(THREE.Object3D.DEFAULT_UP, orbit).add(look);
    const k = 1 - Math.exp(-2.6 * dt);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.shake = damp(this.shake, 0, 7, dt);
    const sh = reduceMotion ? 0 : this.shake;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + (Math.random() - 0.5) * sh,
      this.camPos.z + (Math.random() - 0.5) * sh,
    );
    this.camera.lookAt(this.camLook);
  }

  _updateGavel(dt, t) {
    const g = this.gavel;
    const rest = [0.55, 0.9, 1.2, 1.5][this.callStage] || 0.55;
    if (g.slam) {
      const s = g.slam;
      s.t += dt;
      const down = 0.085;
      if (s.t < down) {
        g.angle = lerp(s.from, 0, Math.pow(s.t / down, 2));
      } else {
        if (!s.hit) { s.hit = true; this._impact(s.power); }
        const k = s.t - down;
        g.angle = 0.2 * s.power * Math.exp(-k * 9) * Math.abs(Math.sin(k * 20));
        if (k > 0.45) g.slam = null;
      }
    } else {
      g.angle = damp(g.angle, rest + (this.callStage ? Math.sin(t * 30) * 0.012 * this.callStage : 0), 6, dt);
    }
    g.pivot.rotation.z = g.angle;
    this.anvil.material.emissiveIntensity = damp(this.anvil.material.emissiveIntensity, 0, 6, dt);
    if (this.waveT < 1) {
      this.waveT += dt * 1.9;
      const s = 1 + this.waveT * 4.5 * (this.wavePower || 1);
      this.wave.scale.set(s, s, 1);
      this.wave.material.opacity = Math.max(0, 0.85 * (1 - this.waveT));
    } else {
      this.wave.material.opacity = 0;
    }
  }

  _updateUnits(dt, t, motion) {
    for (const u of this.units) {
      if (!u.group.visible) continue;
      const k = 1 - Math.exp(-3 * dt);
      u.group.position.lerp(u.target.pos, k);
      u.group.rotation.y = lerp(u.group.rotation.y, u.target.rot, k);
      const y = u.group.position.y - 0.18;
      u.riser.visible = y > 0.08;
      if (u.riser.visible) { u.riser.scale.y = y; u.riser.position.y = -y / 2; }

      u.nod = Math.max(0, u.nod - dt);
      u.shakeT = Math.max(0, u.shakeT - dt);
      u.hop = Math.max(0, u.hop - dt);
      u.paddleT = Math.max(0, u.paddleT - dt);

      let rx = Math.sin(t * 0.9 + u.phase) * 0.04 * motion;
      let ry = Math.sin(t * 0.5 + u.phase) * 0.12 * motion;
      let rz = 0;
      let jitter = 0;
      if (u.mood === 'SMUG') { rz = 0.14; rx -= 0.08; }
      if (u.mood === 'SWEATING') jitter = 0.012;
      if (u.mood === 'RAGING') { jitter = 0.035; rx += 0.1; }
      if (u.nod > 0) rx += Math.sin(u.nod * 18) * 0.28 * Math.min(1, u.nod * 3);
      if (u.shakeT > 0) ry = Math.sin(u.shakeT * 22) * 0.5 * Math.min(1, u.shakeT * 3);
      u.head.rotation.set(rx, ry, rz);
      u.bust.position.x = (Math.random() - 0.5) * jitter * motion;
      u.bust.position.y = 1.34 + Math.abs(Math.sin(u.hop * 12)) * 0.22 * Math.min(1, u.hop * 2) + Math.sin(t * 1.4 + u.phase) * 0.012;

      const up = u.paddleT > 0 ? 1 : 0;
      const ps = damp(u.paddle.scale.x, up ? 1 : 0.001, up ? 16 : 8, dt);
      u.paddle.scale.setScalar(ps);
      u.paddle.rotation.z = lerp(-0.9, -0.12 + Math.sin(t * 16) * 0.05 * up, clamp(ps, 0, 1));
    }
  }

  render() {
    if (this.lost) return;
    this.renderer.render(this.scene, this.camera);
  }
}
