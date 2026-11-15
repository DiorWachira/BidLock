// Checks that every lot's `wikiQuery` resolves to a Wikipedia article with a lead photograph.
// Usage: node tools/check-media.mjs
// A lot without a photograph still works in the game (it gets an illustrated card), so this
// is a content check, not a build step. It uses the same batched lookup as the game.
import { allItems } from '../js/data/categories.js';
import { batchUrl, readBatch } from '../js/utils/mediaLoader.js';

const items = allItems();
const bad = [];
let found = 0;

for (let i = 0; i < items.length; i += 40) {
  const chunk = items.slice(i, i + 40);
  const res = await fetch(batchUrl(chunk.map((it) => it.wikiQuery)), { headers: { 'User-Agent': 'lot-photo-check/1.0 (static site content check)' } });
  if (!res.ok) { console.log(`lookup failed: HTTP ${res.status}`); process.exit(2); }
  const byQuery = readBatch(await res.json());
  for (const it of chunk) {
    const hit = byQuery.get(it.wikiQuery);
    if (hit && hit.src) found++;
    else bad.push(`${it.id}  ${it.name}  "${it.wikiQuery}"  ${hit ? 'article has no free photograph' : 'no such article'}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}

console.log(`${found}/${items.length} lots have a photograph`);
if (bad.length) console.log(bad.join('\n'));
process.exit(bad.length ? 1 : 0);
