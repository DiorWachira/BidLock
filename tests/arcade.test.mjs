// Headless rules tests for the two quiz games. Run with: node --test tests/arcade.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/engine/auctionEngine.js';
import { RoyaleEngine, R_PHASE, R_RULES } from '../js/games/trapdoorRoyale/royaleEngine.js';
import { LampEngine, L_PHASE, L_RULES } from '../js/games/lastLamp/lampEngine.js';
import { MINI_KINDS, MINI_INFO } from '../js/games/lastLamp/undertowMinigames.js';
import { QuizBank, makeSum } from '../js/arcade/quizBank.js';
import { BOT_ROSTER, botSeats, botAnswer } from '../js/arcade/bots.js';
import { GAMES, gameById } from '../js/arcade/games.js';

const table = (people, bots) => [
  ...Array.from({ length: people }, (_, i) => ({ name: `P${i + 1}`, kind: 'human' })),
  ...botSeats(bots, []),
];
const wire = (x) => JSON.parse(JSON.stringify(x));

test('the programme guide lists three games', () => {
  assert.deepEqual(GAMES.map((g) => g.id), ['bidlock', 'royale', 'lamp']);
  for (const g of GAMES) {
    assert.ok(g.name && g.marquee.length <= 8 && g.tagline && g.how.length >= 3, g.id);
    assert.ok(g.fillTo >= g.minSeats);
  }
  assert.equal(gameById('nope').id, 'bidlock');
});

test('bots and the quiz bank', () => {
  assert.equal(BOT_ROSTER.length, 12);
  assert.equal(new Set(BOT_ROSTER.map((b) => b.name)).size, 12);
  assert.equal(botSeats(11, ['PIXEL']).length, 11);
  assert.ok(!botSeats(5, ['pixel']).some((s) => s.name === 'PIXEL'));
  const rng = mulberry32(3);
  let right = 0;
  for (let i = 0; i < 2000; i++) if (botAnswer({ skill: 0.7 }, 2, 4, rng) === 2) right++;
  assert.ok(right > 1300 && right < 1500, String(right));
  const bank = new QuizBank(mulberry32(5));
  for (let i = 0; i < 40; i++) {
    const trio = bank.trio();
    assert.equal(trio.length, 3);
    for (const s of trio) assert.ok(s.q && s.a && typeof s.truth === 'boolean');
  }
  for (let i = 0; i < 300; i++) {
    const s = makeSum(rng, i % 3);
    assert.equal(s.options.length, 3);
    assert.equal(new Set(s.options).size, 3);
    const [a, op, b] = s.text.split(' ');
    const value = op === '+' ? Number(a) + Number(b) : op === '×' ? Number(a) * Number(b) : Number(a) - Number(b);
    assert.equal(s.options[s.correct], value, s.text);
  }
});

// ---------- Trapdoor Royale ----------
function playRoyale({ seed, seats, skill = 0.5, mirror = null }) {
  const e = new RoyaleEngine();
  const rng = mulberry32(seed * 31 + 7);
  const log = [];
  e.on('*', (type, d) => {
    log.push({ type, ...d });
    if (mirror) mirror.hydrate(wire(e.serialize()), 1);
  });
  e.startMatch({ seats, seed });
  let steps = 0;
  while (e.phase !== R_PHASE.CHAMPION) {
    assert.ok(steps++ < 400000, `royale ${seed} did not finish`);
    if (e.phase === R_PHASE.QUESTION) {
      for (const p of e.players) {
        if (!p.isHuman || !p.alive || rng() > 0.04) continue;
        e.moveFor(p.id, rng() < skill ? e.correct : Math.floor(rng() * 4));
        if (rng() < 0.2) e.shoveFor(p.id);
      }
    }
    e.update(0.05);
  }
  return { e, log };
}

test('trapdoor royale: 150 matches end with one champion and every invariant', () => {
  const modes = new Set();
  let mercies = 0;
  let slows = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const people = 1 + (seed % 6);
    const seats = table(people, [0, 3, 6, 11][seed % 4] === 0 && people < 2 ? 2 : Math.min(12 - people, [0, 3, 6, 11][seed % 4] || (people < 2 ? 1 : 0)));
    const { e, log } = playRoyale({ seed, seats, skill: 0.3 + (seed % 5) * 0.12 });
    const n = seats.length;
    assert.equal(e.alive.length, 1, `seed ${seed}`);
    assert.equal(e.ranking.length, n);
    assert.equal(new Set(e.ranking).size, n);
    assert.equal(e.ranking[0], e.alive[0].id);
    let left = n;
    for (const r of log.filter((x) => x.type === 'reveal')) {
      if (r.mercy) { mercies++; assert.equal(r.fallen.length, 0); }
      if (r.slow != null) { slows++; assert.deepEqual(r.fallen, [r.slow]); }
      left -= r.fallen.length;
      assert.ok(left >= 1, `seed ${seed}: the floor never empties`);
    }
    assert.equal(left, 1);
    for (const r of log.filter((x) => x.type === 'round')) {
      modes.add(r.mode);
      assert.equal(r.time, r.mode === 'sudden' ? R_RULES.suddenTime : r.mode === 'speed' ? R_RULES.speedTime : R_RULES.standardTime);
      if (r.mode === 'sudden') assert.ok(r.left <= R_RULES.suddenAt);
    }
    // Nobody moves once the platforms are locked.
    let locked = false;
    for (const x of log) {
      if (x.type === 'lock') locked = true;
      if (x.type === 'round') locked = false;
      if (x.type === 'move') assert.equal(locked, false);
    }
  }
  assert.deepEqual([...modes].sort(), ['speed', 'standard', 'sudden']);
  assert.ok(mercies > 0 && slows > 0, `mercies ${mercies}, slows ${slows}`);
});

test('trapdoor royale: inputs are checked, answers stay secret, mirrors agree', () => {
  const e = new RoyaleEngine();
  e.startMatch({ seats: table(2, 4), seed: 9 });
  assert.equal(e.moveFor(0, 1), false, 'no moving before the question');
  while (e.phase !== R_PHASE.QUESTION) e.update(0.05);
  assert.equal(e.serialize().c, -1, 'the answer is not in the snapshot during a question');
  assert.equal(e.moveFor(0, 7), false);
  assert.equal(e.moveFor(0, 2), true);
  assert.equal(e.moveFor(0, 2), false, 'already there');
  assert.equal(e.moveFor(0, e.correct === 3 ? 0 : 3), true, 'you can change your mind');
  assert.equal(e.shoveFor(0), true);
  assert.equal(e.shoveFor(0), false, 'shoves have a cooldown');
  const m = new RoyaleEngine();
  m.hydrate(wire(e.serialize()), 1);
  assert.equal(m.players[0].choice, e.players[0].choice);
  assert.equal(m.moveFor(1, 0), false, 'a mirror cannot move anyone');
  assert.equal(m.me.id, 1);
  while (e.phase !== R_PHASE.DROP) e.update(0.05);
  assert.equal(e.serialize().c, e.correct, 'the answer is shown once the floor drops');
  assert.equal(e.moveFor(1, 0), false);

  const mirror = new RoyaleEngine();
  const { e: host } = playRoyale({ seed: 4, seats: table(3, 9), mirror });
  mirror.hydrate(wire(host.serialize()), 1);
  assert.deepEqual(mirror.ranking, host.ranking);
  assert.deepEqual(mirror.players.map((p) => p.alive), host.players.map((p) => p.alive));

  // Someone still in the middle when the floor drops goes down with it.
  const idle = new RoyaleEngine();
  idle.startMatch({ seats: table(1, 5), seed: 21 });
  let guard = 0;
  while (idle.players[0].alive && idle.phase !== R_PHASE.CHAMPION && guard++ < 100000) idle.update(0.05);
  assert.equal(idle.players[0].alive, false);
});

// ---------- Last Lamp ----------
function playLamp({ seed, seats, skill = 0.5, mirror = null }) {
  const e = new LampEngine();
  const rng = mulberry32(seed * 17 + 3);
  const log = [];
  e.on('*', (type, d) => {
    log.push({ type, ...d });
    if (mirror) mirror.hydrate(wire(e.serialize()), 1);
    // Secrets never leave before their reveal.
    const s = e.serialize();
    if (s.ph === L_PHASE.QUESTION) { assert.equal(s.c, -1); for (const p of s.pl) assert.ok(p.an == null || p.an === -2); }
    if (s.ph === L_PHASE.SPRINT) assert.equal(s.f.truths, null);
    if (s.mv && s.mv.kind === 'planks' && s.mv.stage !== 'reveal') assert.equal(s.mv.rigged, null);
    if (s.mv && s.mv.kind === 'lifeboat' && s.mv.stage !== 'reveal') assert.deepEqual(s.mv.choices, {});
  });
  e.startMatch({ seats, seed });
  let steps = 0;
  const people = () => e.players.filter((p) => p.isHuman);
  while (e.phase !== L_PHASE.WINNER) {
    assert.ok(steps++ < 600000, `lamp ${seed} did not finish`);
    if (e.phase === L_PHASE.QUESTION) {
      for (const p of people()) if (p.answer == null && rng() < 0.03) e.answerFor(p.id, rng() < skill ? e.correct : (e.correct + 1 + Math.floor(rng() * 3)) % 4);
    } else if (e.phase === L_PHASE.MINI) {
      const v = e.mini.view();
      for (const p of people()) {
        if (rng() > 0.05) continue;
        if (v.kind === 'planks') e.miniFor(p.id, { plank: Math.floor(rng() * v.count) });
        else if (v.kind === 'tide' && v.crew.includes(p.id)) e.miniFor(p.id, { option: rng() < 0.75 ? e.mini.problem[p.id].correct : Math.floor(rng() * 3) });
        else if (v.kind === 'lifeboat') e.miniFor(p.id, { shove: rng() < 0.4 });
        else if (v.kind === 'capstan') e.miniFor(p.id, { spin: rng() < 0.5 });
      }
    } else if (e.phase === L_PHASE.SPRINT) {
      for (const p of people()) {
        if (rng() > 0.06) continue;
        const i = Math.floor(rng() * 3);
        e.markFor(p.id, i, rng() < skill ? e.finale.truths[i] : !e.finale.truths[i]);
      }
    }
    e.update(0.05);
    assert.ok(e.keepers.length >= 1 || e.phase === L_PHASE.SPRINT_RESULT || e.phase === L_PHASE.WINNER, `seed ${seed}: the lamp never goes fully dark`);
    for (const p of e.players) {
      assert.ok(p.flames >= 0 && p.flames <= L_RULES.flames);
      assert.equal(p.ghost, p.flames === 0, `seed ${seed}: a wraith has no flames, a keeper has some`);
    }
  }
  return { e, log };
}

test('last lamp: 150 matches reach the lamp room and keep every invariant', () => {
  const kinds = new Set();
  const outcomes = { steals: 0, drowned: 0, relit: 0, snuffed: 0, mercy: 0, backfired: 0, wraithsAtFinale: 0, rounds: 0, sprints: 0 };
  for (let seed = 1; seed <= 150; seed++) {
    const people = 1 + (seed % 6);
    const seats = table(people, Math.max(people < 2 ? 1 : 0, [0, 2, 5][seed % 3] > 8 - people ? 8 - people : [0, 2, 5][seed % 3]));
    const { e, log } = playLamp({ seed, seats: seats.length < 2 ? table(people, 1) : seats, skill: 0.25 + (seed % 5) * 0.14 });
    const n = e.players.length;
    assert.ok(e.winner != null);
    assert.equal(e.players[e.winner].ghost, false, 'the winner holds a lit lantern');
    assert.equal(e.ranking.length, n);
    assert.equal(e.ranking[0], e.winner);
    assert.ok(e.round <= L_RULES.maxRounds);
    assert.ok(e.finale.sprint >= 1 && e.finale.sprint <= L_RULES.maxSprints);
    outcomes.rounds += e.round;
    outcomes.sprints += e.finale.sprint;
    for (const x of log) {
      if (x.type === 'miniStart') kinds.add(x.kind);
      if (x.type === 'finaleStart') outcomes.wraithsAtFinale += x.wraiths.length;
      if (x.type === 'miniResult') { outcomes.snuffed += x.snuffed.length; if (x.mercy) outcomes.mercy++; }
      if (x.type === 'mini' && x.backfired) outcomes.backfired++;
      if (x.type === 'sprintResult') {
        outcomes.steals += x.steals.length;
        outcomes.drowned += x.drowned.length;
        if (x.relit != null) outcomes.relit++;
        for (const k of Object.values(x.moves)) assert.ok(k >= 0 && k <= 3);
      }
    }
    // Only keepers who answered wrong are sent down.
    const reveals = log.filter((x) => x.type === 'reveal');
    const descents = log.filter((x) => x.type === 'descent');
    assert.ok(descents.length <= reveals.length);
  }
  assert.deepEqual([...kinds].sort(), [...MINI_KINDS].sort(), 'all four survival games get played');
  for (const k of MINI_KINDS) assert.ok(MINI_INFO[k].name);
  assert.ok(outcomes.steals > 0 && outcomes.drowned > 0 && outcomes.snuffed > 0, JSON.stringify(outcomes));
  console.log('last lamp outcomes over 150 matches:', JSON.stringify(outcomes));
});

test('last lamp: a mirror follows the host, and inputs are checked', () => {
  const mirror = new LampEngine();
  const { e } = playLamp({ seed: 12, seats: table(2, 4), mirror });
  mirror.hydrate(wire(e.serialize()), 1);
  assert.equal(mirror.winner, e.winner);
  assert.deepEqual(mirror.players.map((p) => [p.flames, p.ghost, p.step]), e.players.map((p) => [p.flames, p.ghost, p.step]));
  assert.equal(mirror.answerFor(1, 0), false);

  const h = new LampEngine();
  h.startMatch({ seats: table(2, 3), seed: 5 });
  assert.equal(h.answerFor(0, 1), false, 'no answering before the question');
  while (h.phase !== L_PHASE.QUESTION) h.update(0.05);
  assert.equal(h.answerFor(0, 9), false);
  assert.equal(h.answerFor(0, 1), true);
  assert.equal(h.answerFor(0, 2), true, 'you can change your answer until time is up');
  assert.equal(h.markFor(0, 0, true), false, 'no marking outside a sprint');
  assert.equal(h.miniFor(0, { plank: 0 }), false, 'no minigame input outside the Undertow');
  const m = new LampEngine();
  m.hydrate(wire(h.serialize()), 1);
  assert.equal(m.players[0].answer, -2, 'a mirror knows that someone answered, not what');
  assert.equal(m.miniView(), null);
});
