// Re-check Soundclash's curated songs against the live iTunes Search API, since store
// listings drift: every anime catalogue song (by its artist, original version, with a
// preview), and how many of each artist's hits a crate search still finds.
//
//   node tools/check-songs.mjs            both
//   node tools/check-songs.mjs anime      the anime catalogue only
//   node tools/check-songs.mjs hits       the artist crates only
//
// Searches are paced at one every 3.3 s to stay under Apple's ~20 a minute, so a full
// run takes about eight minutes. Nothing is changed; it prints what to fix.

import { ANIME_SONGS } from '../js/games/sampleArena/animeSongs.js';
import { GENRES, parseResults, findSong, hitsFor, isHit } from '../js/games/sampleArena/itunesLoader.js';

const what = process.argv[2] || 'both';
const pause = () => new Promise((r) => setTimeout(r, 3300));
const search = async (term, limit) => {
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

let problems = 0;
if (what === 'both' || what === 'anime') {
  console.log(`Anime catalogue: ${ANIME_SONGS.length} songs`);
  for (const s of ANIME_SONGS) {
    try {
      const t = findSong(await search(`${s.artist} ${s.title}`, 15), s);
      if (!t) { problems++; console.log(`  MISSING  ${s.title} (${s.anime}) by ${s.artist}`); }
    } catch (e) { problems++; console.log(`  ERROR    ${s.title}: ${e.message}`); }
    await pause();
  }
}
if (what === 'both' || what === 'hits') {
  for (const g of GENRES) {
    if (!g.terms.length) continue;
    console.log(`${g.name}:`);
    for (const term of g.terms) {
      try {
        const list = parseResults(await search(term, 35), { term, loose: !!g.loose, hits: hitsFor(g.id, term) });
        const found = new Set(list.filter((t) => isHit(t.title, hitsFor(g.id, term))).map((t) => t.title.toLowerCase())).size;
        const flag = found < 4 ? '  LOW' : '';
        if (found < 4) problems++;
        console.log(`  ${term}: ${list.length} songs, ${found} hits${flag}`);
      } catch (e) { problems++; console.log(`  ERROR    ${term}: ${e.message}`); }
      await pause();
    }
  }
}
console.log(problems ? `\n${problems} to look at.` : '\nAll present.');
