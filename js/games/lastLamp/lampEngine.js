// LAST LAMP — rules engine. Pure: no DOM, audio or rendering. Deterministic for a seed.
//
// A storm, a lighthouse, and keepers with three flames each. Every round everyone
// answers a question in secret. Keepers who are wrong drop to the Undertow for a
// survival game, and the losers each lose a flame. A keeper with no flames becomes a
// wraith, who keeps answering. When two keepers or fewer are left (or after seven
// rounds) it ends on the stairs: true-or-false sprints up to the lamp room, with the
// water rising behind and wraiths taking the lantern of any keeper they catch.

import { mulberry32 } from '../../engine/auctionEngine.js';
import { QuizBank } from '../../arcade/quizBank.js';
import { botProfile, botAnswer } from '../../arcade/bots.js';
import { MINI_KINDS, makeMini, playable } from './undertowMinigames.js';

export const L_PHASE = Object.freeze({
  IDLE: 'IDLE', INTRO: 'INTRO', QUESTION: 'QUESTION', REVEAL: 'REVEAL', DESCENT: 'DESCENT', MINI: 'MINI', MINI_RESULT: 'MINI_RESULT',
  FINALE_INTRO: 'FINALE_INTRO', SPRINT: 'SPRINT', SPRINT_RESULT: 'SPRINT_RESULT', WINNER: 'WINNER',
});

// Round events: from question 2, about every other question changes one rule.
export const EVENTS = Object.freeze({
  calm: { name: 'Calm Water', line: 'The sea settles. Answer right and a lost flame is relit.' },
  lightning: { name: 'Lightning', line: 'The storm is overhead. The slowest right answer goes down the hatch too.' },
  fog: { name: 'Fog', line: 'Fog on the glass: the answers only show once it clears.' },
  undertow: { name: 'Undertow', line: 'The current is strong: this time a lost game costs two flames.' },
  beacon: { name: 'Beacon', line: 'The beam sweeps the room: right answers this time are worth a step on the stairs later.' },
});

export const L_RULES = Object.freeze({
  maxKeepers: 8,
  eventFrom: 2,
  eventChance: 0.5,
  fogTime: 6, // seconds before the answers show in fog
  flames: 3,
  introTime: 5,
  questionTime: 15,
  revealTime: 3.6,
  descentTime: 3.2,
  miniResultTime: 3.8,
  finaleAt: 2, // two keepers or fewer still lit
  maxRounds: 7,
  finaleIntroTime: 5.5,
  stairs: 12, // the lamp room is step 12
  keeperStart: 1, // plus one step per spare flame
  wraithStart: 0,
  maxHaunt: 3, // most steps a wraith can haunt its way up before the climb
  wraithFloat: 2, // wraiths drift up two extra steps every sprint: the dead are light
  knockback: 2, // steps a caught keeper slips back
  waterStart: -1,
  surgeFromSprint: 3, // from this sprint the water comes up two steps at a time
  highTideRound: 5, // from this round a lost survival game costs two flames
  sprintTime: 11,
  sprintResultTime: 4.2,
  maxSprints: 12,
});

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class LampEngine {
  constructor() {
    this.listeners = new Map();
    this.R = L_RULES;
    this.phase = L_PHASE.IDLE;
    this.players = [];
    this.round = 0;
    this.t = 0;
    this.total = 0;
    this.clock = 0;
    this.question = null;
    this.correct = -1;
    this.reveal = null;
    this.mini = null;
    this.miniData = null; // a mirror's copy of the minigame view
    this.miniLast = null;
    this.miniOrder = [];
    this.miniCount = 0;
    this.finale = null;
    this.winner = null;
    this.ranking = [];
    this.plans = [];
    this.options = { seed: 1 };
    this.rng = mulberry32(1);
    this.quiz = new QuizBank(this.rng);
    this.localId = 0;
    this.mirror = false;
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  emit(type, data = {}) {
    const set = this.listeners.get(type);
    if (set) for (const fn of [...set]) fn(data);
    const any = this.listeners.get('*');
    if (any) for (const fn of [...any]) fn(type, data);
  }

  // seats: [{ name, kind: 'human' | 'ai', bot?: roster name }]
  // `tuning` overrides any of L_RULES for one match (used to test the balance).
  startMatch({ seats, seed = (Date.now() & 0x7fffffff), localId = 0, quiz = null, tuning = null } = {}) {
    this.R = tuning ? Object.freeze({ ...L_RULES, ...tuning }) : L_RULES;
    const list = (seats || []).slice(0, this.R.maxKeepers);
    if (list.length < 2) throw new Error('Last Lamp needs at least two keepers.');
    this.options = { seed, tuning };
    this.rng = mulberry32(seed);
    this.quiz = quiz || new QuizBank(this.rng);
    this.mirror = false;
    this.localId = localId;
    this.players = list.map((s, id) => ({
      id, name: s.name, isHuman: s.kind !== 'ai', bot: s.kind === 'ai' ? (s.bot || s.name) : null,
      flames: this.R.flames, ghost: false, away: false, answer: null, answerAt: 0, wraithRight: 0, beacon: 0, step: 0, marks: [null, null, null],
    }));
    this.round = 0;
    this.clock = 0;
    this.mini = null;
    this.miniData = null;
    this.miniLast = null;
    this.miniOrder = shuffle(MINI_KINDS, this.rng);
    this.miniCount = 0;
    this.finale = null;
    this.winner = null;
    this.ranking = [];
    this.reveal = null;
    this.plans = [];
    this.event = null;
    this.lastEvent = null;
    this._phase(L_PHASE.INTRO, this.R.introTime);
    this.emit('matchStart', { count: this.players.length });
  }

  abort() {
    this.phase = L_PHASE.IDLE;
    this.mini = null;
    this.emit('abort', {});
  }

  get me() { return this.players[this.localId] || null; }
  get keepers() { return this.players.filter((p) => !p.ghost); }
  get wraiths() { return this.players.filter((p) => p.ghost); }
  get elapsed() { return this.total - this.t; }
  get foggy() { return this.phase === L_PHASE.QUESTION && this.event === 'fog' && this.elapsed < this.R.fogTime; }

  // The minigame as the screen should see it, on the host and on a mirror alike.
  miniView() {
    if (this.mirror) return this.miniData;
    return this.mini ? this.mini.view() : null;
  }

  _phase(phase, seconds) {
    this.phase = phase;
    this.t = seconds;
    this.total = seconds;
    this.plans = [];
  }

  _plan(at, run) { this.plans.push({ at: this.elapsed + at, run }); }

  _runPlans() {
    if (!this.plans.length) return;
    const now = this.elapsed;
    const due = this.plans.filter((p) => p.at <= now);
    if (!due.length) return;
    this.plans = this.plans.filter((p) => p.at > now);
    const phase = this.phase;
    for (const p of due.sort((a, b) => a.at - b.at)) { if (this.phase === phase) p.run(); }
  }

  setAway(id, away = true) {
    const p = this.players[id];
    if (!p || !p.isHuman || p.away === away) return;
    p.away = away;
    this.emit('away', { id, away });
  }

  // ---------- input ----------
  answerFor(id, index) {
    const p = this.players[id];
    if (this.mirror || !p || this.phase !== L_PHASE.QUESTION) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.question.answers.length) return false;
    const first = p.answer == null;
    p.answer = index;
    p.answerAt = this.elapsed;
    if (first) this.emit('answered', { id });
    const waiting = this.players.filter((x) => !x.away && x.answer == null);
    if (!waiting.length) this.t = Math.min(this.t, 1.2);
    return true;
  }

  miniFor(id, payload) {
    if (this.mirror || this.phase !== L_PHASE.MINI || !this.mini || !this.players[id]) return false;
    return this.mini.input(id, payload || {});
  }

  markFor(id, index, value) {
    const p = this.players[id];
    if (this.mirror || !p || this.phase !== L_PHASE.SPRINT) return false;
    if (!Number.isInteger(index) || index < 0 || index > 2 || typeof value !== 'boolean') return false;
    p.marks[index] = value;
    this.emit('marked', { id, count: p.marks.filter((m) => m != null).length });
    const waiting = this.players.filter((x) => !x.away && x.marks.some((m) => m == null));
    if (!waiting.length) this.t = Math.min(this.t, 1.0);
    return true;
  }

  // ---------- flow ----------
  update(dt) {
    if (this.phase === L_PHASE.IDLE || this.phase === L_PHASE.WINNER) return;
    this.clock += dt;
    if (this.mirror) {
      this.t = Math.max(0, this.t - dt);
      if (this.miniData) this.miniData.t = Math.max(0, this.miniData.t - dt);
      return;
    }
    if (this.phase === L_PHASE.MINI) {
      this.mini.update(dt);
      if (this.mini.done) this._miniDone();
      return;
    }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    switch (this.phase) {
      case L_PHASE.INTRO: this._ask(); break;
      case L_PHASE.QUESTION: this._reveal(); break;
      case L_PHASE.REVEAL: this._afterReveal(); break;
      case L_PHASE.DESCENT: this._startMini(); break;
      case L_PHASE.MINI_RESULT: this._afterRound(); break;
      case L_PHASE.FINALE_INTRO: this._sprint(); break;
      case L_PHASE.SPRINT: this._sprintResult(); break;
      case L_PHASE.SPRINT_RESULT: this._afterSprint(); break;
      default: break;
    }
  }

  _ask() {
    this.round++;
    // Easy first, harder as the night goes on.
    const difficulty = this.round <= 2 ? 1 : this.round <= 4 ? 2 : 3;
    const q = this.quiz.next({ difficulty });
    this.question = { text: q.text, answers: q.answers, topic: q.topic, style: q.style || 'mc', difficulty: q.difficulty };
    this.correct = q.correct;
    this.reveal = null;
    this.miniLast = null;
    this.event = this._rollEvent();
    for (const p of this.players) { p.answer = null; p.answerAt = 0; }
    this._phase(L_PHASE.QUESTION, this.R.questionTime);
    const after = this.event === 'fog' ? this.R.fogTime : 0;
    for (const p of this.players) {
      if (p.isHuman) continue;
      const prof = botProfile(p.bot);
      const pick = botAnswer(prof, this.correct, q.answers.length, this.rng);
      this._plan(after + 1.5 + prof.pace * (8 - after * 0.6) + this.rng() * 2, () => this.answerFor(p.id, pick));
    }
    this.emit('question', { n: this.round, event: this.event });
  }

  _rollEvent() {
    if (this.round < this.R.eventFrom || this.rng() >= this.R.eventChance) { this.lastEvent = null; return null; }
    const pool = Object.keys(EVENTS).filter((k) => k !== this.lastEvent);
    const pick = pool[Math.floor(this.rng() * pool.length)];
    this.lastEvent = pick;
    return pick;
  }

  _reveal() {
    const safe = [];
    const down = [];
    const picks = {};
    for (const p of this.players) {
      picks[p.id] = p.answer;
      const right = p.answer === this.correct;
      if (p.ghost) { if (right) p.wraithRight++; continue; }
      (right ? safe : down).push(p.id);
      if (right && this.event === 'beacon') p.beacon++;
    }
    // Event outcomes.
    const relit = [];
    let struck = null;
    if (this.event === 'calm') {
      for (const id of safe) {
        const p = this.players[id];
        if (p.flames < this.R.flames) { p.flames++; relit.push(id); }
      }
    }
    if (this.event === 'lightning' && safe.length >= 2) {
      struck = safe.slice().sort((a, b) => this.players[b].answerAt - this.players[a].answerAt || a - b)[0];
      safe.splice(safe.indexOf(struck), 1);
      down.push(struck);
    }
    this.reveal = { correct: this.correct, safe, down, picks, relit, struck };
    this._phase(L_PHASE.REVEAL, this.R.revealTime);
    this.emit('reveal', { correct: this.correct, answer: this.question.answers[this.correct], safe, down, relit, struck, event: this.event });
  }

  _afterReveal() {
    const { down, safe } = this.reveal;
    if (!down.length) { this._afterRound(); return; }
    // Take the next survival game in the shuffled order that this crew can play.
    let kind = null;
    for (let i = 0; i < this.miniOrder.length; i++) {
      const k = this.miniOrder[(this.miniCount + i) % this.miniOrder.length];
      if (playable(k, down, safe)) { kind = k; this.miniCount += i + 1; break; }
    }
    this.pendingMini = kind || 'tide';
    this._phase(L_PHASE.DESCENT, this.R.descentTime);
    this.emit('descent', { crew: down, kind: this.pendingMini });
  }

  _startMini() {
    const { down, safe } = this.reveal;
    this.mini = makeMini(this.pendingMini, this, down, safe);
    this.phase = L_PHASE.MINI;
    this.t = 0;
    this.total = 0;
    this.emit('miniStart', { kind: this.mini.kind, crew: down, saboteur: this.mini.saboteur == null ? null : this.mini.saboteur });
  }

  _miniDone() {
    const mini = this.mini;
    const losers = mini.losers.filter((id) => !this.players[id].ghost);
    // The lamp cannot go fully dark: if this would leave no keeper lit, the ones about
    // to be snuffed hold on with a single flame.
    const cost = this.round >= this.R.highTideRound || this.event === 'undertow' ? 2 : 1;
    const wouldDie = losers.filter((id) => this.players[id].flames <= cost);
    const lit = this.keepers.length;
    const mercy = wouldDie.length > 0 && lit - wouldDie.length <= 0;
    const snuffed = [];
    for (const id of losers) {
      const p = this.players[id];
      if (mercy && p.flames <= cost) { p.flames = 1; continue; }
      p.flames = Math.max(0, p.flames - cost);
      if (p.flames <= 0) { p.ghost = true; snuffed.push(id); }
    }
    // Rewards (the plank saboteur's relit flame) come after the losses.
    const relit = [];
    for (const id of mini.reward) {
      const p = this.players[id];
      if (!p || p.ghost || p.flames >= this.R.flames) continue;
      p.flames++;
      relit.push(id);
    }
    this.miniLast = { kind: mini.kind, view: mini.view(), losers, snuffed, mercy, cost, relit };
    this.mini = null;
    this._phase(L_PHASE.MINI_RESULT, this.R.miniResultTime);
    this.emit('miniResult', { kind: mini.kind, losers, snuffed, mercy, cost, relit });
  }

  _afterRound() {
    if (this.keepers.length <= this.R.finaleAt || this.round >= this.R.maxRounds) this._finale();
    else this._ask();
  }

  // ---------- the climb ----------
  _finale() {
    for (const p of this.players) {
      // Wraiths who kept answering right have been haunting the stairs: a step for every two.
      p.step = p.ghost ? this.R.wraithStart + Math.min(this.R.maxHaunt, Math.floor(p.wraithRight / 2)) : this.R.keeperStart + (p.flames - 1);
      // Beacon rounds answered right: a step each, for keepers and wraiths alike.
      p.step = Math.min(this.R.stairs - 1, p.step + p.beacon);
      p.marks = [null, null, null];
    }
    this.finale = { sprint: 0, water: this.R.waterStart, statements: null, truths: null, last: null };
    this.question = null;
    this.reveal = null;
    this._phase(L_PHASE.FINALE_INTRO, this.R.finaleIntroTime);
    this.emit('finaleStart', { keepers: this.keepers.map((p) => p.id), wraiths: this.wraiths.map((p) => p.id) });
  }

  _sprint() {
    const f = this.finale;
    f.sprint++;
    // The climb gets harder the higher it goes.
    const trio = this.quiz.trio(f.sprint <= 1 ? 1 : f.sprint <= 3 ? 2 : 3);
    f.statements = trio.map((s) => ({ q: s.q, a: s.a, topic: s.topic }));
    f.truths = trio.map((s) => s.truth);
    f.last = null;
    for (const p of this.players) p.marks = [null, null, null];
    this._phase(L_PHASE.SPRINT, this.R.sprintTime);
    for (const p of this.players) {
      if (p.isHuman) continue;
      const prof = botProfile(p.bot);
      for (let i = 0; i < 3; i++) {
        const right = this.rng() < prof.skill;
        this._plan(1.2 + i * (1.2 + prof.pace * 1.6) + this.rng(), () => this.markFor(p.id, i, right ? f.truths[i] : !f.truths[i]));
      }
    }
    this.emit('sprint', { n: f.sprint });
  }

  _sprintResult() {
    const f = this.finale;
    const moves = {};
    for (const p of this.players) {
      let n = 0;
      for (let i = 0; i < 3; i++) if (p.marks[i] === f.truths[i]) n++;
      if (p.ghost) n += this.R.wraithFloat;
      moves[p.id] = n;
      p.step = Math.min(this.R.stairs, p.step + n);
    }
    // A wraith that has reached a keeper's step takes their lantern: they trade places
    // in the story, and the keeper who was caught slips back a step as a wraith.
    const steals = [];
    const taken = new Set();
    // Ties are settled by a draw for this sprint, not by seat number.
    const draw = new Map(this.players.map((p) => [p.id, this.rng()]));
    const tie = (a, b) => draw.get(a.id) - draw.get(b.id);
    for (const g of this.wraiths.slice().sort((a, b) => b.step - a.step || tie(a, b))) {
      const prey = this.keepers.filter((k) => !taken.has(k.id) && k.step <= g.step && k.step < this.R.stairs).sort((a, b) => b.step - a.step || tie(a, b))[0];
      if (!prey) continue;
      taken.add(prey.id);
      taken.add(g.id);
      steals.push({ wraith: g.id, keeper: prey.id });
    }
    for (const s of steals) {
      const g = this.players[s.wraith];
      const k = this.players[s.keeper];
      g.ghost = false;
      g.flames = Math.max(1, k.flames);
      k.ghost = true;
      k.flames = 0;
      k.step = Math.max(0, k.step - this.R.knockback);
    }
    // The water comes up (faster once the storm surge starts). A keeper it reaches is snuffed.
    f.water += f.sprint >= this.R.surgeFromSprint ? 2 : 1;
    const drowned = [];
    for (const k of this.keepers) {
      if (k.step <= f.water && k.step < this.R.stairs) { k.ghost = true; k.flames = 0; drowned.push(k.id); }
    }
    // If the stairs are dark, the wraith highest up is relit.
    let relit = null;
    if (!this.keepers.length) {
      const top = this.players.slice().sort((a, b) => b.step - a.step || tie(a, b))[0];
      top.ghost = false;
      top.flames = 1;
      top.step = Math.max(top.step, f.water + 1);
      relit = top.id;
    }
    const steps = {};
    for (const p of this.players) steps[p.id] = p.step;
    f.last = { truths: f.truths.slice(), moves, steals, drowned, relit, water: f.water, steps };
    this._phase(L_PHASE.SPRINT_RESULT, this.R.sprintResultTime);
    this.emit('sprintResult', { moves, steals, drowned, relit, water: f.water });
  }

  _afterSprint() {
    const f = this.finale;
    // Two keepers into the lamp room together: more flames wins, then whoever had
    // more marks right this sprint, then a draw.
    const moves = f.last ? f.last.moves : {};
    const draw = new Map(this.players.map((p) => [p.id, this.rng()]));
    const top = this.keepers.filter((k) => k.step >= this.R.stairs).sort((a, b) => b.flames - a.flames || (moves[b.id] || 0) - (moves[a.id] || 0) || draw.get(a.id) - draw.get(b.id))[0];
    if (top) { this._win(top.id); return; }
    if (f.sprint >= this.R.maxSprints) {
      const best = this.keepers.slice().sort((a, b) => b.step - a.step || b.flames - a.flames || draw.get(a.id) - draw.get(b.id))[0];
      this._win(best.id);
      return;
    }
    this._sprint();
  }

  _win(id) {
    this.winner = id;
    const order = this.players.slice().sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0) || (a.ghost - b.ghost) || b.step - a.step || b.flames - a.flames || a.id - b.id);
    this.ranking = order.map((p) => p.id);
    this.phase = L_PHASE.WINNER;
    this.t = 0;
    this.emit('winner', { id, ranking: this.ranking });
  }

  // ---------- snapshots ----------
  // Nothing secret goes out before it is revealed: not the right answer, not who picked
  // what, not which statements are true.
  serialize() {
    const shown = this.phase !== L_PHASE.QUESTION;
    const f = this.finale;
    return {
      o: this.options, ph: this.phase, t: this.t, tt: this.total, r: this.round,
      q: this.question && this.foggy ? { ...this.question, answers: null } : this.question, c: shown ? this.correct : -1, ev: this.event, rv: this.reveal ? { ...this.reveal, picks: this.reveal.picks } : null,
      mv: this.mini ? this.mini.view() : null, ml: this.miniLast, pm: this.pendingMini || null,
      f: f ? { sprint: f.sprint, water: f.water, statements: f.statements, truths: this.phase === L_PHASE.SPRINT ? null : f.truths, last: f.last } : null,
      w: this.winner, rank: this.ranking,
      pl: this.players.map((p) => ({
        id: p.id, n: p.name, h: p.isHuman ? 1 : 0, b: p.bot, fl: p.flames, g: p.ghost ? 1 : 0, aw: p.away ? 1 : 0,
        an: this.phase === L_PHASE.QUESTION ? (p.answer == null ? null : -2) : p.answer, // -2: answered, not saying what
        wr: p.wraithRight, bc: p.beacon, st: p.step, mk: p.marks.filter((m) => m != null).length,
      })),
    };
  }

  hydrate(s, localId = this.localId) {
    this.mirror = true;
    this.localId = localId;
    this.options = s.o;
    this.R = s.o && s.o.tuning ? Object.freeze({ ...L_RULES, ...s.o.tuning }) : L_RULES;
    this.phase = s.ph;
    this.t = s.t;
    this.total = s.tt;
    this.round = s.r;
    this.question = s.q;
    this.correct = s.c;
    this.event = s.ev || null;
    this.reveal = s.rv;
    this.mini = null;
    this.miniData = s.mv;
    this.miniLast = s.ml;
    this.pendingMini = s.pm;
    this.finale = s.f;
    this.winner = s.w;
    this.ranking = s.rank;
    this.players = s.pl.map((p) => ({
      id: p.id, name: p.n, isHuman: !!p.h, bot: p.b, flames: p.fl, ghost: !!p.g, away: !!p.aw,
      answer: p.an, wraithRight: p.wr, beacon: p.bc || 0, step: p.st, marks: [null, null, null], markCount: p.mk,
    }));
  }
}
