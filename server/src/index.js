// BIDLOCK ROOM SERVER: a Cloudflare Worker with one Durable Object per room code.
//
// The host's browser still runs the game and decides everything. This server only passes
// messages along: from the host to chosen players, and from each player to the host.
// Everyone connects with a plain WebSocket over HTTPS, which gets through the school
// Wi-Fi, mobile networks, VPNs and browser shields that stop the direct (WebRTC)
// connections PeerJS needs.
//
// It also rides out short drops. A host or player whose connection breaks (a phone put
// in a pocket, a train going into a tunnel) can reconnect and carry on: the room keeps
// their place, and holds what was sent to them meanwhile. Both ends count the messages
// they get, so on reconnecting each says how many arrived and the other resends the
// rest: nothing is lost in a connection that died without anyone noticing.
//
// Text frames:
//   server -> anyone   "!" + JSON         control: !{"k":"ok"}, !{"k":"join","id":"..."}
//   host -> server     "<id>,<id>\n<msg>" a message for those players (passed on as is)
//                      "!close <id>"      remove a player
//   server -> host     "<from id>\n<msg>"
//   player <-> server  "<msg>"
//   anyone             "!hb"              heartbeat, echoed without waking the room
// Reconnecting: ?resume=1&got=<messages received>&epoch=<from the last ok>. The "ok"
// answer carries the room's epoch and how many messages it has had from you (rcvd).
//
// Close codes: 4000 left on purpose, 4001 code taken, 4003 refused, 4004 no such room or
// room closed, 4005 room full, 4006 cannot resume, 4009 replaced by a newer connection.

import { DurableObject } from 'cloudflare:workers';

const CODE = /^BL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}$/;
const ID = /^[a-z0-9]{6,24}$/;
const KEY = /^[A-Za-z0-9]{16,64}$/;

export const LIMITS = Object.freeze({
  hostGrace: 5 * 60 * 1000, // a host whose connection dropped keeps the room this long
  hostClosed: 20 * 1000, // ...but only this long after their tab closed (close code 1001)
  guestGrace: 60 * 1000, // a player whose connection dropped keeps their seat this long
  maxGuests: 10, // MAX_PLAYERS is 6: the spare places let the host turn people away politely
  guestFrame: 16 * 1024, // players only send small inputs
  hostFrame: 4 * 1024 * 1024,
  waitingFrames: 1200, // held for a player who is reconnecting (oldest dropped first)
  waitingBytes: 8 * 1024 * 1024,
  inboxFrames: 300, // held for a host who is reconnecting
  replayFrames: 800, // the last messages sent to each person, for resending after a silent drop
  replayBytes: 4 * 1024 * 1024,
  rate: 40, // player frames per second, sustained
  burst: 120,
});

const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
});

function allowedOrigin(origin, env) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')) return true;
  const list = String((env && env.ALLOWED_ORIGINS) || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.includes(u.origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'bidlock-rooms', v: 1 });
    const m = /^\/room\/([^/]+)$/.exec(url.pathname);
    if (!m) return json({ error: 'not found' }, 404);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ error: 'expected a WebSocket' }, 426);
    // Browsers always say which page is connecting: only BidLock's own pages may use it.
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigin(origin, env)) return json({ error: 'origin not allowed' }, 403);
    const code = decodeURIComponent(m[1]).toUpperCase();
    if (!CODE.test(code)) return json({ error: 'bad room code' }, 400);
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
};

// One room. What it remembers (`meta`) is saved, so it survives the object being put to
// sleep or restarted; the sockets themselves carry who they belong to.
//   meta = { host: { id, key, goneAt, grace }, guests: { id: { key, goneAt } }, inbox: [frame] }
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // The grace periods can be shortened for tests: HOST_GRACE_MS, HOST_CLOSED_MS, GUEST_GRACE_MS.
    this.limits = { ...LIMITS };
    for (const [k, v] of [['hostGrace', 'HOST_GRACE_MS'], ['hostClosed', 'HOST_CLOSED_MS'], ['guestGrace', 'GUEST_GRACE_MS']]) {
      const n = Number(env && env[v]);
      if (n > 0) this.limits[k] = n;
    }
    this.meta = null;
    this.socks = null; // id -> WebSocket, rebuilt from the sockets after a sleep
    this.waiting = new Map(); // player id -> { frames, bytes } held while they reconnect
    this.buckets = new Map(); // player id -> { tokens, at }: the rate limit
    // Message counts and recent messages per person. In memory only: a room that has
    // been asleep starts a new epoch, and counting starts again.
    this.epoch = crypto.randomUUID().slice(0, 8);
    this.lanes = new Map(); // id -> { n: sent, ring: recent, bytes, rcvd: received }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('!hb', '!hb'));
    ctx.blockConcurrencyWhile(async () => { this.meta = (await ctx.storage.get('meta')) || null; });
  }

  // ---------- connecting ----------
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const id = url.searchParams.get('id') || '';
    const key = url.searchParams.get('key') || '';
    const resume = url.searchParams.get('resume') === '1';
    const got = Math.max(0, Math.floor(Number(url.searchParams.get('got')) || 0));
    const same = resume && url.searchParams.get('epoch') === this.epoch;
    await this._sweep(); // first, so a room that has expired is gone before anyone joins it
    const [client, ws] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(ws);
    if ((role !== 'host' && role !== 'guest') || !ID.test(id) || !KEY.test(key)) this._refuse(ws, 'bad-request', 4003);
    else if (role === 'host') await this._hostIn(ws, id, key, resume, same, got);
    else await this._guestIn(ws, id, key, resume, same, got);
    return new Response(null, { status: 101, webSocket: client });
  }

  async _hostIn(ws, id, key, resume, same, got) {
    let m = this.meta;
    if (m && m.host.key !== key) { this._refuse(ws, 'taken', 4001); return; }
    if (resume && (!m || m.host.id !== id)) { this._refuse(ws, 'gone', 4006); return; }
    if (!m || !resume) {
      if (m) this._closeAll(4004, 'closed', ws);
      m = this.meta = { host: { id, key, goneAt: 0, grace: 0 }, guests: {}, inbox: [] };
      this.waiting.clear();
      this.lanes.clear();
    }
    const wasAway = !!m.host.goneAt;
    this._attach(ws, 'host', id);
    m.host.goneAt = 0;
    const lane = this._openLane(id, same);
    const from = this._from(lane, same, got);
    ws.send(`!${JSON.stringify({ k: 'ok', resumed: resume, guests: Object.keys(m.guests), epoch: this.epoch, rcvd: lane.rcvd, got: from })}`);
    this._replay(ws, lane, from);
    for (const f of m.inbox) this._out(id, ws, f);
    m.inbox = [];
    if (wasAway) this._toGuests('!{"k":"back"}');
    await this._save();
    await this._schedule();
  }

  async _guestIn(ws, id, key, resume, same, got) {
    const m = this.meta;
    if (!m) { this._refuse(ws, resume ? 'gone' : 'no-room', resume ? 4006 : 4004); return; }
    const g = m.guests[id];
    if (id === m.host.id || (g && g.key !== key)) { this._refuse(ws, 'refused', 4003); return; }
    if (resume && !g) { this._refuse(ws, 'gone', 4006); return; }
    if (!g && Object.keys(m.guests).length >= this.limits.maxGuests) { this._refuse(ws, 'full', 4005); return; }
    this._attach(ws, 'guest', id);
    const lane = this._openLane(id, !!g && same);
    const from = this._from(lane, !!g && same, got);
    ws.send(`!${JSON.stringify({ k: 'ok', resumed: !!g, away: !!m.host.goneAt, epoch: this.epoch, rcvd: lane.rcvd, got: from })}`);
    if (g) {
      g.goneAt = 0;
      this._replay(ws, lane, from);
      const q = this.waiting.get(id);
      if (q) for (const f of q.frames) this._out(id, ws, f);
      this.waiting.delete(id);
    } else {
      m.guests[id] = { key, goneAt: 0 };
      this._toHost(`!${JSON.stringify({ k: 'join', id })}`);
    }
    await this._save();
    await this._schedule();
  }

  _refuse(ws, k, code) {
    ws.serializeAttachment({ dead: true });
    try { ws.send(`!${JSON.stringify({ k })}`); ws.close(code, k); } catch { /* already gone */ }
  }

  // This socket now speaks for `id`; an older one for the same id is closed.
  _attach(ws, role, id) {
    const socks = this._socks();
    const old = socks.get(id);
    if (old && old !== ws) this._retire(old, 4009, 'replaced');
    ws.serializeAttachment({ role, id });
    socks.set(id, ws);
  }

  // Says why first: a closing socket can take seconds to report its close code.
  _retire(ws, code, reason) {
    try { ws.serializeAttachment({ dead: true }); } catch { /* closed */ }
    try { ws.send(`!${JSON.stringify({ k: reason })}`); } catch { /* closed */ }
    try { ws.close(code, reason); } catch { /* closed */ }
  }

  _socks() {
    if (!this.socks) {
      this.socks = new Map();
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a && a.id && !a.dead) this.socks.set(a.id, ws);
      }
    }
    return this.socks;
  }

  // ---------- counting ----------
  // A person's lane: kept when they resume in the same epoch, otherwise started afresh.
  _openLane(id, keep) {
    let lane = keep ? this.lanes.get(id) : null;
    if (!lane) this.lanes.set(id, (lane = { n: 0, ring: [], bytes: 0, rcvd: 0 }));
    return lane;
  }

  _lane(id) { return this.lanes.get(id) || this._openLane(id, false); }

  // Send, counted, and kept for a while in case the socket turns out to be dead.
  _out(id, ws, frame) {
    const lane = this._lane(id);
    lane.n++;
    lane.ring.push(frame);
    lane.bytes += frame.length;
    while (lane.ring.length > this.limits.replayFrames || lane.bytes > this.limits.replayBytes) lane.bytes -= lane.ring.shift().length;
    try { ws.send(frame); } catch { /* dead: resent when they reconnect */ }
  }

  // Where the resend starts: after the `got` messages they say arrived, or after what
  // has already been trimmed from the ring. The "ok" tells them, so both counts agree.
  _from(lane, same, got) {
    return same ? Math.min(lane.n, Math.max(got, lane.n - lane.ring.length)) : lane.n;
  }

  // Resend everything after message number `from`.
  _replay(ws, lane, from) {
    const first = lane.n - lane.ring.length + 1;
    for (let i = from + 1; i <= lane.n; i++) { try { ws.send(lane.ring[i - first]); } catch { /* closing */ } }
  }

  // ---------- passing messages on ----------
  async webSocketMessage(ws, data) {
    const a = ws.deserializeAttachment();
    if (!a || a.dead || !this.meta || this._socks().get(a.id) !== ws || typeof data !== 'string') return;
    this._lane(a.id).rcvd++; // every message counts as received, even one that is then ignored
    if (a.role === 'host') {
      if (data.length > this.limits.hostFrame) return;
      if (data.startsWith('!close ')) { await this._dropGuest(data.slice(7), false); return; }
      if (data.charCodeAt(0) === 33) return; // "!": no other controls
      const nl = data.indexOf('\n');
      if (nl < 1) return;
      const msg = data.slice(nl + 1);
      for (const to of data.slice(0, nl).split(',')) this._toGuest(to, msg);
      return;
    }
    if (data.length > this.limits.guestFrame || data.charCodeAt(0) === 33 || !this._allow(a.id)) return;
    if (this._toHost(`${a.id}\n${data}`)) await this._save();
  }

  // To one player, or held for them while they reconnect.
  _toGuest(id, frame) {
    const ws = this._socks().get(id);
    if (ws) { this._out(id, ws, frame); return; }
    if (!this.meta.guests[id]) return;
    let q = this.waiting.get(id);
    if (!q) this.waiting.set(id, (q = { frames: [], bytes: 0 }));
    q.frames.push(frame);
    q.bytes += frame.length;
    while (q.frames.length > this.limits.waitingFrames || q.bytes > this.limits.waitingBytes) q.bytes -= q.frames.shift().length;
  }

  _toGuests(frame) {
    for (const [id, ws] of this._socks()) if (id !== this.meta.host.id) this._out(id, ws, frame);
  }

  // To the host, or into their inbox while they reconnect. True if it went to the inbox
  // (which is saved, so it survives the room going to sleep).
  _toHost(frame) {
    const ws = this._socks().get(this.meta.host.id);
    if (ws) { this._out(this.meta.host.id, ws, frame); return false; }
    this.meta.inbox.push(frame);
    if (this.meta.inbox.length > this.limits.inboxFrames) this.meta.inbox.shift();
    return true;
  }

  _allow(id) {
    const now = Date.now();
    const b = this.buckets.get(id) || { tokens: this.limits.burst, at: now };
    b.tokens = Math.min(this.limits.burst, b.tokens + ((now - b.at) / 1000) * this.limits.rate);
    b.at = now;
    this.buckets.set(id, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // ---------- leaving ----------
  async webSocketClose(ws, code) { await this._gone(ws, code); }
  async webSocketError(ws) { await this._gone(ws, 1006); }

  async _gone(ws, code) {
    const a = ws.deserializeAttachment();
    if (!a || a.dead || !a.id || !this.meta) return;
    const socks = this._socks();
    if (socks.get(a.id) !== ws) return;
    socks.delete(a.id);
    const m = this.meta;
    if (a.role === 'host') {
      if (code === 4000) { await this._endRoom(); return; }
      m.host.goneAt = Date.now();
      m.host.grace = code === 1001 ? this.limits.hostClosed : this.limits.hostGrace;
      this._toGuests('!{"k":"away"}');
    } else {
      if (code === 4000) { await this._dropGuest(a.id, true); return; }
      if (m.guests[a.id]) m.guests[a.id].goneAt = Date.now();
    }
    await this._save();
    await this._schedule();
  }

  async _dropGuest(id, tellHost) {
    const m = this.meta;
    if (!m || !m.guests[id]) return;
    delete m.guests[id];
    this.waiting.delete(id);
    this.buckets.delete(id);
    this.lanes.delete(id);
    const ws = this._socks().get(id);
    if (ws) { this._socks().delete(id); this._retire(ws, 4000, 'removed'); }
    if (tellHost) this._toHost(`!${JSON.stringify({ k: 'leave', id })}`);
    await this._save();
  }

  _closeAll(code, reason, except = null) {
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) this._retire(ws, code, reason);
    this.socks = new Map();
  }

  async _endRoom() {
    this._closeAll(4004, 'closed');
    this.meta = null;
    this.waiting.clear();
    this.buckets.clear();
    this.lanes.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---------- time ----------
  // Ends a room whose host never came back, and lets go of players who did not.
  async _sweep() {
    const m = this.meta;
    if (!m) return;
    const now = Date.now();
    if (m.host.goneAt && now - m.host.goneAt >= m.host.grace) { await this._endRoom(); return; }
    let changed = false;
    for (const [id, g] of Object.entries(m.guests)) {
      if (g.goneAt && now - g.goneAt >= this.limits.guestGrace) {
        delete m.guests[id];
        this.waiting.delete(id);
        this.buckets.delete(id);
        this.lanes.delete(id);
        this._toHost(`!${JSON.stringify({ k: 'leave', id })}`);
        changed = true;
      }
    }
    if (changed) await this._save();
  }

  async _schedule() {
    const m = this.meta;
    let next = Infinity;
    if (m) {
      if (m.host.goneAt) next = Math.min(next, m.host.goneAt + m.host.grace);
      for (const g of Object.values(m.guests)) if (g.goneAt) next = Math.min(next, g.goneAt + this.limits.guestGrace);
    }
    if (next === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  async alarm() {
    await this._sweep();
    await this._schedule();
  }

  async _save() {
    if (this.meta) await this.ctx.storage.put('meta', this.meta);
    else await this.ctx.storage.delete('meta');
  }
}
