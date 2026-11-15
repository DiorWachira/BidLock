// BIDLOCK 2.0 — auction engine. Pure rules, no DOM, no audio, no rendering.
// Drive it with update(dt) and listen with on(event, fn). Deterministic for a given seed.
//
// One engine runs the match. In a multiplayer room that is the host's engine; every
// other player holds a mirror, rebuilt from the host's snapshots with hydrate(), which
// answers the same questions (max bid, who can steal what) but never advances the game.

import { CATEGORIES, MYSTERY_CATEGORY, CRATE_CLUES, SYNERGY_RULE, makeDud, itemById, categoryById } from '../data/categories.js';
import { PERSONAS, AIBidder, MOOD } from './aiBidders.js';
import { OracleSteal, TriviaBank } from './triviaSteal.js';

export const PHASE = Object.freeze({
  IDLE: 'IDLE',
  CATEGORY_INTRO: 'CATEGORY_INTRO',
  LOT_INTRO: 'LOT_INTRO',
  BIDDING: 'BIDDING',
  SOLD: 'SOLD',
  REVEAL: 'REVEAL',
  ORACLE: 'ORACLE',
  VAULT: 'VAULT',
  HEIST: 'HEIST',
  HEIST_DONE: 'HEIST_DONE',
  VERDICT: 'VERDICT',
});

export const RULES = Object.freeze({
  minContenders: 2,
  maxContenders: 6,
  categoriesPerMatch: 6,
  marathonCategories: 8,
  mysteryLots: 2,
  shotClock: 5.0,
  vaultCost: 2,
  vaultTime: 10,
  heistTime: 10,
  heistPremium: 1, // a heist costs what the owner paid, plus this
  categoryIntroTime: 3.4,
  lotIntroTime: 2.0,
  mysteryIntroTime: 3.0,
  soldTime: 2.4,
  uncontestedTime: 1.7,
  revealTime: 5.0,
  revealAt: 2.3, // seconds left in REVEAL when the crate bursts
});

export const HUMAN_ID = 0; // the solo player's seat, and the host's seat in a room

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// Solo default: you against the three house rivals.
export function soloSeats(name = 'YOU') {
  return [{ name, kind: 'human' }, ...PERSONAS.map((p) => ({ name: p.name, kind: 'ai', persona: p.key }))];
}

export class AuctionEngine {
  constructor() {
    this.listeners = new Map();
    this.phase = PHASE.IDLE;
    this.contenders = [];
    this.categories = [];
    this.queue = [];
    this.qi = -1;
    this.ais = [];
    this.sched = [];
    this.phaseT = 0;
    this.phaseClock = 0;
    this.currentBid = 0;
    this.highBidder = null;
    this.clock = 0;
    this.callStage = 0;
    this.active = new Set();
    this.passed = new Set();
    this.done = new Set();
    this.history = [];
    this.options = { budget: 20, allIn: false, seed: 1, marathon: false };
    this.results = null;
    this.rng = mulberry32(1);
    this.localId = HUMAN_ID;
    this.mirror = false;
    this.revealed = false;
    this.trivia = new TriviaBank(this.rng);
    this.oracle = new OracleSteal(this);
  }

  // ---------- events ----------
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

  // ---------- setup ----------
  // seats: [{ name, kind: 'human' | 'ai', persona?: key }], two to six of them.
  startMatch({ budget = 20, allIn = false, marathon = false, seed = (Date.now() & 0x7fffffff), seats = null, localId = HUMAN_ID, oracleChance = null, oracleSeat = null, trivia = null } = {}) {
    const list = (seats && seats.length ? seats : soloSeats()).slice(0, RULES.maxContenders);
    if (list.length < RULES.minContenders) throw new Error('A match needs at least two contenders.');
    this.options = { budget, allIn, marathon, seed, oracleChance, oracleSeat };
    this.rng = mulberry32(seed);
    const rng = this.rng;
    this.mirror = false;
    this.localId = localId;
    this.results = null;
    this.sched = [];
    this.done = new Set();
    this.dudCount = Math.floor(rng() * 8);
    this.trivia = trivia || new TriviaBank(rng);
    this.oracle.reset();

    this.contenders = list.map((s, id) => {
      const persona = s.kind === 'ai' ? PERSONAS.find((p) => p.key === s.persona) || PERSONAS[id % PERSONAS.length] : null;
      return this._makeContender(id, s.name || (persona ? persona.name : `PLAYER ${id + 1}`), !persona, budget, persona ? persona.allIn : allIn, persona);
    });
    const n = this.contenders.length;

    const catCount = marathon ? RULES.marathonCategories : RULES.categoriesPerMatch;
    this.categories = shuffle(CATEGORIES, rng).slice(0, catCount);

    // One lot per contender in every round: always a headline lot, and (with three or
    // more at the table) a stinker. The weakest lot always comes last, so a round is
    // musical chairs: whoever never commits is left holding the booby prize for $1.
    const catLots = this.categories.map((cat) => {
      const top = cat.items.filter((it) => it.tier === 'S');
      const low = cat.items.filter((it) => it.tier === 'C' || it.tier === 'CURSED');
      const chosen = [pick(top, rng)];
      if (n >= 3) chosen.push(pick(low, rng));
      const rest = shuffle(cat.items.filter((it) => !chosen.includes(it)), rng);
      while (chosen.length < n) chosen.push(rest.shift());
      const worst = chosen.reduce((a, b) => (b.trueValue < a.trueValue ? b : a));
      return [...shuffle(chosen.filter((it) => it !== worst), rng), worst];
    });

    // Two sealed crates dropped between rounds (never before round 2, never after the last).
    const gapPool = [];
    for (let i = 1; i <= catCount - 2; i++) gapPool.push(i);
    const gaps = shuffle(gapPool, rng).slice(0, RULES.mysteryLots).sort((a, b) => a - b);
    const crates = shuffle(MYSTERY_CATEGORY.items, rng).slice(0, RULES.mysteryLots);
    const clues = shuffle(CRATE_CLUES, rng);

    this.queue = [];
    let crateN = 0;
    this.categories.forEach((cat, ci) => {
      catLots[ci].forEach((item, li) => {
        this.queue.push({ kind: 'cat', item, cat, catIndex: ci, lotIndex: li, lotsInCat: n, result: null });
      });
      if (gaps.includes(ci)) {
        this.queue.push({
          kind: 'mystery', item: crates[crateN], cat: MYSTERY_CATEGORY, catIndex: ci, lotIndex: crateN,
          lotsInCat: RULES.mysteryLots, clue: clues[crateN], result: null,
        });
        crateN++;
      }
    });
    this.queue.forEach((l, i) => { l.n = i + 1; });

    this.ais = this.contenders.filter((c) => !c.isHuman).map((c) => new AIBidder(c.persona, c, rng, {
      say: (id, text, kind) => this.say(id, text, kind),
      mood: (id, mood) => this.setMood(id, mood),
    }));

    this.qi = -1;
    this.phase = PHASE.CATEGORY_INTRO;
    this.emit('matchStart', { contenders: this.contenders, categories: this.categories, options: this.options });
    this._advance();
  }

  _makeContender(id, name, isHuman, budget, allIn, persona) {
    return {
      id, name, isHuman, persona,
      cash: budget, startCash: budget, spent: 0, refund: 0,
      allIn: !!allIn,
      roster: {}, bonus: [],
      mood: MOOD.CALM,
      heistUsed: false,
      away: false,
    };
  }

  // Stop the match where it stands (quit to title).
  abort() {
    this.sched = [];
    this.oracle.reset();
    this.phase = PHASE.IDLE;
    this.emit('phase', { phase: PHASE.IDLE });
  }

  // ---------- queries ----------
  get lot() { return this.queue[this.qi] || null; }
  get me() { return this.contenders[this.localId] || null; }
  get human() { return this.me; }
  contender(id) { return this.contenders[id]; }
  aiFor(id) { return this.ais.find((a) => a.me.id === id) || null; }
  get humans() { return this.contenders.filter((c) => c.isHuman && !c.away); }

  emptySlots(c) {
    let n = 0;
    for (const cat of this.categories) if (!c.roster[cat.id]) n++;
    return n;
  }

  // Budget lockout: keep $1 back for every other roster slot still to fill, unless playing All-In.
  maxBidFor(c, lot = this.lot) {
    if (!lot) return 0;
    if (c.allIn) return c.cash;
    const empty = this.emptySlots(c);
    const fillsSlot = lot.kind === 'cat' && !c.roster[lot.cat.id];
    return Math.max(0, c.cash - (fillsSlot ? empty - 1 : empty));
  }

  isEligible(c, lot = this.lot) {
    if (!lot) return false;
    if (lot.kind === 'cat' && c.roster[lot.cat.id]) return false;
    return this.maxBidFor(c, lot) >= 1;
  }

  lotsOfCategory(catIndex) {
    return this.queue.filter((l) => l.kind === 'cat' && l.catIndex === catIndex);
  }

  laterLotsInCategory(lot = this.lot) {
    if (!lot || lot.kind !== 'cat') return [];
    return this.queue.filter((l) => l.kind === 'cat' && l.catIndex === lot.catIndex && l.lotIndex > lot.lotIndex);
  }

  // Everything the local player's bid buttons need to know.
  humanState() {
    const c = this.me;
    const lot = this.lot;
    const bidding = this.phase === PHASE.BIDDING;
    const inLot = !!lot && !!c && this.active.has(c.id);
    const passed = !!c && this.passed.has(c.id);
    const isHigh = !!c && this.highBidder === c.id;
    const maxBid = lot && c ? this.maxBidFor(c, lot) : 0;
    const next1 = this.currentBid + 1;
    const next2 = this.currentBid + 2;
    const live = bidding && inLot && !passed && !isHigh;
    let reason = '';
    if (lot && c && !inLot) {
      reason = lot.kind === 'cat' && c.roster[lot.cat.id] ? 'You already drafted this category. Sitting this lot out.' : 'No cash free for this lot.';
    } else if (passed) reason = 'You dropped out of this lot.';
    else if (isHigh) reason = 'You hold the high bid.';
    else if (bidding && next1 > maxBid) reason = `Locked out: your max bid on this lot is $${maxBid}.`;
    return {
      inLot, passed, isHigh, maxBid, next1, next2, reason,
      canBid1: live && next1 <= maxBid,
      canBid2: live && next2 <= maxBid,
      canPass: bidding && inLot && !passed && !isHigh,
      spectating: !inLot || passed,
    };
  }

  // ---------- talk ----------
  say(id, text, kind = 'banter') {
    const c = this.contenders[id];
    if (!c || !text) return;
    this.emit('banter', { who: id, name: c.name, text, mood: c.mood, kind });
  }

  setMood(id, mood) {
    const c = this.contenders[id];
    if (!c || c.mood === mood) return;
    c.mood = mood;
    this.emit('mood', { who: id, mood });
  }

  // A player closed the tab or lost their connection. Their seat stays, and stops acting.
  setAway(id, away = true) {
    const c = this.contenders[id];
    if (!c || !c.isHuman || c.away === away) return;
    c.away = away;
    this.emit('away', { who: id, away });
    if (this.phase === PHASE.BIDDING) this._checkEarlyClose();
    if (this.phase === PHASE.VAULT || this.phase === PHASE.HEIST) this._checkAllDone();
  }

  // ---------- flow ----------
  _setPhase(phase, seconds = 0) {
    this.phase = phase;
    this.phaseT = seconds;
    this.phaseClock = 0;
    this.sched = [];
    this.emit('phase', { phase });
  }

  _after(seconds, fn) {
    this.sched.push({ at: this.phaseClock + seconds, fn });
  }

  _runSched(all = false) {
    if (!this.sched.length) return;
    const phase = this.phase;
    const due = this.sched.filter((s) => all || s.at <= this.phaseClock).sort((a, b) => a.at - b.at);
    if (!due.length) return;
    this.sched = this.sched.filter((s) => !due.includes(s));
    for (const s of due) {
      if (this.phase !== phase) break;
      s.fn();
    }
  }

  _advance() {
    this.qi++;
    if (this.qi >= this.queue.length) { this._openVault(); return; }
    const lot = this.lot;
    if (lot.kind === 'cat' && lot.lotIndex === 0) {
      this._setPhase(PHASE.CATEGORY_INTRO, RULES.categoryIntroTime);
      this.emit('categoryIntro', { cat: lot.cat, catIndex: lot.catIndex });
    } else {
      this._introLot();
    }
  }

  _introLot() {
    const lot = this.lot;
    this.active = new Set(this.contenders.filter((c) => this.isEligible(c, lot)).map((c) => c.id));
    this.passed = new Set();
    this.currentBid = 0;
    this.highBidder = null;
    this.clock = RULES.shotClock;
    this.callStage = 0;
    this.history = [];
    this.revealed = false;
    this._setPhase(PHASE.LOT_INTRO, lot.kind === 'mystery' ? RULES.mysteryIntroTime : RULES.lotIntroTime);
    this.emit('lotIntro', { lot });
  }

  _openBidding() {
    const lot = this.lot;
    if (this.active.size === 0) { this._noSale('nobody'); return; }
    if (this.active.size === 1 && lot.kind === 'cat') {
      const only = this.contenders[[...this.active][0]];
      this.currentBid = 1;
      this.highBidder = only.id;
      this._sell(only, 1, true);
      return;
    }
    this._setPhase(PHASE.BIDDING);
    this.clock = RULES.shotClock;
    for (const ai of this.ais) {
      if (this.active.has(ai.me.id)) ai.onLotStart(this._ctx(ai.me));
    }
    this.emit('biddingOpen', { lot });
  }

  _ctx(c) {
    const lot = this.lot;
    const live = (id) => this.active.has(id) && !this.passed.has(id);
    return {
      engine: this,
      lot,
      item: lot.item,
      isMystery: lot.kind === 'mystery',
      currentBid: this.currentBid,
      highBidder: this.highBidder,
      highIsHuman: this.highBidder != null && this.contenders[this.highBidder].isHuman,
      clock: this.clock,
      me: c,
      maxBid: this.maxBidFor(c, lot),
      emptySlots: this.emptySlots(c),
      catIndex: lot.catIndex,
      totalCats: this.categories.length,
      later: this.laterLotsInCategory(lot).map((l) => l.item),
      // Is there a person still in this lot worth winding up?
      humanActive: this.contenders.some((x) => x.isHuman && !x.away && live(x.id)),
      rivalsActive: [...this.active].filter((id) => id !== c.id && !this.passed.has(id)).length,
      contenders: this.contenders,
    };
  }

  update(dt) {
    if (this.phase === PHASE.IDLE || this.phase === PHASE.VERDICT) return;
    this.phaseClock += dt;
    if (this.mirror) {
      // A mirror only keeps its clocks moving between the host's ticks.
      if (this.phase === PHASE.BIDDING) this.clock = Math.max(0, this.clock - dt);
      else this.phaseT = Math.max(0, this.phaseT - dt);
      if (this.phase === PHASE.ORACLE) this.oracle.t = Math.max(0, this.oracle.t - dt);
      return;
    }
    this._runSched();

    switch (this.phase) {
      case PHASE.CATEGORY_INTRO:
        this.phaseT -= dt;
        if (this.phaseT <= 0) this._introLot();
        break;
      case PHASE.LOT_INTRO:
        this.phaseT -= dt;
        if (this.phaseT <= 0) this._openBidding();
        break;
      case PHASE.BIDDING:
        this._updateBidding(dt);
        break;
      case PHASE.SOLD:
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          const lot = this.lot;
          if (lot.kind === 'mystery' && lot.result && lot.result.winner != null) {
            this._setPhase(PHASE.REVEAL, RULES.revealTime);
            this.revealed = false;
            this.emit('mysteryOpen', { lot, winner: lot.result.winner });
          } else {
            this._finishLot();
          }
        }
        break;
      case PHASE.REVEAL:
        this.phaseT -= dt;
        if (!this.revealed && this.phaseT <= RULES.revealAt) this._revealCrate();
        if (this.phaseT <= 0) this._finishLot();
        break;
      case PHASE.ORACLE:
        this.oracle.update(dt);
        break;
      case PHASE.VAULT:
        this.phaseT -= dt;
        if (this.phaseT <= 0) { this._runSched(true); this._openHeist(); }
        break;
      case PHASE.HEIST:
        this.phaseT -= dt;
        if (this.phaseT <= 0) { this._runSched(true); this._closeHeist(); }
        break;
      case PHASE.HEIST_DONE:
        this.phaseT -= dt;
        if (this.phaseT <= 0) this._verdict();
        break;
      default:
        break;
    }
  }

  _updateBidding(dt) {
    this.clock -= dt;
    const stage = this.clock <= 1 ? 3 : this.clock <= 2 ? 2 : this.clock <= 3 ? 1 : 0;
    if (stage !== this.callStage) {
      this.callStage = stage;
      if (stage > 0) this.emit('call', { stage, hasBid: this.highBidder != null });
    }
    for (const ai of this.ais) {
      const c = ai.me;
      if (!this.active.has(c.id) || this.passed.has(c.id) || this.highBidder === c.id) continue;
      const act = ai.update(dt, this._ctx(c));
      if (!act) continue;
      if (act.type === 'bid') this._placeBid(c, act.inc === 2 ? 2 : 1);
      else if (act.type === 'pass') this._pass(c);
      if (this.phase !== PHASE.BIDDING) return;
    }
    if (this.clock <= 0) {
      if (this.highBidder != null) this._sell(this.contenders[this.highBidder], this.currentBid, false);
      else this._noSale('timeout');
    }
  }

  _placeBid(c, inc) {
    if (!c || this.mirror || this.phase !== PHASE.BIDDING) return false;
    if (!this.active.has(c.id) || this.passed.has(c.id) || this.highBidder === c.id) return false;
    const amount = this.currentBid + inc;
    if (amount > this.maxBidFor(c, this.lot)) return false;
    const prev = this.highBidder;
    this.currentBid = amount;
    this.highBidder = c.id;
    this.clock = RULES.shotClock;
    this.callStage = 0;
    this.history.push({ by: c.id, amount, inc });
    const ev = { by: c.id, amount, inc, prev, lot: this.lot };
    this.emit('bid', ev);
    for (const ai of this.ais) {
      if (this.active.has(ai.me.id) && !this.passed.has(ai.me.id)) ai.notifyBid(this._ctx(ai.me), ev);
    }
    this._checkEarlyClose();
    return true;
  }

  _pass(c) {
    if (!c || this.mirror || this.phase !== PHASE.BIDDING) return false;
    if (!this.active.has(c.id) || this.passed.has(c.id) || this.highBidder === c.id) return false;
    this.passed.add(c.id);
    this.emit('pass', { by: c.id, lot: this.lot });
    this._checkEarlyClose();
    return true;
  }

  // If nobody is left who could raise, do not make the room sit through the whole clock.
  _checkEarlyClose() {
    const lot = this.lot;
    const challengers = [...this.active].filter((id) => {
      if (id === this.highBidder || this.passed.has(id) || this.contenders[id].away) return false;
      return this.maxBidFor(this.contenders[id], lot) >= this.currentBid + 1;
    });
    if (challengers.length === 0) {
      this.clock = Math.min(this.clock, this.highBidder != null ? 1.0 : 0.6);
    }
  }

  _sell(c, price, uncontested) {
    const lot = this.lot;
    c.cash -= price;
    c.spent += price;
    const entry = {
      item: lot.item, price, catId: lot.cat.id, mystery: lot.kind === 'mystery',
      vaulted: false, hot: false, stolenFrom: null, revealed: lot.kind !== 'mystery', dud: false,
    };
    if (lot.kind === 'cat') c.roster[lot.cat.id] = entry;
    else c.bonus.push(entry);
    lot.result = { winner: c.id, price, uncontested };
    const ctxs = this.ais.map((ai) => [ai, this._ctx(ai.me)]);
    this._setPhase(PHASE.SOLD, uncontested ? RULES.uncontestedTime : RULES.soldTime);
    this.emit('sold', { lot, winner: c.id, price, uncontested });
    for (const [ai, ctx] of ctxs) ai.onLotEnd(ctx, lot.result);
  }

  _noSale(why) {
    const lot = this.lot;
    lot.result = { winner: null, price: 0, uncontested: false, why };
    const ctxs = this.ais.map((ai) => [ai, this._ctx(ai.me)]);
    this._setPhase(PHASE.SOLD, RULES.uncontestedTime);
    this.emit('nosale', { lot, why });
    for (const [ai, ctx] of ctxs) ai.onLotEnd(ctx, lot.result);
  }

  _revealCrate() {
    this.revealed = true;
    const lot = this.lot;
    const winner = this.contenders[lot.result.winner];
    const entry = winner.bonus.find((e) => e.item === lot.item);
    if (entry) entry.revealed = true;
    const jackpot = lot.item.tier === 'S' || lot.item.tier === 'A';
    const cursed = lot.item.tier === 'CURSED' || lot.item.tier === 'C';
    this.emit('mysteryReveal', { lot, item: lot.item, winner: winner.id, jackpot, cursed, price: lot.result.price });
    for (const ai of this.ais) ai.onCrateReveal({ winner: winner.id, winnerIsHuman: winner.isHuman, jackpot, cursed });
  }

  _finishLot() {
    const lot = this.lot;
    const lastOfRound = lot.kind === 'cat' && lot.lotIndex === lot.lotsInCat - 1;
    if (lastOfRound) {
      for (const c of this.contenders) {
        if (!c.roster[lot.cat.id]) {
          const item = makeDud(this.dudCount++, lot.cat.id);
          c.roster[lot.cat.id] = { item, price: 0, catId: lot.cat.id, mystery: false, vaulted: false, hot: false, stolenFrom: null, revealed: true, dud: true };
          this.emit('dud', { who: c.id, item, cat: lot.cat });
          const ai = this.aiFor(c.id);
          if (ai) ai.onDud(item);
        }
      }
      // Between rounds the Oracle may step in. It calls _advance() itself when it is done.
      if (this.oracle.maybeTrigger(lot.catIndex)) return;
    }
    this._advance();
  }

  // ---------- input (any seat) ----------
  bidFor(id, inc) { return this._placeBid(this.contenders[id], inc === 2 ? 2 : 1); }
  passFor(id) { return this._pass(this.contenders[id]); }
  vaultFor(id, itemId) { return this.contenders[id] ? this._vault(this.contenders[id], itemId) : false; }
  heistFor(id, victimId, itemId) { return this.contenders[id] ? this._heist(this.contenders[id], victimId, itemId) : false; }

  // A player says they have finished with the vault or the heist. When every person at
  // the table has, the phase ends early.
  doneFor(id) {
    if (this.mirror) return false;
    if (this.phase !== PHASE.VAULT && this.phase !== PHASE.HEIST) return false;
    this.done.add(id);
    this._checkAllDone();
    return true;
  }

  _checkAllDone() {
    if (this.humans.every((c) => this.done.has(c.id))) {
      this._runSched(true);
      this.phaseT = 0;
    }
  }

  // ---------- input (the local seat) ----------
  humanBid(inc) { return this.bidFor(this.localId, inc); }
  humanPass() { return this.passFor(this.localId); }
  humanVault(itemId) { return this.vaultFor(this.localId, itemId); }
  humanHeist(victimId, itemId) { return this.heistFor(this.localId, victimId, itemId); }

  // Fast-forward through the bits where nothing is being decided. With more than one
  // person at the table only the vault and heist can be hurried, and only by agreement.
  skip() {
    if (this.mirror) return false;
    if (this.phase === PHASE.VAULT || this.phase === PHASE.HEIST) return this.doneFor(this.localId);
    if (this.humans.length > 1) return false;
    switch (this.phase) {
      case PHASE.CATEGORY_INTRO:
      case PHASE.LOT_INTRO:
      case PHASE.HEIST_DONE:
        this.phaseT = 0; return true;
      case PHASE.SOLD:
        this.phaseT = Math.min(this.phaseT, 0.2); return true;
      case PHASE.REVEAL:
        if (this.revealed) { this.phaseT = Math.min(this.phaseT, 0.2); return true; }
        return false;
      default:
        return false;
    }
  }

  // ---------- vault + heist ----------
  allEntries(c) {
    return [...this.categories.map((cat) => c.roster[cat.id]).filter(Boolean), ...c.bonus];
  }

  _openVault() {
    this.done = new Set();
    this._setPhase(PHASE.VAULT, RULES.vaultTime);
    this.emit('vaultOpen', { seconds: RULES.vaultTime });
    for (const ai of this.ais) {
      const picks = ai.chooseVault({ engine: this, me: ai.me, contenders: this.contenders });
      picks.forEach((entry, i) => {
        this._after(1.2 + this.rng() * 5 + i * 1.1, () => this._vault(ai.me, entry.item.id));
      });
    }
  }

  canVault(c, entry) {
    return this.phase === PHASE.VAULT && !!entry && !entry.vaulted && !entry.dud && c.cash >= RULES.vaultCost;
  }

  _vault(c, itemId) {
    if (this.mirror) return false;
    const entry = this.allEntries(c).find((e) => e.item.id === itemId);
    if (!this.canVault(c, entry)) return false;
    c.cash -= RULES.vaultCost;
    c.spent += RULES.vaultCost;
    entry.vaulted = true;
    this.emit('vaultLock', { who: c.id, entry });
    return true;
  }

  _openHeist() {
    this.done = new Set();
    this._setPhase(PHASE.HEIST, RULES.heistTime);
    this.emit('heistOpen', { seconds: RULES.heistTime });
    for (const ai of this.ais) {
      this._after(1.5 + this.rng() * 6.5, () => {
        const choice = ai.chooseHeist({ engine: this, me: ai.me, contenders: this.contenders, options: this.heistOptions(ai.me) });
        if (choice) this._heist(ai.me, choice.victimId, choice.itemId);
      });
    }
  }

  heistCost(entry) { return entry.price + RULES.heistPremium; }

  // Every steal a contender could make right now.
  heistOptions(thief) {
    const out = [];
    if (!thief || this.phase !== PHASE.HEIST || thief.heistUsed) return out;
    for (const victim of this.contenders) {
      if (victim.id === thief.id) continue;
      for (const entry of this.allEntries(victim)) {
        if (entry.vaulted || entry.hot || entry.dud) continue;
        const cost = this.heistCost(entry);
        if (cost > thief.cash) continue;
        const mine = entry.mystery ? null : thief.roster[entry.catId] || null;
        if (mine && (mine.vaulted || mine.hot)) continue;
        out.push({ victim, entry, cost, mine });
      }
    }
    return out;
  }

  // Moves a lot between lineups. A category lot is a forced swap: the victim is left
  // holding whatever the thief had in that category. A crate simply changes hands.
  _moveEntry(thief, victim, entry) {
    entry.stolenFrom = victim.id;
    if (entry.mystery) {
      victim.bonus = victim.bonus.filter((e) => e !== entry);
      thief.bonus.push(entry);
      return null;
    }
    const mine = thief.roster[entry.catId] || null;
    thief.roster[entry.catId] = entry;
    if (mine) victim.roster[entry.catId] = mine;
    else delete victim.roster[entry.catId];
    return mine;
  }

  _heist(thief, victimId, itemId) {
    if (this.mirror) return false;
    const opt = this.heistOptions(thief).find((o) => o.victim.id === victimId && o.entry.item.id === itemId);
    if (!opt) return false;
    const { victim, entry, cost } = opt;
    thief.cash -= cost;
    thief.spent += cost;
    thief.heistUsed = true;
    entry.hot = true;
    const given = this._moveEntry(thief, victim, entry);
    if (given) given.hot = true;
    this.emit('heist', { thief: thief.id, victim: victim.id, taken: entry, given, cost });
    for (const ai of this.ais) ai.onHeist({ thief: thief.id, victim: victim.id });
    return true;
  }

  _closeHeist() {
    this._setPhase(PHASE.HEIST_DONE, 1.6);
    this.emit('heistClosed', {});
  }

  // ---------- verdict ----------
  _verdict() {
    this.results = this.computeVerdict();
    this._setPhase(PHASE.VERDICT);
    this.emit('verdict', this.results);
  }

  computeVerdict() {
    const rows = this.categories.map((cat) => ({
      cat,
      cells: this.contenders.map((c) => {
        const e = c.roster[cat.id];
        return e ? { id: c.id, entry: e, item: e.item, value: e.item.trueValue, price: e.price } : { id: c.id, entry: null, item: null, value: 0, price: 0 };
      }),
    }));
    const players = this.contenders.map((c) => {
      const entries = this.allEntries(c);
      const base = entries.reduce((s, e) => s + e.item.trueValue, 0);
      const counts = {};
      for (const e of entries) for (const t of e.item.synergyTags) counts[t] = (counts[t] || 0) + 1;
      const combos = Object.entries(counts)
        .filter(([, n]) => n >= SYNERGY_RULE.at)
        .map(([tag, n]) => ({ tag, count: n, bonus: n >= SYNERGY_RULE.megaAt ? SYNERGY_RULE.megaBonus : SYNERGY_RULE.bonus }))
        .sort((a, b) => b.bonus - a.bonus || a.tag.localeCompare(b.tag));
      const synergy = combos.reduce((s, x) => s + x.bonus, 0);
      const bonusValue = c.bonus.reduce((s, e) => s + e.item.trueValue, 0);
      return {
        id: c.id, name: c.name, isHuman: c.isHuman, cash: c.cash, spent: c.spent,
        base, bonus: c.bonus.slice(), bonusValue, tagCounts: counts, combos, synergy, total: base + synergy,
      };
    });
    // Leftover cash is the tiebreak.
    const ranking = players.slice().sort((a, b) => b.total - a.total || b.cash - a.cash || a.id - b.id).map((p) => p.id);
    ranking.forEach((id, i) => { players[id].rank = i + 1; });
    return { rows, players, ranking, winner: ranking[0], options: this.options };
  }

  tagCounts(c) {
    const counts = {};
    for (const e of this.allEntries(c)) {
      if (e.mystery && !e.revealed) continue;
      for (const t of e.item.synergyTags) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }

  // ---------- snapshots (multiplayer) ----------
  // Plain JSON describing the whole match. Lots travel as ids and are looked up again
  // in the receiver's own database.
  serialize() {
    const E = (e) => ({ i: e.item.id, p: e.price, c: e.catId, m: e.mystery ? 1 : 0, v: e.vaulted ? 1 : 0, h: e.hot ? 1 : 0, s: e.stolenFrom, r: e.revealed ? 1 : 0, d: e.dud ? 1 : 0 });
    return {
      v: 2,
      o: this.options,
      ph: this.phase, pt: this.phaseT, qi: this.qi,
      cb: this.currentBid, hb: this.highBidder, ck: this.clock, cs: this.callStage,
      ac: [...this.active], pa: [...this.passed], dn: [...this.done], rv: this.revealed ? 1 : 0,
      cats: this.categories.map((c) => c.id),
      q: this.queue.map((l) => ({ k: l.kind === 'cat' ? 0 : 1, i: l.item.id, c: l.cat.id, ci: l.catIndex, li: l.lotIndex, lc: l.lotsInCat, n: l.n, cl: l.clue || null, r: l.result })),
      cont: this.contenders.map((c) => ({
        id: c.id, n: c.name, h: c.isHuman ? 1 : 0, p: c.persona ? c.persona.key : null,
        cash: c.cash, st: c.startCash, sp: c.spent, rf: c.refund, ai: c.allIn ? 1 : 0, md: c.mood, hu: c.heistUsed ? 1 : 0, aw: c.away ? 1 : 0,
        ro: Object.fromEntries(Object.entries(c.roster).map(([k, e]) => [k, E(e)])),
        bo: c.bonus.map(E),
      })),
      or: this.oracle.serialize(),
    };
  }

  // Rebuild this engine as a mirror of a snapshot. `localId` is the seat this player holds.
  hydrate(s, localId = this.localId) {
    const E = (e) => ({ item: itemById(e.i), price: e.p, catId: e.c, mystery: !!e.m, vaulted: !!e.v, hot: !!e.h, stolenFrom: e.s, revealed: !!e.r, dud: !!e.d });
    this.mirror = true;
    this.localId = localId;
    this.ais = [];
    this.sched = [];
    this.options = s.o;
    this.phase = s.ph;
    this.phaseT = s.pt;
    this.qi = s.qi;
    this.currentBid = s.cb;
    this.highBidder = s.hb;
    this.clock = s.ck;
    this.callStage = s.cs;
    this.active = new Set(s.ac);
    this.passed = new Set(s.pa);
    this.done = new Set(s.dn);
    this.revealed = !!s.rv;
    this.categories = s.cats.map((id) => categoryById(id));
    this.queue = s.q.map((l) => ({ kind: l.k ? 'mystery' : 'cat', item: itemById(l.i), cat: categoryById(l.c), catIndex: l.ci, lotIndex: l.li, lotsInCat: l.lc, n: l.n, clue: l.cl, result: l.r }));
    this.contenders = s.cont.map((c) => ({
      id: c.id, name: c.n, isHuman: !!c.h, persona: c.p ? PERSONAS.find((p) => p.key === c.p) || null : null,
      cash: c.cash, startCash: c.st, spent: c.sp, refund: c.rf, allIn: !!c.ai, mood: c.md, heistUsed: !!c.hu, away: !!c.aw,
      roster: Object.fromEntries(Object.entries(c.ro).map(([k, e]) => [k, E(e)])),
      bonus: c.bo.map(E),
    }));
    this.oracle.hydrate(s.or);
    if (this.phase === PHASE.VERDICT) this.results = this.computeVerdict();
  }

  // Finds the lineup entry for a lot id, wherever it currently sits.
  findEntry(itemId) {
    for (const c of this.contenders) {
      const e = this.allEntries(c).find((x) => x.item.id === itemId);
      if (e) return e;
    }
    return null;
  }
}
