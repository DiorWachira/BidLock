// Headless tests for Fine Print: the fact catalogue, the text rules (what counts as the
// truth, what a player may type), and the rules engine with bots and people.
// Run with: node --test tests/fineprint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, DEPARTMENTS, deptById, factsFor } from '../js/games/finePrint/facts.js';
import {
  FinePrintEngine, F_PHASE, F_RULES, rateFor, RATE_NAMES, norm, cleanEntry, isTruth, sameEntry, pickFacts,
} from '../js/games/finePrint/finePrintEngine.js';
import { botSeats } from '../js/arcade/bots.js';
import { gameById } from '../js/arcade/games.js';
import { mulberry32 } from '../js/engine/auctionEngine.js';

const factById = (id) => FACTS.find((f) => f.id === id);

test('the catalogue: true facts with a blank, six fakes each, and a source', () => {
  assert.ok(FACTS.length >= 80, `${FACTS.length} facts`);
  assert.equal(new Set(FACTS.map((f) => f.id)).size, FACTS.length, 'no fact twice');
  for (const f of FACTS) {
    assert.equal(f.text.split('___').length, 2, `${f.id}: one blank`);
    assert.ok(!` ${norm(f.text)} `.includes(` ${norm(f.truth)} `), `${f.id}: the fact gives its own ending away`);
    assert.ok(f.truth && f.fakes.length === 6, `${f.id}: a truth and six fakes`);
    assert.ok(f.src.startsWith('https://en.wikipedia.org/wiki/'), f.id);
    assert.ok(DEPARTMENTS.some((d) => d.id === f.dept), f.dept);
    // The truth, and every other way of writing it, counts as the truth.
    for (const t of [f.truth, ...f.also]) assert.ok(isTruth(t, f), `${f.id}: "${t}" should count as the truth`);
    // None of the house's fakes is the truth, or too close to it.
    for (const k of f.fakes) {
      assert.equal(isTruth(k, f), false, `${f.id}: the fake "${k}" reads as the truth`);
      assert.ok(cleanEntry(k) === k && k.length <= F_RULES.maxLen, `${f.id}: "${k}" is a clean entry`);
    }
    for (let i = 0; i < f.fakes.length; i++) for (let j = i + 1; j < f.fakes.length; j++) assert.equal(sameEntry(f.fakes[i], f.fakes[j]), false, `${f.id}: two fakes alike`);
  }
  for (const d of DEPARTMENTS) assert.ok(factsFor(d.id).length >= F_RULES.rounds + 4, `${d.id}: ${factsFor(d.id).length}`);
  assert.equal(deptById('nope').id, 'all');
  assert.equal(gameById('fineprint').slot, '01:00');
});

test('what counts as the truth, and what a player may type', () => {
  const emu = factById('emuwar');
  for (const t of ['emus', 'EMUS!', 'the emus', 'Emus.', 'giant emus', 'an emu']) assert.ok(isTruth(t, emu), t);
  for (const t of ['angry wombats', 'emulsion paint','seagulls']) assert.equal(isTruth(t, emu), false, t);
  assert.ok(isTruth('radioactve', factById('banana')), 'a slip of the keyboard on a long word');
  assert.equal(isTruth('Manet', factById('pigeon')), false, 'Manet is a good fake, not a typo of Monet');
  assert.equal(isTruth('Earth year', factById('venus')), false);
  assert.equal(isTruth('washing his car', factById('photo')), false);
  assert.ok(isTruth('getting his shoes shined', factById('photo')));
  assert.equal(isTruth('William Shakespeare', factById('mars')), false);
  assert.ok(isTruth('will.i.am', factById('mars')));
  assert.ok(isTruth('forty minutes', factById('zanzibar')));
  assert.equal(isTruth('four hours', factById('zanzibar')), false);
  assert.equal(isTruth('Cuban cigars', factById('wombat')), false);
  assert.equal(isTruth('cardigans', factById('nintendo')), false);
  assert.ok(isTruth('e', factById('gadsby')) && !isTruth('a', factById('gadsby')));

  assert.equal(norm('  The  Émus!! '), 'emus');
  assert.equal(cleanEntry('  "a‮flock\nof  seagulls."  '), 'a flock of seagulls');
  assert.equal(cleanEntry('x'.repeat(90)).length, F_RULES.maxLen);
  assert.equal(cleanEntry('\u0007​  '), '');
  assert.ok(sameEntry('Kangaroos!', 'kangaroos') && sameEntry('a flock of seagulls', 'a flock of seagull'));
  assert.equal(sameEntry('cats', 'bats'), false);
});

test('the rate card and picking tonight\'s facts', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => rateFor(i, 5)), [1, 1, 2, 2, 3]);
  assert.equal(RATE_NAMES[3], 'THE CLOSING OFFER ×3');
  const rng = mulberry32(4);
  const picks = pickFacts('kitchen', rng, 5);
  assert.equal(picks.length, 5);
  assert.ok(picks.every((f) => f.dept === 'kitchen'));
  // Facts this device has seen go to the back of the queue.
  const seen = factsFor('space').slice(0, 8).map((f) => f.id);
  for (let s = 1; s <= 20; s++) assert.ok(pickFacts('space', mulberry32(s), 5, seen).every((f) => !seen.includes(f.id)));
  assert.equal(new Set(pickFacts('all', mulberry32(9), 5).map((f) => f.id)).size, 5);
});

function run(e, guard = 40000) {
  let n = 0;
  while (e.phase !== F_PHASE.PODIUM && n++ < guard) e.update(1 / 20);
}

test('fine print: 200 bot matches keep every invariant', () => {
  let sellers = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const e = new FinePrintEngine();
    const count = 2 + (seed % 5);
    const facts = pickFacts('all', mulberry32(seed), 5);
    e.startMatch({ seats: botSeats(count, []), seed, match: { dept: 'all', facts } });
    let lines = 0;
    e.on('call', (d) => { lines = d.count; assert.ok(d.count >= F_RULES.minLines && d.count <= count + 1 + 2, `seed ${seed}: ${d.count} lines`); });
    e.on('reveal', (d) => {
      assert.equal(d.lines.length, lines);
      assert.equal(d.lines.filter((l) => l.truth).length, 1);
      assert.ok(d.lines[d.truth].truth);
      assert.equal(d.order.at(-1), d.truth, 'the genuine article comes last');
      for (const g of d.gains) {
        // Nobody calls their own line; the points add up.
        if (g.vote != null) assert.ok(!d.lines[g.vote].authors.includes(g.id), `seed ${seed}: called own line`);
        const fooled = d.lines.reduce((s, l) => s + (l.authors.includes(g.id) && !l.house ? l.voters.filter((v) => v !== g.id).length : 0), 0);
        const stars = d.lines.reduce((s, l) => s + (l.authors.includes(g.id) ? l.stars.length : 0), 0);
        assert.equal(g.gain, (g.found ? F_RULES.truth * d.rate : 0) + fooled * F_RULES.fool * d.rate + stars * F_RULES.star, `seed ${seed}`);
      }
    });
    run(e);
    assert.equal(e.phase, F_PHASE.PODIUM, `seed ${seed} finished`);
    assert.equal(e.round, 5);
    assert.equal(e.ranking.length, count);
    for (const p of e.players) assert.ok(p.score >= 0 && p.found <= 5);
    if (e.awards.seller) sellers++;
  }
  assert.ok(sellers > 150, 'bots fool each other');
});

function humans(n) { return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, kind: 'human' })); }
function toPhase(e, ph) { let n = 0; while (e.phase !== ph && n++ < 5000) e.update(1 / 20); }

test('writing: the truth bounces, a knock-off files, and two alike become one line', () => {
  const e = new FinePrintEngine();
  const bounces = [];
  e.on('bounce', (d) => bounces.push(d));
  e.startMatch({ seats: humans(3), seed: 3, match: { dept: 'antiques', facts: [factById('emuwar'), factById('molasses')] } });
  assert.equal(e.writeFor(0, 'angry wombats'), false, 'not yet: the offer is still going up');
  toPhase(e, F_PHASE.WRITE);
  assert.ok(e.current.stock.length >= 1 && e.current.stock.length <= 3, 'warehouse stock on offer');
  assert.equal(e.writeFor(0, 'The emus!'), false);
  assert.deepEqual(bounces, [{ id: 0, why: 'truth' }]);
  assert.ok(e.writeFor(0, 'Angry wombats.'));
  assert.ok(e.writeFor(1, 'angry wombats'));
  assert.ok(e.writeFor(2, 'marsupial mice'));
  // Secrets: nobody's knock-off is in a snapshot while the writing is on.
  const snap = JSON.stringify(e.serialize());
  assert.ok(!/wombat|marsupial/.test(snap));
  assert.ok(!/emu/i.test(snap), 'nor the real ending, nor anything that names it');
  assert.deepEqual(e.serialize().pl.map((p) => p.w), [1, 1, 1]);
  e.update(0.1);
  e.update(F_RULES.writeGrace + 0.1);
  assert.equal(e.phase, F_PHASE.CALL, 'everyone filed: the lines open after a moment');
  // The genuine article, one merged knock-off, camels, and one from the house.
  assert.equal(e.lines.length, 4);
  const roo = e.lines.findIndex((l) => norm(l.text) === 'angry wombats');
  assert.deepEqual(e.lines[roo].authors, [0, 1]);
  assert.equal(e.lines.filter((l) => l.house).length, 1);
  const call = JSON.parse(JSON.stringify(e.serialize()));
  assert.equal(call.cur.lines.length, 4);
  assert.ok(!/authors|"truth"/.test(JSON.stringify(call)), 'who wrote what, and the truth, stay secret');
});

test('calling in and the reveal: points for the truth, for fooling and for stars', () => {
  const e = new FinePrintEngine();
  e.startMatch({ seats: humans(3), seed: 8, match: { dept: 'antiques', facts: [factById('emuwar'), factById('molasses')] } });
  toPhase(e, F_PHASE.WRITE);
  e.writeFor(0, 'angry wombats');
  e.writeFor(1, 'angry wombats');
  e.writeFor(2, 'marsupial mice');
  toPhase(e, F_PHASE.CALL);
  const roo = e.lines.findIndex((l) => norm(l.text) === 'angry wombats');
  const cam = e.lines.findIndex((l) => norm(l.text) === 'marsupial mice');
  const truth = e.truthLine;
  assert.equal(e.voteFor(0, roo), false, 'not your own line');
  assert.equal(e.starFor(2, cam), false, 'no stars for yourself');
  assert.ok(e.voteFor(0, cam));
  assert.ok(e.voteFor(1, truth));
  assert.ok(e.voteFor(2, roo));
  assert.ok(e.starFor(2, roo));
  assert.ok(e.starFor(1, cam) && e.starFor(1, cam), 'a second tap takes a star back');
  assert.equal(e.players[1].star, null);
  let rev = null;
  e.on('reveal', (d) => { rev = d; });
  toPhase(e, F_PHASE.REVEAL);
  const g = Object.fromEntries(rev.gains.map((x) => [x.id, x.gain]));
  // P1: fooled P3 (500) and a star (100). P2: the truth (1000), fooled P3 (500), a star (100). P3: fooled P1 (500).
  assert.deepEqual(g, { 0: 600, 1: 1600, 2: 500 });
  assert.deepEqual(rev.order.slice(-1), [truth]);
  assert.ok(rev.lines[roo].voters.includes(2) && rev.lines[cam].voters.includes(0));
  assert.equal(rev.fact.src, factById('emuwar').src);
  // A guest's mirror shows the reveal in full.
  const m = new FinePrintEngine();
  m.hydrate(JSON.parse(JSON.stringify(e.serialize())), 2);
  assert.equal(m.last.truth, truth);
  assert.equal(m.me.score, 500);
  // The second offer is the closing offer here: triple.
  toPhase(e, F_PHASE.PITCH);
  assert.equal(e.current.rate, 3);
});

test('away players are not waited for, and the house fills a thin board', () => {
  const e = new FinePrintEngine();
  e.startMatch({ seats: [{ name: 'A', kind: 'human' }, ...botSeats(1, [])], seed: 2, match: { dept: 'space', facts: pickFacts('space', mulberry32(2), 5) } });
  e.setAway(0, true);
  toPhase(e, F_PHASE.CALL);
  assert.ok(e.elapsed < 1, 'the writing ended as soon as the bot filed');
  assert.ok(e.lines.length >= F_RULES.minLines);
  run(e);
  assert.equal(e.phase, F_PHASE.PODIUM);
});
