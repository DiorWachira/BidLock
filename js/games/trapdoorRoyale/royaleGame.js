// TRAPDOOR ROYALE — the screen: the 3D arena, the question board in the HUD, the
// controls, and the results. Rules live in royaleEngine.js; the arena in royale3d.js.

import { RoyaleEngine, R_PHASE, R_RULES, PLATFORM_LETTERS } from './royaleEngine.js';

// The right answer is only shown once the floor has dropped.
const OPEN = new Set([R_PHASE.DROP, R_PHASE.RECAP, R_PHASE.CHAMPION]);
import { RoyaleStage, PLATFORM_COLORS } from './royale3d.js';
import { GameBase, esc } from '../../arcade/gameBase.js';

const MODE_LABEL = { standard: 'STANDARD ROUND', speed: 'SPEED ROUND', sudden: 'SUDDEN DEATH' };

export class RoyaleGame extends GameBase {
  constructor(shell) {
    super(shell, 'royale', RoyaleEngine);
    this.keys = new Set();
    this.lastPlatform = -1;
    this.lastTick = 99;
    this.built = false;
    this.cardShown = '';
    const root = shell.root;
    root.innerHTML = `
      <div class="ag" data-game="royale">
        <div class="ag-view" id="tr-view"></div>
        <div class="ag-top">
          <p class="ag-chip" id="tr-mode">TRAPDOOR ROYALE</p>
          <p class="ag-chip" id="tr-round"></p>
          <p class="ag-chip ag-left" id="tr-left"></p>
          <p class="ag-chip ag-net" id="tr-net" hidden>SAFETY NET</p>
          <button type="button" class="ag-skip" id="tr-skip" hidden>SKIP TO THE END</button>
        </div>
        <section class="ag-q" id="tr-q" aria-live="polite">
          <p class="lbl" id="tr-topic"></p>
          <p class="ag-qtext" id="tr-text">Find your feet. The first question is coming.</p>
          <div class="ag-bar"><i id="tr-bar"></i></div>
          <div class="tr-answers" id="tr-answers" role="group" aria-label="Answers: choose a platform"></div>
        </section>
        <p class="ag-toast" id="tr-note" role="status"></p>
        <p class="ag-keys" id="tr-keys">Run: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows · Jump to a platform: <kbd>1</kbd>–<kbd>4</kbd> or click it · Shove (pins everyone on your platform for 2 s, once a question): <kbd>E</kbd></p>
        <section class="ag-card" id="tr-card" hidden></section>
      </div>`;
    this.el = {
      view: this.$('#tr-view'), mode: this.$('#tr-mode'), round: this.$('#tr-round'), left: this.$('#tr-left'),
      q: this.$('#tr-q'), topic: this.$('#tr-topic'), text: this.$('#tr-text'), bar: this.$('#tr-bar'), answers: this.$('#tr-answers'),
      note: this.$('#tr-note'), card: this.$('#tr-card'), net: this.$('#tr-net'), skip: this.$('#tr-skip'),
    };
    this.el.skip.addEventListener('click', () => this.skipToEnd());
    this.ffNoted = false;
    this.el.answers.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]');
      if (b && !b.disabled) this.pick(Number(b.dataset.p));
    });
    this.wireCard(this.el.card);
    this.showCard(this.howHtml());

    try {
      const renderer = this.makeRenderer(this.el.view);
      this.stage = new RoyaleStage(renderer, this.el.view, { onPick: (i) => this.pick(i) });
      this.ro = new ResizeObserver(() => this.stage.resize());
      this.ro.observe(this.el.view);
    } catch (err) {
      console.warn('[royale] no 3D arena:', err);
      this.stage = null;
      this.el.view.innerHTML = '<div class="testcard on"><div class="tc-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="tc-plate"><strong>NO SIGNAL</strong><span>No 3D arena here. Answer with the buttons or 1 to 4.</span></div></div>';
    }
  }

  isOver() { return this.engine.phase === R_PHASE.CHAMPION; }

  // ---------- input ----------
  pick(i) {
    const e = this.engine;
    const me = e.me;
    if (!me || e.phase !== R_PHASE.QUESTION) return;
    if (!me.alive) {
      // Out of the game: a call, for the record.
      if (me.call === i) return;
      this.shell.audio.blip();
      this.myCall = i;
      this.send('move', { to: i });
      this.renderAnswers();
      return;
    }
    if (me.choice === i) return;
    if (e.stunned(me)) { this.shell.audio.denied(); this.note('Pinned! You cannot move for a moment.'); return; }
    this.shell.audio.blip();
    this.send('move', { to: i });
    if (this.stage) this.stage.moveFigure(e.localId, i);
  }

  // Solo, once you are out: run the rest of the match now.
  skipToEnd() {
    if (this.role !== 'solo') return;
    const e = this.engine;
    for (let n = 0; n < 200000 && e.phase !== R_PHASE.CHAMPION; n++) e.update(1 / 30);
  }

  // Once every person at the table is out, the bots finish the match at speed.
  speedBoost() {
    const e = this.engine;
    if (this.role === 'client' || this.isOver() || e.phase === R_PHASE.INTRO) return 1;
    return e.humansAlive === 0 ? 4 : 1;
  }

  apply(seat, action, p) {
    const e = this.engine;
    if (action === 'move') return e.moveFor(seat, Number.isInteger(p.to) ? p.to : -1);
    if (action === 'shove') return e.shoveFor(seat);
    return false;
  }

  key(ev) {
    const k = ev.key;
    if (k >= '1' && k <= '4') { this.pick(Number(k) - 1); return true; }
    if (k === 'e' || k === 'E') { this.send('shove'); return true; }
    const dir = { w: 'up', W: 'up', ArrowUp: 'up', s: 'down', S: 'down', ArrowDown: 'down', a: 'left', A: 'left', ArrowLeft: 'left', d: 'right', D: 'right', ArrowRight: 'right' }[k];
    if (dir) { this.keys.add(dir); return true; }
    if (k === 'Enter' && this.isOver() && this.role !== 'client') { this.shell.again(); return true; }
    return false;
  }

  keyup(ev) {
    const dir = { w: 'up', W: 'up', ArrowUp: 'up', s: 'down', S: 'down', ArrowDown: 'down', a: 'left', A: 'left', ArrowLeft: 'left', d: 'right', D: 'right', ArrowRight: 'right' }[ev.key];
    if (dir) this.keys.delete(dir);
  }

  autopilot() {
    const e = this.engine;
    const me = e.me;
    if (!me || !me.alive || e.phase !== R_PHASE.QUESTION || me.choice != null || e.stunned(me)) return;
    if (Math.random() < 0.03) this.pick(Math.floor(Math.random() * 4));
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
        break;
      case 'round':
        this.hideCard();
        this.myCall = null;
        this.el.q.hidden = false;
        if (this.stage) this.stage.newRound(e.alive.map((p) => p.id));
        this.lastPlatform = -1;
        this.lastTick = 99;
        this.renderQuestion();
        a.whoosh();
        a.setTension(d.mode === 'sudden' ? 0.8 : d.mode === 'speed' ? 0.5 : 0.2);
        this.note(d.mode === 'sudden' ? `Sudden death. ${d.left} left. Right and slowest still drops.` : d.mode === 'speed' && d.n === R_RULES.speedFromRound ? 'Speed rounds: seven seconds from now on.' : '');
        break;
      case 'move':
        if (this.stage && d.id !== e.localId) this.stage.moveFigure(d.id, d.to);
        this.renderAnswers();
        break;
      case 'shove':
        if (this.stage) this.stage.shove(d.id, d.hit || []);
        a.knock(0.6);
        if (d.hit && d.hit.includes(e.localId)) { a.denied(); this.note(`${this.nameOf(d.id)} shoved you: pinned for two seconds.`); }
        else if (d.id === e.localId && d.hit && d.hit.length) this.note(`Shoved ${d.hit.length}: they are pinned for two seconds.`);
        this.renderAnswers();
        break;
      case 'lock': {
        const choices = {};
        for (const p of e.players) choices[p.id] = p.choice;
        if (this.stage) this.stage.lock(choices);
        a.slam();
        this.renderAnswers();
        this.note('Locked. Spotlights on.');
        break;
      }
      case 'reveal':
        if (this.stage) this.stage.reveal(d);
        this.renderQuestion();
        if (d.mercy) { a.register(); this.note('Nobody found it. The floor holds. Go again.'); break; }
        setTimeout(() => a.slam(), 450);
        if (d.fallen.includes(e.localId)) { a.trombone(); this.note(d.slow === e.localId ? 'Right, but last to arrive. Down you go.' : 'Wrong platform. Down you go. You can still call each answer from here.'); }
        else if ((d.saved || []).includes(e.localId)) { a.register(); this.note('Wrong, but your safety net catches you. It is gone now.'); }
        else if (d.net === e.localId) { a.fanfare(); this.note('First to the right platform: you earn a safety net. It saves you from one wrong answer.'); }
        else if (e.me && e.me.alive) { a.chime(); this.note(d.slow != null ? `${this.nameOf(d.slow)} was right but slowest, and drops.` : `${d.fallen.length} drop${d.fallen.length === 1 ? 's' : ''}. You are still standing.`); }
        else this.note(`${d.fallen.length} more drop${d.fallen.length === 1 ? 's' : ''}.${e.me && e.me.call === d.correct ? ' Your call was right.' : ''}`);
        if (this.stage) this.stage.nets(e.players.filter((p) => p.net && p.alive).map((p) => p.id), d.saved || []);
        break;
      case 'recap':
        this.note(`${d.left} left on the floor.`);
        break;
      case 'champion':
        if (this.stage) this.stage.champion(d.id);
        this.el.q.hidden = true;
        a.setTension(0);
        if (d.id === e.localId) a.fanfare(); else a.register();
        this.renderResults();
        break;
      case 'away':
        if (d.away) this.shell.toast(`${e.players[d.id].name} left the room.`);
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
    if (this.stage) this.stage.setPlayers(e.players.map((p) => ({ id: p.id, name: p.name, color: this.colors[p.id], alive: p.alive })), e.localId);
    this.renderQuestion();
    this.renderStatus();
  }

  // ---------- HUD ----------
  renderStatus() {
    const e = this.engine;
    this.el.mode.textContent = e.phase === R_PHASE.INTRO ? 'TRAPDOOR ROYALE' : MODE_LABEL[e.mode] || '';
    this.el.mode.dataset.mode = e.mode;
    this.el.round.textContent = e.round ? `QUESTION ${e.round}` : '';
    const me = e.me;
    const out = me && !me.alive && !this.isOver();
    this.el.left.textContent = `${e.alive.length} OF ${e.players.length} STANDING${out ? ` · YOU ARE OUT · ${me.calls} RIGHT CALL${me.calls === 1 ? '' : 'S'}` : ''}`;
    this.el.net.hidden = !(me && me.alive && me.net);
    this.el.skip.hidden = !(out && this.role === 'solo');
    if (this.speedBoost() > 1 && !this.ffNoted) { this.ffNoted = true; this.note('Every person at this table is out: the bots finish it at speed.'); }
  }

  renderQuestion() {
    const e = this.engine;
    const q = e.question;
    if (!q) { this.el.answers.innerHTML = ''; return; }
    this.el.topic.textContent = `${q.topic.toUpperCase()} · ${MODE_LABEL[e.mode]}`;
    this.el.text.textContent = q.text;
    if (this.stage) this.stage.drawBoard({ title: `Question ${e.round} · ${MODE_LABEL[e.mode]}`, text: q.text, answers: q.answers, correct: OPEN.has(e.phase) ? e.correct : -1 });
    this.renderAnswers();
  }

  renderAnswers() {
    const e = this.engine;
    const q = e.question;
    if (!q) return;
    const me = e.me;
    // The crowd is shown in the arena, where you have to read it, not counted out here.
    if (this.stage) this.stage.setCrowd(e.crowd());
    const asking = e.phase === R_PHASE.QUESTION && me;
    const pinned = asking && me.alive && e.stunned(me);
    const calling = asking && !me.alive;
    const live = asking && !pinned;
    const mine = calling ? (this.role === 'client' ? this.myCall : me.call) : me ? me.choice : null;
    this.el.answers.dataset.calling = calling ? '1' : '0';
    this.el.answers.innerHTML = q.answers.map((ans, i) => {
      let state = '';
      if (OPEN.has(e.phase) && e.correct >= 0) state = i === e.correct ? 'right' : 'wrong';
      else if (mine === i) state = 'mine';
      return `<button type="button" class="tr-ans" data-p="${i}" data-state="${state}" style="--pc:${PLATFORM_COLORS[i]}" ${live ? '' : 'disabled'}>
        <span class="tr-letter">${PLATFORM_LETTERS[i]}</span><span class="tr-text">${esc(ans)}</span><span class="tr-crowd">${calling && mine === i ? 'YOUR CALL' : pinned && mine === i ? 'PINNED' : ''}</span>
      </button>`;
    }).join('');
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

  renderResults() {
    const e = this.engine;
    const champ = e.ranking[0];
    const mine = champ === e.localId;
    const me = e.me;
    const rows = e.ranking.map((id) => {
      const p = e.players[id];
      return { name: this.rowName(p), color: this.colors[id], me: id === e.localId, note: p.alive ? 'CHAMPION' : `dropped on question ${p.outRound}${p.isHuman && p.calls ? ` · ${p.calls} right call${p.calls === 1 ? '' : 's'}` : ''}` };
    });
    const place = e.ranking.indexOf(e.localId) + 1;
    this.showCard(this.resultsHtml({
      title: mine ? 'You are the last one standing.' : `${e.players[champ].name} is the last one standing.`,
      sub: mine ? `${e.round} questions, ${e.players.length - 1} rivals through the floor.` : me ? `You finished ${place} of ${e.players.length}, out on question ${me.outRound}.` : '',
      rows,
    }));
    const b = this.el.card.querySelector('[data-ag="again"], [data-ag="exit"]');
    if (b && !this.shell.debug.auto) b.focus({ preventScroll: true });
  }

  // ---------- frame ----------
  frame(dt, reduce) {
    const e = this.engine;
    if (e.phase === R_PHASE.QUESTION) {
      const frac = e.total ? e.t / e.total : 0;
      this.el.bar.style.transform = `scaleX(${Math.max(0, frac)})`;
      this.el.bar.dataset.hot = e.t <= R_RULES.scrambleAt ? '1' : '0';
      if (this.stage) this.stage.setTime(frac, e.t <= R_RULES.scrambleAt);
      // Clock ticks speed up in the last three seconds.
      if (e.t <= R_RULES.scrambleAt) {
        const interval = e.t > 2 ? 0.5 : e.t > 1 ? 0.33 : 0.2;
        if (this.lastTick - e.t >= interval || this.lastTick > R_RULES.scrambleAt + 0.1) { this.lastTick = e.t; this.shell.audio.tick(e.t <= 1); }
      }
      // Walking with the keys picks whichever platform you end up on.
      if (this.stage && this.keys.size && e.me && e.me.alive && !e.stunned(e.me)) {
        const dx = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
        const dz = (this.keys.has('down') ? 1 : 0) - (this.keys.has('up') ? 1 : 0);
        const under = this.stage.localMove(dx, dz, dt);
        if (under >= 0 && under !== e.me.choice && under !== this.lastPlatform) { this.lastPlatform = under; this.send('move', { to: under }); this.shell.audio.blip(); }
        if (under < 0) this.lastPlatform = -1;
      }
    } else {
      this.el.bar.style.transform = 'scaleX(0)';
    }
    if (this.stage) {
      this.stage.update(dt, reduce);
      this.stage.render();
    }
  }
}
