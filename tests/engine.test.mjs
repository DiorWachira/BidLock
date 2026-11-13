// Headless rules tests. Run with: node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuctionEngine, PHASE, RULES, mulberry32, soloSeats } from '../js/engine/auctionEngine.js';
import { CATEGORIES, MYSTERY_CATEGORY, allItems, itemById, SYNERGY_TAGS, TIERS } from '../js/data/categories.js';
import { TriviaBank, FALLBACK_QUESTIONS, decodeEntities, halfPrice, ORACLE } from '../js/engine/triviaSteal.js';
import { batchUrl, readBatch, readSummary } from '../js/utils/mediaLoader.js';
import { packEvent, unpackEvent, WIRE, wireType, makeRoomCode, normalizeCode } from '../js/net/lobbyManager.js';

const PEOPLE = (n, bots = 0) => [
  ...Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, kind: 'human' })),
  ...['ledger', 'havoc', 'thrift'].slice(0, bots).map((persona) => ({ name: persona.toUpperCase(), kind: 'ai', persona })),
];

// Plays one whole match with scripted people in every human seat. Returns the engine and an event log.
function playMatch({ seed, budget = 20, allIn = false, marathon = false, policy = 'mixed', seats = null, oracleChance = null, oracleSkill = 0.5, mirror = null }) {
  const engine = new AuctionEngine();
  const rng = mulberry32(seed * 7919 + 13);
  const log = [];
  engine.on('*', (type, data) => {
    log.push({ type, ...data });
    if (mirror) {
      // Everything a client would receive: the event, packed, plus a snapshot, through JSON.
      const msg = JSON.parse(JSON.stringify({ t: wireType(type), ev: type, d: packEvent(type, data), s: engine.serialize() }));
      mirror.hydrate(msg.s, 1);
      const back = unpackEvent(mirror, msg.ev, msg.d);
      assert.ok(back, `event ${type} unpacks`);
    }
  });
  engine.startMatch({ seed, budget, allIn, marathon, seats, oracleChance });
  const dt = 0.05;
  let steps = 0;
  const people = () => engine.contenders.filter((c) => c.isHuman);
  while (engine.phase !== PHASE.VERDICT) {
    steps++;
    assert.ok(steps < 400000, `match ${seed} did not finish`);
    if (engine.phase === PHASE.BIDDING) {
      for (const c of people()) {
        const r = rng();
        if (policy === 'never') continue;
        const can = engine.active.has(c.id) && !engine.passed.has(c.id) && engine.highBidder !== c.id;
        if (!can) continue;
        if (policy === 'greedy') { if (r < 0.2) engine.bidFor(c.id, 2); else if (r < 0.6) engine.bidFor(c.id, 1); }
        else if (r < 0.035) engine.bidFor(c.id, r < 0.008 ? 2 : 1);
        else if (r > 0.995) engine.passFor(c.id);
      }
    } else if (engine.phase === PHASE.VAULT) {
      for (const c of people()) {
        if (rng() < 0.02) {
          const e = engine.allEntries(c).find((x) => engine.canVault(c, x));
          if (e) engine.vaultFor(c.id, e.item.id);
        }
      }
    } else if (engine.phase === PHASE.HEIST) {
      for (const c of people()) {
        if (rng() < 0.03) {
          const o = engine.heistOptions(c)[0];
          if (o) assert.equal(engine.heistFor(c.id, o.victim.id, o.entry.item.id), true);
        }
      }
    } else if (engine.phase === PHASE.ORACLE) {
      const or = engine.oracle;
      const c = engine.contenders[or.player];
      if (c.isHuman && rng() < 0.1) {
        if (or.stage === 'q1' || or.stage === 'q2') {
          const right = rng() < oracleSkill;
          or.answer(c.id, right ? or.correct : (or.correct + 1) % 4);
        } else if (or.stage === 'pick') {
          const o = or.optionsFor(c)[0];
          or.pick(c.id, o.victim.id, o.entry.item.id);
        } else if (or.stage === 'gamble') {
          or.gamble(c.id, rng() < 0.5);
        }
      }
    }
    engine.update(dt);
    for (const c of engine.contenders) assert.ok(c.cash >= 0, `negative cash for ${c.name} (seed ${seed})`);
  }
  return { engine, log };
}

function checkInvariants(engine, log, seed) {
  const res = engine.results;
  const n = engine.contenders.length;
  assert.ok(res, 'verdict computed');
  for (const c of engine.contenders) {
    for (const cat of engine.categories) assert.ok(c.roster[cat.id], `${c.name} missing ${cat.id} (seed ${seed})`);
    assert.equal(c.cash + c.spent - c.refund, engine.options.budget, `money accounted for ${c.name} (seed ${seed})`);
  }
  const owned = engine.contenders.flatMap((c) => engine.allEntries(c).map((x) => x.item.id));
  assert.equal(new Set(owned).size, owned.length, `duplicate ownership (seed ${seed})`);
  for (const p of res.players) {
    const sum = engine.allEntries(engine.contenders[p.id]).reduce((s, x) => s + x.item.trueValue, 0);
    assert.equal(p.base, sum);
    assert.equal(p.total, p.base + p.synergy);
  }
  assert.equal(res.ranking.length, n);
  // The weakest lot of a round is always sold last.
  for (let ci = 0; ci < engine.categories.length; ci++) {
    const lots = engine.lotsOfCategory(ci);
    assert.equal(lots.length, n);
    assert.equal(Math.min(...lots.map((l) => l.item.trueValue)), lots[n - 1].item.trueValue);
  }
  assert.ok(log.filter((e) => e.type === 'oracle' && e.stage === 'intro').length <= ORACLE.max);
}

test('database: 14 categories, 140 lots, valid fields', () => {
  assert.equal(CATEGORIES.length + 1, 14);
  const items = allItems();
  assert.equal(items.length, 140);
  assert.equal(new Set(items.map((i) => i.id)).size, 140);
  assert.equal(new Set(items.map((i) => i.name)).size, 140, 'lot names are unique');
  for (const cat of [...CATEGORIES, MYSTERY_CATEGORY]) assert.ok(cat.items.length >= 10, cat.id);
  for (const it of items) {
    assert.ok(TIERS.includes(it.tier), it.id);
    assert.ok(it.trueValue >= 1 && it.trueValue <= 100, it.id);
    assert.ok(it.name && it.commentaryLine && it.proceduralIconType && it.wikiQuery, it.id);
    assert.equal(it.colorPalette.length, 2);
    assert.equal(itemById(it.id), it);
    for (const t of it.synergyTags) assert.ok(SYNERGY_TAGS[t], `${it.id} has unknown tag ${t}`);
  }
  for (const cat of CATEGORIES) {
    assert.ok(cat.items.some((i) => i.tier === 'S'), cat.id);
    assert.ok(cat.items.some((i) => i.tier === 'C' || i.tier === 'CURSED'), cat.id);
  }
  assert.equal(itemById('dud-rides-3').name, 'Participation Ribbon');
});

test('a solo match has 6 rounds of 4 lots and 2 crates; marathon has 8 rounds', () => {
  const engine = new AuctionEngine();
  engine.startMatch({ seed: 42 });
  assert.equal(engine.contenders.length, 4);
  assert.equal(engine.categories.length, 6);
  assert.equal(engine.queue.filter((l) => l.kind === 'cat').length, 24);
  assert.equal(engine.queue.filter((l) => l.kind === 'mystery').length, 2);
  assert.notEqual(engine.queue[0].kind, 'mystery');
  assert.notEqual(engine.queue[engine.queue.length - 1].kind, 'mystery');
  assert.equal(engine.maxBidFor(engine.me), 15); // $20 minus $1 for each of the five other slots
  const long = new AuctionEngine();
  long.startMatch({ seed: 42, marathon: true });
  assert.equal(long.categories.length, 8);
  assert.equal(long.maxBidFor(long.me), 13);
  assert.equal(new Set(long.queue.map((l) => l.item.id)).size, long.queue.length, 'no lot repeats in a match');
});

test('same seed, same match', () => {
  const a = playMatch({ seed: 5, policy: 'never' }).engine.results;
  const b = playMatch({ seed: 5, policy: 'never' }).engine.results;
  assert.deepEqual(a.players.map((p) => p.total), b.players.map((p) => p.total));
});

test('120 simulated solo matches keep every invariant', () => {
  let humanWins = 0;
  const wins = [0, 0, 0, 0];
  const prices = [];
  const scores = [[], [], [], []];
  for (let seed = 1; seed <= 120; seed++) {
    const budget = seed % 3 === 0 ? 50 : 20;
    const allIn = seed % 4 === 0;
    const policy = ['mixed', 'greedy', 'never'][seed % 3];
    const { engine, log } = playMatch({ seed, budget, allIn, policy, marathon: seed % 5 === 0 });
    checkInvariants(engine, log, seed);
    const res = engine.results;
    // Reserve mode never produces a dud unless a lot went unsold.
    const unsold = log.filter((e) => e.type === 'nosale' && e.lot.kind === 'cat').length;
    const duds = log.filter((e) => e.type === 'dud').length;
    if (!engine.contenders.some((c) => c.allIn)) assert.equal(duds, unsold);
    for (const e of log.filter((x) => x.type === 'sold')) { assert.ok(e.price >= 1); prices.push(e.price); }
    for (let i = 0; i < 4; i++) scores[i].push(res.players[i].total);
    if (res.winner === 0) humanWins++;
    wins[res.winner]++;
  }
  // The scripted human is not a good player; the house should usually win.
  assert.ok(humanWins < 80, `human won ${humanWins}/120`);
  const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  console.log('wins by seat [you, ledger, havoc, thrift]:', wins.join(', '));
  console.log('average score by seat:', scores.map(avg).join(', '), '| average hammer price: $' + (prices.reduce((s, x) => s + x, 0) / prices.length).toFixed(2));
});

test('rooms of 2 to 6 people, with and without bots', () => {
  const tables = [PEOPLE(2), PEOPLE(2, 2), PEOPLE(3, 1), PEOPLE(4), PEOPLE(5), PEOPLE(6), PEOPLE(1, 1)];
  let seed = 300;
  for (const seats of tables) {
    for (let k = 0; k < 6; k++) {
      seed++;
      const { engine, log } = playMatch({ seed, seats, policy: k % 2 ? 'greedy' : 'mixed', marathon: k === 5, budget: k === 4 ? 50 : 20 });
      assert.equal(engine.contenders.length, seats.length);
      checkInvariants(engine, log, seed);
    }
  }
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

test('the Oracle: half-price steal, double or nothing, and its limits', () => {
  const seen = { steal: 0, free: 0, fail: 0, half: 0 };
  for (let seed = 500; seed < 620; seed++) {
    const { engine, log } = playMatch({ seed, seats: PEOPLE(3, 1), oracleChance: 1, oracleSkill: 0.7 });
    checkInvariants(engine, log, seed);
    const or = log.filter((e) => e.type === 'oracle');
    const intros = or.filter((e) => e.stage === 'intro');
    assert.ok(intros.length <= ORACLE.max);
    assert.equal(or.filter((e) => e.stage === 'end').length, intros.length, 'every intervention ends');
    for (const s of or.filter((e) => e.stage === 'steal')) {
      seen.steal++;
      assert.notEqual(s.thief, s.victim);
      assert.equal(s.half, halfPrice(s.taken.price));
      assert.equal(s.cost, s.free ? 0 : s.half);
      assert.equal(s.taken.stolenFrom, s.victim);
      if (s.free) seen.free++; else seen.half++;
    }
    seen.fail += or.filter((e) => e.stage === 'fail').length;
  }
  assert.ok(seen.half > 5 && seen.free > 5 && seen.fail > 5, JSON.stringify(seen));
  // Never before the end of round 2, never after the last round.
  const { log } = playMatch({ seed: 9, oracleChance: 1 });
  const sold = log.filter((e) => e.type === 'sold' || e.type === 'nosale' || (e.type === 'oracle' && e.stage === 'intro'));
  const firstOracle = sold.findIndex((e) => e.type === 'oracle');
  if (firstOracle >= 0) assert.ok(sold.slice(0, firstOracle).filter((e) => e.lot.kind === 'cat').length >= 8);
  assert.equal(halfPrice(1), 1);
  assert.equal(halfPrice(7), 3);
});

test('a mirror rebuilt from snapshots agrees with the host at every event', () => {
  for (const seed of [11, 12, 13, 14]) {
    const mirror = new AuctionEngine();
    const { engine } = playMatch({ seed, seats: PEOPLE(2, 2), oracleChance: 1, mirror });
    mirror.hydrate(JSON.parse(JSON.stringify(engine.serialize())), 1);
    assert.equal(mirror.mirror, true);
    assert.equal(mirror.localId, 1);
    assert.deepEqual(mirror.computeVerdict().players.map((p) => [p.total, p.cash, p.rank]), engine.results.players.map((p) => [p.total, p.cash, p.rank]));
    assert.deepEqual(mirror.contenders.map((c) => c.name), engine.contenders.map((c) => c.name));
    // A mirror never advances the match by itself.
    const before = JSON.stringify(mirror.serialize());
    mirror.update(1);
    assert.equal(JSON.stringify(mirror.serialize()), before);
  }
  // Mid-match: the mirror answers the same questions as the host.
  const host = new AuctionEngine();
  host.startMatch({ seed: 77, seats: PEOPLE(3) });
  while (host.phase !== PHASE.BIDDING) host.update(0.05);
  host.bidFor(1, 2);
  const m = new AuctionEngine();
  m.hydrate(JSON.parse(JSON.stringify(host.serialize())), 2);
  assert.equal(m.currentBid, 2);
  assert.equal(m.highBidder, 1);
  assert.equal(m.lot.item, host.lot.item);
  assert.equal(m.maxBidFor(m.me), host.maxBidFor(host.contenders[2]));
  assert.equal(m.humanState().canBid1, true);
  assert.equal(m.bidFor(2, 1), false, 'a mirror cannot place bids itself');
  // The unanswered question's answer is never in a snapshot.
  const o = new AuctionEngine();
  o.startMatch({ seed: 3, seats: PEOPLE(2, 1), oracleChance: 1 });
  let guard = 0;
  while (!(o.phase === PHASE.ORACLE && o.oracle.stage === 'q1') && o.phase !== PHASE.VERDICT && guard++ < 200000) {
    if (o.phase === PHASE.BIDDING && guard % 40 === 0) o.bidFor(guard % 2, 1);
    o.update(0.05);
  }
  if (o.phase === PHASE.ORACLE) assert.equal(o.serialize().or.correct, -1);
});

test('trivia bank: 50 sound questions, entity decoding, Open Trivia DB filtering', async () => {
  assert.equal(FALLBACK_QUESTIONS.length, 50);
  for (const q of FALLBACK_QUESTIONS) {
    assert.equal(q.length, 6);
    assert.equal(new Set(q.slice(1, 5)).size, 4, q[0]);
    assert.ok(q[0].endsWith('?'), q[0]);
  }
  assert.equal(new Set(FALLBACK_QUESTIONS.map((q) => q[0])).size, 50);
  assert.equal(decodeEntities('Sch&ouml;n &amp; &quot;gut&quot; &#039;ja&#039; &#x41; &eacute;'), 'Schön & "gut" \'ja\' A é');
  const bank = new TriviaBank(mulberry32(1));
  for (let i = 0; i < 120; i++) {
    const q = bank.next();
    assert.equal(q.answers.length, 4);
    assert.ok(q.correct >= 0 && q.correct < 4);
  }
  const fake = async () => ({
    ok: true,
    json: async () => ({
      response_code: 0,
      results: [
        { type: 'multiple', category: 'History', question: 'Who said &quot;veni, vidi, vici&quot;?', correct_answer: 'Julius Caesar', incorrect_answers: ['Nero', 'Augustus', 'Cicero'] },
        { type: 'multiple', category: 'Entertainment: Video Games', question: 'Fluff?', correct_answer: 'a', incorrect_answers: ['b', 'c', 'd'] },
        { type: 'multiple', category: 'Science: Mathematics', question: 'What is &pi; to two places?', correct_answer: '3.14', incorrect_answers: ['3.41', '3.12', '3.16'] },
      ],
    }),
  });
  const remote = new TriviaBank(mulberry32(2));
  assert.equal(await remote.load({ fetchImpl: fake }), 2);
  const first = remote.next();
  assert.equal(first.text, 'Who said "veni, vidi, vici"?');
  assert.equal(first.answers[first.correct], 'Julius Caesar');
  const broken = new TriviaBank(mulberry32(3));
  assert.equal(await broken.load({ fetchImpl: async () => { throw new Error('offline'); } }), 0);
  assert.equal(broken.source, 'built-in');
});

test('media lookups and room codes', () => {
  const url = batchUrl(['Bugatti Chiron', 'Rubik\'s Cube']);
  assert.ok(url.includes('titles=Bugatti%20Chiron%7CRubik\'s%20Cube') || url.includes('titles=Bugatti%20Chiron%7CRubik%27s%20Cube'));
  const hits = readBatch({
    query: {
      normalized: [{ from: 'bugatti chiron', to: 'Bugatti chiron' }],
      redirects: [{ from: 'Bugatti chiron', to: 'Bugatti Chiron' }],
      pages: [{ title: 'Bugatti Chiron', fullurl: 'https://en.wikipedia.org/wiki/Bugatti_Chiron', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg', width: 960, height: 540 } }, { title: 'Nope', missing: true }],
    },
  });
  assert.equal(hits.get('bugatti chiron').src, 'https://upload.wikimedia.org/x.jpg');
  assert.equal(hits.get('Bugatti Chiron').w, 960);
  assert.equal(hits.has('Nope'), false);
  assert.equal(readSummary({ type: 'disambiguation' }), null);
  assert.equal(readSummary({ title: 'X', thumbnail: { source: 'u', width: 320, height: 200 } }).src, 'u');

  const code = makeRoomCode(mulberry32(4));
  assert.match(code, /^BL-[A-Z2-9]{3}$/);
  assert.equal(normalizeCode(' bl 7k9 '), 'BL-7K9');
  assert.equal(normalizeCode('7k9'), 'BL-7K9');
  assert.equal(normalizeCode('nope!'), null);
  assert.equal(wireType('bid'), WIRE.BID_PLACED);
  assert.equal(wireType('lotIntro'), WIRE.NEW_LOT);
  assert.equal(wireType('sold'), WIRE.LOT_SOLD);
  assert.equal(wireType('oracle'), WIRE.TRIVIA_STEAL_TRIGGERED);
  assert.equal(wireType('heist'), WIRE.HEIST_ACTION);
  assert.equal(wireType('verdict'), WIRE.FINAL_RESULTS);
  assert.equal(soloSeats().length, 4);
});
