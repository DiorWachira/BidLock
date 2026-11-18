// Rooms through the BidLock room server (server/ in this repo, on Cloudflare).
//
// Every player keeps one WebSocket to the room: an ordinary HTTPS connection, so it gets
// through networks and browsers that block WebRTC (school Wi-Fi that keeps devices apart,
// strict mobile networks, Brave's WebRTC setting, VPNs). The host's browser still runs
// the game; the server only passes messages between the host and the players.
//
// A connection that drops reconnects by itself and carries on where it left off: the
// server keeps the seat, and messages sent meanwhile wait on both sides. Both ends count
// the messages they receive; on reconnecting, each resends what the other missed, so a
// connection that died silently (a phone changing networks) loses nothing.
//
// Same shape as the other transports: host(code, onConnection), join(code), close(), and
// connections with send(), close(), onData, onClose.

const CONNECT_MS = 8000; // the first connection: longer than this and the server is out of reach
const HEARTBEAT_MS = 5000;
const SILENT_MS = 15000; // nothing heard for this long: the socket is dead, open another
const RETRY_MS = [300, 800, 1500, 2500, 4000];
const QUEUE_MAX = 1500; // messages held while reconnecting
const SENT_KEEP = 600; // messages kept after sending, in case the socket was already dead
const HOST_GRACE_MS = 4.5 * 60 * 1000; // a little under the server's, so the server decides
const GUEST_GRACE_MS = 55 * 1000;
const FINAL = { 4001: 'taken', 4003: 'refused', 4004: 'closed', 4005: 'full', 4006: 'gone' };
const REFUSALS = new Set(['taken', 'refused', 'closed', 'removed', 'full', 'gone', 'no-room', 'bad-request']);

function random(n, alphabet) {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  let s = '';
  for (const x of a) s += alphabet[x % alphabet.length];
  return s;
}
const newId = () => random(12, 'abcdefghijklmnopqrstuvwxyz0123456789');
const newKey = () => random(24, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');

// "https://rooms.example" or "wss://rooms.example/" -> "wss://rooms.example". Null if not a URL.
export function relayBase(url) {
  const s = String(url || '').trim().replace(/\/+$/, '');
  if (/^wss?:\/\/[^\s/]+/.test(s)) return s;
  if (/^https?:\/\/[^\s/]+/.test(s)) return s.replace(/^http/, 'ws');
  return null;
}

// The server's health check, for "Check my connection".
export function relayHealthUrl(url) {
  const b = relayBase(url);
  return b ? `${b.replace(/^ws/, 'http')}/health` : null;
}

function refusal(k, code) {
  const text = {
    'no-room': `No room with the code ${code}. Check it with the host, and make sure they still have BidLock open.`,
    full: 'That room is full.',
    taken: 'taken',
    refused: 'The room server turned the connection down. Try again.',
    gone: 'The room has closed.',
    closed: 'The room has closed.',
    unreachable: 'Could not reach the BidLock room server.',
  }[k] || 'Could not reach the BidLock room server.';
  const err = new Error(text);
  err.code = k;
  return err;
}

// One socket to the room that reconnects by itself.
//   onFrame(text)     a message
//   onControl(ctl)    the server's own news: join, leave, away, back
//   onResume(ok)      reconnected after a drop
//   onLost(why)       gave up: the room closed, or the connection could not be restored
export class RelayLink {
  constructor({ base, code, role, graceMs, WebSocketImpl = globalThis.WebSocket }) {
    this.url = `${base}/room/${encodeURIComponent(code)}`;
    this.code = code;
    this.role = role;
    this.id = newId();
    this.key = newKey();
    this.graceMs = graceMs;
    this.WS = WebSocketImpl;
    this.ws = null;
    this.ready = false; // accepted by the room, messages flow
    this.joined = false; // accepted at least once: later connections resume
    this.closed = false;
    this.queue = [];
    this.epoch = null; // the room's epoch, from its last "ok"
    this.got = 0; // messages received from the room (this epoch)
    this.sent = 0; // messages sent to it
    this.kept = []; // [number, message] of the last SENT_KEEP sent
    this.heardAt = 0;
    this.droppedAt = 0;
    this.tries = 0;
    this.retryTimer = null;
    this.beat = null;
    this.onFrame = () => {};
    this.onControl = () => {};
    this.onResume = () => {};
    this.onLost = () => {};
    this._opening = null;
    // Back on screen or back online: reconnect now, or check a quiet socket is still alive.
    this._wake = () => {
      if (this.closed || !this.joined) return;
      if (!this.ready) { this.tries = 0; this._reconnectSoon(0); } else if (Date.now() - this.heardAt > 2 * HEARTBEAT_MS) this._drop();
    };
    this.refused = null;
    this._hide = (e) => { if (!e.persisted) this.close(); }; // the tab is closing: leave on purpose
  }

  // The first connection. Resolves with the server's "ok", rejects with a refusal.
  open() {
    return new Promise((resolve, reject) => {
      this._opening = { resolve, reject };
      const timer = setTimeout(() => this._fail(refusal('unreachable', this.code)), CONNECT_MS);
      this._opening.timer = timer;
      this._connect();
    });
  }

  _fail(err) {
    const o = this._opening;
    if (!o) return;
    this._opening = null;
    clearTimeout(o.timer);
    this.close();
    o.reject(err);
  }

  _connect() {
    if (this.closed) return;
    const resume = this.joined ? `&resume=1&got=${this.got}&epoch=${this.epoch || ''}` : '';
    const q = `role=${this.role}&id=${this.id}&key=${this.key}${resume}&v=1`;
    let ws;
    try { ws = new this.WS(`${this.url}?${q}`); } catch { this._dropped(1006); return; }
    this.ws = ws;
    ws.onmessage = (e) => { if (this.ws === ws) this._message(typeof e.data === 'string' ? e.data : ''); };
    ws.onclose = (e) => { if (this.ws === ws) this._dropped(e.code); };
    ws.onerror = () => { /* onclose follows */ };
  }

  _message(data) {
    this.heardAt = Date.now();
    if (data === '!hb') return;
    if (data.charCodeAt(0) !== 33) { this.got++; this.onFrame(data); return; }
    let ctl;
    try { ctl = JSON.parse(data.slice(1)); } catch { return; }
    if (!ctl || typeof ctl.k !== 'string') return;
    if (ctl.k === 'ok') { this._accepted(ctl); return; }
    if (ctl.k === 'replaced') return; // an old socket, already given up on
    if (REFUSALS.has(ctl.k)) {
      // The server is closing this socket and says why. Act now: the close itself can
      // take seconds to arrive.
      this.refused = ctl.k;
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* gone */ }
      this._dropped(0);
      return;
    }
    this.got++;
    this.onControl(ctl);
  }

  _accepted(ok) {
    const resumed = this.joined;
    // Square the counts with the room. Same epoch: carry on from where the room says, and
    // resend what it never got. A new epoch (the room restarted): start counting again.
    const same = !!ok.epoch && ok.epoch === this.epoch;
    this.epoch = ok.epoch || null;
    let resend = [];
    if (same) {
      if (Number.isFinite(ok.got)) this.got = ok.got;
      const rcvd = Number.isFinite(ok.rcvd) ? ok.rcvd : this.sent;
      resend = this.kept.filter(([i]) => i > rcvd).map(([, f]) => f);
      this.kept = this.kept.filter(([i]) => i <= rcvd);
      this.sent = Math.min(this.sent, rcvd);
    } else {
      this.got = Number.isFinite(ok.got) ? ok.got : 0;
      this.sent = Number.isFinite(ok.rcvd) ? ok.rcvd : 0;
      this.kept = [];
    }
    this.ready = true;
    this.joined = true;
    this.tries = 0;
    this.droppedAt = 0;
    this.heardAt = Date.now();
    this._startBeat();
    const waiting = this.queue;
    this.queue = [];
    if (this._opening) {
      const o = this._opening;
      this._opening = null;
      clearTimeout(o.timer);
      this._listen(true);
      o.resolve(ok);
    } else if (resumed) this.onResume(ok);
    for (const f of resend) this._send(f);
    for (const f of waiting) this._send(f);
  }

  _dropped(code) {
    this.ready = false;
    this.ws = null;
    this._stopBeat();
    if (this.closed) return;
    const said = this.refused;
    this.refused = null;
    const final = said || (code === 4004 && !this.joined ? 'no-room' : FINAL[code]);
    if (this._opening) {
      // The first connection: a refusal is final. Anything else gets one quick retry, then
      // the server counts as out of reach (and the game falls back to a direct connection).
      if (final) this._fail(refusal(final, this.code));
      else if (this.tries < 1) { this.tries++; this._reconnectSoon(400); } else this._fail(refusal('unreachable', this.code));
      return;
    }
    if (final) { this._lose(final); return; }
    if (!this.droppedAt) this.droppedAt = Date.now();
    if (Date.now() - this.droppedAt > this.graceMs) { this._lose('timeout'); return; }
    this._reconnectSoon(RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)]);
    this.tries++;
  }

  _reconnectSoon(ms) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.closed || this.ready) return;
      if (this.ws) { const old = this.ws; this.ws = null; try { old.close(); } catch { /* gone */ } }
      this._connect();
    }, ms);
  }

  _lose(why) {
    if (this.closed) return;
    this.close(false);
    this.onLost(why);
  }

  _startBeat() {
    this._stopBeat();
    this.beat = setInterval(() => {
      if (!this.ready || !this.ws) return;
      // A socket can die without saying so (a phone changing networks): when nothing has
      // been heard for a while, open a new one.
      if (Date.now() - this.heardAt > SILENT_MS) { this._drop(); return; }
      try { this.ws.send('!hb'); } catch { /* the next beat notices */ }
    }, HEARTBEAT_MS);
  }

  _stopBeat() { clearInterval(this.beat); this.beat = null; }

  _listen(on) {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('visibilitychange', this._wake);
    window[f]('online', this._wake);
    window[f]('pageshow', this._wake);
    window[f]('pagehide', this._hide);
  }

  // Send, counted and kept: if the socket turns out to be dead, it is resent later.
  _send(frame) {
    try { this.ws.send(frame); } catch { this.queue.push(frame); return; }
    this.sent++;
    this.kept.push([this.sent, frame]);
    if (this.kept.length > SENT_KEEP) this.kept.shift();
  }

  // Sent now, or held until the connection is back.
  send(frame) {
    if (this.closed) return;
    if (this.ready && this.ws && this.ws.readyState === 1) { this._send(frame); return; }
    this.queue.push(frame);
    if (this.queue.length > QUEUE_MAX) this.queue.shift();
  }

  // Close the socket as if the network had dropped it (tests, and a dead socket).
  _drop() {
    const ws = this.ws;
    if (!ws) return;
    try { ws.close(3001, 'drop'); } catch { /* gone */ }
    this._dropped(3001);
  }

  // Leave on purpose: the server forgets this player (or, for the host, closes the room).
  close(tell = true) {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    clearTimeout(this.retryTimer);
    this._stopBeat();
    this._listen(false);
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(tell ? 4000 : 1000, 'bye'); } catch { /* gone */ } }
  }
}

export class RelayTransport {
  constructor(url, { WebSocketImpl } = {}) {
    this.base = relayBase(url);
    this.WS = WebSocketImpl;
    this.link = null;
    this.conns = new Map(); // host: player id -> connection
    this.via = 'relay';
    this.onLost = null;
  }

  _link(code, role, graceMs) {
    if (!this.base) throw refusal('unreachable', code);
    const link = new RelayLink({ base: this.base, code, role, graceMs, ...(this.WS ? { WebSocketImpl: this.WS } : {}) });
    this.link = link;
    return link;
  }

  async host(code, onConnection) {
    const link = this._link(code, 'host', HOST_GRACE_MS);
    link.onControl = (c) => {
      if (c.k === 'join' && typeof c.id === 'string' && !this.conns.has(c.id)) onConnection(this._conn(c.id));
      else if (c.k === 'leave') this._shut(c.id);
    };
    // Back after a drop: anyone the room let go of meanwhile has left.
    link.onResume = (ok) => {
      const still = new Set(Array.isArray(ok.guests) ? ok.guests : []);
      for (const id of [...this.conns.keys()]) if (!still.has(id)) this._shut(id);
    };
    link.onFrame = (data) => {
      const nl = data.indexOf('\n');
      const c = nl > 0 ? this.conns.get(data.slice(0, nl)) : null;
      if (!c || c.closed || !c.onData) return;
      let msg;
      try { msg = JSON.parse(data.slice(nl + 1)); } catch { return; }
      c.onData(msg);
    };
    link.onLost = () => {
      for (const id of [...this.conns.keys()]) this._shut(id);
      if (this.onLost) this.onLost();
    };
    await link.open();
  }

  _conn(id) {
    const c = {
      id, via: 'relay', onData: null, onClose: null, closed: false,
      send: (o) => { if (!c.closed && this.link) this.link.send(`${id}\n${JSON.stringify(o)}`); },
      close: () => {
        if (c.closed) return;
        c.closed = true;
        this.conns.delete(id);
        if (this.link) this.link.send(`!close ${id}`);
      },
    };
    this.conns.set(id, c);
    return c;
  }

  _shut(id) {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    if (!c.closed) { c.closed = true; if (c.onClose) c.onClose(); }
  }

  // One message for several players: sent once, and the server hands out the copies.
  sendMany(list, o) {
    const ids = [];
    for (const c of list) {
      if (c.closed) continue;
      if (c.via === 'relay' && this.conns.get(c.id) === c) ids.push(c.id);
      else c.send(o);
    }
    if (ids.length && this.link) this.link.send(`${ids.join(',')}\n${JSON.stringify(o)}`);
  }

  async join(code) {
    const link = this._link(code, 'guest', GUEST_GRACE_MS);
    const c = {
      id: 'host', via: 'relay', onData: null, onClose: null, onAway: null, hostAway: false, closed: false, why: '',
      send: (o) => { if (!c.closed) link.send(JSON.stringify(o)); },
      close: () => { if (c.closed) return; c.closed = true; link.close(); },
    };
    link.onFrame = (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (c.onData) c.onData(msg);
    };
    link.onControl = (ctl) => {
      if (ctl.k !== 'away' && ctl.k !== 'back') return;
      c.hostAway = ctl.k === 'away';
      if (c.onAway) c.onAway(c.hostAway);
    };
    link.onResume = (ok) => { c.hostAway = !!ok.away; if (c.onAway) c.onAway(c.hostAway); };
    link.onLost = (why) => {
      if (c.closed) return;
      c.closed = true;
      c.why = why === 'closed' || why === 'removed' ? '' : 'Lost the connection to the room.';
      if (c.onClose) c.onClose();
    };
    const ok = await link.open();
    c.hostAway = !!ok.away;
    return c;
  }

  close() {
    if (this.link) this.link.close();
    this.link = null;
    this.conns.clear();
  }
}
