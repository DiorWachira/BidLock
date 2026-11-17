// SOUNDCLASH — the screen: the club in 3D, the HUD (round, warp badge, clock), the four
// answer buttons, the sabotage dock, the reveal card and the podium. Rules live in
// sampleArenaEngine.js, sound in sampleAudioFX.js, the club in sampleArena3d.js, and the
// crate in itunesLoader.js.

import { SampleArenaEngine, S_PHASE, S_RULES, SABOTAGES, SABOTAGE_ORDER, speedPoints, streakMult } from './sampleArenaEngine.js';
import { SampleDeck, WARPS } from './sampleAudioFX.js';
import { SampleStage } from './sampleArena3d.js';
import { loadMatch, genreById, levelById } from './itunesLoader.js';
import { GameBase, esc } from '../../arcade/gameBase.js';
import { mulberry32 } from '../../engine/auctionEngine.js';

const TIER_LABEL = { 0: 'NO SIGNAL', 1: 'WEB AUDIO', 2: 'STREAM', 3: 'SYNTH' };
const SAB_KEYS = { under: 'Z', scratch: 'X', shock: 'C' };
const OPEN = new Set([S_PHASE.REVEAL, S_PHASE.PODIUM]);
const FIRST_RECORD_WAIT = 9000; // ms: the longest the start waits for round 1's preview

export class SampleArenaGame extends GameBase {
  constructor(shell) {
    super(shell, 'soundclash', SampleArenaEngine);
    this.deck = new SampleDeck(shell.audio);
    this.myChoice = null;
    this.target = 'leader';
    this.built = false;
    this.fxShown = '';
    this.lastTick = 99;
    this.prefetched = false;
    const root = shell.root;
    root.innerHTML = `
      <div class="ag sc" data-game="soundclash">
        <div class="ag-view sc-view" id="sc-view"></div>
        <div class="sc-water" id="sc-water" aria-hidden="true"></div>
        <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
          <filter id="sc-ripple" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.026" numOctaves="2" seed="7" result="n">
              <animate attributeName="baseFrequency" dur="4s" values="0.008 0.026;0.011 0.03;0.008 0.026" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        <div class="ag-top">
          <p class="ag-chip" id="sc-title">SOUNDCLASH</p>
          <p class="ag-chip" id="sc-round"></p>
          <p class="ag-chip sc-warp" id="sc-warp" hidden></p>
          <p class="ag-chip sc-tier" id="sc-tier" hidden></p>
          <p class="ag-chip ag-left" id="sc-score"></p>
          <div class="sc-clock" id="sc-clock" aria-hidden="true"><i id="sc-bar"></i><b class="sc-ot" title="Overtime: the warp lifts" style="left:${((S_RULES.roundTime - S_RULES.warpTime) / S_RULES.roundTime * 100).toFixed(2)}%"></b></div>
        </div>
        <p class="sc-alert" id="sc-alert" role="alert" hidden></p>
        <aside class="sc-dock" id="sc-dock" aria-label="Sabotage: spend points to throw a dubplate at a rival">
          <p class="lbl">SABOTAGE · ONE THROW A ROUND</p>
          <div class="sc-targets" id="sc-targets" role="radiogroup" aria-label="Target"></div>
          <div class="sc-sabs" id="sc-sabs"></div>
        </aside>
        <section class="sc-deck" id="sc-q" aria-live="polite">
          <div class="sc-cardface" id="sc-face">
            <p class="lbl" id="sc-label">NAME THAT SONG</p>
            <div class="sc-answers" id="sc-answers" role="group" aria-label="Answers"></div>
          </div>
        </section>
        <section class="sc-reveal" id="sc-reveal" hidden></section>
        <p class="ag-toast" id="sc-note" role="status"></p>
        <p class="sc-credit" id="sc-credit" hidden>Previews courtesy of iTunes</p>
        <p class="ag-keys sc-keys">Answer: <kbd>1</kbd>–<kbd>4</kbd> · Sabotage: <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> · Next target: <kbd>T</kbd></p>
        <section class="ag-card" id="sc-card" hidden></section>
      </div>`;
    this.el = {
      view: this.$('#sc-view'), water: this.$('#sc-water'), round: this.$('#sc-round'), warp: this.$('#sc-warp'), tier: this.$('#sc-tier'),
      score: this.$('#sc-score'), clock: this.$('#sc-clock'), bar: this.$('#sc-bar'), alert: this.$('#sc-alert'), dock: this.$('#sc-dock'),
      targets: this.$('#sc-targets'), sabs: this.$('#sc-sabs'), q: this.$('#sc-q'), face: this.$('#sc-face'), label: this.$('#sc-label'),
      answers: this.$('#sc-answers'), reveal: this.$('#sc-reveal'), note: this.$('#sc-note'), credit: this.$('#sc-credit'), card: this.$('#sc-card'),
    };
    this.el.answers.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b && !b.disabled) this.pick(Number(b.dataset.i));
    });
    this.el.targets.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-to]');
      if (!b) return;
      this.target = b.dataset.to === 'leader' ? 'leader' : Number(b.dataset.to);
      this.shell.audio.blip();
      this.renderDock();
    });
    this.el.sabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sab]');
      if (b && !b.disabled) this.throw(b.dataset.sab);
    });
    this.wireCard(this.el.card);
    this.el.q.hidden = true;
    this.el.dock.hidden = true;

    try {
      const renderer = this.makeRenderer(this.el.view);
      this.stage = new SampleStage(renderer, this.el.view);
      this.ro = new ResizeObserver(() => this.stage.resize());
      this.ro.observe(this.el.view);
    } catch (err) {
      console.warn('[soundclash] no 3D club:', err);
      this.stage = null;
      this.el.view.innerHTML = '<div class="testcard on"><div class="tc-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="tc-plate"><strong>NO PICTURE</strong><span>No 3D club here, but the sound still plays. Answer with the buttons or 1 to 4.</span></div></div>';
    }
  }

  // ---------- the start: dig the crate, then drop the first record ----------
  begin({ role, seats, localSeat = 0, seed }) {
    this.role = role;
    this.localSeat = localSeat;
    this.seats = seats || [];
    if (role === 'client') { this.showCard(this.warmHtml('The host is digging through the crates…')); return; }
    this.colors = this.shell.colors(this.seats);
    const genre = genreById(this.shell.genre ? this.shell.genre() : 'all');
    const level = levelById(this.shell.level ? this.shell.level() : 'normal');
    this.showCard(this.warmHtml(`Digging through the crates: ${genre.name}, ${level.name.toLowerCase()}.`));
    const debug = this.shell.debug || {};
    loadMatch({ genre: genre.id, level: level.id, rng: mulberry32((seed ^ 0x2c1b3c6d) >>> 0), offline: !!debug.musicOffline || (typeof navigator !== 'undefined' && navigator.onLine === false) })
      .then(async (match) => {
        if (this.stopped) return;
        this.match = match;
        // Cue up the first record before the show starts, so round 1 plays from the
        // decoded buffer (true reverse and filters) rather than the streaming fallback.
        // On a slow line this waits up to FIRST_RECORD_WAIT; then the stream takes over.
        const urls = match.rounds.map((r) => r.target.url || '');
        if (urls[0]) {
          this.showCard(this.warmHtml('Cueing up the first record…'));
          this.deck.prefetch(urls);
          this.prefetched = true;
          await this.deck.ready(urls[0], FIRST_RECORD_WAIT);
          if (this.stopped) return;
        }
        this.engine.startMatch({ seats: this.seats, seed, localId: 0, match });
      })
      .catch((err) => {
        console.error('[soundclash] could not start:', err);
        if (!this.stopped) this.showCard(this.warmHtml('The crates are empty. Go back and try again.'));
      });
  }

  warmHtml(line) {
    return `
      <p class="lbl">CH 20 · ${esc(this.info.slot)} · ${esc(this.info.kind.toUpperCase())}</p>
      <h2>${esc(this.info.name)}</h2>
      <div class="sc-warm" aria-hidden="true"><i></i></div>
      <p class="ag-wait">${esc(line)}</p>`;
  }

  isOver() { return this.engine.phase === S_PHASE.PODIUM; }

  // ---------- input ----------
  // Pick an answer, or change it, until the clock runs out.
  pick(i) {
    const e = this.engine;
    const me = e.me;
    if (!me || e.phase !== S_PHASE.PLAY) return;
    const current = this.myChoice != null ? this.myChoice : me.choice;
    if (current === i) return;
    this.myChoice = i;
    this.myAt = e.elapsed;
    this.shell.audio.blip();
    this.send('answer', { i });
    this.renderAnswers();
    const t = `${e.elapsed.toFixed(2)} s${e.overtime ? ' (overtime)' : ''}`;
    this.note(current == null ? `Picked at ${t}. You can change your mind until the clock runs out.` : `Changed at ${t}. Your time counts from now.`);
  }

  throw(kind) {
    const e = this.engine;
    const me = e.me;
    const s = SABOTAGES[kind];
    if (!me || !s || e.phase !== S_PHASE.PLAY) return;
    if (me.sabRound === e.round) { this.shell.audio.denied(); this.note('One throw a round.'); return; }
    if (me.score < s.cost) { this.shell.audio.denied(); this.note(`${s.name} costs ${s.cost}. You have ${me.score}.`); return; }
    const to = this.target === 'leader' ? 'leader' : this.target;
    const victim = to === 'leader' ? this.topRival() : e.players[to];
    if (!victim) { this.shell.audio.denied(); this.note('Nobody to hit.'); return; }
    this.send('sab', { kind, to });
  }

  topRival() {
    const e = this.engine;
    let best = null;
    for (const p of e.players) if (p.id !== e.localId && (!best || p.score > best.score)) best = p;
    return best;
  }

  apply(seat, action, p) {
    const e = this.engine;
    if (action === 'answer') return e.answerFor(seat, Number.isInteger(p.i) ? p.i : -1);
    if (action === 'sab') return e.sabotageFor(seat, String(p.kind), p.to === 'leader' ? 'leader' : Number(p.to));
    return false;
  }

  key(ev) {
    const k = ev.key;
    if (k >= '1' && k <= '4') {
      const pos = Number(k) - 1;
      // Under a scramble the keys follow the buttons as they now sit.
      const order = this.order();
      this.pick(order[pos]);
      return true;
    }
    const sab = { z: 'under', Z: 'under', x: 'scratch', X: 'scratch', c: 'shock', C: 'shock' }[k];
    if (sab) { this.throw(sab); return true; }
    if (k === 't' || k === 'T') { this.cycleTarget(); return true; }
    if (k === 'Enter' && this.isOver() && this.role !== 'client') { this.shell.again(); return true; }
    return false;
  }

  cycleTarget() {
    const e = this.engine;
    const ids = ['leader', ...e.players.filter((p) => p.id !== e.localId).map((p) => p.id)];
    const i = ids.indexOf(this.target);
    this.target = ids[(i + 1) % ids.length];
    this.shell.audio.blip();
    this.renderDock();
  }

  autopilot() {
    const e = this.engine;
    const me = e.me;
    if (!me || e.phase !== S_PHASE.PLAY) return;
    if (!me.locked && this.myChoice == null && e.elapsed > 1.2 && Math.random() < 0.04) this.pick(Math.floor(Math.random() * 4));
    if (me.sabRound !== e.round && me.score >= 300 && Math.random() < 0.004) this.throw('under');
  }

  // ---------- engine events ----------
  onEvent(type, d) {
    const e = this.engine;
    const a = this.shell.audio;
    this.ensureColors();
    if (!this.built && e.players.length) this.build();
    if (!this.prefetched && e.rounds.length) { this.prefetched = true; this.deck.prefetch(e.urls()); }
    switch (type) {
      case 'matchStart':
        this.build();
        this.showCard(this.howHtml());
        this.el.credit.hidden = e.options.source !== 'itunes';
        break;
      case 'cue': {
        this.hideCard();
        this.hideReveal();
        this.myChoice = null;
        this.fxShown = '';
        this.lastTick = 99;
        this.el.q.hidden = false;
        this.el.dock.hidden = false;
        this.deck.stop(0.08);
        this.deck.needleDrop();
        if (e.current && e.current.url) this.deck.ready(e.current.url, 100);
        const w = WARPS[d.warp] || WARPS.CLEAN_FINAL;
        if (this.stage) this.stage.cue({ n: d.n, of: d.of, warp: d.warp, label: w.label });
        this.note(d.final ? 'The dubplate special: clean audio, double points, and a wrong answer costs 250.' : `Round ${d.n} of ${d.of}. Warp: ${w.label.toLowerCase()}.`);
        this.renderAnswers();
        this.renderDock();
        break;
      }
      case 'play':
        if (this.stage) this.stage.play();
        this.deck.play({ url: e.current.url, synth: e.current.synth, start: e.current.start }, e.current.warp).then((tier) => {
          if (this.stopped) return;
          this.el.tier.hidden = false;
          this.el.tier.textContent = `SOURCE: ${TIER_LABEL[tier] || 'NO SIGNAL'}`;
          this.el.tier.dataset.tier = String(tier);
        });
        this.renderAnswers();
        this.renderDock();
        break;
      case 'lock':
        if (d.id === e.localId && !d.changed) a.slam();
        this.renderDock();
        break;
      case 'overtime':
        break;
      case 'sabotage': {
        const s = SABOTAGES[d.kind];
        if (this.stage) this.stage.sabotage(d.from, d.to, d.kind);
        this.deck.whoosh();
        if (d.to === e.localId) {
          setTimeout(() => {
            if (this.stopped) return;
            if (d.kind === 'scratch') this.deck.scratch(true); else a.slam();
            this.alert(`SABOTAGED BY ${e.players[d.from].name.toUpperCase()}: ${s.short}!`);
          }, 900);
        } else if (d.from === e.localId) {
          this.note(`Dubplate away: ${s.name} on ${e.players[d.to].name}.`);
        } else {
          this.note(`${e.players[d.from].name} hits ${this.nameOf(d.to)} with ${s.short.toLowerCase()}.`);
        }
        this.renderDock();
        break;
      }
      case 'reveal': {
        this.deck.stop(0.25);
        this.el.dock.hidden = true; // sabotage is for live rounds
        if (this.stage) {
          this.stage.reveal({ art: d.art, title: d.title, artist: d.artist });
          for (const g of d.gains) if (g.locked) this.stage.react(g.id, g.ok);
        }
        const mine = d.gains.find((g) => g.id === e.localId);
        if (mine && mine.ok) {
          if (mine.streak >= 3) { this.deck.airhorn(); this.note(`PULL UP! ${mine.streak} in a row: ×${mine.mult}.`); }
          else { this.deck.crowd(true); }
        } else if (mine && mine.locked) this.deck.crowd(false);
        else a.buzzer();
        this.showReveal(d);
        break;
      }
      case 'podium':
        this.deck.stop(0.3);
        this.el.q.hidden = true;
        this.el.dock.hidden = true;
        this.hideReveal();
        this.note('');
        if (this.stage) this.stage.podium(d.mvp);
        if (d.mvp === e.localId) { a.fanfare(); this.deck.airhorn(); } else a.register();
        this.renderResults();
        break;
      case 'away':
        if (d.away) this.shell.toast(`${e.players[d.id].name} left the room.`);
        break;
      case 'abort':
        this.deck.stop(0.05);
        break;
      default:
        break;
    }
    this.renderStatus();
  }

  build() {
    const e = this.engine;
    if (!e.players.length) return;
    this.built = true;
    this.ensureColors();
    if (this.stage) this.stage.setPlayers(e.players.map((p) => ({ id: p.id, name: p.name, color: this.colors[p.id] })), e.localId);
    this.renderStatus();
  }

  // ---------- HUD ----------
  renderStatus() {
    const e = this.engine;
    const me = e.me;
    this.el.round.textContent = e.round ? `ROUND ${e.round}/${e.rounds.length}` : '';
    const w = e.current && WARPS[e.current.warp];
    const showWarp = w && (e.phase === S_PHASE.CUE || e.phase === S_PHASE.PLAY);
    this.el.warp.hidden = !showWarp;
    if (showWarp) {
      const lifted = e.phase === S_PHASE.PLAY && e.overtime && e.current.warp !== 'CLEAN_FINAL';
      this.el.warp.textContent = lifted ? 'WARP LIFTED · OVERTIME' : `WARP: ${w.badge}`;
      this.el.warp.dataset.final = e.current.warp === 'CLEAN_FINAL' ? '1' : '0';
      this.el.warp.dataset.lifted = lifted ? '1' : '0';
    }
    if (me) this.el.score.textContent = `${String(me.score).padStart(4, '0')} PTS${me.streak >= 2 ? ` · STREAK ×${streakMult(me.streak)}` : ''}`;
    if (this.stage) this.stage.setScores(e.players.map((p) => ({ id: p.id, score: p.score, streak: p.streak, locked: e.phase === S_PHASE.PLAY && p.locked })));
  }

  // Your current pick: this device's latest during play (a guest's mirror only learns
  // the host's view at the reveal), the room's record after it.
  mine() {
    const e = this.engine;
    const me = e.me;
    if (!me) return null;
    if (OPEN.has(e.phase)) return me.choice != null ? me.choice : this.myChoice;
    return this.myChoice != null ? this.myChoice : me.choice;
  }

  // Display order of the four options: the engine's order, unless a scramble is on.
  order() {
    const fx = this.engine.effects(this.engine.me);
    return fx.scratch && Array.isArray(fx.scratch.perm) ? fx.scratch.perm : [0, 1, 2, 3];
  }

  renderAnswers() {
    const e = this.engine;
    const cur = e.current;
    if (!cur) { this.el.answers.innerHTML = ''; return; }
    const me = e.me;
    const live = e.phase === S_PHASE.PLAY && !!me;
    const open = OPEN.has(e.phase);
    const mine = this.mine();
    const order = this.order();
    this.el.label.textContent = e.phase === S_PHASE.CUE ? 'NEEDLE DROP…' : e.phase === S_PHASE.PLAY ? (mine == null ? 'NAME THAT SONG' : 'YOUR PICK · CHANGE IT UNTIL THE CLOCK RUNS OUT') : open ? 'THE REVEAL' : 'NAME THAT SONG';
    this.el.answers.innerHTML = order.map((i, pos) => {
      const o = cur.options[i];
      let state = '';
      if (open && e.correct >= 0) state = i === e.correct ? 'right' : mine === i ? 'wrong' : 'dim';
      else if (mine === i) state = 'mine';
      return `<button type="button" class="sc-ans" data-i="${i}" data-state="${state}" ${live ? '' : 'disabled'}>
        <kbd>${pos + 1}</kbd><span class="sc-t">${esc(o.title)}</span><span class="sc-a">${esc(o.artist)}</span>
      </button>`;
    }).join('');
    this.answersKey = `${e.phase}|${e.round}|${order.join('')}|${mine}|${live}`;
    // Phones stack the dock above the deck: tell it how tall the deck is.
    const h = this.el.q.offsetHeight;
    if (h) this.shell.root.firstElementChild.style.setProperty('--deck-h', `${h}px`);
  }

  renderDock() {
    const e = this.engine;
    const me = e.me;
    if (!me) return;
    const playing = e.phase === S_PHASE.PLAY;
    const used = me.sabRound === e.round;
    const rivals = e.players.filter((p) => p.id !== e.localId);
    if (this.target !== 'leader' && !rivals.some((p) => p.id === this.target)) this.target = 'leader';
    const top = this.topRival();
    this.el.targets.innerHTML = [
      `<button type="button" role="radio" data-to="leader" aria-checked="${this.target === 'leader'}" class="sc-pill">#1 LEADER${top ? ` · ${esc(top.name)}` : ''}</button>`,
      ...rivals.map((p) => `<button type="button" role="radio" data-to="${p.id}" aria-checked="${this.target === p.id}" class="sc-pill" style="--who:${this.colors[p.id]}">${esc(p.name)}</button>`),
    ].join('');
    this.el.sabs.innerHTML = SABOTAGE_ORDER.map((k) => {
      const s = SABOTAGES[k];
      const ok = playing && !used && me.score >= s.cost;
      return `<button type="button" class="sc-sab" data-sab="${k}" ${ok ? '' : 'disabled'} aria-keyshortcuts="${SAB_KEYS[k]}">
        <span class="sc-cost">${s.cost}</span><b>${esc(s.name)}</b><span class="sc-line">${esc(s.line)}</span><kbd>${SAB_KEYS[k]}</kbd>
      </button>`;
    }).join('');
    this.el.dock.dataset.used = used ? '1' : '0';
    this.dockKey = `${e.phase}|${e.round}|${me.score}|${used}|${this.target}|${e.players.map((p) => (p.locked ? 1 : 0)).join('')}`;
  }

  alert(text) {
    const el = this.el.alert;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(this.alertTimer);
    this.alertTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  note(text) {
    const n = this.el.note;
    n.textContent = text;
    n.classList.remove('on');
    if (!text) return;
    void n.offsetWidth;
    n.classList.add('on');
  }

  showCard(html) {
    this.el.card.innerHTML = html;
    this.el.card.hidden = false;
  }

  hideCard() { this.el.card.hidden = true; }

  // The album sleeve: what it was, who got it, and the store link Apple asks for.
  showReveal(d) {
    const e = this.engine;
    const rows = d.gains.slice().sort((x, y) => y.gain - x.gain || x.at - y.at).map((g) => {
      const p = e.players[g.id];
      const what = g.ok ? `${g.at.toFixed(2)} s${g.mult > 1 ? ` · ×${g.mult}` : ''}` : g.locked ? 'wrong' : 'no answer';
      return `<li data-me="${g.id === e.localId ? 1 : 0}" style="--who:${this.colors[g.id]}"><b>${esc(this.rowName(p))}</b><span>${esc(what)}</span><em data-sign="${g.gain > 0 ? '+' : g.gain < 0 ? '-' : '0'}">${g.gain > 0 ? '+' : ''}${g.gain}</em></li>`;
    }).join('');
    const art = d.art
      ? `<img class="sc-sleeve" src="${esc(d.art)}" alt="Cover of ${esc(d.title)}" width="200" height="200" referrerpolicy="no-referrer">`
      : `<div class="sc-sleeve sc-sleeve-gen" aria-hidden="true"><span>${esc(d.title)}</span></div>`;
    const link = d.link
      ? `<a class="sc-store" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Listen on Apple Music ↗</a>`
      : d.synth ? '<span class="sc-store">Public domain · played by the house synth</span>' : '';
    const fast = d.fastest ? `Fastest: ${esc(this.nameOf(d.fastest.id))}, ${d.fastest.at.toFixed(2)} s.` : 'Nobody named it.';
    this.el.reveal.innerHTML = `
      ${art}
      <div class="sc-rv">
        <p class="lbl">ROUND ${d.n} · IT WAS</p>
        <h2>${esc(d.title)}</h2>
        <p class="sc-artist">${esc(d.artist)}</p>
        ${link}
        <p class="sc-fast">${fast}</p>
        <ol class="sc-delta">${rows}</ol>
      </div>`;
    this.el.reveal.hidden = false;
    this.renderAnswers();
  }

  hideReveal() { this.el.reveal.hidden = true; }

  renderResults() {
    const e = this.engine;
    const aw = e.awards || {};
    const mvp = e.players[aw.mvp];
    const rows = e.ranking.map((id) => {
      const p = e.players[id];
      return { name: this.rowName(p), color: this.colors[id], me: id === e.localId, note: `${p.score} pts · ${p.right}/${e.rounds.length} right${p.best >= 2 ? ` · best streak ${p.best}` : ''}` };
    });
    const badge = (label, who, what) => `<div class="sc-award"><span class="lbl">${esc(label)}</span><b>${esc(who)}</b><span>${esc(what)}</span></div>`;
    const awards = [
      badge('MVP DJ', mvp ? this.rowName(mvp) : '—', mvp ? `${mvp.score} points` : ''),
      badge('FASTEST REACTION', aw.fastest ? this.rowName(e.players[aw.fastest.id]) : 'Nobody', aw.fastest ? `${aw.fastest.at.toFixed(2)} s` : 'no right answers'),
      badge('MOST SABOTAGES', aw.saboteur ? this.rowName(e.players[aw.saboteur.id]) : 'Nobody', aw.saboteur ? `${aw.saboteur.count} dubplate${aw.saboteur.count === 1 ? '' : 's'} thrown` : 'a peaceful clash'),
      badge('LONGEST STREAK', aw.streak ? this.rowName(e.players[aw.streak.id]) : 'Nobody', aw.streak ? `${aw.streak.best} in a row` : 'no streaks'),
    ].join('');
    const won = aw.mvp === e.localId;
    const place = e.ranking.indexOf(e.localId) + 1;
    this.showCard(this.resultsHtml({
      title: won ? 'Your sound wins the clash.' : `${mvp ? mvp.name : 'Someone'} wins the clash.`,
      sub: won ? 'Crowned MVP DJ.' : `You finished ${place} of ${e.players.length}.`,
      rows,
    }).replace('<ol class="ag-rank">', `<div class="sc-awards">${awards}</div><ol class="ag-rank">`));
    const b = this.el.card.querySelector('[data-ag="again"], [data-ag="exit"]');
    if (b && !this.shell.debug.auto) b.focus({ preventScroll: true });
  }

  // ---------- frame ----------
  frame(dt, reduce) {
    const e = this.engine;
    const me = e.me;
    this.deck.update(dt);
    // A guest's first snapshot carries the crate's URLs.
    if (!this.prefetched && e.rounds && e.rounds.length) { this.prefetched = true; this.deck.prefetch(e.urls()); }
    if (e.phase === S_PHASE.PLAY) {
      const frac = Math.max(0, e.t / S_RULES.roundTime);
      this.el.bar.style.transform = `scaleX(${frac})`;
      this.el.clock.dataset.ot = e.overtime ? '1' : '0';
      this.el.clock.hidden = false;
      // Overtime: the warp lifts for anyone still guessing.
      this.deck.setClean(e.overtime);
      if (e.t <= 3) {
        const interval = e.t > 1 ? 0.5 : 0.25;
        if (this.lastTick - e.t >= interval || this.lastTick > 3.1) { this.lastTick = e.t; this.shell.audio.tick(e.t <= 1); }
      }
      // What the rivals are doing to me right now.
      const fx = e.effects(me);
      this.deck.setUnderwater(!!fx.under);
      this.deck.setShock(fx.shock ? fx.shock.mode : null);
      const shown = `${fx.under ? 'u' : ''}${fx.scratch ? 's' : ''}${fx.shock ? 'k' : ''}`;
      if (shown !== this.fxShown) {
        this.fxShown = shown;
        this.el.water.dataset.on = fx.under ? '1' : '0';
        this.el.view.dataset.water = fx.under ? '1' : '0';
        this.el.q.dataset.scramble = fx.scratch ? '1' : '0';
        this.el.q.dataset.flip = fx.shock ? '1' : '0';
        this.renderAnswers();
      }
      if (this.renderedOt !== e.overtime) { this.renderedOt = e.overtime; this.renderStatus(); }
    } else {
      this.el.clock.hidden = e.phase !== S_PHASE.CUE;
      this.el.bar.style.transform = e.phase === S_PHASE.CUE ? 'scaleX(1)' : 'scaleX(0)';
      if (this.fxShown) {
        this.fxShown = '';
        this.el.water.dataset.on = '0';
        this.el.view.dataset.water = '0';
        this.el.q.dataset.scramble = '0';
        this.el.q.dataset.flip = '0';
      }
    }
    // Guests: re-render when a snapshot changes what the buttons or dock should show.
    if (me && this.el.q && !this.el.q.hidden) {
      const order = this.order();
      const mine = this.mine();
      const live = e.phase === S_PHASE.PLAY;
      if (this.answersKey !== `${e.phase}|${e.round}|${order.join('')}|${mine}|${live}`) this.renderAnswers();
      if (this.dockKey !== `${e.phase}|${e.round}|${me.score}|${me.sabRound === e.round}|${this.target}|${e.players.map((p) => (p.locked ? 1 : 0)).join('')}`) this.renderDock();
    }
    if (this.stage) {
      this.stage.update(dt, reduce, { spectrum: this.deck.spectrum(), rate: this.deck.rate, bass: this.deck.bass() });
      this.stage.render();
    }
  }

  stop() {
    this.deck.dispose();
    clearTimeout(this.alertTimer);
    super.stop();
  }

  // For the tests.
  debugState() {
    const e = this.engine;
    return { phase: e.phase, round: e.round, source: e.options && e.options.source, audio: this.deck.status(), points: speedPoints(1) };
  }
}
