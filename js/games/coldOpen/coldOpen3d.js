// COLD OPEN — the cinema in Three.js: the screen and its fault shader, the countdown
// leader, the projector's beam from the booth, the seats, and the players standing at the
// front with their name cards.
//
// The screen is one shader. It takes the trailer (a VideoTexture) and the print's fault:
// soft focus, a scratched print, a flipped reel, a 2x anamorphic squeeze shown without its
// lens, a frame slipped in the gate, a silent-film iris, or the negative. Sabotage adds
// focus, a wrong reel (another film cut in) and film burn. A splice flashes at each loop
// of the clip; the cue mark appears top right as the reel runs out, as it does on a print.

import * as THREE from 'three';
import { Figure } from '../../arcade/figures3d.js';
import { TAU, damp, clamp, canvasTexture, add, disposeTree } from '../../render/kit3d.js';

export const FAULT_ID = Object.freeze({ PREMIERE: 0, SOFT_FOCUS: 1, SCRATCHED: 2, FLIPPED: 3, SQUEEZED: 4, RACKED: 5, IRIS: 6, NEGATIVE: 7 });
const SCREEN_W = 16;
const SCREEN_H = 9;
const SCREEN_Y = 7.6; // high enough to sit between the top bar and the marquee
const SCREEN_Z = -15;

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uDecoy;
uniform float uDecoyMix, uFault, uClear, uTime, uFocus, uBurn, uSplice, uCue, uStatic, uTexAspect, uDecoyAspect, uScreenAspect, uFilm;
uniform vec2 uBurnAt, uIris;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The film at its own shape inside the screen: letterboxed or pillarboxed.
vec2 fit(vec2 uv, float a) {
  float r = a / uScreenAspect;
  if (r > 1.0) uv.y = (uv.y - 0.5) * r + 0.5; else uv.x = (uv.x - 0.5) / r + 0.5;
  return uv;
}
float inside(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
vec3 tap(sampler2D t, vec2 uv, float a, float blur) {
  vec2 f = fit(uv, a);
  vec3 c = texture2D(t, f).rgb * inside(f);
  if (blur > 0.0005) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float ang = float(i) * 2.39996;
      float rad = sqrt(float(i) + 0.5) / 3.5;
      vec2 q = f + vec2(cos(ang), sin(ang)) * rad * blur * vec2(1.0, uScreenAspect);
      sum += texture2D(t, q).rgb * inside(q);
    }
    c = sum / 12.0;
  }
  return c;
}
void main() {
  vec2 uv = vUv;
  float k = 1.0 - uClear;
  float fr = floor(uTime * 24.0);
  // Gate weave: a film never sits quite still.
  uv += vec2(noise(vec2(uTime * 3.1, 1.0)) - 0.5, noise(vec2(2.0, uTime * 2.7)) - 0.5) * 0.003 * uFilm;
  float frameLine = 0.0;
  if (uFault > 2.5 && uFault < 3.5) uv.x = mix(uv.x, 1.0 - uv.x, step(0.5, k));                 // flipped
  if (uFault > 3.5 && uFault < 4.5) uv.x = (uv.x - 0.5) * (1.0 + k) + 0.5;                      // squeezed 2x
  if (uFault > 4.5 && uFault < 5.5) {                                                           // out of frame
    float y = uv.y + k * (0.36 + 0.07 * sin(uTime * 0.55));
    frameLine = k * (1.0 - smoothstep(0.0, 0.03, min(fract(y), 1.0 - fract(y))));
    uv.y = fract(y);
  }
  float blur = uFocus * 0.034 + ((uFault > 0.5 && uFault < 1.5) ? k * 0.022 : 0.0);           // soft focus
  vec3 col = tap(uTex, uv, uTexAspect, blur);
  if (uDecoyMix > 0.0) col = mix(col, tap(uDecoy, uv, uDecoyAspect, blur), uDecoyMix);        // wrong reel
  col *= 1.0 - frameLine;
  if (uFault > 1.5 && uFault < 2.5) {                                                           // scratched print
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l * 1.07, l * 0.93, l * 0.72), 0.85 * k);
    for (int i = 0; i < 3; i++) {
      float x = hash(vec2(fr, float(i)));
      float w = 0.0012 + 0.0022 * hash(vec2(float(i), fr));
      col = mix(col, vec3(0.93, 0.89, 0.8), k * step(abs(vUv.x - x), w) * step(0.35, hash(vec2(fr * 1.3, float(i)))));
    }
    col = mix(col, vec3(0.04), k * step(0.9982, hash(floor(vUv * vec2(320.0, 180.0)) + fr)));
    col *= 1.0 - k * 0.2 * hash(vec2(fr, 7.0));
  }
  if (uFault > 6.5) col = mix(col, (1.0 - col) * vec3(1.0, 0.76, 0.52), k);                    // negative
  if (uFault > 5.5 && uFault < 6.5) {                                                           // iris
    float r = mix(0.23, 2.4, uClear);
    col *= smoothstep(r, r - 0.03, length((vUv - uIris) * vec2(uScreenAspect, 1.0)));
  }
  if (uBurn > 0.0) {                                                                            // film burn
    float dist = length((vUv - uBurnAt) * vec2(uScreenAspect, 1.0)) + noise(vUv * 9.0 + uTime * 0.7) * 0.22 + noise(vUv * 31.0 - uTime) * 0.06;
    float r = uBurn * 1.35;
    float hole = smoothstep(r - 0.02, r - 0.16, dist);
    float rim = clamp(smoothstep(r + 0.03, r - 0.02, dist) - hole, 0.0, 1.0);
    float scorch = clamp(smoothstep(r + 0.14, r, dist) - rim - hole, 0.0, 1.0);
    col = mix(col, vec3(0.05, 0.025, 0.0), scorch * 0.85);
    col = mix(col, vec3(1.0, 0.46, 0.08), clamp(rim * 1.6, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.97, 0.9), hole);
  }
  col += (hash(vUv * vec2(1280.0, 720.0) + fr) - 0.5) * 0.07 * uFilm;                          // grain
  col = mix(col, vec3(0.96, 0.94, 0.9), uSplice * 0.45);                                        // the splice
  if (uStatic > 0.0) col = mix(col, vec3(hash(floor(vUv * vec2(420.0, 236.0)) + fr * 1.7)), uStatic);
  if (uCue > 0.0) {                                                                             // cue mark
    float d = length((vUv - vec2(0.915, 0.85)) * vec2(uScreenAspect, 1.0));
    col = mix(col, vec3(0.97, 0.95, 0.9), smoothstep(0.052, 0.046, d) * uCue);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// The SMPTE Universal Leader, shortened: 4, 3, 2 with the clock sweep, then black.
export function drawLeader(g, W, H, t) {
  const n = t < 0.6 ? 4 : t < 1.2 ? 3 : t < 1.8 ? 2 : 0;
  g.fillStyle = '#060606';
  g.fillRect(0, 0, W, H);
  if (!n) return;
  const f = (t % 0.6) / 0.6;
  const cx = W / 2;
  const cy = H / 2;
  g.fillStyle = '#8b8a86';
  g.fillRect(0, 0, W, H);
  // The sweep: a darker wedge running clockwise from twelve o'clock.
  g.fillStyle = '#56554f';
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy, W, -Math.PI / 2, -Math.PI / 2 + f * TAU);
  g.closePath();
  g.fill();
  g.strokeStyle = '#efede6';
  g.lineWidth = Math.max(2, H * 0.012);
  g.beginPath(); g.moveTo(0, cy); g.lineTo(W, cy); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke();
  for (const r of [0.34, 0.42]) { g.beginPath(); g.arc(cx, cy, H * r, 0, TAU); g.stroke(); }
  g.fillStyle = '#0d0d0c';
  g.font = `700 ${Math.round(H * 0.5)}px Bahnschrift, 'DIN Condensed', 'Arial Narrow', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), cx, cy + H * 0.02);
}

function drawEnd(g, W, H) {
  g.fillStyle = '#050505';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#eae5d8';
  g.font = `italic 400 ${Math.round(H * 0.2)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('The End', W / 2, H / 2);
}

function drawCard(c, name, color, score, locked, local) {
  const { g, tex } = c;
  const W = 320;
  const H = 104;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,8,10,0.86)';
  g.fillRect(0, 0, W, H);
  g.fillStyle = color;
  g.fillRect(0, 0, 10, H);
  g.fillStyle = locked ? '#f3ead6' : '#3a3836';
  g.beginPath(); g.arc(W - 22, 22, 9, 0, TAU); g.fill();
  g.fillStyle = '#f3ead6';
  g.font = `700 34px Bahnschrift, 'DIN Condensed', 'Arial Narrow', sans-serif`;
  g.textBaseline = 'top';
  const label = local && String(name).toUpperCase() !== 'YOU' ? `${name} · YOU` : name;
  g.fillText(String(label).slice(0, 16), 22, 12);
  g.fillStyle = '#b9b2a4';
  g.font = `600 30px ui-monospace, 'Cascadia Mono', Consolas, monospace`;
  g.fillText(`$${(score / 1000).toFixed(2)}M`, 22, 58);
  tex.needsUpdate = true;
}

export class CinemaStage {
  constructor(renderer, container) {
    this.renderer = renderer;
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07060a);
    this.scene.fog = new THREE.Fog(0x07060a, 22, 46);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 120);
    // From the back stalls: the screen fills the space between the top bar and the
    // marquee; the players stand at the front, below the picture.
    this.camPos = new THREE.Vector3(0, 5.4, 7.5);
    this.camWant = this.camPos.clone();
    this.lookY = 6.5; // lower on a tall phone, so the screen sits higher, above the booth
    this.look = new THREE.Vector3(0, this.lookY, SCREEN_Z);
    this.lookWant = this.look.clone();
    this.camera.position.copy(this.camPos);
    this.t = 0;
    this.mode = 'dark'; // dark | leader | film | end
    this.leaderT = 0;
    this.figs = new Map();
    this.textures = new Map(); // video -> VideoTexture
    this._build();
    this.resize();
  }

  _build() {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0x3a2f33, 0.85));
    // The screen lights the room a little; wall sconces do the rest.
    this.screenLight = new THREE.SpotLight(0xcfd8ff, 60, 40, 0.9, 0.8, 1.6);
    this.screenLight.position.set(0, SCREEN_Y, SCREEN_Z + 0.5);
    this.screenLight.target.position.set(0, 0, 6);
    s.add(this.screenLight, this.screenLight.target);

    const black = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
    const wall = new THREE.MeshStandardMaterial({ color: 0x1b1418, roughness: 0.95 });
    // Floor: a dark cinema carpet.
    const carpet = canvasTexture(256, 256, (g, W, H) => {
      g.fillStyle = '#1f0d12';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(176,128,72,0.16)';
      g.lineWidth = 3;
      for (let y = -32; y < H + 32; y += 64) {
        for (let x = -32; x < W + 32; x += 64) {
          g.beginPath(); g.arc(x, y, 22, 0, TAU); g.stroke();
          g.beginPath(); g.moveTo(x - 32, y + 32); g.lineTo(x + 32, y - 32); g.stroke();
        }
      }
    });
    carpet.wrapS = THREE.RepeatWrapping;
    carpet.wrapT = THREE.RepeatWrapping;
    carpet.repeat.set(10, 10);
    const floor = add(s, new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }), 0, 0, 0);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    // Walls and the proscenium.
    add(s, new THREE.PlaneGeometry(60, 26), wall, 0, 13, SCREEN_Z - 0.6);
    for (const side of [-1, 1]) {
      const w = add(s, new THREE.PlaneGeometry(40, 26), wall, side * 13, 13, 2);
      w.rotation.y = -side * Math.PI / 2;
    }
    add(s, new THREE.BoxGeometry(SCREEN_W + 3.2, SCREEN_H + 2.6, 0.3), black, 0, SCREEN_Y, SCREEN_Z - 0.25);
    // Velvet curtains at the sides of the screen.
    const velvet = canvasTexture(256, 64, (g, W, H) => {
      const grad = g.createLinearGradient(0, 0, W, 0);
      for (let i = 0; i <= 16; i++) grad.addColorStop(i / 16, i % 2 ? '#3a0a10' : '#7a1820');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    });
    const curtainMat = new THREE.MeshStandardMaterial({ map: velvet, roughness: 0.85, emissive: 0x2a0609, emissiveIntensity: 0.6 });
    for (const side of [-1, 1]) {
      const warm = new THREE.SpotLight(0xffb070, 45, 18, 0.5, 0.7, 1.4);
      warm.position.set(side * (SCREEN_W / 2 + 1), 1.4, SCREEN_Z + 4);
      warm.target.position.set(side * (SCREEN_W / 2 + 2.4), 8, SCREEN_Z);
      s.add(warm, warm.target);
    }
    for (const side of [-1, 1]) add(s, new THREE.BoxGeometry(2.6, 15, 0.4), curtainMat, side * (SCREEN_W / 2 + 2.4), 7.5, SCREEN_Z + 0.2);
    add(s, new THREE.BoxGeometry(SCREEN_W + 8, 1.6, 0.5), curtainMat, 0, SCREEN_Y + SCREEN_H / 2 + 1.7, SCREEN_Z + 0.25);
    // Stage apron under the screen.
    add(s, new THREE.BoxGeometry(SCREEN_W + 6, 1.1, 3), new THREE.MeshStandardMaterial({ color: 0x120c0e, roughness: 0.8 }), 0, 0.55, SCREEN_Z + 1.3);
    // Sconces: small warm practicals along the walls.
    for (const side of [-1, 1]) {
      for (const z of [-9, -3]) {
        add(s, new THREE.BoxGeometry(0.25, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0xffc27a }), side * 12.8, 5.5, z);
        const l = new THREE.PointLight(0xffa860, 4, 7, 1.8);
        l.position.set(side * 12, 5.5, z);
        s.add(l);
      }
    }

    // The screen and its shader.
    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blank.needsUpdate = true;
    this.leaderCanvas = document.createElement('canvas');
    this.leaderCanvas.width = 512;
    this.leaderCanvas.height = 288;
    this.leaderTex = new THREE.CanvasTexture(this.leaderCanvas);
    this.endTex = canvasTexture(1024, 576, drawEnd);
    this.uniforms = {
      uTex: { value: this.blank }, uDecoy: { value: this.blank }, uDecoyMix: { value: 0 },
      uFault: { value: 0 }, uClear: { value: 1 }, uTime: { value: 0 }, uFocus: { value: 0 }, uBurn: { value: 0 },
      uSplice: { value: 0 }, uCue: { value: 0 }, uStatic: { value: 0 }, uTexAspect: { value: 16 / 9 }, uDecoyAspect: { value: 16 / 9 },
      uScreenAspect: { value: SCREEN_W / SCREEN_H }, uFilm: { value: 0 }, uBurnAt: { value: new THREE.Vector2(0.5, 0.5) }, uIris: { value: new THREE.Vector2(0.5, 0.5) },
    };
    this.screenMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, toneMapped: false });
    this.screen = add(s, new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.screenMat, 0, SCREEN_Y, SCREEN_Z);

    // The beam from the booth: a faint cone with dust drifting in it.
    const dust = canvasTexture(128, 256, (g, W, H) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 140; i++) {
        g.fillStyle = `rgba(255,240,215,${0.15 + Math.random() * 0.5})`;
        g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
      }
    });
    dust.wrapS = THREE.RepeatWrapping;
    dust.wrapT = THREE.RepeatWrapping;
    this.dust = dust;
    const booth = new THREE.Vector3(0, 11.2, 22);
    const beamLen = booth.distanceTo(new THREE.Vector3(0, SCREEN_Y, SCREEN_Z));
    const beamGeo = new THREE.ConeGeometry(SCREEN_W * 0.56, beamLen, 4, 1, true);
    beamGeo.rotateY(Math.PI / 4);
    beamGeo.translate(0, -beamLen / 2, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ map: dust, color: 0xfff1dc, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.copy(booth);
    this.beam.lookAt(0, SCREEN_Y, SCREEN_Z);
    this.beam.rotateX(-Math.PI / 2);
    this.beam.scale.set(1, 1, SCREEN_H / SCREEN_W / 0.56 * 0.5);
    s.add(this.beam);

    // Rows of seats, raked up towards the booth.
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x5a161d, roughness: 0.9 });
    const armMat = new THREE.MeshStandardMaterial({ color: 0x16100f, roughness: 0.7 });
    const rows = 6;
    const per = 14;
    const cushion = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.42, 0.8), seatMat, rows * per);
    const back = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.05, 0.2), seatMat, rows * per);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.7, 0.85), armMat, rows * per);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const z = -3.5 + r * 2.2;
      const y = r * 0.45;
      if (r > 0) add(s, new THREE.BoxGeometry(20, 0.45, 2.2), new THREE.MeshStandardMaterial({ color: 0x170a0e, roughness: 1 }), 0, y - 0.225, z);
      for (let c = 0; c < per; c++) {
        const x = (c - (per - 1) / 2) * 1.12 + (c >= per / 2 ? 0.9 : -0.9) * 0.5;
        m.makeTranslation(x, y + 0.5, z);
        cushion.setMatrixAt(i, m);
        m.makeTranslation(x, y + 1.1, z + 0.42);
        back.setMatrixAt(i, m);
        m.makeTranslation(x - 0.52, y + 0.6, z);
        arms.setMatrixAt(i, m);
        i++;
      }
    }
    for (const mesh of [cushion, back, arms]) { mesh.castShadow = false; mesh.receiveShadow = true; s.add(mesh); }
  }

  // ---------- the players ----------
  setPlayers(list, localId) {
    for (const f of this.figs.values()) { this.scene.remove(f.group); disposeTree(f.group); }
    this.figs.clear();
    const n = list.length;
    list.forEach((p, i) => {
      const x = (i - (n - 1) / 2) * 2.2;
      const z = -5 - (i % 2) * 0.4;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      this.scene.add(group);
      const fig = new Figure({ id: p.id, name: p.name, color: p.color, local: p.id === localId });
      fig.place(0, 0, 0);
      fig.face(Math.PI);
      group.add(fig.group);
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 104;
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(2.3, 0.75, 1);
      sprite.position.set(0, 2.7, 0);
      sprite.renderOrder = 5;
      sprite.visible = false;
      group.add(sprite);
      const card = { g: canvas.getContext('2d'), tex, key: '' };
      const f = { id: p.id, name: p.name, color: p.color, local: p.id === localId, group, fig, card, sprite };
      this.figs.set(p.id, f);
      this._card(f, 0, false);
    });
  }

  _card(f, score, locked) {
    const key = `${score}|${locked}`;
    if (f.card.key === key) return;
    f.card.key = key;
    drawCard(f.card, f.name, f.color, score, locked, f.local);
  }

  setScores(list) {
    for (const p of list) {
      const f = this.figs.get(p.id);
      if (f) this._card(f, p.score, p.locked);
    }
  }

  // ---------- the show ----------
  cue({ fault }) {
    this.mode = 'leader';
    for (const x of this.figs.values()) x.sprite.visible = false;
    this.leaderT = 0;
    this.uniforms.uFault.value = FAULT_ID[fault] ?? 0;
    this.uniforms.uClear.value = fault === 'PREMIERE' ? 1 : 0;
    this.camWant.set(0, 5.4, 7.5);
    this.lookWant.set(0, this.lookY, SCREEN_Z);
  }

  play() { this.mode = 'film'; }

  // Called every frame by the screen with what to show.
  frame({ video = null, aspect = 16 / 9, decoy = null, decoyAspect = 16 / 9, decoyMix = 0, clear = 0, focus = 0, burn = 0, cue = 0, splice = 0, fault = null } = {}) {
    const u = this.uniforms;
    if (fault != null) u.uFault.value = FAULT_ID[fault] ?? 0;
    if (this.mode === 'film') {
      u.uTex.value = video ? this._videoTex(video) : this.blank;
      u.uStatic.value = video ? 0 : 0.55;
    }
    u.uTexAspect.value = aspect;
    u.uDecoy.value = decoy ? this._videoTex(decoy) : this.blank;
    u.uDecoyAspect.value = decoyAspect;
    u.uDecoyMix.value = decoy ? decoyMix : 0;
    u.uClear.value = clear;
    u.uFocus.value = focus;
    u.uBurn.value = burn;
    u.uCue.value = cue;
    u.uSplice.value = splice;
  }

  _videoTex(video) {
    let t = this.textures.get(video);
    if (!t) {
      t = new THREE.VideoTexture(video);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      this.textures.set(video, t);
    }
    return t;
  }

  reveal() { this.mode = 'film'; }

  react(id, ok) {
    const f = this.figs.get(id);
    if (!f) return;
    if (ok) f.fig.cheer(2.2); else f.fig.rock();
  }

  sabotage(from, to) {
    const f = this.figs.get(to);
    if (f) f.fig.rock();
    this.burnAt = { x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 };
    this.uniforms.uBurnAt.value.set(this.burnAt.x, this.burnAt.y);
  }

  podium(id) {
    this.mode = 'end';
    this.uniforms.uTex.value = this.endTex;
    this.uniforms.uTexAspect.value = 16 / 9;
    this.uniforms.uFault.value = 0;
    this.uniforms.uClear.value = 1;
    this.uniforms.uStatic.value = 0;
    for (const x of this.figs.values()) x.sprite.visible = true;
    const f = this.figs.get(id);
    if (f) { f.fig.cheer(6); this.lookWant.set(f.group.position.x, 3, f.group.position.z); this.camWant.set(f.group.position.x * 0.6, 5.2, 4.5); }
  }

  // ---------- frame ----------
  update(dt, reduce) {
    this.t += dt;
    const u = this.uniforms;
    u.uTime.value = this.t;
    if (this.mode === 'leader') {
      this.leaderT += dt;
      drawLeader(this.leaderCanvas.getContext('2d'), this.leaderCanvas.width, this.leaderCanvas.height, this.leaderT);
      this.leaderTex.needsUpdate = true;
      u.uTex.value = this.leaderTex;
      u.uTexAspect.value = 16 / 9;
      u.uStatic.value = 0;
    }
    const film = this.mode === 'film' || this.mode === 'leader';
    u.uFilm.value = damp(u.uFilm.value, film ? 1 : 0.4, 4, dt);
    // The iris wanders.
    u.uIris.value.set(0.5 + Math.sin(this.t * 0.37) * 0.28, 0.5 + Math.sin(this.t * 0.53 + 1) * 0.22);
    this.beamMat.opacity = damp(this.beamMat.opacity, film ? 0.075 : 0.015, 3, dt);
    if (!reduce) { this.dust.offset.y -= dt * 0.02; this.dust.offset.x += dt * 0.006; }
    for (const f of this.figs.values()) f.fig.update(dt, this.t, { still: reduce });
    const sway = reduce ? 0 : Math.sin(this.t * 0.17) * 0.25;
    this.camPos.lerp(new THREE.Vector3(this.camWant.x + sway, this.camWant.y, this.camWant.z), 1 - Math.exp(-2 * dt));
    this.look.lerp(this.lookWant, 1 - Math.exp(-2.5 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A tall phone sees the screen from closer, so it still fills the width.
    this.camera.fov = clamp(42 / Math.min(1, this.camera.aspect / 1.2), 42, 78);
    this.camera.updateProjectionMatrix();
    // On a tall screen the marquee and booth take the lower half: look lower, so the
    // picture rides up into the space under the top bar.
    this.lookY = 6.5 - clamp((1.2 - this.camera.aspect) / 0.75, 0, 1) * 4.4;
    if (this.mode !== 'end') { this.lookWant.y = this.lookY; }
  }

  dispose() {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    for (const f of this.figs.values()) f.fig.dispose && f.fig.dispose();
    disposeTree(this.scene);
  }
}
