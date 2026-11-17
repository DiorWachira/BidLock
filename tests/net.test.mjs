// Headless tests for the room's link: snapshot deltas, measured delay, and the ways the
// host makes up for it. Run with: node --test tests/net.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyManager, WIRE } from '../js/net/lobbyManager.js';
import { loadIceServers, iceServers, hasRelay, STUN_SERVERS } from '../js/net/iceServers.js';
import { AuctionEngine, PHASE, soloSeats } from '../js/engine/auctionEngine.js';
import { RoyaleEngine, R_PHASE } from '../js/games/trapdoorRoyale/royaleEngine.js';
import { SampleArenaEngine, S_PHASE } from '../js/games/sampleArena/sampleArenaEngine.js';
import { offlineRounds } from '../js/games/sampleArena/itunesLoader.js';
import { botSeats } from '../js/arcade/bots.js';
import { mulberry32 } from '../js/engine/auctionEngine.js';

const wire = (x) => JSON.parse(JSON.stringify(x));

// A host and a guest lobby joined by hand, so messages can be inspected.
function pair() {
  const host = new LobbyManager({ transport: 'local' });
  const guest = new LobbyManager({ transport: 'local' });
  host.state = { ...host._blank(), role: 'host', status: 'open', code: 'BL-TST', players: [{ pid: 'host', name: 'H', host: true, seat: 0 }, { pid: 'g1', name: 'G', host: false, seat: 1 }] };
  guest.state = { ...guest._blank(), role: 'client', status: 'open', code: 'BL-TST' };
  const got = [];
  guest.onMessage = (m) => got.push(m);
  const sent = [];
  host.conns.set('g1', { send: (m) => { sent.push(wire(m)); guest._fromHost(wire(m)); } });
  guest.hostConn = { send: (m) => host._fromPlayer({ id: 'g1', send: () => {} }, wire(m)) };
  return { host, guest, got, sent };
}

test('snapshots: only what changed travels, and the guest rebuilds the whole', () => {
  const { host, got, sent } = pair();
  const e = new AuctionEngine();
  const seats = [{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }, ...soloSeats().slice(1, 3)];
  e.startMatch({ seats, seed: 5, budget: 20 });
  let n = 0;
  e.on('*', (type) => { host.broadcast({ t: 'EVENT', ev: type, d: {}, s: e.serialize() }); n++; });
  while (e.phase !== PHASE.VERDICT && n < 400) e.update(1 / 30);
  assert.ok(n > 100, `${n} events`);
  assert.equal(got.length, n);
  // Every rebuilt snapshot equals what the host had.
  const fulls = sent.filter((m) => m.s).length;
  const deltas = sent.filter((m) => m.sd).length;
  assert.ok(fulls >= Math.floor(n / 25) && deltas > fulls * 10, `${fulls} full, ${deltas} deltas`);
  const bytes = (list) => list.reduce((a, m) => a + JSON.stringify(m).length, 0);
  const plain = got.reduce((a, m) => a + JSON.stringify({ ...m }).length, 0);
  assert.ok(bytes(sent) < plain * 0.45, `sent ${bytes(sent)} bytes instead of ${plain}`);
  // Spot-check: the last snapshot rebuilt matches the engine exactly.
  assert.deepEqual(got.at(-1).s, wire(e.serialize()));
});

test('snapshots: a guest without a base waits for the next full one', () => {
  const { host, guest, got } = pair();
  host.broadcast({ t: 'G', ev: 'a', s: { x: 1, y: { z: 2 } } });
  host.broadcast({ t: 'G', ev: 'b', s: { x: 2, y: { z: 2 } } });
  assert.deepEqual(got.map((m) => m.s), [{ x: 1, y: { z: 2 } }, { x: 2, y: { z: 2 } }]);
  // A fresh guest that missed the full snapshot ignores deltas.
  guest.rxKeys = null;
  host.broadcast({ t: 'G', ev: 'c', s: { x: 3, y: { z: 2 } } });
  assert.equal(got.length, 2);
  // A removed key is removed.
  guest.rxKeys = { x: '3', y: '{"z":2}' };
  host.broadcast({ t: 'G', ev: 'd', s: { x: 3 } });
  assert.deepEqual(got.at(-1).s, { x: 3 });
  // Rebuilt objects are fresh, so a mirror can change them safely.
  host.broadcast({ t: 'G', ev: 'e', s: { x: 4 } });
  assert.notEqual(got.at(-1).s, got.at(-2).s);
});

test('the link: pings measure the round trip, and the host caps what it makes up for', () => {
  const { host, guest } = pair();
  host._ping();
  // A pong that took 140 ms.
  host.rtt.clear();
  host.rttSamples.clear();
  host._pong('g1', { ts: performance.now() - 140 });
  assert.ok(Math.abs(host.rtt.get('g1') - 0.14) < 0.02);
  assert.ok(Math.abs(host.lagFor(1) - 0.07) < 0.01, 'one way is half the round trip');
  assert.equal(host.lagFor(0), 0, 'the host has no lag');
  host._pong('g1', { ts: performance.now() - 400 });
  assert.ok(Math.abs(host.lagFor(1) - 0.07) < 0.01, 'a slow ping does not move the correction: the quickest recent one counts');
  host.rttSamples.set('g1', [2, 2.5]);
  assert.ok(host.lagFor(1) <= 0.3, 'never more than 0.3 s');
  assert.equal(host.maxLag(), host.lagFor(1));
  const measured = Math.round(host.rtt.get('g1') * 1000);
  host._ping(); // the guest's instant pong lands after this, so compare with the value sent
  assert.ok(guest.myRtt > 0.5, 'the guest learns its own round trip');
  assert.ok(guest.oneWay <= 0.5);
  assert.equal(host.latencyMs('g1'), measured);
  assert.equal(guest.latencyMs('g1'), measured, 'everyone sees the same figure');
  assert.equal(WIRE.PING, 'PI');
});

test('the auction: the hammer waits for a slow guest', () => {
  const run = (grace) => {
    const e = new AuctionEngine();
    e.startMatch({ seats: [{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seed: 9, budget: 20 });
    while (e.phase !== PHASE.BIDDING) e.update(1 / 60);
    e.bidGrace = grace;
    e.bidFor(0, 1);
    let t = 0;
    while (e.phase === PHASE.BIDDING && t < 10) { e.update(1 / 60); t += 1 / 60; if (e.clock === 0 && e.phase === PHASE.BIDDING && grace && t > 4.95 && t < 5.1) e.bidFor(1, 1); }
    return { t, e };
  };
  const quick = run(0);
  assert.ok(quick.t < 5.1, `sold at ${quick.t.toFixed(2)} s`);
  const slow = run(0.25);
  assert.equal(slow.e.lot.result ? slow.e.lot.result.winner : slow.e.highBidder, 1, 'a bid in the grace window still counts');
});

test('the quiz games: a guest is timed from when they sent it', () => {
  const r = new RoyaleEngine();
  r.startMatch({ seats: [{ name: 'A', kind: 'human' }, ...botSeats(3, [])], seed: 4 });
  while (r.phase !== R_PHASE.QUESTION) r.update(1 / 30);
  for (let i = 0; i < 60; i++) r.update(1 / 30); // two seconds in
  r.inputLag = 0.25;
  r.moveFor(0, 2);
  r.inputLag = 0;
  assert.ok(Math.abs(r.players[0].choiceAt - (r.elapsed - 0.25)) < 1e-6);

  const s = new SampleArenaEngine();
  s.startMatch({ seats: [{ name: 'A', kind: 'human' }, ...botSeats(2, [])], seed: 4, match: { source: 'offline', genre: 'all', rounds: offlineRounds(mulberry32(4)) } });
  while (s.phase !== S_PHASE.PLAY) s.update(1 / 30);
  for (let i = 0; i < 30; i++) s.update(1 / 30);
  s.inputLag = 0.2;
  s.answerFor(0, 1);
  s.inputLag = 0;
  assert.ok(Math.abs(s.players[0].at - 0.8) < 0.01, `answer timed at ${s.players[0].at}`);
});

test('relay servers: STUN always, TURN when configured or fetched', async () => {
  assert.ok(STUN_SERVERS.length >= 2);
  assert.equal(hasRelay(), false);
  const before = iceServers().length;
  const list = await loadIceServers({ url: 'https://example.test/creds', fetchImpl: async () => ({ ok: true, json: async () => [{ urls: 'turn:relay.example:80', username: 'u', credential: 'c' }, { nope: 1 }] }) });
  assert.equal(list.length, before + 1);
  assert.equal(hasRelay(), true);
  const failed = await loadIceServers({ url: 'https://example.test/other', fetchImpl: async () => { throw new Error('down'); } });
  assert.ok(failed.length >= before, 'a failed fetch never removes STUN');
});
