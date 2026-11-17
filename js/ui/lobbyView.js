// BIDLOCK 2.0 — the multiplayer lobby dialog: name, create or join, the table, start.

import { EggcrateDisplay } from './eggcrate.js';
import { cleanName, normalizeCode, MAX_PLAYERS } from '../net/lobbyManager.js';
import { GAMES, gameById } from '../arcade/games.js';
import { GENRE_CHOICES, genreById, LEVELS, levelById } from '../games/sampleArena/itunesLoader.js';
import { checkConnection, explain, summary } from '../net/netCheck.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class LobbyView {
  // colorsFor(seats) -> css colours; summary() -> one line describing the host's settings.
  constructor({ lobby, loadName, saveName, colorsFor, summary, onStart, onOpen, onClose, toast, defaultGame = () => 'bidlock', genre = () => 'all', onGenre = () => {}, level = () => 'normal', onLevel = () => {} }) {
    this.defaultGame = defaultGame;
    this.genre = genre;
    this.level = level;
    this.onLevel = onLevel;
    this.onGenre = onGenre;
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
      summary: $('#lobby-summary'), games: $('#lobby-games'), crates: $('#lobby-crates'), status: $('#lobby-status'), start: $('#lobby-start'), startLabel: $('#lobby-start .b-label'),
      create: $('#lobby-create'), join: $('#lobby-join'), checkBtn: $('#lobby-check-btn'), check: $('#lobby-check'), copy: $('#lobby-copy'), leave: $('#lobby-leave'), close: $('#lobby-close'),
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
    // The host picks the game; everyone can vote for one.
    this.el.games.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-game]');
      if (!b) return;
      if (this.lobby.isHost) { this.lobby.setGame(b.dataset.game); this.lobby.vote(b.dataset.game); }
      else this.lobby.vote(b.dataset.game);
    });
    // Soundclash: the host picks the crate.
    this.el.crates.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-genre]');
      if (b && this.lobby.isHost) this.onGenre(b.dataset.genre);
      const l = e.target.closest('button[data-level]');
      if (l && this.lobby.isHost) this.onLevel(l.dataset.level);
    });
    this.el.checkBtn.addEventListener('click', () => this.runCheck());
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
    this.lobby.warm();
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

  // "Check my connection": the room server, WebRTC, STUN and the relay, in plain words.
  async runCheck() {
    if (this.checking) return;
    this.checking = true;
    const el = this.el.check;
    this.el.checkBtn.disabled = true;
    el.hidden = false;
    el.dataset.verdict = '';
    el.innerHTML = '<p class="lbl">YOUR CONNECTION</p><p class="lc-wait">Checking: the room server, this browser and this network…</p>';
    try {
      const r = await checkConnection();
      const x = explain(r);
      console.info(summary(r));
      el.dataset.verdict = x.verdict;
      const head = { ok: 'READY FOR ROOMS', warn: 'PROBABLY FINE', relay: 'NEEDS A RELAY ON THIS NETWORK', bad: 'BLOCKED HERE' }[x.verdict];
      el.innerHTML = `<p class="lbl">YOUR CONNECTION · ${head}</p><ul>${x.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${x.fix ? `<p class="lc-fix">${esc(x.fix)}</p>` : ''}`;
    } catch (err) {
      el.innerHTML = `<p class="lbl">YOUR CONNECTION</p><p class="lc-fix">The check could not run (${esc(err && err.message ? err.message : 'unknown')}).</p>`;
    } finally {
      this.checking = false;
      this.el.checkBtn.disabled = false;
    }
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
      this.lobby.setGame(this.defaultGame());
      this.status(`Room ${code} is open. Send the code to your friends, then come back here: friends can only get in while BidLock is open on your screen.`);
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
      await this.lobby.join(name, code, {
        onProgress: (n, of, why) => this.status(why === 'no-room'
          ? `Room ${code} is not answering yet (try ${n} of ${of}). If the host is sending the code from their phone, they need to come back to BidLock.`
          : `Still connecting to ${code} (try ${n} of ${of})…`),
      });
      this.status(`You are in room ${code}. Waiting for the host to start.`);
    } catch (err) {
      this.status(err.message || 'Could not join that room.', true);
      // Work out why, so the player (or whoever helps them) can see it.
      if (this.lobby.kind !== 'local') this.runCheck();
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
    const mineVote = state.votes ? state.votes[host ? 'host' : state.you] : null;
    this.el.games.innerHTML = GAMES.map((g) => {
      const n = Object.values(state.votes || {}).filter((x) => x === g.id).length;
      const on = state.game === g.id;
      return `<button type="button" class="lg-game" data-game="${g.id}" aria-pressed="${on}" ${state.inMatch ? 'disabled' : ''}>
        <span class="ch-slot">${esc(g.slot)}</span><b>${esc(g.name)}</b><span class="ch-kind">${esc(g.kind)}</span>
        <span class="lg-votes">${n ? `${n} vote${n === 1 ? '' : 's'}` : ''}${mineVote === g.id ? ' · yours' : ''}</span>
        ${on ? '<span class="lg-on">NEXT UP</span>' : ''}</button>`;
    }).join('');
    this.el.games.dataset.host = host ? '1' : '0';
    const crate = genreById(state.genre || (host ? this.genre() : 'all')).id;
    const lvl = levelById(state.level || (host ? this.level() : 'normal')).id;
    this.el.crates.hidden = state.game !== 'soundclash';
    this.el.crates.innerHTML = state.game !== 'soundclash' ? '' : `<p class="lbl">SOUNDCLASH CRATE${host ? '' : ' · THE HOST PICKS'}</p>${GENRE_CHOICES.map((g) => `<button type="button" class="sc-crate" data-genre="${g.id}" aria-pressed="${g.id === crate}" ${host && !state.inMatch ? '' : 'disabled'}><span>${esc(g.short)}</span><b>${esc(g.name)}</b></button>`).join('')}<p class="lbl">DIFFICULTY</p><div class="sc-level-list">${LEVELS.map((l) => `<button type="button" class="sc-level" data-level="${l.id}" aria-pressed="${l.id === lvl}" ${host && !state.inMatch ? '' : 'disabled'}><b>${esc(l.name)}</b><span>${esc(l.line)}</span></button>`).join('')}</div>`;
    const seats = host ? this.lobby.seats() : [
      ...state.players.filter((p) => !p.away).map((p) => ({ name: p.name, kind: 'human', pid: p.pid })),
    ];
    const fillTo = gameById(state.game).fillTo;
    const colors = this.colorsFor(seats);
    const rows = seats.map((s, i) => {
      const p = state.players.find((x) => x.pid === s.pid);
      const tags = [];
      if (p && p.host) tags.push('HOST');
      if (p && p.pid === state.you) tags.push('YOU');
      if (s.kind === 'ai') tags.push('BOT');
      const ms = p && !p.host ? this.lobby.latencyMs(p.pid) : null;
      const link = ms == null ? '' : `<span class="lp-link" data-q="${ms < 120 ? 'good' : ms < 250 ? 'ok' : 'slow'}" title="Round trip to the host">${ms} ms</span>`;
      return `<li style="--who:${colors[i]}"><span class="lp-seat">${i + 1}</span><b>${esc(s.name)}</b>${tags.map((t) => `<span class="lp-tag">${t}</span>`).join('')}${link}</li>`;
    });
    if (!host && state.fillBots && seats.length < fillTo) rows.push(`<li class="lp-note">Bots fill the rest of the table, up to ${fillTo}.</li>`);
    for (let i = seats.length; i < Math.min(MAX_PLAYERS, Math.max(seats.length + 1, 2)); i++) rows.push(`<li class="lp-open"><span class="lp-seat">${i + 1}</span>Open seat</li>`);
    el.players.innerHTML = rows.join('');
    el.fillWrap.hidden = !host;
    el.fill.checked = state.fillBots;
    el.summary.textContent = host ? this.summary() : `${gameById(state.game).name} is next. Tap a game to vote; the host decides.`;
    el.start.hidden = !host;
    el.start.disabled = !host || !this.lobby.canStart() || state.inMatch;
    el.startLabel.textContent = seats.length < 2 ? 'NEED 2 AT THE TABLE' : `START MATCH · ${seats.length} AT THE TABLE`;
    el.copy.hidden = false;
  }
}
