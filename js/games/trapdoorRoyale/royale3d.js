// TRAPDOOR ROYALE — the arena. A floating floor over a long drop: a central hub, four
// coloured answer platforms on trapdoor hinges, light bridges between them, an overhead
// question board, and up to twelve contestants. All geometry is primitives; all
// textures are painted on canvases.

import * as THREE from 'three';
import { TAU, damp, clamp, canvasTexture, add, disposeTree, ParticlePool } from '../../render/kit3d.js';
import { Figure } from '../../arcade/figures3d.js';

// Okabe-Ito colours: told apart with any common colour-vision difference. Each platform
// also carries its letter, so colour is never the only cue.
export const PLATFORM_COLORS = Object.freeze(['#0072B2', '#E69F00', '#009E73', '#CC79A7']);
const LETTERS = ['A', 'B', 'C', 'D'];
const SIZE = 5;
const OFFSET = 4.6;
const HUB = 2.0;
const DISPLAY = '"Bahnschrift", "DIN Alternate", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

const centreOf = (i) => ({ x: i % 2 ? OFFSET : -OFFSET, z: i >= 2 ? OFFSET : -OFFSET });

function wrap(c, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (c.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export class RoyaleStage {
  constructor(renderer, container, { onPick }) {
    this.renderer = renderer;
    this.container = container;
    this.onPick = onPick;
    this.t = 0;
    this.figures = new Map();
    this.localId = -1;
    this.shake = 0;
    this.locked = false;
    this.scramble = false;
    this.championId = null;
    this.hubLift = 0;
    this.pending = []; // timed callbacks

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04050a);
    scene.fog = new THREE.Fog(0x04050a, 30, 90);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
    this.camPos = new THREE.Vector3(0, 15, 15.8);
    this.camLook = new THREE.Vector3(0, 0, 1.4);
    this.camTarget = { pos: new THREE.Vector3(0, 15, 15.8), look: new THREE.Vector3(0, 0, 1.4) };

    this._lights();
    this._abyss();
    this._arena();
    this._board();
    this.sparks = new ParticlePool(scene, 500, 0.11, true);
    this.confetti = new ParticlePool(scene, 600, 0.16, false);

    this.ray = new THREE.Raycaster();
    this._down = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(v, this.camera);
      const hit = this.ray.intersectObjects(this.hitboxes, false)[0];
      if (hit) this.onPick(hit.object.userData.index);
    };
    renderer.domElement.addEventListener('pointerdown', this._down);
    this.resize();
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0x9fb4d8, 0x10131c, 0.75);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff2dc, 1.7);
    key.position.set(7, 16, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
    key.shadow.bias = -0.0006;
    this.scene.add(key);
    const under = new THREE.PointLight(0x3aa0ff, 60, 60, 1.6);
    under.position.set(0, -9, 0);
    this.scene.add(under);
    this.under = under;
  }

  _abyss() {
    const gridTex = canvasTexture(512, 512, (c, w) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, w);
      c.strokeStyle = '#2f7fd0';
      c.lineWidth = 2;
      for (let i = 0; i <= 8; i++) {
        c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, w); c.stroke();
        c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke();
      }
    });
    gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(14, 14);
    this.gridTex = gridTex;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -34;
    this.scene.add(floor);
    // Rings hanging in the drop give the eye something to measure the fall against.
    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(12.5 + i * 0.8, 0.07, 6, 80), new THREE.MeshBasicMaterial({ color: PLATFORM_COLORS[i], toneMapped: false, transparent: true, opacity: 0.8 - i * 0.14 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -5 - i * 6.5;
      this.scene.add(ring);
      this.rings.push(ring);
    }
    // Motes drifting up out of the dark.
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = -34 + Math.random() * 40; pos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x7fc4ff, size: 0.12, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  _arena() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.5, metalness: 0.7 });
    this.steel = steel;
    // The hub, which is also the champion's pillar.
    this.hub = new THREE.Group();
    add(this.hub, new THREE.CylinderGeometry(HUB, HUB * 0.82, 0.5, 40), steel, 0, -0.25, 0).receiveShadow = true;
    add(this.hub, new THREE.CylinderGeometry(HUB * 0.5, HUB * 0.62, 9, 20), steel, 0, -5, 0);
    const hubTop = new THREE.Mesh(new THREE.RingGeometry(HUB - 0.22, HUB - 0.06, 48), new THREE.MeshBasicMaterial({ color: 0xf3ead6, toneMapped: false, side: THREE.DoubleSide }));
    hubTop.rotation.x = -Math.PI / 2;
    hubTop.position.y = 0.01;
    this.hub.add(hubTop);
    this.scene.add(this.hub);

    this.platforms = [];
    this.hitboxes = [];
    for (let i = 0; i < 4; i++) {
      const c = centreOf(i);
      const color = new THREE.Color(PLATFORM_COLORS[i]);
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      const topMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, emissive: color, emissiveIntensity: 0.18 });
      const leaves = [];
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * (SIZE / 2), 0, 0);
        const body = add(pivot, new THREE.BoxGeometry(SIZE / 2 - 0.03, 0.34, SIZE), steel, -side * (SIZE / 4), -0.19, 0);
        body.receiveShadow = true;
        const top = add(pivot, new THREE.BoxGeometry(SIZE / 2 - 0.12, 0.05, SIZE - 0.18), topMat, -side * (SIZE / 4), 0, 0);
        top.receiveShadow = true;
        g.add(pivot);
        leaves.push({ pivot, side });
      }
      // The letter, on the floor of the platform and on a sign at its outer corner.
      const letterTex = canvasTexture(256, 256, (cx, w) => {
        cx.clearRect(0, 0, w, w);
        cx.fillStyle = 'rgba(10,9,8,0.82)';
        cx.font = `700 230px ${DISPLAY}`;
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(LETTERS[i], w / 2, w / 2 + 14);
      });
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: letterTex, transparent: true, depthWrite: false }));
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = 0.04;
      g.add(decal);
      const signTex = canvasTexture(128, 128, (cx, w) => {
        cx.fillStyle = PLATFORM_COLORS[i];
        cx.beginPath(); cx.arc(w / 2, w / 2, 60, 0, TAU); cx.fill();
        cx.fillStyle = '#0a0908';
        cx.font = `700 92px ${DISPLAY}`;
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(LETTERS[i], w / 2, w / 2 + 6);
      });
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, toneMapped: false }));
      sign.scale.set(1.5, 1.5, 1);
      sign.position.set(c.x * 1.52, 2.9, c.z * 1.52);
      this.scene.add(sign);
      add(this.scene, new THREE.CylinderGeometry(0.04, 0.04, 2.9, 6), steel, c.x * 1.52, 1.45, c.z * 1.52);

      // Light bridge from the hub to the platform's inner corner.
      const bridgeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.0), bridgeMat);
      const dir = new THREE.Vector2(Math.sign(c.x), Math.sign(c.z)).normalize();
      bridge.position.set(dir.x * 2.75, -0.02, dir.y * 2.75);
      bridge.rotation.y = -Math.atan2(dir.y, dir.x);
      this.scene.add(bridge);

      // A spotlight above each platform.
      const spot = new THREE.SpotLight(color, 0, 30, 0.42, 0.5, 1.4);
      spot.position.set(c.x * 1.2, 13, c.z * 1.2);
      spot.target.position.set(c.x, 0, c.z);
      this.scene.add(spot, spot.target);

      const hit = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 2.4, SIZE), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(c.x, 1, c.z);
      hit.userData.index = i;
      this.scene.add(hit);
      this.hitboxes.push(hit);

      this.scene.add(g);
      this.platforms.push({ g, leaves, topMat, color, decal, bridge, bridgeMat, spot, sign, angle: 0, open: false, state: 'idle', crowd: 0 });
    }
  }

  // The overhead board: mode, question and four answers.
  _board() {
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 1024;
    this.boardCanvas.height = 512;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = 8;
    const g = new THREE.Group();
    add(g, new THREE.BoxGeometry(11.4, 5.8, 0.3), this.steel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(11, 5.5), new THREE.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }));
    face.position.z = 0.16;
    g.add(face);
    this.timeBar = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.16), new THREE.MeshBasicMaterial({ color: 0xf3ead6, toneMapped: false }));
    this.timeBar.position.set(0, -2.98, 0.17);
    g.add(this.timeBar);
    for (const x of [-4.6, 4.6]) add(g, new THREE.CylinderGeometry(0.05, 0.05, 6, 6), this.steel, x, 5.8, 0);
    g.position.set(0, 5.2, -12.6);
    g.rotation.x = -0.36;
    g.scale.setScalar(0.92);
    this.scene.add(g);
    this.drawBoard({ title: 'TRAPDOOR ROYALE', text: 'Find your feet. The first question is coming.', answers: null });
  }

  drawBoard({ title, text, answers, correct = -1 }) {
    const c = this.boardCanvas.getContext('2d');
    const W = 1024;
    const H = 512;
    c.fillStyle = '#0a0908';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#f3ead6';
    c.fillRect(0, 0, W, 52);
    c.fillStyle = '#0a0908';
    c.font = `700 30px ${DISPLAY}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText(String(title).toUpperCase(), 22, 28);
    c.fillStyle = '#f3ead6';
    let size = 46;
    c.font = `700 ${size}px ${DISPLAY}`;
    let lines = wrap(c, text, W - 60);
    while (lines.length > (answers ? 3 : 6) && size > 26) { size -= 4; c.font = `700 ${size}px ${DISPLAY}`; lines = wrap(c, text, W - 60); }
    lines.slice(0, 6).forEach((ln, i) => c.fillText(ln, 30, 96 + i * (size + 8)));
    if (answers) {
      answers.forEach((a, i) => {
        const x = 30 + (i % 2) * 492;
        const y = 290 + Math.floor(i / 2) * 104;
        const dim = correct >= 0 && i !== correct;
        c.globalAlpha = dim ? 0.3 : 1;
        c.fillStyle = PLATFORM_COLORS[i];
        c.fillRect(x, y, 472, 88);
        c.fillStyle = '#0a0908';
        c.fillRect(x + 84, y + 6, 382, 76);
        c.font = `700 62px ${DISPLAY}`;
        c.textAlign = 'center';
        c.fillText(LETTERS[i], x + 42, y + 48);
        c.textAlign = 'left';
        c.fillStyle = '#f3ead6';
        let s = 34;
        c.font = `700 ${s}px ${DISPLAY}`;
        let al = wrap(c, a, 362);
        while (al.length > 2 && s > 20) { s -= 3; c.font = `700 ${s}px ${DISPLAY}`; al = wrap(c, a, 362); }
        al.slice(0, 2).forEach((ln, k) => c.fillText(ln, x + 96, y + (al.length === 1 ? 46 : 30 + k * (s + 4))));
        c.globalAlpha = 1;
      });
    }
    this.boardTex.needsUpdate = true;
  }

  // ---------- contestants ----------
  setPlayers(list, localId) {
    for (const f of this.figures.values()) { this.scene.remove(f.group); f.dispose(); }
    this.figures.clear();
    this.localId = localId;
    this.count = list.length;
    list.forEach((p, i) => {
      const f = new Figure({ id: p.id, name: p.name, color: p.color, kind: 'contestant', style: i, local: p.id === localId });
      const h = this._home(i);
      f.place(h.x, 0, h.z);
      f.face(Math.atan2(-h.x, -h.z) + Math.PI);
      this.scene.add(f.group);
      this.figures.set(p.id, f);
      if (!p.alive) { f.hidden = true; f.group.visible = false; }
    });
    this.championId = null;
    this.hubLift = 0;
  }

  _home(i) {
    const a = (i / Math.max(1, this.count)) * TAU + 0.3;
    const r = i % 2 ? 1.5 : 0.75;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  _spot(id, platform) {
    const c = centreOf(platform);
    return { x: c.x + ((id % 4) - 1.5) * 1.0, z: c.z + ((Math.floor(id / 4) % 3) - 1) * 1.3 };
  }

  platformAt(x, z) {
    for (let i = 0; i < 4; i++) {
      const c = centreOf(i);
      if (Math.abs(x - c.x) <= SIZE / 2 - 0.12 && Math.abs(z - c.z) <= SIZE / 2 - 0.12) return i;
    }
    return -1;
  }

  _walkable(x, z) {
    if (Math.hypot(x, z) <= HUB - 0.1) return true;
    if (this.platformAt(x, z) >= 0) return true;
    // On one of the four diagonal bridges?
    const sx = Math.sign(x) || 1;
    const sz = Math.sign(z) || 1;
    const along = (x * sx + z * sz) / Math.SQRT2;
    const across = Math.abs(x * sz - z * sx) / Math.SQRT2;
    return along > 1.5 && along < 3.6 && across < 0.55;
  }

  // New round: doors shut, bridges out, everyone back to the hub.
  newRound(aliveIds) {
    this.locked = false;
    this.scramble = false;
    for (const p of this.platforms) { p.open = false; p.state = 'idle'; }
    let i = 0;
    for (const [id, f] of this.figures) {
      if (!aliveIds.includes(id)) continue;
      const h = this._home(i++);
      f.moveTo(h.x, h.z, 0);
    }
    this._cam(0, 14, 18, 0, 1.8, -1.6);
  }

  moveFigure(id, platform) {
    const f = this.figures.get(id);
    if (!f || f.hidden) return;
    // The local contestant may have walked there already.
    if (id === this.localId && this.platformAt(f.pos.x, f.pos.z) === platform) return;
    const s = this._spot(id, platform);
    f.moveTo(s.x, s.z, 0);
  }

  // The local contestant walks with the keys. Returns the platform now underfoot, or -1.
  localMove(dx, dz, dt) {
    const f = this.figures.get(this.localId);
    if (!f || f.hidden || f.state === 'fall' || this.locked) return -1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return this.platformAt(f.pos.x, f.pos.z);
    const step = 0.6;
    const nx = f.pos.x + (dx / len) * step;
    const nz = f.pos.z + (dz / len) * step;
    if (this._walkable(nx, nz)) f.moveTo(nx, nz, 0);
    else if (this._walkable(nx, f.pos.z)) f.moveTo(nx, f.pos.z, 0);
    else if (this._walkable(f.pos.x, nz)) f.moveTo(f.pos.x, nz, 0);
    return this.platformAt(f.pos.x, f.pos.z);
  }

  shove(id) {
    const f = this.figures.get(id);
    if (!f || f.hidden) return;
    f.cheer(0.5);
    this.sparks.emit({ x: f.pos.x, y: 1, z: f.pos.z, n: 26, speed: 3, up: 0.3, colors: [0xf3ead6, 0xffd27a], life: 0.5, gravity: 1, drag: 2 });
    for (const [oid, o] of this.figures) {
      if (oid === id || o.hidden) continue;
      if (Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < 1.9) o.rock();
    }
  }

  setCrowd(counts) { counts.forEach((n, i) => { this.platforms[i].crowd = n; }); }
  setTime(frac, scramble) { this.timeBar.scale.x = clamp(frac, 0.0001, 1); this.timeBar.position.x = -5.5 * (1 - clamp(frac, 0, 1)); this.scramble = scramble; }

  // The clock has run out: bridges go, spotlights come on, everyone is held where they chose.
  lock(choices) {
    this.locked = true;
    this.scramble = false;
    for (const p of this.platforms) p.state = 'locked';
    for (const [id, f] of this.figures) {
      const ch = choices[id];
      if (f.hidden || ch == null) continue;
      if (this.platformAt(f.pos.x, f.pos.z) !== ch) { const s = this._spot(id, ch); f.moveTo(s.x, s.z, 0); }
    }
    this._cam(0, 13.2, 14.2, 0, 0, 1.0);
  }

  // Three doors open. Anyone on them, or still in the middle, goes down.
  reveal({ correct, fallen, mercy }) {
    this.platforms.forEach((p, i) => { p.state = i === correct ? 'right' : mercy ? 'spared' : 'wrong'; });
    this._after(0.45, () => {
      if (mercy) return;
      this.platforms.forEach((p, i) => {
        if (i === correct) return;
        p.open = true;
        const c = centreOf(i);
        for (const side of [-1, 1]) this.sparks.emit({ x: c.x + side * (SIZE / 2), y: 0, z: c.z, n: 60, speed: 4, up: 0.6, colors: [0xffd27a, 0xff3b2a, 0xfff1c2], life: 0.9, gravity: 9, drag: 0.8, radius: 2 });
      });
      this.shake = 0.35;
      for (const id of fallen) { const f = this.figures.get(id); if (f) f.fall(); }
    });
    this._after(0.7, () => {
      const c = centreOf(correct);
      for (const [, f] of this.figures) if (!f.hidden && f.state !== 'fall' && this.platformAt(f.pos.x, f.pos.z) === correct) f.cheer(1.8);
      this.confetti.emit({ x: c.x, y: 4, z: c.z, n: 50, speed: 3, up: 0.8, colors: [PLATFORM_COLORS[correct], 0xf3ead6], life: 2.2, gravity: 3, drag: 1.2, radius: 1.5 });
    });
  }

  champion(id) {
    this.championId = id;
    const f = this.figures.get(id);
    if (f) { f.reset(); f.moveTo(0, 0, 0); f.cheer(30); }
    for (const p of this.platforms) { p.open = true; p.state = 'wrong'; }
    this._after(0.9, () => { this.hubLift = 3.2; });
    this._cam(0, 7.5, 12.5, 0, 3.6, 0);
    this.celebrate = 8;
  }

  _cam(px, py, pz, lx, ly, lz) {
    this.camTarget.pos.set(px, py, pz);
    this.camTarget.look.set(lx, ly, lz);
  }

  _after(seconds, fn) { this.pending.push({ at: this.t + seconds, fn }); }

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

  update(dt, reduce = false) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= t);
      this.pending = this.pending.filter((p) => p.at > t);
      for (const p of due) p.fn();
    }

    // Platforms: doors, colour and spotlights follow their state.
    for (const p of this.platforms) {
      p.angle = damp(p.angle, p.open ? 1.52 : 0, p.open ? 9 : 4, dt);
      for (const leaf of p.leaves) leaf.pivot.rotation.z = leaf.side * p.angle;
      p.decal.visible = p.angle < 0.2;
      const glow = p.state === 'right' ? 0.9 + Math.sin(t * 12) * 0.25 : p.state === 'wrong' ? 0.02 : p.state === 'locked' ? 0.45 : 0.16 + Math.min(p.crowd, 6) * 0.03;
      p.topMat.emissiveIntensity = damp(p.topMat.emissiveIntensity, glow, 8, dt);
      const spot = p.state === 'locked' || p.state === 'spared' ? 260 : p.state === 'right' ? 420 : p.state === 'wrong' ? 0 : 40;
      p.spot.intensity = damp(p.spot.intensity, spot, 6, dt);
      const bridge = this.locked || p.open ? 0.001 : 1;
      p.bridge.scale.x = damp(p.bridge.scale.x, bridge, 9, dt);
      p.bridgeMat.opacity = 0.5 + Math.sin(t * 5 + p.g.position.x) * 0.2;
    }

    // The hub rises under the champion.
    const lift = damp(this.hub.position.y, this.hubLift, 2.2, dt);
    this.hub.position.y = lift;
    for (const [id, f] of this.figures) {
      if (id === this.championId) f.target.y = lift;
      f.update(dt, t, { frantic: this.scramble && !this.locked && !reduce, still: this.locked && f.state !== 'run' && f.state !== 'fall' });
    }

    if (!reduce) {
      this.gridTex.offset.y = (t * 0.02) % 1;
      this.rings.forEach((r, i) => { r.rotation.z = t * (0.08 + i * 0.03) * (i % 2 ? -1 : 1); });
      const pos = this.motes.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * (0.6 + (i % 5) * 0.2);
        if (y > 6) y = -34;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    this.under.intensity = 60 + Math.sin(t * 1.3) * 12;

    if (this.celebrate > 0) {
      this.celebrate -= dt;
      if (Math.random() < dt * 16) this.confetti.emit({ x: (Math.random() - 0.5) * 6, y: this.hub.position.y + 7, z: (Math.random() - 0.5) * 6, n: 10, speed: 1.4, up: 0.2, colors: [...PLATFORM_COLORS, '#f3ead6'], life: 3.2, gravity: 2.2, drag: 1.4 });
    }
    this.sparks.update(dt);
    this.confetti.update(dt);

    // Camera: eased moves, a little drift, and a jolt when the floor goes.
    const fit = clamp(1.5 / this.camera.aspect, 1, 2.2);
    const k = 1 - Math.exp(-2.4 * dt);
    this.camPos.lerp(this.camTarget.pos, k);
    this.camLook.lerp(this.camTarget.look, k);
    this.shake = damp(this.shake, 0, 6, dt);
    const sh = reduce ? 0 : this.shake;
    const drift = reduce ? 0 : Math.sin(t * 0.25) * 0.5;
    const orbit = this.championId != null && !reduce ? t * 0.25 : 0;
    const side = this.camera.aspect > 1.45 && this.championId == null ? 3.2 : 0;
    const px = this.camPos.x * fit + drift + side;
    const pz = this.camPos.z * fit;
    this.camera.position.set(
      px * Math.cos(orbit) + pz * Math.sin(orbit) + (Math.random() - 0.5) * sh,
      this.camPos.y * (0.75 + fit * 0.25) + (Math.random() - 0.5) * sh,
      pz * Math.cos(orbit) - px * Math.sin(orbit) + (Math.random() - 0.5) * sh,
    );
    this.camera.lookAt(this.camLook.x + side, this.camLook.y, this.camLook.z);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.renderer.domElement.removeEventListener('pointerdown', this._down);
    for (const f of this.figures.values()) f.dispose();
    disposeTree(this.scene);
    this.boardTex.dispose();
    this.gridTex.dispose();
  }
}
