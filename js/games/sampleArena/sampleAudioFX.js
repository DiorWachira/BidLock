// SOUNDCLASH — the sound system. Plays the three-second hook, warps it, sabotages it, and
// feeds the turntable's spectrum ring. Three tiers, so a round never goes silent:
//
//   1  Web Audio buffer: the preview is fetched and decoded. True reverse, pitch and
//      speed warps, filters and a live FFT.
//   2  HTML5 audio: if the preview cannot be fetched (CORS, a slow network), the same
//      URL streams through an <audio> element (playbackRate with preservesPitch off for
//      the warps). Effects that need the raw samples are layered on as synthesised
//      noise, and the spectrum ring follows a beat-synced envelope instead.
//   3  Offline synth: with no iTunes at all, the match uses public-domain tunes rendered
//      to a buffer, which then goes through tier 1's whole graph.
//
// Graph: source -> per-source fade -> preGain -> BiquadFilter -> WaveShaper ->
//        AnalyserNode (fftSize 128, so 64 bins) -> outGain -> the shell's master bus.

import { renderTune, tuneById } from './synthTunes.js';
import { SNIPPET } from './itunesLoader.js';

export const WARPS = Object.freeze({
  NIGHTCORE_UP: { key: 'NIGHTCORE_UP', label: 'NIGHTCORE', badge: 'NIGHTCORE 1.35x', fader: '+35%', rate: 1.35 },
  CHOPPED_SCREWED: { key: 'CHOPPED_SCREWED', label: 'CHOPPED & SCREWED', badge: 'CHOPPED & SCREWED 0.72x', fader: '−28%', rate: 0.72 },
  UNDERWATER_SUB: { key: 'UNDERWATER_SUB', label: 'UNDERWATER SUB', badge: 'UNDERWATER SUB 320 Hz', fader: 'LP 320', rate: 1, lowpass: 320, q: 12 },
  REVERSE_SPIN: { key: 'REVERSE_SPIN', label: 'REVERSE SPIN', badge: 'REVERSE SPIN', fader: 'REV', rate: 1, reverse: true },
  CLEAN_FINAL: { key: 'CLEAN_FINAL', label: 'CLEAN CUT', badge: 'CLEAN CUT · DUBPLATE SPECIAL', fader: '±0%', rate: 1 },
});
const CLEAN = { key: 'CLEAN', label: 'CLEAN', rate: 1 };
const XFADE = 0.02; // seconds: the crossfade baked into each loop seam
const BINS = 64;

// A loopable three-second slice: the tail is crossfaded (equal power) into the head, so
// the loop point never clicks. Reversed slices read the window backwards.
export function makeLoop(ctx, src, start, { len = SNIPPET, xf = XFADE, reverse = false } = {}) {
  const sr = src.sampleRate;
  const L = Math.max(1, Math.round(len * sr));
  const X = Math.max(1, Math.round(xf * sr));
  const s0 = Math.max(0, Math.min(Math.round(start * sr), src.length - L - X - 1));
  const out = ctx.createBuffer(src.numberOfChannels, L, sr);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const inp = src.getChannelData(ch);
    const o = out.getChannelData(ch);
    const seg = reverse ? (i) => inp[s0 + L + X - 1 - i] || 0 : (i) => inp[s0 + i] || 0;
    for (let i = 0; i < L; i++) {
      if (i < X) {
        const w = (i / X) * (Math.PI / 2);
        o[i] = seg(i) * Math.sin(w) + seg(L + i) * Math.cos(w);
      } else {
        o[i] = seg(i);
      }
    }
  }
  return out;
}

export class SampleDeck {
  constructor(audio) {
    this.audio = audio; // the shell's sound engine: its context and master bus
    this.cache = new Map(); // url -> { state, data, buffer, promise }
    this.synthCache = new Map();
    this.tier = 0; // 0 silent, 1 buffer, 2 element, 3 synth
    this.warp = CLEAN;
    this.clean = false;
    this.fx = { under: false, shock: null };
    this.src = null; // { node, gain, reverse }
    this.el = null;
    this.elStart = 0;
    this.lost = false;
    this.spec = new Uint8Array(BINS);
    this.fake = new Float32Array(BINS);
    this.clock = 0;
    this.wobbleUntil = 0;
    this.playing = false;
    this.queue = [];
    this.fetching = false;
    this.fetchImpl = null;
  }

  get ctx() { return this.audio && this.audio.ctx; }

  // ---------- the graph ----------
  _graph() {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (this.pre && this.pre.context === ctx) return true;
    this.pre = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.7;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = null;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.72;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.pre.connect(this.filter);
    this.filter.connect(this.shaper);
    this.shaper.connect(this.analyser);
    this.analyser.connect(this.out);
    this.out.connect(this.audio.master);
    this.foley = ctx.createGain();
    this.foley.gain.value = 0.8;
    this.foley.connect(this.audio.master);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    return true;
  }

  // ---------- fetching ----------
  // Previews are fetched one at a time, in order, so round 1 is ready first.
  prefetch(urls) {
    for (const u of urls) if (u && !this.cache.has(u)) { this.cache.set(u, { state: 'queued' }); this.queue.push(u); }
    this._pump();
  }

  async _pump() {
    if (this.fetching) return;
    this.fetching = true;
    while (this.queue.length) {
      const url = this.queue.shift();
      await this._load(url);
    }
    this.fetching = false;
  }

  // Bring one URL to the front of the queue and wait (briefly) for it.
  async ready(url, waitMs = 1200) {
    if (!url) return false;
    const e = this.cache.get(url);
    if (e && e.state === 'ok') return true;
    if (!e || e.state === 'queued') {
      this.queue = this.queue.filter((u) => u !== url);
      this.cache.set(url, { state: 'queued' });
      this._load(url);
    }
    const entry = this.cache.get(url);
    if (!entry.promise) return false;
    const timeout = new Promise((r) => setTimeout(() => r(false), waitMs));
    return Promise.race([entry.promise.then(() => this.cache.get(url).state === 'ok'), timeout]);
  }

  _load(url) {
    const entry = this.cache.get(url) || { state: 'queued' };
    if (entry.promise) return entry.promise;
    entry.state = 'loading';
    const doFetch = this.fetchImpl || ((...a) => fetch(...a));
    entry.promise = (async () => {
      try {
        const res = await doFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const ctx = this.ctx || (typeof OfflineAudioContext !== 'undefined' ? new OfflineAudioContext(2, 1, 44100) : null);
        if (!ctx) throw new Error('no audio');
        entry.buffer = await ctx.decodeAudioData(data);
        entry.state = 'ok';
      } catch (err) {
        // CORS, offline, or an undecodable file: tier 2 will stream it instead.
        entry.state = 'failed';
        entry.error = String(err && err.message ? err.message : err);
      }
    })();
    this.cache.set(url, entry);
    return entry.promise;
  }

  _synthBuffer(id) {
    if (this.synthCache.has(id)) return this.synthCache.get(id);
    const tune = tuneById(id);
    if (!tune || !this.ctx) return null;
    const sr = this.ctx.sampleRate;
    const pcm = renderTune(tune, sr, 8);
    const buf = this.ctx.createBuffer(1, pcm.length, sr);
    buf.getChannelData(0).set(pcm);
    this.synthCache.set(id, buf);
    return buf;
  }

  // ---------- playing a round ----------
  // `track`: { url, synth, start }. Returns the tier used.
  async play(track, warpKey) {
    this.stop(0.03);
    this.warp = WARPS[warpKey] || CLEAN;
    this.clean = false;
    this.full = null;
    this.fx = { under: false, shock: null };
    this.lost = false;
    this.playing = true;
    const token = (this.token = (this.token || 0) + 1);
    if (!this._graph()) { this.tier = 2; return this._playElement(track); }
    let buffer = null;
    let tier = 0;
    if (track.synth) { buffer = this._synthBuffer(track.synth); tier = 3; }
    else if (track.url) {
      const ok = await this.ready(track.url, 900);
      if (token !== this.token) return this.tier;
      const e = this.cache.get(track.url);
      if (ok && e && e.buffer) { buffer = e.buffer; tier = 1; }
    }
    if (token !== this.token) return this.tier;
    if (buffer) {
      const start = track.synth ? 0 : track.start || 0;
      this.loops = { fwd: makeLoop(this.ctx, buffer, start), rev: makeLoop(this.ctx, buffer, start, { reverse: true }) };
      // The whole preview, for the clean overtime: the song plays on from the hook.
      this.full = { buffer, start };
      this.tier = tier;
      this._startSource();
      this._apply(true);
      return tier;
    }
    this.tier = 2;
    return this._playElement(track);
  }

  _startSource() {
    const ctx = this.ctx;
    const s = this._state();
    const node = ctx.createBufferSource();
    // Clean and forwards: the song itself from the hook (round to the hook again at the
    // end of the preview). Otherwise the three-second loop.
    const full = this.clean && !s.reverse && this.full;
    node.buffer = full ? this.full.buffer : s.reverse ? this.loops.rev : this.loops.fwd;
    node.loop = true;
    if (full) { node.loopStart = this.full.start; node.loopEnd = this.full.buffer.duration; }
    node.playbackRate.value = s.rate;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, XFADE / 3);
    node.connect(gain);
    gain.connect(this.pre);
    node.start(0, full ? this.full.start : 0);
    if (this.src) this._fadeOut(this.src, 0.04);
    this.src = { node, gain, reverse: s.reverse, full: !!full };
  }

  _fadeOut(src, secs) {
    const t = this.ctx.currentTime;
    try {
      src.gain.gain.cancelScheduledValues(t);
      src.gain.gain.setTargetAtTime(0, t, secs / 3);
      src.node.stop(t + secs + 0.05);
    } catch { /* already stopped */ }
  }

  _playElement(track) {
    if (!track.url) { this.tier = 0; this.lost = true; this._static(); return 0; }
    const el = new Audio();
    el.preload = 'auto';
    el.src = track.url;
    el.preservesPitch = false;
    el.mozPreservesPitch = false;
    el.webkitPreservesPitch = false;
    this.el = el;
    this.elStart = track.start || 0;
    el.volume = 0;
    const go = () => {
      if (this.el !== el) return;
      // A server without byte ranges cannot seek: play the preview from the top and let
      // it loop whole rather than fighting the seek every frame.
      this.elSeek = el.seekable.length > 0 && el.seekable.end(0) >= this.elStart + SNIPPET;
      if (this.elSeek) { try { el.currentTime = this.elStart; } catch { this.elSeek = false; } }
      if (!this.elSeek) { this.elStart = 0; el.loop = true; }
      this._apply(true);
      el.play().catch(() => { if (this.el === el) { this.lost = true; this._static(); } });
    };
    if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
    el.addEventListener('error', () => { if (this.el === el) { this.lost = true; this._static(); } }, { once: true });
    return 2;
  }

  stop(fade = 0.12) {
    this.playing = false;
    this.token = (this.token || 0) + 1;
    if (this.src && this.ctx) this._fadeOut(this.src, fade);
    this.src = null;
    if (this.el) { try { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); } catch { /* gone */ } this.el = null; }
    if (this.overlay) { try { this.overlay.stop(); } catch { /* gone */ } this.overlay = null; }
    if (this.staticSrc) { try { this.staticSrc.stop(); } catch { /* gone */ } this.staticSrc = null; }
  }

  // ---------- warps and sabotage ----------
  // Overtime: the warp lifts for everyone still guessing.
  setClean(on = true) { if (this.clean === on) return; this.clean = on; this._apply(); }
  setUnderwater(on) { if (this.fx.under === on) return; this.fx.under = on; this._apply(); }
  // mode: 'reverse' or 'chipmunk'; null to end it
  setShock(mode) { if (this.fx.shock === mode) return; this.fx.shock = mode; this._apply(); }

  _state() {
    const base = this.clean ? CLEAN : this.warp;
    let rate = base.rate || 1;
    let reverse = !!base.reverse;
    let lowpass = base.lowpass || 20000;
    let q = base.q || 0.7;
    if (this.fx.under) { lowpass = Math.min(lowpass, 240); q = 8; }
    if (this.fx.shock === 'reverse') reverse = !reverse;
    if (this.fx.shock === 'chipmunk') rate *= 1.5;
    return { rate, reverse, lowpass, q };
  }

  get rate() {
    const s = this._state();
    return this.playing ? (s.reverse ? -1 : 1) * s.rate : 0;
  }

  _apply(now = false) {
    const s = this._state();
    if (this.tier === 1 || this.tier === 3) {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const k = now ? 0.001 : 0.06;
      this.filter.frequency.setTargetAtTime(s.lowpass, t, k);
      this.filter.Q.setTargetAtTime(s.q, t, k);
      this.shaper.curve = s.lowpass < 400 ? softClip(1.6) : null;
      const wantFull = !!(this.clean && !s.reverse && this.full);
      if (this.src && (this.src.reverse !== s.reverse || this.src.full !== wantFull)) this._startSource();
      else if (this.src) this.src.node.playbackRate.setTargetAtTime(s.rate, t, k);
    } else if (this.tier === 2 && this.el) {
      // No raw samples: reverse becomes a slowed, band-limited "radio" take, and
      // filters become a muffled level plus a synthesised overlay.
      const radio = s.reverse;
      const rate = radio ? 0.75 * (this.fx.shock === 'chipmunk' ? 1.5 : 1) : s.rate;
      try { this.el.playbackRate = Math.max(0.5, Math.min(2, rate)); } catch { /* unsupported */ }
      this.elMuffle = s.lowpass < 1000 ? 0.35 : radio ? 0.7 : 1;
      this._overlay(s.lowpass < 1000 ? 'under' : radio ? 'radio' : null);
    }
  }

  // ---------- tier 2 overlays and the static fallback ----------
  _overlay(kind) {
    if (this.overlayKind === kind) return;
    this.overlayKind = kind;
    if (this.overlay) { try { this.overlay.stop(); } catch { /* gone */ } this.overlay = null; }
    if (!kind || !this._graph()) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'under' ? 'lowpass' : 'bandpass';
    f.frequency.value = kind === 'under' ? 260 : 1800;
    f.Q.value = kind === 'under' ? 6 : 3;
    const g = ctx.createGain();
    g.gain.value = kind === 'under' ? 0.22 : 0.06;
    src.connect(f);
    f.connect(g);
    g.connect(this.foley);
    src.start();
    this.overlay = src;
  }

  _static() {
    if (!this._graph() || this.staticSrc) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f);
    f.connect(g);
    g.connect(this.foley);
    src.start();
    this.staticSrc = src;
  }

  // ---------- every frame ----------
  update(dt) {
    this.clock += dt;
    const el = this.el;
    if (this.tier === 2 && el && !el.paused) {
      // Loop the window by hand, dipping the level around the seam.
      const end = this.elStart + SNIPPET;
      // Clean overtime lets the song play on past the hook.
      if (this.elSeek && !this.clean && !el.seeking && (el.currentTime >= end || el.currentTime < this.elStart - 0.5)) { try { el.currentTime = this.elStart; } catch { this.elSeek = false; } }
      const pos = el.currentTime - this.elStart;
      const seam = this.elSeek && !this.clean ? Math.min(1, Math.max(0, pos / 0.05), Math.max(0, (SNIPPET - pos) / 0.05)) : 1;
      const vol = this.audio.muted ? 0 : this.audio.volume * 0.9;
      const wobble = this.clock < this.wobbleUntil ? 0.6 : 1;
      el.volume = Math.max(0, Math.min(1, vol * seam * (this.elMuffle || 1) * wobble));
      if (this.clock < this.wobbleUntil) { try { el.playbackRate = Math.max(0.5, 0.6 + 0.4 * Math.abs(Math.sin(this.clock * 18))); } catch { /* unsupported */ } }
      else if (this.wobbled) { this.wobbled = false; this._apply(); }
    }
  }

  // 64 levels, 0-255, for the spectrum ring.
  spectrum() {
    const out = this.spec;
    if ((this.tier === 1 || this.tier === 3) && this.analyser && this.playing) {
      this.analyser.getByteFrequencyData(this.bins);
      for (let i = 0; i < BINS; i++) out[i] = this.bins[i] || 0;
      return out;
    }
    if (this.tier === 2 && this.playing && !this.lost) {
      // A beat-synced envelope, since an un-CORSed stream cannot be analysed.
      const r = Math.abs(this.rate) || 1;
      const beat = (this.clock * 2 * r) % 1;
      const pulse = Math.exp(-beat * 6);
      const muffle = this.elMuffle || 1;
      for (let i = 0; i < BINS; i++) {
        const tilt = 1 - i / BINS;
        const target = 255 * Math.min(1, (0.25 + 0.75 * pulse * tilt * tilt) * (i < 8 ? 1 : muffle) * (0.75 + 0.25 * Math.sin(this.clock * (3 + i * 0.37) + i)));
        this.fake[i] += (target - this.fake[i]) * 0.35;
        out[i] = this.fake[i];
      }
      return out;
    }
    for (let i = 0; i < BINS; i++) out[i] = Math.max(0, out[i] * 0.86);
    return out;
  }

  // Low-end energy, 0 to 1, for the lasers.
  bass() {
    const s = this.spec;
    return (s[0] + s[1] + s[2] + s[3]) / (4 * 255);
  }

  // ---------- club foley (all synthesised) ----------
  needleDrop() {
    if (!this._graph()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g);
    g.connect(this.foley);
    o.start(t);
    o.stop(t + 0.3);
    this._crackle(t, 0.9, 0.08);
  }

  _crackle(t, dur, peak) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() < 0.0025 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * 0.04;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.foley);
    src.start(t);
  }

  // A turntable scratch: a back-and-forth swept noise and a pitch drop on the record.
  scratch(onRecord = true) {
    if (!this._graph()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const t0 = t + k * 0.2;
      const src = ctx.createBufferSource();
      src.buffer = this.audio.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(k ? 2600 : 500, t0);
      f.frequency.exponentialRampToValueAtTime(k ? 400 : 2800, t0 + 0.17);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.03);
      g.gain.linearRampToValueAtTime(0, t0 + 0.18);
      src.connect(f);
      f.connect(g);
      g.connect(this.foley);
      src.start(t0);
      src.stop(t0 + 0.2);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(k ? 600 : 180, t0);
      o.frequency.exponentialRampToValueAtTime(k ? 140 : 700, t0 + 0.17);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t0);
      og.gain.linearRampToValueAtTime(0.06, t0 + 0.03);
      og.gain.linearRampToValueAtTime(0, t0 + 0.18);
      o.connect(og);
      og.connect(this.foley);
      o.start(t0);
      o.stop(t0 + 0.2);
    }
    if (!onRecord) return;
    // the record itself is dragged: pitch drops, then spins back up
    if ((this.tier === 1 || this.tier === 3) && this.src) {
      const p = this.src.node.playbackRate;
      const rate = this._state().rate;
      p.cancelScheduledValues(t);
      p.setValueAtTime(rate, t);
      p.linearRampToValueAtTime(rate * 0.25, t + 0.18);
      p.linearRampToValueAtTime(rate * 1.4, t + 0.38);
      p.linearRampToValueAtTime(rate, t + 0.7);
    } else if (this.tier === 2) {
      this.wobbleUntil = this.clock + 0.7;
      this.wobbled = true;
    }
  }

  // The "pull up" horn: bap, bap, baaap.
  airhorn() {
    if (!this._graph()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [[0, 0.12], [0.16, 0.12], [0.32, 0.55]].forEach(([at, dur]) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1300;
      f.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.22, t + at + 0.015);
      g.gain.setValueAtTime(0.22, t + at + dur - 0.04);
      g.gain.linearRampToValueAtTime(0, t + at + dur);
      f.connect(g);
      g.connect(this.foley);
      for (const det of [0, 9, -7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(466 + det, t + at);
        o.frequency.linearRampToValueAtTime(452 + det, t + at + dur);
        o.connect(f);
        o.start(t + at);
        o.stop(t + at + dur + 0.02);
      }
    });
  }

  // The crowd: a cheer (bright, swelling) or a groan (dark, falling).
  crowd(happy = true) {
    if (!this._graph()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = happy ? 1.3 : 0.9;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = happy ? 1400 : 420;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(happy ? 0.16 : 0.12, t + (happy ? 0.25 : 0.1));
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.foley);
    src.start(t);
    src.stop(t + dur + 0.05);
    const voices = happy ? [[520, 880], [660, 990], [440, 760]] : [[230, 150], [180, 120]];
    voices.forEach(([a, b], i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const at = t + i * 0.07;
      o.frequency.setValueAtTime(a, at);
      o.frequency.exponentialRampToValueAtTime(b, at + dur * 0.7);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, at);
      og.gain.linearRampToValueAtTime(0.035, at + 0.08);
      og.gain.linearRampToValueAtTime(0, at + dur * 0.8);
      o.connect(og);
      og.connect(this.foley);
      o.start(at);
      o.stop(at + dur);
    });
  }

  // A dubplate whistling through the air.
  whoosh() {
    if (!this._graph()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.1);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    o.connect(g);
    g.connect(this.foley);
    o.start(t);
    o.stop(t + 0.65);
  }

  dispose() {
    this.stop(0.05);
    try { if (this.out) this.out.disconnect(); if (this.foley) setTimeout(() => this.foley.disconnect(), 1500); } catch { /* gone */ }
    this.cache.clear();
    this.synthCache.clear();
    this.queue = [];
  }

  // For the tests and the debug panel.
  status() {
    const states = {};
    for (const [u, e] of this.cache) states[u] = e.state;
    return { tier: this.tier, rate: this.rate, clean: this.clean, fx: { ...this.fx }, lost: this.lost, cache: states };
  }
}

function softClip(k) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}
