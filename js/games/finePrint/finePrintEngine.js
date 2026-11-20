// FINE PRINT — rules engine. Pure: no DOM, speech or rendering. Deterministic for a seed.
//
// Channel 20's overnight shopping hour. Each of five offers is a strange but true fact
// with its ending in the fine print, blanked out. Everyone writes a fake ending (a
// knock-off) that sounds true. The knock-offs are shuffled in with the genuine article,
// read out at speed like the small print at the end of an advert, and everyone phones in
// the one they think is real. Find the genuine article: 1,000. Every caller your knock-off
// fools: 500. A five-star review from another caller: 100. Later offers pay double, and
// the closing offer triple.
//
// Secrets: who wrote what, who called which line, and which line is genuine stay out of
// snapshots until the reveal. During the writing a guest learns only who has filed.

import { mulberry32 } from '../../engine/auctionEngine.js';
import { botProfile } from '../../arcade/bots.js';
import { FACTS, factsFor } from './facts.js';

export const F_PHASE = Object.freeze({
  IDLE: 'IDLE', INTRO: 'INTRO', PITCH: 'PITCH', WRITE: 'WRITE', CALL: 'CALL', REVEAL: 'REVEAL', PODIUM: 'PODIUM',
});

export const F_RULES = Object.freeze({
  maxPlayers: 6,
  rounds: 5,
  introTime: 4.5,
  pitchTime: 4, // the offer goes up and is read out
  writeTime: 50,
  writeGrace: 1.5, // once everyone has filed, this long to change their minds
  callTime: 30,
  callGrace: 2.5,
  revealOpen: 1.6,
  revealLine: 2.4, // each knock-off that fooled somebody is unmasked in turn
  revealTruth: 4.8,
  maxLen: 60,
  minLines: 4,
  truth: 1000,
  fool: 500,
  star: 100,
});

// The rate card: standard, then premium rate (×2), and the closing offer (×3).
export function rateFor(i, count) {
  if (i === count - 1 && count > 1) return 3;
  return i >= Math.ceil((count - 1) / 2) ? 2 : 1;
}
export const RATE_NAMES = Object.freeze({ 1: 'STANDARD RATE', 2: 'PREMIUM RATE ×2', 3: 'THE CLOSING OFFER ×3' });

// ---------- text ----------
const ch = (n) => String.fromCharCode(n);
const span = (a, b) => `${ch(a)}-${ch(b)}`;
const RX_MARKS = new RegExp(`[${span(0x300, 0x36f)}]`, 'g'); // combining accents, after NFKD
const RX_APOS = new RegExp(`['${ch(0x60)}${ch(0x2018)}${ch(0x2019)}]`, 'g');
// Control characters, zero-width and direction-changing marks, line and paragraph separators.
const RX_HIDDEN = new RegExp(`[${span(0, 0x1f)}${span(0x7f, 0x9f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x206f)}${ch(0xfeff)}]`, 'g');
const QUOTES = `"'${ch(0x201c)}${ch(0x201d)}${ch(0x2018)}${ch(0x2019)}`;
const RX_WRAP = new RegExp(`^[${QUOTES}]+|[${QUOTES}]+$`, 'g');
const RX_END = new RegExp(`[.${ch(0x2026)},;:]+$`); // a closing ? or ! is part of what was said
const LEADING = new Set(['a', 'an', 'the', 'its', 'his', 'her', 'their', 'some', 'my', 'your', 'our']);

// For comparing: no accents, case, punctuation or leading article.
export function norm(s) {
  const t = String(s ?? '').normalize('NFKD').replace(RX_MARKS, '').toLowerCase()
    .replace(/&/g, ' and ').replace(RX_APOS, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = t ? t.split(' ') : [];
  while (words.length > 1 && LEADING.has(words[0])) words.shift();
  return words.join(' ');
}

// What a player typed, made safe to show and read out: one line, no control or
// direction-changing characters, no wrapping quotes or closing full stop or comma, at most 60.
export function cleanEntry(s, max = F_RULES.maxLen) {
  let t = String(s ?? '').replace(RX_HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(RX_WRAP, '').trim();
  t = t.replace(RX_END, '').trim();
  const chars = [...t];
  if (chars.length > max) t = chars.slice(0, max).join('').trim();
  return t;
}

export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Two entries that would read as the same line.
export function sameEntry(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 8 && lev(x, y) <= 1;
}

// Is this the real ending, or too close to it? The house bounces it: write a fake one.
export function isTruth(text, fact) {
  const n = norm(text);
  if (!n || !fact) return false;
  const forms = [fact.truth, ...(fact.also || [])].map(norm).filter(Boolean);
  if (forms.includes(n)) return true;
  if (fact.like && new RegExp(fact.like, 'i').test(n)) return true;
  const words = n.split(' ').length;
  for (const f of forms) {
    // A slip of the keyboard on a long word ("radioactve").
    if (f.length >= 8 && lev(n, f) <= (f.length >= 12 ? 2 : 1)) return true;
    // The real thing with a word or two around it ("the giant emus" is still emus).
    const fw = f.split(' ').length;
    if ((f.length >= 6 || fw >= 2) && words <= fw + 2 && ` ${n} `.includes(` ${f} `)) return true;
  }
  return false;
}

// Tonight's facts: from the department, not ones this device has seen lately if it can.
export function pickFacts(dept, rng, n = F_RULES.rounds, seen = []) {
  const pool = factsFor(dept);
  const old = new Set(seen);
  const fresh = shuffle(pool.filter((f) => !old.has(f.id)), rng);
  const stale = shuffle(pool.filter((f) => old.has(f.id)), rng);
  // Seen ones go back in the order they were seen, oldest first.
  stale.sort((a, b) => seen.indexOf(a.id) - seen.indexOf(b.id));
  const out = [...fresh, ...stale].slice(0, n);
  for (const f of shuffle(FACTS.slice(), rng)) { if (out.length >= n) break; if (!out.includes(f)) out.push(f); }
  return out;
}

export class FinePrintEngine {
  constructor() {
    this.listeners = new Map();
    this.phase = F_PHASE.IDLE;
    this.players = [];
    this.localId = 0;
    this.t = 0;
    this.total = 0;
    this.round = 0;
    this.rounds = [];
    this.current = null;
    this.lines = null;
    this.truthLine = -1;
    this.last = null;
    this.ranking = [];
    this.awards = null;
    this.mirror = false;
    this.options = {};
    this.inputLag = 0;
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

  // match: { dept, facts: [fact, …] }
  startMatch({ seats, seed = (Date.now() & 0x7fffffff), localId = 0, match } = {}) {
    const R = F_RULES;
    const list = (seats || []).slice(0, R.maxPlayers);
    if (list.length < 2) throw new Error('Fine Print needs at least two players.');
    if (!match || !Array.isArray(match.facts) || !match.facts.length) throw new Error('Fine Print needs some facts.');
    this.rng = mulberry32(seed);
    this.mirror = false;
    this.localId = localId;
    this.options = { seed, dept: match.dept || 'all' };
    const n = match.facts.length;
    this.rounds = match.facts.map((fact, i) => ({ n: i + 1, fact, rate: rateFor(i, n) }));
    this.players = list.map((s, id) => ({
      id, name: s.name, isHuman: s.kind !== 'ai', bot: s.kind === 'ai' ? (s.bot || s.name) : null,
      score: 0, away: false, gain: 0, found: 0, fooled: 0, stars: 0, bounced: 0,
      wrote: false, fake: null, at: 0, voted: false, vote: null, star: null, plan: null,
    }));
    this.round = 0;
    this.current = null;
    this.lines = null;
    this.truthLine = -1;
    this.last = null;
    this.ranking = [];
    this.awards = null;
    this._phase(F_PHASE.INTRO, R.introTime);
    this.emit('matchStart', { count: this.players.length, dept: this.options.dept, n });
  }

  abort() {
    this.phase = F_PHASE.IDLE;
    this.emit('abort', {});
  }

  get me() { return this.players[this.localId] || null; }
  get elapsed() { return this.total - this.t; }
  get leader() {
    let best = null;
    for (const p of this.players) if (!best || p.score > best.score) best = p;
    return best;
  }
  get fact() { return this.round ? this.rounds[this.round - 1].fact : null; }

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

  // The line a player wrote, if it made it onto the board.
  lineOf(id) {
    if (!this.lines) return -1;
    return this.lines.findIndex((l) => l.authors.includes(id));
  }

  // ---------- inputs ----------
  // File a knock-off, or change it, while the writing lasts.
  writeFor(id, text) {
    const p = this.players[id];
    if (!p || this.phase !== F_PHASE.WRITE) return false;
    const t = cleanEntry(text);
    if (!t) return false;
    if (isTruth(t, this.fact)) {
      p.bounced++;
      this.emit('bounce', { id, why: 'truth' });
      return false;
    }
    if (p.fake && p.fake === t) return false;
    const changed = p.wrote;
    p.fake = t;
    p.wrote = true;
    p.at = Math.round(Math.max(0, this.elapsed - (this.inputLag || 0)) * 1000) / 1000;
    this.emit('wrote', { id, changed });
    return true;
  }

  // Phone in the line you think is genuine. Not your own; change it while the lines are open.
  voteFor(id, i) {
    const p = this.players[id];
    if (!p || this.phase !== F_PHASE.CALL || !this.lines) return false;
    if (!Number.isInteger(i) || i < 0 || i >= this.lines.length) return false;
    if (this.lines[i].authors.includes(id)) return false;
    if (p.voted && p.vote === i) return false;
    const changed = p.voted;
    p.voted = true;
    p.vote = i;
    p.at = Math.round(Math.max(0, this.elapsed - (this.inputLag || 0)) * 1000) / 1000;
    this.emit('vote', { id, changed });
    return true;
  }

  // One five-star review a round, for any line but your own. Again to take it back.
  starFor(id, i) {
    const p = this.players[id];
    if (!p || this.phase !== F_PHASE.CALL || !this.lines) return false;
    if (!Number.isInteger(i) || i < 0 || i >= this.lines.length) return false;
    if (this.lines[i].authors.includes(id)) return false;
    p.star = p.star === i ? null : i;
    this.emit('star', { id, on: p.star != null });
    return true;
  }

  // ---------- the clock ----------
  update(dt) {
    if (this.phase === F_PHASE.IDLE || this.phase === F_PHASE.PODIUM) return;
    if (this.mirror) { this.t = Math.max(0, this.t - dt); return; }
    const R = F_RULES;
    this.t -= dt;
    if (this.phase === F_PHASE.WRITE) {
      this._bots();
      const waiting = this.players.filter((p) => !p.wrote && !(p.isHuman && p.away));
      if (!waiting.length && this.t > R.writeGrace) this.t = R.writeGrace;
    } else if (this.phase === F_PHASE.CALL) {
      this._bots();
      const waiting = this.players.filter((p) => !p.voted && !(p.isHuman && p.away));
      if (!waiting.length && this.t > R.callGrace) this.t = R.callGrace;
    }
    if (this.t > 0) return;
    switch (this.phase) {
      case F_PHASE.INTRO: this._pitch(); break;
      case F_PHASE.PITCH: this._write(); break;
      case F_PHASE.WRITE: this._call(); break;
      case F_PHASE.CALL: this._reveal(); break;
      case F_PHASE.REVEAL: if (this.round >= this.rounds.length) this._podium(); else this._pitch(); break;
      default: break;
    }
  }

  _pitch() {
    this.round++;
    const r = this.rounds[this.round - 1];
    const f = r.fact;
    // The warehouse: the house's ready-made knock-offs. Bots take theirs first; then up
    // to three go on offer to anyone stuck for an idea; the rest pad the board.
    const stock = shuffle(f.fakes.slice(), this.rng);
    for (const p of this.players) {
      p.wrote = false; p.fake = null; p.at = 0; p.voted = false; p.vote = null; p.star = null; p.gain = 0; p.plan = null;
      if (!p.isHuman) {
        const prof = botProfile(p.bot);
        p.plan = { fake: stock.length ? stock.shift() : null, at: 5 + prof.pace * 16 + this.rng() * 14 };
      }
    }
    const offer = stock.splice(0, Math.min(3, stock.length));
    this.stockLeft = stock;
    this.lines = null;
    this.truthLine = -1;
    this.last = null;
    // (Not the fact's id: many ids are the answer itself.)
    this.current = { n: this.round, of: this.rounds.length, rate: r.rate, dept: f.dept, text: f.text, stock: offer, lines: null };
    this._phase(F_PHASE.PITCH, F_RULES.pitchTime);
    this.emit('pitch', { n: this.round, of: this.rounds.length, rate: r.rate, final: this.round === this.rounds.length });
  }

  _write() {
    this._phase(F_PHASE.WRITE, F_RULES.writeTime);
    this.emit('write', { n: this.round });
  }

  _call() {
    const f = this.fact;
    const lines = [{ text: f.truth, truth: true, house: false, authors: [] }];
    for (const p of this.players) {
      if (!p.fake) continue;
      const same = lines.find((l) => !l.truth && sameEntry(l.text, p.fake));
      if (same) same.authors.push(p.id);
      else lines.push({ text: p.fake, truth: false, house: false, authors: [p.id] });
    }
    // Too few lines for a real choice: the house adds some of its own.
    const pad = [...(this.stockLeft || []), ...((this.current && this.current.stock) || [])];
    while (lines.length < F_RULES.minLines && pad.length) {
      const t = pad.shift();
      if (!lines.some((l) => sameEntry(l.text, t))) lines.push({ text: t, truth: false, house: true, authors: [] });
    }
    shuffle(lines, this.rng);
    this.lines = lines;
    this.truthLine = lines.findIndex((l) => l.truth);
    this.current = { ...this.current, lines: lines.map((l) => l.text) };
    for (const p of this.players) {
      p.voted = false; p.vote = null; p.star = null;
      if (!p.isHuman) this._planVote(p);
    }
    this._phase(F_PHASE.CALL, F_RULES.callTime);
    this.emit('call', { n: this.round, count: lines.length });
  }

  // ---------- the house players ----------
  _planVote(p) {
    const rng = this.rng;
    const prof = botProfile(p.bot);
    const mine = this.lineOf(p.id);
    const others = this.lines.map((_, i) => i).filter((i) => i !== mine && i !== this.truthLine);
    let vote = this.truthLine;
    if (others.length && rng() >= 0.2 + 0.42 * prof.skill) {
      // Taken in by a knock-off: the house is easiest to fool with a person's.
      const w = others.map((i) => (this.lines[i].house ? 0.8 : this.players[this.lines[i].authors[0]].isHuman ? 1.8 : 1));
      let r = rng() * w.reduce((a, b) => a + b, 0);
      vote = others[others.length - 1];
      for (let k = 0; k < others.length; k++) { r -= w[k]; if (r <= 0) { vote = others[k]; break; } }
    }
    let star = null;
    const humanLines = this.lines.map((l, i) => i).filter((i) => i !== mine && this.lines[i].authors.some((a) => this.players[a].isHuman));
    if (humanLines.length && rng() < 0.35) star = humanLines[Math.floor(rng() * humanLines.length)];
    p.plan = { vote, at: Math.min(F_RULES.callTime - 3, 4 + prof.pace * 10 + rng() * 9), star };
  }

  _bots() {
    const now = this.elapsed;
    for (const p of this.players) {
      if (p.isHuman || !p.plan || now < p.plan.at) continue;
      if (this.phase === F_PHASE.WRITE && !p.wrote) {
        if (p.plan.fake) this.writeFor(p.id, p.plan.fake);
        else p.wrote = true; // nothing left in the warehouse: it sits this one out
      } else if (this.phase === F_PHASE.CALL && !p.voted) {
        this.voteFor(p.id, p.plan.vote);
        if (p.plan.star != null) this.starFor(p.id, p.plan.star);
      }
    }
  }

  // ---------- the reveal ----------
  _reveal() {
    const R = F_RULES;
    const rate = this.current.rate;
    const n = this.lines.length;
    const voters = Array.from({ length: n }, () => []);
    const stars = Array.from({ length: n }, () => []);
    for (const p of this.players) {
      if (p.vote != null) voters[p.vote].push(p.id);
      if (p.star != null) stars[p.star].push(p.id);
    }
    const gains = new Map(this.players.map((p) => [p.id, { id: p.id, gain: 0, found: false, fooled: 0, stars: 0, vote: p.vote, wrote: !!p.fake }]));
    for (const p of this.players) {
      if (p.vote === this.truthLine) {
        const g = gains.get(p.id);
        g.found = true;
        g.gain += R.truth * rate;
        p.found++;
      }
    }
    this.lines.forEach((l, i) => {
      if (l.truth || l.house) return;
      for (const a of l.authors) {
        const g = gains.get(a);
        const fooled = voters[i].filter((v) => v !== a).length;
        g.fooled += fooled;
        g.gain += R.fool * rate * fooled;
        g.stars += stars[i].length;
        g.gain += R.star * stars[i].length;
      }
    });
    for (const p of this.players) {
      const g = gains.get(p.id);
      p.gain = g.gain;
      p.score += g.gain;
      p.fooled += g.fooled;
      p.stars += g.stars;
    }
    // Unmask the knock-offs that sold, the least first, then the genuine article.
    const sold = this.lines.map((_, i) => i).filter((i) => i !== this.truthLine && voters[i].length)
      .sort((a, b) => voters[a].length - voters[b].length || a - b);
    const order = [...sold, this.truthLine];
    const dur = R.revealOpen + R.revealLine * sold.length + R.revealTruth;
    const f = this.fact;
    this.last = {
      n: this.round, rate, truth: this.truthLine, order, dur,
      lines: this.lines.map((l, i) => ({ text: l.text, truth: l.truth, house: l.house, authors: l.authors.slice(), voters: voters[i], stars: stars[i] })),
      gains: [...gains.values()],
      fact: { id: f.id, text: f.text, truth: f.truth, src: f.src },
    };
    this._phase(F_PHASE.REVEAL, dur);
    this.emit('reveal', this.last);
  }

  standings() {
    return this.players.slice().sort((a, b) => b.score - a.score || b.found - a.found || b.fooled - a.fooled || a.id - b.id);
  }

  _podium() {
    const order = this.standings();
    this.ranking = order.map((p) => p.id);
    const most = (key) => {
      let best = null;
      for (const p of this.players) if (p[key] > 0 && (!best || p[key] > best.count)) best = { id: p.id, count: p[key] };
      return best;
    };
    this.awards = { mvp: order[0].id, seller: most('fooled'), shopper: most('found'), favourite: most('stars') };
    this.phase = F_PHASE.PODIUM;
    this.t = 0;
    this.total = 0;
    this.emit('podium', { ranking: this.ranking, ...this.awards });
  }

  // ---------- the room ----------
  serialize() {
    const open = this.phase === F_PHASE.REVEAL || this.phase === F_PHASE.PODIUM;
    return {
      o: this.options, ph: this.phase, t: this.t, tt: this.total, r: this.round, n: this.rounds.length,
      rates: this.rounds.map((r) => r.rate),
      cur: this.current, last: open ? this.last : null, rank: this.ranking, aw: this.awards,
      pl: this.players.map((p) => ({
        id: p.id, n: p.name, h: p.isHuman ? 1 : 0, b: p.bot, s: p.score, aw: p.away ? 1 : 0,
        w: p.wrote ? 1 : 0, v: p.voted ? 1 : 0, g: open ? p.gain : 0, fo: p.found, fl: p.fooled, sr: p.stars, bo: p.bounced,
      })),
    };
  }

  hydrate(s, localId = this.localId) {
    this.mirror = true;
    this.localId = localId;
    this.options = s.o || {};
    this.phase = s.ph;
    this.t = s.t;
    this.total = s.tt;
    this.round = s.r;
    this.current = s.cur;
    this.last = s.last;
    this.ranking = s.rank || [];
    this.awards = s.aw || null;
    this.rounds = Array.from({ length: s.n || 0 }, (_, i) => ({ n: i + 1, rate: (s.rates || [])[i] || 1, fact: null }));
    this.lines = null;
    this.truthLine = s.last ? s.last.truth : -1;
    this.players = s.pl.map((p) => ({
      id: p.id, name: p.n, isHuman: !!p.h, bot: p.b, score: p.s, away: !!p.aw, gain: p.g, found: p.fo, fooled: p.fl, stars: p.sr, bounced: p.bo,
      wrote: !!p.w, fake: null, at: 0, voted: !!p.v, vote: null, star: null, plan: null,
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
