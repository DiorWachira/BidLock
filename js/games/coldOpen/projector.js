// COLD OPEN — the projector: real trailers, a few seconds at a time.
//
// Each trailer is a <video> (cross-origin, muted, inline). Apple's previews stream with
// byte ranges and keep their index at the front, so parking a trailer mid-way downloads
// only the seconds around that point. The stage draws the video as a texture through the
// fault shader. The clip loops like a spliced film loop (a flash at the join) until the
// changeover, when the loop lets go and the sound comes up through the shell's master
// bus. The projector's own sounds (the clatter, the leader's pop, the changeover's
// clunk) are synthesised.

const HAVE_CURRENT_DATA = 2;
const MAX_REELS = 4;

// Where a clip starts, in seconds. A video that does not know its own length (a live
// recording) starts at the top.
export const clipStart = (frac, duration, len) => (Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(frac * duration, duration - len - 1)) : 0);

export class Projector {
  constructor(audio) {
    this.audio = audio; // the shell's sound engine: context and master bus
    this.reels = new Map(); // url -> reel
    this.reel = null; // the reel on screen
    this.looping = true;
    this.splice = 0; // a flash at the loop's join, 1 -> 0
    this.tier = 0; // 1: the trailer is running, 0: no picture
    this.token = 0;
    this.clatter = null;
    this.played = []; // urls already shown this match, oldest first (wrong-reel decoys)
  }

  get ctx() { return this.audio && this.audio.ctx; }

  _reel(url) {
    let r = this.reels.get(url);
    if (r) { r.used = now(); return r; }
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.preload = 'auto';
    r = { url, video: v, duration: 0, start: 0, len: 3, frac: 0.3, state: 'loading', used: now(), source: null, gain: null, err: null };
    v.addEventListener('loadedmetadata', () => { r.duration = v.duration || 0; });
    v.addEventListener('error', () => { r.state = 'failed'; r.err = v.error ? v.error.code : 'error'; });
    v.src = url;
    this.reels.set(url, r);
    this._trim();
    return r;
  }

  // Keep a few reels: the one on screen, the next, and recent ones (for decoys).
  _trim() {
    if (this.reels.size <= MAX_REELS) return;
    const spare = [...this.reels.values()].filter((r) => r !== this.reel).sort((a, b) => a.used - b.used);
    while (this.reels.size > MAX_REELS && spare.length) this._drop(spare.shift());
  }

  _drop(r) {
    this.reels.delete(r.url);
    try { r.video.pause(); r.video.removeAttribute('src'); r.video.load(); } catch { /* gone */ }
    try { if (r.source) r.source.disconnect(); if (r.gain) r.gain.disconnect(); } catch { /* gone */ }
  }

  // Thread a clip: load the trailer and park it on the clip's first frame. Resolves true
  // when it can play, false if it cannot in time.
  cue(url, frac, len, timeoutMs = 8000) {
    if (!url) return Promise.resolve(false);
    const r = this._reel(url);
    r.frac = frac;
    r.len = len;
    if (r.state === 'failed') return Promise.resolve(false);
    const v = r.video;
    return new Promise((resolve) => {
      let done = false;
      const off = () => {
        v.removeEventListener('loadedmetadata', seek);
        v.removeEventListener('seeked', check);
        v.removeEventListener('loadeddata', check);
        v.removeEventListener('canplay', check);
        v.removeEventListener('error', fail);
      };
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        if (ok) r.state = 'ready';
        resolve(ok);
      };
      function seek() {
        if (!r.duration) r.duration = v.duration || 0;
        if (!r.duration) return;
        r.start = clipStart(r.frac, r.duration, r.len);
        if (Math.abs(v.currentTime - r.start) > 0.05) v.currentTime = r.start;
        else check();
      }
      function check() {
        if (r.duration && Math.abs(v.currentTime - r.start) < 0.3 && v.readyState >= HAVE_CURRENT_DATA) finish(true);
      }
      function fail() { finish(false); }
      const timer = setTimeout(() => finish(r.state === 'ready'), timeoutMs);
      v.addEventListener('loadedmetadata', seek);
      v.addEventListener('seeked', check);
      v.addEventListener('loadeddata', check);
      v.addEventListener('canplay', check);
      v.addEventListener('error', fail);
      if (v.readyState >= 1) seek();
    });
  }

  // Run a clip. Returns the tier: 1 if the trailer is running, 0 if there is no picture.
  async play(url, frac, len) {
    this.stop(false);
    const token = ++this.token;
    if (!url) { this.tier = 0; return 0; }
    const ok = await this.cue(url, frac, len, 3000);
    if (token !== this.token) return this.tier;
    const r = this.reels.get(url);
    if (!ok || !r) { this.tier = 0; return 0; }
    this.reel = r;
    this.looping = true;
    this._sound(r, false);
    try {
      r.video.currentTime = r.start;
      await r.video.play();
    } catch {
      if (token === this.token) { this.tier = 0; this.reel = null; }
      return 0;
    }
    if (token !== this.token) return this.tier;
    if (!this.played.includes(url)) this.played.push(url);
    this.tier = 1;
    this._clatter(true);
    return 1;
  }

  // The changeover: the loop lets go and the sound comes up.
  changeover() {
    this.looping = false;
    if (this.reel) this._sound(this.reel, true);
    this._clatter(false);
    this.clunk();
  }

  _sound(r, on) {
    const ctx = this.ctx;
    if (ctx && this.audio.master) {
      try {
        if (!r.source) {
          r.source = ctx.createMediaElementSource(r.video);
          r.gain = ctx.createGain();
          r.gain.gain.value = 0;
          r.source.connect(r.gain);
          r.gain.connect(this.audio.master);
        }
        r.video.muted = false;
        r.gain.gain.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, on ? 0.15 : 0.04);
        return;
      } catch { /* fall back to the element's own volume */ }
    }
    r.video.muted = !on;
  }

  // Stops the reel, and any reel still being threaded to start.
  stop(clatter = true) {
    this.token++;
    if (this.reel) {
      const r = this.reel;
      this._sound(r, false);
      try { r.video.pause(); } catch { /* gone */ }
    }
    this.reel = null;
    if (clatter) this._clatter(false);
  }

  // Each frame: loop the clip like a spliced loop of film.
  update(dt) {
    this.splice = Math.max(0, this.splice - dt * 7);
    const r = this.reel;
    if (!r || !this.looping) return;
    const v = r.video;
    if (v.currentTime >= r.start + r.len || v.ended) {
      v.currentTime = r.start;
      this.splice = 1;
      if (v.paused) v.play().catch(() => {});
    }
  }

  // The video on screen, and one already shown (for a wrong-reel decoy).
  video() { return this.reel && this.tier === 1 ? this.reel.video : null; }
  decoyVideo(prefer = '') {
    const pick = (url) => {
      const r = url && this.reels.get(url);
      return r && r !== this.reel && r.state === 'ready' ? r.video : null;
    };
    return pick(prefer) || [...this.played].reverse().map(pick).find(Boolean) || null;
  }
  aspect() {
    const v = this.video();
    return v && v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;
  }

  // ---------- the booth's own sounds ----------
  _clatter(on) {
    const ctx = this.ctx;
    if (!ctx || !this.audio.master) return;
    if (on && !this.clatter) {
      // 24 frames a second: a shutter tick through a band of noise, quiet under the room.
      const len = Math.round(ctx.sampleRate / 24);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12)) * 0.9 + (Math.random() * 2 - 1) * 0.05;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2400;
      band.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.045, ctx.currentTime, 0.2);
      src.connect(band).connect(g).connect(this.audio.master);
      src.start();
      this.clatter = { src, g };
    } else if (!on && this.clatter) {
      const { src, g } = this.clatter;
      this.clatter = null;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => { try { src.stop(); src.disconnect(); g.disconnect(); } catch { /* gone */ } }, 600);
    }
  }

  // The leader's "2-pop": one frame of 1 kHz.
  pop() { this._tone(1000, 0.042, 0.25, 'sine'); }
  // The changeover: the douser drops and the other projector takes over.
  clunk() { this._tone(90, 0.12, 0.35, 'square'); }

  _tone(freq, dur, vol, type) {
    const ctx = this.ctx;
    if (!ctx || !this.audio.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.setTargetAtTime(0, ctx.currentTime + dur * 0.7, dur * 0.2);
    o.connect(g).connect(this.audio.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.1);
  }

  // For the tests.
  status() {
    const r = this.reel;
    return {
      tier: this.tier,
      url: r ? r.url : '',
      playing: !!(r && !r.video.paused),
      time: r ? r.video.currentTime : 0,
      start: r ? r.start : 0,
      len: r ? r.len : 0,
      looping: this.looping,
      sound: !!(r && ((r.gain && r.gain.gain.value > 0.01) || (!r.gain && !r.video.muted))),
      reels: [...this.reels.values()].map((x) => x.state),
    };
  }

  dispose() {
    this.token++;
    this._clatter(false);
    for (const r of [...this.reels.values()]) this._drop(r);
    this.reel = null;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
