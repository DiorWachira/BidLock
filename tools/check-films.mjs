// Re-check Cold Open's film library against Apple's store: every film in films.js must
// still come back from a lookup by its ID, as a film with a trailer. Store listings
// drift (a studio pulls a film, a trailer is replaced), so run this now and then.
//
//   node tools/check-films.mjs
//
// One lookup per store, a batch at a time, paced for Apple's limit of about 20 calls a
// minute. Nothing is changed; it prints what to fix.

import { FILMS } from '../js/games/coldOpen/films.js';

const pause = () => new Promise((r) => setTimeout(r, 3300));
const byStore = new Map();
for (const f of FILMS) {
  const s = f.store || 'us';
  if (!byStore.has(s)) byStore.set(s, []);
  byStore.get(s).push(f);
}

let missing = 0;
for (const [store, films] of byStore) {
  for (let i = 0; i < films.length; i += 60) {
    const batch = films.slice(i, i + 60);
    const res = await fetch(`https://itunes.apple.com/lookup?id=${batch.map((f) => f.id).join(',')}&country=${store.toUpperCase()}`);
    const data = res.ok ? await res.json() : { results: [] };
    const found = new Map((data.results || []).map((r) => [String(r.trackId), r]));
    for (const f of batch) {
      const r = found.get(f.id);
      if (!r || r.kind !== 'feature-movie' || !r.previewUrl) {
        missing++;
        console.log(`  MISSING  ${f.title} (${f.year}) ${store} id ${f.id}${r ? ' (no trailer)' : ''}`);
      }
    }
    await pause();
  }
  console.log(`${store}: ${films.length} films checked`);
}
console.log(missing ? `\n${missing} to look at (remove them from films.js, or find their new IDs).` : `\nAll ${FILMS.length} films present, each with a trailer.`);
