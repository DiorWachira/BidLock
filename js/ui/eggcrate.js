// Eggcrate lamp display: a matrix of incandescent bulbs behind a black mask, the way
// game-show scoreboards showed prices and clocks before LEDs. Everything is drawn in
// code from a 5x7 glyph table, so no font files are needed. The same glyphs are reused
// on the 3D podium screens.

const G = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  $: [4, 15, 20, 14, 5, 30, 4], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0],
  '-': [0, 0, 0, 31, 0, 0, 0], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4],
  '+': [0, 4, 4, 31, 4, 4, 0], '/': [1, 1, 2, 4, 8, 16, 16], "'": [4, 4, 8, 0, 0, 0, 0],
};

export const LAMP = Object.freeze({ on: '#ffb52e', hot: '#fff1c2', off: '#2b2620', board: '#0a0908', red: '#ff3b2a', redHot: '#ffd2c8' });

export function glyphRows(ch) {
  return G[ch] || G[String(ch).toUpperCase()] || G[' '];
}

// Draws text as lamps. (x, y) is the top-left of the first lamp cell; `cell` is the lamp pitch in px.
export function drawLamps(ctx, text, x, y, cell, opts = {}) {
  const on = opts.on || LAMP.on;
  const hot = opts.hot || LAMP.hot;
  const off = opts.off === undefined ? LAMP.off : opts.off;
  const r = cell * 0.4;
  const s = String(text).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const rows = glyphRows(s[i]);
    for (let ry = 0; ry < 7; ry++) {
      for (let cx = 0; cx < 5; cx++) {
        const lit = (rows[ry] >> (4 - cx)) & 1;
        if (!lit && !off) continue;
        const px = x + (i * 6 + cx) * cell + cell / 2;
        const py = y + ry * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = lit ? on : off;
        ctx.fill();
        if (lit && cell >= 4) {
          ctx.beginPath();
          ctx.arc(px - r * 0.2, py - r * 0.2, r * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = hot;
          ctx.fill();
        }
      }
    }
  }
}

export function lampTextWidth(text, cell) {
  return (String(text).length * 6 - 1) * cell;
}

// A canvas-backed display. `cols` is the character capacity; text is right-aligned by default.
export class EggcrateDisplay {
  constructor(canvas, { cols = 3, cell = 6, align = 'right', marquee = false, label = '' } = {}) {
    this.canvas = canvas;
    this.cols = cols;
    this.cell = cell;
    this.align = align;
    this.marquee = marquee;
    this.text = '';
    this.red = false;
    this.pad = marquee ? 3 : 1; // in lamp cells
    this.wCells = cols * 6 - 1 + this.pad * 2;
    this.hCells = 7 + this.pad * 2;
    this.phase = 0;
    this.speed = 1;
    canvas.setAttribute('role', 'img');
    if (label) canvas.setAttribute('aria-label', label);
    this.label = label;
    this._size();
    this.draw();
  }

  _size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = this.wCells * this.cell;
    const h = this.hCells * this.cell;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.aspectRatio = `${w} / ${h}`;
    if (!this.canvas.style.width) this.canvas.style.width = `${w}px`;
  }

  set(text, { red = false } = {}) {
    const t = String(text).toUpperCase().slice(0, this.cols);
    if (t === this.text && red === this.red) return;
    this.text = t;
    this.red = red;
    if (this.label) this.canvas.setAttribute('aria-label', `${this.label}: ${t.trim()}`);
    this.draw();
  }

  // Marquee chase. Call from the frame loop with seconds elapsed.
  tick(dt) {
    if (!this.marquee) return;
    const before = Math.floor(this.phase);
    this.phase += dt * 7 * this.speed;
    if (Math.floor(this.phase) !== before) this.draw();
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    const { cell, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = LAMP.board;
    ctx.fillRect(0, 0, this.wCells * cell, this.hCells * cell);
    let t = this.text;
    if (this.align === 'right') t = t.padStart(this.cols, ' ');
    else if (this.align === 'center') {
      const left = Math.floor((this.cols - t.length) / 2);
      t = (' '.repeat(left) + t).padEnd(this.cols, ' ');
    } else t = t.padEnd(this.cols, ' ');
    drawLamps(ctx, t, this.pad * cell, this.pad * cell, cell, this.red ? { on: LAMP.red, hot: LAMP.redHot } : {});
    if (this.marquee) this._chase(ctx);
  }

  _chase(ctx) {
    const { cell, wCells, hCells } = this;
    const pts = [];
    for (let x = 0; x < wCells; x += 2) pts.push([x, 0]);
    for (let y = 2; y < hCells; y += 2) pts.push([wCells - 1, y]);
    for (let x = wCells - 3; x >= 0; x -= 2) pts.push([x, hCells - 1]);
    for (let y = hCells - 3; y > 0; y -= 2) pts.push([0, y]);
    const step = Math.floor(this.phase);
    pts.forEach(([x, y], i) => {
      const lit = (i + step) % 4 < 2;
      ctx.beginPath();
      ctx.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = lit ? LAMP.hot : '#4a3a1c';
      ctx.fill();
    });
  }
}

export function money(n) {
  return `$${n}`;
}
