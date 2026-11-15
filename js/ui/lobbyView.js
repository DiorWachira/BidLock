// BIDLOCK 2.0 — the multiplayer lobby dialog: name, create or join, the table, start.

import { EggcrateDisplay } from './eggcrate.js';
import { cleanName, normalizeCode, MAX_PLAYERS } from '../net/lobbyManager.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class LobbyView {
  // colorsFor(seats) -> css colours; summary() -> one line describing the host's settings.
  constructor({ lobby, loadName, saveName, colorsFor, summary, onStart, onOpen, onClose, toast }) {
    this.lobby = lobby;
    this.saveName = saveName;
    this.colorsFor = colorsFor;
    this.summary = summary;
    this.onStart = onStart;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.toast = toast;
    this.isOpen = false;
    this.busy = false;
    this.el = {
      root: $('#lobby'), scrim: $('#lobby-scrim'), name: $('#lobby-name'), code: $('#lobby-code'),
      menu: $('#lobby-menu'), room: $('#lobby-room'), players: $('#lobby-players'), fill: $('#lobby-fill'), fillWrap: $('#lobby-fill-wrap'),
      summary: $('#lobby-summary'), status: $('#lobby-status'), start: $('#lobby-start'), startLabel: $('#lobby-start .b-label'),
      create: $('#lobby-create'), join: $('#lobby-join'), copy: $('#lobby-copy'), leave: $('#lobby-leave'), close: $('#lobby-close'),
    };
    this.codeLamp = new EggcrateDisplay($('#ec-room'), { cols: 6, cell: 7, align: 'left', label: 'Room code' });
    this.el.name.value = loadName() || '';

    this.el.close.addEventListener('click', () => this.close());
    this.el.scrim.addEventListener('click', () => this.close());
    this.el.create.addEventListener('click', () => this._create());
    this.el.join.addEventListener('click', () => this._join());
    this.el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._join(); } });
    this.el.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    this.el.name.addEventListener('change', () => this.saveName(this.el.name.value.trim()));
    this.el.fill.addEventListener('change', () => this.lobby.setFillBots(this.el.fill.checked));
    this.el.copy.addEventListener('click', () => this._copy());
    this.el.leave.addEventListener('click', () => { this.lobby.leave(); this.status(''); });
    this.el.start.addEventListener('click', () => { if (this.lobby.canStart()) this.onStart(); });
    this.el.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      if (e.key !== 'Tab') { e.stopPropagation(); return; }
      const f = [...this.el.root.querySelectorAll('button, input')].filter((x) => !x.disabled && x.getClientRects().length);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  open(prefillCode = '') {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocus = document.activeElement;
    this.el.root.hidden = false;
    this.el.scrim.hidden = false;
    if (prefillCode) this.el.code.value = prefillCode;
    this.render(this.lobby.state);
    requestAnimationFrame(() => {
      this.el.root.classList.add('on');
      (this.el.name.value ? (prefillCode ? this.el.join : this.el.create) : this.el.name).focus();
    });
    this.onOpen();
  }

  // Closing the dialog does not leave the room: the room chip in the top bar reopens it.
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.root.classList.remove('on');
    this.el.root.hidden = true;
    this.el.scrim.hidden = true;
    this.onClose();
    if (this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus({ preventScroll: true });
  }

  status(text, bad = false) {
    this.el.status.textContent = text;
    this.el.status.dataset.bad = bad ? '1' : '0';
  }

  _name() {
    const raw = this.el.name.value.trim();
    if (!raw) { this.status('Enter a display name first.', true); this.el.name.focus(); return null; }
    this.saveName(raw);
    return cleanName(raw);
  }

  async _create() {
    if (this.busy) return;
    const name = this._name();
    if (!name) return;
    this.busy = true;
    this.status('Opening a room…');
    try {
      const code = await this.lobby.create(name);
      this.status(`Room ${code} is open. Send the code to your friends.`);
    } catch (err) {
      this.status(err.message || 'Could not open a room.', true);
    } finally {
      this.busy = false;
      this.render(this.lobby.state);
    }
  }

  async _join() {
    if (this.busy) return;
    const name = this._name();
    if (!name) return;
    const code = normalizeCode(this.el.code.value);
    if (!code) { this.status('Room codes look like BL-7K9.', true); this.el.code.focus(); return; }
    this.busy = true;
    this.status(`Joining ${code}…`);
    try {
      await this.lobby.join(name, code);
      this.status(`You are in room ${code}. Waiting for the host to start.`);
    } catch (err) {
      this.status(err.message || 'Could not join that room.', true);
    } finally {
      this.busy = false;
      this.render(this.lobby.state);
    }
  }

  async _copy() {
    const code = this.lobby.state.code;
    if (!code) return;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(code); ok = true; }
    } catch { ok = false; }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    this.toast(ok ? `Copied ${code}. Send it to your friends.` : `Could not reach the clipboard. The code is ${code}.`);
  }

  render(state) {
    const el = this.el;
    const inRoom = state.status === 'open' && state.role != null;
    el.menu.hidden = inRoom;
    el.room.hidden = !inRoom;
    el.name.disabled = inRoom || state.status === 'connecting';
    el.create.disabled = this.busy || state.status === 'connecting';
    el.join.disabled = this.busy || state.status === 'connecting';
    if (!inRoom) {
      if (state.status === 'error' && state.error) this.status(state.error, true);
      return;
    }
    const host = state.role === 'host';
    this.codeLamp.set(state.code);
    const seats = host ? this.lobby.seats() : [
      ...state.players.filter((p) => !p.away).map((p) => ({ name: p.name, kind: 'human', pid: p.pid })),
    ];
    const colors = this.colorsFor(seats);
    const rows = seats.map((s, i) => {
      const p = state.players.find((x) => x.pid === s.pid);
      const tags = [];
      if (p && p.host) tags.push('HOST');
      if (p && p.pid === state.you) tags.push('YOU');
      if (s.kind === 'ai') tags.push('BOT');
      return `<li style="--who:${colors[i]}"><span class="lp-seat">${i + 1}</span><b>${esc(s.name)}</b>${tags.map((t) => `<span class="lp-tag">${t}</span>`).join('')}</li>`;
    });
    if (!host && state.fillBots && seats.length < 4) rows.push('<li class="lp-note">The host has bots filling the empty seats.</li>');
    for (let i = seats.length; i < Math.min(MAX_PLAYERS, Math.max(seats.length + 1, 2)); i++) rows.push(`<li class="lp-open"><span class="lp-seat">${i + 1}</span>Open seat</li>`);
    el.players.innerHTML = rows.join('');
    el.fillWrap.hidden = !host;
    el.fill.checked = state.fillBots;
    el.summary.textContent = host ? this.summary() : 'The host chooses the bankroll and mode.';
    el.start.hidden = !host;
    el.start.disabled = !host || !this.lobby.canStart() || state.inMatch;
    el.startLabel.textContent = seats.length < 2 ? 'NEED 2 AT THE TABLE' : `START MATCH · ${seats.length} AT THE TABLE`;
    el.copy.hidden = false;
  }
}
