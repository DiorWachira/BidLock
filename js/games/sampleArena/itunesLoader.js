// SOUNDCLASH — the crate digger. Finds real songs through the free iTunes Search API
// (no key), keeps only tracks with a 30-second preview, and builds the match: eight
// rounds, each one target and three rivals from the same genre so the choices are
// genuinely close. With no network (or nothing usable back) it builds the match from
// the offline synth tunes instead, so a match never fails to start.
//
// Apple provides previews to promote the store: every revealed track links to its
// store page, and the screen credits the previews to iTunes.

import { SYNTH_TUNES } from './synthTunes.js';
import { HITS } from './hits.js';

export const ITUNES_SEARCH = 'https://itunes.apple.com/search';
export const ROUND_COUNT = 8;
export const SNIPPET = 3.0; // seconds in the looping hook
const LIMIT = 35;

// Six crates and the shuffle. Each search term is an artist (or, for the last crate, a
// scene); results from the same searches supply the rival answers.
export const GENRES = Object.freeze([
  {
    id: 'pop', name: 'Global Pop & Chart Toppers', short: 'POP',
    terms: ['Taylor Swift', 'Dua Lipa', 'The Weeknd', 'Ed Sheeran', 'Ariana Grande', 'Harry Styles', 'Billie Eilish', 'Bruno Mars', 'Olivia Rodrigo', 'Sabrina Carpenter', 'Rihanna', 'Katy Perry', 'Lady Gaga', 'Justin Bieber', 'Doja Cat'],
  },
  {
    id: 'hiphop', name: 'Hip-Hop, Rap & Trap', short: 'HIP-HOP',
    terms: ['Drake', 'Kendrick Lamar', 'Travis Scott', 'Lil Nas X', '21 Savage', 'Lil Baby', 'J. Cole', 'Nicki Minaj', 'Cardi B', 'Post Malone', 'Eminem', 'Megan Thee Stallion', 'Metro Boomin', 'Lil Uzi Vert', 'Doechii'],
  },
  {
    id: 'uk', name: 'UK Grime, Drill & Afrobeats', short: 'GRIME · AFRO',
    terms: ['Stormzy', 'Skepta', 'Tyla', 'Central Cee', 'Burna Boy', 'Wizkid', 'Davido', 'Rema', 'Tems', 'Headie One', 'J Hus', 'Asake', 'Little Simz', 'AJ Tracey', 'Ayra Starr', 'CKay'],
  },
  {
    id: 'throwback', name: '2000s & 2010s Throwback Anthems', short: 'THROWBACK',
    terms: ['Usher', 'Black Eyed Peas', 'Beyonce', 'Flo Rida', 'Pitbull', 'Kesha', 'LMFAO', 'Avicii', 'Calvin Harris', 'Nelly', 'Sean Paul', 'Akon', 'Outkast', 'Gwen Stefani', 'Maroon 5'],
  },
  {
    id: 'rock', name: 'Rock, Indie & Alt Classics', short: 'ROCK · INDIE',
    terms: ['Arctic Monkeys', 'The Killers', 'Foo Fighters', 'Red Hot Chili Peppers', 'Linkin Park', 'Nirvana', 'Coldplay', 'Imagine Dragons', 'The Strokes', 'Muse', 'Paramore', 'Green Day', 'Oasis', 'Tame Impala', 'Radiohead'],
  },
  {
    id: 'anime', name: 'Anime, Gaming & Meme Bangers', short: 'ANIME · GAMES · MEMES',
    // Mostly the artists behind the best-known anime openings, then games and memes.
    terms: ['YOASOBI', 'Kenshi Yonezu', 'Ado', 'Linked Horizon', 'Aimer', 'Creepy Nuts', 'Mrs. GREEN APPLE', 'Official HIGE DANdism', 'King Gnu', 'TK from Ling tosite sigure', 'Ikimonogakari', 'KANA-BOON', 'Yoko Takahashi', 'Spyair', 'Vaundy', 'C418', 'Toby Fox', 'Rick Astley', 'Darude', 'Smash Mouth', 'Eiffel 65', 'Gotye', 'Vengaboys', 'Crazy Frog'],
    // The side dish: game and meme artists. At most one of a match's three searches,
    // a quarter of the time, and at most SIDE_ROUNDS of its rounds.
    side: ['C418', 'Toby Fox', 'Rick Astley', 'Darude', 'Smash Mouth', 'Eiffel 65', 'Gotye', 'Vengaboys', 'Crazy Frog'],
  },
]);
export const SHUFFLE = Object.freeze({ id: 'all', name: 'All-Genre Shuffle', short: 'SHUFFLE' });

// How hard the match is. Easy and Normal ask only about each artist's famous songs (the
// curated hit lists in hits.js); Hard asks about anything they have released. Easy also
// keeps to the friendlier warps and puts each answer by a different artist.
export const LEVELS = Object.freeze([
  { id: 'easy', name: 'Easy', line: 'Big hits, gentle warps' },
  { id: 'normal', name: 'Normal', line: 'Big hits, every warp' },
  { id: 'hard', name: 'Hard', line: 'Deep cuts, every warp' },
]);
export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[1];
}
export const GENRE_CHOICES = Object.freeze([SHUFFLE, ...GENRES]);

export function genreById(id) {
  return GENRE_CHOICES.find((g) => g.id === id) || SHUFFLE;
}

// Covers, karaoke and live takes make poor questions: the snippet would not match the
// song people know.
const JUNK = /karaoke|tribute|instrumental|cover version|made famous|originally performed|lullaby|8-bit|music box|in the style of|re-?recorded|sped up|slowed|acapella|a cappella|\blive\b|\(live|remix|demo\b/i;

// "Song (feat. X) [Remastered 2011] - Single Version" -> "Song"
export function cleanTitle(t) {
  return String(t)
    .replace(/\s*[([](feat|ft|with|from)\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(remaster|version|edit|mix|mono|stereo|bonus)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|single).*$/i, '')
    .trim();
}

const key = (s) => cleanTitle(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

// Is this title one of the artist's hits? Tolerant of punctuation, featured artists and
// the odd subtitle ("Wake Me Up" matches "Wake Me Up - Radio Edit").
export function isHit(title, hits) {
  if (!hits || !hits.length) return false;
  const t = key(title);
  if (!t) return false;
  const bare = (x) => key(String(x).replace(/\s*[([].*$/, '')); // without any bracketed subtitle
  const tb = bare(title);
  return hits.some((h) => {
    const k = key(h);
    return k && (t === k || (tb && tb === bare(h)));
  });
}

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// iTunes answers cross-origin requests; JSONP is the fallback for browsers or networks
// where a plain fetch is refused.
async function getJson(url, { fetchImpl, timeoutMs }) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? (...a) => fetch(...a) : null);
  if (doFetch) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (res.ok) return await res.json();
    } catch { /* try JSONP */ } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (fetchImpl || typeof document === 'undefined') return null;
  return jsonp(url, timeoutMs);
}

let jsonpN = 0;
function jsonp(url, timeoutMs) {
  return new Promise((resolve) => {
    const name = `__soundclash${Date.now().toString(36)}${jsonpN++}`;
    const s = document.createElement('script');
    const done = (v) => {
      clearTimeout(timer);
      try { delete window[name]; } catch { window[name] = undefined; }
      s.remove();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    window[name] = (data) => done(data);
    s.onerror = () => done(null);
    s.src = `${url}&callback=${name}`;
    document.head.appendChild(s);
  });
}

// One search: the tracks worth asking about, most popular first (iTunes ranks results
// by relevance, which for an artist search is close to popularity).
export function parseResults(data, { term = '', loose = false, hits = null } = {}) {
  if (!data || !Array.isArray(data.results)) return [];
  const fold = (x) => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const want = fold(term);
  const out = [];
  data.results.forEach((r, idx) => {
    if (!r || r.kind !== 'song' || !r.previewUrl || !r.trackName || !r.artistName || !r.artworkUrl100) return;
    if (JUNK.test(r.trackName) || JUNK.test(r.artistName) || JUNK.test(r.collectionName || '')) return;
    if (!loose && want && !fold(r.artistName).includes(want.replace(/^the /, ''))) return;
    const title = cleanTitle(r.trackName);
    if (!title || title.length > 48) return;
    out.push({
      id: String(r.trackId || `${r.artistName}-${r.trackName}`),
      title,
      artist: String(r.artistName).split(/,| & | feat\.? /i)[0].trim(),
      url: r.previewUrl,
      art: String(r.artworkUrl100).replace('100x100bb', '400x400bb'),
      link: r.trackViewUrl || r.collectionViewUrl || '',
      pop: 1 - idx / Math.max(LIMIT, data.results.length),
      hit: isHit(r.trackName, hits),
      synth: null,
    });
  });
  return out;
}

// The searches for a crate: three artists from it, or one from each of four crates in
// the shuffle. Fewer calls than Apple's limit of about 20 a minute.
export const SIDE_CHANCE = 0.25; // how often a crate's third search is a side artist
export const SIDE_ROUNDS = 2; // the most rounds a side artist may supply

const coreTerms = (g) => g.terms.filter((t) => !(g.side || []).includes(t));

export function planSearches(genreId, rng) {
  const search = (g, term) => ({ term, loose: !!g.loose, genre: g.id, hits: hitsFor(g.id, term), side: (g.side || []).includes(term) });
  if (genreId === 'all') {
    // The shuffle takes its one artist per crate from the core of each crate.
    return shuffled(GENRES, rng).slice(0, 4).map((g) => search(g, shuffled(coreTerms(g), rng)[0]));
  }
  const g = GENRES.find((x) => x.id === genreId) || GENRES[0];
  if (!g.side) return shuffled(g.terms, rng).slice(0, 3).map((term) => search(g, term));
  // A crate with a side dish leans on its core: two core artists always, and the third
  // is a side artist only a quarter of the time.
  const core = shuffled(coreTerms(g), rng);
  const third = rng() < SIDE_CHANCE ? shuffled(g.side, rng)[0] : core[2];
  return [core[0], core[1], third].map((term) => search(g, term));
}

// Eight rounds from a pool of tracks. Targets lean popular; rivals come from the same
// crate, at most one by the same artist.
export function hitsFor(genreId, term) {
  return (HITS[genreId] && HITS[genreId][term]) || [];
}

export function buildRounds(pool, rng, count = ROUND_COUNT, { level = 'normal' } = {}) {
  const seen = new Set();
  const tracks = [];
  for (const t of pool) {
    const k = key(t.title) + '|' + t.artist.toLowerCase();
    const k2 = key(t.title);
    if (seen.has(k) || seen.has(k2)) continue;
    seen.add(k);
    seen.add(k2);
    tracks.push(t);
  }
  if (tracks.length < count + 3) return null;
  const byPop = tracks.slice().sort((a, b) => b.pop - a.pop);
  let targets;
  if (level === 'hard') {
    // Deep cuts: anything but the hits, popular first, then whatever is left.
    const deepAll = byPop.filter((t) => !t.hit);
    const deepSide = deepAll.filter((t) => t.side).slice(0, SIDE_ROUNDS);
    const deep = [...deepAll.filter((t) => !t.side), ...deepSide];
    targets = [...shuffled(deep.slice(0, Math.max(count, Math.ceil(deep.length * 0.8))), rng), ...shuffled(byPop.filter((t) => t.hit), rng)].slice(0, count);
  } else {
    // The famous ones: the curated hits first, topped up with the most popular others.
    // Side artists (a crate's games and memes) supply at most SIDE_ROUNDS of them.
    const allHits = shuffled(byPop.filter((t) => t.hit || t.synth), rng);
    const coreHits = allHits.filter((t) => !t.side);
    const sideHits = allHits.filter((t) => t.side).slice(0, Math.max(SIDE_ROUNDS, count - coreHits.length));
    const hits = [...coreHits.slice(0, count - Math.min(SIDE_ROUNDS, sideHits.length)), ...sideHits, ...coreHits.slice(count - Math.min(SIDE_ROUNDS, sideHits.length))];
    const rest = byPop.filter((t) => !t.hit && !t.synth);
    targets = shuffled([...hits, ...shuffled(rest.slice(0, Math.max(count, Math.ceil(rest.length * 0.4))), rng)].slice(0, count), rng);
  }
  const sameArtistMax = level === 'easy' ? 0 : level === 'hard' ? 2 : 1;
  const used = new Set(targets.map((t) => t.id));
  return targets.map((t, n) => {
    const same = (x) => (x.genre || '') === (t.genre || '');
    const others = shuffled(tracks.filter((x) => x.id !== t.id && x.title !== t.title), rng);
    // Prefer rivals from the same crate that are not targets themselves.
    const ranked = [
      ...others.filter((x) => same(x) && !used.has(x.id)),
      ...others.filter((x) => same(x) && used.has(x.id)),
      ...others.filter((x) => !same(x)),
    ];
    const picks = [];
    let sameArtist = 0;
    for (const x of ranked) {
      if (picks.length >= 3) break;
      if (picks.some((p) => key(p.title) === key(x.title))) continue;
      const mine = x.artist.toLowerCase() === t.artist.toLowerCase();
      if (mine && sameArtist >= sameArtistMax) continue;
      if (mine) sameArtist++;
      picks.push(x);
    }
    // Not enough other artists in the pool: fill with the same artist rather than fewer options.
    for (const x of ranked) {
      if (picks.length >= 3) break;
      if (!picks.includes(x) && !picks.some((p) => key(p.title) === key(x.title))) picks.push(x);
    }
    const options = shuffled([t, ...picks], rng);
    return {
      n: n + 1,
      target: t,
      options: options.map((o) => ({ title: o.title, artist: o.artist })),
      correct: options.indexOf(t),
      // The hook usually lands between 8 and 18 seconds into a 30-second preview.
      start: t.synth ? 0 : Math.round((8 + rng() * 10) * 10) / 10,
    };
  });
}

// The offline match: tunes everyone knows, rendered by the synth.
export function offlineRounds(rng, count = ROUND_COUNT) {
  const pool = SYNTH_TUNES.map((t, i) => ({
    id: `synth:${t.id}`, title: t.title, artist: t.by, url: '', art: '', link: '', pop: 1 - i / SYNTH_TUNES.length * 0.3, synth: t.id, genre: 'synth',
  }));
  return buildRounds(pool, rng, count);
}

// Everything the match needs. Never throws; `source` says where the music came from.
export async function loadMatch({ genre = 'all', level = 'normal', rng = Math.random, offline = false, fetchImpl = null, timeoutMs = 6000 } = {}) {
  if (!offline) {
    try {
      const plan = planSearches(genre, rng);
      const results = await Promise.all(plan.map(async (s) => {
        const url = `${ITUNES_SEARCH}?term=${encodeURIComponent(s.term)}&media=music&entity=song&limit=${LIMIT}`;
        const data = await getJson(url, { fetchImpl, timeoutMs });
        return parseResults(data, s).map((t) => ({ ...t, genre: s.genre, side: !!s.side }));
      }));
      // Interleave the searches so no single artist dominates the pool.
      const pool = [];
      const longest = Math.max(0, ...results.map((r) => r.length));
      for (let i = 0; i < longest; i++) for (const r of results) if (r[i]) pool.push(r[i]);
      const rounds = buildRounds(pool, rng, ROUND_COUNT, { level });
      if (rounds) return { source: 'itunes', genre, level, rounds, searched: plan.map((p) => p.term), hits: rounds.filter((r) => r.target.hit).length };
    } catch { /* fall through to the synth */ }
  }
  return { source: 'offline', genre, level, rounds: offlineRounds(rng), searched: [] };
}
