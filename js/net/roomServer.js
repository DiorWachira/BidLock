// Where the BidLock room server lives (the Worker in server/, deployed to Cloudflare).
//
// With it, every player connects through the server: that works on any network that can
// open a web page. PeerJS (direct WebRTC) stays as the fallback for when the server cannot
// be reached. Empty: rooms use PeerJS only, as before.
export const ROOM_SERVER = 'wss://bidlock-rooms.njoroge-wachira.workers.dev';

// For testing without editing code:  ?rooms=ws://127.0.0.1:8787  (this page only), or
// localStorage['bidlock.rooms'] = 'wss://...'  (this browser). "off" turns it off.
export function roomServerUrl(search = typeof location !== 'undefined' ? location.search : '') {
  const pick = (v) => (typeof v === 'string' && /^(wss?|https?):\/\/[^\s]+$/.test(v.trim()) ? v.trim() : v === 'off' ? '' : null);
  try {
    const q = new URLSearchParams(search).get('rooms');
    if (q != null) { const v = pick(q); if (v != null) return v; }
  } catch { /* no query */ }
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem('bidlock.rooms') : null;
    if (s != null) { const v = pick(s); if (v != null) return v; }
  } catch { /* storage blocked */ }
  return ROOM_SERVER;
}
