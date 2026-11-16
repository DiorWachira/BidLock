// LAST LAMP — the lighthouse. Three places, one tower:
//   the watch room   a round stone room with a fire, where the keepers answer;
//   the Undertow     the flooded cellar under the hatch, where the survival games are played;
//   the stairs       a spiral up the tower wall to the lamp room, for the final climb.
// Lightning flashes through the windows; rain runs down the glass. All geometry is
// primitives and every texture is painted on a canvas.

import * as THREE from 'three';
import { TAU, damp, clamp, canvasTexture, add, disposeTree, ParticlePool } from '../../render/kit3d.js';
import { Figure } from '../../arcade/figures3d.js';

const R_TOWER = 9;
const CELLAR = -12;
const STEP_H = 0.95;
const STEP_R = 6.6;
const STEP_A = 0.27;

function stoneTexture() {
  return canvasTexture(512, 512, (c, w) => {
    c.fillStyle = '#2a2622';
    c.fillRect(0, 0, w, w);
    for (let row = 0; row < 16; row++) {
      const h = 32;
      const off = row % 2 ? 0 : 40;
      for (let x = -80; x < w; x += 80) {
        const g = 34 + Math.floor(Math.random() * 22);
        c.fillStyle = `rgb(${g + 8},${g + 4},${g})`;
        c.fillRect(x + off + 2, row * h + 2, 76, h - 4);
      }
    }
  });
}

function rainTexture() {
  return canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#0d1a24';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(160,200,230,0.35)';
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      c.lineWidth = Math.random() < 0.2 ? 2 : 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y + 10 + Math.random() * 16); c.stroke();
    }
  });
}

export class LampStage {
  constructor(renderer, container) {
    this.renderer = renderer;
    this.container = container;
    this.t = 0;
    this.figures = new Map();
    this.flash = 0;
    this.nextBolt = 3;
    this.mode = 'room';
    this.pending = [];
    this.waterLevel = -2;
    this.cellarWater = CELLAR - 0.6;
    this.shake = 0;
    this.capSpin = 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090c);
    scene.fog = new THREE.FogExp2(0x07090c, 0.035);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
    this.camPos = new THREE.Vector3(0, 6.5, 11);
    this.camLook = new THREE.Vector3(0, 1, 0);
    this.camGoal = { pos: new THREE.Vector3(0, 6.5, 11), look: new THREE.Vector3(0, 1, 0) };

    this._lights();
    this._tower();
    this._room();
    this._cellar();
    this._stairs();
    this.embers = new ParticlePool(scene, 300, 0.09, true);
    this.spray = new ParticlePool(scene, 400, 0.12, false);
    this.resize();
  }

  _lights() {
    this.ambient = new THREE.HemisphereLight(0x5a6e88, 0x0a0806, 0.35);
    this.scene.add(this.ambient);
    this.fire = new THREE.PointLight(0xff8a3a, 60, 22, 1.7);
    this.fire.position.set(0, 1.6, 0);
    this.fire.castShadow = true;
    this.fire.shadow.mapSize.set(512, 512);
    this.scene.add(this.fire);
    // Lightning: a cold light that flashes through the windows.
    this.bolt = new THREE.DirectionalLight(0xcfe4ff, 0);
    this.bolt.position.set(-6, 10, -8);
    this.scene.add(this.bolt);
    // Follows the climbers up the stairs in the finale.
    this.stairLight = new THREE.PointLight(0xffd59a, 0, 16, 1.3);
    this.scene.add(this.stairLight);
    this.lampLight = new THREE.PointLight(0xfff0c0, 0, 30, 1.4);
    this.lampLight.position.set(0, 12.4, 0);
    this.scene.add(this.lampLight);
    this.cellarLight = new THREE.PointLight(0x6fc4d4, 70, 22, 1.4);
    this.cellarLight.position.set(0, CELLAR + 4.5, 3);
    this.scene.add(this.cellarLight);
    // A lantern hung over the Undertow, so the survival games are lit.
    this.cellarLamp = new THREE.SpotLight(0xffc070, 260, 26, 0.75, 0.6, 1.2);
    this.cellarLamp.position.set(0, CELLAR + 8, 2);
    this.cellarLamp.target.position.set(0, CELLAR, -1.2);
    this.scene.add(this.cellarLamp, this.cellarLamp.target);
  }

  _tower() {
    const stone = stoneTexture();
    stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
    stone.repeat.set(6, 4);
    this.stone = stone;
    this.stoneMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95, metalness: 0, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R_TOWER, R_TOWER, 30, 48, 1, true), this.stoneMat);
    wall.position.y = 1;
    wall.receiveShadow = true;
    this.scene.add(wall);
    // Windows: rain on dark glass, lit by the lightning.
    this.rainTex = rainTexture();
    this.rainTex.wrapS = this.rainTex.wrapT = THREE.RepeatWrapping;
    this.windowMat = new THREE.MeshBasicMaterial({ map: this.rainTex, color: 0x3a5468, toneMapped: false });
    const frame = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.8 });
    this.frameMat = frame;
    for (let i = 0; i < 4; i++) {
      for (const y of [2.6, 9.4]) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.55 + (y > 5 ? 0.3 : 0);
        const g = new THREE.Group();
        g.position.set(Math.cos(a) * (R_TOWER - 0.05), y, Math.sin(a) * (R_TOWER - 0.05));
        g.lookAt(0, y, 0);
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), this.windowMat);
        g.add(pane);
        add(g, new THREE.BoxGeometry(1.6, 0.12, 0.2), frame, 0, 1.25, 0);
        add(g, new THREE.BoxGeometry(1.6, 0.12, 0.2), frame, 0, -1.25, 0);
        add(g, new THREE.BoxGeometry(0.08, 2.4, 0.18), frame, 0, 0, 0);
        add(g, new THREE.BoxGeometry(1.4, 0.06, 0.18), frame, 0, 0.1, 0);
        this.scene.add(g);
      }
    }
  }

  _room() {
    const floorTex = canvasTexture(512, 512, (c, w) => {
      c.fillStyle = '#3b2a1c';
      c.fillRect(0, 0, w, w);
      for (let i = 0; i < 16; i++) {
        const g = 48 + Math.floor(Math.random() * 18);
        c.fillStyle = `rgb(${g + 14},${g},${g - 14})`;
        c.fillRect(i * 32 + 1, 0, 30, w);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 0; k < 3; k++) c.fillRect(i * 32 + 1, Math.random() * w, 30, 2);
      }
    });
    this.floorTex = floorTex;
    // The floor, with a square hole for the hatch at the front.
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R_TOWER, 0, TAU, false);
    const hole = new THREE.Path();
    hole.moveTo(-1.3, 3.2); hole.lineTo(1.3, 3.2); hole.lineTo(1.3, 5.8); hole.lineTo(-1.3, 5.8); hole.closePath();
    shape.holes.push(hole);
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    // ShapeGeometry is in the XY plane; turning it flat puts shape-y on world -z, so flip.
    floor.scale.y = -1;
    this.scene.add(floor);

    // The hatch: two doors on hinges over the hole (centred at z = 4.5).
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.8 });
    this.ironMat = iron;
    this.woodMat = wood;
    this.hatch = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.3, 0.02, 4.5);
      add(pivot, new THREE.BoxGeometry(1.3, 0.1, 2.6), wood, -side * 0.65, 0, 0);
      add(pivot, new THREE.BoxGeometry(1.2, 0.12, 0.12), iron, -side * 0.65, 0.02, -0.8);
      add(pivot, new THREE.BoxGeometry(1.2, 0.12, 0.12), iron, -side * 0.65, 0.02, 0.8);
      this.scene.add(pivot);
      this.hatch.push({ pivot, side });
    }
    this.hatchOpen = 0;
    this.hatchGoal = 0;

    // The hearth: a ring of stones, a brazier, and a fire made of flickering cones.
    add(this.scene, new THREE.CylinderGeometry(1.2, 1.35, 0.35, 20), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95 }), 0, 0.17, 0);
    add(this.scene, new THREE.CylinderGeometry(0.8, 0.5, 0.5, 16), iron, 0, 0.6, 0);
    this.flames = [];
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.22 - i * 0.015, 0.9 + (i % 3) * 0.3, 7), this.flameMat);
      const a = (i / 7) * TAU;
      f.position.set(Math.cos(a) * 0.25, 1.25, Math.sin(a) * 0.25);
      f.userData.base = f.position.clone();
      f.userData.k = 0.8 + Math.random() * 0.6;
      this.scene.add(f);
      this.flames.push(f);
    }
    // A table and two chairs against the back wall, for the room to feel lived in.
    add(this.scene, new THREE.BoxGeometry(2.6, 0.12, 1.2), wood, 0, 1.05, -6.6);
    for (const x of [-1.1, 1.1]) for (const z of [-7.0, -6.2]) add(this.scene, new THREE.BoxGeometry(0.1, 1.0, 0.1), wood, x, 0.5, z);
  }

  _cellar() {
    // Black water with a slow swell.
    const waterGeo = new THREE.PlaneGeometry(2 * R_TOWER, 2 * R_TOWER, 40, 40);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x0e3a44, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.88 });
    this.cellarWaterMesh = new THREE.Mesh(waterGeo, this.waterMat);
    this.cellarWaterMesh.rotation.x = -Math.PI / 2;
    this.cellarWaterMesh.position.y = this.cellarWater;
    this.scene.add(this.cellarWaterMesh);
    add(this.scene, new THREE.CylinderGeometry(R_TOWER, R_TOWER, 0.2, 40), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }), 0, CELLAR - 3, 0);

    // The landing under the hatch, where the crew drops in.
    add(this.scene, new THREE.BoxGeometry(3.2, 0.3, 3.2), this.woodMat, 0, CELLAR - 0.15, 4.5).receiveShadow = true;

    // Planks across the water (only `count` of them are shown in a given game).
    this.planks = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      add(g, new THREE.BoxGeometry(0.85, 0.14, 5.4), this.woodMat).receiveShadow = true;
      for (const z of [-2.4, 2.4]) add(g, new THREE.BoxGeometry(0.9, 0.06, 0.1), this.ironMat, 0, 0.08, z);
      g.position.set(0, CELLAR + 0.2, -1.2);
      g.visible = false;
      this.scene.add(g);
      this.planks.push({ g, drop: 0, dropping: false });
    }
    // The lifeboat.
    const boat = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xd8d0bf, roughness: 0.7 });
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.0, 0.8, 16, 1, true, 0, Math.PI), hullMat);
    hull.material.side = THREE.DoubleSide;
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = Math.PI / 2;
    hull.scale.set(1, 2.4, 1);
    boat.add(hull);
    add(boat, new THREE.BoxGeometry(2.4, 0.08, 6.4), new THREE.MeshStandardMaterial({ color: 0xb33a22, roughness: 0.6 }), 0, 0.42, 0);
    for (const z of [-1.4, 0, 1.4]) add(boat, new THREE.BoxGeometry(2.6, 0.1, 0.3), this.woodMat, 0, 0.2, z);
    boat.position.set(0, CELLAR - 0.1, -1.2);
    boat.visible = false;
    this.scene.add(boat);
    this.boat = boat;
    // The capstan: a drum with six sockets, and a mast that draws the lightning.
    const cap = new THREE.Group();
    add(cap, new THREE.CylinderGeometry(0.9, 1.1, 1.1, 18), this.ironMat, 0, 0.55, 0);
    this.capWheel = new THREE.Group();
    this.capWheel.position.y = 1.2;
    cap.add(this.capWheel);
    add(this.capWheel, new THREE.CylinderGeometry(0.75, 0.75, 0.25, 18), this.woodMat);
    this.sockets = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const bar = add(this.capWheel, new THREE.BoxGeometry(1.8, 0.1, 0.1), this.woodMat, Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2);
      bar.rotation.y = -a;
      const s = add(this.capWheel, new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a5d64, metalness: 0.9, roughness: 0.3, emissive: 0x3fa0ff, emissiveIntensity: 0 }), Math.cos(a) * 0.62, 0.18, Math.sin(a) * 0.62);
      this.sockets.push(s);
    }
    add(cap, new THREE.CylinderGeometry(0.05, 0.08, 5, 8), this.ironMat, 0, 3.6, 0);
    cap.position.set(0, CELLAR + 0.05, -1.2);
    add(cap, new THREE.CylinderGeometry(3.0, 3.0, 0.2, 30), this.woodMat, 0, -0.08, 0).receiveShadow = true;
    cap.visible = false;
    this.scene.add(cap);
    this.capstan = cap;
    // The tide game: a pump on a raft.
    const raft = new THREE.Group();
    add(raft, new THREE.BoxGeometry(5.2, 0.25, 3.6), this.woodMat).receiveShadow = true;
    add(raft, new THREE.CylinderGeometry(0.25, 0.3, 1.6, 10), this.ironMat, 0, 0.9, -1.2);
    this.pumpArm = add(raft, new THREE.BoxGeometry(1.8, 0.1, 0.12), this.ironMat, 0, 1.75, -1.2);
    raft.position.set(0, CELLAR + 0.1, -1.2);
    raft.visible = false;
    this.scene.add(raft);
    this.raft = raft;
    this.props = { planks: null, tide: raft, lifeboat: boat, capstan: cap };
  }

  _stairs() {
    // Stone steps up the wall, then the lamp room with its great lens.
    this.steps = [];
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.9 });
    for (let k = 0; k <= 10; k++) {
      const a = this._stepAngle(k);
      const m = add(this.scene, new THREE.BoxGeometry(2.0, 0.2, 1.3), stepMat, Math.cos(a) * STEP_R, k * STEP_H - 0.1, Math.sin(a) * STEP_R);
      m.rotation.y = -a;
      m.receiveShadow = true;
      this.steps.push(m);
    }
    const top = 10 * STEP_H;
    this.lampRoomY = top;
    add(this.scene, new THREE.CylinderGeometry(4.2, 4.2, 0.25, 32), this.ironMat, 0, top + 1.2, 0);
    this.lensMat = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffc860, emissiveIntensity: 0.05, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
    this.lens = add(this.scene, new THREE.CylinderGeometry(1.1, 1.1, 2.2, 12), this.lensMat, 0, top + 2.5, 0);
    // The finale's rising water, a plane that climbs the tower.
    this.floodMat = new THREE.MeshStandardMaterial({ color: 0x0f4552, roughness: 0.2, metalness: 0.5, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    this.flood = new THREE.Mesh(new THREE.CircleGeometry(R_TOWER - 0.05, 40), this.floodMat);
    this.flood.rotation.x = -Math.PI / 2;
    this.flood.position.y = -3;
    this.waterLevel = -3;
    this.flood.visible = false;
    this.scene.add(this.flood);
  }

  // The stairs climb round the back half of the tower, left to right, facing the camera.
  _stepAngle(k) { return Math.PI + 0.25 + k * STEP_A; }
  stepPos(k, lane = 0) {
    const a = this._stepAngle(k) + ((lane % 3) - 1) * 0.05;
    const r = STEP_R - 0.5 + (lane % 3) * 0.4;
    return { x: Math.cos(a) * r, y: k * STEP_H, z: Math.sin(a) * r };
  }

  // ---------- keepers ----------
  setPlayers(list, localId) {
    for (const f of this.figures.values()) { this.scene.remove(f.group); f.dispose(); }
    this.figures.clear();
    this.localId = localId;
    this.n = list.length;
    list.forEach((p, i) => {
      const f = new Figure({ id: p.id, name: p.name, color: p.color, kind: 'keeper', style: i, local: p.id === localId });
      this.scene.add(f.group);
      this.figures.set(p.id, f);
      f.setFlames(p.flames);
      f.setGhost(p.ghost);
    });
    this.toRoom(list.map((p) => p.id), true);
  }

  _ringPos(i, n) {
    const a = Math.PI * 0.62 + (i / n) * Math.PI * 1.76;
    return { x: Math.cos(a) * 3.4, z: Math.sin(a) * 3.4 - 0.6 };
  }

  sync(players) {
    for (const p of players) {
      const f = this.figures.get(p.id);
      if (!f) continue;
      f.setFlames(p.flames);
      f.setGhost(p.ghost);
    }
  }

  // Everyone back by the fire.
  toRoom(ids, instant = false) {
    const cut = this.mode !== 'room';
    this.stairLight.intensity = 0;
    this.pending = [];
    this.drop = [];
    this.mode = 'room';
    this.hatchGoal = 0;
    this.flood.visible = false;
    for (const prop of [this.raft, this.boat, this.capstan]) prop.visible = false;
    for (const p of this.planks) p.g.visible = false;
    const n = Math.max(1, this.n);
    for (const id of ids) {
      const f = this.figures.get(id);
      if (!f) continue;
      const pos = this._ringPos(id, n);
      if (instant || f.pos.y < -2 || f.hidden) { f.reset(); f.place(pos.x, 0, pos.z); }
      else f.moveTo(pos.x, pos.z, 0);
      f.face(Math.atan2(-pos.x, -pos.z - 0.6));
      f.setTilt(0);
    }
    this._goCam([0, 6.4, 11.2], [0, 1.1, -0.2], cut || instant);
  }

  question() { for (const f of this.figures.values()) f.setTilt(Math.sin(f.id * 2.1) * 0.22); }
  answered(id) { const f = this.figures.get(id); if (f) { f.setTilt(0); f.rock(); } }

  // The answer is out: the right ones cheer, the wrong ones edge towards the hatch.
  reveal(safe, down) {
    for (const id of safe) { const f = this.figures.get(id); if (f && !f.ghost) f.cheer(1.6); }
    for (const id of down) {
      const f = this.figures.get(id);
      if (f) { f.moveTo((id % 3 - 1) * 0.7, 3.4 + (id % 2) * 0.5, 0); f.setTilt(0.35); }
    }
  }

  // The hatch opens and the crew drops into the Undertow.
  descend(crew, kind) {
    this.hatchGoal = 1;
    this.shake = 0.25;
    this._goCam([0, 5.5, 9.5], [0, 0, 4.5]);
    this.drop = [];
    crew.forEach((id, i) => this._after(0.7 + i * 0.18, () => {
      const f = this.figures.get(id);
      if (!f) return;
      f.reset();
      f.place(f.pos.x * 0.3, f.pos.y, 4.5 + (i % 2) * 0.3);
      f.target.y = CELLAR;
      f.state = 'idle';
      f.vy = 0;
      this.drop.push({ f, x: (i - (crew.length - 1) / 2) * 0.7 });
    }, true));
    this.miniKind = kind;
  }

  // Set up the cellar for one game and gather the crew.
  startMini(kind, crew, extra = {}) {
    this.pending = this.pending.filter((p) => p.keep);
    this.mode = 'cellar';
    this.miniKind = kind;
    for (const prop of [this.raft, this.boat, this.capstan]) prop.visible = false;
    for (const p of this.planks) { p.g.visible = false; p.drop = 0; p.dropping = false; p.g.position.y = CELLAR + 0.2; p.g.rotation.z = 0; }
    this.cellarWater = CELLAR - 0.6;
    const place = (id, x, z) => { const f = this.figures.get(id); if (f) { if (f.pos.y > CELLAR + 3 || f.hidden) { f.reset(); f.place(0, CELLAR, 4.5); } f.moveTo(x, z, CELLAR + 0.35); } };
    if (kind === 'planks') {
      const count = extra.count || 4;
      for (let i = 0; i < count; i++) { const p = this.planks[i]; p.g.visible = true; p.g.position.x = (i - (count - 1) / 2) * 1.15; }
      crew.forEach((id, i) => place(id, (i - (crew.length - 1) / 2) * 1.3, 2.6));
      if (extra.saboteur != null) {
        const f = this.figures.get(extra.saboteur);
        if (f) { if (f.pos.y > CELLAR + 3) { f.reset(); f.place(0, CELLAR, 4.5); } f.moveTo(0, 4.7, CELLAR + 0.35); }
      }
    } else if (kind === 'tide') {
      this.raft.visible = true;
      crew.forEach((id, i) => place(id, (i - (crew.length - 1) / 2) * 1.2, -0.4));
    } else if (kind === 'lifeboat') {
      this.boat.visible = true;
      crew.forEach((id, i) => place(id, (i % 2 ? 0.5 : -0.5), -2.8 + i * 0.9));
    } else {
      this.capstan.visible = true;
      const n = crew.length;
      crew.forEach((id, i) => { const a = (i / n) * TAU + 0.4; place(id, Math.cos(a) * 2.1, -1.2 + Math.sin(a) * 2.1); });
      this.sockets.forEach((s) => { s.material.emissiveIntensity = 0; });
    }
    this._goCam([0, CELLAR + 6.2, 8.4], [0, CELLAR + 0.4, -0.8], true);
  }

  // Minigame moments.
  plankPick(id, plank, count) {
    const f = this.figures.get(id);
    if (f) f.moveTo((plank - (count - 1) / 2) * 1.15 + ((id % 3) - 1) * 0.18, -1.2 + ((id % 2) ? 0.8 : -0.8), CELLAR + 0.35);
  }

  plankReveal(rigged, losers) {
    const p = this.planks[rigged];
    if (p) { p.dropping = true; this.shake = 0.2; }
    this._after(0.35, () => { for (const id of losers) { const f = this.figures.get(id); if (f) this._splash(f); } });
  }

  pump(id, right) {
    if (right) this.pumpKick = 1;
    const f = this.figures.get(id);
    if (f && !right) f.rock();
  }

  tideLevel(frac) { this.cellarWater = CELLAR - 0.6 + (1 - clamp(frac, 0, 1)) * 0.75; }

  lifeboatReveal(choices, losers) {
    for (const [id, c] of Object.entries(choices)) {
      const f = this.figures.get(Number(id));
      if (f && c === 'shove') f.cheer(1.2);
    }
    this._after(0.5, () => { for (const id of losers) { const f = this.figures.get(id); if (f) this._splash(f); } });
  }

  capstanPull(id, struck, pulls) {
    this.capSpin += 0.9;
    const s = this.sockets[(pulls - 1) % 6];
    if (s) s.material.emissiveIntensity = struck ? 3 : 0.2;
    const f = this.figures.get(id);
    if (f) f.rock();
    if (struck) { this.flash = 1.2; this.shake = 0.45; if (f) this._after(0.2, () => this._splash(f)); }
  }

  capstanSpin() { this.capSpin += 4; }

  _splash(f) {
    f.fall();
    this.spray.emit({ x: f.pos.x, y: CELLAR, z: f.pos.z, n: 60, speed: 3.5, up: 1.4, colors: [0x9fd4e8, 0xe8f6ff, 0x3f8090], life: 1.2, gravity: 9, drag: 0.6, radius: 0.6 });
  }

  // A keeper lost a flame (or the last one).
  snuff(id, ghost) {
    const f = this.figures.get(id);
    if (!f) return;
    this.embers.emit({ x: f.pos.x, y: Math.max(f.pos.y, CELLAR) + 1.2, z: f.pos.z, n: 30, speed: 1.2, up: 1.5, colors: [0xffb52e, 0x6a5a4a], life: 1.4, gravity: -0.6, drag: 1.6 });
    if (ghost) f.setGhost(true);
  }

  // ---------- the climb ----------
  finale(players) {
    this.pending = [];
    this.drop = [];
    this.mode = 'stairs';
    this.hatchGoal = 0;
    for (const prop of [this.raft, this.boat, this.capstan]) prop.visible = false;
    for (const p of this.planks) p.g.visible = false;
    this.flood.visible = true;
    this.stairLight.intensity = 45;
    this.lensMat.emissiveIntensity = 0.05;
    this.lampLight.intensity = 0;
    players.forEach((p, i) => {
      const f = this.figures.get(p.id);
      if (!f) return;
      const pos = this.stepPos(p.step, i);
      f.reset();
      f.place(pos.x, pos.y, pos.z);
      f.setGhost(p.ghost);
    });
    this._climbCam(players, true);
  }

  _climbCam(players, cut = false) {
    const lead = Math.max(...players.filter((p) => !p.ghost).map((p) => p.step), 0);
    const sp = this.stepPos(Math.min(10, lead + 1));
    // Stay inside the tower, a little below the leaders, looking up the stairs.
    // Climbers sit in the upper half of the frame, above the question panel.
    this._goCam([sp.x * 0.3, Math.max(2.2, sp.y + 0.5), 6.6], [sp.x * 0.8, sp.y - 1.8, -4], cut);
    this.stairGoal = { x: sp.x * 0.7, y: sp.y + 2.2, z: sp.z * 0.7 };
  }

  climb(players, water) {
    players.forEach((p, i) => {
      const f = this.figures.get(p.id);
      if (!f) return;
      if (f.hidden) { f.reset(); }
      const pos = this.stepPos(p.step, i);
      f.moveTo(pos.x, pos.z, pos.y);
      f.setGhost(p.ghost);
    });
    this.waterLevel = water;
    this._climbCam(players);
  }

  lightLamp(id) {
    this.lensMat.emissiveIntensity = 2.4;
    this.lampLight.intensity = 90;
    const f = this.figures.get(id);
    if (f) { const pos = { x: 1.6, y: this.lampRoomY + 1.35, z: 1.6 }; f.reset(); f.moveTo(pos.x, pos.z, pos.y); f.cheer(40); }
    this._goCam([0, this.lampRoomY + 3.2, 8.5], [0, this.lampRoomY + 2.1, 0]);
    this.celebrate = 9;
  }

  thunder() { this.flash = 1; }

  _goCam(pos, look, cut = false) {
    this.camGoal.pos.set(...pos);
    this.camGoal.look.set(...look);
    if (cut) { this.camPos.copy(this.camGoal.pos); this.camLook.copy(this.camGoal.look); }
  }
  _after(s, fn, keep = false) { this.pending.push({ at: this.t + s, fn, keep }); }

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

  // Returns true when a lightning bolt fires this frame, so the screen can play thunder.
  update(dt, reduce = false) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    let boltNow = false;
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= t);
      this.pending = this.pending.filter((p) => p.at > t);
      for (const p of due) p.fn();
    }
    // Lightning.
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = 5 + Math.random() * 9;
      this.flash = reduce ? 0.35 : 1;
      boltNow = true;
    }
    this.flash = Math.max(0, this.flash - dt * (this.flash > 0.6 ? 2.5 : 4));
    const strobe = reduce ? this.flash : this.flash * (0.6 + 0.4 * Math.abs(Math.sin(t * 40)));
    this.bolt.intensity = strobe * 6;
    this.windowMat.color.setRGB(0.23 + strobe * 0.75, 0.33 + strobe * 0.65, 0.41 + strobe * 0.59);
    this.ambient.intensity = 0.35 + strobe * 1.4;
    if (!reduce) this.rainTex.offset.y = (this.rainTex.offset.y - dt * 0.9) % 1;

    // The fire.
    const flick = reduce ? 0 : Math.sin(t * 13) * 0.12 + Math.sin(t * 29) * 0.08;
    this.fire.intensity = 60 + flick * 70;
    for (const f of this.flames) {
      const k = f.userData.k;
      f.scale.y = 1 + Math.sin(t * 9 * k + k * 7) * (reduce ? 0 : 0.22);
      f.position.x = f.userData.base.x + Math.sin(t * 5 * k) * (reduce ? 0 : 0.04);
    }
    if (!reduce && Math.random() < dt * 8) this.embers.emit({ x: (Math.random() - 0.5) * 0.6, y: 1.5, z: (Math.random() - 0.5) * 0.6, n: 2, speed: 0.4, up: 2, colors: [0xffb52e, 0xff6a2a], life: 1.6, gravity: -1.2, drag: 1.2 });

    // Hatch.
    this.hatchOpen = damp(this.hatchOpen, this.hatchGoal, this.hatchGoal ? 7 : 3, dt);
    for (const h of this.hatch) h.pivot.rotation.z = h.side * this.hatchOpen * 1.7;

    // Crew dropping through the hatch.
    if (this.drop && this.drop.length) {
      for (const d of this.drop) {
        const f = d.f;
        f.vy -= 20 * dt;
        f.pos.y = Math.max(CELLAR, f.pos.y + f.vy * dt);
        f.pos.x = damp(f.pos.x, d.x, 3, dt);
        f.target.set(f.pos.x, CELLAR, f.pos.z);
        if (f.pos.y <= CELLAR) { f.vy = 0; d.done = true; this.spray.emit({ x: f.pos.x, y: CELLAR, z: f.pos.z, n: 18, speed: 2, up: 1, colors: [0x9fd4e8, 0xe8f6ff], life: 0.8, gravity: 8, drag: 1 }); }
        f.group.position.copy(f.pos);
      }
      this.drop = this.drop.filter((d) => !d.done);
    }

    // Cellar water and props.
    const swell = reduce ? 0 : Math.sin(t * 0.9) * 0.06;
    this.cellarWaterMesh.position.y = damp(this.cellarWaterMesh.position.y, this.cellarWater + swell, 2, dt);
    for (const p of this.planks) {
      if (!p.dropping) continue;
      p.drop += dt;
      p.g.rotation.z = Math.min(1.2, p.drop * 3);
      p.g.position.y = CELLAR + 0.2 - Math.min(4, p.drop * p.drop * 6);
    }
    if (this.boat.visible && !reduce) { this.boat.rotation.z = Math.sin(t * 1.1) * 0.05; this.boat.position.y = CELLAR - 0.1 + Math.sin(t * 0.9) * 0.05; }
    this.capSpin = damp(this.capSpin, 0, 1.5, dt);
    this.capWheel.rotation.y += this.capSpin * dt;
    this.pumpKick = damp(this.pumpKick || 0, 0, 6, dt);
    this.pumpArm.rotation.z = Math.sin(t * 2) * 0.1 + this.pumpKick * 0.6;

    if (this.stairGoal) {
      const L = this.stairLight.position;
      L.set(damp(L.x, this.stairGoal.x, 2, dt), damp(L.y, this.stairGoal.y, 2, dt), damp(L.z, this.stairGoal.z, 2, dt));
    }
    // The finale's flood.
    this.flood.position.y = damp(this.flood.position.y, this.waterLevel * STEP_H + 0.15, 1.5, dt);

    for (const f of this.figures.values()) {
      if (this.drop && this.drop.some((d) => d.f === f)) continue;
      f.update(dt, t, {});
    }
    if (this.celebrate > 0) {
      this.celebrate -= dt;
      if (Math.random() < dt * 12) this.embers.emit({ x: (Math.random() - 0.5) * 3, y: this.lampRoomY + 3, z: (Math.random() - 0.5) * 3, n: 8, speed: 2, up: 1, colors: [0xffe08a, 0xfff3d0], life: 2, gravity: 1, drag: 1 });
    }
    this.embers.update(dt);
    this.spray.update(dt);

    const fit = clamp(1.45 / this.camera.aspect, 1, 2.1);
    const k = 1 - Math.exp(-2.2 * dt);
    this.camPos.lerp(this.camGoal.pos, k);
    this.camLook.lerp(this.camGoal.look, k);
    this.shake = damp(this.shake, 0, 6, dt);
    const sh = reduce ? 0 : this.shake;
    const dir = this.camPos.clone().sub(this.camLook).multiplyScalar(fit);
    this.camera.position.copy(this.camLook).add(dir).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 0));
    this.camera.lookAt(this.camLook);
    return boltNow;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    for (const f of this.figures.values()) f.dispose();
    disposeTree(this.scene);
    for (const tex of [this.stone, this.rainTex, this.floorTex]) tex.dispose();
  }
}
