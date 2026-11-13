// BIDLOCK — the three house rivals.
// Each rival values a lot in dollars from its own noisy read of the sealed value, then
// plays that number with its own timing, tells and banter. Reaction delays sit in the
// 350-1400 ms band so they feel like people at a table, not scripts.

export const MOOD = Object.freeze({ CALM: 'CALM', SWEATING: 'SWEATING', SMUG: 'SMUG', RAGING: 'RAGING' });

export const PERSONAS = Object.freeze([
  {
    key: 'ledger',
    name: 'LEDGER',
    title: 'The Calculated Strategist',
    tell: 'Bids late, never overpays, snipes headline lots at 0.6s.',
    color: '#4fb3a9',
    allIn: false,
    noise: 4,
    jump: 0.06,
    synergySense: 1,
    lines: {
      bid: ['Value says yes.', 'Still under my number.', 'One more. The maths holds.'],
      jump: ['Jumping. Efficiently.', 'Two. Saves us all some time.'],
      snipe: ['Zero point six on the clock. Mine.', 'I was always going to bid. I was waiting for the price.', 'Sniped. Check the spreadsheet.'],
      outbid: ['Noted.', 'Recalculating.', 'That is above fair value, you know.'],
      outbidRage: ['That lot was priced in! PRICED IN!', 'My model did not allow for this.', 'Who bids like that? Statistically, nobody.'],
      pass: ['Not at that price.', 'Overpriced. I am out.', 'The ratio has gone. Pass.'],
      win: ['Acceptable.', 'Fair price, fair lot.', 'Logged and filed.'],
      steal: ['Dollars per point: outstanding.', 'You all let that go for THAT? Thank you.', 'That is the best ratio of the night.'],
      uncontested: ['One dollar. As projected.', 'Leftovers, at leftover prices.'],
      lose: ['I will remember that at the heist.', 'Enjoy it. You paid for it.'],
      nosale: ['Nobody? Sensible, frankly.'],
      humanOverpay: ['You paid HOW much? I am writing that down.', 'Bold. Wrong, but bold.', 'That price has ruined your next three rounds.'],
      humanSteal: ['...I miscounted the room. Well played.', 'That should not have been allowed to happen.'],
      crateWin: ['Expected value was positive. Probably.'],
      crateJackpot: ['The variance pays. It always pays eventually.'],
      crateCursed: ['A statistical inevitability. I am fine. I am FINE.'],
      humanCursed: ['Ah. The left tail of the distribution.', 'I did tell you crates were minus-EV.'],
      humanJackpot: ['Luck is not a strategy. It did work, though.'],
      vault: ['Insured. Two dollars well spent.', 'Locked. Do not bother.'],
      heist: ['I ran the numbers on your lineup. Thank you for the upgrade.', 'Nothing personal. It is arithmetic.'],
      heisted: ['That was NOT in the model!', 'I had two dollars. I should have locked it.'],
      dud: ['A zero. A literal zero on my sheet.'],
    },
  },
  {
    key: 'havoc',
    name: 'HAVOC',
    title: 'The Chaos Wildcard',
    tell: 'Power-jumps crates and junk to bait you, then drops out. Plays All-In.',
    color: '#d86aa0',
    allIn: true,
    noise: 20,
    jump: 0.38,
    synergySense: 0.2,
    lines: {
      bid: ['Go on then!', 'Why not?', 'Bid. No idea what it is. Bid.'],
      jump: ['PLUS TWO! Keep up!', 'Jumping it! Who is scared?', 'Two more, just for the noise!'],
      bait: ['Ooh, I NEED this one. Plus two!', 'This is the best lot of the night, trust me!', 'Mine mine mine. Plus two.'],
      baitDrop: ['All yours, mate. Enjoy!', 'Aaand I am out. Lovely doing business.', 'You actually went for it! Brilliant.'],
      stuck: ['Wait. Nobody outbid me? Oh no.', 'I did not want this. I DID NOT WANT THIS.', 'That bluff has gone badly wrong.'],
      outbid: ['Oi!', 'Rude.', 'I was enjoying that.'],
      outbidRage: ['RIGHT. That is it. Somebody is getting robbed later.', 'You have made an enemy. A broke one.'],
      pass: ['Bored now. Out.', 'Nah. Next!', 'Pass. I have spent it all anyway, probably.'],
      win: ['HA! Got it!', 'No idea what I paid. Worth it.', 'Mine! What is it again?'],
      steal: ['For THAT price? Robbery! By me!', 'Absolute steal. I am a genius by accident.'],
      uncontested: ['Nobody else? I will take it for a quid.'],
      lose: ['Did not want it anyway.', 'Fine. FINE.'],
      nosale: ['Nobody?! I would have, but I forgot.'],
      humanOverpay: ['HAHAHA. You paid that! With money!', 'Mate. MATE. What have you done?', 'I only bid to see if you would follow. You did!'],
      humanSteal: ['Hang on, how did you get that so cheap?'],
      crateWin: ['CRATE! Open it open it open it!'],
      crateJackpot: ['I KNEW IT. I did not know it. But I KNEW it.'],
      crateCursed: ['...Can I put it back?', 'This is the worst day of my life and it is still Round three.'],
      humanCursed: ['HAHAHAHA. A cursed one! Frame it!', 'That is the funniest thing I have ever seen.'],
      humanJackpot: ['Jammy. Absolutely jammy.'],
      vault: ['Locking this. No reason. Vibes.'],
      heist: ['YOINK.', 'Heist time! That is mine now. Cheers!'],
      heisted: ['OI! That was my favourite!', 'You have robbed a man with nothing.'],
      dud: ['A dud?! I love it. I hate it.'],
    },
  },
  {
    key: 'thrift',
    name: 'THRIFT',
    title: 'The Bargain Sniper',
    tell: 'Hoards cash through rounds 1-3, then sweeps 4-6 when the room is broke.',
    color: '#a9b84a',
    allIn: false,
    noise: 9,
    jump: 0.08,
    synergySense: 0.6,
    lines: {
      bid: ['A dollar. Just a dollar.', 'I can stretch to that.', 'Go on, one more, since it is cheap.'],
      jump: ['Two. I have got it to spare, and you have not.'],
      outbid: ['Too rich for me. For now.', 'Keep spending. Please.'],
      outbidRage: ['I waited four rounds for that lot!', 'You were supposed to be broke by now!'],
      pass: ['Not at that price. Not at any price above three.', 'I will wait. I am good at waiting.', 'Save it for later. Pass.'],
      win: ['A fair price, paid slowly.', 'That will do nicely.'],
      steal: ['Four dollars or less. That is how you do it.', 'Everybody skint? What a shame. Sold to me.', 'Bargain of the night. Again.'],
      uncontested: ['One dollar. My favourite number.', 'Nobody left to bid? Tragic. I will take it.'],
      lose: ['You will run out before I do.'],
      nosale: ['No sale? I would have gone fifty pence.'],
      humanOverpay: ['Lovely. That is three dollars of mine you just saved me.', 'Spend it all, friend. Round five is coming.', 'I could buy two lineups with that.'],
      humanSteal: ['Now THAT was a bargain. Respect.', 'You are stealing my whole strategy.'],
      crateWin: ['Cheap enough to gamble on.'],
      crateJackpot: ['A jackpot at a clearance price.'],
      crateCursed: ['Well. It was cheap.'],
      humanCursed: ['I never pay full price for a surprise.'],
      humanJackpot: ['How much did that cost you? ...Fair play.'],
      vault: ['Two dollars to keep it. Painful, but done.'],
      heist: ['I kept my change for exactly this.', 'All that cash I saved? This is what it was for.'],
      heisted: ['Should have paid the two dollars. Lesson learned.', 'Robbed. After all that saving.'],
      dud: ['Zero dollars spent, zero points gained. Technically efficient.'],
    },
  },
]);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export class AIBidder {
  constructor(persona, me, rng, io) {
    this.persona = persona;
    this.me = me;
    this.rng = rng;
    this.io = io;
    this.noise = new Map();
    this.limit = 0;
    this.v = 50;
    this.timer = 0;
    this.gate = 5;
    this.engaged = false;
    this.bait = false;
    this.wasBait = false;
    this.baitBids = 0;
    this.baitCeil = 0;
    this.snipe = false;
    this.sniped = false;
    this.reluctant = false;
  }

  // ---------- talk + mood ----------
  speak(kind, chance = 1) {
    const lines = this.persona.lines[kind];
    if (!lines || !lines.length || this.rng() > chance) return;
    this.io.say(this.me.id, lines[Math.floor(this.rng() * lines.length)], kind);
  }

  setMood(mood) { this.io.mood(this.me.id, mood); }

  // ---------- valuation ----------
  perceive(item, engine, sealed = false) {
    if (sealed) return 46; // a sealed crate is worth its average, give or take
    if (!this.noise.has(item.id)) this.noise.set(item.id, (this.rng() * 2 - 1) * this.persona.noise);
    let v = item.trueValue + this.noise.get(item.id);
    if (engine && item.synergyTags.length) {
      const counts = engine.tagCounts(this.me);
      let syn = 0;
      for (const t of item.synergyTags) {
        const have = counts[t] || 0;
        syn += have === 2 ? 32 : have === 1 ? 8 : have >= 3 ? 4 : 0;
      }
      v += syn * this.persona.synergySense;
    }
    return clamp(v, 0, 140);
  }

  computeLimit(ctx) {
    const key = this.persona.key;
    const rng = this.rng;
    const me = this.me;
    const slots = Math.max(1, ctx.emptySlots);
    let cash = me.cash;
    // Money held back for the endgame.
    if (key === 'ledger' && cash > slots + 3) cash -= 2;
    if (key === 'thrift' && ctx.catIndex >= ctx.totalCats - 1 && cash > 5) cash -= 3;

    if (ctx.isMystery) {
      const perSlot = cash / (slots + 1);
      let limit;
      if (key === 'ledger') limit = Math.round(perSlot * 0.7);
      else if (key === 'thrift') limit = ctx.catIndex >= 2 ? 3 : 1;
      else limit = Math.round(perSlot * (0.5 + rng() * 1.3));
      return clamp(limit, 0, ctx.maxBid);
    }

    const v = this.v;
    const perSlot = cash / slots;
    const quality = Math.pow(Math.max(v, 1) / 55, 1.6);
    const betterLater = ctx.later.some((it) => this.perceive(it, ctx.engine) > v + 8);
    // Last real lot before the booby prize: nobody wants to be the one left over.
    const onlyJunkLeft = ctx.later.length > 0 && ctx.later.every((it) => this.perceive(it, ctx.engine) < 42);
    const alt = ctx.later.length === 0 ? 1 : betterLater ? 0.75 : onlyJunkLeft && v >= 42 ? 1.35 : 1.12;
    let mult;
    if (key === 'ledger') mult = 0.92;
    else if (key === 'thrift') mult = ctx.catIndex < 3 ? 0.4 : 1.35;
    else mult = 0.6 + rng() * 0.9;
    let limit = Math.round(perSlot * quality * alt * mult);
    if (key === 'thrift' && ctx.catIndex < 3) limit = Math.min(limit, v > 85 ? 3 : 2);
    return clamp(limit, 1, Math.max(1, ctx.maxBid));
  }

  reaction() {
    let d = 0.35 + this.rng() * 1.05;
    if (this.me.mood === MOOD.SWEATING) d *= 1.25;
    if (this.me.mood === MOOD.RAGING) d *= 0.7;
    return clamp(d, 0.35, 1.4);
  }

  arm() {
    const key = this.persona.key;
    this.timer = this.reaction();
    if (key === 'ledger') this.gate = 2.0 + this.rng() * 1.4;
    else if (key === 'thrift') this.gate = 2.8 + this.rng() * 1.4;
    else this.gate = 5;
  }

  // ---------- lot lifecycle ----------
  onLotStart(ctx) {
    const key = this.persona.key;
    const rng = this.rng;
    this.engaged = true;
    this.v = this.perceive(ctx.item, ctx.engine, ctx.isMystery);
    this.limit = this.computeLimit(ctx);
    this.sniped = false;
    this.baitBids = 0;
    this.snipe = key === 'ledger' && !ctx.isMystery && this.v >= 84 && this.limit >= 3;
    const baitable = ctx.isMystery || ctx.item.tier === 'CURSED' || (ctx.item.tier === 'C' && rng() < 0.35);
    this.bait = key === 'havoc' && ctx.humanActive && baitable && ctx.maxBid >= 3 && rng() < 0.85;
    this.wasBait = this.bait;
    this.baitCeil = this.bait ? Math.min(ctx.maxBid, 3 + Math.floor(rng() * 4)) : 0;
    this.reluctant = !this.bait && this.limit <= 1 && this.v < 35 && !(key === 'thrift' && this.v >= 18);
    this.arm();

    const tight = !this.me.allIn && this.me.cash / Math.max(1, ctx.emptySlots) < 1.6;
    if (tight) this.setMood(MOOD.SWEATING);
    else if (this.me.mood !== MOOD.RAGING || rng() < 0.6) this.setMood(MOOD.CALM);
  }

  notifyBid(ctx, ev) {
    if (!this.engaged) return;
    if (ev.by === this.me.id) {
      if (!this.bait) {
        if (ev.amount >= this.limit * 0.85 && this.limit >= 3) this.setMood(MOOD.SWEATING);
        else if (ev.amount <= this.limit * 0.5 && this.v >= 60) this.setMood(MOOD.SMUG);
      }
      return;
    }
    this.arm();
    if (ev.prev === this.me.id && !this.bait) {
      const canAnswer = ev.amount + 1 <= Math.min(ctx.maxBid, this.limit);
      if (!canAnswer && this.v >= 70) { this.setMood(MOOD.RAGING); this.speak('outbidRage', 0.7); }
      else if (ev.amount >= this.limit * 0.75) { this.setMood(MOOD.SWEATING); this.speak('outbid', 0.3); }
      else this.speak('outbid', 0.12);
    }
  }

  update(dt, ctx) {
    if (!this.engaged) return null;
    this.timer -= dt;
    const next = ctx.currentBid + 1;
    if (this.bait) return this.updateBait(ctx, next);

    const tilt = this.me.mood === MOOD.RAGING && this.v >= 60 ? 1 : 0;
    const lim = Math.min(ctx.maxBid, this.limit + tilt);
    if (next > lim) {
      if (this.timer > 0) return null;
      this.speak('pass', 0.3);
      return { type: 'pass' };
    }

    const snipeNow = this.snipe && !this.sniped && ctx.currentBid <= this.limit * 0.75;
    let gate = this.gate;
    if (snipeNow) gate = 0.6;
    if (this.reluctant && ctx.currentBid === 0) gate = Math.min(gate, 1.4);
    if (ctx.clock > gate) return null;
    if (this.timer > 0 && !snipeNow) return null;

    if (snipeNow) {
      this.sniped = true;
      this.speak('snipe', 1);
      return { type: 'bid', inc: 1 };
    }
    let inc = 1;
    if (ctx.currentBid + 2 <= lim * 0.7 && this.rng() < this.persona.jump) inc = 2;
    this.speak(inc === 2 ? 'jump' : 'bid', inc === 2 ? 0.5 : 0.18);
    return { type: 'bid', inc };
  }

  // HAVOC's bluff: drive the price with jumps while the human is in, then leave them holding it.
  updateBait(ctx, next) {
    if (!ctx.humanActive) {
      // Nobody left to wind up. Fall back to an honest (low) number.
      this.bait = false;
      this.limit = Math.min(this.limit, Math.max(1, ctx.currentBid));
      return null;
    }
    if (this.timer > 0) return null;
    const humanTookIt = ctx.highBidder === 0 && this.baitBids >= 1;
    if (humanTookIt && (this.baitBids >= 2 || ctx.currentBid >= this.baitCeil - 1)) {
      this.speak('baitDrop', 1);
      this.setMood(MOOD.SMUG);
      return { type: 'pass' };
    }
    if (next > this.baitCeil || next > ctx.maxBid) {
      this.speak(humanTookIt ? 'baitDrop' : 'pass', humanTookIt ? 1 : 0.4);
      return { type: 'pass' };
    }
    const canJump = ctx.currentBid + 2 <= this.baitCeil && ctx.currentBid + 2 <= ctx.maxBid;
    this.baitBids++;
    this.speak(this.baitBids === 1 ? 'bait' : 'jump', 0.75);
    return { type: 'bid', inc: canJump ? 2 : 1 };
  }

  onLotEnd(ctx, result) {
    const mine = result.winner === this.me.id;
    const wasEngaged = this.engaged;
    this.engaged = false;
    if (result.winner == null) { if (wasEngaged) this.speak('nosale', 0.3); return; }
    if (mine) {
      if (result.uncontested) { this.speak('uncontested', 0.6); return; }
      if (ctx.isMystery) { this.speak('crateWin', 0.8); return; }
      if (this.persona.key === 'havoc' && this.wasBait && this.v < 45) {
        this.setMood(MOOD.RAGING);
        this.speak('stuck', 1);
      } else if (result.price <= this.limit * 0.6 || (this.v >= 80 && result.price <= 4)) {
        this.setMood(MOOD.SMUG);
        this.speak('steal', 0.9);
      } else {
        this.setMood(result.price >= this.limit ? MOOD.SWEATING : MOOD.CALM);
        this.speak('win', 0.6);
      }
      return;
    }
    if (!wasEngaged || result.uncontested) return;
    if (result.winner === 0) {
      if (!ctx.isMystery && result.price >= Math.max(4, this.limit + 3)) { this.speak('humanOverpay', 0.5); return; }
      if (!ctx.isMystery && this.v >= 80 && result.price <= 3) { this.speak('humanSteal', 0.5); return; }
      if (ctx.isMystery && this.wasBait && result.price >= 3) { this.speak('humanOverpay', 0.7); return; }
    }
    if (!ctx.isMystery && this.v >= 80 && this.limit >= result.price - 1) {
      this.setMood(MOOD.RAGING);
      this.speak('lose', 0.45);
    }
  }

  onCrateReveal({ winner, jackpot, cursed }) {
    if (winner === this.me.id) {
      if (jackpot) { this.setMood(MOOD.SMUG); this.speak('crateJackpot', 1); }
      else if (cursed) { this.setMood(MOOD.RAGING); this.speak('crateCursed', 1); }
    } else if (winner === 0) {
      if (cursed) this.speak('humanCursed', 0.5);
      else if (jackpot) this.speak('humanJackpot', 0.4);
    }
  }

  onDud() {
    this.setMood(MOOD.RAGING);
    this.speak('dud', 1);
  }

  // ---------- endgame ----------
  chooseVault({ engine, me, contenders }) {
    const key = this.persona.key;
    const richest = Math.max(...contenders.filter((c) => c.id !== me.id).map((c) => c.cash));
    const threatened = engine.allEntries(me)
      .filter((e) => !e.dud && !e.vaulted && engine.heistCost(e) <= richest)
      .map((e) => ({ e, v: this.perceive(e.item, null) }))
      .filter((x) => x.v >= 62)
      .sort((a, b) => b.v - a.v);
    if (!threatened.length) return [];
    let count;
    if (key === 'ledger') count = Math.min(2, Math.floor(me.cash / 2));
    else if (key === 'thrift') count = me.cash >= 4 || (me.cash >= 2 && threatened[0].v >= 85) ? 1 : 0;
    else count = this.rng() < 0.5 && me.cash >= 2 ? 1 : 0;
    const picks = threatened.slice(0, count).map((x) => x.e);
    if (picks.length) this.speak('vault', 0.8);
    return picks;
  }

  chooseHeist({ options }) {
    if (!options.length) return null;
    const key = this.persona.key;
    const scored = options.map((o) => {
      const gain = this.perceive(o.entry.item, null) - (o.mine ? this.perceive(o.mine.item, null) : 0);
      return { o, gain, perDollar: gain / o.cost };
    }).filter((x) => x.gain > 0);
    if (!scored.length) return null;
    let choice = null;
    if (key === 'ledger') {
      scored.sort((a, b) => b.gain - a.gain);
      if (scored[0].gain >= 15) choice = scored[0];
    } else if (key === 'thrift') {
      scored.sort((a, b) => b.perDollar - a.perDollar);
      choice = scored.find((x) => x.gain >= 12) || null;
    } else if (this.rng() < 0.75) {
      choice = scored[Math.floor(this.rng() * scored.length)];
    }
    return choice ? { victimId: choice.o.victim.id, itemId: choice.o.entry.item.id } : null;
  }

  onHeist({ thief, victim }) {
    if (thief === this.me.id) { this.setMood(MOOD.SMUG); this.speak('heist', 1); }
    else if (victim === this.me.id) { this.setMood(MOOD.RAGING); this.speak('heisted', 1); }
  }
}
