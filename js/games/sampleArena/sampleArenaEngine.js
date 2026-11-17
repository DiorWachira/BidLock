// SOUNDCLASH — rules engine. Pure: no DOM, audio or rendering. Deterministic for a seed.
//
// A sound clash is a battle between sound systems. Here every player is a "sound". Each
// of eight rounds drops a three-second loop of a real song, warped, and four titles. Name
// it fast: 1,000 points at the drop, falling to 500 by eight seconds. Then the warp
// lifts for four seconds of overtime, worth 350 falling to 150. Right answers in a row
// build a streak multiplier. Points are also ammunition: spend them mid-round to throw a
// dubplate at a rival and wreck their audio.
//
// Secrets: which option is right, and everyone's choices, stay out of snapshots until
// the reveal. A guest learns only that a rival has locked in, and when.

import { mulberry32 } from '../../engine/auctionEngine.js';
import { botProfile } from '../../arcade/bots.js';

export const S_PHASE = Object.freeze({
  IDLE: 'IDLE', INTRO: 'INTRO', CUE: 'CUE', PLAY: 'PLAY', REVEAL: 'REVEAL', PODIUM: 'PODIUM',
});

export const S_RULES = Object.freeze({
  maxSounds: 6,
  introTime: 4,
  cueTime: 1.6, // the needle drops
  roundTime: 12,
  warpTime: 8, // then overtime: the warp lifts
  revealTime: 3.5,
  allInGrace: 0.7, // once everyone has locked in, the round ends this much later
  warpMax: 1000,
  warpMin: 500,
  overMax: 350,
  overMin: 150,
  finalWrong: 250, // the dubplate special: a wrong answer costs this
  streaks: [1, 1.2, 1.5, 2], // by right answers in a row: 1, 2, 3, 4+
});

export const WARP_ORDER = Object.freeze(['NIGHTCORE_UP', 'CHOPPED_SCREWED', 'UNDERWATER_SUB', 'REVERSE_SPIN']);
export const FINAL_WARP = 'CLEAN_FINAL';
// How much each warp hides a song from a bot's ear.
const WARP_EASE = { NIGHTCORE_UP: 0.85, CHOPPED_SCREWED: 0.8, UNDERWATER_SUB: 0.72, REVERSE_SPIN: 0.5, CLEAN_FINAL: 1 };

export const SABOTAGES = Object.freeze({
  under: { id: 'under', name: 'Underwater Muffle', short: 'UNDERWATER', cost: 300, time: 4, line: 'muffles their sound to 240 Hz for four seconds' },
  scratch: { id: 'scratch', name: 'Vinyl Scratch & Scramble', short: 'SCRATCH', cost: 450, time: 3, line: 'scratches their record and scrambles their buttons for three seconds' },
  shock: { id: 'shock', name: 'Reverse / Chipmunk Shockwave', short: 'SHOCKWAVE', cost: 600, time: 3, line: 'flips their loop and their card for three seconds, and breaks their streak' },
});
export const SABOTAGE_ORDER = Object.freeze(['under', 'scratch', 'shock']);
// What a hit does to a bot, which has no ears to muffle: it loses time and may fumble.
// Muffled or flipped, it cannot place the song until the clean overtime.
const BOT_HIT = { under: { delay: 2.2, fumble: 0.25, overtime: true }, scratch: { delay: 1.8, fumble: 0.55, overtime: true }, shock: { delay: 2.8, fumble: 0.75, overtime: true } };

export const streakMult = (streak) => S_RULES.streaks[Math.min(S_RULES.streaks.length - 1, Math.max(0, streak - 1))];

// Base points for a right answer locked in `at` seconds after the drop.
export function speedPoints(at) {
  const R = S_RULES;
  if (at <= R.warpTime) return Math.round(R.warpMax - (R.warpMax - R.warpMin) * Math.max(0, at) / R.warpTime);
  const over = Math.min(1, (at - R.warpTime) / (R.roundTime - R.warpTime));
  return Math.round(R.overMax - (R.overMax - R.overMin) * over);
}

export class SampleArenaEngine {
  constructor() {
    this.listeners = new Map();
    this.phase = S_PHASE.IDLE;
    this.players = [];
    this.localId = 0;
    this.t = 0;
    this.total = 0;
    this.round = 0;
    this.rounds = [];
    this.current = null;
    this.correct = -1;
    this.last = null;
    this.ranking = [];
    this.mirror = false;
    this.options = {};
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

  // match: { source, genre, rounds } from itunesLoader.loadMatch
  startMatch({ seats, seed = (Date.now() & 0x7fffffff), localId = 0, match } = {}) {
    const list = (seats || []).slice(0, S_RULES.maxSounds);
    if (list.length < 2) throw new Error('Soundclash needs at least two sounds.');
    if (!match || !Array.isArray(match.rounds) || !match.rounds.length) throw new Error('Soundclash needs a crate of rounds.');
    this.options = { seed, source: match.source, genre: match.genre };
    this.rng = mulberry32(seed);
    this.mirror = false;
    this.localId = localId;
    this.rounds = match.rounds.map((r, i) => ({ ...r, warp: null, n: i + 1 }));
    // Warps: every one of the four before any repeats, never twice in a row, and the
    // last round is the clean dubplate special.
    let bag = [];
    let prev = null;
    for (let i = 0; i < this.rounds.length; i++) {
      if (i === this.rounds.length - 1) { this.rounds[i].warp = FINAL_WARP; break; }
      if (!bag.length) bag = shuffle(WARP_ORDER.slice(), this.rng);
      let k = bag.findIndex((w) => w !== prev);
      if (k < 0) k = 0;
      prev = bag.splice(k, 1)[0];
      this.rounds[i].warp = prev;
    }
    this.players = list.map((s, id) => ({
      id, name: s.name, isHuman: s.kind !== 'ai', bot: s.kind === 'ai' ? (s.bot || s.name) : null,
      score: 0, streak: 0, best: 0, right: 0, away: false,
      locked: false, at: 0, choice: null, ok: null, gain: 0, mult: 1,
      fx: {}, sabRound: 0, sabLanded: 0, sabHit: 0, fastest: null, plan: null, botSab: null,
    }));
    this.round = 0;
    this.current = null;
    this.correct = -1;
    this.last = null;
    this.ranking = [];
    this._phase(S_PHASE.INTRO, S_RULES.introTime);
    this.emit('matchStart', { count: this.players.length, source: match.source, genre: match.genre, urls: this.urls() });
  }

  // Every preview in the match, in order, so guests can fetch ahead.
  urls() { return this.rounds.map((r) => (r.target && r.target.url) || ''); }

  abort() {
    this.phase = S_PHASE.IDLE;
    this.emit('abort', {});
  }

  get me() { return this.players[this.localId] || null; }
  get elapsed() { return this.total - this.t; }
  get final() { return this.round === this.rounds.length; }
  get overtime() { return this.phase === S_PHASE.PLAY && this.elapsed >= S_RULES.warpTime; }
  get leader() {
    let best = null;
    for (const p of this.players) if (!best || p.score > best.score) best = p;
    return best;
  }
  get humansIn() { return this.players.filter((p) => p.isHuman && !p.away).length; }
  // Effects running on a player right now: { under, scratch, shock } -> seconds left
  effects(p) {
    const out = {};
    if (!p || this.phase !== S_PHASE.PLAY) return out;
    for (const k of SABOTAGE_ORDER) {
      const f = p.fx[k];
      if (f && f.until > this.elapsed) out[k] = { left: f.until - this.elapsed, ...f };
    }
    return out;
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

  // ---------- inputs ----------
  answerFor(id, choice) {
    const p = this.players[id];
    if (!p || this.phase !== S_PHASE.PLAY || p.locked) return false;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return false;
    p.locked = true;
    p.choice = choice;
    // A guest's answer is timed from when it was sent: inputLag is how late it arrived.
    p.at = Math.round(Math.max(0, this.elapsed - (this.inputLag || 0)) * 1000) / 1000;
    p.ok = choice === this.correct;
    this.emit('lock', { id, at: p.at });
    return true;
  }

  // Throw a dubplate. `to` is a seat, or 'leader' for whoever is top (not you).
  sabotageFor(id, kind, to) {
    const p = this.players[id];
    const s = SABOTAGES[kind];
    if (!p || !s || this.phase !== S_PHASE.PLAY) return false;
    if (p.sabRound === this.round) return false; // one throw a round
    if (p.score < s.cost) return false;
    let target = to === 'leader' ? this._topRival(id) : this.players[to];
    if (!target || target.id === id || target.locked) return false;
    p.score -= s.cost;
    p.sabRound = this.round;
    p.sabLanded++;
    target.sabHit++;
    const fx = { by: id, until: this.elapsed + s.time };
    if (kind === 'scratch') fx.perm = shuffle([0, 1, 2, 3], this.rng);
    if (kind === 'shock') {
      fx.mode = this.rng() < 0.5 ? 'reverse' : 'chipmunk';
      // The shockwave also breaks their streak: the multiplier starts again.
      fx.broke = target.streak;
      target.streak = 0;
    }
    target.fx[kind] = fx;
    // A house sound that is hit loses its place: it answers later and may fumble.
    if (!target.isHuman && target.plan) {
      const h = BOT_HIT[kind];
      target.plan.at += h.delay;
      if (h.overtime) target.plan.at = Math.max(target.plan.at, S_RULES.warpTime + 0.3 + this.rng() * 1.4);
      if (target.plan.choice === this.correct && this.rng() < h.fumble) target.plan.choice = this._wrong(this.rng);
    }
    this.emit('sabotage', { from: id, to: target.id, kind, mode: fx.mode || null, perm: fx.perm || null });
    return true;
  }

  _topRival(id) {
    let best = null;
    for (const p of this.players) if (p.id !== id && !p.locked && (!best || p.score > best.score)) best = p;
    return best;
  }

  // ---------- the clock ----------
  update(dt) {
    if (this.phase === S_PHASE.IDLE || this.phase === S_PHASE.PODIUM) return;
    if (this.mirror) { this.t = Math.max(0, this.t - dt); return; }
    const wasWarped = this.phase === S_PHASE.PLAY && !this.overtime;
    this.t -= dt;
    if (this.phase === S_PHASE.PLAY) {
      if (wasWarped && this.overtime) this.emit('overtime', { n: this.round });
      this._bots();
      const waiting = this.players.filter((p) => !p.locked && !(p.isHuman && p.away));
      if (!waiting.length && this.t > S_RULES.allInGrace) this.t = S_RULES.allInGrace;
    }
    if (this.t > 0) return;
    switch (this.phase) {
      case S_PHASE.INTRO: this._cue(); break;
      case S_PHASE.CUE: this._play(); break;
      case S_PHASE.PLAY: this._reveal(); break;
      case S_PHASE.REVEAL: if (this.round >= this.rounds.length) this._podium(); else this._cue(); break;
      default: break;
    }
  }

  _cue() {
    this.round++;
    const r = this.rounds[this.round - 1];
    this.current = {
      n: this.round, of: this.rounds.length, warp: r.warp, final: this.round === this.rounds.length,
      url: r.target.url || '', synth: r.target.synth || null, start: r.start || 0, options: r.options,
    };
    this.correct = r.correct;
    this.last = null;
    for (const p of this.players) {
      p.locked = false; p.at = 0; p.choice = null; p.ok = null; p.gain = 0; p.mult = 1; p.fx = {}; p.plan = null; p.botSab = null;
    }
    this._phase(S_PHASE.CUE, S_RULES.cueTime);
    this.emit('cue', { n: this.round, of: this.rounds.length, warp: r.warp, final: this.current.final });
  }

  _play() {
    this._phase(S_PHASE.PLAY, S_RULES.roundTime);
    for (const p of this.players) if (!p.isHuman) this._planBot(p);
    // At most one house sound throws a dubplate each round.
    const throwers = this.players.filter((p) => p.botSab).sort((x, y) => x.botSab.at - y.botSab.at);
    for (const p of throwers.slice(1)) p.botSab = null;
    this.emit('play', { n: this.round });
  }

  // ---------- the house sounds ----------
  _planBot(p) {
    const rng = this.rng;
    const prof = botProfile(p.bot);
    const r = this.rounds[this.round - 1];
    const pop = r.target.pop == null ? 0.7 : r.target.pop;
    const ease = WARP_EASE[r.warp] || 0.8;
    const knows = rng() < prof.skill * (0.55 + 0.45 * pop) * ease + 0.08;
    let at;
    let choice;
    if (knows) {
      at = 0.9 + prof.pace * 4 + (1 - pop) * 1.8 + rng() * 1.6;
      choice = this.correct;
    } else if (rng() < 0.6) {
      // Waits for the clean overtime, then probably gets it.
      at = S_RULES.warpTime + 0.4 + rng() * 2.6;
      choice = rng() < prof.skill * (0.6 + 0.4 * pop) + 0.15 ? this.correct : this._wrong(rng);
    } else {
      at = 2.5 + rng() * 5;
      choice = rng() < 0.25 ? this.correct : this._wrong(rng);
    }
    p.plan = { at: Math.min(S_RULES.roundTime - 0.4, at), choice };
    // Sabotage: mostly aimed at a person in the lead.
    const lead = this.leader;
    if (lead && lead.id !== p.id && lead.score > 0) {
      const chance = lead.isHuman ? 0.16 : 0.05;
      if (rng() < chance) {
        const can = SABOTAGE_ORDER.filter((k) => SABOTAGES[k].cost <= p.score);
        if (can.length) p.botSab = { at: 1.2 + rng() * 4.5, kind: can[Math.floor(rng() * can.length)], to: lead.id };
      }
    }
  }

  _wrong(rng) {
    const w = [0, 1, 2, 3].filter((i) => i !== this.correct);
    return w[Math.floor(rng() * w.length)];
  }

  _bots() {
    const now = this.elapsed;
    for (const p of this.players) {
      if (p.isHuman) continue;
      if (p.botSab && now >= p.botSab.at) {
        const s = p.botSab;
        p.botSab = null;
        this.sabotageFor(p.id, s.kind, s.to);
      }
      if (p.locked || !p.plan) continue;
      if (now >= p.plan.at) this.answerFor(p.id, p.plan.choice);
    }
  }

  // ---------- the reveal ----------
  _reveal() {
    const r = this.rounds[this.round - 1];
    const final = this.round === this.rounds.length;
    const gains = [];
    let fastest = null;
    for (const p of this.players) {
      let gain = 0;
      if (p.locked && p.ok) {
        p.streak++;
        p.right++;
        p.best = Math.max(p.best, p.streak);
        p.mult = streakMult(p.streak);
        gain = Math.round(speedPoints(p.at) * p.mult * (final ? 2 : 1));
        if (p.fastest == null || p.at < p.fastest) p.fastest = p.at;
        if (!fastest || p.at < fastest.at) fastest = { id: p.id, at: p.at };
      } else {
        p.streak = 0;
        p.mult = 1;
        if (final && p.locked) gain = -Math.min(p.score, S_RULES.finalWrong);
      }
      p.gain = gain;
      p.score += gain;
      gains.push({ id: p.id, gain, ok: !!(p.locked && p.ok), locked: p.locked, at: p.at, choice: p.choice, streak: p.streak, mult: p.mult });
    }
    const t = r.target;
    this.last = {
      n: this.round, correct: this.correct, title: t.title, artist: t.artist, art: t.art || '', link: t.link || '', synth: t.synth || null,
      gains, fastest,
    };
    this._phase(S_PHASE.REVEAL, S_RULES.revealTime);
    this.emit('reveal', this.last);
  }

  standings() {
    return this.players.slice().sort((a, b) => b.score - a.score || b.right - a.right || (a.fastest ?? 99) - (b.fastest ?? 99) || a.id - b.id);
  }

  _podium() {
    const order = this.standings();
    this.ranking = order.map((p) => p.id);
    let quick = null;
    for (const p of this.players) if (p.fastest != null && (!quick || p.fastest < quick.at)) quick = { id: p.id, at: p.fastest };
    let sab = null;
    for (const p of this.players) if (p.sabLanded && (!sab || p.sabLanded > sab.count)) sab = { id: p.id, count: p.sabLanded };
    let streak = null;
    for (const p of this.players) if (p.best >= 2 && (!streak || p.best > streak.best)) streak = { id: p.id, best: p.best };
    this.phase = S_PHASE.PODIUM;
    this.t = 0;
    this.total = 0;
    this.awards = { mvp: order[0].id, fastest: quick, saboteur: sab, streak };
    this.emit('podium', { ranking: this.ranking, ...this.awards });
  }

  // ---------- the room ----------
  serialize() {
    const open = this.phase === S_PHASE.REVEAL || this.phase === S_PHASE.PODIUM;
    return {
      o: this.options, ph: this.phase, t: this.t, tt: this.total, r: this.round, n: this.rounds.length,
      cur: this.current, c: open ? this.correct : -1, last: open ? this.last : null, rank: this.ranking, aw: this.awards || null,
      u: this.urls(),
      pl: this.players.map((p) => ({
        id: p.id, n: p.name, h: p.isHuman ? 1 : 0, b: p.bot, s: p.score, st: p.streak, be: p.best, ri: p.right, aw: p.away ? 1 : 0,
        lk: p.locked ? 1 : 0, at: p.at, ch: open ? p.choice : null, ok: open ? p.ok : null, g: open ? p.gain : 0, m: p.mult,
        fx: p.fx, sr: p.sabRound, sl: p.sabLanded, sh: p.sabHit, fa: p.fastest,
      })),
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
    this.current = s.cur;
    this.correct = s.c;
    this.last = s.last;
    this.ranking = s.rank || [];
    this.awards = s.aw || null;
    this._urls = s.u || [];
    this.rounds = Array.from({ length: s.n || 0 }, (_, i) => ({ n: i + 1, target: { url: (s.u || [])[i] || '' } }));
    this.players = s.pl.map((p) => ({
      id: p.id, name: p.n, isHuman: !!p.h, bot: p.b, score: p.s, streak: p.st, best: p.be, right: p.ri, away: !!p.aw,
      locked: !!p.lk, at: p.at, choice: p.ch, ok: p.ok, gain: p.g, mult: p.m, fx: p.fx || {}, sabRound: p.sr, sabLanded: p.sl, sabHit: p.sh, fastest: p.fa,
      plan: null, botSab: null,
    }));
  }
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
