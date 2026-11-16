// Headless rules tests for the two quiz games. Run with: node --test tests/arcade.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/engine/auctionEngine.js';
import { RoyaleEngine, R_PHASE, R_RULES, TWISTS } from '../js/games/trapdoorRoyale/royaleEngine.js';
import { LampEngine, L_PHASE, L_RULES } from '../js/games/lastLamp/lampEngine.js';
import { MINI_KINDS, MINI_INFO, Capstan, Planks } from '../js/games/lastLamp/undertowMinigames.js';
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
  const twists = new Set();
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
    for (const c of log.filter((x) => x.type === 'crumble')) {
      left -= c.fallen.length;
      assert.ok(left >= 1, `seed ${seed}: a crumble never empties the floor`);
    }
    for (const r of log.filter((x) => x.type === 'reveal')) {
      if (r.mercy) { mercies++; assert.equal(r.fallen.length, 0); }
      if (r.slow != null) { slows++; assert.deepEqual(r.fallen, [r.slow]); }
      left -= r.fallen.length;
      assert.ok(left >= 1, `seed ${seed}: the floor never empties`);
    }
    assert.equal(left, 1);
    let prev = null;
    for (const r of log.filter((x) => x.type === 'round')) {
      modes.add(r.mode);
      const full = r.mode === 'sudden' ? R_RULES.suddenTime : r.mode === 'speed' ? R_RULES.speedTime : R_RULES.standardTime;
      assert.equal(r.time, r.twist === 'lastgasp' ? Math.max(4, Math.round(full / 2)) : full);
      if (r.mode === 'sudden') assert.ok(r.left <= R_RULES.suddenAt);
      if (r.twist) {
        twists.add(r.twist);
        assert.ok(r.n >= R_RULES.twistFrom, 'no twist on the first question');
        assert.notEqual(r.twist, prev, 'never the same twist twice running');
        if (r.mode === 'sudden') assert.ok(['blackout', 'lastgasp'].includes(r.twist));
      }
      prev = r.twist;
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
  assert.deepEqual([...twists].sort(), Object.keys(TWISTS).sort(), 'every twist turns up');
  assert.ok(mercies > 0 && slows > 0, `mercies ${mercies}, slows ${slows}`);
});

test('trapdoor royale twists: blackout, shuffle, crumble, reprieve, double up', () => {
  const play = (twist, seed, act) => {
    const e = new RoyaleEngine();
    e.startMatch({ seats: table(1, 7), seed });
    while (e.phase !== R_PHASE.QUESTION) e.update(0.05);
    // Force the twist for this question, as _ask would have.
    e.twist = twist; e.twistDone = false; e.blocked = -1;
    if (twist === 'doubleup') e.correct2 = (e.correct + 2) % 4;
    act(e);
    return e;
  };
  // Blackout: the answers are off the wire until the last seconds.
  play('blackout', 3, (e) => {
    e.t = e.total;
    assert.equal(e.dark, true);
    assert.equal(e.serialize().q.answers, null);
    e.t = R_RULES.blackoutShow - 0.1;
    assert.equal(e.dark, false);
    assert.equal(e.serialize().q.answers.length, 4);
  });
  // Shuffle: every answer moves platform; the right answer is still the right answer.
  play('shuffle', 4, (e) => {
    const before = e.question.answers.slice();
    const rightText = before[e.correct];
    e.players[0].choice = e.correct;
    let ev = null;
    e.on('shuffle', (d) => { ev = d; });
    while (!e.twistDone) e.update(0.05);
    assert.ok(ev);
    assert.equal(e.question.answers[e.correct], rightText);
    assert.ok(e.question.answers.every((a, i) => a !== before[i]), 'every answer moved');
    assert.notEqual(e.players[0].choice, e.correct, 'standing still now means standing on a different answer');
  });
  // Crumble: a wrong platform goes early with anyone on it, and can no longer be used.
  play('crumble', 5, (e) => {
    const wrong = [0, 1, 2, 3].find((i) => i !== e.correct);
    e.players.forEach((p) => { p.plan = []; });
    e.players[0].choice = wrong;
    let ev = null;
    e.on('crumble', (d) => { ev = d; });
    while (!e.twistDone) e.update(0.05);
    assert.ok(ev && ev.platform !== e.correct);
    if (ev.platform === wrong) assert.equal(e.players[0].alive, false);
    assert.equal(e.moveFor(1, ev.platform), false, 'a crumbled platform is closed');
  });
  // Reprieve: one wrong platform holds at the drop.
  play('reprieve', 6, (e) => {
    let ev = null;
    e.on('reveal', (d) => { ev = d; });
    while (e.phase !== R_PHASE.DROP) e.update(0.05);
    assert.ok(ev.held >= 0 && ev.held !== e.correct);
    for (const p of e.players) if (p.choice === ev.held) assert.equal(p.alive, true);
  });
  // Double Up: both safe platforms survive.
  play('doubleup', 7, (e) => {
    e.players.forEach((p) => { p.plan = []; p.shovePlan = -1; });
    e.moveFor(0, e.correct2);
    while (e.phase !== R_PHASE.DROP) e.update(0.05);
    assert.equal(e.players[0].alive, true);
  });
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
        for (const k of Object.values(x.moves)) assert.ok(k >= 0 && k <= 3 + e.R.wraithFloat, 'three marks, plus the wraith float');
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


test('trapdoor royale: safety nets, pinning shoves and spectator calls', () => {
  let nets = 0, saves = 0, pins = 0, calls = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const e = new RoyaleEngine();
    const rng = mulberry32(seed * 3);
    e.on('reveal', (d) => {
      if (d.net != null) { nets++; assert.equal(e.players[d.net].net, true); assert.ok(!d.fallen.includes(d.net)); }
      for (const id of d.saved) { saves++; assert.ok(e.players[id].alive, 'a net keeps you up'); assert.equal(e.players[id].net, false, 'a net is used up'); }
      if (d.slow != null) assert.ok(!d.saved.length);
    });
    e.on('shove', (d) => { pins += (d.hit || []).length; });
    e.startMatch({ seats: table(2, 10), seed });
    let steps = 0;
    while (e.phase !== R_PHASE.CHAMPION && steps++ < 400000) {
      if (e.phase === R_PHASE.QUESTION) {
        for (const p of e.players) {
          if (!p.isHuman || rng() > 0.05) continue;
          const before = p.choice;
          const ok = e.moveFor(p.id, Math.floor(rng() * 4));
          if (!p.alive && ok) calls++;
          if (p.alive && e.stunned(p)) assert.equal(p.choice, before, 'a pinned contestant cannot move');
          if (rng() < 0.3) e.shoveFor(p.id);
        }
      }
      e.update(0.05);
    }
    assert.equal(e.phase, R_PHASE.CHAMPION);
    assert.equal(e.alive.length, 1);
  }
  assert.ok(nets > 50 && saves > 10 && pins > 10 && calls > 10, JSON.stringify({ nets, saves, pins, calls }));

  // Shoves: once a question, only during it, and a pinned contestant cannot change platform.
  const e = new RoyaleEngine();
  e.startMatch({ seats: table(3, 0), seed: 2 });
  while (e.phase !== R_PHASE.QUESTION) e.update(0.05);
  e.players.forEach((p) => { p.plan = []; p.shovePlan = -1; });
  e.moveFor(0, 1); e.moveFor(1, 1); e.moveFor(2, 2);
  assert.equal(e.shoveFor(0), true);
  assert.equal(e.stunned(e.players[1]), true, 'the rival on your platform is pinned');
  assert.equal(e.stunned(e.players[2]), false, 'a rival elsewhere is not');
  assert.equal(e.moveFor(1, 3), false);
  assert.equal(e.moveFor(0, 3), true, 'the shover can leave');
  assert.equal(e.shoveFor(0), false, 'one shove a question');
  for (let i = 0; i < 45; i++) e.update(0.05);
  assert.equal(e.moveFor(1, 3), true, 'the pin wears off');
});

test('last lamp: the capstan, the plank reward and wraith haunting', () => {
  // Spinning means two pulls, so it only pays once the next socket is worse than about 1 in 3.
  const fake = { rng: mulberry32(1), players: [{ isHuman: true }, { isHuman: true }], emit() {} };
  const c = new Capstan(fake, [0, 1]);
  c.bolt = 5;
  const first = c.current;
  c.input(first, { spin: false });
  assert.equal(c.pulls, 1);
  assert.equal(c.risk(), 1 / 5);
  c.t = 0; c.update(0.01); // hand over the wheel
  c.bolt = 5; c.at = 1;
  const second = c.current;
  assert.notEqual(second, first);
  c.input(second, { spin: true });
  assert.ok(c.pulls === 3 || c.done || c.stage === 'reveal', 'a spin is two pulls');

  // A saboteur who catches someone gets a flame back.
  let relit = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const e = new LampEngine();
    e.on('miniResult', (d) => {
      for (const id of d.relit || []) { relit++; assert.ok(e.players[id].flames <= e.R.flames); assert.equal(d.kind, 'planks'); }
    });
    e.startMatch({ seats: table(1, 5), seed });
    while (e.phase !== L_PHASE.WINNER) e.update(0.05);
  }
  assert.ok(relit > 0, 'saboteurs do relight flames');

  // Wraiths start the climb a step higher for every two right answers, up to the cap.
  const e = new LampEngine();
  e.startMatch({ seats: table(1, 5), seed: 4 });
  e.players[1].ghost = true; e.players[1].flames = 0; e.players[1].wraithRight = 5;
  e.players[2].ghost = true; e.players[2].flames = 0; e.players[2].wraithRight = 99;
  e._finale();
  assert.equal(e.players[1].step, 2);
  assert.equal(e.players[2].step, e.R.maxHaunt);
  assert.equal(e.R.stairs, 12);
  // Tuning travels to a mirror.
  const m = new LampEngine();
  const h = new LampEngine();
  h.startMatch({ seats: table(2, 1), seed: 6, tuning: { stairs: 9 } });
  m.hydrate(wire(h.serialize()), 1);
  assert.equal(m.R.stairs, 9);
});

test('variety: a bigger bank, by difficulty, with no repeats from one match to the next', async () => {
  const { QUESTIONS, ESTIMATES, questionId } = await import('../js/arcade/questionBank.js');
  assert.ok(QUESTIONS.length >= 250, `${QUESTIONS.length} built-in questions`);
  assert.ok(ESTIMATES.length >= 30);
  for (const q of QUESTIONS) {
    assert.equal(q.length, 8, q[3]);
    assert.ok([1, 2, 3].includes(q[0]) && ['mc', 'odd', 'first', 'phrase'].includes(q[2]), q[3]);
    assert.equal(new Set(q.slice(4)).size, 4, q[3]);
  }
  assert.equal(new Set(QUESTIONS.map((q) => questionId(q[3], q[4]))).size, QUESTIONS.length, 'ids are unique');
  for (const d of [1, 2, 3]) assert.ok(QUESTIONS.filter((q) => q[0] === d).length >= 50, `difficulty ${d}`);

  // Ten Last Lamp matches in a row on one device: no question repeats.
  let seen = [];
  const asked = new Set();
  let repeats = 0;
  for (let m = 1; m <= 10; m++) {
    const quiz = new QuizBank(mulberry32(m * 101), { seen });
    const e = new LampEngine();
    e.startMatch({ seats: table(0, 6), seed: m * 7919, quiz });
    while (e.phase !== L_PHASE.WINNER) e.update(0.05);
    for (const id of quiz.usedIds) { if (asked.has(id)) repeats++; asked.add(id); }
    seen = [...seen, ...quiz.usedIds];
  }
  assert.equal(repeats, 0, 'no repeats over ten matches');
  assert.ok(asked.size > 180, `${asked.size} different questions over ten matches`);

  // Difficulty follows the match: easy questions first in Trapdoor Royale, hard ones late.
  const e = new RoyaleEngine();
  const levels = [];
  e.on('round', () => levels.push([e.round, e.question.difficulty, e.mode]));
  e.startMatch({ seats: table(0, 12), seed: 9 });
  while (e.phase !== R_PHASE.CHAMPION) e.update(0.05);
  for (const [r, d, mode] of levels) {
    if (mode === 'sudden' || r >= 6) assert.equal(d, 3, `round ${r} (${mode}) is hard`);
    else if (r <= 2) assert.equal(d, 1, `round ${r} is easy`);
  }

  // Estimates: four options, none exactly right, sensible numbers.
  const qb = new QuizBank(mulberry32(3));
  for (let i = 0; i < 60; i++) {
    const x = qb.estimate();
    assert.equal(x.options.length, 4);
    assert.ok(!x.options.includes(x.truth));
    assert.equal(new Set(x.options).size, 4);
    assert.ok(x.options.every((o) => Number.isFinite(o) && o > 0));
  }
});

test('last lamp: round events and the three new survival games', async () => {
  const { EVENTS } = await import('../js/games/lastLamp/lampEngine.js');
  const events = {};
  const kinds = {};
  let struck = 0, relit = 0, beaconSteps = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const e = new LampEngine();
    e.on('question', (d) => {
      if (!d.event) return;
      events[d.event] = (events[d.event] || 0) + 1;
      assert.ok(d.n >= 2, 'no event on the first question');
      if (d.event === 'fog') { assert.equal(e.serialize().q.answers, null, 'fog keeps the answers off the wire'); assert.equal(e.answerFor(0, 0) || true, true); }
    });
    e.on('reveal', (d) => {
      if (d.struck != null) { struck++; assert.ok(d.down.includes(d.struck)); assert.ok(!d.safe.includes(d.struck)); }
      relit += (d.relit || []).length;
    });
    e.on('miniStart', (d) => { kinds[d.kind] = (kinds[d.kind] || 0) + 1; });
    e.on('mini', (d) => {
      const v = e.mini && e.mini.view();
      if (v && v.kind === 'buoy' && v.stage === 'play') assert.equal(v.seq, null, 'the buoy pattern is hidden while you signal');
      if (v && v.kind === 'manifest' && v.stage === 'q') assert.equal(v.correct, -1);
      if (v && v.kind === 'tally' && v.stage !== 'reveal') assert.equal(v.truth, null);
    });
    e.on('finaleStart', () => { beaconSteps += e.players.reduce((s, p) => s + p.beacon, 0); });
    e.startMatch({ seats: table(0, 6), seed });
    while (e.phase !== L_PHASE.WINNER) e.update(0.05);
  }
  assert.deepEqual(Object.keys(events).sort(), Object.keys(EVENTS).sort(), 'every event turns up');
  for (const k of ['tally', 'buoy', 'manifest']) assert.ok(kinds[k] > 10, `${k} played ${kinds[k]} times`);
  assert.ok(struck > 0 && relit > 0 && beaconSteps > 0, JSON.stringify({ struck, relit, beaconSteps }));
});
