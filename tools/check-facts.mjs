// Re-check Fine Print's catalogue: every fact's source must still be a Wikipedia article
// (not missing, and not a disambiguation page). Run now and then:
//
//   node tools/check-facts.mjs
//
// It asks Wikipedia's page-summary API once per fact, one at a time, and waits when asked
// to slow down. Nothing is changed; it prints what to fix.

import { FACTS } from '../js/games/finePrint/facts.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const HEADERS = { 'User-Agent': 'fact-check-script/1.0 (a static party game checking its sources)', 'Api-User-Agent': 'fact-check-script/1.0' };
let bad = 0;
for (const f of FACTS) {
  const title = decodeURIComponent(f.src.split('/wiki/')[1]);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
  let res = null;
  try {
    for (let tries = 0; tries < 5; tries++) {
      res = await fetch(url, { headers: HEADERS });
      if (res.status !== 429) break;
      await pause(2000 * (tries + 1));
    }
    const data = res.ok ? await res.json() : null;
    if (!data || data.type === 'disambiguation') {
      bad++;
      console.log(`  ${data ? 'DISAMBIGUATION' : `MISSING (${res.status})`}  ${f.id}: ${title}`);
    }
  } catch (err) {
    bad++;
    console.log(`  UNREACHABLE  ${f.id}: ${title} (${err.message})`);
  }
  await pause(350);
}
console.log(bad ? `\n${bad} of ${FACTS.length} sources to look at.` : `\nAll ${FACTS.length} sources are Wikipedia articles.`);
