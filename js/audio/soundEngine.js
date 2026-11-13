// BIDLOCK — procedural sound. Web Audio only: every knock, tick, chime, riser and the
// studio backing track is synthesised here. Nothing is loaded from a file.
// The context is created on the first user gesture (browsers require it).

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note to Hz

// A minor: Am, F, C, G. One bar each.
const PROGRESSION = [
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [57, 60, 65] },
  { root: 48, chord: [55, 60, 64] },
  { root: 43, chord: [55, 59, 62] },
];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const ARP_SCALE = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84]; // A minor pentatonic, climbing

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
    this.tension = 0;
    this.musicOn = false;
    this.musicTimer = null;
    this.step = 0;
    this.nextTime = 0;
    this.failed = false;
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  // Call from a click or key press. Safe to call repeatedly.
  unlock() {
    if (this.failed) return false;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.failed = true; return false; }
        const ctx = new AC();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.comp = ctx.createDynamicsCompressor();
        this.comp.threshold.value = -14;
        this.comp.ratio.value = 4;
        this.master.connect(this.comp);
        this.comp.connect(ctx.destination);
        this.sfx = ctx.createGain();
        this.sfx.gain.value = 0.9;
        this.sfx.connect(this.master);
        this.music = ctx.createGain();
        this.music.gain.value = 0.0;
        this.musicFilter = ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = 1400;
        this.music.connect(this.musicFilter);
        this.musicFilter.connect(this.master);
        // Two seconds of white noise, reused for every noise-based sound.
        const len = ctx.sampleRate * 2;
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._applyVolume();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    } catch (err) {
      this.failed = true;
      console.warn('[bidlock] audio unavailable:', err);
      return false;
    }
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this._applyVolume(); }
  setMuted(m) { this.muted = !!m; this._applyVolume(); }

  _applyVolume() {
    if (!this.ctx) return;
    const target = this.muted ? 0 : this.volume * 0.9;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  // ---------- building blocks ----------
  _tone({ type = 'sine', freq = 440, to = null, t = 0, dur = 0.2, peak = 0.3, attack = 0.004, dest = null, filter = null, detune = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.freq, t0);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t0 + dur);
      f.Q.value = filter.q || 0.7;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest || this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ t = 0, dur = 0.2, peak = 0.3, type = 'bandpass', freq = 1000, to = null, q = 1, attack = 0.002, dest = null, swell = false }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    if (swell) {
      g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.95);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfx);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  // ---------- sound effects ----------
  // Crisp wooden gavel knock: two short woody partials and a click.
  knock(strength = 1) {
    this._tone({ type: 'triangle', freq: 880, to: 620, dur: 0.07, peak: 0.5 * strength });
    this._tone({ type: 'sine', freq: 1420, to: 1100, dur: 0.045, peak: 0.28 * strength });
    this._tone({ type: 'sine', freq: 240, to: 150, dur: 0.09, peak: 0.35 * strength });
    this._noise({ dur: 0.03, peak: 0.25 * strength, type: 'highpass', freq: 2500 });
  }

  // SOLD: the knock, plus a heavy sub drop and room thump.
  slam() {
    this.knock(1.3);
    this._tone({ type: 'sine', freq: 120, to: 34, dur: 0.75, peak: 0.95, attack: 0.006 });
    this._tone({ type: 'triangle', freq: 62, to: 40, dur: 0.5, peak: 0.4 });
    this._noise({ dur: 0.35, peak: 0.4, type: 'lowpass', freq: 900, to: 120 });
    this._noise({ t: 0.02, dur: 0.9, peak: 0.08, type: 'bandpass', freq: 3200, q: 0.5 });
  }

  // Three-note climb that sits higher the higher the bid.
  arp(bid = 1) {
    const base = Math.max(0, Math.min(ARP_SCALE.length - 3, bid - 1));
    for (let i = 0; i < 3; i++) {
      this._tone({ type: 'square', freq: NOTE(ARP_SCALE[base + i]), t: 0.03 + i * 0.055, dur: 0.11, peak: 0.09, filter: { freq: 2600 } });
      this._tone({ type: 'triangle', freq: NOTE(ARP_SCALE[base + i] + 12), t: 0.03 + i * 0.055, dur: 0.09, peak: 0.05 });
    }
  }

  tick(urgent = false) {
    this._tone({ type: 'square', freq: urgent ? 2400 : 1900, dur: 0.025, peak: urgent ? 0.2 : 0.13, filter: { type: 'bandpass', freq: 2200, q: 3 } });
  }

  heartbeat() {
    this._tone({ type: 'sine', freq: 68, to: 42, dur: 0.16, peak: 0.75 });
    this._tone({ type: 'sine', freq: 60, to: 38, t: 0.2, dur: 0.2, peak: 0.55 });
  }

  // Ka-ching: drawer rattle, then two bell partials.
  register() {
    this._noise({ dur: 0.06, peak: 0.25, type: 'highpass', freq: 4000 });
    [[1568, 0.07], [2093, 0.15]].forEach(([f, t]) => {
      this._tone({ type: 'sine', freq: f, t, dur: 0.7, peak: 0.22 });
      this._tone({ type: 'sine', freq: f * 2.76, t, dur: 0.3, peak: 0.07 });
    });
  }

  pass() {
    this._tone({ type: 'triangle', freq: 330, to: 196, dur: 0.18, peak: 0.16 });
  }

  blip() {
    this._tone({ type: 'square', freq: 660, dur: 0.04, peak: 0.07, filter: { freq: 1800 } });
  }

  denied() {
    this._tone({ type: 'sawtooth', freq: 140, dur: 0.12, peak: 0.16, filter: { freq: 700 } });
    this._tone({ type: 'sawtooth', freq: 110, t: 0.1, dur: 0.16, peak: 0.16, filter: { freq: 700 } });
  }

  whoosh() {
    this._noise({ dur: 0.45, peak: 0.16, type: 'bandpass', freq: 400, to: 2600, q: 1.2, swell: true });
  }

  // Mystery crate: noise sweep and a stacked brass chord bending upward.
  riser(dur = 2.6) {
    this._noise({ dur, peak: 0.3, type: 'bandpass', freq: 220, to: 5200, q: 2.5, swell: true });
    [45, 52, 57, 64].forEach((n, i) => {
      this._tone({ type: 'sawtooth', freq: NOTE(n), to: NOTE(n + 7), dur, peak: 0.07, attack: dur * 0.7, detune: i * 6 - 9, filter: { freq: 500, to: 3800, q: 1 } });
    });
    for (let i = 0; i < 14; i++) {
      const t = dur * (1 - Math.pow(1 - i / 14, 2));
      this._tone({ type: 'sine', freq: 70, to: 45, t, dur: 0.1, peak: 0.25 + i * 0.02 });
    }
  }

  _brass(note, t, dur, peak = 0.16) {
    [-7, 0, 7].forEach((det) => {
      this._tone({ type: 'sawtooth', freq: NOTE(note), t, dur, peak: peak / 2, attack: 0.03, detune: det, filter: { freq: 700, to: 2600, q: 1.2 } });
    });
  }

  fanfare() {
    const seq = [[60, 0, 0.16], [64, 0.16, 0.16], [67, 0.32, 0.16], [72, 0.48, 0.5], [67, 0.98, 0.14], [72, 1.12, 0.9]];
    for (const [n, t, d] of seq) { this._brass(n, t, d); this._brass(n - 12, t, d, 0.1); }
    this._noise({ t: 0.48, dur: 0.6, peak: 0.1, type: 'highpass', freq: 6000 });
  }

  // Wah, wah, wah, waaah.
  trombone() {
    const seq = [[58, 0, 0.36], [57, 0.4, 0.36], [56, 0.8, 0.36], [55, 1.2, 1.1]];
    for (const [n, t, d] of seq) {
      const last = d > 1;
      this._tone({ type: 'sawtooth', freq: NOTE(n), to: NOTE(n - (last ? 2.2 : 0.6)), t, dur: d, peak: 0.2, attack: 0.05, filter: { freq: 1100, to: last ? 320 : 600, q: 3 } });
    }
  }

  vaultLock() {
    this._tone({ type: 'square', freq: 180, dur: 0.05, peak: 0.25, filter: { freq: 900 } });
    this._noise({ t: 0.05, dur: 0.12, peak: 0.3, type: 'bandpass', freq: 1400, q: 4 });
    this._tone({ type: 'sine', freq: 90, to: 55, t: 0.1, dur: 0.25, peak: 0.5 });
  }

  alarm() {
    for (let i = 0; i < 4; i++) {
      this._tone({ type: 'square', freq: i % 2 ? 740 : 988, t: i * 0.13, dur: 0.12, peak: 0.12, filter: { freq: 2400 } });
    }
  }

  countUp(step = 0) {
    this._tone({ type: 'triangle', freq: 500 + step * 40, dur: 0.05, peak: 0.08 });
  }

  // ---------- backing track ----------
  startMusic() {
    if (!this.ready || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.music.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.4);
    this.musicTimer = setInterval(() => this._schedule(), 50);
  }

  stopMusic() {
    if (!this.musicOn) return;
    this.musicOn = false;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx) this.music.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.25);
  }

  // 0 = cruising, 1 = last call. Opens the filter, tightens the hats, lifts the tempo.
  setTension(v) {
    this.tension = Math.max(0, Math.min(1, v));
    if (this.ready) this.musicFilter.frequency.setTargetAtTime(1300 + this.tension * 3200, this.ctx.currentTime, 0.2);
  }

  _schedule() {
    if (!this.ready || !this.musicOn) return;
    const bpm = 104 + this.tension * 16;
    const stepDur = 60 / bpm / 4;
    // If the tab was asleep, do not try to catch up on a backlog of beats.
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + 0.16) {
      this._playStep(this.step, this.nextTime - this.ctx.currentTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  _playStep(step, t, stepDur) {
    const bar = PROGRESSION[Math.floor(step / 16) % 4];
    const s = step % 16;
    const m = this.music;
    if (s % 8 === 0) this._tone({ type: 'sine', freq: 130, to: 44, t, dur: 0.22, peak: 0.6, dest: m });
    if (s % 8 === 4) {
      this._noise({ t, dur: 0.12, peak: 0.22, type: 'bandpass', freq: 1700, q: 0.8, dest: m });
      this._tone({ type: 'triangle', freq: 190, to: 120, t, dur: 0.08, peak: 0.18, dest: m });
    }
    const hat = this.tension > 0.5 ? true : s % 2 === 0;
    if (hat) this._noise({ t, dur: 0.03, peak: s % 4 === 2 ? 0.09 : 0.05, type: 'highpass', freq: 7000, dest: m });
    if (BASS_STEPS.includes(s)) {
      const n = bar.root + (s === 6 || s === 14 ? 12 : 0) - 12;
      this._tone({ type: 'sawtooth', freq: NOTE(n + 12), t, dur: stepDur * 1.7, peak: 0.2, attack: 0.008, dest: m, filter: { freq: 900, to: 220, q: 4 } });
    }
    if (s === 0 || s === 10) {
      for (const n of bar.chord) {
        this._tone({ type: 'sawtooth', freq: NOTE(n), t, dur: stepDur * 3.2, peak: 0.045, attack: 0.012, dest: m, detune: 5, filter: { freq: 2200, to: 500, q: 1 } });
      }
    }
    if (this.tension > 0.25 && s % 4 === 3) {
      const n = bar.chord[(step >> 2) % 3] + 12;
      this._tone({ type: 'square', freq: NOTE(n), t, dur: stepDur * 0.9, peak: 0.03, dest: m, filter: { freq: 3000 } });
    }
  }
}
