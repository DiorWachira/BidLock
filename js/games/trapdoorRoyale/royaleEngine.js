// TRAPDOOR ROYALE — rules engine. Pure: no DOM, audio or rendering. Deterministic for a seed.
//
// Up to twelve contestants stand on a floating arena. Each round a question goes up
// with four answers, one per platform. Everyone runs to the platform they trust and may
// change their mind until the clock runs out. Then the three wrong platforms drop, and
// so does anyone still in the middle. The last one standing is the champion.
//
// The authoritative state is which platform each contestant has chosen, not where their
// feet are: avatars run there locally, so twelve players stay in step without streaming
// coordinates.

import { mulberry32 } from '../../engine/auctionEngine.js';
import { QuizBank } from '../../arcade/quizBank.js';
import { botProfile, botAnswer } from '../../arcade/bots.js';

export const R_PHASE = Object.freeze({
  IDLE: 'IDLE', INTRO: 'INTRO', QUESTION: 'QUESTION', LOCK: 'LOCK', DROP: 'DROP', RECAP: 'RECAP', CHAMPION: 'CHAMPION',
});

export const R_RULES = Object.freeze({
  platforms: 4,
  maxContestants: 12,
  introTime: 4.5,
  standardTime: 12,
  speedTime: 7,
  suddenTime: 9,
  lockTime: 1.5,
  dropTime: 3.4,
  recapTime: 2.2,
  speedFromRound: 4, // rounds 1-3 are standard
  suddenAt: 3, // three or fewer left: sudden death
  maxRounds: 40,
  shoveCooldown: 2.5,
  scrambleAt: 3, // seconds left when the floor starts to panic
});

export const PLATFORM_LETTERS = Object.freeze(['A', 'B', 'C', 'D']);

export class RoyaleEngine {
  constructor() {
    this.listeners = new Map();
    this.phase = R_PHASE.IDLE;
    this.players = [];
    this.round = 0;
    this.mode = 'standard';
    this.t = 0;
    this.total = 0;
    this.question = null;
    this.correct = -1;
    this.last = null;
    this.ranking = [];
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
  startMatch({ seats, seed = (Date.now() & 0x7fffffff), localId = 0, quiz = null } = {}) {
    const list = (seats || []).slice(0, R_RULES.maxContestants);
    if (list.length < 2) throw new Error('Trapdoor Royale needs at least two contestants.');
    this.options = { seed };
    this.rng = mulberry32(seed);
    this.quiz = quiz || new QuizBank(this.rng);
    this.mirror = false;
    this.localId = localId;
    this.players = list.map((s, id) => ({
      id, name: s.name, isHuman: s.kind !== 'ai', bot: s.kind === 'ai' ? (s.bot || s.name) : null,
      alive: true, choice: null, choiceAt: 0, away: false, outRound: 0, shoveAt: -99, plan: [],
    }));
    this.round = 0;
    this.ranking = [];
    this.last = null;
    this.question = null;
    this.correct = -1;
    this.clock = 0;
    this._phase(R_PHASE.INTRO, R_RULES.introTime);
    this.emit('matchStart', { count: this.players.length });
  }

  abort() {
    this.phase = R_PHASE.IDLE;
    this.emit('abort', {});
  }

  get me() { return this.players[this.localId] || null; }
  get alive() { return this.players.filter((p) => p.alive); }
  get elapsed() { return this.total - this.t; }

  crowd() {
    const n = [0, 0, 0, 0];
    for (const p of this.players) if (p.alive && p.choice != null) n[p.choice]++;
    return n;
  }

  _phase(phase, seconds) {
    this.phase = phase;
    this.t = seconds;
    this.total = seconds;
  }

  setAway(id, away = true) {
    const p = this.players[id];
    if (!p || !p.isHuman || p.away === away) return;
    p.away = away;
    this.emit('away', { id, away });
  }

  // ---------- input ----------
  moveFor(id, platform) {
    const p = this.players[id];
    if (this.mirror || !p || !p.alive || this.phase !== R_PHASE.QUESTION) return false;
    if (!Number.isInteger(platform) || platform < 0 || platform >= R_RULES.platforms) return false;
    if (p.choice === platform) return false;
    p.choice = platform;
    p.choiceAt = this.elapsed;
    this.emit('move', { id, to: platform });
    return true;
  }

  // A shove is for show: it rocks whoever is standing nearby. It never changes an answer.
  shoveFor(id) {
    const p = this.players[id];
    if (this.mirror || !p || !p.alive) return false;
    if (this.phase !== R_PHASE.QUESTION && this.phase !== R_PHASE.INTRO && this.phase !== R_PHASE.RECAP) return false;
    if (this.clock - p.shoveAt < R_RULES.shoveCooldown) return false;
    p.shoveAt = this.clock;
    this.emit('shove', { id });
    return true;
  }

  // ---------- flow ----------
  update(dt) {
    if (this.phase === R_PHASE.IDLE || this.phase === R_PHASE.CHAMPION) return;
    this.clock = (this.clock || 0) + dt;
    if (this.mirror) { this.t = Math.max(0, this.t - dt); return; }
    if (this.phase === R_PHASE.QUESTION) this._bots();
    this.t -= dt;
    if (this.t > 0) return;
    switch (this.phase) {
      case R_PHASE.INTRO:
      case R_PHASE.RECAP:
        this._ask();
        break;
      case R_PHASE.QUESTION:
        this._phase(R_PHASE.LOCK, R_RULES.lockTime);
        this.emit('lock', {});
        break;
      case R_PHASE.LOCK:
        this._drop();
        break;
      case R_PHASE.DROP:
        if (this.alive.length <= 1 || this.round >= R_RULES.maxRounds) this._champion();
        else { this._phase(R_PHASE.RECAP, R_RULES.recapTime); this.emit('recap', { left: this.alive.length }); }
        break;
      default:
        break;
    }
  }

  _ask() {
    this.round++;
    const left = this.alive.length;
    this.mode = left <= R_RULES.suddenAt ? 'sudden' : this.round >= R_RULES.speedFromRound ? 'speed' : 'standard';
    const time = this.mode === 'sudden' ? R_RULES.suddenTime : this.mode === 'speed' ? R_RULES.speedTime : R_RULES.standardTime;
    const q = this.quiz.next();
    this.question = { text: q.text, answers: q.answers, topic: q.topic };
    this.correct = q.correct;
    this.last = null;
    for (const p of this.players) { p.choice = null; p.choiceAt = 0; p.plan = []; }
    this._phase(R_PHASE.QUESTION, time);
    for (const p of this.alive) if (!p.isHuman) this._planBot(p, time);
    this.emit('round', { n: this.round, mode: this.mode, time, left });
  }

  // Each rival decides where it will end up, and how it gets there.
  _planBot(p, time) {
    const rng = this.rng;
    const prof = botProfile(p.bot);
    const final = botAnswer(prof, this.correct, R_RULES.platforms, rng);
    const at = Math.min(time - 0.6, time * (0.12 + prof.pace * 0.6 + rng() * 0.14));
    const other = () => (final + 1 + Math.floor(rng() * 3)) % 4;
    const plan = [];
    if (prof.style === 'wobbler') {
      plan.push({ at: at * 0.45, to: other() });
      plan.push({ at, to: final });
    } else if (prof.style === 'chaos') {
      plan.push({ at: at * 0.3, to: Math.floor(rng() * 4) });
      plan.push({ at: at * 0.7, to: Math.floor(rng() * 4) });
      plan.push({ at: Math.min(time - 0.4, at + 1), to: final });
    } else if (prof.style === 'herd') {
      plan.push({ at, to: final });
      if (rng() < 0.55) plan.push({ at: Math.max(at + 0.3, time - 2.2), to: 'crowd' });
    } else {
      plan.push({ at, to: final });
    }
    p.plan = plan;
    p.shovePlan = prof.style === 'chaos' || prof.style === 'bold' ? at + 0.5 + rng() * 3 : -1;
  }

  _bots() {
    const now = this.elapsed;
    for (const p of this.players) {
      if (!p.alive || p.isHuman) continue;
      while (p.plan.length && p.plan[0].at <= now) {
        const step = p.plan.shift();
        let to = step.to;
        if (to === 'crowd') {
          const crowd = this.crowd();
          to = crowd.indexOf(Math.max(...crowd));
        }
        this.moveFor(p.id, to);
      }
      if (p.shovePlan > 0 && now >= p.shovePlan) { p.shovePlan = -1; this.shoveFor(p.id); }
    }
  }

  _drop() {
    const alive = this.alive;
    const right = alive.filter((p) => p.choice === this.correct);
    let fallen = [];
    let mercy = false;
    let slow = null;
    if (right.length === 0) {
      // Nobody found it. The floor holds, and everyone gets another go.
      mercy = true;
    } else {
      fallen = alive.filter((p) => p.choice !== this.correct).map((p) => p.id);
      if (this.mode === 'sudden' && fallen.length === 0 && right.length > 1) {
        // Sudden death: everyone was right, so the last one onto the platform drops.
        const last = right.slice().sort((a, b) => b.choiceAt - a.choiceAt || b.id - a.id)[0];
        slow = last.id;
        fallen = [slow];
      }
    }
    for (const id of fallen) {
      const p = this.players[id];
      p.alive = false;
      p.outRound = this.round;
    }
    this.ranking = [...fallen.slice().sort((a, b) => a - b), ...this.ranking];
    this.last = { correct: this.correct, fallen, mercy, slow, crowd: this.crowd() };
    this._phase(R_PHASE.DROP, R_RULES.dropTime);
    this.emit('reveal', { correct: this.correct, answer: this.question.answers[this.correct], fallen, mercy, slow });
  }

  _champion() {
    const left = this.alive.map((p) => p.id);
    // Normally one is left. If the round cap was hit, whoever is still up shares the floor.
    this.ranking = [...left, ...this.ranking];
    this.phase = R_PHASE.CHAMPION;
    this.t = 0;
    this.emit('champion', { id: left[0], shared: left.length > 1 ? left : null, ranking: this.ranking });
  }

  // ---------- snapshots ----------
  serialize() {
    const open = this.phase === R_PHASE.DROP || this.phase === R_PHASE.RECAP || this.phase === R_PHASE.CHAMPION;
    return {
      o: this.options, ph: this.phase, t: this.t, tt: this.total, r: this.round, m: this.mode,
      q: this.question, c: open ? this.correct : -1, last: this.last, rank: this.ranking,
      pl: this.players.map((p) => ({ id: p.id, n: p.name, h: p.isHuman ? 1 : 0, b: p.bot, al: p.alive ? 1 : 0, ch: p.choice, ca: p.choiceAt, aw: p.away ? 1 : 0, or: p.outRound })),
    };
  }

  hydrate(s, localId = this.localId) {
    this.mirror = true;
    this.localId = localId;
    this.options = s.o;
    this.phase = s.ph;
    this.t = s.t;
    this.total = s.tt;
    this.round = s.r;
    this.mode = s.m;
    this.question = s.q;
    this.correct = s.c;
    this.last = s.last;
    this.ranking = s.rank;
    this.players = s.pl.map((p) => ({ id: p.id, name: p.n, isHuman: !!p.h, bot: p.b, alive: !!p.al, choice: p.ch, choiceAt: p.ca, away: !!p.aw, outRound: p.or, shoveAt: -99, plan: [] }));
  }
}
