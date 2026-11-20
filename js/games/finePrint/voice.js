// FINE PRINT — the voice-over, through the browser's own speech engine (Web Speech API).
//
// Two reads: the pitch, at a presenter's pace, and the small print, fast, like the
// disclaimer at the end of an advert. Each device speaks for itself; the reading is
// flavour, never timing, so the game runs the same with no voice at all. Where the
// browser reports word boundaries the screen follows the reading word by word; where it
// does not (or there is no speech), a timer estimates it.

const FAST = 1.75; // the small print
const PITCH = 1.04; // the presenter

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export class Voice {
  constructor({ volume = () => 0.7, enabled = () => true } = {}) {
    this.volume = volume;
    this.enabled = enabled;
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
    this.voice = null;
    this.token = 0;
    this.timers = [];
    if (this.synth) {
      this._pick();
      try { this.synth.addEventListener('voiceschanged', () => this._pick()); } catch { /* older engines */ }
    }
  }

  get available() { return !!this.synth; }

  // An English voice, preferring ones that run on the device (they start quickest).
  _pick() {
    let list = [];
    try { list = this.synth.getVoices() || []; } catch { list = []; }
    const en = list.filter((v) => /^en(-|_|$)/i.test(v.lang));
    const score = (v) => (v.localService ? 2 : 0) + (/en-(GB|US)/i.test(v.lang) ? 1 : 0) + (/natural|online/i.test(v.name) ? 1 : 0);
    this.voice = en.sort((a, b) => score(b) - score(a))[0] || null;
  }

  stop() {
    this.token++;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.synth) { try { this.synth.cancel(); } catch { /* nothing to stop */ } }
  }

  // Seconds a line should take at a rate, for the timer when the browser says nothing.
  static estimate(text, rate = FAST) {
    const words = String(text).trim().split(/\s+/).filter(Boolean).length;
    return (0.35 + words * 0.36) / rate;
  }

  _utter(text, rate) {
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-GB';
    u.rate = rate;
    u.pitch = 1;
    u.volume = Math.max(0, Math.min(1, this.volume()));
    return u;
  }

  // Read one piece of text. onWord(charIndex) as it goes; resolves when done (or skipped).
  _read(text, rate, onWord, token) {
    return new Promise((resolve) => {
      const est = Voice.estimate(text, rate) * 1000;
      const speak = this.synth && this.enabled() && this.volume() > 0;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      // The timer: words light up at an even pace, and it finishes if speech stalls.
      const words = [...String(text).matchAll(/\S+/g)].map((m) => m.index);
      let heard = false;
      words.forEach((at, i) => {
        this.timers.push(setTimeout(() => { if (token === this.token && !heard && onWord) onWord(at); }, (est * i) / Math.max(1, words.length)));
      });
      this.timers.push(setTimeout(finish, speak ? est * 2.2 + 1500 : est));
      if (!speak) return;
      try {
        const u = this._utter(text, rate);
        u.onboundary = (e) => {
          if (token !== this.token || e.name === 'sentence') return;
          heard = true;
          if (onWord) onWord(e.charIndex);
        };
        u.onend = finish;
        u.onerror = finish;
        this.synth.speak(u);
      } catch { /* no voice tonight: the timer carries on */ }
    });
  }

  // The pitch: the offer, with its blank read as a beat and the word "blank".
  async pitch(text) {
    this.stop();
    const token = this.token;
    const spoken = String(text).replace(/_{2,}/g, '… blank …');
    await this._read(spoken, PITCH, null, token);
  }

  // The small print: every line, fast. onLine(i) as each starts; onWord(i, charIndex) as
  // it goes, where charIndex counts within the line's own text.
  async smallPrint(lines, { onLine, onWord, onDone } = {}) {
    this.stop();
    const token = this.token;
    for (let i = 0; i < lines.length; i++) {
      if (token !== this.token) return;
      if (onLine) onLine(i);
      const lead = `Line ${NUM_WORDS[i + 1] || i + 1}: `;
      await this._read(`${lead}${lines[i]}.`, FAST, (at) => { if (onWord && at >= lead.length) onWord(i, at - lead.length); }, token);
    }
    if (token === this.token && onDone) onDone();
  }

  // One short line, said once (the reveal).
  say(text, rate = PITCH) {
    this.stop();
    return this._read(text, rate, null, this.token);
  }
}
