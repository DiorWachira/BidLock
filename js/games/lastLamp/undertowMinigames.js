// LAST LAMP — the Undertow: four short survival games for keepers who answered wrong.
// Each is a small state machine with the same shape:
//   update(dt)            advance; sets `done` and `losers` when it is over
//   input(id, payload)    one player's move; returns true if it was accepted
//   view()                a plain object for the screen and for the wire. Anything secret
//                         (the loosened plank, who chose to shove) is left out of the
//                         view until the reveal.
// Losers each lose one flame. Pure rules: no DOM, audio or rendering.

import { botProfile } from '../../arcade/bots.js';
import { makeSum, guessError } from '../../arcade/quizBank.js';

export const MINI_KINDS = Object.freeze(['planks', 'tide', 'lifeboat', 'capstan', 'tally', 'buoy', 'manifest']);

export const MINI_INFO = Object.freeze({
  planks: { name: 'The Loose Plank', line: 'One plank has been loosened. Catch someone and the saboteur relights a flame.' },
  tide: { name: 'The Rising Tide', line: 'Work the pump. Five right sums before the water wins.' },
  lifeboat: { name: 'The Lifeboat', line: 'Share the boat, or shove. Choose in secret.' },
  capstan: { name: 'The Storm Capstan', line: 'Six sockets, one holds the lightning. Pull, or spin and pull twice.' },
  tally: { name: 'The Tally', line: 'A number question. You do not have to be right: just do not be the furthest off.' },
  buoy: { name: 'The Bell Buoy', line: 'Watch the buoy\'s light, then signal the pattern back. One slip and you are under.' },
  manifest: { name: 'The Manifest', line: 'Three quick questions from the wreck\'s papers. Get two right to climb out.' },
});

export const BUOY_SIGNS = Object.freeze(['▲', '●', '■', '◆']);

class Mini {
  constructor(engine, crew) {
    this.e = engine;
    this.crew = crew.slice();
    this.stage = 'play';
    this.t = 0;
    this.done = false;
    this.losers = [];
    this.detail = {};
    this.plans = []; // bots: [{ at, run }] against this.clock
    this.reward = []; // players who earn a flame back
    this.clock = 0;
  }

  isBot(id) { return !this.e.players[id].isHuman; }
  prof(id) { return botProfile(this.e.players[id].bot); }

  _runPlans() {
    if (!this.plans.length) return;
    const due = this.plans.filter((p) => p.at <= this.clock);
    if (!due.length) return;
    this.plans = this.plans.filter((p) => p.at > this.clock);
    for (const p of due.sort((a, b) => a.at - b.at)) p.run();
  }

  _finish(losers, detail = {}) {
    this.losers = losers;
    this.detail = detail;
    this.stage = 'reveal';
    this.t = 3.4;
    this.e.emit('mini', { kind: this.kind, step: 'reveal', losers, ...detail });
  }

  // Shared tail: once the reveal has been shown, the game is over.
  _tickReveal(dt) {
    this.t -= dt;
    if (this.t <= 0) this.done = true;
  }
}

// ---------- 1. The Loose Plank: one hidden trap, everyone else picks a spot ----------
export class Planks extends Mini {
  // `saboteur` is a keeper who answered right if there is one; otherwise one of the crew.
  constructor(engine, crew, saboteur) {
    super(engine, crew);
    this.kind = 'planks';
    this.saboteur = saboteur;
    this.steppers = crew.filter((id) => id !== saboteur);
    this.count = Math.max(3, Math.min(6, this.steppers.length + 1));
    this.rigged = null;
    this.picks = {};
    this.stage = 'rig';
    this.t = 8;
    const rng = engine.rng;
    if (this.isBot(saboteur)) this.plans.push({ at: 1.5 + rng() * 3, run: () => this.input(saboteur, { plank: Math.floor(rng() * this.count) }) });
  }

  input(id, { plank } = {}) {
    if (!Number.isInteger(plank) || plank < 0 || plank >= this.count) return false;
    if (this.stage === 'rig' && id === this.saboteur && this.rigged == null) {
      this.rigged = plank;
      this.e.emit('mini', { kind: 'planks', step: 'rigged' });
      this._openStep();
      return true;
    }
    if (this.stage === 'step' && this.steppers.includes(id)) {
      this.picks[id] = plank;
      this.e.emit('mini', { kind: 'planks', step: 'picked', id, plank });
      if (this.steppers.every((s) => this.picks[s] != null)) this.t = Math.min(this.t, 1.2);
      return true;
    }
    return false;
  }

  _openStep() {
    this.stage = 'step';
    this.t = 9;
    const rng = this.e.rng;
    for (const id of this.steppers) {
      if (this.isBot(id)) this.plans.push({ at: this.clock + 1 + rng() * 5, run: () => this.input(id, { plank: Math.floor(rng() * this.count) }) });
    }
    if (!this.steppers.length) this.t = 0.8;
  }

  update(dt) {
    this.clock += dt;
    if (this.stage === 'reveal') { this._tickReveal(dt); return; }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    const rng = this.e.rng;
    if (this.stage === 'rig') {
      this.rigged = Math.floor(rng() * this.count); // the saboteur froze: the sea chooses
      this._openStep();
      return;
    }
    for (const id of this.steppers) if (this.picks[id] == null) this.picks[id] = Math.floor(rng() * this.count);
    let losers = this.steppers.filter((id) => this.picks[id] === this.rigged);
    // A saboteur from the crew who catches nobody goes through their own plank.
    const backfired = losers.length === 0 && this.crew.includes(this.saboteur);
    if (backfired) losers = [this.saboteur];
    // A saboteur who catches someone relights one of their own flames.
    else if (losers.length) this.reward = [this.saboteur];
    this._finish(losers, { rigged: this.rigged, picks: { ...this.picks }, backfired });
  }

  view() {
    return {
      kind: 'planks', stage: this.stage, t: this.t, crew: this.crew, saboteur: this.saboteur, steppers: this.steppers, count: this.count,
      picks: this.stage === 'rig' ? {} : { ...this.picks },
      rigged: this.stage === 'reveal' ? this.rigged : null, losers: this.losers, detail: this.stage === 'reveal' ? this.detail : {},
    };
  }
}

// ---------- 2. The Rising Tide: quick sums against the clock ----------
export class Tide extends Mini {
  constructor(engine, crew) {
    super(engine, crew);
    this.kind = 'tide';
    this.target = 5;
    this.t = 16;
    this.total = 16;
    this.progress = {};
    this.problem = {};
    this.solved = {};
    for (const id of crew) {
      this.progress[id] = 0;
      this.solved[id] = 0;
      this._next(id);
      if (this.isBot(id)) this._planBot(id);
    }
  }

  _next(id) {
    const s = makeSum(this.e.rng, Math.min(2, Math.floor(this.solved[id] / 2)));
    this.problem[id] = s;
  }

  _planBot(id) {
    const rng = this.e.rng;
    const prof = this.prof(id);
    const gap = 1.1 + (1 - prof.skill) * 1.5 + rng() * 0.7;
    this.plans.push({
      at: this.clock + gap,
      run: () => {
        if (this.stage !== 'play' || this.progress[id] >= this.target) return;
        const p = this.problem[id];
        const right = rng() < Math.min(0.97, prof.skill + 0.25);
        this.input(id, { option: right ? p.correct : (p.correct + 1) % 3 });
        this._planBot(id);
      },
    });
  }

  input(id, { option } = {}) {
    if (this.stage !== 'play' || !this.crew.includes(id) || this.progress[id] >= this.target) return false;
    if (!Number.isInteger(option) || option < 0 || option > 2) return false;
    const right = option === this.problem[id].correct;
    this.progress[id] = Math.max(0, this.progress[id] + (right ? 1 : -1));
    this.solved[id]++;
    this._next(id);
    this.e.emit('mini', { kind: 'tide', step: 'answer', id, right, progress: this.progress[id] });
    if (this.crew.every((c) => this.progress[c] >= this.target)) this.t = Math.min(this.t, 0.8);
    return true;
  }

  update(dt) {
    this.clock += dt;
    if (this.stage === 'reveal') { this._tickReveal(dt); return; }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    this._finish(this.crew.filter((id) => this.progress[id] < this.target), { progress: { ...this.progress } });
  }

  view() {
    const problem = {};
    for (const id of this.crew) problem[id] = { text: this.problem[id].text, options: this.problem[id].options };
    return { kind: 'tide', stage: this.stage, t: this.t, total: this.total, crew: this.crew, target: this.target, progress: { ...this.progress }, problem, losers: this.losers };
  }
}

// ---------- 3. The Lifeboat: share or shove, in secret ----------
export class Lifeboat extends Mini {
  constructor(engine, crew) {
    super(engine, crew);
    this.kind = 'lifeboat';
    this.t = 10;
    this.choice = {};
    const rng = engine.rng;
    for (const id of crew) {
      if (!this.isBot(id)) continue;
      const style = this.prof(id).style;
      const p = style === 'bold' || style === 'chaos' ? 0.55 : style === 'expert' ? 0.35 : 0.2;
      this.plans.push({ at: 1.5 + rng() * 5, run: () => this.input(id, { shove: rng() < p }) });
    }
  }

  input(id, { shove } = {}) {
    if (this.stage !== 'play' || !this.crew.includes(id) || this.choice[id] != null) return false;
    this.choice[id] = shove ? 'shove' : 'share';
    this.e.emit('mini', { kind: 'lifeboat', step: 'chosen', id });
    if (this.crew.every((c) => this.choice[c] != null)) this.t = Math.min(this.t, 1.0);
    return true;
  }

  update(dt) {
    this.clock += dt;
    if (this.stage === 'reveal') { this._tickReveal(dt); return; }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    for (const id of this.crew) if (this.choice[id] == null) this.choice[id] = 'share'; // no answer means you shared
    const shovers = this.crew.filter((id) => this.choice[id] === 'shove');
    let losers;
    let outcome;
    if (shovers.length === 0) { losers = []; outcome = 'all-share'; }
    else if (shovers.length === this.crew.length) { losers = this.crew.slice(); outcome = 'all-shove'; }
    else { losers = this.crew.filter((id) => this.choice[id] === 'share'); outcome = 'betrayed'; }
    this._finish(losers, { choices: { ...this.choice }, outcome });
  }

  view() {
    return {
      kind: 'lifeboat', stage: this.stage, t: this.t, crew: this.crew,
      chosen: this.crew.filter((id) => this.choice[id] != null),
      choices: this.stage === 'reveal' ? { ...this.choice } : {}, losers: this.losers, detail: this.stage === 'reveal' ? this.detail : {},
    };
  }
}

// ---------- 4. The Storm Capstan: six sockets, one holds the lightning ----------
export class Capstan extends Mini {
  constructor(engine, crew) {
    super(engine, crew);
    this.kind = 'capstan';
    const rng = engine.rng;
    this.order = crew.slice().sort(() => rng() - 0.5);
    this.sockets = 6;
    this.bolt = Math.floor(rng() * this.sockets);
    this.at = 0; // which socket comes up on the next pull
    this.turn = 0;
    this.pulls = 0;
    this.maxPulls = crew.length >= 2 ? 6 : 3; // with two or more at the wheel, somebody is always struck
    this.lastAction = null;
    this.stage = 'turn';
    this.t = 7;
    this._planTurn();
  }

  get current() { return this.order[this.turn % this.order.length]; }

  _planTurn() {
    const id = this.current;
    if (!this.isBot(id)) return;
    const rng = this.e.rng;
    // Bots spin when the next socket is worse than about one in three.
    this.plans.push({ at: this.clock + 1.2 + rng() * 2.4, run: () => { if (this.stage === 'turn' && this.current === id) this.input(id, { spin: this.risk() > 0.3 + (rng() - 0.5) * 0.12 }); } });
  }

  // On your turn: pull the next socket, or spin the wheel (a fresh one-in-six) and pull
  // twice. Without the extra pull, spinning would always be the safer choice.
  input(id, { spin } = {}) {
    if (this.stage !== 'turn' || id !== this.current) return false;
    const rng = this.e.rng;
    if (spin) { this.bolt = Math.floor(rng() * this.sockets); this.at = 0; }
    const count = spin ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const struck = this.at === this.bolt;
      this.at++;
      this.pulls++;
      this.lastAction = { id, spin: !!spin, struck, pull: this.pulls };
      this.e.emit('mini', { kind: 'capstan', step: 'pull', id, spin: !!spin && k === 0, struck, pull: this.pulls });
      if (struck) { this._finish([id], { struck: id, pulls: this.pulls }); return true; }
      if (this.pulls >= this.maxPulls) { this._finish([], { struck: null, pulls: this.pulls }); return true; }
    }
    this.stage = 'hold';
    this.t = 1.5;
    return true;
  }

  // The chance that the next pull strikes, if you do not spin.
  risk() { return 1 / Math.max(1, this.sockets - this.at); }

  update(dt) {
    this.clock += dt;
    if (this.stage === 'reveal') { this._tickReveal(dt); return; }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    if (this.stage === 'hold') {
      this.turn++;
      this.stage = 'turn';
      this.t = 7;
      this.e.emit('mini', { kind: 'capstan', step: 'turn', id: this.current });
      this._planTurn();
    } else {
      this.input(this.current, { spin: false }); // out of time: the wheel pulls itself
    }
  }

  view() {
    return {
      kind: 'capstan', stage: this.stage, t: this.t, crew: this.crew, order: this.order, current: this.current, risk: this.stage === 'reveal' ? null : this.risk(),
      pulls: this.pulls, maxPulls: this.maxPulls, sockets: this.sockets, lastAction: this.lastAction, losers: this.losers, detail: this.stage === 'reveal' ? this.detail : {},
    };
  }
}

// Which games can be played by this crew? The plank needs someone to loosen it and
// someone to step; the lifeboat needs two to argue over it.
// ---------- 5. The Tally: be anything but the furthest off ----------
export class Tally extends Mini {
  constructor(engine, crew) {
    super(engine, crew);
    this.kind = 'tally';
    this.est = engine.quiz.estimate();
    this.t = 12;
    this.total = 12;
    this.pick = {};
    const rng = engine.rng;
    const err = (o) => guessError(o, this.est.truth, this.est.year);
    const best = this.est.options.reduce((a, o, i) => (err(o) < err(this.est.options[a]) ? i : a), 0);
    for (const id of crew) {
      if (!this.isBot(id)) continue;
      const choice = rng() < this.prof(id).skill + 0.1 ? best : Math.floor(rng() * 4);
      this.plans.push({ at: 2 + rng() * 6, run: () => this.input(id, { option: choice }) });
    }
  }

  input(id, { option } = {}) {
    if (this.stage !== 'play' || !this.crew.includes(id)) return false;
    if (!Number.isInteger(option) || option < 0 || option > 3) return false;
    const first = this.pick[id] == null;
    this.pick[id] = option;
    if (first) this.e.emit('mini', { kind: 'tally', step: 'chosen', id });
    if (this.crew.every((c) => this.pick[c] != null)) this.t = Math.min(this.t, 1.0);
    return true;
  }

  update(dt) {
    this.clock += dt;
    if (this.stage === 'reveal') { this._tickReveal(dt); return; }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    const rng = this.e.rng;
    for (const id of this.crew) if (this.pick[id] == null) this.pick[id] = Math.floor(rng() * 4);
    const { truth, options, year } = this.est;
    const err = (i) => guessError(options[i], truth, year);
    const bestOption = [0, 1, 2, 3].reduce((a, i) => (err(i) < err(a) ? i : a), 0);
    const picked = [...new Set(this.crew.map((id) => this.pick[id]))];
    let losers;
    if (picked.length === 1) {
      // Everyone agreed: safe only if they agreed on the best guess going.
      losers = picked[0] === bestOption ? [] : this.crew.slice();
    } else {
      const worst = Math.max(...picked.map(err));
      losers = this.crew.filter((id) => err(this.pick[id]) === worst);
    }
    this._finish(losers, { truth, picks: { ...this.pick }, best: bestOption });
  }

  view() {
    return {
      kind: 'tally', stage: this.stage, t: this.t, total: this.total, crew: this.crew,
      q: { text: this.est.text, unit: this.est.unit, options: this.est.options },
      chosen: this.crew.filter((id) => this.pick[id] != null),
      picks: this.stage === 'reveal' ? { ...this.pick } : {},
      truth: this.stage === 'reveal' ? this.est.truth : null,
      losers: this.losers,
    };
  }
}

// ---------- 6. The Bell Buoy: watch a pattern, signal it back ----------
export class Buoy extends Mini {
  constructor(engine, crew) {
    super(engine, crew);
    this.kind = 'buoy';
    const rng = engine.rng;
    this.length = Math.min(7, 4 + Math.floor((engine.round || 1) / 2));
    this.seq = Array.from({ length: this.length }, () => Math.floor(rng() * 4));
    this.stage = 'show';
    this.showTime = 1.2 + this.length * 0.75;
    this.t = this.showTime;
    this.progress = {};
    this.failed = {};
    for (const id of crew) { this.progress[id] = 0; this.failed[id] = false; }
  }

  _planBots() {
    const rng = this.e.rng;
    for (const id of this.crew) {
      if (!this.isBot(id)) continue;
      const p = Math.max(0.15, 0.45 + this.prof(id).skill * 0.5 - (this.length - 4) * 0.09);
      const slip = rng() < p ? -1 : Math.floor(rng() * this.length);
      let at = 1 + rng();
      for (let k = 0; k < this.length; k++) {
        const sign = k === slip ? (this.seq[k] + 1 + Math.floor(rng() * 3)) % 4 : this.seq[k];
        this.plans.push({ at: this.clock + at, run: () => this.input(id, { sign }) });
        at += 0.45 + rng() * 0.6;
        if (k === slip) break;
      }
    }
  }

  input(id, { sign } = {}) {
    if (this.stage !== 'play' || !this.crew.includes(id) || this.failed[id] || this.progress[id] >= this.length) return false;
    if (!Number.isInteger(sign) || sign < 0 || sign > 3) return false;
    if (sign === this.seq[this.progress[id]]) this.progress[id]++;
    else this.failed[id] = true;
    this.e.emit('mini', { kind: 'buoy', step: 'signal', id, ok: !this.failed[id], progress: this.progress[id] });
    if (this.crew.every((c) => this.failed[c] || this.progress[c] >= this.length)) this.t = Math.min(this.t, 0.8);
    return true;
  }

  update(dt) {
    this.clock += dt;
    if (this.stage === 'reveal') { this._tickReveal(dt); return; }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    if (this.stage === 'show') {
      this.stage = 'play';
      this.t = 6 + this.length * 1.1;
      this.total = this.t;
      this._planBots();
      this.e.emit('mini', { kind: 'buoy', step: 'go' });
      return;
    }
    this._finish(this.crew.filter((id) => this.failed[id] || this.progress[id] < this.length), { seq: this.seq.slice() });
  }

  view() {
    // The pattern is only on the wire while it is being shown, and at the end.
    return {
      kind: 'buoy', stage: this.stage, t: this.t, total: this.stage === 'show' ? this.showTime : this.total, crew: this.crew, length: this.length,
      seq: this.stage === 'play' ? null : this.seq.slice(),
      progress: { ...this.progress }, failed: { ...this.failed }, losers: this.losers,
    };
  }
}

// ---------- 7. The Manifest: three quick questions, two to pass ----------
export class Manifest extends Mini {
  constructor(engine, crew) {
    super(engine, crew);
    this.kind = 'manifest';
    this.qs = [0, 1, 2].map(() => engine.quiz.next({ difficulty: 1 }));
    this.n = 0;
    this.need = 2;
    this.score = {};
    this.answers = {};
    for (const id of crew) this.score[id] = 0;
    this._open();
  }

  _open() {
    this.stage = 'q';
    this.t = 8;
    this.total = 8;
    this.answers = {};
    const rng = this.e.rng;
    const q = this.qs[this.n];
    for (const id of this.crew) {
      if (!this.isBot(id)) continue;
      const right = rng() < Math.min(0.95, this.prof(id).skill + 0.18);
      const pick = right ? q.correct : (q.correct + 1 + Math.floor(rng() * 3)) % 4;
      this.plans.push({ at: this.clock + 1.5 + rng() * 4.5, run: () => this.input(id, { answer: pick }) });
    }
  }

  input(id, { answer } = {}) {
    if (this.stage !== 'q' || !this.crew.includes(id) || this.answers[id] != null) return false;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return false;
    this.answers[id] = answer;
    this.e.emit('mini', { kind: 'manifest', step: 'answered', id });
    if (this.crew.every((c) => this.answers[c] != null)) this.t = Math.min(this.t, 0.6);
    return true;
  }

  update(dt) {
    this.clock += dt;
    if (this.stage === 'reveal') { this._tickReveal(dt); return; }
    this._runPlans();
    this.t -= dt;
    if (this.t > 0) return;
    if (this.stage === 'q') {
      const q = this.qs[this.n];
      for (const id of this.crew) if (this.answers[id] === q.correct) this.score[id]++;
      this.stage = 'show';
      this.t = 1.8;
      this.e.emit('mini', { kind: 'manifest', step: 'show', n: this.n });
      return;
    }
    if (this.stage === 'show') {
      this.n++;
      if (this.n < this.qs.length) { this._open(); return; }
      this._finish(this.crew.filter((id) => this.score[id] < this.need), { score: { ...this.score } });
    }
  }

  view() {
    const q = this.qs[Math.min(this.n, this.qs.length - 1)];
    const open = this.stage !== 'q';
    return {
      kind: 'manifest', stage: this.stage, t: this.t, total: this.total, crew: this.crew, n: this.n, of: this.qs.length, need: this.need,
      q: { text: q.text, answers: q.answers, topic: q.topic }, correct: open ? q.correct : -1,
      answered: this.crew.filter((id) => this.answers[id] != null),
      answers: open ? { ...this.answers } : {}, score: { ...this.score }, losers: this.losers,
    };
  }
}

// Which games can be played by this crew? The plank needs someone to loosen it and
// someone to step; the lifeboat needs two to argue over it.
export function playable(kind, crew, safeLiving) {
  if (kind === 'planks') return crew.length >= 2 || (crew.length === 1 && safeLiving.length >= 1);
  if (kind === 'lifeboat') return crew.length >= 2;
  return crew.length >= 1;
}

export function makeMini(kind, engine, crew, safeLiving) {
  if (kind === 'planks') {
    const pool = safeLiving.length ? safeLiving : crew;
    const saboteur = pool[Math.floor(engine.rng() * pool.length)];
    return new Planks(engine, crew, saboteur);
  }
  if (kind === 'tide') return new Tide(engine, crew);
  if (kind === 'lifeboat') return new Lifeboat(engine, crew);
  if (kind === 'tally') return new Tally(engine, crew);
  if (kind === 'buoy') return new Buoy(engine, crew);
  if (kind === 'manifest') return new Manifest(engine, crew);
  return new Capstan(engine, crew);
}
