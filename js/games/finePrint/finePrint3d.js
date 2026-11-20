// FINE PRINT — the studio in 3D: Channel 20's overnight shopping set. A blue cyclorama
// papered in the show's own small print, a turntable with tonight's offer boxed up on
// it, and the phone bank behind: one desk phone and one call lamp per player. A lamp
// lights when its player has filed a knock-off, and again when they phone in. The light
// box over the bank says what the lines are doing.

import * as THREE from 'three';
import { Figure } from '../../arcade/figures3d.js';
import { TAU, damp, clamp, add, canvasTexture, disposeTree } from '../../render/kit3d.js';

const DISPLAY = '"Bahnschrift", "DIN Alternate", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const NARROW = '"Bahnschrift SemiCondensed", "Bahnschrift Condensed", "Arial Narrow", "Roboto Condensed", "DIN Condensed", sans-serif';
const BLUE = '#1638c9';
const SUN = '#ffd23f';

// The house small print that papers the set.
export const SMALL_PRINT = [
  '*Facts checked against Wikipedia before broadcast.',
  'Knock-offs are the work of the callers named and do not reflect the views of Channel 20.',
  'Lines close when the clock runs out. Calls cost nothing.',
  'Only one genuine article per offer. Accept no imitations.',
  'Premium rate applies to offers three and four. The closing offer is charged at three times the standard rate.',
  'Five-star reviews are the opinion of the reviewer.',
  'No emus were harmed in the making of this programme.',
  'Offer void where prohibited, and in the small hours generally.',
  'Your knock-off may be read aloud at speed.',
  'Results not typical. Terms and conditions apply.',
];

function drawWall(g, W, H) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#081565');
  grad.addColorStop(0.55, BLUE);
  grad.addColorStop(1, '#0d2690');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // The small print, set solid in narrow capitals, faint.
  g.fillStyle = 'rgba(255,255,255,0.075)';
  g.font = `600 15px ${NARROW}`;
  g.textBaseline = 'top';
  let k = 0;
  for (let y = 6; y < H; y += 19) {
    let x = -((y * 7) % 260);
    while (x < W) {
      const s = `${SMALL_PRINT[k++ % SMALL_PRINT.length].toUpperCase()}  `;
      g.fillText(s, x, y);
      x += g.measureText(s).width;
    }
  }
}

// The offer, boxed: a carton with its number and department.
function drawCarton(g, W, H, { n = 1, dept = 'THE WHOLE CATALOGUE' } = {}) {
  g.fillStyle = '#c99a5b';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(90,58,24,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1);
  }
  g.fillStyle = BLUE;
  g.fillRect(0, H * 0.12, W, H * 0.34);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(H * 0.2)}px ${DISPLAY}`;
  g.fillText(`OFFER Nº ${String(n).padStart(2, '0')}`, W / 2, H * 0.29);
  g.fillStyle = '#2a1a0a';
  g.font = `600 ${Math.round(H * 0.075)}px ${NARROW}`;
  g.fillText(String(dept).toUpperCase(), W / 2, H * 0.6);
  g.font = `600 ${Math.round(H * 0.055)}px ${NARROW}`;
  g.fillText('CONTENTS: ONE (1) GENUINE ARTICLE · SEE SMALL PRINT', W / 2, H * 0.75);
  g.strokeStyle = '#2a1a0a';
  g.lineWidth = 3;
  g.strokeRect(W * 0.06, H * 0.84, W * 0.88, H * 0.1);
  g.font = `700 ${Math.round(H * 0.06)}px ${DISPLAY}`;
  g.fillText('THIS WAY UP ↑   FRAGILE   KEEP DRY', W / 2, H * 0.89);
}

// The light box over the phone bank.
function drawSign(g, W, H, text, lit) {
  g.fillStyle = lit ? '#fff7d6' : '#2a2f45';
  g.fillRect(0, 0, W, H);
  g.fillStyle = lit ? '#0a0f2a' : '#566080';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = Math.round(H * 0.56);
  g.font = `700 ${size}px ${DISPLAY}`;
  while (g.measureText(text).width > W * 0.92 && size > 10) { size -= 2; g.font = `700 ${size}px ${DISPLAY}`; }
  g.fillText(text, W / 2, H * 0.54);
}

// The starburst that crowns the genuine article.
export function drawBurst(g, W, H, label = 'GENUINE') {
  g.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.48;
  g.beginPath();
  for (let i = 0; i < 32; i++) {
    const r = i % 2 ? R * 0.78 : R;
    const a = (i / 32) * TAU - Math.PI / 2;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#0a0f2a';
  g.save();
  g.translate(8, 8);
  g.fill();
  g.restore();
  g.fillStyle = SUN;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#0a0f2a';
  g.stroke();
  g.fillStyle = '#0a0f2a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(R * 0.3)}px ${DISPLAY}`;
  g.fillText(label, cx, cy - R * 0.08);
  g.font = `700 ${Math.round(R * 0.17)}px ${DISPLAY}`;
  g.fillText('ARTICLE', cx, cy + R * 0.22);
}

export class StudioStage {
  constructor(renderer, container) {
    this.renderer = renderer;
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050a24);
    this.scene.fog = new THREE.Fog(0x050a24, 22, 46);
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
    this.camPos = new THREE.Vector3(0, 3.6, 9.6);
    this.camWant = this.camPos.clone();
    this.look = new THREE.Vector3(0, 2.1, -1.5);
    this.lookWant = this.look.clone();
    this.t = 0;
    this.seats = new Map();
    this.burstT = -1;
    this._build();
    this.resize();
  }

  _build() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x9fb4ff, 0x10142a, 0.75));
    const key = new THREE.SpotLight(0xfff1dc, 120, 30, 0.6, 0.6, 1.4);
    key.position.set(2.5, 9, 9);
    key.target.position.set(0, 1, -1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    s.add(key, key.target);
    for (const side of [-1, 1]) {
      const rim = new THREE.SpotLight(0x5f7dff, 50, 20, 0.7, 0.8, 1.5);
      rim.position.set(side * 7, 6, -6);
      rim.target.position.set(0, 1.5, -2.5);
      s.add(rim, rim.target);
    }

    // The studio floor, with tape marks for the presenter.
    const floorTex = canvasTexture(512, 512, (g, W, H) => {
      g.fillStyle = '#0c1024';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,210,63,0.5)';
      g.lineWidth = 5;
      for (const [x, y] of [[150, 300], [360, 300], [256, 420]]) {
        g.beginPath(); g.moveTo(x - 16, y - 16); g.lineTo(x + 16, y + 16); g.moveTo(x + 16, y - 16); g.lineTo(x - 16, y + 16); g.stroke();
      }
    });
    const floor = add(s, new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.38, metalness: 0.15 }), 0, 0, 0);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.castShadow = false;

    // The cyclorama: a curved blue wall, papered in small print.
    const wallTex = canvasTexture(2048, 768, drawWall);
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.repeat.set(-1, 1); // seen from inside the curve: flip it, so the print reads the right way round
    const cyc = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 13, 48, 1, true, Math.PI * 0.6, Math.PI * 0.8),
      new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.BackSide, roughness: 0.95, emissive: 0x0b1a6a, emissiveIntensity: 0.35 }),
    );
    cyc.position.set(0, 6.5, 4.5);
    s.add(cyc);
    this.wallTex = wallTex;

    // The phone bank: one long desk; seats are dressed when the players arrive.
    this.deskMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.55 });
    const front = canvasTexture(1536, 116, (g, W, H) => {
      g.fillStyle = '#e9e4d6';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#0a0f2a';
      g.fillRect(0, H * 0.62, W, H * 0.38);
      g.fillStyle = '#0a0f2a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 46px ${DISPLAY}`;
      g.fillText('CH 20 ORDER LINES', W / 2, H * 0.32);
      g.fillStyle = '#f7f8ff';
      g.font = `600 26px ${NARROW}`;
      g.fillText('OPERATORS ARE STANDING BY  ·  LINES CLOSE WHEN THE CLOCK RUNS OUT  ·  ACCEPT NO IMITATIONS', W / 2, H * 0.82);
    });
    const plain = this.deskMat;
    const deskFace = new THREE.MeshStandardMaterial({ map: front, roughness: 0.6 });
    this.desk = add(s, new THREE.BoxGeometry(12, 0.9, 1.2), [plain, plain, plain, plain, deskFace, plain], 0, 0.45, -3.4);
    this.desk.receiveShadow = true;
    add(s, new THREE.BoxGeometry(12.1, 0.12, 1.3), new THREE.MeshStandardMaterial({ color: 0x1638c9, roughness: 0.4 }), 0, 0.96, -3.4);

    // The light box over the bank.
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 1024;
    this.signCanvas.height = 128;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    this.signMat = new THREE.MeshBasicMaterial({ map: this.signTex, toneMapped: false });
    add(s, new THREE.BoxGeometry(8.4, 1.15, 0.25), new THREE.MeshStandardMaterial({ color: 0x0a0f2a, roughness: 0.6 }), 0, 4.6, -4.25);
    this.sign = add(s, new THREE.PlaneGeometry(8.1, 0.95), this.signMat, 0, 4.6, -4.11);
    this.setSign('OPERATORS ARE STANDING BY', false);

    // The turntable, with tonight's offer on it.
    this.turn = new THREE.Group();
    this.turn.position.set(0, 0, 1.4);
    s.add(this.turn);
    add(this.turn, new THREE.CylinderGeometry(1.25, 1.35, 0.5, 40), new THREE.MeshStandardMaterial({ color: 0x0a0f2a, roughness: 0.3, metalness: 0.4 }), 0, 0.25, 0);
    add(this.turn, new THREE.CylinderGeometry(1.2, 1.2, 0.04, 40), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.35 }), 0, 0.52, 0);
    this.cartonCanvas = document.createElement('canvas');
    this.cartonCanvas.width = 512;
    this.cartonCanvas.height = 384;
    this.cartonTex = new THREE.CanvasTexture(this.cartonCanvas);
    this.cartonTex.colorSpace = THREE.SRGBColorSpace;
    const kraft = new THREE.MeshStandardMaterial({ color: 0xc99a5b, roughness: 0.9 });
    const face = new THREE.MeshStandardMaterial({ map: this.cartonTex, roughness: 0.85 });
    this.carton = add(this.turn, new THREE.BoxGeometry(1.5, 1.12, 1.5), [face, face, kraft, kraft, face, face], 0, 1.11, 0);
    this.setOffer({ n: 1, dept: 'The Whole Catalogue' });

    // The starburst for the genuine article.
    const burst = canvasTexture(512, 512, (g, W, H) => drawBurst(g, W, H));
    this.burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: burst, transparent: true, depthTest: false, toneMapped: false }));
    this.burst.position.set(0, 2.9, 1.4);
    this.burst.scale.set(0.01, 0.01, 1);
    this.burst.renderOrder = 12; // over the name tags
    this.burst.visible = false;
    s.add(this.burst);
  }

  setSign(text, lit = true) {
    if (this.signKey === `${text}|${lit}`) return;
    this.signKey = `${text}|${lit}`;
    drawSign(this.signCanvas.getContext('2d'), this.signCanvas.width, this.signCanvas.height, text, lit);
    this.signTex.needsUpdate = true;
  }

  setOffer({ n, dept }) {
    drawCarton(this.cartonCanvas.getContext('2d'), this.cartonCanvas.width, this.cartonCanvas.height, { n, dept });
    this.cartonTex.needsUpdate = true;
  }

  // ---------- the operators ----------
  setPlayers(list, localId) {
    for (const x of this.seats.values()) { this.scene.remove(x.group); disposeTree(x.group); }
    this.seats.clear();
    const n = list.length;
    const gap = Math.min(1.9, 11 / Math.max(1, n));
    list.forEach((p, i) => {
      const x = (i - (n - 1) / 2) * gap;
      const group = new THREE.Group();
      group.position.set(x, 0, -4.2);
      this.scene.add(group);
      const fig = new Figure({ id: p.id, name: p.name, color: p.color, local: p.id === localId });
      fig.place(0, 0, 0);
      fig.face(0);
      group.add(fig.group);
      // The desk phone and the call lamp, on the desk in front of them.
      const c = new THREE.Color(p.color);
      const phone = new THREE.Group();
      phone.position.set(0.32, 1.02, 0.95);
      group.add(phone);
      add(phone, new THREE.BoxGeometry(0.42, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x15182a, roughness: 0.5 }), 0, 0.06, 0);
      const handset = add(phone, new THREE.CapsuleGeometry(0.05, 0.36, 4, 8), new THREE.MeshStandardMaterial({ color: 0x15182a, roughness: 0.5 }), 0, 0.16, -0.04);
      handset.rotation.z = Math.PI / 2;
      const lampMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.05, roughness: 0.3 });
      const lamp = add(group, new THREE.SphereGeometry(0.11, 16, 10, 0, TAU, 0, Math.PI / 2), lampMat, -0.3, 1.02, 0.95);
      this.seats.set(p.id, { id: p.id, group, fig, lampMat, lamp: 0, want: 0, handset, ring: 0 });
    });
  }

  // Which lamps are lit: { id: true }.
  setLamps(on) {
    for (const s of this.seats.values()) s.want = on[s.id] ? 1 : 0;
  }

  // A lamp flashes and the phone jumps when a player files or phones in.
  ring(id) {
    const s = this.seats.get(id);
    if (s) s.ring = 0.5;
  }

  // ---------- the show ----------
  offer({ n, dept }) {
    this.setOffer({ n, dept });
    this.burst.visible = false;
    this.burstT = -1;
    this.camWant.set(0, 3.6, 9.6);
    this.lookWant.set(0, 2.1 - this.lookDrop, -1.5);
  }

  genuine() {
    this.burst.visible = true;
    this.burstT = 0;
    // On a phone the set is a strip above the panels: push in on the burst. On a big
    // screen the panels cover the middle, so the camera stays wide.
    if ((this.container.clientHeight || 0) < 440) {
      this.camWant.set(0, 2.9, 7.4);
      this.lookWant.set(0, 1.9 - this.lookDrop, 0.2);
    }
  }

  react(id, good) {
    const s = this.seats.get(id);
    if (!s) return;
    if (good) s.fig.cheer(2); else s.fig.rock();
  }

  podium(id) {
    this.burst.visible = false;
    const s = this.seats.get(id);
    // The results card covers the middle, so the shot stays wide: the winner cheers at
    // their desk, with every lamp on the bank lit.
    if (s) s.fig.cheer(6);
    for (const x of this.seats.values()) x.want = 1;
    this.camWant.set(0, 3.6, 9.6);
    this.lookWant.set(0, 2.1 - this.lookDrop, -1.5);
  }

  update(dt, reduce) {
    this.t += dt;
    if (!reduce) this.turn.rotation.y += dt * 0.35;
    if (!reduce) this.wallTex.offset.x = (this.wallTex.offset.x + dt * 0.002) % 1;
    for (const s of this.seats.values()) {
      s.ring = Math.max(0, s.ring - dt);
      const flash = s.ring > 0 && !reduce ? (Math.sin(s.ring * 40) > 0 ? 1 : 0.3) : 0;
      s.lamp = damp(s.lamp, Math.max(s.want, flash), 10, dt);
      s.lampMat.emissiveIntensity = 0.05 + s.lamp * 2.2;
      s.handset.position.y = 0.16 + (s.ring > 0 && !reduce ? Math.abs(Math.sin(s.ring * 30)) * 0.05 : 0);
      s.fig.update(dt, this.t, { still: reduce });
    }
    if (this.burst.visible) {
      this.burstT += dt;
      const k = reduce ? 1 : clamp(this.burstT / 0.35, 0, 1);
      const pop = reduce ? 1 : 1 + Math.sin(Math.min(1, this.burstT / 0.5) * Math.PI) * 0.15;
      const size = 1.9 * k * pop;
      this.burst.scale.set(size, size, 1);
      this.burst.material.rotation = reduce ? 0 : Math.sin(this.t * 0.8) * 0.06;
    }
    const sway = reduce ? 0 : Math.sin(this.t * 0.21) * 0.3;
    this.camPos.lerp(new THREE.Vector3(this.camWant.x + sway, this.camWant.y, this.camWant.z), 1 - Math.exp(-2 * dt));
    this.look.lerp(this.lookWant, 1 - Math.exp(-2.4 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A tall phone sees the set from further back, so the bank still fits across.
    this.camera.fov = clamp(40 / Math.min(1, this.camera.aspect / 1.3), 40, 74);
    this.camera.updateProjectionMatrix();
    // The panels take the lower part of a tall screen: look lower, so the set rides up.
    this.lookDrop = clamp((1.2 - this.camera.aspect) / 0.7, 0, 1) * 1.6;
    this.lookWant.y = (this.burst && this.burst.visible ? 1.9 : 2.1) - this.lookDrop;
  }

  dispose() {
    for (const s of this.seats.values()) s.fig.dispose && s.fig.dispose();
    disposeTree(this.scene);
  }
}
