// COLD OPEN — the screen: the cinema in 3D, the HUD (round, the print's fault, the clock
// with its changeover mark), four answers on a marquee letter board, the projection
// booth's sabotage, the "now showing" reveal, and the weekend box office at the end.
// Rules: coldOpenEngine.js. Trailers: projector.js. The cinema: coldOpen3d.js. The
// library: filmLoader.js and films.js.

import { ColdOpenEngine, C_PHASE, C_RULES, BOOTH, BOOTH_ORDER, FAULTS, filmPoints, filmMult } from './coldOpenEngine.js';
import { Projector } from './projector.js';
import { CinemaStage } from './coldOpen3d.js';
import { loadMatch, programmeById, filmLevelById, forgetFilm } from './filmLoader.js';
import { GameBase, esc } from '../../arcade/gameBase.js';
import { mulberry32 } from '../../engine/auctionEngine.js';

const SAB_KEYS = { focus: 'Z', reel: 'X', burn: 'C' };
const OPEN = new Set([C_PHASE.REVEAL, C_PHASE.PODIUM]);
const FIRST_REEL_WAIT = 9000; // ms: the longest the start waits for round 1's clip
const LEADER_POP = 1.2; // seconds into the leader: the "2" and its pop
// Cue marks, as seconds left on the clock: the motor cue, then the changeover cue just
// before the picture clears; the same pair again as the round runs out.
const CUES = [[7.0, 6.6], [5.4, 5.0], [2.0, 1.6], [0.4, 0]];

// A title as marquee letters: words kept whole, each letter on its own tile.
export function marquee(text) {
  return String(text).toUpperCase().split(/\s+/).filter(Boolean)
    .map((w) => `<span class="co-w">${[...w].map((ch) => `<i>${esc(ch)}</i>`).join('')}</span>`).join(' ');
}

// Points as takings, like a box office chart.
export const gross = (score) => `$${(Math.max(0, score) / 1000).toFixed(2)}M`;

// "…#co=0.42": the share of the trailer where a round's clip starts, carried on its URL.
export const clipOf = (url) => {
  const m = /#co=([\d.]+)$/.exec(String(url || ''));
  return { url: String(url || '').replace(/#co=[\d.]+$/, ''), frac: m ? Number(m[1]) : 0.3 };
};

export class ColdOpenGame extends GameBase {
  constructor(shell) {
    super(shell, 'coldopen', ColdOpenEngine);
    this.projector = new Projector(shell.audio);
    this.myChoice = null;
    this.target = 'leader';
    this.built = false;
    this.fxShown = '';
    this.lastTick = 99;
    this.popped = false;
    this.changed = false;
    this.cued = -1;
    const root = shell.root;
    root.innerHTML = `
      <div class="ag co" data-game="coldopen">
        <div class="ag-view co-view" id="co-view"></div>
        <div class="ag-top">
          <p class="ag-chip" id="co-title">COLD OPEN</p>
          <p class="ag-chip" id="co-round"></p>
          <p class="ag-chip co-fault" id="co-fault" hidden></p>
          <p class="ag-chip co-tier" id="co-tier" hidden></p>
          <p class="ag-chip ag-left" id="co-score"></p>
          <div class="co-clock" id="co-clock" aria-hidden="true"><i id="co-bar"></i><b class="co-ot" title="The changeover: the picture clears and the sound comes up" style="left:${((C_RULES.roundTime - C_RULES.warpTime) / C_RULES.roundTime * 100).toFixed(2)}%"></b></div>
        </div>
        <p class="co-alert" id="co-alert" role="alert" hidden></p>
        <aside class="co-booth" id="co-booth" aria-label="The projection booth: spend points to wreck a rival's picture">
          <p class="lbl">THE BOOTH · ONE A ROUND</p>
          <div class="co-targets" id="co-targets" role="radiogroup" aria-label="Target"></div>
          <div class="co-sabs" id="co-sabs"></div>
        </aside>
        <section class="co-board" id="co-q" aria-live="polite">
          <p class="lbl" id="co-label">NAME THAT FILM</p>
          <div class="co-answers" id="co-answers" role="group" aria-label="Answers"></div>
        </section>
        <section class="co-reveal" id="co-reveal" hidden></section>
        <p class="ag-toast" id="co-note" role="status"></p>
        <p class="co-credit" id="co-credit" hidden>Trailers courtesy of Apple TV</p>
        <p class="ag-keys co-keys">Answer: <kbd>1</kbd>–<kbd>4</kbd> · Booth: <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> · Next target: <kbd>T</kbd></p>
        <section class="ag-card" id="co-card" hidden></section>
      </div>`;
    this.el = {
      view: this.$('#co-view'), round: this.$('#co-round'), fault: this.$('#co-fault'), tier: this.$('#co-tier'), score: this.$('#co-score'),
      clock: this.$('#co-clock'), bar: this.$('#co-bar'), alert: this.$('#co-alert'), booth: this.$('#co-booth'), targets: this.$('#co-targets'),
      sabs: this.$('#co-sabs'), q: this.$('#co-q'), label: this.$('#co-label'), answers: this.$('#co-answers'), reveal: this.$('#co-reveal'),
      note: this.$('#co-note'), credit: this.$('#co-credit'), card: this.$('#co-card'),
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
      this.renderBooth();
    });
    this.el.sabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sab]');
      if (b && !b.disabled) this.throw(b.dataset.sab);
    });
    this.wireCard(this.el.card);
    this.el.q.hidden = true;
    this.el.booth.hidden = true;

    try {
      const renderer = this.makeRenderer(this.el.view);
      this.stage = new CinemaStage(renderer, this.el.view);
      this.ro = new ResizeObserver(() => this.stage.resize());
      this.ro.observe(this.el.view);
    } catch (err) {
      console.warn('[coldopen] no 3D cinema:', err);
      this.stage = null;
      this.el.view.innerHTML = '<div class="testcard on"><div class="tc-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="tc-plate"><strong>NO PICTURE</strong><span>This browser cannot draw the cinema, so Cold Open cannot show its films here. Try another show.</span></div></div>';
    }
  }

  // ---------- the start: find tonight's films, then thread the first reel ----------
  begin({ role, seats, localSeat = 0, seed }) {
    this.role = role;
    this.localSeat = localSeat;
    this.seats = seats || [];
    if (role === 'client') { this.showCard(this.warmHtml('The projectionist is threading the first reel…')); return; }
    this.colors = this.shell.colors(this.seats);
    const programme = programmeById(this.shell.programme ? this.shell.programme() : 'all');
    const level = filmLevelById(this.shell.level ? this.shell.level() : 'normal');
    this.showCard(this.warmHtml(`Tonight's programme: ${programme.name}, ${level.name.toLowerCase()}.`));
    loadMatch({ programme: programme.id, level: level.id, rng: mulberry32((seed ^ 0x6d2b79f5) >>> 0) })
      .then(async (match) => {
        if (this.stopped) return;
        const first = match.rounds[0];
        this.showCard(this.warmHtml('Threading the first reel…'));
        await this.projector.cue(first.target.url, first.start, first.len, FIRST_REEL_WAIT);
        if (this.stopped) return;
        this.engine.startMatch({ seats: this.seats, seed, localId: 0, match });
      })
      .catch((err) => {
        console.error('[coldopen] could not start:', err);
        if (this.stopped) return;
        this.showCard(`
          <p class="lbl">CH 20 · ${esc(this.info.slot)} · NO FILM TONIGHT</p>
          <h2>The film library cannot be reached.</h2>
          <p class="ag-sub">Cold Open needs Apple's trailer library, and this network or browser is not reaching it. Try another show tonight, or another network.</p>
          <div class="ag-actions"><button type="button" class="btn btn-quiet" data-ag="exit"><span class="b-label">${this.role === 'host' ? 'BACK TO LOBBY' : 'BACK TO TITLE'}</span></button></div>`);
        const b = this.el.card.querySelector('[data-ag="exit"]');
        if (b) b.focus({ preventScroll: true });
      });
  }

  warmHtml(line) {
    return `
      <p class="lbl">CH 20 · ${esc(this.info.slot)} · ${esc(this.info.kind.toUpperCase())}</p>
      <h2>${esc(this.info.name)}</h2>
      <div class="co-warm" aria-hidden="true"><i></i></div>
      <p class="ag-wait">${esc(line)}</p>`;
  }

  isOver() { return this.engine.phase === C_PHASE.PODIUM; }

  // ---------- input ----------
  pick(i) {
    const e = this.engine;
    const me = e.me;
    if (!me || e.phase !== C_PHASE.PLAY) return;
    const current = this.myChoice != null ? this.myChoice : me.choice;
    if (current === i) return;
    this.myChoice = i;
    this.shell.audio.blip();
    this.send('answer', { i });
    this.renderAnswers();
    const t = `${e.elapsed.toFixed(2)} s${e.overtime ? ' (after the changeover)' : ''}`;
    this.note(current == null ? `Picked at ${t}. You can change your mind until the clock runs out.` : `Changed at ${t}. Your time counts from now.`);
  }

  throw(kind) {
    const e = this.engine;
    const me = e.me;
    const s = BOOTH[kind];
    if (!me || !s || e.phase !== C_PHASE.PLAY) return;
    if (me.sabRound === e.round) { this.shell.audio.denied(); this.note('One a round from the booth.'); return; }
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
    if (k >= '1' && k <= '4') { this.pick(this.order()[Number(k) - 1]); return true; }
    const sab = { z: 'focus', Z: 'focus', x: 'reel', X: 'reel', c: 'burn', C: 'burn' }[k];
    if (sab) { this.throw(sab); return true; }
    if (k === 't' || k === 'T') { this.cycleTarget(); return true; }
    if (k === 'Enter' && this.isOver() && this.role !== 'client') { this.shell.again(); return true; }
    return false;
  }

  cycleTarget() {
    const e = this.engine;
    const ids = ['leader', ...e.players.filter((p) => p.id !== e.localId).map((p) => p.id)];
    this.target = ids[(ids.indexOf(this.target) + 1) % ids.length];
    this.shell.audio.blip();
    this.renderBooth();
  }

  autopilot() {
    const e = this.engine;
    const me = e.me;
    if (!me || e.phase !== C_PHASE.PLAY) return;
    if (!me.locked && this.myChoice == null && e.elapsed > 1.2 && Math.random() < 0.04) this.pick(Math.floor(Math.random() * 4));
    if (me.sabRound !== e.round && me.score >= 300 && Math.random() < 0.004) this.throw('focus');
  }

  // The clip for round n (1-based), from the URLs every player has.
  clip(n) {
    const urls = this.engine.urls ? this.engine.urls() : [];
    const cur = this.engine.current;
    if (cur && cur.n === n) return { url: cur.url, frac: cur.start, len: cur.len || 3 };
    const c = clipOf(urls[n - 1]);
    return { url: c.url, frac: c.frac, len: (cur && cur.len) || 3 };
  }

  // ---------- engine events ----------
  onEvent(type, d) {
    const e = this.engine;
    const a = this.shell.audio;
    this.ensureColors();
    if (!this.built && e.players.length) this.build();
    switch (type) {
      case 'matchStart':
        this.build();
        this.showCard(this.howHtml());
        this.el.credit.hidden = false;
        if (this.role === 'client') { const c = this.clip(1); this.projector.cue(c.url, c.frac, c.len, 20000); }
        break;
      case 'cue': {
        this.hideCard();
        this.hideReveal();
        this.myChoice = null;
        this.fxShown = '';
        this.lastTick = 99;
        this.popped = false;
        this.changed = false;
        this.el.q.hidden = false;
        this.el.booth.hidden = false;
        this.projector.stop();
        const c = this.clip(d.n);
        this.projector.cue(c.url, c.frac, c.len, 20000);
        const f = FAULTS[d.warp] || FAULTS.PREMIERE;
        if (this.stage) this.stage.cue({ fault: d.warp });
        this.note(d.final ? 'The premiere: a clean print, double points, and a wrong answer costs 250.' : `Reel ${d.n} of ${d.of}. Tonight's print: ${f.label.toLowerCase()}.`);
        this.renderAnswers();
        this.renderBooth();
        break;
      }
      case 'play': {
        if (this.stage) this.stage.play();
        this.startReel();
        // Thread the next reel while this one runs.
        if (e.round < e.rounds.length) { const c = this.clip(e.round + 1); if (c.url) this.projector.cue(c.url, c.frac, c.len, 30000); }
        this.renderAnswers();
        this.renderBooth();
        break;
      }
      case 'lock':
        if (d.id === e.localId && !d.changed) a.slam();
        this.renderBooth();
        break;
      case 'overtime':
        this.changeover();
        break;
      case 'sabotage': {
        const s = BOOTH[d.kind];
        if (this.stage) this.stage.sabotage(d.from, d.to, d.kind);
        if (d.to === e.localId) {
          a.slam();
          this.alert(`FROM THE BOOTH, ${e.players[d.from].name.toUpperCase()}: ${s.short}!`);
        } else if (d.from === e.localId) {
          this.note(`From the booth: ${s.name} on ${e.players[d.to].name}.`);
        } else {
          this.note(`${e.players[d.from].name} hits ${this.nameOf(d.to)} with ${s.short.toLowerCase()}.`);
        }
        this.renderBooth();
        break;
      }
      case 'reveal': {
        // The reel plays on, clean and with its sound, while the answer goes up.
        this.changeover(true);
        this.el.booth.hidden = true;
        if (this.stage) {
          this.stage.reveal();
          for (const g of d.gains) if (g.locked) this.stage.react(g.id, g.ok);
        }
        const mine = d.gains.find((g) => g.id === e.localId);
        if (mine && mine.ok) { if (mine.streak >= 3) { a.fanfare(); this.note(`A run of ${mine.streak}: ×${mine.mult}.`); } else a.register(); }
        else if (mine && mine.locked) a.buzzer();
        else a.denied();
        this.showReveal(d);
        break;
      }
      case 'podium':
        this.projector.stop();
        this.el.q.hidden = true;
        this.el.booth.hidden = true;
        this.hideReveal();
        this.note('');
        if (this.stage) this.stage.podium(d.mvp);
        if (d.mvp === e.localId) a.fanfare(); else a.register();
        this.renderResults();
        break;
      case 'away':
        if (d.away) this.shell.toast(`${e.players[d.id].name} left the room.`);
        break;
      case 'abort':
        this.projector.stop();
        break;
      default:
        break;
    }
    this.renderStatus();
  }

  // Run this round's clip; if it is not ready yet, keep trying while the round lasts.
  startReel() {
    const e = this.engine;
    const round = e.round;
    const c = this.clip(round);
    this.projector.play(c.url, c.frac, c.len).then((tier) => {
      if (this.stopped || this.engine.round !== round) return;
      this.showTier(tier);
      // A trailer that will not play is looked up afresh next time.
      const reel = this.projector.reels.get(c.url);
      if (tier === 0 && reel && reel.state === 'failed' && this.role !== 'client') {
        const r = this.engine.rounds[round - 1];
        if (r && r.target && r.target.id) forgetFilm(r.target.id);
      }
      if (tier === 0 && this.engine.phase === C_PHASE.PLAY) {
        clearTimeout(this.retry);
        this.retry = setTimeout(() => { if (!this.stopped && this.engine.round === round && this.engine.phase === C_PHASE.PLAY) this.startReel(); }, 1000);
      }
      if (tier === 1 && this.changed) this.projector.changeover();
    });
  }

  showTier(tier) {
    this.el.tier.hidden = false;
    this.el.tier.textContent = tier === 1 ? 'SOURCE: TRAILER' : 'PROJECTOR FAULT';
    this.el.tier.dataset.tier = String(tier);
  }

  changeover(quiet = false) {
    if (this.changed) return;
    this.changed = true;
    this.projector.changeover();
    if (!quiet && this.engine.current && this.engine.current.warp !== 'PREMIERE') this.note('Changeover: the picture clears and the sound comes up.');
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
    this.el.round.textContent = e.round ? `REEL ${e.round}/${e.rounds.length}` : '';
    const f = e.current && FAULTS[e.current.warp];
    const show = f && (e.phase === C_PHASE.CUE || e.phase === C_PHASE.PLAY);
    this.el.fault.hidden = !show;
    if (show) {
      const cleared = e.phase === C_PHASE.PLAY && e.overtime && e.current.warp !== 'PREMIERE';
      this.el.fault.textContent = cleared ? 'CHANGEOVER · CLEAN PRINT' : `PRINT: ${f.badge}`;
      this.el.fault.dataset.final = e.current.warp === 'PREMIERE' ? '1' : '0';
      this.el.fault.dataset.cleared = cleared ? '1' : '0';
    }
    if (me) this.el.score.textContent = `${gross(me.score)}${me.streak >= 2 ? ` · RUN ×${filmMult(me.streak)}` : ''}`;
    if (this.stage) this.stage.setScores(e.players.map((p) => ({ id: p.id, score: p.score, locked: e.phase === C_PHASE.PLAY && p.locked })));
  }

  mine() {
    const e = this.engine;
    const me = e.me;
    if (!me) return null;
    if (OPEN.has(e.phase)) return me.choice != null ? me.choice : this.myChoice;
    return this.myChoice != null ? this.myChoice : me.choice;
  }

  order() {
    const fx = this.engine.effects(this.engine.me);
    return fx.reel && Array.isArray(fx.reel.perm) ? fx.reel.perm : [0, 1, 2, 3];
  }

  renderAnswers() {
    const e = this.engine;
    const cur = e.current;
    if (!cur) { this.el.answers.innerHTML = ''; return; }
    const live = e.phase === C_PHASE.PLAY && !!e.me;
    const open = OPEN.has(e.phase);
    const mine = this.mine();
    const order = this.order();
    this.el.label.textContent = e.phase === C_PHASE.CUE ? 'THREADING THE REEL…' : e.phase === C_PHASE.PLAY ? (mine == null ? 'NAME THAT FILM' : 'YOUR PICK · CHANGE IT UNTIL THE CLOCK RUNS OUT') : open ? 'NOW SHOWING' : 'NAME THAT FILM';
    this.el.answers.innerHTML = order.map((i, pos) => {
      const o = cur.options[i];
      let state = '';
      if (open && e.correct >= 0) state = i === e.correct ? 'right' : mine === i ? 'wrong' : 'dim';
      else if (mine === i) state = 'mine';
      return `<button type="button" class="co-ans" data-i="${i}" data-state="${state}" aria-label="${esc(`${o.title} (${o.year || o.artist})`)}" ${live ? '' : 'disabled'}>
        <kbd>${pos + 1}</kbd><span class="co-mq" aria-hidden="true">${marquee(o.title)}</span><span class="co-yr" aria-hidden="true">${esc(o.year || o.artist)}</span>
      </button>`;
    }).join('');
    this.answersKey = `${e.phase}|${e.round}|${order.join('')}|${mine}|${live}`;
    const h = this.el.q.offsetHeight;
    if (h) this.shell.root.firstElementChild.style.setProperty('--deck-h', `${h}px`);
  }

  renderBooth() {
    const e = this.engine;
    const me = e.me;
    if (!me) return;
    const playing = e.phase === C_PHASE.PLAY;
    const used = me.sabRound === e.round;
    const rivals = e.players.filter((p) => p.id !== e.localId);
    if (this.target !== 'leader' && !rivals.some((p) => p.id === this.target)) this.target = 'leader';
    const top = this.topRival();
    this.el.targets.innerHTML = [
      `<button type="button" role="radio" data-to="leader" aria-checked="${this.target === 'leader'}" class="co-pill">#1 LEADER${top ? ` · ${esc(top.name)}` : ''}</button>`,
      ...rivals.map((p) => `<button type="button" role="radio" data-to="${p.id}" aria-checked="${this.target === p.id}" class="co-pill" style="--who:${this.colors[p.id]}">${esc(p.name)}</button>`),
    ].join('');
    this.el.sabs.innerHTML = BOOTH_ORDER.map((k) => {
      const s = BOOTH[k];
      const ok = playing && !used && me.score >= s.cost;
      return `<button type="button" class="co-sab" data-sab="${k}" ${ok ? '' : 'disabled'} aria-keyshortcuts="${SAB_KEYS[k]}">
        <span class="co-cost">${s.cost}</span><b>${esc(s.name)}</b><span class="co-line">${esc(s.line)}</span><kbd>${SAB_KEYS[k]}</kbd>
      </button>`;
    }).join('');
    this.el.booth.dataset.used = used ? '1' : '0';
    this.boothKey = `${e.phase}|${e.round}|${me.score}|${used}|${this.target}|${e.players.map((p) => (p.locked ? 1 : 0)).join('')}`;
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

  // Now showing: the poster in its case, what it was, who got it, and the store link.
  showReveal(d) {
    const e = this.engine;
    const rows = d.gains.slice().sort((x, y) => y.gain - x.gain || x.at - y.at).map((g) => {
      const p = e.players[g.id];
      const what = g.ok ? `${g.at.toFixed(2)} s${g.mult > 1 ? ` · ×${g.mult}` : ''}` : g.locked ? 'wrong' : 'no answer';
      return `<li data-me="${g.id === e.localId ? 1 : 0}" style="--who:${this.colors[g.id]}"><b>${esc(this.rowName(p))}</b><span>${esc(what)}</span><em data-sign="${g.gain > 0 ? '+' : g.gain < 0 ? '-' : '0'}">${g.gain > 0 ? '+' : ''}${g.gain}</em></li>`;
    }).join('');
    const title = d.film || d.title;
    const poster = d.art
      ? `<img class="co-poster" src="${esc(d.art)}" alt="Poster for ${esc(title)}" width="122" height="183" decoding="async" referrerpolicy="no-referrer">`
      : `<div class="co-poster co-poster-gen" aria-hidden="true"><span>${esc(title)}</span></div>`;
    const link = d.link ? `<a class="co-store" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Watch on Apple TV ↗</a>` : '';
    const fast = d.fastest ? `Quickest eye: ${esc(this.nameOf(d.fastest.id))}, ${d.fastest.at.toFixed(2)} s.` : 'Nobody named it.';
    this.el.reveal.innerHTML = `
      <figure class="co-sheet">${poster}<figcaption>NOW SHOWING</figcaption></figure>
      <div class="co-rv">
        <p class="lbl">REEL ${d.n} · IT WAS</p>
        <h2>${esc(title)}</h2>
        <p class="co-year">${esc(d.year || d.artist || '')}</p>
        ${link}
        <p class="co-fast">${fast}</p>
        <ol class="co-delta">${rows}</ol>
      </div>`;
    this.el.reveal.hidden = false;
    // A poster that will not load becomes a plain one with the title.
    const img = this.el.reveal.querySelector('img.co-poster');
    if (img) img.addEventListener('error', () => { img.outerHTML = `<div class="co-poster co-poster-gen" aria-hidden="true"><span>${esc(title)}</span></div>`; }, { once: true });
    this.renderAnswers();
  }

  hideReveal() { this.el.reveal.hidden = true; }

  // The weekend box office: points as takings.
  renderResults() {
    const e = this.engine;
    const aw = e.awards || {};
    const mvp = e.players[aw.mvp];
    const rows = e.ranking.map((id) => {
      const p = e.players[id];
      return { name: this.rowName(p), color: this.colors[id], me: id === e.localId, note: `${gross(p.score)} · ${p.right}/${e.rounds.length} named${p.best >= 2 ? ` · best run ${p.best}` : ''}` };
    });
    const badge = (label, who, what) => `<div class="co-award"><span class="lbl">${esc(label)}</span><b>${esc(who)}</b><span>${esc(what)}</span></div>`;
    const awards = [
      badge('BEST PICTURE', mvp ? this.rowName(mvp) : '—', mvp ? gross(mvp.score) : ''),
      badge('QUICKEST EYE', aw.fastest ? this.rowName(e.players[aw.fastest.id]) : 'Nobody', aw.fastest ? `${aw.fastest.at.toFixed(2)} s` : 'no right answers'),
      badge('BOOTH MENACE', aw.saboteur ? this.rowName(e.players[aw.saboteur.id]) : 'Nobody', aw.saboteur ? `${aw.saboteur.count} from the booth` : 'a quiet night in the booth'),
      badge('LONGEST RUN', aw.streak ? this.rowName(e.players[aw.streak.id]) : 'Nobody', aw.streak ? `${aw.streak.best} in a row` : 'no runs'),
    ].join('');
    const won = aw.mvp === e.localId;
    const place = e.ranking.indexOf(e.localId) + 1;
    this.showCard(this.resultsHtml({
      title: won ? 'You top the weekend box office.' : `${mvp ? mvp.name : 'Someone'} tops the weekend box office.`,
      sub: won ? 'Best Picture.' : `You opened at number ${place} of ${e.players.length}.`,
      rows,
    }).replace('FINAL STANDINGS', 'WEEKEND BOX OFFICE').replace('<ol class="ag-rank">', `<div class="co-awards">${awards}</div><ol class="ag-rank co-bo">`));
    const b = this.el.card.querySelector('[data-ag="again"], [data-ag="exit"]');
    if (b && !this.shell.debug.auto) b.focus({ preventScroll: true });
  }

  // ---------- frame ----------
  frame(dt, reduce) {
    const e = this.engine;
    const me = e.me;
    this.projector.update(dt);
    let clear = 1;
    let cue = 0;
    let focus = 0;
    let burn = 0;
    let decoy = null;
    let decoyMix = 0;
    if (e.phase === C_PHASE.CUE) {
      const lt = C_RULES.cueTime - e.t;
      if (!this.popped && lt >= LEADER_POP) { this.popped = true; this.projector.pop(); }
      clear = e.current && e.current.warp === 'PREMIERE' ? 1 : 0;
    }
    if (e.phase === C_PHASE.PLAY) {
      const frac = Math.max(0, e.t / C_RULES.roundTime);
      this.el.bar.style.transform = `scaleX(${frac})`;
      this.el.clock.dataset.ot = e.overtime ? '1' : '0';
      this.el.clock.hidden = false;
      if (e.overtime && !this.changed) this.changeover();
      clear = e.current && e.current.warp === 'PREMIERE' ? 1 : e.overtime ? Math.min(1, (e.elapsed - C_RULES.warpTime) / 0.6) : 0;
      for (const [from, to] of CUES) if (e.t <= from && e.t > to) cue = 1;
      if (e.t <= 3) {
        const interval = e.t > 1 ? 0.5 : 0.25;
        if (this.lastTick - e.t >= interval || this.lastTick > 3.1) { this.lastTick = e.t; this.shell.audio.tick(e.t <= 1); }
      }
      // What the booth is doing to me right now.
      const fx = e.effects(me);
      if (fx.focus) focus = 1;
      if (fx.burn) burn = Math.min(1, (BOOTH.burn.time - fx.burn.left) / BOOTH.burn.time) * 0.85 + 0.05;
      if (fx.reel) {
        const urls = e.urls ? e.urls() : [];
        decoy = this.projector.decoyVideo(fx.reel.decoy != null && fx.reel.decoy < e.round - 1 ? clipOf(urls[fx.reel.decoy]).url : '');
        decoyMix = decoy ? 1 : 0;
      }
      const shown = `${fx.focus ? 'f' : ''}${fx.reel ? 'r' : ''}${fx.burn ? 'b' : ''}`;
      if (shown !== this.fxShown) {
        this.fxShown = shown;
        this.el.q.dataset.scramble = fx.reel ? '1' : '0';
        this.el.view.dataset.burn = fx.burn ? '1' : '0';
        this.renderAnswers();
      }
      if (this.renderedOt !== e.overtime) { this.renderedOt = e.overtime; this.renderStatus(); }
    } else {
      this.el.clock.hidden = e.phase !== C_PHASE.CUE;
      this.el.bar.style.transform = e.phase === C_PHASE.CUE ? 'scaleX(1)' : 'scaleX(0)';
      if (this.fxShown) { this.fxShown = ''; this.el.q.dataset.scramble = '0'; this.el.view.dataset.burn = '0'; }
    }
    if (me && this.el.q && !this.el.q.hidden) {
      const order = this.order();
      const mine = this.mine();
      const live = e.phase === C_PHASE.PLAY;
      if (this.answersKey !== `${e.phase}|${e.round}|${order.join('')}|${mine}|${live}`) this.renderAnswers();
      if (this.boothKey !== `${e.phase}|${e.round}|${me.score}|${me.sabRound === e.round}|${this.target}|${e.players.map((p) => (p.locked ? 1 : 0)).join('')}`) this.renderBooth();
    }
    if (this.stage) {
      const video = this.projector.video();
      this.stage.frame({
        video, aspect: this.projector.aspect(), decoy, decoyAspect: decoy && decoy.videoWidth ? decoy.videoWidth / decoy.videoHeight : 16 / 9, decoyMix,
        clear, focus, burn, cue, splice: this.projector.splice,
      });
      this.stage.update(dt, reduce);
      this.stage.render();
    }
  }

  stop() {
    clearTimeout(this.alertTimer);
    clearTimeout(this.retry);
    this.projector.dispose();
    super.stop();
  }

  // For the tests.
  debugState() {
    const e = this.engine;
    return { phase: e.phase, round: e.round, source: e.options && e.options.source, film: this.projector.status(), points: filmPoints(1) };
  }
}
