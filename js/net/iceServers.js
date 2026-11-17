// How browsers in a room find a path to each other (WebRTC ICE servers).
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

export function iceServers() {
  return [...STUN_SERVERS, ...TURN_SERVERS, ...storedTurn()];
}

export function hasRelay() {
  return TURN_SERVERS.length > 0 || storedTurn().length > 0;
}
