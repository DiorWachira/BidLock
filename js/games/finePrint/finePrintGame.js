// FINE PRINT — the screen: the shopping studio in 3D behind; the offer plate with its
// ending blanked out; the writing desk (your knock-off, the warehouse's suggestions, who
// has filed); the call board, read aloud as fast small print; the reveal, knock-off by
// knock-off and then the genuine article; and the overnight sales figures at the end.
// Rules: finePrintEngine.js. Facts: facts.js. Voice: voice.js. The set: finePrint3d.js.

import { FinePrintEngine, F_PHASE, F_RULES, RATE_NAMES, cleanEntry, sameEntry, pickFacts } from './finePrintEngine.js';
import { deptById } from './facts.js';
import { Voice } from './voice.js';
import { StudioStage, SMALL_PRINT } from './finePrint3d.js';
import { GameBase, esc } from '../../arcade/gameBase.js';
import { mulberry32 } from '../../engine/auctionEngine.js';

const SEEN_KEY = 'fpSeen';
const SEEN_CAP = 60;
const VOICE_KEY = 'fpVoice';
const NUM = (n) => Math.round(n).toLocaleString('en-GB');
const SIGNS = {
  INTRO: ['OPERATORS ARE STANDING BY', false], PITCH: ['TONIGHT\'S OFFER', true], WRITE: ['WRITING THE SMALL PRINT', true],
  CALL: ['LINES ARE OPEN', true], REVEAL: ['ACCEPT NO IMITATIONS', true], PODIUM: ['THE OVERNIGHT SALES FIGURES', true],
};

// The fact as markup: the blank becomes the withheld ending, with its asterisk.
export function factHtml(text, fill = null) {
  const [a, b] = String(text).split('___');
  const blank = fill == null
    ? '<span class="fp-blank" aria-label="blank"><i></i><sup>*</sup></span>'
    : `<mark class="fp-fill">${esc(fill)}</mark>`;
  return `${esc(a)}${blank}${esc(b || '')}`;
}

// A line's words, each one ready to light up as the voice reaches it.
function wordsHtml(text) {
  let html = '';
  for (const m of String(text).matchAll(/\S+/g)) html += `<span data-at="${m.index}">${esc(m[0])}</span> `;
  return html.trim();
}

export class FinePrintGame extends GameBase {
  constructor(shell) {
    super(shell, 'fineprint', FinePrintEngine);
    this.voiceOn = shell.store ? shell.store.get(VOICE_KEY, true) !== false : true;
    this.voice = new Voice({ volume: () => (shell.audio.muted ? 0 : shell.audio.volume), enabled: () => this.voiceOn });
    this.built = false;
    this.myText = '';
    this.pending = '';
    this.myVote = null;
    this.myStar = null;
    this.starMode = 0;
    this.reading = -1;
    this.step = -1;
    this.lastTick = 99;
    this.factIds = [];
    const root = shell.root;
    root.innerHTML = `
      <div class="ag fp" data-game="fineprint" data-phase="IDLE">
        <div class="ag-view fp-view" id="fp-view"></div>
        <div class="ag-top">
          <p class="ag-chip" id="fp-title">FINE PRINT</p>
          <p class="ag-chip" id="fp-round"></p>
          <p class="ag-chip fp-rate" id="fp-rate"></p>
          <button type="button" class="ag-chip fp-voice" id="fp-voice" aria-pressed="${this.voiceOn}" title="The voice-over reads the offer and the small print aloud">${this.voiceOn ? 'VOICE ON' : 'VOICE OFF'}</button>
          <p class="ag-chip ag-left" id="fp-score"></p>
        </div>
        <div class="fp-clock" id="fp-clock" hidden aria-hidden="true"><span id="fp-clock-l">WRITING ENDS IN</span><b id="fp-clock-n">0:00</b><span class="fp-bar"><i id="fp-bar"></i></span></div>
        <ol class="fp-tote" id="fp-tote" aria-label="The tote board"></ol>
        <section class="fp-offer" id="fp-offer" hidden>
          <p class="fp-tab"><span id="fp-no"></span><span id="fp-dept"></span></p>
          <p class="fp-fact" id="fp-fact" aria-live="polite"></p>
          <p class="fp-ast" id="fp-ast">*Ending withheld. See the small print. Terms and conditions apply.</p>
        </section>
        <section class="fp-desk" id="fp-desk" hidden>
          <form class="fp-write" id="fp-write" autocomplete="off" novalidate>
            <label class="lbl" for="fp-input">YOUR SMALL PRINT · A FAKE ENDING THAT SOUNDS TRUE</label>
            <div class="fp-field">
              <input id="fp-input" type="text" maxlength="${F_RULES.maxLen}" autocomplete="off" autocapitalize="off" spellcheck="true" enterkeyhint="send" placeholder="Finish the sentence with a lie">
              <button type="submit" class="btn btn-live fp-file" id="fp-file"><span class="b-label">PRINT IT</span><kbd>Enter</kbd></button>
            </div>
            <p class="fp-count" id="fp-count" aria-live="polite"></p>
            <div class="fp-stock" id="fp-stock"></div>
            <p class="fp-status" id="fp-wstatus" role="status"></p>
            <ul class="fp-lamps" id="fp-lamps" aria-label="Who has filed"></ul>
          </form>
          <div class="fp-call" id="fp-call" hidden>
            <p class="lbl" id="fp-call-l">THE SMALL PRINT · PHONE IN THE GENUINE ARTICLE</p>
            <ol class="fp-lines" id="fp-lines"></ol>
            <p class="fp-status" id="fp-cstatus" role="status"></p>
          </div>
        </section>
        <div class="fp-crawl" aria-hidden="true"><p id="fp-crawl"></p></div>
        <p class="ag-toast" id="fp-note" role="status"></p>
        <p class="ag-keys fp-keys">Call a line: <kbd>1</kbd>–<kbd>7</kbd> · Review: <kbd>S</kbd> then the line · Voice: <kbd>V</kbd></p>
        <section class="ag-card" id="fp-card" hidden></section>
      </div>`;
    this.el = {
      wrap: root.querySelector('.fp'), view: this.$('#fp-view'), round: this.$('#fp-round'), rate: this.$('#fp-rate'), voiceBtn: this.$('#fp-voice'),
      score: this.$('#fp-score'), clock: this.$('#fp-clock'), clockL: this.$('#fp-clock-l'), clockN: this.$('#fp-clock-n'), bar: this.$('#fp-bar'),
      tote: this.$('#fp-tote'), offer: this.$('#fp-offer'), no: this.$('#fp-no'), dept: this.$('#fp-dept'), fact: this.$('#fp-fact'), ast: this.$('#fp-ast'),
      desk: this.$('#fp-desk'), write: this.$('#fp-write'), input: this.$('#fp-input'), file: this.$('#fp-file'), count: this.$('#fp-count'),
      stock: this.$('#fp-stock'), wstatus: this.$('#fp-wstatus'), lamps: this.$('#fp-lamps'), call: this.$('#fp-call'), callL: this.$('#fp-call-l'),
      lines: this.$('#fp-lines'), cstatus: this.$('#fp-cstatus'), crawl: this.$('#fp-crawl'), note: this.$('#fp-note'), card: this.$('#fp-card'),
    };
    this.el.crawl.textContent = SMALL_PRINT.join('  ·  ').toUpperCase();
    this.el.write.addEventListener('submit', (e) => { e.preventDefault(); this.file(); });
    this.el.input.addEventListener('input', () => this.renderCount());
    this.el.input.addEventListener('focus', () => {
      // On a phone the keyboard covers the bottom of the screen: bring the field up.
      if (window.innerWidth <= 640) setTimeout(() => this.el.input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    });
    this.el.stock.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-stock]');
      if (!b || !this.engine.current) return;
      const t = this.engine.current.stock[Number(b.dataset.stock)];
      if (!t) return;
      this.shell.audio.blip();
      this.el.input.value = t;
      this.renderCount();
      this.el.input.focus({ preventScroll: true });
    });
    this.el.lines.addEventListener('click', (e) => {
      const s = e.target.closest('button[data-star]');
      if (s && !s.disabled) { this.star(Number(s.dataset.star)); return; }
      const b = e.target.closest('button[data-i]');
      if (b && !b.disabled) this.pick(Number(b.dataset.i));
    });
    this.el.voiceBtn.addEventListener('click', () => this.toggleVoice());
    this.wireCard(this.el.card);

    try {
      const renderer = this.makeRenderer(this.el.view);
      this.stage = new StudioStage(renderer, this.el.view);
      this.ro = new ResizeObserver(() => this.stage.resize());
      this.ro.observe(this.el.view);
    } catch (err) {
      console.warn('[fineprint] no 3D studio:', err);
      this.stage = null;
      this.el.view.classList.add('fp-flat');
    }
  }

  // ---------- the start: tonight's facts, from the chosen department ----------
  begin({ role, seats, localSeat = 0, seed }) {
    this.role = role;
    this.localSeat = localSeat;
    this.seats = seats || [];
    if (role === 'client') { this.showCard(this.warmHtml('The operators are taking their seats…')); return; }
    this.colors = this.shell.colors(this.seats);
    const dept = deptById(this.shell.dept ? this.shell.dept() : 'all');
    const store = this.shell.store;
    const seen = store ? store.get(SEEN_KEY, []) : [];
    const facts = pickFacts(dept.id, mulberry32((seed ^ 0x2c1b3c6d) >>> 0), F_RULES.rounds, Array.isArray(seen) ? seen : []);
    this.factIds = facts.map((f) => f.id);
    this.engine.startMatch({ seats: this.seats, seed, localId: 0, match: { dept: dept.id, facts } });
  }

  // Remember tonight's facts, so the next hour starts on new ones.
  saveSeen() {
    if (this.seenSaved || !this.factIds.length || !this.shell.store) return;
    this.seenSaved = true;
    const prev = this.shell.store.get(SEEN_KEY, []);
    const keep = (Array.isArray(prev) ? prev : []).filter((id) => !this.factIds.includes(id));
    this.shell.store.set(SEEN_KEY, [...keep, ...this.factIds].slice(-SEEN_CAP));
  }

  warmHtml(line) {
    return `
      <p class="lbl">CH 20 · ${esc(this.info.slot)} · ${esc(this.info.kind.toUpperCase())}</p>
      <h2>${esc(this.info.name)}</h2>
      <div class="fp-warm" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="ag-wait">${esc(line)}</p>`;
  }

  isOver() { return this.engine.phase === F_PHASE.PODIUM; }

  // ---------- input ----------
  file() {
    const e = this.engine;
    if (!e.me || e.phase !== F_PHASE.WRITE) return;
    const text = cleanEntry(this.el.input.value);
    if (!text) { this.shell.audio.denied(); this.status('w', 'Write an ending first: something short that sounds true.'); return; }
    if (this.myText && this.myText === text) { this.status('w', 'That is already filed.'); return; }
    this.pending = text;
    this.status('w', 'Filing…');
    this.send('write', { text });
  }

  pick(i) {
    const e = this.engine;
    if (!e.me || e.phase !== F_PHASE.CALL || !e.current || !e.current.lines) return;
    if (i === this.mineLine()) { this.shell.audio.denied(); this.note('That one is yours: you cannot call your own line.'); return; }
    if (this.starMode) { this.starMode = 0; this.star(i); return; }
    if (this.myVote === i) return;
    const first = this.myVote == null;
    this.myVote = i;
    this.shell.audio.blip();
    this.send('vote', { i });
    this.renderLines();
    this.status('c', first ? `You called line ${i + 1}. Change it until the lines close.` : `Changed to line ${i + 1}.`);
  }

  star(i) {
    const e = this.engine;
    if (!e.me || e.phase !== F_PHASE.CALL || i === this.mineLine()) return;
    this.myStar = this.myStar === i ? null : i;
    this.shell.audio.chime();
    this.send('star', { i });
    this.renderLines();
    this.note(this.myStar == null ? 'Review taken back.' : `Five stars for line ${i + 1}. Whoever wrote it gets 100.`);
  }

  toggleVoice() {
    this.voiceOn = !this.voiceOn;
    if (this.shell.store) this.shell.store.set(VOICE_KEY, this.voiceOn);
    if (!this.voiceOn) this.voice.stop();
    this.el.voiceBtn.setAttribute('aria-pressed', String(this.voiceOn));
    this.el.voiceBtn.textContent = this.voiceOn ? 'VOICE ON' : 'VOICE OFF';
    this.shell.audio.blip();
    this.note(this.voiceOn ? 'The voice-over is back on.' : 'Voice-over off. The small print still runs on screen.');
  }

  apply(seat, action, p) {
    const e = this.engine;
    if (action === 'write') return e.writeFor(seat, typeof p.text === 'string' ? p.text.slice(0, 200) : '');
    if (action === 'vote') return e.voteFor(seat, Number.isInteger(p.i) ? p.i : -1);
    if (action === 'star') return e.starFor(seat, Number.isInteger(p.i) ? p.i : -1);
    return false;
  }

  key(ev) {
    const k = ev.key;
    const e = this.engine;
    if (k === 'v' || k === 'V') { this.toggleVoice(); return true; }
    if (e.phase === F_PHASE.CALL && /^[1-8]$/.test(k)) {
      const i = Number(k) - 1;
      if (e.current && e.current.lines && i < e.current.lines.length) { this.pick(i); return true; }
      return false;
    }
    if (e.phase === F_PHASE.CALL && (k === 's' || k === 'S')) {
      this.starMode = 1;
      this.note('Review: press the number of the line you liked best.');
      return true;
    }
    if (e.phase === F_PHASE.WRITE && (k === 'Enter' || /^[a-z]$/i.test(k)) && document.activeElement !== this.el.input) {
      this.el.input.focus({ preventScroll: true });
      return k === 'Enter';
    }
    if (k === 'Enter' && this.isOver() && this.role !== 'client') { this.shell.again(); return true; }
    return false;
  }

  autopilot() {
    const e = this.engine;
    const me = e.me;
    if (!me) return;
    if (e.phase === F_PHASE.WRITE && !me.wrote && !this.pending && e.elapsed > 1 && Math.random() < 0.05) {
      this.el.input.value = `a ${['tiny', 'golden', 'haunted', 'singing', 'Belgian'][Math.floor(Math.random() * 5)]} ${['goose', 'trombone', 'lighthouse', 'sock', 'cabbage'][Math.floor(Math.random() * 5)]}`;
      this.file();
    }
    if (e.phase === F_PHASE.CALL && this.myVote == null && e.elapsed > 1.5 && Math.random() < 0.05 && e.current.lines) {
      const can = e.current.lines.map((_, i) => i).filter((i) => i !== this.mineLine());
      this.pick(can[Math.floor(Math.random() * can.length)]);
    }
  }

  // My line on the board: matched by what I filed (the board does not say who wrote what).
  mineLine() {
    const e = this.engine;
    if (e.last && Array.isArray(e.last.lines)) return e.last.lines.findIndex((l) => l.authors.includes(e.localId));
    if (!this.myText || !e.current || !e.current.lines) return -1;
    return e.current.lines.findIndex((t) => sameEntry(t, this.myText));
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
        break;
      case 'pitch': {
        this.hideCard();
        this.myText = '';
        this.pending = '';
        this.myVote = null;
        this.myStar = null;
        this.starMode = 0;
        this.step = -1;
        this.reading = -1;
        this.lastTick = 99;
        this.el.input.value = '';
        this.renderCount();
        const cur = e.current;
        const dept = deptById(cur.dept);
        this.el.offer.hidden = false;
        this.el.no.textContent = `OFFER Nº ${String(cur.n).padStart(2, '0')} OF ${String(cur.of).padStart(2, '0')}`;
        this.el.dept.textContent = dept.id === 'all' ? '' : dept.name.toUpperCase();
        this.el.fact.innerHTML = factHtml(cur.text);
        this.el.ast.textContent = '*Ending withheld. See the small print. Terms and conditions apply.';
        this.el.desk.hidden = true;
        if (this.stage) this.stage.offer({ n: cur.n, dept: dept.name });
        a.chime();
        this.note(d.final ? 'The closing offer: triple points.' : d.rate > 1 ? 'Premium rate: double points.' : `Offer ${d.n} of ${d.of}.`);
        this.voice.pitch(cur.text);
        break;
      }
      case 'write':
        this.el.desk.hidden = false;
        this.el.write.hidden = false;
        this.el.call.hidden = true;
        this.el.input.disabled = !e.me;
        this.el.file.disabled = !e.me;
        this.renderStock();
        this.status('w', 'Write an ending that sounds true. Short and specific works best.');
        if (!this.shell.debug.auto && e.me && window.innerWidth > 640) this.el.input.focus({ preventScroll: true });
        break;
      case 'wrote':
        if (this.stage) this.stage.ring(d.id);
        if (d.id === e.localId) {
          this.myText = this.pending || this.myText;
          this.pending = '';
          if (!d.changed) a.slam(); else a.blip();
          this.status('w', `Filed: “${this.myText}”. You can change it until everyone is in.`);
        }
        break;
      case 'bounce':
        if (d.id === e.localId) {
          this.pending = '';
          a.denied();
          this.status('w', 'That is the real ending, or too close to it. Write a fake one: that is the game.');
          this.el.write.classList.remove('fp-shake');
          void this.el.write.offsetWidth;
          this.el.write.classList.add('fp-shake');
          this.el.input.select();
        }
        break;
      case 'call': {
        this.el.write.hidden = true;
        this.el.call.hidden = false;
        if (document.activeElement === this.el.input) this.el.input.blur();
        if (!this.myText && this.pending) this.myText = this.pending;
        this.el.callL.textContent = 'THE SMALL PRINT · PHONE IN THE GENUINE ARTICLE';
        this.renderLines();
        this.ring();
        this.status('c', e.me ? `${e.current.lines.length} lines. One is genuine. Phone it in: click it, or press its number.` : 'The lines are open.');
        this.voice.smallPrint(e.current.lines, {
          onLine: (i) => { this.reading = i; this.markReading(i, -1); },
          onWord: (i, at) => this.markReading(i, at),
          onDone: () => { this.reading = -1; this.markReading(-1, -1); },
        });
        break;
      }
      case 'vote':
        if (this.stage) this.stage.ring(d.id);
        break;
      case 'reveal':
        this.voice.stop();
        this.reading = -1;
        this.step = -1;
        this.myVote = d.gains.find((g) => g.id === e.localId)?.vote ?? this.myVote;
        this.el.callL.textContent = 'THE SMALL PRINT · ACCEPT NO IMITATIONS';
        this.status('c', '');
        this.renderLines();
        break;
      case 'podium':
        this.voice.stop();
        this.el.offer.hidden = true;
        this.el.desk.hidden = true;
        if (this.stage) this.stage.podium(d.mvp);
        if (d.mvp === e.localId) a.fanfare(); else a.register();
        this.renderResults();
        break;
      case 'away':
        if (d.away) this.shell.toast(`${e.players[d.id].name} left the room.`);
        break;
      case 'abort':
        this.voice.stop();
        break;
      default:
        break;
    }
    this.el.wrap.dataset.phase = e.phase;
    if (this.stage && SIGNS[e.phase]) this.stage.setSign(...SIGNS[e.phase]);
    this.renderStatus();
    this.renderLamps();
  }

  // The phone trill as the lines open.
  ring() {
    const a = this.shell.audio;
    if (!a || !a._tone) return;
    for (let k = 0; k < 2; k++) {
      for (let j = 0; j < 6; j++) {
        a._tone({ type: 'sine', freq: 480, t: k * 0.55 + j * 0.05, dur: 0.045, peak: 0.07 });
        a._tone({ type: 'sine', freq: 620, t: k * 0.55 + j * 0.05 + 0.025, dur: 0.045, peak: 0.06 });
      }
    }
  }

  build() {
    const e = this.engine;
    if (!e.players.length) return;
    this.built = true;
    this.ensureColors();
    if (this.stage) this.stage.setPlayers(e.players.map((p) => ({ id: p.id, name: p.name, color: this.colors[p.id] })), e.localId);
    this.buildTote();
    this.renderStatus();
  }

  // ---------- HUD ----------
  renderStatus() {
    const e = this.engine;
    const me = e.me;
    const cur = e.current;
    this.el.round.textContent = e.round ? `OFFER ${e.round}/${e.rounds.length}` : '';
    const rate = cur ? cur.rate : 1;
    this.el.rate.textContent = e.round && e.phase !== F_PHASE.PODIUM ? RATE_NAMES[rate] : '';
    this.el.rate.dataset.rate = String(rate);
    if (me) this.el.score.textContent = `${NUM(me.score)} PTS`;
    this.renderTote();
  }

  status(which, text) {
    (which === 'w' ? this.el.wstatus : this.el.cstatus).textContent = text;
  }

  renderCount() {
    const left = F_RULES.maxLen - [...this.el.input.value].length;
    // Shown only near the limit (the GOV.UK character-count pattern).
    this.el.count.textContent = left <= 15 ? `${left} character${left === 1 ? '' : 's'} left` : '';
    this.el.count.dataset.low = left <= 5 ? '1' : '0';
  }

  renderStock() {
    const cur = this.engine.current;
    const stock = (cur && cur.stock) || [];
    this.el.stock.innerHTML = stock.length
      ? `<span class="lbl">STUCK? FROM THE WAREHOUSE</span>${stock.map((t, i) => `<button type="button" class="fp-crate" data-stock="${i}">${esc(t)}</button>`).join('')}`
      : '';
  }

  // Who has filed (writing) or phoned in (calling): one lamp each.
  renderLamps() {
    const e = this.engine;
    const calling = e.phase === F_PHASE.CALL;
    const on = {};
    // At the end every lamp on the bank is lit.
    for (const p of e.players) on[p.id] = calling ? p.voted : e.phase === F_PHASE.WRITE ? p.wrote : e.phase === F_PHASE.PODIUM;
    if (this.stage) this.stage.setLamps(on);
    const key = `${e.phase}|${e.players.map((p) => (on[p.id] ? 1 : 0)).join('')}`;
    if (this.lampKey === key) return;
    this.lampKey = key;
    this.el.lamps.innerHTML = e.players.map((p) => `<li data-on="${on[p.id] ? 1 : 0}" style="--who:${this.colors[p.id]}"><i></i>${esc(p.id === e.localId ? 'YOU' : p.name)}</li>`).join('');
    const n = Object.values(on).filter(Boolean).length;
    this.el.lamps.setAttribute('aria-label', `${n} of ${e.players.length} have ${calling ? 'phoned in' : 'filed'}`);
  }

  // ---------- the tote board ----------
  buildTote() {
    const e = this.engine;
    this.el.tote.innerHTML = e.players.map((p) => `
      <li data-id="${p.id}" data-me="${p.id === e.localId ? 1 : 0}" style="--who:${this.colors[p.id]}">
        <b>${esc(this.rowName(p))}</b>
        <span class="fp-drums" aria-hidden="true"><span class="fp-paint" hidden>1</span>${'<span class="fp-drum"><i>0 1 2 3 4 5 6 7 8 9</i></span>'.repeat(4)}</span>
        <span class="fp-gain"></span>
        <span class="sr-only">${NUM(p.score)} points</span>
      </li>`).join('');
    this.toteShown = new Map();
  }

  renderTote() {
    const e = this.engine;
    if (!this.toteShown) return;
    // Scores roll on when the genuine article is revealed, not before.
    const holding = e.phase === F_PHASE.REVEAL && this.step < (e.last ? e.last.order.length : 0);
    for (const p of e.players) {
      const row = this.el.tote.querySelector(`li[data-id="${p.id}"]`);
      if (!row) continue;
      const shown = holding ? p.score - (p.gain || 0) : p.score;
      if (this.toteShown.get(p.id) === shown) continue;
      this.toteShown.set(p.id, shown);
      const v = Math.max(0, Math.min(19999, Math.round(shown)));
      const digits = String(v % 10000).padStart(4, '0');
      row.querySelectorAll('.fp-drum i').forEach((d, k) => d.style.setProperty('--d', digits[k]));
      // Past 9,999 the board runs out of drums, and someone paints on a 1.
      row.querySelector('.fp-paint').hidden = v < 10000;
      row.querySelector('.sr-only').textContent = `${NUM(shown)} points`;
    }
  }

  // ---------- the call board ----------
  renderLines() {
    const e = this.engine;
    const cur = e.current;
    const open = e.phase === F_PHASE.REVEAL || e.phase === F_PHASE.PODIUM;
    const last = open ? e.last : null;
    const texts = last ? last.lines.map((l) => l.text) : (cur && cur.lines) || [];
    const mine = this.mineLine();
    const shown = last ? new Set(last.order.slice(0, Math.max(0, this.step))) : null;
    const truthOut = last && this.step >= last.order.length;
    const calling = e.phase === F_PHASE.CALL && !!e.me;
    this.el.lines.innerHTML = texts.map((t, i) => {
      const l = last ? last.lines[i] : null;
      const out = !!(l && (shown.has(i) || truthOut));
      let verdict = '';
      let tag = '';
      if (out) {
        if (l.truth) {
          verdict = 'genuine';
          const who = l.voters.map((v) => this.nameOf(v));
          tag = `<span class="fp-burst">GENUINE<br>ARTICLE</span><span class="fp-who">${who.length ? `Found by ${esc(who.join(', '))}` : 'Nobody found it'}</span>`;
        } else if (l.house) {
          verdict = 'house';
          tag = `<span class="fp-sash">THE HOUSE'S OWN</span><span class="fp-who">${l.voters.length ? `Fooled ${esc(l.voters.map((v) => this.nameOf(v)).join(', '))}` : 'No sale'}</span>`;
        } else {
          verdict = 'knockoff';
          const by = l.authors.map((x) => this.nameOf(x)).join(' & ');
          const sold = l.voters.length;
          tag = `<span class="fp-sash">KNOCK-OFF · ${esc(by.toUpperCase())}</span><span class="fp-who">${sold ? `Sold to ${esc(l.voters.map((v) => this.nameOf(v)).join(', '))} · +${NUM(sold * F_RULES.fool * last.rate)}` : 'No sale'}${l.stars.length ? ` · ${'★'.repeat(Math.min(5, l.stars.length))}` : ''}</span>`;
        }
      }
      const callers = out && l.voters.length ? `<span class="fp-callers">${l.voters.map((v) => `<i style="--who:${this.colors[v]}" title="${esc(this.nameOf(v))}"></i>`).join('')}</span>` : '';
      const isMine = i === mine;
      const picked = (last ? (e.me && last.gains.find((g) => g.id === e.localId)?.vote) : this.myVote) === i;
      const starred = !last && this.myStar === i;
      return `<li class="fp-line" data-verdict="${verdict}" data-mine="${isMine ? 1 : 0}" data-picked="${picked ? 1 : 0}" data-dim="${last && !out ? 1 : 0}">
        <button type="button" class="fp-pick" data-i="${i}" aria-pressed="${picked}" ${calling && !isMine ? '' : 'disabled'} aria-label="Line ${i + 1}: ${esc(t)}${isMine ? ' (yours)' : ''}">
          <span class="fp-no"><kbd>${i + 1}</kbd>LINE</span><span class="fp-txt" aria-hidden="true">${wordsHtml(t)}</span>${isMine ? '<span class="fp-yours">YOURS</span>' : picked ? '<span class="fp-yours fp-called">CALLED</span>' : ''}
        </button>
        ${calling && !isMine ? `<button type="button" class="fp-star" data-star="${i}" aria-pressed="${starred}" aria-label="Five-star review for line ${i + 1}" title="Five-star review: 100 to whoever wrote it">★</button>` : ''}
        ${out ? `<div class="fp-verdict">${tag}${callers}</div>` : ''}
      </li>`;
    }).join('');
    if (last && truthOut) {
      const f = last.fact;
      this.el.callL.innerHTML = `THE SMALL PRINT · ACCEPT NO IMITATIONS <a class="fp-src" href="${esc(f.src)}" target="_blank" rel="noopener noreferrer">Fact-checked: Wikipedia ↗</a>`;
    }
  }

  // The voice has reached line i, word at char `at`.
  markReading(i, at) {
    for (const li of this.el.lines.children) li.dataset.reading = '0';
    if (i < 0) return;
    const li = this.el.lines.children[i];
    if (!li) return;
    li.dataset.reading = '1';
    for (const w of li.querySelectorAll('.fp-txt span')) w.dataset.on = Number(w.dataset.at) <= at ? '1' : '0';
  }

  // The reveal, a step at a time, from the shared clock.
  revealStep() {
    const e = this.engine;
    const last = e.last;
    if (!last) return;
    const R = F_RULES;
    const el = e.elapsed;
    const step = el < R.revealOpen ? 0 : Math.min(last.order.length, 1 + Math.floor((el - R.revealOpen) / R.revealLine));
    if (step === this.step) return;
    const prev = this.step;
    this.step = step;
    this.renderLines();
    const a = this.shell.audio;
    if (step <= 0 || prev >= step) return;
    const i = last.order[step - 1];
    const l = last.lines[i];
    if (l.truth) {
      // The genuine article: the blank fills, the burst goes up, the scores roll.
      this.el.fact.innerHTML = factHtml(last.fact.text, l.text);
      this.el.ast.textContent = `*The genuine article. Source: Wikipedia.`;
      if (this.stage) {
        this.stage.genuine();
        for (const g of last.gains) this.stage.react(g.id, g.found || g.fooled > 0);
      }
      const mine = last.gains.find((g) => g.id === e.localId);
      if (mine && mine.found) a.register(); else a.buzzer();
      if (mine) {
        const bits = [];
        if (mine.found) bits.push('found it');
        if (mine.fooled) bits.push(`fooled ${mine.fooled}`);
        if (mine.stars) bits.push(`${mine.stars}★`);
        this.note(bits.length ? `+${NUM(mine.gain)}: ${bits.join(', ')}.` : mine.vote != null ? 'Taken in by a knock-off. No points this offer.' : 'No call, no points this offer.');
      }
      this.voice.say(`The genuine article: ${l.text}.`);
      this.renderTote();
      this.flashGains(last);
    } else {
      a.slam();
      const fooledMe = l.voters.includes(e.localId);
      const mineSold = l.authors.includes(e.localId);
      if (mineSold) this.note(`Your knock-off sold to ${l.voters.length}!`);
      else if (fooledMe) this.note(l.house ? 'The house fooled you with its own.' : `Fooled by ${l.authors.map((x) => this.nameOf(x)).join(' & ')}.`);
    }
  }

  flashGains(last) {
    for (const g of last.gains) {
      const row = this.el.tote.querySelector(`li[data-id="${g.id}"] .fp-gain`);
      if (!row) continue;
      row.textContent = g.gain ? `+${NUM(g.gain)}` : '';
      row.classList.remove('on');
      void row.offsetWidth;
      if (g.gain) row.classList.add('on');
    }
  }

  alertCard(html) { this.showCard(html); }

  showCard(html) {
    this.el.card.innerHTML = html;
    this.el.card.hidden = false;
  }

  hideCard() { this.el.card.hidden = true; }

  note(text) {
    const n = this.el.note;
    n.textContent = text;
    n.classList.remove('on');
    if (!text) return;
    void n.offsetWidth;
    n.classList.add('on');
  }

  // The overnight sales figures.
  renderResults() {
    const e = this.engine;
    const aw = e.awards || {};
    const mvp = e.players[aw.mvp];
    const rows = e.ranking.map((id) => {
      const p = e.players[id];
      return { name: this.rowName(p), color: this.colors[id], me: id === e.localId, note: `${NUM(p.score)} pts · found ${p.found} · fooled ${p.fooled}${p.stars ? ` · ${p.stars}★` : ''}` };
    });
    const badge = (label, who, what) => `<div class="fp-award"><span class="lbl">${esc(label)}</span><b>${esc(who)}</b><span>${esc(what)}</span></div>`;
    const awards = [
      badge('TOP OF THE TOTE', mvp ? this.rowName(mvp) : '—', mvp ? `${NUM(mvp.score)} points` : ''),
      badge('TOP SELLER', aw.seller ? this.rowName(e.players[aw.seller.id]) : 'Nobody', aw.seller ? `fooled ${aw.seller.count} caller${aw.seller.count === 1 ? '' : 's'}` : 'no knock-off sold'),
      badge('SHARPEST SHOPPER', aw.shopper ? this.rowName(e.players[aw.shopper.id]) : 'Nobody', aw.shopper ? `found ${aw.shopper.count} genuine article${aw.shopper.count === 1 ? '' : 's'}` : 'nobody found one'),
      badge('CUSTOMER FAVOURITE', aw.favourite ? this.rowName(e.players[aw.favourite.id]) : 'Nobody', aw.favourite ? `${aw.favourite.count} five-star review${aw.favourite.count === 1 ? '' : 's'}` : 'no reviews tonight'),
    ].join('');
    const won = aw.mvp === e.localId;
    const place = e.ranking.indexOf(e.localId) + 1;
    this.showCard(this.resultsHtml({
      title: won ? 'You top the tote board.' : `${mvp ? mvp.name : 'Someone'} tops the tote board.`,
      sub: won ? 'The best salesperson on the overnight shift.' : `You finished ${place} of ${e.players.length}. That's all from the overnight shopping hour.`,
      rows,
    }).replace('FINAL STANDINGS', 'THE OVERNIGHT SALES FIGURES').replace('<ol class="ag-rank">', `<div class="fp-awards">${awards}</div><ol class="ag-rank">`));
    const b = this.el.card.querySelector('[data-ag="again"], [data-ag="exit"]');
    if (b && !this.shell.debug.auto) b.focus({ preventScroll: true });
  }

  // ---------- frame ----------
  frame(dt, reduce) {
    const e = this.engine;
    const timed = e.phase === F_PHASE.WRITE || e.phase === F_PHASE.CALL;
    this.el.clock.hidden = !timed;
    if (timed) {
      const left = Math.max(0, e.t);
      const s = Math.ceil(left);
      const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (this.el.clockN.textContent !== txt) this.el.clockN.textContent = txt;
      const label = e.phase === F_PHASE.WRITE ? 'WRITING ENDS IN' : 'LINES CLOSE IN';
      if (this.el.clockL.textContent !== label) this.el.clockL.textContent = label;
      this.el.bar.style.transform = `scaleX(${e.total ? left / e.total : 0})`;
      this.el.clock.dataset.hot = left <= 5 ? '1' : '0';
      if (left <= 5) {
        if (this.lastTick - left >= 1 || this.lastTick > 5.5) { this.lastTick = left; this.shell.audio.tick(left <= 2); }
      } else this.lastTick = 99;
    }
    if (e.phase === F_PHASE.REVEAL) this.revealStep();
    if (this.starMode && e.phase !== F_PHASE.CALL) this.starMode = 0;
    // Keep the lamps and the board in step with the room.
    if (e.phase === F_PHASE.WRITE || e.phase === F_PHASE.CALL) this.renderLamps();
    if (e.phase === F_PHASE.CALL && e.current && e.current.lines && this.el.lines.children.length !== e.current.lines.length) this.renderLines();
    if (this.stage) {
      this.stage.update(dt, reduce);
      this.stage.render();
    }
  }

  stop() {
    this.voice.stop();
    super.stop();
  }

  // For the tests.
  debugState() {
    const e = this.engine;
    return { phase: e.phase, round: e.round, mine: this.mineLine(), myText: this.myText, myVote: this.myVote, voice: this.voice.available, lines: e.current && e.current.lines };
  }
}
