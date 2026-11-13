// Headless rules tests. Run with: node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuctionEngine, PHASE, RULES, HUMAN_ID, mulberry32 } from '../js/engine/auctionEngine.js';
import { CATEGORIES, MYSTERY_CATEGORY, allItems, SYNERGY_TAGS, TIERS } from '../js/data/categories.js';

// Plays one whole match with a scripted human. Returns the engine and an event log.
function playMatch({ seed, budget = 20, allIn = false, policy = 'mixed' }) {
  const engine = new AuctionEngine();
  const rng = mulberry32(seed * 7919 + 13);
  const log = [];
  engine.on('*', (e) => log.push(e));
  engine.startMatch({ seed, budget, allIn });
  const dt = 0.05;
  let steps = 0;
  while (engine.phase !== PHASE.VERDICT) {
    steps++;
    assert.ok(steps < 200000, `match ${seed} did not finish`);
    if (engine.phase === PHASE.BIDDING) {
      const hs = engine.humanState();
      const r = rng();
      if (policy === 'never') { /* sit on hands */ }
      else if (policy === 'greedy') { if (hs.canBid2 && r < 0.2) engine.humanBid(2); else if (hs.canBid1 && r < 0.6) engine.humanBid(1); }
      else if (hs.canBid1 && r < 0.035) engine.humanBid(r < 0.008 && hs.canBid2 ? 2 : 1);
      else if (hs.canPass && r > 0.995) engine.humanPass();
    } else if (engine.phase === PHASE.VAULT) {
      if (rng() < 0.02) {
        const e = engine.allEntries(engine.human).find((x) => engine.canVault(engine.human, x));
        if (e) engine.humanVault(e.item.id);
      }
    } else if (engine.phase === PHASE.HEIST) {
      if (rng() < 0.03) {
        const o = engine.heistOptions(engine.human)[0];
        if (o) assert.equal(engine.humanHeist(o.victim.id, o.entry.item.id), true);
      }
    }
    engine.update(dt);
    for (const c of engine.contenders) assert.ok(c.cash >= 0, `negative cash for ${c.name} (seed ${seed})`);
  }
  return { engine, log };
}

test('database: 8 categories, 64 lots, valid fields', () => {
  assert.equal(CATEGORIES.length + 1, 8);
  const items = allItems();
  assert.equal(items.length, 64);
  assert.equal(new Set(items.map((i) => i.id)).size, 64);
  for (const cat of [...CATEGORIES, MYSTERY_CATEGORY]) assert.equal(cat.items.length, 8);
  for (const it of items) {
    assert.ok(TIERS.includes(it.tier), it.id);
    assert.ok(it.trueValue >= 1 && it.trueValue <= 100, it.id);
    assert.ok(it.name && it.commentaryLine && it.proceduralIconType, it.id);
    assert.equal(it.colorPalette.length, 2);
    for (const t of it.synergyTags) assert.ok(SYNERGY_TAGS[t], `${it.id} has unknown tag ${t}`);
  }
  for (const cat of CATEGORIES) {
    assert.ok(cat.items.some((i) => i.tier === 'S'));
    assert.ok(cat.items.some((i) => i.tier === 'CURSED'));
  }
});

test('a match has 6 rounds of 4 lots and 2 crates', () => {
  const engine = new AuctionEngine();
  engine.startMatch({ seed: 42 });
  assert.equal(engine.contenders.length, 4);
  assert.equal(engine.categories.length, 6);
  assert.equal(engine.queue.filter((l) => l.kind === 'cat').length, 24);
  assert.equal(engine.queue.filter((l) => l.kind === 'mystery').length, 2);
  assert.notEqual(engine.queue[0].kind, 'mystery');
  assert.notEqual(engine.queue[engine.queue.length - 1].kind, 'mystery');
  assert.equal(engine.maxBidFor(engine.human), 15); // $20 minus $1 for each of the five other slots
});

test('same seed, same match', () => {
  const a = playMatch({ seed: 5, policy: 'never' }).engine.results;
  const b = playMatch({ seed: 5, policy: 'never' }).engine.results;
  assert.deepEqual(a.players.map((p) => p.total), b.players.map((p) => p.total));
});

test('120 simulated matches keep every invariant', () => {
  let humanWins = 0;
  const aiWins = [0, 0, 0, 0];
  const prices = [];
  const scores = [[], [], [], []];
  for (let seed = 1; seed <= 120; seed++) {
    const budget = seed % 3 === 0 ? 50 : 20;
    const allIn = seed % 4 === 0;
    const policy = ['mixed', 'greedy', 'never'][seed % 3];
    const { engine, log } = playMatch({ seed, budget, allIn, policy });
    const res = engine.results;
    assert.ok(res, 'verdict computed');
    for (const c of engine.contenders) {
      for (const cat of engine.categories) assert.ok(c.roster[cat.id], `${c.name} missing ${cat.id} (seed ${seed})`);
      assert.equal(c.cash + c.spent, budget, `money conserved for ${c.name} (seed ${seed})`);
    }
    // Reserve mode never produces a dud unless a lot went unsold.
    const unsold = log.filter((e) => e.type === 'nosale' && e.lot.kind === 'cat').length;
    const duds = log.filter((e) => e.type === 'dud').length;
    if (!engine.contenders.some((c) => c.allIn)) assert.equal(duds, unsold);
    // Every bid respected the shot clock and the lockout.
    for (const e of log.filter((x) => x.type === 'sold')) { assert.ok(e.price >= 1); prices.push(e.price); }
    // The weakest lot of a round is always sold last.
    for (let ci = 0; ci < 6; ci++) {
      const lots = engine.lotsOfCategory(ci);
      assert.equal(Math.min(...lots.map((l) => l.item.trueValue)), lots[3].item.trueValue);
    }
    scores[0].push(res.players[0].total);
    for (let i = 1; i < 4; i++) scores[i].push(res.players[i].total);
    // No item is owned twice.
    const owned = engine.contenders.flatMap((c) => engine.allEntries(c).map((x) => x.item.id));
    assert.equal(new Set(owned).size, owned.length, `duplicate ownership (seed ${seed})`);
    // Scores add up.
    for (const p of res.players) {
      const sum = engine.allEntries(engine.contenders[p.id]).reduce((s, x) => s + x.item.trueValue, 0);
      assert.equal(p.base, sum);
      assert.equal(p.total, p.base + p.synergy);
    }
    assert.equal(res.ranking.length, 4);
    if (res.winner === HUMAN_ID) humanWins++;
    aiWins[res.winner]++;
  }
  // The scripted human is not a good player; the house should usually win.
  assert.ok(humanWins < 80, `human won ${humanWins}/120`);
  const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  console.log('wins by seat [you, ledger, havoc, thrift]:', aiWins.join(', '));
  console.log('average score by seat:', scores.map(avg).join(', '), '| average hammer price: $' + (prices.reduce((s, x) => s + x, 0) / prices.length).toFixed(2));
});

test('heist is a forced swap and vaulted lots are safe', () => {
  for (let seed = 200; seed < 260; seed++) {
    const { log } = playMatch({ seed, policy: 'never' });
    for (const h of log.filter((e) => e.type === 'heist')) {
      assert.equal(h.taken.vaulted, false);
      assert.equal(h.cost, h.taken.price + RULES.heistPremium);
      assert.notEqual(h.thief, h.victim);
    }
  }
});
