// "Check my connection": what stands between this browser and a room, in plain words.
//
// The easy way in is the BidLock room server (a WebSocket over HTTPS): if this browser can
// reach it, rooms work, whatever the network does to WebRTC.
//
// Without it, a room needs three things:
//   1. PeerJS's signalling server, to find the host;
//   2. WebRTC switched on in this browser (Brave, privacy extensions and some VPNs turn
//      it off or restrict it);
//   3. a path to the host: directly (helped by STUN, which a network may block), or
//      through a TURN relay.
// The check gathers real ICE candidates with the game's own servers, so it sees exactly
// what a join would see.

import { iceServers, hasRelay } from './iceServers.js';
import { relayHealthUrl } from './relayTransport.js';

export const SIGNAL_URL = 'https://0.peerjs.com/peerjs/id';

// 'ok' or 'blocked' for a URL that should answer 200.
async function reachable(url, { fetchImpl, timeoutMs }) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? (...a) => fetch(...a) : null);
  if (!doFetch) return 'unknown';
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(`${url}?ts=${Date.now()}${Math.random().toString(36).slice(2)}`, { cache: 'no-store', ...(ctrl ? { signal: ctrl.signal } : {}) });
    return res.ok ? 'ok' : 'blocked';
  } catch {
    return 'blocked';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// roomServer: the room server's URL ('' when there is none).
export async function checkConnection({ servers = iceServers(), timeoutMs = 7000, signalUrl = SIGNAL_URL, roomServer = '', fetchImpl = null } = {}) {
  const started = Date.now();
  const out = { rooms: 'none', webrtc: false, host: 0, mdns: 0, srflx: 0, relay: 0, relayTcp: 0, signalling: 'unknown', errors: [], relayConfigured: hasRelay(), ms: 0 };
  const health = relayHealthUrl(roomServer);
  const rooms = health ? reachable(health, { fetchImpl, timeoutMs }) : Promise.resolve('none');
  const signal = reachable(signalUrl, { fetchImpl, timeoutMs });
  if (typeof RTCPeerConnection === 'undefined') {
    out.rooms = await rooms;
    out.signalling = await signal;
    out.ms = Date.now() - started;
    return out;
  }
  let pc = null;
  try {
    pc = new RTCPeerConnection({ iceServers: servers });
    out.webrtc = true;
    pc.createDataChannel('check');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      pc.onicecandidate = (e) => {
        if (!e.candidate) { clearTimeout(timer); resolve(); return; }
        const c = e.candidate;
        const type = c.type || (/ typ (\w+)/.exec(c.candidate || '') || [])[1];
        if (type === 'host') { out.host++; if (/\.local$/.test(c.address || '') || /\.local /.test(c.candidate || '')) out.mdns++; }
        else if (type === 'srflx' || type === 'prflx') out.srflx++;
        else if (type === 'relay') { out.relay++; if (/tcp|tls/i.test(`${c.relayProtocol || ''} ${c.url || ''}`)) out.relayTcp++; }
      };
      pc.onicecandidateerror = (e) => { if (out.errors.length < 8) out.errors.push(`${e.url || ''} ${e.errorCode || ''} ${e.errorText || ''}`.trim()); };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => { clearTimeout(timer); resolve(); });
    });
  } catch {
    out.webrtc = false;
  } finally {
    try { if (pc) pc.close(); } catch { /* gone */ }
  }
  out.rooms = await rooms;
  out.signalling = await signal;
  out.ms = Date.now() - started;
  return out;
}

// What the result means and what to do about it. verdict: 'ok', 'relay', 'warn' or 'bad'.
export function explain(r) {
  // The room server answers: every room works from here, so the rest is only detail.
  if (r.rooms === 'ok') {
    const lines = ['✓ The BidLock room server can be reached: rooms work from here, even on strict networks.'];
    if (r.webrtc && r.srflx) lines.push('✓ Direct connections (WebRTC) also work here, as a fallback.');
    else lines.push('– Direct connections (WebRTC) are blocked or limited here, which no longer matters.');
    return { verdict: 'ok', lines, fix: '' };
  }
  const direct = explainDirect(r);
  if (r.rooms === 'blocked') {
    direct.lines.unshift('✗ The BidLock room server cannot be reached from here, so rooms fall back to direct connections.');
    if (direct.verdict === 'ok') direct.verdict = 'warn';
    const shield = 'Something on this device or network is blocking the room server (a firewall, a VPN, or a browser shield or ad blocker). Try turning the shield off for this site, or another network.';
    direct.fix = direct.fix ? `${shield} Meanwhile: ${direct.fix}` : shield;
  }
  return direct;
}

function explainDirect(r) {
  const lines = [];
  let verdict = 'ok';
  let fix = '';
  if (r.signalling === 'blocked') {
    verdict = 'bad';
    lines.push('✗ The direct-connection server (0.peerjs.com) cannot be reached.');
    fix = 'Something on this device or network is blocking it: a firewall, a VPN, or a browser shield or ad blocker. Try turning the shield off for this site, or another network.';
  } else if (r.signalling === 'ok') {
    lines.push('✓ The direct-connection server (0.peerjs.com) can be reached.');
  }
  if (!r.webrtc) {
    verdict = 'bad';
    lines.push('✗ WebRTC is switched off in this browser, so it cannot join rooms.');
    fix = fix || 'Turn WebRTC back on, or use another browser (Chrome, Edge, Firefox or Safari).';
    return { verdict, lines, fix };
  }
  const any = r.host + r.srflx + r.relay;
  if (!any) {
    verdict = 'bad';
    lines.push('✗ This browser is not allowed to make direct connections.');
    fix = fix || `In Brave: Settings → Privacy and security → WebRTC IP handling policy → Default. In uBlock Origin, untick "Prevent WebRTC from leaking local IP addresses". A VPN can do this too.${r.relayConfigured ? '' : ' Once the game has a relay that works over TCP, this setting stops mattering.'}`;
    return { verdict, lines, fix };
  }
  lines.push(`✓ WebRTC works in this browser${r.mdns && r.mdns === r.host ? ' (local addresses hidden, which is normal)' : ''}.`);
  if (r.srflx) lines.push('✓ The network lets the connection helper (STUN) through.');
  else lines.push('✗ The network blocks the connection helper (STUN).');
  if (r.relay) lines.push(`✓ A relay is available${r.relayTcp ? ', including over TCP' : ''}: this works even on strict networks.`);
  else if (r.relayConfigured) lines.push('✗ A relay is configured but did not answer from this network.');
  else lines.push('– No relay is set up for this game yet.');
  if (r.relay) {
    verdict = verdict === 'bad' ? 'bad' : 'ok';
  } else if (!r.srflx) {
    verdict = verdict === 'bad' ? 'bad' : 'relay';
    fix = fix || 'You can only reach players whose devices can see yours directly. School and office Wi-Fi often keep devices apart, so joining times out. A relay fixes this; until then, try a phone hotspot or mobile data, on either side.';
  } else {
    verdict = verdict === 'bad' ? 'bad' : 'warn';
    fix = fix || 'Direct connections should work. If joining still times out, this network keeps devices apart (common on school Wi-Fi) and a relay is needed; meanwhile try a phone hotspot.';
  }
  return { verdict, lines, fix };
}

// One line for the console, so a screenshot of it says everything.
export function summary(r) {
  return `[BidLock rooms] rooms:${r.rooms || 'none'} server:${r.signalling} webrtc:${r.webrtc ? 'on' : 'off'} host:${r.host}${r.mdns ? `(mdns ${r.mdns})` : ''} stun:${r.srflx} relay:${r.relay}${r.relayTcp ? `(tcp ${r.relayTcp})` : ''} relayConfigured:${r.relayConfigured ? 'yes' : 'no'} ${r.ms}ms${r.errors.length ? ` errors: ${r.errors.join(' | ')}` : ''}`;
}
