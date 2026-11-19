// COLD OPEN — the film library: programmes, finding the trailers, and the eight rounds.
//
// The iTunes Search API no longer finds films, but a lookup by store ID still returns a
// film with its trailer (an .m4v preview that streams with byte ranges and allows
// cross-origin use, so the picture can go through a shader). films.js holds the IDs.
// One lookup per country store answers for a whole match, and what a device has found is
// remembered for a fortnight. Apple asks that previews promote the store, so every reveal
// links to the film on Apple TV and the screen credits it.

import { FILMS } from './films.js';
import { getJson, shuffled } from '../sampleArena/itunesLoader.js';

export const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
export const ROUNDS = 8;
export const SPARES = 3; // looked up as well, in case a film has gone from the store
export const CLIP = Object.freeze({ easy: 4, normal: 3, hard: 2 }); // seconds of trailer per loop
// Where in a trailer the clip may start, as a share of its length: past the studio logos
// and rating card, and well before the title card at the end.
export const CLIP_FROM = 0.16;
export const CLIP_TO = 0.72;

export const PROGRAMMES = Object.freeze([
  { id: 'all', name: 'All-Night Marathon', short: 'EVERYTHING' },
  { id: 'blockbusters', name: 'Blockbusters', short: 'BLOCKBUSTERS' },
  { id: 'heroes', name: 'Heroes & Villains', short: 'HEROES' },
  { id: 'animated', name: 'Animated', short: 'ANIMATED' },
  { id: 'horror', name: 'Horror & Thrillers', short: 'HORROR' },
  { id: 'comedy', name: 'Comedy & Romance', short: 'COMEDY' },
  { id: 'classics', name: 'Classics & Drama', short: 'CLASSICS' },
]);
export const programmeById = (id) => PROGRAMMES.find((p) => p.id === id) || PROGRAMMES[0];

// The same three levels as Soundclash (one setting for both shows), in film words.
export const FILM_LEVELS = Object.freeze([
  { id: 'easy', name: 'Easy', line: 'Four seconds of film, gentle faults' },
  { id: 'normal', name: 'Normal', line: 'Three seconds, most faults' },
  { id: 'hard', name: 'Hard', line: 'Two seconds, every fault, sequels as rivals' },
]);
export const filmLevelById = (id) => FILM_LEVELS.find((l) => l.id === id) || FILM_LEVELS[1];

export const filmsFor = (programme) => (programme === 'all' ? FILMS : FILMS.filter((f) => f.crate === programme));

// A larger poster from the store's 100 px one.
export const posterUrl = (art, size = '400x600') => String(art || '').replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${size}bb.$1`);

// The films to ask about: shuffled, one per series where the programme allows (a small
// programme like Heroes & Villains needs a second Batman to fill a match).
export function pickFilms(pool, rng, n) {
  const order = shuffled(pool, rng);
  const out = [];
  const series = new Set();
  for (const f of order) {
    if (out.length >= n) break;
    if (f.series && series.has(f.series)) continue;
    if (f.series) series.add(f.series);
    out.push(f);
  }
  for (const f of order) {
    if (out.length >= n) break;
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

// Three wrong answers for a film. Easy: other programmes and other eras. Normal: the same
// programme, never a sequel of it. Hard: its sequels first, then the same director or
// studio, then the same programme and era.
export function filmRivals(film, rng, level = 'normal', catalogue = FILMS) {
  const others = shuffled(catalogue.filter((x) => x.id !== film.id && x.title !== film.title), rng);
  const kin = (x) => !!film.series && x.series === film.series;
  let ranked;
  if (level === 'easy') ranked = [...others.filter((x) => x.crate !== film.crate && !kin(x) && Math.abs(x.year - film.year) >= 8), ...others.filter((x) => !kin(x))];
  else if (level === 'hard') ranked = [...others.filter(kin), ...others.filter((x) => film.by && x.by === film.by), ...others.filter((x) => x.crate === film.crate && Math.abs(x.year - film.year) <= 6), ...others];
  else ranked = [...others.filter((x) => x.crate === film.crate && !kin(x)), ...others.filter((x) => !kin(x))];
  const picks = [];
  const seen = new Set();
  for (const x of ranked) {
    if (picks.length >= 3) break;
    if (picks.includes(x) || seen.has(x.title)) continue;
    // Below Hard, the rivals are not each other's sequels either.
    if (level !== 'hard' && x.series && picks.some((p) => p.series === x.series)) continue;
    seen.add(x.title);
    picks.push(x);
  }
  return picks;
}

// What this device has found, for a fortnight: { id: { url, art, link, at } }.
const CACHE_KEY = 'bidlock.co.films';
const CACHE_TTL = 14 * 24 * 3600 * 1000;
function readCache() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE_KEY) : null;
    const m = raw ? JSON.parse(raw) : {};
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}
function writeCache(m) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch { /* storage blocked */ }
}
// A trailer that would not play is looked up afresh next time.
export function forgetFilm(id) {
  const m = readCache();
  if (m[id]) { delete m[id]; writeCache(m); }
}

// Look the films up, a store at a time. Returns Map(id -> { url, art, link }).
export async function lookupFilms(films, { fetchImpl = null, timeoutMs = 7000, now = Date.now() } = {}) {
  const cache = readCache();
  const found = new Map();
  const need = [];
  for (const f of films) {
    const c = cache[f.id];
    if (c && c.url && now - c.at < CACHE_TTL) found.set(f.id, c);
    else need.push(f);
  }
  const byStore = new Map();
  for (const f of need) {
    const s = f.store || 'us';
    if (!byStore.has(s)) byStore.set(s, []);
    byStore.get(s).push(f);
  }
  let changed = false;
  await Promise.all([...byStore].map(async ([store, list]) => {
    const data = await getJson(`${ITUNES_LOOKUP}?id=${list.map((f) => f.id).join(',')}&country=${store.toUpperCase()}`, { fetchImpl, timeoutMs });
    for (const r of (data && Array.isArray(data.results) ? data.results : [])) {
      if (!r || r.kind !== 'feature-movie' || !r.previewUrl) continue;
      const id = String(r.trackId);
      if (!list.some((f) => f.id === id)) continue;
      const meta = { url: r.previewUrl, art: posterUrl(r.artworkUrl100 || ''), link: r.trackViewUrl || '', at: now };
      found.set(id, meta);
      cache[id] = meta;
      changed = true;
    }
  }));
  if (changed) writeCache(cache);
  return found;
}

// A whole match: eight rounds, each a trailer clip and four films. Throws if the library
// cannot be reached (the screen then says so).
export async function loadMatch({ programme = 'all', level = 'normal', rng = Math.random, fetchImpl = null, timeoutMs = 7000 } = {}) {
  const picks = pickFilms(filmsFor(programme), rng, ROUNDS + SPARES);
  const found = await lookupFilms(picks, { fetchImpl, timeoutMs });
  const films = picks.filter((f) => found.has(f.id)).slice(0, ROUNDS);
  if (films.length < ROUNDS) {
    const err = new Error(`The film library answered for ${films.length} of ${ROUNDS} films.`);
    err.code = films.length ? 'short' : 'unreachable';
    throw err;
  }
  const len = CLIP[level] || CLIP.normal;
  const rounds = films.map((f) => {
    const meta = found.get(f.id);
    const options = shuffled([{ title: f.title, year: f.year, me: true }, ...filmRivals(f, rng, level).map((x) => ({ title: x.title, year: x.year }))], rng);
    return {
      target: { id: f.id, title: f.title, film: f.title, year: f.year, artist: String(f.year), url: meta.url, art: meta.art, link: meta.link, pop: 0.75 },
      options: options.map((o) => ({ title: o.title, year: o.year, artist: String(o.year) })),
      correct: options.findIndex((o) => o.me),
      start: Math.round((CLIP_FROM + rng() * (CLIP_TO - CLIP_FROM)) * 1000) / 1000, // a share of the trailer
      len,
    };
  });
  return { source: 'itunes', genre: programme, level, rounds };
}
