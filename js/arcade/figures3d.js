// A small articulated character shared by the quiz games: hips, two legs, a body, two
// arms and a head, each on its own pivot, plus a floating nameplate. Everything is
// primitives and a canvas texture. It knows how to stand, run to a spot, panic, cheer,
// fall and turn into a ghost.

import * as THREE from 'three';
import { TAU, lerp, damp, clamp } from '../render/kit3d.js';

const DISPLAY = '"Bahnschrift", "DIN Alternate", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function nameplate(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0908';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = color;
  g.fillRect(0, 0, 12, 64);
  g.fillStyle = '#f3ead6';
  g.font = `700 34px ${DISPLAY}`;
  g.textBaseline = 'middle';
  let text = String(name).toUpperCase();
  while (g.measureText(text).width > 226 && text.length > 3) text = text.slice(0, -1);
  g.fillText(text, 22, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false, transparent: true }));
  sprite.scale.set(1.25, 0.31, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export class Figure {
  // kind: 'contestant' (jumpsuit and bib) or 'keeper' (oilskin, hat and a lantern with up to three flames)
  constructor({ id, name, color, kind = 'contestant', style = 0, local = false }) {
    this.id = id;
    this.kind = kind;
    this.local = local;
    this.color = new THREE.Color(color);
    this.group = new THREE.Group();
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.heading = 0;
    this.state = 'idle';
    this.phase = (id * 1.7) % TAU;
    this.stride = 0;
    this.speed = 3.4;
    this.vy = 0;
    this.spin = new THREE.Vector3();
    this.ghost = false;
    this.cheerT = 0;
    this.rockT = 0;
    this.tilt = 0;
    this.tiltTarget = 0;
    this.flameCount = 3;
    this.hidden = false;

    const suit = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.6, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.7, metalness: 0.2 });
    const skin = new THREE.MeshStandardMaterial({ color: this.color.clone().lerp(new THREE.Color(0xffffff), 0.62), roughness: 0.7 });
    const eye = new THREE.MeshBasicMaterial({ color: 0x0b0d10 });
    this.mats = [suit, dark, skin];

    const root = new THREE.Group(); // tilts and bobs as one
    this.root = root;
    this.group.add(root);

    const leg = (x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.52, 0);
      mesh(pivot, new THREE.CylinderGeometry(0.075, 0.065, 0.46, 8), kind === 'keeper' ? dark : suit, 0, -0.23, 0);
      mesh(pivot, new THREE.BoxGeometry(0.13, 0.08, 0.22), dark, 0, -0.49, 0.04);
      root.add(pivot);
      return pivot;
    };
    this.legL = leg(-0.12);
    this.legR = leg(0.12);

    this.body = new THREE.Group();
    this.body.position.y = 0.52;
    root.add(this.body);
    if (kind === 'keeper') {
      // An oilskin coat: a cone that flares over the legs.
      mesh(this.body, new THREE.CylinderGeometry(0.19, 0.36, 0.72, 10), suit, 0, 0.3, 0);
      mesh(this.body, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), dark, 0, 0.62, 0);
    } else {
      mesh(this.body, new THREE.CapsuleGeometry(0.2, 0.3, 4, 10), suit, 0, 0.36, 0);
      // A numbered bib, front and back.
      const bib = new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.8 });
      this.mats.push(bib);
      mesh(this.body, new THREE.BoxGeometry(0.24, 0.24, 0.42), bib, 0, 0.4, 0);
    }

    const arm = (x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.62, 0);
      mesh(pivot, new THREE.CylinderGeometry(0.06, 0.05, 0.4, 8), suit, 0, -0.2, 0);
      mesh(pivot, new THREE.SphereGeometry(0.065, 8, 6), skin, 0, -0.42, 0);
      this.body.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.27);
    this.armR = arm(0.27);

    this.head = new THREE.Group();
    this.head.position.y = 0.86;
    this.body.add(this.head);
    mesh(this.head, new THREE.SphereGeometry(0.19, 14, 10), skin);
    for (const x of [-0.07, 0.07]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eye);
      e.position.set(x, 0.02, 0.17);
      this.head.add(e);
    }
    // Six hats, by seat, so a crowd of the same shape is still six different people.
    const hat = style % 6;
    if (hat === 0) { mesh(this.head, new THREE.CylinderGeometry(0.2, 0.2, 0.09, 12), suit, 0, 0.14, 0); mesh(this.head, new THREE.BoxGeometry(0.26, 0.03, 0.16), suit, 0, 0.1, 0.2); }
    else if (hat === 1) { mesh(this.head, new THREE.SphereGeometry(0.2, 12, 8, 0, TAU, 0, Math.PI / 2), suit, 0, 0.04, 0); mesh(this.head, new THREE.SphereGeometry(0.05, 8, 6), dark, 0, 0.25, 0); }
    else if (hat === 2) { mesh(this.head, new THREE.CylinderGeometry(0.34, 0.36, 0.03, 16), suit, 0, 0.12, -0.03); mesh(this.head, new THREE.SphereGeometry(0.19, 12, 8, 0, TAU, 0, Math.PI / 2), suit, 0, 0.1, 0); }
    else if (hat === 3) { mesh(this.head, new THREE.ConeGeometry(0.2, 0.3, 10), suit, 0, 0.28, 0); }
    else if (hat === 4) { mesh(this.head, new THREE.TorusGeometry(0.19, 0.035, 6, 16).rotateX(Math.PI / 2), suit, 0, 0.1, 0); }
    else { mesh(this.head, new THREE.BoxGeometry(0.3, 0.12, 0.3), suit, 0, 0.2, 0); }

    if (kind === 'keeper') {
      // A storm lantern in the right hand. Its flames are the keeper's lives.
      const lantern = new THREE.Group();
      lantern.position.set(0, -0.56, 0.02);
      mesh(lantern, new THREE.CylinderGeometry(0.09, 0.09, 0.03, 8), dark, 0, 0.1, 0);
      mesh(lantern, new THREE.CylinderGeometry(0.09, 0.09, 0.03, 8), dark, 0, -0.1, 0);
      const glass = new THREE.MeshBasicMaterial({ color: 0xffc36a, transparent: true, opacity: 0.25, toneMapped: false });
      this.mats.push(glass);
      mesh(lantern, new THREE.CylinderGeometry(0.075, 0.075, 0.18, 8), glass, 0, 0, 0).castShadow = false;
      this.flames = [];
      this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffb52e, toneMapped: false });
      this.mats.push(this.flameMat);
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 6), this.flameMat);
        f.position.set((i - 1) * 0.045, -0.02, 0);
        lantern.add(f);
        this.flames.push(f);
      }
      this.lamp = new THREE.PointLight(0xffb060, 3, 4.5, 2);
      lantern.add(this.lamp);
      this.armR.add(lantern);
      this.lantern = lantern;
    }

    this.plate = nameplate(local ? `${name} (you)` : name, color);
    this.plate.position.y = 1.86;
    this.group.add(this.plate);
  }

  place(x, y, z) {
    this.pos.set(x, y, z);
    this.target.set(x, y, z);
    this.group.position.copy(this.pos);
  }

  moveTo(x, z, y = this.target.y) { this.target.set(x, y, z); if (this.state !== 'fall') this.state = 'run'; }
  face(angle) { this.heading = angle; }
  cheer(seconds = 2.4) { this.cheerT = seconds; }
  rock() { this.rockT = 0.6; }
  setTilt(v) { this.tiltTarget = v; }

  fall() {
    if (this.state === 'fall') return;
    this.state = 'fall';
    this.vy = 1.5;
    this.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9);
  }

  setFlames(n) {
    this.flameCount = n;
    if (!this.flames) return;
    this.flames.forEach((f, i) => { f.visible = i < n; });
    this.lamp.intensity = n > 0 ? 1.2 + n : 0;
  }

  // A wraith: pale, see-through, and off the floor.
  setGhost(on) {
    if (this.ghost === on) return;
    this.ghost = on;
    for (const m of this.mats) {
      if (m === this.flameMat) continue;
      m.transparent = on || m.opacity < 1;
      if (on) { m.userData.was = m.color.getHex(); m.userData.op = m.opacity; m.color.set(0x9fd4e8); m.opacity = Math.min(m.opacity, 0.38); m.depthWrite = false; }
      else { if (m.userData.was != null) m.color.setHex(m.userData.was); m.opacity = m.userData.op == null ? 1 : m.userData.op; m.depthWrite = true; }
      m.needsUpdate = true;
    }
    if (this.lantern) this.lantern.visible = !on;
  }

  reset() {
    this.state = 'idle';
    this.vy = 0;
    this.hidden = false;
    this.group.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.group.rotation.set(0, this.heading, 0);
  }

  update(dt, t, { frantic = false, still = false } = {}) {
    if (this.hidden) return;
    const g = this.group;
    this.cheerT = Math.max(0, this.cheerT - dt);
    this.rockT = Math.max(0, this.rockT - dt);
    this.tilt = damp(this.tilt, this.tiltTarget, 5, dt);

    if (this.state === 'fall') {
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      g.position.copy(this.pos);
      this.root.rotation.x += this.spin.x * dt;
      this.root.rotation.y += this.spin.y * dt;
      this.root.rotation.z += this.spin.z * dt;
      const flail = Math.sin(t * 22 + this.phase);
      this.armL.rotation.set(0, 0, -2.4 + flail * 0.5);
      this.armR.rotation.set(0, 0, 2.4 - flail * 0.5);
      this.legL.rotation.x = flail * 0.9;
      this.legR.rotation.x = -flail * 0.9;
      if (this.pos.y < -34) { this.hidden = true; g.visible = false; }
      return;
    }

    // Run towards the target.
    const dx = this.target.x - this.pos.x;
    const dz = this.target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const speed = this.speed * (frantic ? 1.45 : 1);
    let moving = false;
    if (dist > 0.04 && !still) {
      const step = Math.min(dist, speed * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      this.heading = Math.atan2(dx, dz);
      this.stride += step * 5.2;
      moving = true;
    } else if (this.state === 'run') {
      this.state = 'idle';
    }
    this.pos.y = damp(this.pos.y, this.target.y, 8, dt);

    let bob = 0;
    let lean = 0;
    if (moving) {
      const s = Math.sin(this.stride);
      this.legL.rotation.x = s * 0.95;
      this.legR.rotation.x = -s * 0.95;
      this.armL.rotation.set(-s * 0.9, 0, 0.12);
      if (!this.lantern) this.armR.rotation.set(s * 0.9, 0, -0.12);
      bob = Math.abs(Math.cos(this.stride)) * 0.06;
      lean = 0.2;
    } else if (this.cheerT > 0) {
      const h = Math.abs(Math.sin(t * 9 + this.phase));
      bob = h * 0.22;
      this.armL.rotation.set(0, 0, -2.6 + h * 0.3);
      this.armR.rotation.set(0, 0, 2.6 - h * 0.3);
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
    } else if (frantic) {
      // Panic: looking about, arms up, hopping from foot to foot.
      const s = Math.sin(t * 16 + this.phase);
      bob = Math.abs(s) * 0.07;
      this.armL.rotation.set(0, 0, -1.9 + s * 0.5);
      this.armR.rotation.set(0, 0, 1.9 - s * 0.5);
      this.legL.rotation.x = s * 0.4;
      this.legR.rotation.x = -s * 0.4;
      this.head.rotation.y = Math.sin(t * 11 + this.phase) * 0.8;
    } else {
      const s = Math.sin(t * 2.2 + this.phase);
      bob = Math.abs(s) * 0.03;
      this.legL.rotation.x = damp(this.legL.rotation.x, 0, 10, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, 0, 10, dt);
      this.armL.rotation.set(s * 0.08, 0, 0.14);
      if (!this.lantern) this.armR.rotation.set(-s * 0.08, 0, -0.14);
      this.head.rotation.y = damp(this.head.rotation.y, Math.sin(t * 0.6 + this.phase) * 0.25, 4, dt);
    }
    if (this.lantern) {
      // The lantern arm stays held out in front.
      this.armR.rotation.set(-1.15 + Math.sin(t * 1.7 + this.phase) * 0.05, 0, -0.1);
      this.flameMat.color.setRGB(1, 0.62 + Math.sin(t * 19 + this.phase) * 0.08, 0.16);
    }
    this.head.rotation.z = this.tilt;
    const rock = this.rockT > 0 ? Math.sin(this.rockT * 30) * 0.3 * (this.rockT / 0.6) : 0;
    const float = this.ghost ? 0.3 + Math.sin(t * 1.6 + this.phase) * 0.1 : 0;
    this.root.position.y = bob + float;
    this.root.rotation.x = lerp(this.root.rotation.x, lean, clamp(dt * 10, 0, 1));
    this.root.rotation.z = rock;
    g.position.copy(this.pos);
    // Turn towards the heading by the short way round.
    let d = this.heading - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * clamp(dt * 10, 0, 1);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
}
