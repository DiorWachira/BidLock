// SOUNDCLASH — the club. A dark-glass floor that mirrors everything above it, a riser
// with a direct-drive turntable (strobe dots on the platter edge that stand still at
// true speed and drift when the pitch is warped, and a pitch fader that moves with the
// warp), 64 spectrum pillars in a ring fed by the AnalyserNode, laser rigs that fire on
// the bass, and a speaker stack for every sound with its name hand-painted on the top
// box. Sabotages are thrown dubplates that arc across the room.
//
// Colour has one job each: green is the music (spectrum, lasers), each sound keeps its
// own colour, amber is the warp, red is a hit.

import * as THREE from 'three';
import { Reflector } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/objects/Reflector.js';
import { Figure } from '../../arcade/figures3d.js';
import { TAU, damp, clamp, canvasTexture, add, disposeTree, ParticlePool } from '../../render/kit3d.js';

const BARS = 64;
const RING_R = 4.7;
const BOOTH_R = 10.2;
const MUSIC = 0x46e07a; // the signal green
const WARP = 0xffb52e;
const HIT = 0xff3b2a;

export class SampleStage {
  constructor(renderer, container) {
    this.renderer = renderer;
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050409);
    this.scene.fog = new THREE.FogExp2(0x07050b, 0.028);
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 200);
    this.camPos = new THREE.Vector3(0, 11.5, 19.5);
    this.camLook = new THREE.Vector3(0, 1.2, -1.8);
    this.camWant = this.camPos.clone();
    this.lookWant = this.camLook.clone();
    this.camera.position.copy(this.camPos);
    this.time = 0;
    this.booths = new Map();
    this.flying = [];
    this.shake = 0;
    this.spin = 0;
    this.strobe = 0;
    this.rate = 0;
    this.armIn = 0;
    this.mode = 'idle';
    this.levels = new Float32Array(BARS);
    this.focus = null;
    this._build();
    this.resize();
  }

  // ---------- the room ----------
  _build() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x6a6f88, 0x0a0910, 1.1));
    const fill = new THREE.DirectionalLight(0xb8c0d8, 0.9);
    fill.position.set(2, 9, 14);
    s.add(fill);
    const key = new THREE.SpotLight(0xfff1dc, 60, 30, 0.42, 0.6, 1.6);
    key.position.set(0, 13, 3);
    key.target.position.set(0, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    s.add(key, key.target);
    this.key = key;

    // The floor: a mirror under a sheet of dark glass ruled into tiles.
    const w = Math.max(256, Math.floor(512 * Math.min(1.5, window.devicePixelRatio || 1)));
    this.mirror = new Reflector(new THREE.PlaneGeometry(80, 80), { textureWidth: w, textureHeight: w, color: 0x777777 });
    this.mirror.rotation.x = -Math.PI / 2;
    s.add(this.mirror);
    const tiles = canvasTexture(512, 512, (g, W, H) => {
      g.fillStyle = '#0b0a10';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(160,170,200,0.16)';
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, H); g.stroke();
        g.beginPath(); g.moveTo(0, i * H / 4); g.lineTo(W, i * H / 4); g.stroke();
      }
    });
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    tiles.repeat.set(20, 20);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: tiles, transparent: true, opacity: 0.86, roughness: 0.62, metalness: 0 }));
    glass.rotation.x = -Math.PI / 2;
    glass.position.y = 0.01;
    glass.receiveShadow = true;
    s.add(glass);

    // The riser.
    const riser = add(s, new THREE.CylinderGeometry(3.7, 3.9, 0.9, 64), new THREE.MeshStandardMaterial({ color: 0x111016, roughness: 0.5, metalness: 0.4 }), 0, 0.45, 0);
    riser.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(3.72, 0.03, 6, 96), new THREE.MeshBasicMaterial({ color: MUSIC, toneMapped: false }));
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.9;
    s.add(lip);
    this.lip = lip;

    this._turntable();
    this._ring();
    this._lasers();

    this.sparks = new ParticlePool(s, 900, 0.12, true);
  }

  _turntable() {
    const tt = new THREE.Group();
    tt.position.set(0, 0.9, 0);
    this.scene.add(tt);
    this.tt = tt;
    const metal = new THREE.MeshStandardMaterial({ color: 0x55575f, roughness: 0.32, metalness: 0.7 });
    add(tt, new THREE.BoxGeometry(5.4, 0.55, 4.2), metal, 0, 0.28, 0).receiveShadow = true;
    // The platter, with a strobe-dot edge.
    this.dotTex = canvasTexture(1024, 64, (g, W, H) => {
      g.fillStyle = '#9ea2aa';
      g.fillRect(0, 0, W, H);
      const rows = [[10, 180, 3], [24, 183, 3.4], [38, 186, 3.8], [52, 189, 4.2]];
      g.fillStyle = '#1a1b1f';
      for (const [y, n, r] of rows) for (let i = 0; i < n; i++) { g.beginPath(); g.arc((i + 0.5) * W / n, y, r, 0, TAU); g.fill(); }
    });
    this.dotTex.wrapS = THREE.RepeatWrapping;
    const platterSide = new THREE.MeshStandardMaterial({ map: this.dotTex, roughness: 0.3, metalness: 0.6 });
    const platterTop = new THREE.MeshStandardMaterial({ color: 0x3a3b42, roughness: 0.5, metalness: 0.5 });
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.22, 96, 1, false), [platterSide, platterTop, platterTop]);
    platter.position.set(-0.45, 0.67, 0);
    platter.castShadow = true;
    tt.add(platter);
    this.platter = platter;
    // The record: grooves, a sheen, a label.
    const groove = canvasTexture(1024, 1024, (g, W) => {
      const c = W / 2;
      g.fillStyle = '#060607';
      g.fillRect(0, 0, W, W);
      for (let r = 200; r < 500; r += 2) {
        g.strokeStyle = `rgba(255,255,255,${0.02 + (r % 34 < 2 ? 0.05 : 0) + Math.random() * 0.015})`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke();
      }
      const sheen = g.createLinearGradient(0, 0, W, W);
      sheen.addColorStop(0.42, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.09)');
      sheen.addColorStop(0.58, 'rgba(255,255,255,0)');
      g.fillStyle = sheen;
      g.beginPath(); g.arc(c, c, 500, 0, TAU); g.fill();
    });
    const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.03, 96), [
      new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ map: groove, roughness: 0.22, metalness: 0.2 }),
      new THREE.MeshStandardMaterial({ color: 0x050505 }),
    ]);
    vinyl.position.set(-0.45, 0.795, 0);
    tt.add(vinyl);
    this.vinyl = vinyl;
    this.labelMat = new THREE.MeshBasicMaterial({ map: this._labelTexture('SOUNDCLASH', 'CH 20 · 22:00'), toneMapped: false });
    const label = new THREE.Mesh(new THREE.CircleGeometry(0.62, 64), this.labelMat);
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.017, 0);
    vinyl.add(label);
    this.label = label;
    // The tonearm.
    const arm = new THREE.Group();
    arm.position.set(1.75, 0.8, -1.35);
    tt.add(arm);
    add(arm, new THREE.CylinderGeometry(0.22, 0.26, 0.3, 24), metal, 0, -0.05, 0);
    const tube = add(arm, new THREE.CylinderGeometry(0.035, 0.035, 2.3, 10), new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.25, metalness: 0.9 }), -0.1, 0.12, 1.12);
    tube.rotation.x = Math.PI / 2;
    add(arm, new THREE.BoxGeometry(0.16, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0x0c0c0e }), -0.15, 0.08, 2.3);
    this.arm = arm;
    // The pitch fader and its slot: it rides with the warp.
    add(tt, new THREE.BoxGeometry(0.12, 0.02, 1.6), new THREE.MeshBasicMaterial({ color: 0x050505 }), 2.15, 0.56, 0.75);
    this.fader = add(tt, new THREE.BoxGeometry(0.34, 0.12, 0.2), new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.4, metalness: 0.6 }), 2.15, 0.6, 0.75);
    this.faderLamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.1), new THREE.MeshBasicMaterial({ color: WARP, toneMapped: false }));
    this.faderLamp.position.set(2.4, 0.57, 1.7);
    tt.add(this.faderLamp);
    // The strobe lamp at the platter's foot, as on the real deck.
    this.strobeLamp = new THREE.PointLight(0xff5a2a, 2, 3);
    this.strobeLamp.position.set(-2.1, 0.75, 1.6);
    tt.add(this.strobeLamp);
  }

  _labelTexture(top, bottom, color = '#f3ead6') {
    return canvasTexture(512, 512, (g, W) => {
      const c = W / 2;
      g.fillStyle = color;
      g.beginPath(); g.arc(c, c, c, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 6;
      g.beginPath(); g.arc(c, c, c - 22, 0, TAU); g.stroke();
      g.fillStyle = '#0b0a10';
      g.textAlign = 'center';
      g.font = '700 54px "Barlow Condensed", "Arial Narrow", sans-serif';
      wrap(g, String(top).toUpperCase(), c, c - 70, 360, 56);
      g.font = '600 28px ui-monospace, monospace';
      g.fillText(String(bottom).toUpperCase(), c, c + 130);
      g.beginPath(); g.arc(c, c, 14, 0, TAU); g.fill();
    });
  }

  _ring() {
    const geo = new THREE.BoxGeometry(0.15, 1, 0.15);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const ring = new THREE.InstancedMesh(geo, mat, BARS);
    ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    for (let i = 0; i < BARS; i++) ring.setColorAt(i, col.setHex(MUSIC));
    ring.position.y = 0.9;
    this.scene.add(ring);
    this.ring = ring;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  _lasers() {
    this.lasers = [];
    const geo = new THREE.CylinderGeometry(0.01, 0.16, 18, 8, 1, true);
    geo.translate(0, -9, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const rig = new THREE.Group();
      rig.position.set(Math.cos(a) * 12, 14, Math.sin(a) * 9 - 4);
      const mat = new THREE.MeshBasicMaterial({ color: MUSIC, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const beam = new THREE.Mesh(geo, mat);
      rig.add(beam);
      add(rig, new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x15151a, metalness: 0.6, roughness: 0.4 }));
      this.scene.add(rig);
      this.lasers.push({ rig, beam, mat, a, phase: i * 1.3 });
    }
  }

  // ---------- the sounds ----------
  setPlayers(list, localId) {
    for (const b of this.booths.values()) { this.scene.remove(b.group); disposeTree(b.group); }
    this.booths.clear();
    const n = list.length;
    // An arc facing the camera, so every booth is visible from the front.
    const span = Math.min(Math.PI * 1.08, 0.55 * n + 0.5);
    list.forEach((p, i) => {
      const a = Math.PI / 2 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * span) + Math.PI;
      const x = Math.cos(a) * BOOTH_R;
      const z = Math.sin(a) * BOOTH_R * 0.82 - 0.6;
      this.booths.set(p.id, this._booth(p, x, z, p.id === localId));
    });
  }

  _booth(p, x, z, local) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.lookAt(0, 0, 0);
    this.scene.add(group);
    const color = new THREE.Color(p.color);
    const cab = this._cabinetMaterials();
    // Two columns of three boxes, the top box hand-painted with the sound's name.
    const sign = canvasTexture(512, 192, (g, W, H) => paintSign(g, W, H, p.name, p.color, local));
    const signMat = [cab[0], cab[0], cab[0], cab[0], new THREE.MeshStandardMaterial({ map: sign, roughness: 0.7 }), cab[0]];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const box = add(group, new THREE.BoxGeometry(1.25, 1, 0.9), k === 2 ? (side < 0 ? signMat : cab) : cab, side * 1.15, 0.5 + k * 1.02, -0.4);
        box.receiveShadow = true;
      }
    }
    // The desk, its lock lamp, and the selector behind it.
    add(group, new THREE.BoxGeometry(1.4, 0.9, 0.7), new THREE.MeshStandardMaterial({ color: 0x141318, roughness: 0.6, metalness: 0.3 }), 0, 0.45, 0.65);
    const lampMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.18), toneMapped: false });
    const lamp = add(group, new THREE.BoxGeometry(1.3, 0.1, 0.04), lampMat, 0, 0.72, 1.01);
    const fig = new Figure({ id: p.id, name: p.name, color: p.color, local });
    fig.place(0, 0, 0.05);
    fig.face(0);
    group.add(fig.group);
    const glow = new THREE.PointLight(color, 10, 9, 1.4);
    glow.position.set(0, 2.6, 2.2);
    group.add(glow);
    // The score card above the stack.
    const card = makeCardSprite();
    card.sprite.position.set(0, 3.95, -0.4);
    group.add(card.sprite);
    const b = { id: p.id, group, fig, lamp, lampMat, color, glow, card, base: group.position.clone(), shake: 0, score: -1, streak: -1, locked: false, hit: 0 };
    this._card(b, 0, 0, false);
    return b;
  }

  _cabinetMaterials() {
    if (this.cabMats) return this.cabMats;
    const front = canvasTexture(256, 205, (g, W, H) => {
      g.fillStyle = '#121116';
      g.fillRect(0, 0, W, H);
      const cone = (cx, cy, r) => {
        const grad = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
        grad.addColorStop(0, '#2b2a31');
        grad.addColorStop(0.35, '#0a0a0c');
        grad.addColorStop(0.9, '#1d1c22');
        grad.addColorStop(1, '#3a3943');
        g.fillStyle = grad;
        g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
        g.fillStyle = '#3c3b45';
        g.beginPath(); g.arc(cx, cy, r * 0.16, 0, TAU); g.fill();
      };
      cone(W * 0.5, H * 0.5, H * 0.42);
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 6;
      g.strokeRect(3, 3, W - 6, H - 6);
    });
    const body = new THREE.MeshStandardMaterial({ color: 0x24232b, roughness: 0.75 });
    const face = new THREE.MeshStandardMaterial({ map: front, roughness: 0.75 });
    this.cabMats = [body, body, body, body, face, body];
    return this.cabMats;
  }

  _card(b, score, streak, locked) {
    if (b.score === score && b.streak === streak && b.locked === locked) return;
    b.score = score;
    b.streak = streak;
    b.locked = locked;
    drawCard(b.card, score, streak, locked, '#' + b.color.getHexString());
  }

  // [{ id, score, streak, locked }]
  setScores(list) {
    for (const p of list) {
      const b = this.booths.get(p.id);
      if (!b) continue;
      this._card(b, p.score, p.streak, p.locked);
      b.lampMat.color.copy(b.color).multiplyScalar(p.locked ? 1.4 : 0.18);
    }
  }

  // ---------- the show ----------
  cue({ n, of, warp, label }) {
    this.mode = 'cue';
    this.focus = null;
    this.armIn = 0;
    this.labelMat.map.dispose();
    this.labelMat.map = this._labelTexture(`Round ${n}`, label || warp || '', n === of ? '#ffb52e' : '#f3ead6');
    this.labelMat.needsUpdate = true;
    this.camWant.set(0, 11.5, 19.5);
    this.lookWant.set(0, 1.2, -1.8);
  }

  play() { this.mode = 'play'; }

  reveal({ art, title, artist }) {
    this.mode = 'reveal';
    this.camWant.set(0, 6.2, 8.2);
    this.lookWant.set(-0.45, 1.6, 0);
    const fallback = () => {
      if (this.mode !== 'reveal') return;
      this._setLabel(this._labelTexture(title, artist, '#f3ead6'));
    };
    if (!art) { fallback(); return; }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const token = (this.artToken = (this.artToken || 0) + 1);
    loader.load(art, (tex) => {
      if (token !== this.artToken || this.mode !== 'reveal') { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      this._setLabel(tex);
    }, undefined, fallback);
  }

  _setLabel(tex) {
    if (this.labelMat.map) this.labelMat.map.dispose();
    this.labelMat.map = tex;
    this.labelMat.needsUpdate = true;
  }

  // Right or wrong at the reveal: the sound's figure reacts.
  react(id, ok) {
    const b = this.booths.get(id);
    if (!b) return;
    if (ok) b.fig.cheer(2); else b.fig.rock();
  }

  // A thrown dubplate.
  sabotage(from, to, kind) {
    const a = this.booths.get(from);
    const b = this.booths.get(to);
    if (!a || !b) return;
    const disc = new THREE.Group();
    add(disc, new THREE.CylinderGeometry(0.42, 0.42, 0.04, 32), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.25, metalness: 0.3 }));
    const lbl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 24), new THREE.MeshBasicMaterial({ color: a.color, toneMapped: false }));
    disc.add(lbl);
    const p0 = a.group.position.clone().add(new THREE.Vector3(0, 2.4, 0));
    const p2 = b.group.position.clone().add(new THREE.Vector3(0, 2.2, 0));
    const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, 5 + Math.random() * 1.5, 0));
    disc.position.copy(p0);
    this.scene.add(disc);
    this.flying.push({ disc, p0, p1, p2, t: 0, dur: 0.95, to, kind, color: a.color.getHex() });
  }

  podium(id) {
    this.mode = 'podium';
    const b = this.booths.get(id);
    if (!b) return;
    this.focus = id;
    const p = b.group.position;
    // Stand on the dance floor in front of the winning stack, looking up at it.
    const dir = new THREE.Vector3(p.x, 0, p.z).normalize();
    this.camWant.set(p.x - dir.x * 9.5, 5.2, p.z - dir.z * 9.5);
    // Aim past the stack so it stands beside the results card, not behind it.
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.lookWant.set(p.x + side.x * 3.6, 2.3, p.z + side.z * 3.6);
    b.fig.cheer(30);
    for (let k = 0; k < 4; k++) this.sparks.emit({ x: p.x, y: 4.6, z: p.z, n: 90, speed: 5, up: 1.4, colors: [MUSIC, 0xfff1dc, b.color.getHex()], life: 2, gravity: 5, drag: 0.5, radius: 1 });
  }

  // ---------- frame ----------
  // audio: { spectrum: Uint8Array(64), rate, bass, warp }
  update(dt, reduce, audio = null) {
    this.time += dt;
    const t = this.time;
    const spec = audio && audio.spectrum;
    const rate = audio ? audio.rate : 0;
    const bass = audio ? audio.bass : 0;
    this.rate = damp(this.rate, rate, 4, dt);

    // The platter turns at 33⅓ rpm times the pitch; reverse turns it backwards.
    const spinning = this.mode === 'play' || (this.mode === 'cue' && this.armIn > 0.9);
    const want = spinning ? this.rate : 0;
    this.spin = damp(this.spin, want, this.mode === 'reveal' ? 3 : 6, dt);
    const ang = this.spin * (TAU * 33.333 / 60) * dt * (reduce ? 0.3 : 1);
    this.platter.rotation.y -= ang;
    this.vinyl.rotation.y -= ang;
    // The strobe: the dots look still at true speed and creep when the pitch is off.
    this.strobe += (Math.abs(this.spin) - (spinning ? 1 : 0)) * dt * 0.25;
    this.dotTex.offset.x = this.strobe;
    this.strobeLamp.intensity = spinning ? 2 + Math.sin(t * 50) * 0.2 : 0.4;
    // The tonearm swings over the record during a round.
    this.armIn = damp(this.armIn, this.mode === 'play' || this.mode === 'cue' ? 1 : 0, 3, dt);
    this.arm.rotation.y = -0.05 - this.armIn * 0.42;
    this.arm.rotation.x = (1 - this.armIn) * 0.05;
    // The pitch fader: up for faster, down for slower.
    const pitch = clamp((Math.abs(this.spin) || 1) - 1, -0.4, 0.6);
    this.fader.position.z = damp(this.fader.position.z, 0.75 - pitch * 1.6, 6, dt);
    this.faderLamp.material.color.setHex(Math.abs(pitch) > 0.02 && spinning ? WARP : 0x222222);

    // The spectrum ring.
    const ring = this.ring;
    for (let i = 0; i < BARS; i++) {
      const v = spec ? spec[i] / 255 : 0;
      const idle = this.mode === 'play' ? 0 : 0.06 + 0.04 * Math.sin(t * 2 + i * 0.5);
      this.levels[i] = damp(this.levels[i], Math.max(v, idle), v > this.levels[i] ? 30 : 9, dt);
      const lv = this.levels[i];
      const a = (i / BARS) * TAU;
      this.dummy.position.set(Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R);
      this.dummy.rotation.set(0, -a, 0);
      this.dummy.scale.set(1, 0.06 + lv * 2.4, 1);
      this.dummy.updateMatrix();
      ring.setMatrixAt(i, this.dummy.matrix);
      ring.setColorAt(i, this.color.setHex(MUSIC).multiplyScalar(0.35 + lv * 1.1));
    }
    ring.instanceMatrix.needsUpdate = true;
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
    this.lip.material.color.setHex(MUSIC).multiplyScalar(0.4 + bass * 1.4);

    // Lasers sweep, and fire on the bass.
    const kick = bass > 0.62 ? 1 : 0;
    for (const L of this.lasers) {
      L.rig.rotation.set(0, 0, 0);
      // Each rig sweeps its beam across the floor.
      L.rig.lookAt(Math.sin(t * 0.5 + L.phase) * (reduce ? 0 : 6), -6, Math.cos(t * 0.37 + L.phase) * (reduce ? 0 : 4) - 2);
      L.rig.rotateX(-Math.PI / 2); // the beam runs down its -y axis
      const target = this.mode === 'play' ? 0.025 + bass * 0.1 + kick * 0.14 : 0.018;
      L.mat.opacity = damp(L.mat.opacity, target, kick ? 30 : 6, dt);
    }
    this.key.intensity = damp(this.key.intensity, 50 + bass * 40, 8, dt);

    // The sounds bob to the beat (the beat is whatever the bass says it is).
    for (const b of this.booths.values()) {
      b.fig.update(dt, t, { still: reduce });
      if (!reduce && this.mode === 'play') b.fig.group.position.y = Math.abs(Math.sin(t * 4.2 * (Math.abs(this.rate) || 1) + b.id)) * 0.08 * (0.5 + bass);
      b.shake = Math.max(0, b.shake - dt * 2);
      const sx = b.shake * Math.sin(t * 70) * 0.18;
      b.group.position.set(b.base.x + sx, 0, b.base.z);
      b.glow.intensity = damp(b.glow.intensity, b.hit > t ? 26 : 10 + bass * 6, 8, dt);
      if (b.hit > t) b.glow.color.setHex(HIT); else b.glow.color.copy(b.color);
    }

    // Dubplates in flight.
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt / f.dur;
      const k = Math.min(1, f.t);
      const u = 1 - k;
      f.disc.position.set(
        u * u * f.p0.x + 2 * u * k * f.p1.x + k * k * f.p2.x,
        u * u * f.p0.y + 2 * u * k * f.p1.y + k * k * f.p2.y,
        u * u * f.p0.z + 2 * u * k * f.p1.z + k * k * f.p2.z,
      );
      f.disc.rotation.x = 0.5;
      f.disc.rotation.y += dt * 24;
      if (!reduce) this.sparks.emit({ x: f.disc.position.x, y: f.disc.position.y, z: f.disc.position.z, n: 3, speed: 0.6, up: 0.2, colors: [f.color, 0xfff1dc], life: 0.5, gravity: 0, drag: 2, radius: 0.1 });
      if (k >= 1) {
        const b = this.booths.get(f.to);
        if (b) {
          b.shake = 1;
          b.hit = t + 1.2;
          b.fig.stun(1.2);
          this.sparks.emit({ x: f.p2.x, y: f.p2.y, z: f.p2.z, n: 120, speed: 6, up: 0.8, colors: [HIT, 0xfff1dc, f.color], life: 1, gravity: 8, drag: 0.6, radius: 0.4 });
        }
        this.scene.remove(f.disc);
        disposeTree(f.disc);
        this.flying.splice(i, 1);
      }
    }
    this.sparks.update(dt);

    // The camera drifts; the reveal leans in on the record.
    const drift = reduce ? 0 : Math.sin(t * 0.12) * 1.6;
    this.camPos.x = damp(this.camPos.x, this.camWant.x + (this.mode === 'reveal' || this.focus != null ? 0 : drift), 2, dt);
    this.camPos.y = damp(this.camPos.y, this.camWant.y, 2, dt);
    this.camPos.z = damp(this.camPos.z, this.camWant.z * (this.focus != null ? 1 : this.zoomOut), 2, dt);
    this.camLook.lerp(this.lookWant, 1 - Math.exp(-3 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow screens step back so the whole ring of booths fits.
    this.zoomOut = w / h < 1 ? 1.75 : w / h < 1.4 ? 1.25 : 1;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const f of this.flying) disposeTree(f.disc);
    this.flying = [];
    for (const b of this.booths.values()) { b.fig.dispose && b.fig.dispose(); disposeTree(b.group); }
    this.booths.clear();
    if (this.mirror) { this.mirror.getRenderTarget().dispose(); this.mirror.dispose(); }
    disposeTree(this.scene);
    if (this.labelMat.map) this.labelMat.map.dispose();
  }
}

// ---------- canvas craft ----------
// Hand-painted sound-system lettering: a fat outlined name with a drop shade.
function paintSign(g, W, H, name, color, local) {
  g.fillStyle = '#0d0c10';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.strokeRect(10, 10, W - 20, H - 20);
  const text = String(name).toUpperCase().slice(0, 12);
  let size = 104;
  g.font = `italic 800 ${size}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;
  while (g.measureText(text).width > W - 70 && size > 40) { size -= 6; g.font = `italic 800 ${size}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`; }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const y = H * 0.48;
  g.fillStyle = '#000';
  g.fillText(text, W / 2 + 7, y + 7);
  g.lineWidth = 10;
  g.strokeStyle = '#f3ead6';
  g.strokeText(text, W / 2, y);
  g.fillStyle = color;
  g.fillText(text, W / 2, y);
  g.font = '700 22px ui-monospace, monospace';
  g.fillStyle = '#f3ead6';
  g.fillText(local ? 'YOUR SOUND · HI-POWER' : 'SOUND SYSTEM · HI-POWER', W / 2, H - 30);
}

function makeCardSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 160;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(2.1, 0.875, 1);
  return { canvas, tex, sprite };
}

function drawCard(card, score, streak, locked, color) {
  const g = card.canvas.getContext('2d');
  const W = card.canvas.width;
  const H = card.canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,7,12,0.86)';
  g.fillRect(0, 0, W, H);
  g.fillStyle = color;
  g.fillRect(0, 0, 12, H);
  g.fillStyle = '#f3ead6';
  g.font = '800 70px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(String(Math.max(0, Math.round(score))).padStart(4, '0'), 30, 62);
  g.font = '700 26px ui-monospace, monospace';
  g.fillStyle = streak >= 2 ? '#ffb52e' : 'rgba(243,234,214,0.6)';
  g.fillText(streak >= 2 ? `STREAK ×${streak}` : 'NO STREAK', 30, 126);
  if (locked) {
    g.fillStyle = '#46e07a';
    g.fillRect(W - 120, 22, 100, 36);
    g.fillStyle = '#06110a';
    g.font = '800 24px ui-monospace, monospace';
    g.fillText('LOCKED', W - 112, 41);
  }
  card.tex.needsUpdate = true;
}

function wrap(g, text, x, y, maxW, lh) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  shown.forEach((l, i) => g.fillText(l, x, y + i * lh - ((shown.length - 1) * lh) / 2));
}
