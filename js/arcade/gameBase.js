// What the quiz games have in common: running the engine in step (or mirroring it as a
// guest), sending and receiving over the room, a Three.js renderer, and the results card.
// The shell (main.js) hands each game: a root element, the sound engine, and a few
// callbacks. A game never talks to the lobby directly.

import * as THREE from 'three';
import { WIRE } from '../net/lobbyManager.js';
import { gameById } from './games.js';

const STEP = 1 / 60;
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

export class GameBase {
  constructor(shell, id, Engine) {
    this.shell = shell;
    this.id = id;
    this.info = gameById(id);
    this.engine = new Engine();
    this.role = 'solo';
    this.localSeat = 0;
    this.seats = [];
    this.colors = [];
    this.acc = 0;
    this.tickAcc = 0;
    this.stopped = false;
    this.renderer = null;
    this.engine.on('*', (type, d) => {
      if (this.role === 'host') shell.broadcast({ t: WIRE.GAME_EVENT, ev: type, d, s: this.engine.serialize() });
      if (this.stopped) return;
      try { this.onEvent(type, d); } catch (err) { console.error(`[${this.id}] event ${type} failed:`, err); }
    });
  }

  $(sel) { return this.shell.root.querySelector(sel); }

  // Solo and host start the real match; a guest waits for the host's first snapshot.
  begin({ role, seats, localSeat = 0, seed }) {
    this.role = role;
    this.localSeat = localSeat;
    this.seats = seats || [];
    if (role === 'client') return;
    this.colors = this.shell.colors(this.seats);
    this.engine.startMatch({ seats: this.seats, seed, localId: 0 });
    if (!this.shell.debug.triviaLocal) this.engine.quiz.load().catch(() => 0);
  }

  get me() { return this.engine.players[this.engine.localId] || null; }
  nameOf(id) { return id === this.engine.localId ? 'You' : this.engine.players[id].name; }

  // Colours are worked out from the table the first time a snapshot or start arrives.
  ensureColors() {
    if (this.colors.length === this.engine.players.length) return;
    this.colors = this.shell.colors(this.engine.players.map((p) => ({ kind: p.isHuman ? 'human' : 'ai' })));
  }

  // ---------- time ----------
  advance(dt) {
    if (this.stopped || this.isOver()) return;
    const e = this.engine;
    if (this.role === 'client') {
      if (this.shell.debug.auto) this.autopilot();
      e.update(dt);
      return;
    }
    this.acc += dt * this.shell.debug.speed * this.speedBoost();
    let n = 0;
    while (this.acc >= STEP && n < 90) {
      if (this.shell.debug.auto) this.autopilot();
      e.update(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 90) this.acc = 0;
    if (this.role === 'host') {
      this.tickAcc += dt;
      if (this.tickAcc >= 0.25) {
        this.tickAcc = 0;
        this.shell.broadcast({ t: WIRE.GAME_TICK, ...this.tickData() });
      }
    }
  }

  tickData() { return { c: this.engine.t }; }
  applyTick(msg) { this.engine.t = msg.c; }

  // ---------- the room ----------
  fromHost(msg) {
    if (this.stopped) return;
    if (msg.t === WIRE.GAME_TICK) { if (this.engine.mirror) this.applyTick(msg); return; }
    if (msg.t !== WIRE.GAME_EVENT || !msg.s) return;
    this.engine.hydrate(msg.s, this.localSeat);
    this.engine.emit(msg.ev, msg.d || {});
  }

  fromPlayer(seat, msg) {
    if (this.stopped || !this.engine.players[seat]) return;
    if (msg.t === WIRE.BYE) { this.engine.setAway(seat, true); return; }
    if (msg.t === WIRE.GAME_INPUT && typeof msg.a === 'string') this.apply(seat, msg.a, msg);
  }

  // The local player does something. A guest sends it; everyone else applies it.
  send(action, payload = {}) {
    if (this.role === 'client') { this.shell.send({ t: WIRE.GAME_INPUT, a: action, ...payload }); return true; }
    return this.apply(this.engine.localId, action, payload);
  }

  // ---------- 3D ----------
  makeRenderer(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.prepend(renderer.domElement);
    this.renderer = renderer;
    return renderer;
  }

  // A results row name: "PIXEL", or "SAM (you)", never "YOU (you)".
  rowName(p) {
    if (p.id !== this.engine.localId) return p.name;
    return String(p.name).toUpperCase() === 'YOU' ? 'YOU' : `${p.name} (you)`;
  }

  // ---------- the results card ----------
  resultsHtml({ title, sub, rows }) {
    const client = this.role === 'client';
    const exit = this.role === 'host' ? 'BACK TO LOBBY' : client ? 'LEAVE ROOM' : 'BACK TO TITLE';
    return `
      <p class="lbl">${esc(this.info.name.toUpperCase())} · FINAL STANDINGS</p>
      <h2>${esc(title)}</h2>
      <p class="ag-sub">${esc(sub)}</p>
      <ol class="ag-rank">${rows.map((r, i) => `<li data-me="${r.me ? 1 : 0}" style="--who:${r.color}"><span class="ag-place">${PLACES[i] || i + 1}</span><b>${esc(r.name)}</b><span class="ag-note">${esc(r.note || '')}</span></li>`).join('')}</ol>
      <div class="ag-actions">
        ${client ? '<p class="ag-wait">Waiting for the host to choose what is next.</p>' : '<button type="button" class="btn btn-live" data-ag="again"><span class="b-label">PLAY AGAIN</span><kbd>Enter</kbd></button>'}
        <button type="button" class="btn btn-quiet" data-ag="exit"><span class="b-label">${exit}</span></button>
      </div>`;
  }

  wireCard(card) {
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ag]');
      if (!b) return;
      if (b.dataset.ag === 'again') this.shell.again();
      else if (b.dataset.ag === 'exit') this.shell.exit();
    });
  }

  howHtml() {
    return `
      <p class="lbl">CH 20 · ${esc(this.info.slot)} · ${esc(this.info.kind.toUpperCase())}</p>
      <h2>${esc(this.info.name)}</h2>
      <p class="ag-sub">${esc(this.info.strap)}</p>
      <ol class="ag-how">${this.info.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
      <p class="ag-wait">Starting…</p>`;
  }

  stop() {
    this.stopped = true;
    if (this.ro) this.ro.disconnect();
    if (this.stage && this.stage.dispose) this.stage.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      try { this.renderer.forceContextLoss(); } catch { /* already gone */ }
      this.renderer.domElement.remove();
    }
    this.shell.root.innerHTML = '';
  }

  // Subclasses provide: onEvent(type, data), apply(seat, action, payload), isOver(),
  // autopilot(), frame(dt), key(e), keyup(e).
  onEvent() {}
  apply() { return false; }
  isOver() { return false; }
  autopilot() {}
  speedBoost() { return 1; }
  key() { return false; }
  keyup() {}
}
