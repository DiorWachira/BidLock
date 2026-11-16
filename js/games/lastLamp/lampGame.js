// LAST LAMP — the screen: the lighthouse in 3D, the question, the four survival games,
// the climb, and the results. Rules live in lampEngine.js and undertowMinigames.js; the
// set in lamp3d.js.

import { LampEngine, L_PHASE, EVENTS } from './lampEngine.js';
import { MINI_INFO, BUOY_SIGNS } from './undertowMinigames.js';
import { STYLE_LABEL } from '../../arcade/questionBank.js';

// The Bell Buoy's four signals: a shape and a colour each, so colour is never the only cue.
const SIGN_COLORS = ['#56B4E9', '#E69F00', '#009E73', '#CC79A7'];
const SHOW_LEAD = 0.6; // seconds before the first signal
const SHOW_STEP = 0.75; // seconds per signal
import { LampStage } from './lamp3d.js';
import { GameBase, esc } from '../../arcade/gameBase.js';

const FAIL_NOTE = { 'all-share': 'Everyone shared. The boat holds.', 'all-shove': 'Everyone shoved. Everyone is in the water.', betrayed: 'The shovers stay dry. Everyone who shared goes over.' };

export class LampGame extends GameBase {
  constructor(shell) {
    super(shell, 'lamp', LampEngine);
    this.built = false;
    this.lastTick = 99;
    const root = shell.root;
    root.innerHTML = `
      <div class="ag" data-game="lamp">
        <div class="ag-view" id="ll-view"></div>
        <div class="ag-top">
          <p class="ag-chip" id="ll-stage">LAST LAMP</p>
          <p class="ag-chip" id="ll-round"></p>
          <p class="ag-chip ag-event" id="ll-event" hidden></p>
          <p class="ag-chip ag-left" id="ll-left"></p>
        </div>
        <ol class="ll-roll" id="ll-roll" aria-label="Keepers and their flames"></ol>
        <section class="ag-q ll-panel" id="ll-panel" aria-live="polite"></section>
        <p class="ag-toast" id="ll-note" role="status"></p>
        <section class="ag-card" id="ll-card" hidden></section>
      </div>`;
    this.el = {
      view: this.$('#ll-view'), stage: this.$('#ll-stage'), round: this.$('#ll-round'), event: this.$('#ll-event'), left: this.$('#ll-left'),
      roll: this.$('#ll-roll'), panel: this.$('#ll-panel'), note: this.$('#ll-note'), card: this.$('#ll-card'),
    };
    this.el.panel.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      this.act(b.dataset.act, b.dataset);
    });
    this.wireCard(this.el.card);
    this.showCard(this.howHtml());
    try {
      const renderer = this.makeRenderer(this.el.view);
      this.stage = new LampStage(renderer, this.el.view);
      this.ro = new ResizeObserver(() => this.stage.resize());
      this.ro.observe(this.el.view);
    } catch (err) {
      console.warn('[lamp] no 3D lighthouse:', err);
      this.stage = null;
      this.el.view.innerHTML = '<div class="testcard on"><div class="tc-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="tc-plate"><strong>NO SIGNAL</strong><span>No 3D lighthouse here. The game still plays from the panels.</span></div></div>';
    }
    this.shell.audio.ambience(true);
  }

  isOver() { return this.engine.phase === L_PHASE.WINNER; }

  // ---------- input ----------
  act(kind, data) {
    const a = this.shell.audio;
    a.blip();
    if (kind === 'answer') { this.myAnswer = Number(data.i); this.send('answer', { i: Number(data.i) }); }
    else if (kind === 'plank') this.send('mini', { plank: Number(data.i) });
    else if (kind === 'sum') this.send('mini', { option: Number(data.i) });
    else if (kind === 'boat') this.send('mini', { shove: data.v === 'shove' });
    else if (kind === 'pull') this.send('mini', { spin: data.v === 'spin' });
    else if (kind === 'tally') { this.myTally = Number(data.i); this.send('mini', { option: Number(data.i) }); }
    else if (kind === 'sign') this.send('mini', { sign: Number(data.i) });
    else if (kind === 'manifest') { const v = this.engine.miniView(); this.myManifest = { n: v ? v.n : 0, i: Number(data.i) }; this.send('mini', { answer: Number(data.i) }); }
    else if (kind === 'mark') {
      this.marks = this.marks || [null, null, null];
      this.marks[Number(data.i)] = data.v === 'true';
      this.send('mark', { i: Number(data.i), v: data.v === 'true' });
    }
    this.renderPanel();
  }

  apply(seat, action, p) {
    const e = this.engine;
    if (action === 'answer') return e.answerFor(seat, Number.isInteger(p.i) ? p.i : -1);
    if (action === 'mini') {
      const payload = {};
      if (Number.isInteger(p.plank)) payload.plank = p.plank;
      if (Number.isInteger(p.option)) payload.option = p.option;
      if (typeof p.shove === 'boolean') payload.shove = p.shove;
      if (typeof p.spin === 'boolean') payload.spin = p.spin;
      if (Number.isInteger(p.sign)) payload.sign = p.sign;
      if (Number.isInteger(p.answer)) payload.answer = p.answer;
      return e.miniFor(seat, payload);
    }
    if (action === 'mark') return e.markFor(seat, Number.isInteger(p.i) ? p.i : -1, p.v);
    return false;
  }

  key(ev) {
    const k = ev.key;
    const e = this.engine;
    if (k === 'Enter' && this.isOver() && this.role !== 'client') { this.shell.again(); return true; }
    if (k < '1' || k > '6') return false;
    const n = Number(k) - 1;
    if (e.phase === L_PHASE.QUESTION && n < 4) { this.act('answer', { i: n }); return true; }
    const v = e.miniView();
    if (e.phase === L_PHASE.MINI && v) {
      const me = e.localId;
      if (v.kind === 'planks' && n < v.count && ((v.stage === 'rig' && v.saboteur === me) || (v.stage === 'step' && v.steppers.includes(me)))) { this.act('plank', { i: n }); return true; }
      if (v.kind === 'tide' && n < 3 && v.crew.includes(me)) { this.act('sum', { i: n }); return true; }
      if (v.kind === 'lifeboat' && n < 2 && v.crew.includes(me)) { this.act('boat', { v: n === 0 ? 'share' : 'shove' }); return true; }
      if (v.kind === 'capstan' && n < 2 && v.current === me) { this.act('pull', { v: n === 0 ? 'pull' : 'spin' }); return true; }
      if (v.kind === 'tally' && n < 4 && v.crew.includes(me) && v.stage === 'play') { this.act('tally', { i: n }); return true; }
      if (v.kind === 'buoy' && n < 4 && v.crew.includes(me) && v.stage === 'play') { this.act('sign', { i: n }); return true; }
      if (v.kind === 'manifest' && n < 4 && v.crew.includes(me) && v.stage === 'q') { this.act('manifest', { i: n }); return true; }
    }
    return false;
  }

  autopilot() {
    const e = this.engine;
    const me = e.me;
    if (!me || Math.random() > 0.04) return;
    if (e.phase === L_PHASE.QUESTION && me.answer == null) this.send('answer', { i: Math.floor(Math.random() * 4) });
    else if (e.phase === L_PHASE.MINI) {
      const v = e.miniView();
      if (!v) return;
      if (v.kind === 'planks') this.send('mini', { plank: Math.floor(Math.random() * v.count) });
      else if (v.kind === 'tide' && v.crew.includes(me.id)) this.send('mini', { option: Math.floor(Math.random() * 3) });
      else if (v.kind === 'lifeboat') this.send('mini', { shove: Math.random() < 0.5 });
      else if (v.kind === 'capstan' && v.current === me.id) this.send('mini', { spin: false });
      else if (v.kind === 'tally') this.send('mini', { option: Math.floor(Math.random() * 4) });
      else if (v.kind === 'buoy' && v.stage === 'play') this.send('mini', { sign: Math.floor(Math.random() * 4) });
      else if (v.kind === 'manifest' && v.stage === 'q') this.send('mini', { answer: Math.floor(Math.random() * 4) });
    } else if (e.phase === L_PHASE.SPRINT) {
      this.send('mark', { i: Math.floor(Math.random() * 3), v: Math.random() < 0.5 });
    }
  }

  // ---------- engine events ----------
  onEvent(type, d) {
    const e = this.engine;
    const a = this.shell.audio;
    const S = this.stage;
    this.ensureColors();
    if (!this.built && e.players.length) this.build();
    switch (type) {
      case 'matchStart':
        this.build();
        break;
      case 'question':
        this.myAnswer = null;
        this.hideCard();
        this.lastTick = 99;
        if (S) { S.toRoom(e.players.map((p) => p.id)); S.question(); S.sync(e.players); }
        a.setTension(0.2 + Math.min(0.5, d.n * 0.07));
        this.wasFoggy = e.foggy;
        this.el.event.hidden = !d.event;
        if (d.event) {
          this.el.event.textContent = EVENTS[d.event].name.toUpperCase();
          if (d.event === 'lightning') { a.thunder(); if (S) S.thunder(); } else a.siren();
          this.note(EVENTS[d.event].line);
        } else {
          this.note(d.n === 1 ? 'Answer in secret. Wrong answers go down the hatch.' : '');
        }
        break;
      case 'answered':
        if (S) S.answered(d.id);
        break;
      case 'reveal':
        if (S) S.reveal(d.safe, d.down);
        if (d.down.includes(e.localId)) { a.buzzer(); this.note('Wrong. The hatch is opening under you.'); }
        else if (d.safe.includes(e.localId)) { a.chime(); this.note('Right. Stay by the fire.'); }
        else if (e.me && e.me.ghost) { if (e.me.answer === d.correct) a.chime(); this.note(e.me.answer === d.correct ? 'Right. Wraiths who know things climb faster at the end.' : 'Wrong. It costs a wraith nothing.'); }
        if (!d.down.length) this.note('Everyone was right. Nobody goes down.');
        if (d.struck != null) {
          a.thunder();
          if (S) { S.thunder(); S.reveal([], [d.struck]); }
          this.note(d.struck === e.localId ? 'Right, but the slowest: the lightning takes you down the hatch.' : `Lightning: ${this.nameOf(d.struck)} was right but slowest, and goes down too.`);
        }
        if (d.relit && d.relit.length) {
          if (S) S.sync(e.players);
          if (d.relit.includes(e.localId)) { a.chime(); this.shell.toast('Calm water: one of your flames is relit.'); }
        }
        break;
      case 'descent':
        if (S) S.descend(d.crew, d.kind);
        a.slam();
        setTimeout(() => a.riser(1.8), 300);
        this.note(`${d.crew.length === 1 ? this.nameOf(d.crew[0]) + ' drops' : `${d.crew.length} keepers drop`} into the Undertow: ${MINI_INFO[d.kind].name}.`);
        break;
      case 'miniStart': {
        const v = e.miniView();
        if (S) S.startMini(d.kind, d.crew, { count: v ? v.count : 4, saboteur: d.saboteur });
        a.setTension(0.7);
        this.marks = null;
        this.myTally = null;
        this.myManifest = null;
        this.buoyLit = -2;
        if (d.kind === 'planks' && d.saboteur === e.localId && !d.crew.includes(e.localId)) this.note('You were right, so you loosen a plank. Catch someone.');
        else this.note(MINI_INFO[d.kind].line);
        break;
      }
      case 'mini':
        this.onMini(d);
        break;
      case 'miniResult':
        for (const id of d.losers) { if (S) S.snuff(id, d.snuffed.includes(id)); }
        if (S) S.sync(e.players);
        a.setTension(0.3);
        if (d.losers.includes(e.localId)) { if (d.snuffed.includes(e.localId)) { a.trombone(); this.note('Your last flame goes out. You are a wraith now. Keep answering.'); } else { a.buzzer(); this.note(`You lose ${d.cost === 2 ? 'two flames' : 'a flame'}.`); } }
        else if (d.losers.length) this.note(`${d.losers.map((id) => this.nameOf(id)).join(', ')} lose${d.losers.length === 1 ? 's' : ''} ${d.cost === 2 ? 'two flames' : 'a flame'}${d.snuffed.length ? `. ${d.snuffed.map((id) => this.nameOf(id)).join(', ')} ${d.snuffed.length === 1 ? 'is' : 'are'} snuffed out` : ''}.`);
        else this.note('Everyone gets out of the Undertow with their flames.');
        if (d.mercy) this.shell.toast('The lamp cannot go fully dark: the last keepers hold on with one flame.');
        if (d.relit && d.relit.length) { if (S) S.sync(e.players); if (d.relit.includes(e.localId)) { a.chime(); this.shell.toast('You caught someone on the loose plank: one of your flames is relit.'); } }
        break;
      case 'finaleStart':
        if (S) S.finale(e.players);
        a.siren();
        a.setTension(0.8);
        this.note('The storm breaks the lower door. Climb. True or false, three at a time.');
        break;
      case 'sprint':
        this.marks = [null, null, null];
        this.lastTick = 99;
        break;
      case 'marked':
        break;
      case 'sprintResult':
        if (S) S.climb(e.players, d.water);
        a.whoosh();
        if (d.steals.length) { a.alarm(); }
        this.note(this.sprintNote(d));
        break;
      case 'winner':
        if (S) S.lightLamp(d.id);
        a.setTension(0);
        if (d.id === e.localId) a.fanfare(); else a.trombone();
        this.renderResults();
        break;
      case 'away':
        if (d.away) this.shell.toast(`${e.players[d.id].name} left the room.`);
        break;
      default:
        break;
    }
    this.renderStatus();
    this.renderPanel();
  }

  onMini(d) {
    const S = this.stage;
    const a = this.shell.audio;
    const e = this.engine;
    if (d.kind === 'planks') {
      if (d.step === 'rigged') { a.knock(0.8); this.note('A plank has been loosened. Pick where you stand.'); }
      if (d.step === 'picked' && S) { const v = e.miniView(); S.plankPick(d.id, d.plank, v ? v.count : 4); a.knock(0.5); }
      if (d.step === 'reveal') { if (S) S.plankReveal(d.rigged, d.losers); a.slam(); this.note(d.backfired ? 'Nobody stood on the loose plank. The saboteur goes through it instead.' : `Plank ${d.rigged + 1} gives way.`); }
    } else if (d.kind === 'tide') {
      if (d.step === 'answer') { if (S) S.pump(d.id, d.right); if (d.id === e.localId) (d.right ? a.knock(0.7) : a.denied()); }
      if (d.step === 'reveal') a.whoosh();
    } else if (d.kind === 'lifeboat') {
      if (d.step === 'chosen') a.knock(0.4);
      if (d.step === 'reveal') { if (S) S.lifeboatReveal(d.choices, d.losers); a.slam(); this.note(FAIL_NOTE[d.outcome] || ''); }
    } else if (d.kind === 'capstan') {
      if (d.step === 'pull') {
        if (S) { if (d.spin) S.capstanSpin(); S.capstanPull(d.id, d.struck, d.pull); }
        if (d.struck) { a.thunder(); a.slam(); } else a.knock(1);
        this.note(d.struck ? `${this.nameOf(d.id)} ${d.id === e.localId ? 'are' : 'is'} struck.` : `${this.nameOf(d.id)} ${d.spin ? 'spun the wheel and ' : ''}pulled. Nothing.`);
      }
      if (d.step === 'turn' && d.id === e.localId) { a.heartbeat(); this.note('Your turn at the wheel.'); }
      if (d.step === 'reveal' && !d.losers.length) this.note('The storm passes over the capstan. Nobody is struck.');
    } else if (d.kind === 'tally') {
      if (d.step === 'chosen') a.knock(0.4);
      if (d.step === 'reveal') { a.slam(); this.note(d.losers.length ? `The answer was ${this.fmt(d.truth)}. Furthest off: ${d.losers.map((id) => this.nameOf(id)).join(', ')}.` : `The answer was ${this.fmt(d.truth)}. Nobody was furthest off.`); }
    } else if (d.kind === 'buoy') {
      if (d.step === 'go') { a.whoosh(); this.note('Now signal it back.'); }
      if (d.step === 'signal' && d.id === e.localId) { if (d.ok) a.blip(); else { a.buzzer(); this.note('Wrong signal. You are under.'); } }
      if (d.step === 'reveal') a.slam();
      if (S && d.step === 'go') S.buoyLight(null);
    } else if (d.kind === 'manifest') {
      if (d.step === 'answered') a.knock(0.4);
      if (d.step === 'show') { const v = e.miniView(); if (v && v.answers && v.answers[e.localId] != null) (v.answers[e.localId] === v.correct ? a.chime() : a.buzzer()); }
      if (d.step === 'reveal') a.slam();
    }
  }

  // Numbers the way people say them: 384,400 km; 13.8 billion years; the year 1969.
  fmt(n, unit = null) {
    const v = this.engine.miniView();
    const u = unit != null ? unit : v && v.q ? v.q.unit : '';
    const num = Number.isInteger(n) && n >= 1000 && n <= 2100 && !u ? String(n) : Number(n).toLocaleString('en-GB');
    return u ? `${num} ${u}` : num;
  }

  sprintNote(d) {
    const e = this.engine;
    const parts = [];
    for (const s of d.steals) parts.push(`${this.nameOf(s.wraith)} catches ${this.nameOf(s.keeper)} and takes the lantern`);
    for (const id of d.drowned) parts.push(`the water reaches ${this.nameOf(id)}`);
    if (d.relit != null) parts.push(`${this.nameOf(d.relit)} relights a lantern in the dark`);
    const mine = d.moves[e.localId];
    const lead = mine == null ? '' : `You climb ${mine} step${mine === 1 ? '' : 's'}.`;
    return `${lead} ${parts.length ? parts.join('; ') + '.' : ''}`.trim();
  }

  build() {
    const e = this.engine;
    if (!e.players.length) return;
    this.built = true;
    this.ensureColors();
    if (this.stage) {
      this.stage.buildStairs(e.R.stairs);
      this.stage.setPlayers(e.players.map((p) => ({ id: p.id, name: p.name, color: this.colors[p.id], flames: p.flames, ghost: p.ghost })), e.localId);
    }
    this.renderStatus();
  }

  // ---------- HUD ----------
  renderStatus() {
    const e = this.engine;
    const ph = e.phase;
    const label = ph === L_PHASE.INTRO ? 'LAST LAMP' : [L_PHASE.DESCENT, L_PHASE.MINI, L_PHASE.MINI_RESULT].includes(ph) ? 'THE UNDERTOW' : [L_PHASE.FINALE_INTRO, L_PHASE.SPRINT, L_PHASE.SPRINT_RESULT].includes(ph) ? 'THE CLIMB' : ph === L_PHASE.WINNER ? 'THE LAMP ROOM' : 'THE WATCH ROOM';
    this.el.stage.textContent = label;
    this.el.round.textContent = e.finale ? `SPRINT ${e.finale.sprint || 0}` : e.round ? `QUESTION ${e.round} OF UP TO ${e.R.maxRounds}` : '';
    this.el.left.textContent = `${e.keepers.length} LIT · ${e.wraiths.length} WRAITH${e.wraiths.length === 1 ? '' : 'S'}`;
    this.el.roll.innerHTML = e.players.map((p) => {
      const lamps = Array.from({ length: e.R.flames }, (_, i) => `<i data-on="${i < p.flames ? 1 : 0}"></i>`).join('');
      const haunt = Math.min(e.R.maxHaunt, Math.floor((p.wraithRight || 0) / 2));
      const state = p.ghost ? (e.finale ? 'WRAITH' : `WRAITH${haunt ? ` +${haunt}` : ''}`) : '';
      const beacon = !e.finale && p.beacon ? `<em>BEACON +${p.beacon}</em>` : '';
      const answered = e.phase === L_PHASE.QUESTION && p.answer != null ? '<u title="answered">✓</u>' : '';
      const step = e.finale ? `<em>STEP ${p.step}</em>` : '';
      return `<li style="--who:${this.colors[p.id]}" data-ghost="${p.ghost ? 1 : 0}" data-me="${p.id === e.localId ? 1 : 0}"><b>${esc(p.id === e.localId ? 'YOU' : p.name)}</b><span class="ll-flames" aria-label="${p.flames} flames">${lamps}</span>${state ? `<span class="ll-tag">${state}</span>` : ''}${beacon}${step}${answered}</li>`;
    }).join('');
  }

  renderPanel() {
    const e = this.engine;
    const el = this.el.panel;
    const me = e.me;
    const ph = e.phase;
    let html = '';
    if (ph === L_PHASE.QUESTION || ph === L_PHASE.REVEAL) {
      const q = e.question;
      if (!q) { el.innerHTML = ''; return; }
      const shown = ph === L_PHASE.REVEAL;
      // A guest only learns everyone's answers at the reveal, so it remembers its own.
      const mine = !shown && this.role === 'client' ? this.myAnswer : me ? me.answer : null;
      const style = STYLE_LABEL[q.style] ? ` · ${STYLE_LABEL[q.style]}` : '';
      const ev = e.event ? ` · ${EVENTS[e.event].name.toUpperCase()}` : '';
      const fog = !q.answers || e.foggy;
      html = `<p class="lbl">${esc(q.topic.toUpperCase())}${style}${ev} · ${me && me.ghost ? 'YOU ARE A WRAITH: ANSWER ANYWAY' : 'ANSWER IN SECRET'}</p>
        <p class="ag-qtext">${esc(q.text)}</p>
        <div class="ag-bar"><i data-bar></i></div>
        <div class="ll-answers">${(q.answers || ['', '', '', '']).map((ans, i) => {
          let st = '';
          if (shown) st = i === e.correct ? 'right' : mine === i ? 'wrong' : 'dim';
          else if (mine === i) st = 'mine';
          return `<button type="button" class="ans" data-act="answer" data-i="${i}" data-state="${st}" ${shown || fog ? 'disabled' : ''}><kbd>${i + 1}</kbd><span>${fog ? 'Fog on the glass…' : esc(ans)}</span></button>`;
        }).join('')}</div>
        <p class="ll-hint">${shown ? (e.reveal && e.reveal.struck != null ? 'Lightning: the slowest right answer goes down too.' : '') : fog ? 'The fog clears in a moment.' : mine != null && mine >= 0 ? 'Locked in. You can still change it.' : 'Nobody sees your answer until the clock runs out.'}</p>`;
    } else if (ph === L_PHASE.DESCENT) {
      html = `<p class="lbl">THE UNDERTOW</p><p class="ag-qtext">${esc(MINI_INFO[e.pendingMini || 'tide'].name)}</p><p class="ll-hint">${esc(MINI_INFO[e.pendingMini || 'tide'].line)}</p>`;
    } else if (ph === L_PHASE.MINI || ph === L_PHASE.MINI_RESULT) {
      html = this.miniHtml();
    } else if (ph === L_PHASE.FINALE_INTRO) {
      html = `<p class="lbl">THE CLIMB</p><p class="ag-qtext">The lower door gives way and the sea comes in. ${e.R.stairs} steps to the lamp room.</p><p class="ll-hint">Each sprint shows three statements. Mark each one true or false: every right mark is a step up. Keepers start a step higher for every spare flame. Wraiths drift up ${e.R.wraithFloat} extra steps a sprint, and a wraith that reaches your step takes your lantern and knocks you back ${e.R.knockback}. Beacon answers count as steps.</p>`;
    } else if (ph === L_PHASE.SPRINT || ph === L_PHASE.SPRINT_RESULT) {
      html = this.sprintHtml();
    }
    el.innerHTML = html;
    el.hidden = !html;
  }

  miniHtml() {
    const e = this.engine;
    const v = ph(e) === L_PHASE.MINI_RESULT && e.miniLast ? e.miniLast.view : e.miniView();
    if (!v) return '';
    const me = e.localId;
    const name = (id) => esc(id === me ? 'You' : e.players[id].name);
    const info = MINI_INFO[v.kind];
    const inCrew = v.crew.includes(me);
    let body = '';
    if (v.kind === 'planks') {
      const rig = v.stage === 'rig';
      const canRig = rig && v.saboteur === me;
      const canStep = v.stage === 'step' && v.steppers.includes(me);
      const mine = v.picks[me];
      body = `<p class="ll-hint">${rig ? `${name(v.saboteur)} ${v.saboteur === me ? 'choose' : 'chooses'} a plank to loosen. Catch someone and the saboteur relights a flame.` : v.stage === 'step' ? `${v.steppers.map(name).join(', ')}: pick a plank. One of them is loose.` : ''}</p>
        <div class="ll-planks" style="--n:${v.count}">${Array.from({ length: v.count }, (_, i) => {
          const who = Object.entries(v.picks).filter(([, p]) => p === i).map(([id]) => name(Number(id)));
          const st = v.rigged === i ? 'loose' : mine === i ? 'mine' : '';
          return `<button type="button" class="ll-plank" data-act="plank" data-i="${i}" data-state="${st}" ${canRig || canStep ? '' : 'disabled'}><kbd>${i + 1}</kbd><span>${who.join(', ')}</span></button>`;
        }).join('')}</div>`;
    } else if (v.kind === 'tide') {
      const p = v.problem[me];
      body = `<div class="ll-tide">${v.crew.map((id) => `<div class="ll-pump"><b>${name(id)}</b><span class="ll-meter"><i style="width:${(v.progress[id] / v.target) * 100}%"></i></span><em>${v.progress[id]}/${v.target}</em></div>`).join('')}</div>
        ${inCrew && p && v.stage === 'play' && v.progress[me] < v.target ? `<p class="ag-qtext ll-sum">${esc(p.text)} = ?</p><div class="ll-options">${p.options.map((o, i) => `<button type="button" class="ans" data-act="sum" data-i="${i}"><kbd>${i + 1}</kbd><span>${o}</span></button>`).join('')}</div>` : `<p class="ll-hint">${inCrew && v.progress[me] >= v.target ? 'You are clear of the water.' : 'Five right sums each before the water wins. A wrong one costs a stroke.'}</p>`}`;
    } else if (v.kind === 'lifeboat') {
      const chosen = (v.chosen || []).includes(me);
      body = `<p class="ll-hint">${v.crew.map(name).join(', ')}. If everyone shares, everyone is safe. Anyone who shoves stays dry, and everyone who shared goes over. If everyone shoves, everyone goes over.</p>
        ${inCrew && v.stage === 'play' ? `<div class="ll-options ll-two"><button type="button" class="btn" data-act="boat" data-v="share" ${chosen ? 'disabled' : ''}><span class="b-label">SHARE THE BOAT</span><kbd>1</kbd></button><button type="button" class="btn btn-live" data-act="boat" data-v="shove" ${chosen ? 'disabled' : ''}><span class="b-label">SHOVE</span><kbd>2</kbd></button></div>` : ''}
        <p class="ll-hint">${v.stage === 'reveal' ? v.crew.map((id) => `${name(id)}: ${v.choices[id] === 'shove' ? 'SHOVED' : 'SHARED'}`).join(' · ') : `Chosen: ${(v.chosen || []).length} of ${v.crew.length}${chosen ? ' (you)' : ''}`}</p>`;
    } else if (v.kind === 'capstan') {
      const mine = v.current === me && v.stage === 'turn';
      const odds = v.risk ? Math.round(1 / v.risk) : 0;
      body = `<p class="ll-hint">Six sockets, one holds the lightning. Pull the next socket, or spin the wheel for a fresh one-in-six and pull twice. ${v.pulls} of ${v.maxPulls} pulls made.</p>
        ${v.stage !== 'reveal' && odds ? `<p class="ll-odds">Next socket: <b>${odds === 1 ? 'certain' : `1 in ${odds}`}</b> · spin and pull twice: <b>about 1 in 3</b></p>` : ''}
        <ol class="ll-order">${v.order.map((id) => `<li data-now="${id === v.current && v.stage !== 'reveal' ? 1 : 0}">${name(id)}</li>`).join('')}</ol>
        ${mine ? '<div class="ll-options ll-two"><button type="button" class="btn btn-live" data-act="pull" data-v="pull"><span class="b-label">PULL</span><kbd>1</kbd></button><button type="button" class="btn" data-act="pull" data-v="spin"><span class="b-label">SPIN, PULL TWICE</span><kbd>2</kbd></button></div>' : ''}`;
    } else if (v.kind === 'tally') {
      const reveal = v.stage === 'reveal';
      const mine = reveal ? v.picks[me] : this.myTally;
      const chose = (v.chosen || []).includes(me);
      body = `<p class="ag-qtext">${esc(v.q.text)}</p>
        <p class="ll-hint">${reveal ? '' : 'Pick the number you think is closest. You do not have to be right: the furthest guess loses.'}${v.q.unit ? ` In ${esc(v.q.unit)}.` : ''}</p>
        <div class="ll-tally">${v.q.options.map((o, i) => {
          const who = reveal ? v.crew.filter((id) => v.picks[id] === i).map(name).join(', ') : '';
          const st = reveal ? (v.losers.length && v.crew.some((id) => v.picks[id] === i && v.losers.includes(id)) ? 'wrong' : mine === i ? 'right' : 'dim') : mine === i ? 'mine' : '';
          return `<button type="button" class="ans" data-act="tally" data-i="${i}" data-state="${st}" ${inCrew && !reveal ? '' : 'disabled'}><span>${esc(this.fmt(o, ''))}${who ? `<br><small>${who}</small>` : ''}</span></button>`;
        }).join('')}</div>
        ${reveal ? `<p class="ll-truth">The answer: ${esc(this.fmt(v.truth))}</p>` : `<p class="ll-hint">Chosen: ${(v.chosen || []).length} of ${v.crew.length}${chose ? ' (you)' : ''}</p>`}`;
    } else if (v.kind === 'buoy') {
      const showing = v.stage === 'show';
      const elapsed = (v.total || 0) - v.t;
      const lit = showing ? Math.floor((elapsed - SHOW_LEAD) / SHOW_STEP) : -1;
      const sign = (k, extra = '') => `<span class="ll-sign" style="--sc:${SIGN_COLORS[k]}" ${extra}>${BUOY_SIGNS[k]}</span>`;
      // While it plays, only the current signal shows: the rest is memory.
      const blank = (txt = '') => `<span class="ll-sign" style="--sc:#414952">${txt}</span>`;
      const seqRow = v.seq
        ? v.seq.map((k, i) => (showing ? (i === lit ? sign(k, 'data-lit="1"') : blank(i < lit ? '✓' : '')) : sign(k, 'data-lit="1"'))).join('')
        : Array.from({ length: v.length }, (_, i) => blank(i < (v.progress[me] || 0) ? '✓' : '?')).join('');
      const done = (id) => (v.failed[id] ? 'fail' : v.progress[id] >= v.length ? 'done' : '');
      body = `<p class="ll-hint">${showing ? `Watch the buoy: ${v.length} signals. Remember them in order.` : v.stage === 'play' ? 'Signal the pattern back, in order. One wrong signal and you are under.' : 'The pattern was:'}</p>
        <div class="ll-signs">${seqRow}</div>
        ${v.stage === 'play' && inCrew && !v.failed[me] && v.progress[me] < v.length ? `<div class="ll-signpad">${[0, 1, 2, 3].map((k) => `<button type="button" class="ans" data-act="sign" data-i="${k}" style="--sc:${SIGN_COLORS[k]}"><kbd>${k + 1}</kbd>${BUOY_SIGNS[k]}</button>`).join('')}</div><p class="ll-hint">You have signalled ${v.progress[me]} of ${v.length}.</p>` : ''}
        <div class="ll-dots">${v.crew.map((id) => `<span data-s="${done(id)}">${name(id)} ${v.progress[id]}/${v.length}</span>`).join('')}</div>`;
    } else if (v.kind === 'manifest') {
      const open = v.stage !== 'q';
      const mine = open ? v.answers[me] : this.myManifest && this.myManifest.n === v.n ? this.myManifest.i : null;
      body = `<p class="ll-hint">Question ${Math.min(v.n + 1, v.of)} of ${v.of}. Get ${v.need} right to climb out. ${esc(v.q.topic)}.</p>
        <p class="ag-qtext">${esc(v.q.text)}</p>
        <div class="ll-answers">${v.q.answers.map((ans, i) => {
          const st = open ? (i === v.correct ? 'right' : mine === i ? 'wrong' : 'dim') : mine === i ? 'mine' : '';
          return `<button type="button" class="ans" data-act="manifest" data-i="${i}" data-state="${st}" ${inCrew && !open && mine == null ? '' : 'disabled'}><kbd>${i + 1}</kbd><span>${esc(ans)}</span></button>`;
        }).join('')}</div>
        <div class="ll-dots">${v.crew.map((id) => `<span data-s="${v.score[id] >= v.need ? 'done' : ''}">${name(id)} ${v.score[id]}/${v.need}</span>`).join('')}</div>`;
    }
    const relit = e.miniLast && e.miniLast.relit && e.miniLast.relit.length ? ` ${e.miniLast.relit.map(name).join(', ')} relight${e.miniLast.relit.length === 1 ? 's' : ''} a flame.` : '';
    const result = ph(e) === L_PHASE.MINI_RESULT && e.miniLast ? `<p class="ll-result">${e.miniLast.losers.length ? `${e.miniLast.losers.map(name).join(', ')} lose${e.miniLast.losers.length === 1 ? 's' : ''} ${e.miniLast.cost === 2 ? 'two flames' : 'a flame'}.` : 'Nobody loses a flame.'}${relit}</p>` : '';
    return `<p class="lbl">THE UNDERTOW · ${esc(info.name.toUpperCase())}</p>${v.kind !== 'tide' ? `<div class="ag-bar"><i data-bar></i></div>` : '<div class="ag-bar"><i data-bar></i></div>'}${body}${result}`;
  }

  sprintHtml() {
    const e = this.engine;
    const f = e.finale;
    if (!f || !f.statements) return '';
    const shown = e.phase === L_PHASE.SPRINT_RESULT;
    const marks = this.marks || [null, null, null];
    const rows = f.statements.map((s, i) => {
      const truth = shown && f.last ? f.last.truths[i] : null;
      const mark = marks[i];
      const st = (v) => (truth == null ? (mark === v ? 'mine' : '') : truth === v ? 'right' : mark === v ? 'wrong' : 'dim');
      return `<li><p class="ll-stmt"><span>${esc(s.q)}</span> <b>→ ${esc(s.a)}</b></p>
        <div class="ll-tf"><button type="button" class="ans" data-act="mark" data-i="${i}" data-v="true" data-state="${st(true)}" ${shown ? 'disabled' : ''}>TRUE</button><button type="button" class="ans" data-act="mark" data-i="${i}" data-v="false" data-state="${st(false)}" ${shown ? 'disabled' : ''}>FALSE</button></div></li>`;
    }).join('');
    const ladder = Array.from({ length: e.R.stairs + 1 }, (_, k) => {
      const step = e.R.stairs - k;
      const here = e.players.filter((p) => p.step === step);
      const wet = step <= f.water;
      return `<li data-wet="${wet ? 1 : 0}"><span>${step === e.R.stairs ? 'LAMP' : step}</span>${here.map((p) => `<i style="--who:${this.colors[p.id]}" data-ghost="${p.ghost ? 1 : 0}" title="${esc(p.name)}">${esc((p.id === e.localId ? 'YOU' : p.name).slice(0, 3))}</i>`).join('')}</li>`;
    }).join('');
    return `<p class="lbl">THE CLIMB · SPRINT ${f.sprint} · WATER AT STEP ${Math.max(0, f.water)}</p>
      <div class="ag-bar"><i data-bar></i></div>
      <div class="ll-climb"><ol class="ll-stmts">${rows}</ol><ol class="ll-ladder" aria-label="The stairs">${ladder}</ol></div>`;
  }

  note(text) {
    const n = this.el.note;
    n.textContent = text || '';
    n.classList.remove('on');
    if (!text) return;
    void n.offsetWidth;
    n.classList.add('on');
  }

  showCard(html) { this.el.card.innerHTML = html; this.el.card.hidden = false; }
  hideCard() { this.el.card.hidden = true; }

  renderResults() {
    const e = this.engine;
    const win = e.winner;
    const mine = win === e.localId;
    const rows = e.ranking.map((id) => {
      const p = e.players[id];
      return { name: this.rowName(p), color: this.colors[id], me: id === e.localId, note: id === win ? 'LIT THE LAMP' : p.ghost ? `wraith · step ${p.step}` : `${p.flames} flame${p.flames === 1 ? '' : 's'} · step ${p.step}` };
    });
    this.showCard(this.resultsHtml({
      title: mine ? 'You light the lamp.' : `${e.players[win].name} lights the lamp.`,
      sub: mine ? 'The ships see it. The storm can do what it likes now.' : `You finish ${e.ranking.indexOf(e.localId) + 1} of ${e.players.length}.`,
      rows,
    }));
    const b = this.el.card.querySelector('[data-ag="again"], [data-ag="exit"]');
    if (b && !this.shell.debug.auto) b.focus({ preventScroll: true });
  }

  // ---------- frame ----------
  frame(dt, reduce) {
    const e = this.engine;
    const bar = this.el.panel.querySelector('[data-bar]');
    let frac = 0;
    let timed = false;
    if (e.phase === L_PHASE.QUESTION || e.phase === L_PHASE.SPRINT) { timed = true; frac = e.total ? e.t / e.total : 0; }
    const v = e.phase === L_PHASE.MINI ? e.miniView() : null;
    // The fog clears.
    if (e.phase === L_PHASE.QUESTION && this.wasFoggy && !e.foggy && e.question && e.question.answers) {
      this.wasFoggy = false;
      this.renderPanel();
      this.shell.audio.whoosh();
    }
    // The Bell Buoy flashes its pattern, one signal at a time.
    if (v && v.kind === 'buoy') {
      const lit = v.stage === 'show' ? Math.floor(((v.total || 0) - v.t - SHOW_LEAD) / SHOW_STEP) : -1;
      if (lit !== this.buoyLit) {
        this.buoyLit = lit;
        const sign = v.seq && lit >= 0 && lit < v.seq.length ? v.seq[lit] : null;
        if (this.stage) this.stage.buoyLight(sign == null ? null : SIGN_COLORS[sign]);
        if (sign != null) this.shell.audio.countUp(sign * 2);
        this.renderPanel();
      }
    }
    if (v && (v.stage === 'play' || v.stage === 'rig' || v.stage === 'step' || v.stage === 'turn' || v.stage === 'q')) {
      timed = true;
      const full = v.total || (v.kind === 'capstan' ? 7 : v.kind === 'lifeboat' ? 10 : v.stage === 'rig' ? 8 : 9);
      frac = v.t / full;
      if (v.kind === 'tide' && this.stage) this.stage.tideLevel(frac);
    }
    if (bar) { bar.style.transform = `scaleX(${timed ? Math.max(0, Math.min(1, frac)) : 0})`; bar.dataset.hot = timed && frac < 0.25 ? '1' : '0'; }
    const left = timed ? (e.phase === L_PHASE.MINI && v ? v.t : e.t) : 99;
    if (timed && left <= 3) {
      const interval = left > 2 ? 0.5 : left > 1 ? 0.33 : 0.2;
      if (this.lastTick - left >= interval || this.lastTick > 3.1) { this.lastTick = left; this.shell.audio.tick(left <= 1); }
    } else if (!timed || left > 3.2) this.lastTick = 99;
    // Mirrors only learn the minigame's numbers from snapshots, so redraw while one runs.
    if (e.phase === L_PHASE.MINI && this.role === 'client') {
      this.redrawAcc = (this.redrawAcc || 0) + dt;
      if (this.redrawAcc > 0.5) { this.redrawAcc = 0; this.renderPanel(); }
    }
    if (this.stage) {
      if (this.stage.update(dt, reduce)) setTimeout(() => this.shell.audio.thunder(), 250 + Math.random() * 600);
      this.stage.render();
    }
  }

  stop() {
    this.shell.audio.ambience(false);
    super.stop();
  }
}

function ph(e) { return e.phase; }
