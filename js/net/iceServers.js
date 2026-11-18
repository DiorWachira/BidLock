// How browsers in a room find a path to each other (WebRTC ICE servers).
//
// Rooms normally go through the BidLock room server (roomServer.js), which needs none of
// this. These are for the fallback: a direct WebRTC connection over PeerJS.
//
// STUN lets two browsers discover their public addresses and connect directly. That
// works on most home and office networks. It does not work when one side is behind a
// strict NAT, which is common on mobile data: those players need a TURN relay, which
// passes the traffic through a server. Without one they see "Joining timed out".
//
// PeerJS used to bundle free TURN servers (eu-0/us-0.turn.peerjs.com). Those names no
// longer exist, so BidLock has no relay unless one is added here. Free tiers exist
// (for example Metered or ExpressTURN, after signing up). Paste the server list they
// give you into TURN_SERVERS:
//
//   export const TURN_SERVERS = [
//     { urls: 'turn:<host>:80', username: '<username>', credential: '<password>' },
//     { urls: 'turn:<host>:443?transport=tcp', username: '<username>', credential: '<password>' },
//   ];
//
// This is a static site, so these credentials are public. Use a provider's restricted,
// low-quota credentials for this, never an account password.

export const STUN_SERVERS = Object.freeze([
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
]);

export const TURN_SERVERS = Object.freeze([]);

// Or, for providers that hand out credentials from a URL (Metered's free plan:
// https://<your-app>.metered.live/api/v1/turn/credentials?apiKey=<key>), put that URL
// here. It is fetched when a room is opened or joined, and its servers are added.
export const TURN_CREDENTIALS_URL = '';

// A relay can also be supplied without editing code, for testing:
// localStorage['bidlock.turn'] = JSON.stringify([{ urls, username, credential }])
function storedTurn() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('bidlock.turn') : null;
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => s && s.urls) : [];
  } catch {
    return [];
  }
}

let fetched = [];
let fetchedAt = 0;

// The servers fetched from TURN_CREDENTIALS_URL, refreshed every ten minutes. Never
// throws and never waits more than a few seconds: without them, STUN still works.
export async function loadIceServers({ url = TURN_CREDENTIALS_URL, fetchImpl = null, timeoutMs = 4000 } = {}) {
  if (!url) return iceServers();
  if (fetched.length && Date.now() - fetchedAt < 10 * 60 * 1000) return iceServers();
  const doFetch = fetchImpl || (typeof fetch === 'function' ? (...a) => fetch(...a) : null);
  if (!doFetch) return iceServers();
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    const list = res.ok ? await res.json() : [];
    fetched = (Array.isArray(list) ? list : list.iceServers || []).filter((x) => x && x.urls);
    fetchedAt = Date.now();
  } catch { /* keep whatever we had */ } finally {
    if (timer) clearTimeout(timer);
  }
  return iceServers();
}

export function iceServers() {
  return [...STUN_SERVERS, ...TURN_SERVERS, ...storedTurn(), ...fetched];
}

export function hasRelay() {
  return TURN_SERVERS.length > 0 || storedTurn().length > 0 || fetched.length > 0;
}
