// SOUNDCLASH — the crate digger. Finds real songs through the free iTunes Search API
// (no key), keeps only tracks with a 30-second preview, and builds the match: eight
// rounds, each one target and three rivals from the same genre so the choices are
// genuinely close. With no network (or nothing usable back) it builds the match from
// the offline synth tunes instead, so a match never fails to start.
//
// Apple provides previews to promote the store: every revealed track links to its
// store page, and the screen credits the previews to iTunes.

import { SYNTH_TUNES } from './synthTunes.js';

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
    terms: ['Drake', 'Kendrick Lamar', 'Travis Scott', 'Future', '21 Savage', 'Lil Baby', 'J. Cole', 'Nicki Minaj', 'Cardi B', 'Post Malone', 'Eminem', 'Megan Thee Stallion', 'Metro Boomin', 'Lil Uzi Vert', 'Doechii'],
  },
  {
    id: 'uk', name: 'UK Grime, Drill & Afrobeats', short: 'GRIME · AFRO',
    terms: ['Stormzy', 'Skepta', 'Dave', 'Central Cee', 'Burna Boy', 'Wizkid', 'Davido', 'Rema', 'Tems', 'Headie One', 'J Hus', 'Asake', 'Little Simz', 'AJ Tracey', 'Ayra Starr'],
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
    terms: ['YOASOBI', 'LiSA', 'Kenshi Yonezu', 'Ado', 'Linked Horizon', 'Aimer', 'C418', 'Toby Fox', 'Rick Astley', 'Darude', 'Smash Mouth', 'Eiffel 65', 'Gotye', 'Vengaboys', 'Crazy Frog'],
    loose: true, // scene searches: do not insist the artist matches the term
  },
]);
export const SHUFFLE = Object.freeze({ id: 'all', name: 'All-Genre Shuffle', short: 'SHUFFLE' });
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

const key = (s) => cleanTitle(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

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
export function parseResults(data, { term = '', loose = false } = {}) {
  if (!data || !Array.isArray(data.results)) return [];
  const want = String(term).toLowerCase();
  const out = [];
  data.results.forEach((r, idx) => {
    if (!r || r.kind !== 'song' || !r.previewUrl || !r.trackName || !r.artistName || !r.artworkUrl100) return;
    if (JUNK.test(r.trackName) || JUNK.test(r.artistName) || JUNK.test(r.collectionName || '')) return;
    if (!loose && want && !r.artistName.toLowerCase().includes(want.replace(/^the /, ''))) return;
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
      synth: null,
    });
  });
  return out;
}

// The searches for a crate: three artists from it, or one from each of four crates in
// the shuffle. Fewer calls than Apple's limit of about 20 a minute.
export function planSearches(genreId, rng) {
  if (genreId === 'all') {
    return shuffled(GENRES, rng).slice(0, 4).map((g) => ({ term: shuffled(g.terms, rng)[0], loose: !!g.loose, genre: g.id }));
  }
  const g = GENRES.find((x) => x.id === genreId) || GENRES[0];
  return shuffled(g.terms, rng).slice(0, 3).map((term) => ({ term, loose: !!g.loose, genre: g.id }));
}

// Eight rounds from a pool of tracks. Targets lean popular; rivals come from the same
// crate, at most one by the same artist.
export function buildRounds(pool, rng, count = ROUND_COUNT) {
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
  const head = shuffled(byPop.slice(0, Math.max(count, Math.ceil(byPop.length * 0.6))), rng);
  const targets = head.slice(0, count);
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
      if (mine && sameArtist >= 1) continue;
      if (mine) sameArtist++;
      picks.push(x);
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
export async function loadMatch({ genre = 'all', rng = Math.random, offline = false, fetchImpl = null, timeoutMs = 6000 } = {}) {
  if (!offline) {
    try {
      const plan = planSearches(genre, rng);
      const results = await Promise.all(plan.map(async (s) => {
        const url = `${ITUNES_SEARCH}?term=${encodeURIComponent(s.term)}&media=music&entity=song&limit=${LIMIT}`;
        const data = await getJson(url, { fetchImpl, timeoutMs });
        return parseResults(data, s).map((t) => ({ ...t, genre: s.genre }));
      }));
      // Interleave the searches so no single artist dominates the pool.
      const pool = [];
      const longest = Math.max(0, ...results.map((r) => r.length));
      for (let i = 0; i < longest; i++) for (const r of results) if (r[i]) pool.push(r[i]);
      const rounds = buildRounds(pool, rng);
      if (rounds) return { source: 'itunes', genre, rounds, searched: plan.map((p) => p.term) };
    } catch { /* fall through to the synth */ }
  }
  return { source: 'offline', genre, rounds: offlineRounds(rng), searched: [] };
}
