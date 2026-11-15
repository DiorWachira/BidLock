// BIDLOCK 2.0 — media loader.
// Finds a real photograph for every lot from Wikipedia and hands it to both the HUD
// (as an <img> source) and the 3D stage (as a texture). Every lot has an illustrated
// card drawn on a canvas from the first moment, so nothing is ever blank: if a photo
// arrives it replaces the card, and if it never arrives (offline, blocked, no free
// image) the card stays.
//
// Lookups are batched: one request to the MediaWiki Action API resolves up to 40 lots,
// which keeps a whole match well inside Wikipedia's rate limits. If the batch fails,
// each lot falls back to the REST summary endpoint, a few at a time.

import { hypeLamps, categoryById } from '../data/categories.js';

const ACTION_API = 'https://en.wikipedia.org/w/api.php';
const SUMMARY_API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const DISPLAY = '"Bahnschrift", "DIN Alternate", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const MONO = '"Cascadia Mono", Consolas, "SF Mono", Menlo, monospace';

export function batchUrl(titles, size = 960) {
  const t = titles.map((x) => encodeURIComponent(x)).join('%7C');
  return `${ACTION_API}?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=pageimages%7Cinfo&inprop=url&piprop=thumbnail&pithumbsize=${size}&pilimit=50&titles=${t}`;
}

// Maps each query back to its page through the API's normalisation and redirect tables.
export function readBatch(json) {
  const out = new Map();
  const q = json && json.query;
  if (!q) return out;
  const norm = new Map((q.normalized || []).map((n) => [n.from, n.to]));
  const redir = new Map((q.redirects || []).map((n) => [n.from, n.to]));
  const pages = new Map((q.pages || []).map((p) => [p.title, p]));
  const resolve = (query) => {
    let t = norm.get(query) || query;
    for (let i = 0; i < 4 && redir.has(t); i++) t = redir.get(t);
    return pages.get(t) || null;
  };
  const queries = new Set([...(q.normalized || []).map((n) => n.from), ...(q.redirects || []).map((n) => n.from), ...pages.keys()]);
  for (const query of queries) {
    const p = resolve(query);
    if (!p || p.missing) continue;
    out.set(query, {
      title: p.title,
      page: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      src: p.thumbnail ? p.thumbnail.source : null,
      w: p.thumbnail ? p.thumbnail.width : 0,
      h: p.thumbnail ? p.thumbnail.height : 0,
    });
  }
  return out;
}

export function summaryUrl(query) {
  return SUMMARY_API + encodeURIComponent(query);
}

export function readSummary(json) {
  if (!json || json.type === 'disambiguation') return null;
  const pic = json.originalimage && json.originalimage.width <= 1400 ? json.originalimage : json.thumbnail;
  return {
    title: json.title || '',
    page: json.content_urls && json.content_urls.desktop ? json.content_urls.desktop.page : 'https://en.wikipedia.org/',
    src: pic ? pic.source : null,
    w: pic ? pic.width : 0,
    h: pic ? pic.height : 0,
  };
}

// ---------- illustrated fallback cards ----------
const PICTOGRAMS = {
  house(c) { c.beginPath(); c.moveTo(-1, 0.1); c.lineTo(0, -0.9); c.lineTo(1, 0.1); c.lineTo(0.74, 0.1); c.lineTo(0.74, 0.9); c.lineTo(-0.74, 0.9); c.lineTo(-0.74, 0.1); c.closePath(); c.fill(); c.clearRect(-0.18, 0.3, 0.36, 0.6); },
  car(c) { c.beginPath(); c.moveTo(-1, 0.35); c.lineTo(-0.9, -0.05); c.lineTo(-0.5, -0.1); c.lineTo(-0.25, -0.55); c.lineTo(0.4, -0.55); c.lineTo(0.7, -0.1); c.lineTo(1, 0); c.lineTo(1, 0.35); c.closePath(); c.fill(); for (const x of [-0.55, 0.55]) { c.beginPath(); c.arc(x, 0.4, 0.26, 0, 7); c.fill(); } },
  star(c) { c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.42 : 1; const a = -Math.PI / 2 + (i * Math.PI) / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); },
  paw(c) { c.beginPath(); c.ellipse(0, 0.38, 0.55, 0.45, 0, 0, 7); c.fill(); for (const [x, y] of [[-0.62, -0.2], [-0.22, -0.62], [0.22, -0.62], [0.62, -0.2]]) { c.beginPath(); c.ellipse(x, y, 0.2, 0.26, 0, 0, 7); c.fill(); } },
  gem(c) { c.beginPath(); c.moveTo(-1, -0.25); c.lineTo(-0.55, -0.8); c.lineTo(0.55, -0.8); c.lineTo(1, -0.25); c.lineTo(0, 0.95); c.closePath(); c.fill(); },
  shield(c) { c.beginPath(); c.moveTo(-0.8, -0.85); c.lineTo(0.8, -0.85); c.lineTo(0.8, 0); c.quadraticCurveTo(0.7, 0.7, 0, 1); c.quadraticCurveTo(-0.7, 0.7, -0.8, 0); c.closePath(); c.fill(); },
  bolt(c) { c.beginPath(); c.moveTo(0.2, -1); c.lineTo(-0.6, 0.1); c.lineTo(-0.08, 0.1); c.lineTo(-0.3, 1); c.lineTo(0.6, -0.2); c.lineTo(0.08, -0.2); c.closePath(); c.fill(); },
  chip(c) { c.fillRect(-0.62, -0.62, 1.24, 1.24); for (let i = -2; i <= 2; i++) { c.fillRect(i * 0.24 - 0.05, -0.95, 0.1, 0.25); c.fillRect(i * 0.24 - 0.05, 0.7, 0.1, 0.25); c.fillRect(-0.95, i * 0.24 - 0.05, 0.25, 0.1); c.fillRect(0.7, i * 0.24 - 0.05, 0.25, 0.1); } c.clearRect(-0.3, -0.3, 0.6, 0.6); },
  plane(c) { c.beginPath(); c.moveTo(1, 0); c.lineTo(0.2, -0.16); c.lineTo(-0.25, -0.95); c.lineTo(-0.5, -0.95); c.lineTo(-0.3, -0.16); c.lineTo(-0.8, -0.12); c.lineTo(-0.98, -0.42); c.lineTo(-1.1, -0.42); c.lineTo(-1, 0); c.lineTo(-1.1, 0.42); c.lineTo(-0.98, 0.42); c.lineTo(-0.8, 0.12); c.lineTo(-0.3, 0.16); c.lineTo(-0.5, 0.95); c.lineTo(-0.25, 0.95); c.lineTo(0.2, 0.16); c.closePath(); c.fill(); },
  plate(c) { c.beginPath(); c.arc(0, 0.35, 0.85, Math.PI, 0); c.closePath(); c.fill(); c.fillRect(-1, 0.45, 2, 0.14); c.beginPath(); c.arc(0, -0.58, 0.12, 0, 7); c.fill(); },
  film(c) { c.fillRect(-0.9, -0.2, 1.8, 1.1); c.save(); c.translate(-0.9, -0.3); c.rotate(-0.22); c.fillRect(0, -0.3, 1.8, 0.3); c.restore(); c.clearRect(-0.7, 0.1, 1.4, 0.12); c.clearRect(-0.7, 0.4, 1.4, 0.12); },
  peak(c) { c.beginPath(); c.moveTo(-1.1, 0.85); c.lineTo(-0.2, -0.85); c.lineTo(0.3, 0.1); c.lineTo(0.6, -0.3); c.lineTo(1.1, 0.85); c.closePath(); c.fill(); },
  cone(c) { c.beginPath(); c.moveTo(-0.22, -0.95); c.lineTo(0.22, -0.95); c.lineTo(0.62, 0.6); c.lineTo(-0.62, 0.6); c.closePath(); c.fill(); c.fillRect(-0.95, 0.6, 1.9, 0.25); c.clearRect(-0.5, -0.25, 1, 0.22); },
  crate(c) { c.fillRect(-0.9, -0.9, 1.8, 1.8); c.clearRect(-0.7, -0.7, 1.4, 1.4); c.font = `900 1.5px ${DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 0, 0.08); },
  dud(c) { c.beginPath(); c.arc(0, 0, 0.9, 0, 7); c.arc(0, 0, 0.66, 0, 7, true); c.fill(); c.save(); c.rotate(-0.785); c.fillRect(-0.85, -0.12, 1.7, 0.24); c.restore(); },
};

function wrapText(c, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (c.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// A 960x640 card: a pictogram for the lot's category on its two colours, the name set
// in the display face, hype lamps, and a slug that says plainly this is an illustration.
export function drawFallbackCard(item, { sealed = false } = {}) {
  const W = 960;
  const H = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  const cat = sealed ? null : categoryById(item.category);
  const [c1, c2] = sealed ? ['#6b4a26', '#d6a419'] : item.colorPalette;
  c.fillStyle = c1;
  c.fillRect(0, 0, W, H);
  // Diagonal second colour, like a printed lot card.
  c.fillStyle = c2;
  c.beginPath();
  c.moveTo(W * 0.58, 0); c.lineTo(W, 0); c.lineTo(W, H); c.lineTo(W * 0.34, H);
  c.closePath();
  c.fill();
  c.globalAlpha = 0.1;
  c.fillStyle = '#000';
  for (let x = -H; x < W; x += 22) { c.beginPath(); c.moveTo(x, H); c.lineTo(x + 8, H); c.lineTo(x + H + 8, 0); c.lineTo(x + H, 0); c.closePath(); c.fill(); }
  c.globalAlpha = 1;

  const key = sealed ? 'crate' : item.proceduralIconType;
  c.save();
  c.translate(W * 0.5, H * 0.4);
  c.scale(170, 170);
  c.fillStyle = '#0b0d10';
  (PICTOGRAMS[key] || PICTOGRAMS.dud)(c);
  c.restore();

  // Name plate.
  c.fillStyle = '#0a0908';
  c.fillRect(0, H - 190, W, 190);
  c.fillStyle = '#f3ead6';
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  const name = (sealed ? 'Sealed Mystery Crate' : item.name).toUpperCase();
  let size = 68;
  c.font = `700 ${size}px ${DISPLAY}`;
  let lines = wrapText(c, name, W - 80);
  while (lines.length > 2 && size > 36) { size -= 6; c.font = `700 ${size}px ${DISPLAY}`; lines = wrapText(c, name, W - 80); }
  lines.slice(0, 2).forEach((ln, i) => c.fillText(ln, 40, H - 118 + i * (size + 4) + (lines.length === 1 ? 28 : 0)));
  c.font = `600 20px ${MONO}`;
  c.fillStyle = '#b1ab9c';
  c.fillText((sealed ? 'MYSTERY VAULT CRATES' : cat ? cat.name.toUpperCase() : 'PENALTY DUD') + '  ·  ILLUSTRATION', 40, H - 22);
  if (!sealed && !item.dud) {
    const lamps = hypeLamps(item);
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.arc(W - 150 + i * 28, H - 30, 10, 0, 7);
      c.fillStyle = i < lamps ? '#ffb52e' : '#2b2620';
      c.fill();
    }
  }
  // Slug.
  c.fillStyle = '#0a0908';
  c.fillRect(0, 0, 250, 46);
  c.fillStyle = '#f3ead6';
  c.font = `700 22px ${DISPLAY}`;
  c.fillText('BIDLOCK · CH 20', 18, 31);
  return canvas;
}

// ---------- the loader ----------
export class MediaLoader {
  constructor({ fetchImpl = null, timeoutMs = 7000 } = {}) {
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    this.timeoutMs = timeoutMs;
    this.entries = new Map();
    this.listeners = new Set();
    this.crate = null;
    this.stats = { photos: 0, fallbacks: 0, requests: 0 };
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  entry(item) {
    let e = this.entries.get(item.id);
    if (!e) {
      e = { item, status: 'card', requested: false, src: null, w: 0, h: 0, credit: null, image: null, canvas: null, dataUrl: null, tex: null, cardTex: null };
      this.entries.set(item.id, e);
    }
    return e;
  }

  isPhoto(item) { return this.entry(item).status === 'photo'; }

  credit(item) {
    const e = this.entry(item);
    return e.status === 'photo' ? e.credit : null;
  }

  _card(e) {
    if (!e.canvas) e.canvas = drawFallbackCard(e.item);
    return e.canvas;
  }

  _crate() {
    if (!this.crate) {
      const canvas = drawFallbackCard(null, { sealed: true });
      this.crate = { canvas, dataUrl: canvas.toDataURL('image/jpeg', 0.82), tex: null };
    }
    return this.crate;
  }

  // What an <img> should show for this lot right now.
  src(item, { sealed = false } = {}) {
    if (sealed) return this._crate().dataUrl;
    const e = this.entry(item);
    if (e.status === 'photo') return e.src;
    if (!e.dataUrl) e.dataUrl = this._card(e).toDataURL('image/jpeg', 0.82);
    return e.dataUrl;
  }

  // What the 3D frame should show. THREE is passed in so this module never imports it.
  texture(item, THREE, { sealed = false } = {}) {
    if (sealed) {
      const cr = this._crate();
      if (!cr.tex) { cr.tex = new THREE.CanvasTexture(cr.canvas); cr.tex.colorSpace = THREE.SRGBColorSpace; }
      return { texture: cr.tex, aspect: 1.5, photo: false };
    }
    const e = this.entry(item);
    if (e.status === 'photo') {
      if (!e.tex) {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        e.tex = loader.load(e.src);
        e.tex.colorSpace = THREE.SRGBColorSpace;
        e.tex.anisotropy = 8;
      }
      return { texture: e.tex, aspect: e.w / e.h, photo: true };
    }
    if (!e.cardTex) {
      e.cardTex = new THREE.CanvasTexture(this._card(e));
      e.cardTex.colorSpace = THREE.SRGBColorSpace;
      e.cardTex.anisotropy = 8;
    }
    return { texture: e.cardTex, aspect: 1.5, photo: false };
  }

  async _json(url) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    try {
      this.stats.requests++;
      const res = await this.fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  _loadImage(e, hit) {
    return new Promise((resolve) => {
      if (!hit || !hit.src) { resolve(false); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const timer = setTimeout(() => { img.src = ''; resolve(false); }, this.timeoutMs + 3000);
      img.onload = () => {
        clearTimeout(timer);
        if (!img.naturalWidth) { resolve(false); return; }
        e.status = 'photo';
        e.src = hit.src;
        e.w = img.naturalWidth;
        e.h = img.naturalHeight;
        e.image = img;
        e.credit = { title: hit.title, page: hit.page };
        this.stats.photos++;
        for (const fn of this.listeners) fn(e.item);
        resolve(true);
      };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      img.src = hit.src;
    });
  }

  // Look up and load photographs for a set of lots. Resolves when every lot has settled
  // (photo or card); it never rejects.
  async prefetch(items) {
    const todo = [];
    for (const item of items) {
      if (!item || !item.wikiQuery) continue;
      const e = this.entry(item);
      if (e.requested) continue;
      e.requested = true;
      todo.push(e);
    }
    if (!todo.length) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.stats.fallbacks += todo.length; return; }

    const leftovers = [];
    for (let i = 0; i < todo.length; i += 40) {
      const chunk = todo.slice(i, i + 40);
      try {
        const hits = readBatch(await this._json(batchUrl(chunk.map((e) => e.item.wikiQuery))));
        await Promise.all(chunk.map(async (e) => {
          const ok = await this._loadImage(e, hits.get(e.item.wikiQuery));
          if (!ok) this.stats.fallbacks++;
        }));
      } catch {
        leftovers.push(...chunk);
      }
    }
    // The batch endpoint was unreachable: try the REST summary endpoint, three at a time.
    const queue = leftovers.slice();
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const e = queue.shift();
        let ok = false;
        try { ok = await this._loadImage(e, readSummary(await this._json(summaryUrl(e.item.wikiQuery)))); } catch { ok = false; }
        if (!ok) this.stats.fallbacks++;
      }
    }));
  }
}
