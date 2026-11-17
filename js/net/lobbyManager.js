// BIDLOCK 2.0 — room-code multiplayer.
//
// One player hosts. Their browser runs the only real auction engine and is the single
// source of truth. Everyone else connects straight to the host over a WebRTC data
// channel (PeerJS, using its free public signalling server), sends small input messages,
// and receives each engine event with a snapshot of the match.
//
// There is no server of ours anywhere: the site stays 100% static.
//
// Host -> everyone:  NEW_LOT, BID_PLACED, TIMER_TICK, LOT_SOLD, TRIVIA_STEAL_TRIGGERED,
//                    HEIST_ACTION, FINAL_RESULTS, EVENT (everything else), LOBBY, START
// Player -> host:    PLACE_BID, PASS, SUBMIT_TRIVIA_ANSWER, STEAL_TARGET,
//                    DOUBLE_OR_NOTHING_CHOICE, VAULT_LOCK, DONE, EMOTE

import { PERSONAS } from '../engine/aiBidders.js';
import { GAMES, gameById } from '../arcade/games.js';
import { botSeats } from '../arcade/bots.js';
import { iceServers, hasRelay, loadIceServers } from './iceServers.js';

export const WIRE = Object.freeze({
  // host -> players
  NEW_LOT: 'NEW_LOT',
  BID_PLACED: 'BID_PLACED',
  TIMER_TICK: 'TIMER_TICK',
  LOT_SOLD: 'LOT_SOLD',
  TRIVIA_STEAL_TRIGGERED: 'TRIVIA_STEAL_TRIGGERED',
  HEIST_ACTION: 'HEIST_ACTION',
  FINAL_RESULTS: 'FINAL_RESULTS',
  EVENT: 'EVENT',
  LOBBY: 'LOBBY',
  START: 'START',
  REJECT: 'REJECT',
  // players -> host
  HELLO: 'HELLO',
  PLACE_BID: 'PLACE_BID',
  PASS: 'PASS',
  SUBMIT_TRIVIA_ANSWER: 'SUBMIT_TRIVIA_ANSWER',
  STEAL_TARGET: 'STEAL_TARGET',
  DOUBLE_OR_NOTHING_CHOICE: 'DOUBLE_OR_NOTHING_CHOICE',
  VAULT_LOCK: 'VAULT_LOCK',
  DONE: 'DONE',
  EMOTE: 'EMOTE',
  BYE: 'BYE',
  VOTE: 'VOTE',
  // the link: the host pings, players answer, so everyone's delay is known
  PING: 'PI',
  PONG: 'PO',
  // the quiz games: one generic envelope each way
  GAME_EVENT: 'G',
  GAME_TICK: 'GT',
  GAME_INPUT: 'GI',
});

const EVENT_WIRE = {
  lotIntro: WIRE.NEW_LOT,
  bid: WIRE.BID_PLACED,
  sold: WIRE.LOT_SOLD,
  oracle: WIRE.TRIVIA_STEAL_TRIGGERED,
  heist: WIRE.HEIST_ACTION,
  vaultLock: WIRE.HEIST_ACTION,
  verdict: WIRE.FINAL_RESULTS,
};

export function wireType(engineEvent) {
  return EVENT_WIRE[engineEvent] || WIRE.EVENT;
}

export const MAX_PLAYERS = 6;
export const BOT_FILL_TO = 4;
export const EMOTES = Object.freeze(['NICE ONE', 'OUCH', 'HA!', 'MINE', 'NO WAY', 'GG']);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1
const PEER_PREFIX = 'bidlock-room-v2-';
const PING_MS = 2000;
const RTT_WINDOW = 6; // round trips remembered per player
const DELTA_FULL = 25; // a full snapshot every this many events
const MAX_COMP = 0.3; // seconds: the most lag the host will make up for
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const PEER_CDNS = ['https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm', 'https://esm.sh/peerjs@1.5.4'];

export function makeRoomCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < 3; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return `BL-${s}`;
}

// Accepts "bl-7k9", "BL 7K9" or just "7k9". Returns "BL-7K9", or null if it cannot be a code.
export function normalizeCode(text) {
  const raw = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.length === 5 && raw.startsWith('BL') ? raw.slice(2) : raw;
  if (body.length !== 3) return null;
  for (const ch of body) if (!CODE_ALPHABET.includes(ch)) return null;
  return `BL-${body}`;
}

export function cleanName(text, fallback = 'PLAYER') {
  const s = String(text || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return (s || fallback).toUpperCase();
}

// ---------- event packing ----------
// Engine events carry object references (the lot, a lineup entry). On the wire they
// travel as ids and are looked up again in the receiver's mirror.
const ENTRY_KEYS = new Set(['entry', 'taken', 'given']);
const DROP_KEYS = new Set(['contenders', 'categories', 'options', 'rows', 'players', 'ranking', 'winner']);

export function packEvent(type, data) {
  const out = {};
  if (type === 'verdict' || type === 'matchStart') return out;
  for (const [k, v] of Object.entries(data || {})) {
    if (k === 'lot') out.$lot = v ? v.n - 1 : null;
    else if (k === 'item') out.$item = v ? v.id : null;
    else if (k === 'cat') out.$cat = v ? v.id : null;
    else if (ENTRY_KEYS.has(k)) out[`$e_${k}`] = v ? v.item.id : null;
    else if (DROP_KEYS.has(k) && typeof v === 'object') continue;
    else out[k] = v;
  }
  return out;
}

export function unpackEvent(engine, type, d) {
  if (type === 'verdict') return engine.results || engine.computeVerdict();
  if (type === 'matchStart') return { contenders: engine.contenders, categories: engine.categories, options: engine.options };
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (k === '$lot') out.lot = v == null ? null : engine.queue[v];
    else if (k === '$item') out.item = v == null ? null : (engine.queue.find((l) => l.item.id === v) || {}).item || (engine.findEntry(v) || {}).item || null;
    else if (k === '$cat') out.cat = engine.categories.find((c) => c.id === v) || null;
    else if (k.startsWith('$e_')) out[k.slice(3)] = v == null ? null : engine.findEntry(v);
    else out[k] = v;
  }
  return out;
}

// ---------- transports ----------
// Both give the lobby the same thing: connections with send(), close(), onData, onClose.

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// WebRTC through PeerJS. Loaded from a CDN when somebody opens the lobby.
//
// Joining is the fragile part, so it is patient: each attempt gets JOIN_ATTEMPT_MS, and
// a guest keeps trying for JOIN_ATTEMPTS attempts. That covers a host who has switched
// to a messaging app to send the code (their page is paused until they come back), a
// slow mobile line, and the signalling server's own hiccups.
const LOAD_MS = 20000;
const JOIN_ATTEMPT_MS = 12000;
const JOIN_ATTEMPTS = 4;
let peerModule = null; // one download per page, shared by every transport

function loadPeer() {
  if (!peerModule) {
    peerModule = (async () => {
      let last = null;
      for (const url of PEER_CDNS) {
        try {
          const mod = await import(/* @vite-ignore */ url);
          const Peer = mod.Peer || (mod.default && mod.default.Peer) || mod.default;
          if (typeof Peer === 'function') return Peer;
        } catch (err) { last = err; }
      }
      throw new Error(`Could not load the multiplayer library${last ? ` (${last.message})` : ''}. Check your connection.`);
    })();
    peerModule.catch(() => { peerModule = null; }); // allow a retry later
  }
  return peerModule;
}

// Start the download early (when the lobby opens), so joining does not wait for it.
export function warmPeer() { loadPeer().catch(() => {}); loadIceServers().catch(() => {}); }

class PeerTransport {
  constructor() { this.peer = null; this.Peer = null; this.onVisible = null; }

  async _load() {
    if (this.Peer) return this.Peer;
    this.Peer = await withTimeout(loadPeer(), LOAD_MS, 'The multiplayer library did not load. Check your connection and try again.');
    return this.Peer;
  }

  _options() {
    return { config: { iceServers: iceServers() }, debug: 0 };
  }

  _wrap(conn) {
    const c = { id: conn.peer, onData: null, onClose: null, closed: false, send: (o) => { if (conn.open) conn.send(o); }, close: () => { try { conn.close(); } catch { /* already gone */ } } };
    const shut = () => { if (!c.closed) { c.closed = true; if (c.onClose) c.onClose(); } };
    conn.on('data', (d) => { if (c.onData) c.onData(d); });
    conn.on('close', shut);
    conn.on('error', shut);
    return c;
  }

  async host(code, onConnection) {
    const Peer = await this._load();
    await loadIceServers();
    return withTimeout(new Promise((resolve, reject) => {
      const peer = new Peer(PEER_PREFIX + code.toLowerCase(), this._options());
      this.peer = peer;
      peer.on('open', () => resolve());
      peer.on('connection', (conn) => { conn.on('open', () => onConnection(this._wrap(conn))); });
      // The host must stay registered with the signalling server, or nobody can join.
      // Phones drop that socket when the page is in the background; reconnect as soon
      // as it is back, and again whenever it drops.
      const wake = () => { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch { /* try again later */ } };
      peer.on('disconnected', () => setTimeout(wake, 800));
      this.onVisible = () => { if (document.visibilityState === 'visible') wake(); };
      document.addEventListener('visibilitychange', this.onVisible);
      window.addEventListener('online', this.onVisible);
      peer.on('error', (err) => {
        if (peer.open) return; // a joiner's failure, or a blip: the room stays up
        const e = new Error(err && err.type === 'unavailable-id' ? 'taken' : `Could not open a room (${err && err.type ? err.type : 'network'}).`);
        reject(e);
      });
    }), 20000, 'The room server did not answer. Try again in a moment.');
  }

  // onProgress(attempt, of, why) is called before every retry.
  async join(code, { onProgress = () => {} } = {}) {
    const Peer = await this._load();
    await loadIceServers();
    const target = PEER_PREFIX + code.toLowerCase();
    // One identity for the whole join, registered once with the signalling server.
    const peer = new Peer(this._options());
    this.peer = peer;
    const peerErrors = [];
    peer.on('error', (err) => peerErrors.push(err && err.type ? err.type : 'network'));
    await withTimeout(new Promise((resolve, reject) => {
      if (peer.open) { resolve(); return; }
      peer.on('open', () => resolve());
      peer.on('error', (err) => { if (!peer.open && err && err.type !== 'peer-unavailable') reject(new Error(`Could not reach the room server (${err.type || 'network'}).`)); });
    }), 15000, 'The room server did not answer. Check your connection.');

    let lastWhy = 'timeout';
    for (let attempt = 1; attempt <= JOIN_ATTEMPTS; attempt++) {
      if (attempt > 1) onProgress(attempt, JOIN_ATTEMPTS, lastWhy);
      if (peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch { /* next attempt */ } }
      peerErrors.length = 0;
      const result = await new Promise((resolve) => {
        const conn = peer.connect(target, { reliable: true, serialization: 'json' });
        let done = false;
        let watch = null;
        let timer = null;
        const finish = (r) => { if (done) return; done = true; clearInterval(watch); clearTimeout(timer); resolve(r); };
        timer = setTimeout(() => { try { conn.close(); } catch { /* gone */ } finish({ why: 'timeout' }); }, JOIN_ATTEMPT_MS);
        // Watch the connection: no such room, or a network path that cannot be found.
        watch = setInterval(() => {
          if (peerErrors.includes('peer-unavailable')) { try { conn.close(); } catch { /* gone */ } finish({ why: 'no-room' }); return; }
          const pc = conn.peerConnection;
          if (pc && (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed')) { try { conn.close(); } catch { /* gone */ } finish({ why: 'ice' }); }
        }, 250);
        conn.on('open', () => finish({ conn }));
        conn.on('error', () => finish({ why: 'error' }));
      });
      if (result.conn) return this._wrap(result.conn);
      lastWhy = result.why;
      // Give a paused host a moment to come back before the next try.
      if (attempt < JOIN_ATTEMPTS) await new Promise((r) => setTimeout(r, result.why === 'no-room' ? 2500 : 600));
    }
    const relay = hasRelay();
    console.warn(`[BidLock rooms] join ${code} failed after ${JOIN_ATTEMPTS} tries: ${lastWhy}; relay configured: ${relay ? 'yes' : 'no'}`);
    if (lastWhy === 'no-room') throw new Error(`No room with the code ${code}. Check it with the host, and make sure they still have BidLock open.`);
    if (lastWhy === 'ice') {
      throw new Error(relay
        ? "Your network and the host's could not connect, even through the relay. Try another network (for example Wi-Fi instead of mobile data)."
        : "Your network and the host's could not connect directly. This happens on some mobile and work networks: try the host's Wi-Fi, or Wi-Fi instead of mobile data.");
    }
    throw new Error('Joining timed out. Check the code, and ask the host to keep BidLock open on their screen while friends join.');
  }

  close() {
    if (this.onVisible) {
      document.removeEventListener('visibilitychange', this.onVisible);
      window.removeEventListener('online', this.onVisible);
      this.onVisible = null;
    }
    try { if (this.peer) this.peer.destroy(); } catch { /* already gone */ }
    this.peer = null;
  }
}

// Same-browser loopback over BroadcastChannel: tabs on one machine can share a room
// with no network at all. Used by the tests and handy for trying a room on your own.
class LocalTransport {
  constructor({ lag = 0 } = {}) { this.channel = null; this.conns = new Map(); this.id = `p${Math.random().toString(36).slice(2, 9)}`; this.lag = lag; }

  // Every message is held back by `lag` ms when simulating a slow link.
  _post(m) {
    if (!this.channel) return;
    if (!this.lag) { this.channel.postMessage(m); return; }
    const ch = this.channel;
    setTimeout(() => { try { ch.postMessage(m); } catch { /* closed */ } }, this.lag);
  }

  _open(code) {
    this.channel = new BroadcastChannel(`${PEER_PREFIX}${code.toLowerCase()}`);
  }

  _conn(remote) {
    const c = {
      id: remote, onData: null, onClose: null, closed: false,
      send: (o) => { if (!c.closed && this.channel) this._post({ to: remote, from: this.id, kind: 'data', body: o }); },
      close: () => { if (!c.closed && this.channel) this.channel.postMessage({ to: remote, from: this.id, kind: 'close' }); c.closed = true; this.conns.delete(remote); },
    };
    this.conns.set(remote, c);
    return c;
  }

  _route(m) {
    const c = this.conns.get(m.from);
    if (!c) return;
    if (m.kind === 'data' && c.onData) c.onData(m.body);
    else if (m.kind === 'close' && !c.closed) { c.closed = true; this.conns.delete(m.from); if (c.onClose) c.onClose(); }
  }

  async host(code, onConnection) {
    this.id = 'host';
    this._open(code);
    this.channel.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== 'host') return;
      if (m.kind === 'open') {
        const c = this._conn(m.from);
        this.channel.postMessage({ to: m.from, from: 'host', kind: 'accept' });
        onConnection(c);
      } else this._route(m);
    };
  }

  async join(code, _opts = {}) {
    this._open(code);
    return withTimeout(new Promise((resolve) => {
      this.channel.onmessage = (e) => {
        const m = e.data;
        if (!m || m.to !== this.id) return;
        if (m.kind === 'accept') resolve(this._conn('host'));
        else this._route(m);
      };
      this.channel.postMessage({ to: 'host', from: this.id, kind: 'open' });
    }), 2500, `No room with the code ${code}. Check it with the host.`);
  }

  close() {
    for (const c of [...this.conns.values()]) c.close();
    if (this.channel) this.channel.close();
    this.channel = null;
  }
}

// ---------- the lobby ----------
export class LobbyManager {
  // transport: 'peer' (WebRTC) or 'local' (same-browser loopback).
  // lag: milliseconds of simulated one-way delay on the local transport (tests).
  constructor({ transport = 'peer', onState = () => {}, onMessage = () => {}, onInput = () => {}, onClosed = () => {}, lag = 0 } = {}) {
    this.kind = transport;
    this.simLag = Math.max(0, Number(lag) || 0);
    this.rtt = new Map(); // host: player id -> smoothed round trip, seconds (shown)
    this.rttSamples = new Map(); // host: player id -> the last few round trips, seconds
    this.latency = {}; // everyone: player id -> round trip in ms, as the host measured it
    this.myRtt = 0; // a player: their own round trip, seconds
    this.pingTimer = null;
    this.txKeys = null; // host: the last snapshot sent, key by key, as JSON
    this.txCount = 0;
    this.rxKeys = null; // player: the same, as received
    this.onState = onState;
    this.onMessage = onMessage;
    this.onInput = onInput;
    this.onClosed = onClosed;
    this.transport = null;
    this.conns = new Map(); // host: player id -> connection
    this.hostConn = null; // player: connection to the host
    this.state = this._blank();
  }

  _blank() {
    return { role: null, status: 'idle', code: null, error: '', players: [], fillBots: true, inMatch: false, you: null, game: 'bidlock', votes: {}, genre: null, level: null };
  }

  // Start downloading the multiplayer library before anyone presses a button.
  warm() { if (this.kind !== 'local') warmPeer(); }

  get isHost() { return this.state.role === 'host'; }
  get isClient() { return this.state.role === 'client'; }
  get active() { return this.state.role != null && this.state.status === 'open'; }

  _set(patch) {
    Object.assign(this.state, patch);
    this.onState(this.state);
  }

  _newTransport() {
    return this.kind === 'local' ? new LocalTransport({ lag: this.simLag }) : new PeerTransport();
  }

  _uniqueName(name, exceptPid = null) {
    const taken = new Set(this.state.players.filter((p) => p.pid !== exceptPid).map((p) => p.name));
    if (!taken.has(name)) return name;
    for (let i = 2; i < 9; i++) {
      const n = `${name.slice(0, 12)} ${i}`;
      if (!taken.has(n)) return n;
    }
    return name;
  }

  // ---------- hosting ----------
  async create(name) {
    this.leave(true);
    this._set({ ...this._blank(), role: 'host', status: 'connecting' });
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeRoomCode();
      const transport = this._newTransport();
      try {
        await transport.host(code, (conn) => this._onPlayerConnection(conn));
        this.transport = transport;
        this._set({ status: 'open', code, you: 'host', players: [{ pid: 'host', name: cleanName(name, 'HOST'), host: true, seat: 0, away: false }] });
        this._startPings();
        return code;
      } catch (err) {
        transport.close();
        if (err.message !== 'taken') {
          this._set({ ...this._blank(), status: 'error', error: err.message });
          throw err;
        }
      }
    }
    const err = new Error('Could not find a free room code. Try again.');
    this._set({ ...this._blank(), status: 'error', error: err.message });
    throw err;
  }

  _onPlayerConnection(conn) {
    conn.onData = (msg) => this._fromPlayer(conn, msg);
    conn.onClose = () => this._playerLeft(conn.id);
  }

  _fromPlayer(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === WIRE.PONG) { this._pong(conn.id, msg); return; }
    const known = this.state.players.find((p) => p.pid === conn.id);
    if (msg.t === WIRE.HELLO) {
      if (known) return;
      if (this.state.inMatch) { conn.send({ t: WIRE.REJECT, why: 'A match is already running in that room. Ask the host to wait for you next time.' }); return; }
      if (this.state.players.length >= MAX_PLAYERS) { conn.send({ t: WIRE.REJECT, why: `That room is full (${MAX_PLAYERS} players).` }); return; }
      this.conns.set(conn.id, conn);
      const players = [...this.state.players, { pid: conn.id, name: this._uniqueName(cleanName(msg.name)), host: false, seat: this.state.players.length, away: false }];
      this._set({ players });
      this._sendLobby();
      return;
    }
    if (!known) return;
    if (msg.t === WIRE.BYE) { this._playerLeft(conn.id); return; }
    if (msg.t === WIRE.VOTE) { if (!this.state.inMatch) this._vote(conn.id, msg.game); return; }
    // Everything else is a game input. The seat comes from the connection, never from the message.
    this.onInput(known.seat, msg);
  }

  _playerLeft(pid) {
    const p = this.state.players.find((x) => x.pid === pid);
    if (!p) return;
    const conn = this.conns.get(pid);
    this.conns.delete(pid);
    this.rtt.delete(pid);
    this.rttSamples.delete(pid);
    if (conn && !conn.closed) conn.close();
    if (this.state.inMatch) {
      // Their seat stays in the match and stops acting.
      this._set({ players: this.state.players.map((x) => (x.pid === pid ? { ...x, away: true } : x)) });
      this.onInput(p.seat, { t: WIRE.BYE });
    } else {
      const votes = { ...this.state.votes };
      delete votes[pid];
      this._set({ votes, players: this.state.players.filter((x) => x.pid !== pid).map((x, i) => ({ ...x, seat: i })) });
    }
    this._sendLobby();
  }

  _sendLobby() {
    if (!this.isHost) return;
    const { code, players, fillBots, inMatch, game, votes, genre, level } = this.state;
    for (const [pid, conn] of this.conns) conn.send({ t: WIRE.LOBBY, code, players, fillBots, inMatch, game, votes, genre, level, you: pid });
  }

  setFillBots(on) {
    if (!this.isHost) return;
    this._set({ fillBots: !!on });
    this._sendLobby();
  }

  // Host: which game the room plays next.
  setGame(id) {
    if (!this.isHost || this.state.inMatch || !GAMES.some((g) => g.id === id)) return;
    this._set({ game: id });
    this._sendLobby();
  }

  // Host: Soundclash's crate of music for the room.
  setGenre(id) {
    if (!this.isHost || this.state.inMatch || typeof id !== 'string' || id.length > 24) return;
    this._set({ genre: id });
    this._sendLobby();
  }

  // Host: Soundclash's difficulty for the room.
  setLevel(id) {
    if (!this.isHost || this.state.inMatch || typeof id !== 'string' || id.length > 12) return;
    this._set({ level: id });
    this._sendLobby();
  }

  // Anyone: say which game you would like next. The host still decides.
  vote(id) {
    if (!GAMES.some((g) => g.id === id) || this.state.inMatch) return;
    if (this.isHost) this._vote('host', id);
    else if (this.isClient && this.hostConn) this.hostConn.send({ t: WIRE.VOTE, game: id });
  }

  _vote(pid, id) {
    if (!GAMES.some((g) => g.id === id)) return;
    this._set({ votes: { ...this.state.votes, [pid]: id } });
    this._sendLobby();
  }

  voteCount(id) {
    return Object.values(this.state.votes).filter((v) => v === id).length;
  }

  // The table for the next match: everyone in the room, then bots up to the game's size.
  // BidLock seats its three house rivals; the quiz games draw from the bot roster.
  seats(gameId = this.state.game) {
    const game = gameById(gameId);
    const people = this.state.players.filter((p) => !p.away).map((p) => ({ name: p.name, kind: 'human', pid: p.pid }));
    if (!this.state.fillBots) return people;
    const want = Math.max(0, game.fillTo - people.length);
    if (game.id !== 'bidlock') return [...people, ...botSeats(want, people.map((p) => p.name))];
    const bots = [];
    for (const persona of PERSONAS) {
      if (bots.length >= want) break;
      bots.push({ name: persona.name, kind: 'ai', persona: persona.key });
    }
    return [...people, ...bots];
  }

  canStart() {
    return this.isHost && this.state.status === 'open' && this.seats().length >= 2;
  }

  // Host: lock the room and tell every player which seat is theirs.
  beginMatch(extra = {}) {
    if (!this.isHost) return null;
    this.txKeys = null;
    this.txCount = 0;
    const seats = this.seats();
    const players = this.state.players.filter((p) => !p.away).map((p, i) => ({ ...p, seat: i }));
    this._set({ players, inMatch: true });
    this._sendLobby();
    for (const p of players) {
      const conn = this.conns.get(p.pid);
      if (conn) conn.send({ t: WIRE.START, seat: p.seat, game: this.state.game, ...extra });
    }
    return seats;
  }

  // Host: the match is over; the room is open again.
  endMatch() {
    if (!this.isHost) return;
    this._set({ inMatch: false, votes: {}, players: this.state.players.filter((p) => !p.away).map((p, i) => ({ ...p, seat: i })) });
    this._sendLobby();
  }

  broadcast(msg) {
    if (!this.isHost) return;
    const out = msg && msg.s ? this._delta(msg) : msg;
    for (const conn of this.conns.values()) conn.send(out);
  }

  // ---------- snapshots: send only what changed ----------
  // A snapshot rides on every event so a player's mirror can be rebuilt. Most of it (the
  // lineups, the catalogue, the question) does not change from one event to the next,
  // so after the first one only the top-level keys that changed are sent, with a full
  // snapshot every DELTA_FULL events in case anything went astray.
  _delta(msg) {
    const s = msg.s;
    this.txCount++;
    if (!this.txKeys || this.txCount % DELTA_FULL === 0) {
      this.txKeys = {};
      for (const k of Object.keys(s)) this.txKeys[k] = JSON.stringify(s[k]);
      return { ...msg, sq: this.txCount };
    }
    const sd = {};
    const sx = [];
    for (const k of Object.keys(s)) {
      const j = JSON.stringify(s[k]);
      if (j !== this.txKeys[k]) { sd[k] = s[k]; this.txKeys[k] = j; }
    }
    for (const k of Object.keys(this.txKeys)) if (!(k in s)) { sx.push(k); delete this.txKeys[k]; }
    const out = { ...msg, sd, sq: this.txCount };
    delete out.s;
    if (sx.length) out.sx = sx;
    return out;
  }

  // A player: turn a delta back into a whole snapshot (fresh objects every time).
  _rebuild(msg) {
    if (msg.s) {
      this.rxKeys = {};
      for (const k of Object.keys(msg.s)) this.rxKeys[k] = JSON.stringify(msg.s[k]);
      return true;
    }
    if (!this.rxKeys) return false; // joined mid-stream: wait for the next full one
    for (const k of Object.keys(msg.sd)) this.rxKeys[k] = JSON.stringify(msg.sd[k]);
    for (const k of msg.sx || []) delete this.rxKeys[k];
    const s = {};
    for (const k of Object.keys(this.rxKeys)) s[k] = k in msg.sd ? msg.sd[k] : JSON.parse(this.rxKeys[k]);
    msg.s = s;
    delete msg.sd;
    delete msg.sx;
    return true;
  }

  // ---------- the link ----------
  _startPings() {
    this._stopPings();
    this.pingTimer = setInterval(() => this._ping(), PING_MS);
  }

  _stopPings() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  _ping() {
    if (!this.isHost) { this._stopPings(); return; }
    const lat = {};
    for (const [pid, r] of this.rtt) lat[pid] = Math.round(r * 1000);
    this.latency = lat;
    const ts = now();
    for (const [pid, conn] of this.conns) {
      const r = this._rttFloor(pid);
      conn.send({ t: WIRE.PING, ts, r: r == null ? null : Math.round(r * 1000), lat });
    }
    if (!this.state.inMatch) this.onState(this.state);
  }

  _pong(pid, msg) {
    if (!Number.isFinite(msg.ts)) return;
    const sample = Math.max(0, (now() - msg.ts) / 1000);
    if (sample > 10) return;
    const prev = this.rtt.get(pid);
    // Smoothed for display, but quick to notice a link getting worse.
    this.rtt.set(pid, prev == null ? sample : sample > prev ? prev * 0.5 + sample * 0.5 : prev * 0.8 + sample * 0.2);
    const list = this.rttSamples.get(pid) || [];
    list.push(sample);
    if (list.length > RTT_WINDOW) list.shift();
    this.rttSamples.set(pid, list);
  }

  // The best recent round trip. A busy page only ever adds delay to a ping, so the
  // quickest of the last few is the truest measure of the link itself (as in NTP).
  _rttFloor(pid) {
    const list = this.rttSamples.get(pid);
    return list && list.length ? Math.min(...list) : null;
  }

  // Host: how late a player's inputs arrive (one way), capped so it cannot be abused.
  lagFor(seat) {
    if (!this.isHost) return 0;
    const p = this.state.players.find((x) => x.seat === seat && !x.host);
    const r = p ? this._rttFloor(p.pid) : null;
    return r == null ? 0 : Math.min(MAX_COMP, r / 2);
  }

  // Host: the slowest connected player's one-way delay (for deadlines everyone shares).
  maxLag() {
    if (!this.isHost) return 0;
    let m = 0;
    for (const p of this.state.players) if (!p.host && !p.away) m = Math.max(m, this.lagFor(p.seat));
    return m;
  }

  // A player: how stale the host's messages are when they arrive (one way).
  get oneWay() { return this.isClient ? Math.min(0.5, this.myRtt / 2) : 0; }

  // Round trip in ms for a player id, or null if not measured yet.
  latencyMs(pid) {
    const v = this.latency[pid];
    return Number.isFinite(v) ? v : null;
  }

  // ---------- joining ----------
  // onProgress(attempt, of, why): a slow join is retrying.
  async join(name, codeText, { onProgress = () => {} } = {}) {
    const code = normalizeCode(codeText);
    if (!code) {
      const err = new Error('Room codes look like BL-7K9.');
      this._set({ ...this._blank(), status: 'error', error: err.message });
      throw err;
    }
    this.leave(true);
    this._set({ ...this._blank(), role: 'client', status: 'connecting', code });
    const transport = this._newTransport();
    try {
      const conn = await transport.join(code, { onProgress });
      this.transport = transport;
      this.hostConn = conn;
      conn.onData = (msg) => this._fromHost(msg);
      conn.onClose = () => {
        if (this.state.role !== 'client') return;
        this.leave(true);
        this._set({ ...this._blank(), status: 'error', error: 'The host closed the room.' });
        this.onClosed('host-left');
      };
      await withTimeout(new Promise((resolve, reject) => {
        this._joinWait = { resolve, reject };
        conn.send({ t: WIRE.HELLO, name: cleanName(name) });
      }), 10000, 'The host did not answer. Ask them to keep BidLock open on their screen.');
      return code;
    } catch (err) {
      transport.close();
      this.transport = null;
      this.hostConn = null;
      this._set({ ...this._blank(), status: 'error', error: err.message });
      throw err;
    } finally {
      this._joinWait = null;
    }
  }

  _fromHost(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === WIRE.PING) {
      if (this.hostConn) this.hostConn.send({ t: WIRE.PONG, ts: msg.ts });
      if (Number.isFinite(msg.r)) this.myRtt = msg.r / 1000;
      if (msg.lat && typeof msg.lat === 'object') { this.latency = msg.lat; if (!this.state.inMatch) this.onState(this.state); }
      return;
    }
    if (msg.t === WIRE.START) this.rxKeys = null;
    if (msg.s || msg.sd) { if (!this._rebuild(msg)) return; }
    if (msg.t === WIRE.REJECT) {
      if (this._joinWait) this._joinWait.reject(new Error(msg.why || 'The host turned the request down.'));
      return;
    }
    if (msg.t === WIRE.LOBBY) {
      this._set({ status: 'open', code: msg.code, players: msg.players, fillBots: msg.fillBots, inMatch: msg.inMatch, you: msg.you, game: msg.game || 'bidlock', votes: msg.votes || {}, genre: typeof msg.genre === 'string' ? msg.genre : null, level: typeof msg.level === 'string' ? msg.level : null });
      if (this._joinWait) this._joinWait.resolve();
      return;
    }
    this.onMessage(msg);
  }

  // Player -> host.
  send(msg) {
    if (this.isClient && this.hostConn) this.hostConn.send(msg);
  }

  // ---------- leaving ----------
  leave(silent = false) {
    this._stopPings();
    this.rtt.clear();
    this.rttSamples.clear();
    this.latency = {};
    this.myRtt = 0;
    this.txKeys = null;
    this.rxKeys = null;
    if (this.isClient && this.hostConn && !this.hostConn.closed) {
      try { this.hostConn.send({ t: WIRE.BYE }); } catch { /* already gone */ }
    }
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    if (this.hostConn) { this.hostConn.onClose = null; this.hostConn.close(); }
    this.hostConn = null;
    if (this.transport) this.transport.close();
    this.transport = null;
    this.state = this._blank();
    if (!silent) this.onState(this.state);
  }
}
