// BIDLOCK — auction engine. Pure rules, no DOM, no audio, no rendering.
// Drive it with update(dt) and listen with on(event, fn). Deterministic for a given seed.

import { CATEGORIES, MYSTERY_CATEGORY, CRATE_CLUES, SYNERGY_RULE, makeDud } from '../data/categories.js';
import { PERSONAS, AIBidder, MOOD } from './aiBidders.js';

export const PHASE = Object.freeze({
  IDLE: 'IDLE',
  CATEGORY_INTRO: 'CATEGORY_INTRO',
  LOT_INTRO: 'LOT_INTRO',
  BIDDING: 'BIDDING',
  SOLD: 'SOLD',
  REVEAL: 'REVEAL',
  VAULT: 'VAULT',
  HEIST: 'HEIST',
  HEIST_DONE: 'HEIST_DONE',
  VERDICT: 'VERDICT',
});

export const RULES = Object.freeze({
  contenders: 4,
  categoriesPerMatch: 6,
  lotsPerCategory: 4,
  mysteryLots: 2,
  shotClock: 5.0,
  vaultCost: 2,
  vaultTime: 10,
  heistTime: 10,
  heistPremium: 1, // a steal costs what the owner paid, plus this
  categoryIntroTime: 3.4,
  lotIntroTime: 2.0,
  mysteryIntroTime: 3.0,
  soldTime: 2.4,
  uncontestedTime: 1.7,
  revealTime: 5.0,
  revealAt: 2.3, // seconds left in REVEAL when the crate bursts
});

export const HUMAN_ID = 0;

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
    this.history = [];
    this.options = { budget: 20, allIn: false, seed: 1 };
    this.results = null;
    this.rng = mulberry32(1);
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
    if (any) for (const fn of [...any]) fn({ type, ...data });
  }

  // ---------- setup ----------
  startMatch({ budget = 20, allIn = false, seed = (Date.now() & 0x7fffffff), humanName = 'YOU' } = {}) {
    this.options = { budget, allIn, seed };
    this.rng = mulberry32(seed);
    const rng = this.rng;
    this.results = null;
    this.sched = [];
    this.dudCount = Math.floor(rng() * 8);

    this.contenders = [
      this._makeContender(HUMAN_ID, humanName, true, budget, allIn, null),
      ...PERSONAS.map((p, i) => this._makeContender(i + 1, p.name, false, budget, p.allIn, p)),
    ];

    this.categories = shuffle(CATEGORIES, rng).slice(0, RULES.categoriesPerMatch);

    // Four lots per category: always one headline lot and one stinker. The stinker always
    // comes last, so a round is musical chairs: three real lots, four contenders, and
    // whoever never commits is left holding the booby prize for $1.
    const catLots = this.categories.map((cat) => {
      const top = cat.items.filter((it) => it.tier === 'S');
      const low = cat.items.filter((it) => it.tier === 'C' || it.tier === 'CURSED');
      const chosen = [pick(top, rng), pick(low, rng)];
      const rest = shuffle(cat.items.filter((it) => !chosen.includes(it)), rng);
      chosen.push(rest[0], rest[1]);
      const worst = chosen.reduce((a, b) => (b.trueValue < a.trueValue ? b : a));
      return [...shuffle(chosen.filter((it) => it !== worst), rng), worst];
    });

    // Two sealed crates dropped between rounds (never before round 2, never after the last).
    const gaps = shuffle([1, 2, 3, 4], rng).slice(0, RULES.mysteryLots).sort();
    const crates = shuffle(MYSTERY_CATEGORY.items, rng).slice(0, RULES.mysteryLots);
    const clues = shuffle(CRATE_CLUES, rng);

    this.queue = [];
    let crateN = 0;
    this.categories.forEach((cat, ci) => {
      catLots[ci].forEach((item, li) => {
        this.queue.push({ kind: 'cat', item, cat, catIndex: ci, lotIndex: li, lotsInCat: RULES.lotsPerCategory, result: null });
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
    this.emit('matchStart', { contenders: this.contenders, categories: this.categories, options: this.options });
    this._advance();
  }

  _makeContender(id, name, isHuman, budget, allIn, persona) {
    return {
      id, name, isHuman, persona,
      cash: budget, startCash: budget, spent: 0,
      allIn: !!allIn,
      roster: {}, bonus: [],
      mood: MOOD.CALM,
      heistUsed: false,
    };
  }

  // Stop the match where it stands (quit to title).
  abort() {
    this.sched = [];
    this.phase = PHASE.IDLE;
    this.emit('phase', { phase: PHASE.IDLE });
  }

  // ---------- queries ----------
  get lot() { return this.queue[this.qi] || null; }
  get human() { return this.contenders[HUMAN_ID]; }
  contender(id) { return this.contenders[id]; }

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

  humanState() {
    const c = this.human;
    const lot = this.lot;
    const bidding = this.phase === PHASE.BIDDING;
    const inLot = !!lot && this.active.has(c.id);
    const passed = this.passed.has(c.id);
    const isHigh = this.highBidder === c.id;
    const maxBid = lot ? this.maxBidFor(c, lot) : 0;
    const next1 = this.currentBid + 1;
    const next2 = this.currentBid + 2;
    const live = bidding && inLot && !passed && !isHigh;
    let reason = '';
    if (lot && !inLot) {
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
      this.emit('categoryIntro', { cat: lot.cat, catIndex: lot.catIndex, lots: this.lotsOfCategory(lot.catIndex) });
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
    this._setPhase(PHASE.LOT_INTRO, lot.kind === 'mystery' ? RULES.mysteryIntroTime : RULES.lotIntroTime);
    this.emit('lotIntro', { lot, eligible: [...this.active] });
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
    const others = [...this.active].filter((id) => id !== c.id && !this.passed.has(id));
    return {
      engine: this,
      lot,
      item: lot.item,
      isMystery: lot.kind === 'mystery',
      currentBid: this.currentBid,
      highBidder: this.highBidder,
      clock: this.clock,
      me: c,
      maxBid: this.maxBidFor(c, lot),
      emptySlots: this.emptySlots(c),
      catIndex: lot.catIndex,
      totalCats: this.categories.length,
      later: this.laterLotsInCategory(lot).map((l) => l.item),
      humanActive: this.active.has(HUMAN_ID) && !this.passed.has(HUMAN_ID),
      rivalsActive: others.length,
      contenders: this.contenders,
    };
  }

  update(dt) {
    if (this.phase === PHASE.IDLE || this.phase === PHASE.VERDICT) return;
    this.phaseClock += dt;
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
    if (this.phase !== PHASE.BIDDING) return false;
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
    if (this.phase !== PHASE.BIDDING) return false;
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
      if (id === this.highBidder || this.passed.has(id)) return false;
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
      vaulted: false, hot: false, stolenFrom: null, revealed: lot.kind !== 'mystery',
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
    for (const ai of this.ais) ai.onCrateReveal({ winner: winner.id, jackpot, cursed, item: lot.item, price: lot.result.price });
  }

  _finishLot() {
    const lot = this.lot;
    if (lot.kind === 'cat' && lot.lotIndex === lot.lotsInCat - 1) {
      for (const c of this.contenders) {
        if (!c.roster[lot.cat.id]) {
          const item = makeDud(this.dudCount++, lot.cat.id);
          c.roster[lot.cat.id] = { item, price: 0, catId: lot.cat.id, mystery: false, vaulted: false, hot: false, stolenFrom: null, revealed: true, dud: true };
          this.emit('dud', { who: c.id, item, cat: lot.cat });
          const ai = this.ais.find((a) => a.me.id === c.id);
          if (ai) ai.onDud(item);
        }
      }
    }
    this._advance();
  }

  // ---------- human input ----------
  humanBid(inc) { return this._placeBid(this.human, inc === 2 ? 2 : 1); }
  humanPass() { return this._pass(this.human); }

  // Fast-forward through the bits where nothing is being decided.
  skip() {
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
      case PHASE.VAULT:
      case PHASE.HEIST:
        this.phaseT = 0; return true;
      default:
        return false;
    }
  }

  // ---------- vault + heist ----------
  allEntries(c) {
    return [...this.categories.map((cat) => c.roster[cat.id]).filter(Boolean), ...c.bonus];
  }

  _openVault() {
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
    const entry = this.allEntries(c).find((e) => e.item.id === itemId);
    if (!this.canVault(c, entry)) return false;
    c.cash -= RULES.vaultCost;
    c.spent += RULES.vaultCost;
    entry.vaulted = true;
    this.emit('vaultLock', { who: c.id, entry });
    return true;
  }

  humanVault(itemId) { return this._vault(this.human, itemId); }

  _openHeist() {
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
    if (this.phase !== PHASE.HEIST || thief.heistUsed) return out;
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

  _heist(thief, victimId, itemId) {
    const opt = this.heistOptions(thief).find((o) => o.victim.id === victimId && o.entry.item.id === itemId);
    if (!opt) return false;
    const { victim, entry, cost, mine } = opt;
    thief.cash -= cost;
    thief.spent += cost;
    thief.heistUsed = true;
    entry.hot = true;
    entry.stolenFrom = victim.id;
    if (entry.mystery) {
      victim.bonus = victim.bonus.filter((e) => e !== entry);
      thief.bonus.push(entry);
    } else {
      // A category steal is a forced swap: the victim is left holding whatever the thief had.
      thief.roster[entry.catId] = entry;
      if (mine) { mine.hot = true; victim.roster[entry.catId] = mine; }
      else delete victim.roster[entry.catId];
    }
    this.emit('heist', { thief: thief.id, victim: victim.id, taken: entry, given: mine, cost });
    for (const ai of this.ais) ai.onHeist({ thief: thief.id, victim: victim.id, taken: entry, given: mine, cost });
    return true;
  }

  humanHeist(victimId, itemId) { return this._heist(this.human, victimId, itemId); }

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
}
