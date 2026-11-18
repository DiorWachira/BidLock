// The room server (server/) and the game's side of it (js/net/relayTransport.js), for
// real: the Worker runs in Cloudflare's local runtime (wrangler dev) and the lobbies run
// here in Node, talking to it over WebSockets. Run with: node --test tests/rooms.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startRoomServer } from './roomServer.mjs';
import { LobbyManager, AutoTransport, MAX_PLAYERS } from '../js/net/lobbyManager.js';
import { RelayTransport, relayBase, relayHealthUrl } from '../js/net/relayTransport.js';
import { roomServerUrl, ROOM_SERVER } from '../js/net/roomServer.js';
import { explain } from '../js/net/netCheck.js';

const GUEST_GRACE = 2500;
const HOST_GRACE = 7000;
let rooms;
before(async () => { rooms = await startRoomServer({ vars: { GUEST_GRACE_MS: GUEST_GRACE, HOST_GRACE_MS: HOST_GRACE } }); });
after(async () => { if (rooms) await rooms.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(25); }
  return !!fn();
}

// Fresh room codes and identities for every test.
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let serial = 0;
const code = () => { const n = ++serial; return `BL-${ABC[(n >> 10) % 32]}${ABC[(n >> 5) % 32]}${ABC[n % 32]}`; };
const who = (p) => `${p}${String(++serial).padStart(6, '0')}`;
const secret = () => `Key${String(++serial).padStart(20, '0')}`;

// A raw socket that records everything it gets.
function sock(room, q) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${rooms.ws}/room/${room}?${q}`);
    const s = { ws, got: [], closed: null };
    ws.onmessage = (e) => s.got.push(e.data);
    ws.onclose = (e) => { s.closed = e.code; resolve(s); };
    ws.onopen = () => resolve(s);
  });
}
const hostSock = (room, id = who('host'), key = secret(), resume = false) => sock(room, `role=host&id=${id}&key=${key}${resume ? '&resume=1' : ''}`).then((s) => Object.assign(s, { id, key }));
const guestSock = (room, id = who('gst'), key = secret(), resume = false) => sock(room, `role=guest&id=${id}&key=${key}${resume ? '&resume=1' : ''}`).then((s) => Object.assign(s, { id, key }));
const ctl = (s) => s.got.filter((f) => f.startsWith('!')).map((f) => JSON.parse(f.slice(1)));
// Just these fields of an object (the "ok" also carries counts and the room's epoch).
const only = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
const data = (s) => s.got.filter((f) => !f.startsWith('!'));
// Why the server closed a socket: it says so in a last message, before the close itself
// (which can take seconds to arrive).
const NEWS = new Set(['ok', 'join', 'leave', 'away', 'back']);
async function said(s, ms = 6000) {
  await until(() => ctl(s).some((c) => !NEWS.has(c.k)), ms);
  const c = ctl(s).filter((x) => !NEWS.has(x.k)).at(-1);
  return c ? c.k : null;
}

// An upgrade request with a chosen Origin, to see what the Worker answers.
function upgrade(path, origin) {
  return new Promise((resolve) => {
    const req = http.request(`${rooms.http}${path}`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...(origin ? { Origin: origin } : {}) } });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

test('the server: health check, and only BidLock pages may open rooms', async () => {
  const res = await fetch(`${rooms.http}/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { ok: true, service: 'bidlock-rooms', v: 1 });
  const q = `?role=host&id=${who('host')}&key=${secret()}`;
  assert.equal(await upgrade(`/room/${code()}${q}`, 'https://diorwachira.github.io'), 101, 'the live site');
  assert.equal(await upgrade(`/room/${code()}${q}`, 'http://localhost:5173'), 101, 'local development');
  assert.equal(await upgrade(`/room/${code()}${q}`, 'https://some-other-site.example'), 403, 'another web page');
  assert.equal(await upgrade(`/room/BL-I0O${q}`, null), 400, 'not a room code');
  assert.equal((await fetch(`${rooms.http}/room/${code()}`)).status, 426, 'not a WebSocket');
  assert.equal((await fetch(`${rooms.http}/nope`)).status, 404);
});

test('the server: hosting, joining and passing messages', async () => {
  const room = code();
  const host = await hostSock(room);
  await until(() => ctl(host).length);
  assert.deepEqual(only(ctl(host)[0], ['k', 'resumed', 'guests', 'rcvd', 'got']), { k: 'ok', resumed: false, guests: [], rcvd: 0, got: 0 });
  assert.match(ctl(host)[0].epoch, /^[0-9a-f]{8}$/);
  // The code is taken; a room nobody hosts does not exist; nonsense is refused.
  const thief = await hostSock(room);
  assert.equal(await said(thief), 'taken');
  const lost = await guestSock(code());
  assert.equal(await said(lost), 'no-room');
  const bad = await sock(room, 'role=guest&id=X&key=short');
  assert.equal(await said(bad), 'bad-request');

  const a = await guestSock(room);
  const b = await guestSock(room);
  await until(() => ctl(host).filter((c) => c.k === 'join').length === 2);
  assert.deepEqual(ctl(host).filter((c) => c.k === 'join').map((c) => c.id), [a.id, b.id]);
  assert.deepEqual(only(ctl(a)[0], ['k', 'resumed', 'away']), { k: 'ok', resumed: false, away: false });
  // Player -> host, labelled with who sent it.
  a.ws.send('{"t":"HELLO","name":"ALPHA"}');
  await until(() => data(host).length === 1);
  assert.equal(data(host)[0], `${a.id}\n{"t":"HELLO","name":"ALPHA"}`);
  // Host -> one player, and one frame for two.
  host.ws.send(`${a.id}\n{"t":"LOBBY","you":"a"}`);
  host.ws.send(`${a.id},${b.id}\n{"t":"GT","ck":5}`);
  await until(() => data(a).length === 2 && data(b).length === 1);
  assert.deepEqual(data(a), ['{"t":"LOBBY","you":"a"}', '{"t":"GT","ck":5}']);
  assert.deepEqual(data(b), ['{"t":"GT","ck":5}']);
  // Players have no say over the room.
  b.ws.send(`!close ${a.id}`);
  await sleep(200);
  assert.equal(await said(a, 200), null);
  // The host removes a player; a player leaves on purpose.
  host.ws.send(`!close ${a.id}`);
  assert.equal(await said(a), 'removed');
  b.ws.close(4000, 'bye');
  await until(() => ctl(host).some((c) => c.k === 'leave'));
  assert.deepEqual(ctl(host).filter((c) => c.k === 'leave'), [{ k: 'leave', id: b.id }], 'only the player who left on their own is reported');
  // The host leaves: the room closes for everyone.
  const c = await guestSock(room);
  await until(() => ctl(c).length);
  host.ws.close(4000, 'bye');
  assert.equal(await said(c), 'closed');
  const late = await guestSock(room);
  assert.equal(await said(late), 'no-room', 'and the code is free again');
});

test('the server: ten places, so the host can turn the seventh away politely', async () => {
  const room = code();
  const host = await hostSock(room);
  const guests = [];
  for (let i = 0; i < 10; i++) guests.push(await guestSock(room));
  await until(() => guests.every((g) => ctl(g).length));
  assert.ok(guests.every((g) => ctl(g)[0].k === 'ok'));
  const extra = await guestSock(room);
  assert.equal(await said(extra), 'full');
  host.ws.close(4000);
});

test('the server: a player who drops reconnects and gets what they missed', async () => {
  const room = code();
  const host = await hostSock(room);
  const a = await guestSock(room);
  await until(() => ctl(host).some((c) => c.k === 'join'));
  a.ws.close(3001, 'drop');
  await sleep(200);
  for (let i = 1; i <= 3; i++) host.ws.send(`${a.id}\n{"n":${i}}`);
  await sleep(150);
  // Someone else cannot take the seat.
  const fake = await guestSock(room, a.id, secret(), true);
  assert.equal(await said(fake), 'refused');
  const back = await guestSock(room, a.id, a.key, true);
  await until(() => data(back).length === 3);
  assert.deepEqual(only(ctl(back)[0], ['k', 'resumed', 'away']), { k: 'ok', resumed: true, away: false });
  assert.deepEqual(data(back), ['{"n":1}', '{"n":2}', '{"n":3}'], 'in order');
  assert.ok(!ctl(host).some((c) => c.k === 'leave'), 'the host never noticed');
  host.ws.close(4000);
});

test('the server: after a silent drop, what went missing is sent again', async () => {
  const room = code();
  const host = await hostSock(room);
  const a = await guestSock(room);
  await until(() => ctl(a).length && ctl(host).some((c) => c.k === 'join'));
  const epoch = ctl(a)[0].epoch;
  for (let i = 1; i <= 5; i++) host.ws.send(`${a.id}\n{"n":${i}}`);
  a.ws.send('{"t":"one"}');
  a.ws.send('{"t":"two"}');
  await until(() => data(a).length === 5 && data(host).length === 2);
  // Say only three arrived (two went into a socket that had died): the last two come again.
  const again = await sock(room, `role=guest&id=${a.id}&key=${a.key}&resume=1&got=3&epoch=${epoch}`);
  await until(() => data(again).length === 2);
  const ok = ctl(again)[0];
  assert.equal(ok.got, 3, 'resending starts after the third');
  assert.equal(ok.rcvd, 2, 'and the room says it has both of the player\'s messages');
  assert.deepEqual(data(again), ['{"n":4}', '{"n":5}']);
  // A different epoch (the room restarted): nothing to resend, counting starts again.
  const fresh = await sock(room, `role=guest&id=${a.id}&key=${a.key}&resume=1&got=3&epoch=00000000`);
  await until(() => ctl(fresh).length);
  assert.deepEqual(only(ctl(fresh)[0], ['got', 'rcvd']), { got: 0, rcvd: 0 });
  await sleep(150);
  assert.equal(data(fresh).length, 0);
  host.ws.close(4000);
});

test('the server: a player who does not come back is let go', async () => {
  const room = code();
  const host = await hostSock(room);
  const a = await guestSock(room);
  await until(() => ctl(host).some((c) => c.k === 'join'));
  a.ws.close(3001, 'drop');
  assert.ok(await until(() => ctl(host).some((c) => c.k === 'leave' && c.id === a.id), GUEST_GRACE + 4000));
  const late = await guestSock(room, a.id, a.key, true);
  assert.equal(await said(late), 'gone');
  host.ws.close(4000);
});

test('the server: the host drops and comes back; players and their messages wait', async () => {
  const room = code();
  const host = await hostSock(room);
  const a = await guestSock(room);
  await until(() => ctl(host).some((c) => c.k === 'join'));
  host.ws.close(3001, 'drop');
  await until(() => ctl(a).some((c) => c.k === 'away'));
  assert.ok(ctl(a).some((c) => c.k === 'away'), 'players are told');
  a.ws.send('{"t":"PLACE_BID"}');
  const b = await guestSock(room); // arriving while the host is away
  await until(() => ctl(b).length);
  assert.deepEqual(only(ctl(b)[0], ['k', 'resumed', 'away']), { k: 'ok', resumed: false, away: true });
  b.ws.send('{"t":"HELLO","name":"B"}');
  await sleep(150);
  const back = await hostSock(room, host.id, host.key, true);
  await until(() => back.got.length >= 4);
  assert.deepEqual(only(ctl(back)[0], ['k', 'resumed', 'guests']), { k: 'ok', resumed: true, guests: [a.id, b.id] });
  assert.deepEqual(back.got.slice(1), [`${a.id}\n{"t":"PLACE_BID"}`, `!{"k":"join","id":"${b.id}"}`, `${b.id}\n{"t":"HELLO","name":"B"}`]);
  await until(() => ctl(a).some((c) => c.k === 'back'));
  assert.ok(ctl(a).some((c) => c.k === 'back'));
  back.ws.close(4000);
});

test('the server: a host who never comes back closes the room', async () => {
  const room = code();
  const host = await hostSock(room);
  const a = await guestSock(room);
  await until(() => ctl(a).length);
  host.ws.close(3001, 'drop');
  assert.equal(await said(a, HOST_GRACE + 4000), 'closed');
  const late = await hostSock(room, host.id, host.key, true);
  assert.equal(await said(late), 'gone');
});

// ---------- the game's side: whole lobbies through the room server ----------
function lobby(extra = {}) {
  const got = [];
  const l = new LobbyManager({ transport: 'relay', relayUrl: rooms.ws, onMessage: (m) => got.push(m), ...extra });
  l.got = got;
  return l;
}

test('six players in one room, through the room server', async () => {
  const host = lobby();
  const roomCode = await host.create('Host');
  assert.equal(host.state.via, 'relay');
  const guests = Array.from({ length: MAX_PLAYERS - 1 }, () => lobby());
  await Promise.all(guests.map((g, i) => g.join(`Guest ${i + 1}`, roomCode)));
  assert.equal(host.state.players.length, MAX_PLAYERS);
  assert.ok(guests.every((g) => g.state.status === 'open' && g.state.via === 'relay'));
  await until(() => guests.every((g) => g.state.players.length === MAX_PLAYERS));
  assert.ok(guests.every((g) => g.state.players.length === MAX_PLAYERS), 'everyone sees everyone');
  // The seventh is turned away by the host, with a reason.
  const seventh = lobby();
  await assert.rejects(seventh.join('Late', roomCode), /full/);
  // A broadcast reaches everybody, sent once.
  const frames = [];
  const send = host.transport.link.send.bind(host.transport.link);
  host.transport.link.send = (f) => { frames.push(f); send(f); };
  host.broadcast({ t: 'G', ev: 'hello', s: { round: 1 } });
  host.transport.link.send = send;
  assert.equal(frames.length, 1, 'one frame for five players');
  await until(() => guests.every((g) => g.got.some((m) => m.ev === 'hello')));
  assert.ok(guests.every((g) => g.got.find((m) => m.ev === 'hello').s.round === 1));
  // Pings measure everyone's delay.
  await until(() => host.rtt.size === MAX_PLAYERS - 1, 5000);
  assert.equal(host.rtt.size, MAX_PLAYERS - 1);
  // Inputs reach the host from the right seat.
  const inputs = [];
  host.onInput = (seat, msg) => inputs.push([seat, msg.t]);
  guests[2].send({ t: 'GI', a: 1 });
  await until(() => inputs.length);
  assert.deepEqual(inputs, [[3, 'GI']]);

  // The host's connection drops mid-match and comes back by itself.
  host.beginMatch({});
  host.transport.link._drop();
  await until(() => guests.every((g) => g.state.hostAway));
  assert.ok(guests.every((g) => g.state.hostAway), 'players see HOST AWAY');
  host.broadcast({ t: 'G', ev: 'during', s: { round: 2 } }); // sent while reconnecting: held, then delivered
  await until(() => guests.every((g) => !g.state.hostAway), 8000);
  assert.ok(guests.every((g) => !g.state.hostAway), 'and see the host come back');
  await until(() => guests.every((g) => g.got.some((m) => m.ev === 'during')));
  assert.ok(guests.every((g) => g.got.some((m) => m.ev === 'during')), 'nothing the host sent was lost');
  assert.equal(host.state.players.filter((p) => !p.away).length, MAX_PLAYERS, 'nobody was dropped');

  // A player drops and comes back, and catches up on what they missed.
  const g = guests[0];
  g.transport.link._drop();
  host.broadcast({ t: 'G', ev: 'missed-1', s: { round: 3 } });
  host.broadcast({ t: 'G', ev: 'missed-2', s: { round: 4 } });
  await until(() => g.got.some((m) => m.ev === 'missed-2'), 8000);
  assert.deepEqual(g.got.filter((m) => /^missed/.test(m.ev)).map((m) => m.ev), ['missed-1', 'missed-2']);
  assert.equal(g.state.status, 'open');
  assert.ok(!host.state.players.some((p) => p.away), 'their seat was kept');

  // A player leaves on purpose: the host knows at once.
  guests[4].leave();
  await until(() => host.state.players.some((p) => p.away));
  assert.ok(host.state.players.some((p) => p.away), 'their seat stops acting');

  // The host leaves: everyone is told.
  const closed = [];
  guests.slice(0, 4).forEach((x, i) => { x.onClosed = () => closed.push(i); });
  host.leave();
  await until(() => closed.length === 4);
  assert.equal(closed.length, 4);
  assert.ok(guests.slice(0, 4).every((x) => x.state.error === 'The host closed the room.'));
  seventh.leave();
});

// A socket that has died without closing: nothing it sends arrives, nothing reaches it.
function deafen(link) {
  const ws = link.ws;
  ws.onmessage = null;
  ws.send = () => {};
}

test('silent drops lose nothing, either way', async () => {
  const host = lobby();
  const inputs = [];
  host.onInput = (seat, m) => inputs.push(m.n);
  const roomCode = await host.create('Host');
  const g = lobby();
  await g.join('Guest', roomCode);
  host.beginMatch({});
  // The player's connection dies quietly: the host's messages and the player's input vanish.
  deafen(g.transport.link);
  host.broadcast({ t: 'G', ev: 'lost-1' });
  host.broadcast({ t: 'G', ev: 'lost-2' });
  g.send({ t: 'GI', a: 'x', n: 1 });
  await sleep(300);
  assert.ok(!g.got.some((m) => m.ev === 'lost-1') && inputs.length === 0, 'really lost');
  g.transport.link._drop(); // the heartbeat notices, and the player reconnects
  await until(() => g.got.some((m) => m.ev === 'lost-2') && inputs.length === 1);
  assert.deepEqual(g.got.filter((m) => /^lost/.test(m.ev)).map((m) => m.ev), ['lost-1', 'lost-2'], 'the host\'s messages, once each, in order');
  assert.deepEqual(inputs, [1], 'the player\'s input, once');
  // Now the host's connection dies quietly.
  deafen(host.transport.link);
  g.send({ t: 'GI', a: 'x', n: 2 });
  host.broadcast({ t: 'G', ev: 'lost-3' });
  await sleep(300);
  host.transport.link._drop();
  await until(() => inputs.length === 2 && g.got.some((m) => m.ev === 'lost-3'));
  assert.deepEqual(inputs, [1, 2]);
  assert.equal(g.got.filter((m) => m.ev === 'lost-3').length, 1);
  // And once more each way, to be sure the counts still agree after resending.
  deafen(g.transport.link);
  host.broadcast({ t: 'G', ev: 'lost-4' });
  g.send({ t: 'GI', a: 'x', n: 3 });
  await sleep(200);
  g.transport.link._drop();
  await until(() => inputs.length === 3 && g.got.some((m) => m.ev === 'lost-4'));
  assert.deepEqual(inputs, [1, 2, 3]);
  assert.equal(g.got.filter((m) => /^lost/.test(m.ev)).length, 4, 'no repeats');
  g.leave();
  host.leave();
});

test('a player who arrives while the host is away waits at the door', async () => {
  const host = lobby();
  const roomCode = await host.create('Host');
  // The host's phone loses the connection, and cannot reconnect for a few seconds.
  const url = host.transport.link.url;
  host.transport.link.url = 'ws://127.0.0.1:9/room/x';
  host.transport.link._drop();
  const progress = [];
  const g = lobby();
  const joining = g.join('Late', roomCode, { onProgress: (n, of, why) => progress.push(why) });
  await sleep(4600);
  assert.equal(g.state.status, 'connecting', 'still waiting, not timed out');
  assert.ok(progress.includes('host-away'), 'and told why');
  host.transport.link.url = url;
  await joining;
  assert.equal(g.state.status, 'open');
  assert.equal(host.state.players.length, 2);
  g.leave();
  host.leave();
});

test('the room server out of reach: a clear error, quickly', async () => {
  const t = new RelayTransport('ws://127.0.0.1:9');
  const started = Date.now();
  await assert.rejects(t.join('BL-AAA'), (err) => err.code === 'unreachable');
  assert.ok(Date.now() - started < 5000);
  t.close();
  const none = new RelayTransport('ws://127.0.0.1:9');
  await assert.rejects(none.host('BL-AAA', () => {}), (err) => err.code === 'unreachable');
  none.close();
  // A room the server does not know.
  const nobody = new RelayTransport(rooms.ws);
  await assert.rejects(nobody.join(code()), (err) => err.code === 'no-room' && /No room with the code/.test(err.message));
  nobody.close();
});

// ---------- the fallback, with stand-in transports ----------
function fakes({ relayHost, relayJoin, peerHost, peerJoin }) {
  const calls = [];
  const relay = { link: null, host: async () => { calls.push('relay.host'); return relayHost(); }, join: async () => { calls.push('relay.join'); return relayJoin(); }, close: () => calls.push('relay.close'), sendMany: () => {} };
  const peer = { host: async () => { calls.push('peer.host'); return peerHost(); }, join: async (c, opts) => { calls.push(`peer.join${opts && opts.attempts ? `:${opts.attempts}` : ''}`); return peerJoin(); }, close: () => calls.push('peer.close') };
  return { calls, t: new AutoTransport('wss://x', { relay, peer }) };
}
const refuse = (code) => Object.assign(new Error(code), { code });

test('fallback: the room server first, direct connections when it cannot help', async () => {
  // Hosting: on the server, and on PeerJS in the background.
  let f = fakes({ relayHost: async () => {}, peerHost: () => new Promise(() => {}) });
  await f.t.host('BL-AAA', () => {});
  assert.equal(f.t.via, 'relay');
  assert.deepEqual(f.calls, ['relay.host', 'peer.host'], 'does not wait for PeerJS');
  // The server out of reach: PeerJS only.
  f = fakes({ relayHost: async () => { throw refuse('unreachable'); }, peerHost: async () => {} });
  await f.t.host('BL-AAA', () => {});
  assert.equal(f.t.via, 'peer');
  // The code is taken on the server: try another code.
  f = fakes({ relayHost: async () => { const e = new Error('taken'); e.code = 'taken'; throw e; }, peerHost: async () => {} });
  await assert.rejects(f.t.host('BL-AAA', () => {}), /taken/);
  assert.ok(!f.calls.includes('peer.host'));
  // Joining through the server.
  f = fakes({ relayJoin: async () => ({ id: 'host', via: 'relay' }) });
  assert.equal((await f.t.join('BL-AAA')).via, 'relay');
  assert.ok(!f.calls.some((c) => c.startsWith('peer.join')));
  // The server is out of reach from here: straight to PeerJS, with all its patience.
  f = fakes({ relayJoin: async () => { throw refuse('unreachable'); }, peerJoin: async () => ({ id: 'host' }) });
  await f.t.join('BL-AAA');
  assert.equal(f.t.via, 'peer');
  assert.ok(f.calls.includes('peer.join'));
  // The server does not know the room (its host could not reach it): a short try on PeerJS.
  f = fakes({ relayJoin: async () => { throw refuse('no-room'); }, peerJoin: async () => ({ id: 'host' }) });
  await f.t.join('BL-AAA');
  assert.ok(f.calls.includes('peer.join:2'));
  // A full room is full either way.
  f = fakes({ relayJoin: async () => { throw refuse('full'); }, peerJoin: async () => ({}) });
  await assert.rejects(f.t.join('BL-AAA'), /full/);
  assert.ok(!f.calls.some((c) => c.startsWith('peer.join')));
  // Both fail: the direct error, saying the server was out of reach too.
  f = fakes({ relayJoin: async () => { throw refuse('unreachable'); }, peerJoin: async () => { throw new Error('Joining timed out.'); } });
  await assert.rejects(f.t.join('BL-AAA'), /room server could not be reached/);
});

test('settings: where the room server is, and what the check says about it', () => {
  assert.equal(relayBase('https://rooms.example.workers.dev/'), 'wss://rooms.example.workers.dev');
  assert.equal(relayBase('ws://127.0.0.1:8787'), 'ws://127.0.0.1:8787');
  assert.equal(relayBase('not a url'), null);
  assert.equal(relayHealthUrl('wss://rooms.example.workers.dev'), 'https://rooms.example.workers.dev/health');
  assert.equal(roomServerUrl('?rooms=ws://127.0.0.1:8787'), 'ws://127.0.0.1:8787');
  assert.equal(roomServerUrl('?rooms=off'), '');
  assert.equal(roomServerUrl('?rooms=javascript:alert(1)'), ROOM_SERVER, 'only web addresses');
  assert.equal(roomServerUrl(''), ROOM_SERVER);
  const base = { webrtc: true, host: 1, mdns: 1, srflx: 0, relay: 0, relayTcp: 0, signalling: 'ok', errors: [], relayConfigured: false, ms: 900 };
  const ok = explain({ ...base, rooms: 'ok' });
  assert.equal(ok.verdict, 'ok', 'the room server makes a strict network fine');
  assert.ok(/room server can be reached/.test(ok.lines[0]) && ok.fix === '');
  const blocked = explain({ ...base, rooms: 'blocked', srflx: 1 });
  assert.equal(blocked.verdict, 'warn');
  assert.ok(/cannot be reached/.test(blocked.lines[0]) && /shield/.test(blocked.fix));
  assert.equal(explain({ ...base, rooms: 'none' }).verdict, 'relay', 'without a room server, as before');
});
