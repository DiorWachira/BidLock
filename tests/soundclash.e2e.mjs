// End-to-end tests for Soundclash: the crate picker, all three audio tiers, sabotage,
// the reveal and podium, a room with a guest, and the phone layout. Run with:
//   node tests/soundclash.e2e.mjs
// No real network: the iTunes search, previews and artwork are served by the test.
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../tools/serve.mjs';
import { ANIME_SONGS } from '../js/games/sampleArena/animeSongs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let failed = 0;
function ok(name, cond, detail) {
  results.push(`${cond ? 'pass ' : 'FAIL '}${name}${cond || detail == null ? '' : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// ---------- fixtures ----------
// Thirty seconds of a beat and a melody, as a WAV the browser can decode.
function wav(seconds = 30, sr = 8000) {
  const n = seconds * sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = t % 0.5;
    const v = 0.35 * Math.sin(2 * Math.PI * (220 + 110 * Math.floor(t * 2 % 4)) * t) + 0.5 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-beat * 12);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 20000))), 44 + i * 2);
  }
  return buf;
}
const WAV = wav();

function crc32(b) {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (r + x) & 255; raw[o + 1] = (g + y) & 255; raw[o + 2] = b; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ART = png(64, 64, [200, 60, 40]);

// An iTunes search answer: 20 songs for whatever artist was searched, or, for a named
// anime song ("LiSA Gurenge"), that song.
function search(term) {
  const song = ANIME_SONGS.find((x) => `${x.artist} ${x.title}` === term);
  if (song) {
    return { resultCount: 1, results: [{
      kind: 'song', trackId: `anime-${song.title}`, trackName: song.title, artistName: song.artist,
      previewUrl: `https://audio-ssl.itunes.apple.com/test/anime/${encodeURIComponent(song.title)}.m4a`,
      artworkUrl100: `https://is1-ssl.mzstatic.com/test/anime/${encodeURIComponent(song.title)}/100x100bb.jpg`, trackViewUrl: 'https://music.apple.com/test/anime',
    }] };
  }
  const results = [];
  for (let i = 0; i < 20; i++) {
    results.push({
      kind: 'song', trackId: `${term}-${i}`, trackName: `${term} Anthem ${i + 1}`, artistName: term,
      previewUrl: `https://audio-ssl.itunes.apple.com/test/${encodeURIComponent(term)}/${i}.m4a`,
      artworkUrl100: `https://is1-ssl.mzstatic.com/test/${encodeURIComponent(term)}/${i}/100x100bb.jpg`,
      trackViewUrl: `https://music.apple.com/test/${i}`,
    });
  }
  return { resultCount: results.length, results };
}

// ---------- the browser ----------
async function launch() {
  const args = ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
  // The headless shell first: it opens no OS windows.
  for (const channel of [undefined, 'msedge', 'chrome']) {
    try { return await chromium.launch({ channel, args }); } catch { /* next */ }
  }
  throw new Error('No browser found');
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

// itunes: 'off' (blocked: offline crate), 'cors' (tier 1), 'nocors' (tier 2)
// slowFirst: the first preview fetch takes this long (ms), like a slow line.
async function context(browser, { viewport = { width: 1366, height: 768 }, itunes = 'off', mobile = false, slowFirst = 0 } = {}) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript(() => { if (!localStorage.getItem('bidlock.guide.seen')) localStorage.setItem('bidlock.guide.seen', '1'); });
  await ctx.route('https://opentdb.com/**', (r) => r.abort());
  await ctx.route('https://en.wikipedia.org/**', (r) => r.abort());
  ctx.searches = [];
  await ctx.route('https://itunes.apple.com/**', (r) => {
    if (itunes === 'off') return r.abort();
    const term = new URL(r.request().url()).searchParams.get('term') || 'x';
    ctx.searches.push(term);
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(search(term)) });
  });
  // 'nocors' refuses the preview to fetch() (as a CORS block would) but serves the
  // <audio> element, which needs no CORS.
  let fetches = 0;
  await ctx.route('https://audio-ssl.itunes.apple.com/**', async (r) => {
    if (itunes === 'nocors' && r.request().resourceType() === 'fetch') return r.abort('accessdenied');
    if (slowFirst && r.request().resourceType() === 'fetch' && fetches++ === 0) await new Promise((x) => setTimeout(x, slowFirst));
    // Byte ranges, like the real CDN, so an <audio> element can seek to the hook.
    const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    if (range) {
      const a = Number(range[1]);
      const b = range[2] ? Math.min(Number(range[2]), WAV.length - 1) : WAV.length - 1;
      return r.fulfill({ status: 206, contentType: 'audio/wav', body: WAV.subarray(a, b + 1), headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${WAV.length}` } });
    }
    return r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV, headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' } });
  });
  await ctx.route('https://is1-ssl.mzstatic.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: ART, headers: { 'Access-Control-Allow-Origin': '*' } }));
  return ctx;
}

async function page(ctx, query = '') {
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title', null, { timeout: 30000 });
  return { page: p, errors };
}

const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const phase = (p) => p.evaluate(() => (window.__bidlock.arcade ? window.__bidlock.arcade.engine.phase : null));
const waitPhase = (p, ph, timeout = 40000) => p.waitForFunction((x) => window.__bidlock.arcade && window.__bidlock.arcade.engine.phase === x, ph, { timeout });
const runUntil = (p, body) => p.evaluate((b) => {
  const e = window.__bidlock.arcade.engine;
  const test = new Function('e', `return (${b});`);
  for (let i = 0; i < 400000 && !test(e); i++) {
    if (e.phase === 'PODIUM') break;
    e.update(1 / 30);
  }
  return test(e);
}, body);
const deck = (p) => p.evaluate(() => window.__bidlock.arcade.deck.status());

const browser = await launch();
const Q = '?trivia=local&media=off';

try {
  // ---------- 1. The crate picker, and the offline crate when iTunes is out of reach
  {
    const ctx = await context(browser);
    const { page: p, errors } = await page(ctx, Q);
    ok('the title lists five shows', (await p.locator('#channels .channel').count()) === 5);
    ok('the crate picker is hidden for BidLock', !(await p.locator('#soundclash-opts').isVisible()));
    await p.locator('.channel[data-game="soundclash"]').click();
    ok('picking Soundclash shows the crates', await p.locator('#soundclash-opts').isVisible() && (await p.locator('.sc-crate').count()) === 7);
    ok('the shuffle is the default crate', (await p.locator('.sc-crate[aria-checked="true"]').getAttribute('data-genre')) === 'all');
    await p.locator('.sc-crate[data-genre="rock"]').click();
    ok('a crate can be picked', (await p.locator('.sc-crate[aria-checked="true"]').getAttribute('data-genre')) === 'rock');
    await p.locator('.sc-crate[data-genre="rock"]').focus();
    await p.keyboard.press('ArrowRight');
    ok('arrow keys move along the crates', (await p.locator('.sc-crate[aria-checked="true"]').getAttribute('data-genre')) === 'anime');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title');
    ok('the crate is remembered', (await p.locator('.sc-crate[aria-checked="true"]').getAttribute('data-genre')) === 'anime');
    await p.locator('.sc-crate[data-genre="pop"]').click();
    ok('three difficulty levels, normal by default', (await p.locator('#sc-level-list .sc-level').count()) === 3 && (await p.locator('#sc-level-list .sc-level[aria-checked="true"]').getAttribute('data-level')) === 'normal');
    await p.locator('#sc-level-list .sc-level[data-level="easy"]').click();
    ok('a level can be picked', (await p.locator('#sc-level-list .sc-level[aria-checked="true"]').getAttribute('data-level')) === 'easy');
    await shot(p, 'title-soundclash');

    await p.locator('#btn-start').click();
    await waitPhase(p, 'PLAY');
    const st = await p.evaluate(() => window.__bidlock.arcade.debugState());
    ok('with iTunes blocked, the offline crate plays', st.source === 'offline', JSON.stringify(st));
    ok('easy: only the gentle warps', await p.evaluate(() => window.__bidlock.arcade.engine.current && ['NIGHTCORE_UP', 'CHOPPED_SCREWED'].includes(window.__bidlock.arcade.engine.current.warp)));
    await p.waitForTimeout(800);
    ok('tier 3: the synth tune through the Web Audio graph', (await deck(p)).tier === 3);
    const spec = await p.evaluate(() => Array.from(window.__bidlock.arcade.deck.spectrum()).reduce((a, b) => a + b, 0));
    ok('the analyser feeds the spectrum ring', spec > 500, String(spec));
    ok('the warp badge names the warp', /^WARP: /.test(await p.locator('#sc-warp').textContent()));
    ok('four answers, keys 1 to 4', (await p.locator('.sc-ans').count()) === 4 && (await p.locator('.sc-ans kbd').first().textContent()) === '1');
    ok('the answer is not on the page', (await p.evaluate(() => window.__bidlock.arcade.engine.serialize().c)) === -1);
    // A rival muffles you.
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[1].score = 3000; e.sabotageFor(1, 'under', 0); });
    await p.waitForTimeout(400);
    ok('underwater: the sound is muffled', (await deck(p)).fx.under === true);
    ok('underwater: the picture ripples', (await p.locator('#sc-water').getAttribute('data-on')) === '1');
    await p.waitForSelector('#sc-alert:not([hidden])', { timeout: 3000 });
    ok('the incoming alert names the thrower', /SABOTAGED BY .+: UNDERWATER!/.test(await p.locator('#sc-alert').textContent()));
    await shot(p, 'soundclash-underwater');
    // Throw one back.
    await p.evaluate(() => { window.__bidlock.arcade.engine.players[0].score = 1500; });
    await p.waitForTimeout(200);
    await p.locator('.sc-sab[data-sab="scratch"]').click();
    ok('your dubplate costs 450', (await p.evaluate(() => window.__bidlock.arcade.engine.players[0].score)) === 1050);
    ok('one throw a round: the dock locks', (await p.locator('#sc-dock').getAttribute('data-used')) === '1' && (await p.locator('.sc-sab:not([disabled])').count()) === 0);
    await p.keyboard.press('1');
    ok('key 1 picks an answer', (await p.locator('.sc-ans[data-state="mine"]').count()) === 1 && (await p.locator('.sc-ans[data-state="mine"]').getAttribute('data-i')) === '0');
    const firstAt = await p.evaluate(() => window.__bidlock.arcade.engine.me.at);
    await p.waitForTimeout(500);
    ok('the buttons stay live after picking', (await p.locator('.sc-ans:not([disabled])').count()) === 4);
    await p.locator('.sc-ans[data-i="2"]').click();
    const changed = await p.evaluate(() => ({ choice: window.__bidlock.arcade.engine.me.choice, at: window.__bidlock.arcade.engine.me.at }));
    ok('you can change your answer', changed.choice === 2 && (await p.locator('.sc-ans[data-state="mine"]').getAttribute('data-i')) === '2', JSON.stringify(changed));
    ok('a change resets your time', changed.at > firstAt + 0.3, `${firstAt} -> ${changed.at}`);
    ok('the card says you can still change it', /CHANGE IT UNTIL THE CLOCK RUNS OUT/.test(await p.locator('#sc-label').textContent()));
    await waitPhase(p, 'REVEAL', 20000);
    await p.waitForSelector('#sc-reveal:not([hidden])');
    ok('the reveal shows the song and who got it', (await p.locator('#sc-reveal h2').textContent()).length > 0 && (await p.locator('.sc-delta li').count()) === 6);
    ok('offline songs are credited as public domain', (await p.locator('#sc-reveal .sc-store').textContent()).includes('Public domain'));
    ok('the right answer lights up', (await p.locator('.sc-ans[data-state="right"]').count()) === 1);
    await shot(p, 'soundclash-reveal');
    // Round two: a scramble and a shockwave on you.
    await waitPhase(p, 'PLAY', 20000);
    const before = await p.locator('.sc-ans').evaluateAll((bs) => bs.map((b) => b.dataset.i).join(''));
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[2].score = 3000; e.sabotageFor(2, 'scratch', 0); e.players[3].score = 3000; e.sabotageFor(3, 'shock', 0); });
    await p.waitForTimeout(300);
    const order = await p.evaluate(() => window.__bidlock.arcade.order().join(''));
    const after = await p.locator('.sc-ans').evaluateAll((bs) => bs.map((b) => b.dataset.i).join(''));
    ok('scramble: the buttons follow the shuffled order', after === order && before === '0123', `${before} -> ${after} (${order})`);
    ok('shockwave: the card flips over', (await p.locator('#sc-q').getAttribute('data-flip')) === '1');
    ok('shockwave: the loop is reversed or chipmunked', ['reverse', 'chipmunk'].includes((await deck(p)).fx.shock));
    await shot(p, 'soundclash-shockwave');
    await runUntil(p, 'e.phase === "PLAY" && e.overtime');
    await p.waitForTimeout(150);
    ok('overtime: the warp lifts', (await deck(p)).clean === true && (await p.locator('#sc-warp').textContent()).includes('OVERTIME'));
    // On to the podium.
    await runUntil(p, "e.phase === 'PODIUM'");
    await p.waitForSelector('#sc-card:not([hidden]) .ag-rank', { timeout: 10000 });
    ok('the podium crowns an MVP DJ', (await p.locator('.sc-award').count()) === 4 && (await p.locator('.sc-award').first().textContent()).includes('MVP DJ'));
    ok('six sounds ranked', (await p.locator('#sc-card .ag-rank li').count()) === 6);
    ok('the music stops at the podium', (await deck(p)).tier >= 0 && !(await p.evaluate(() => window.__bidlock.arcade.deck.playing)));
    await p.waitForTimeout(1200);
    await shot(p, 'soundclash-podium');
    await p.locator('#sc-card [data-ag="again"]').click();
    await waitPhase(p, 'INTRO', 15000).catch(() => {});
    ok('play again starts a new clash', ['INTRO', 'CUE', 'PLAY'].includes(await phase(p)));
    await p.evaluate(() => window.__bidlock.arcade.shell.exit());
    await p.waitForFunction(() => window.__bidlock.screen === 'title');
    // Blocking iTunes logs one "failed to load" per blocked request; nothing else may appear.
    const real = errors.filter((x) => !/Failed to load resource/.test(x));
    ok('no console errors (offline crate)', real.length === 0, real.join(' | '));
    await ctx.close();
  }

  // ---------- 2. Tier 1: a real search, decoded previews, artwork and the store link
  {
    const ctx = await context(browser, { itunes: 'cors', slowFirst: 7000 });
    const { page: p, errors } = await page(ctx, `${Q}&seed=3`);
    await p.locator('.channel[data-game="soundclash"]').click();
    await p.locator('.sc-crate[data-genre="rock"]').click();
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => /Cueing up the first record/.test(document.querySelector('#sc-card')?.textContent || ''), null, { timeout: 10000 });
    ok('a slow first preview: the start waits, cueing up the record', (await phase(p)) === 'IDLE');
    await waitPhase(p, 'PLAY');
    ok('five artists searched for one crate', ctx.searches.length === 5 && new Set(ctx.searches).size === 5, ctx.searches.join(', '));
    ok('the searches come from the chosen crate', ctx.searches.every((t) => ['Arctic Monkeys', 'The Killers', 'Foo Fighters', 'Red Hot Chili Peppers', 'Linkin Park', 'Nirvana', 'Coldplay', 'Imagine Dragons', 'The Strokes', 'Muse', 'Paramore', 'Green Day', 'Oasis', 'Tame Impala', 'Radiohead'].includes(t)));
    await p.waitForFunction(() => window.__bidlock.arcade.deck.tier > 0, null, { timeout: 5000 });
    ok('tier 1 from the first round, even on a slow line', (await deck(p)).tier === 1, JSON.stringify(await deck(p)));
    ok('the source chip says Web Audio', (await p.locator('#sc-tier').textContent()).includes('WEB AUDIO'));
    ok('iTunes is credited', await p.locator('#sc-credit').isVisible());
    await p.waitForFunction(() => Object.values(window.__bidlock.arcade.deck.status().cache).filter((s) => s === 'ok').length >= 3, null, { timeout: 10000 });
    ok('later previews are fetched ahead', true);
    await p.keyboard.press('2');
    await waitPhase(p, 'REVEAL', 20000);
    await p.waitForSelector('#sc-reveal:not([hidden]) img.sc-sleeve');
    ok('the reveal shows the album artwork', (await p.locator('#sc-reveal img.sc-sleeve').getAttribute('src')).includes('400x400bb'));
    ok('the reveal links to the store', (await p.locator('#sc-reveal a.sc-store').getAttribute('href')).startsWith('https://music.apple.com/'));
    ok('no console errors (tier 1)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 2b. Anime Openings & Endings: named songs, with the anime in brackets
  {
    const ctx = await context(browser, { itunes: 'cors' });
    const { page: p, errors } = await page(ctx, `${Q}&seed=12`);
    await p.locator('.channel[data-game="soundclash"]').click();
    ok('the anime crate is called Anime Openings & Endings', (await p.locator('.sc-crate[data-genre="anime"] b').textContent()) === 'Anime Openings & Endings');
    await p.locator('.sc-crate[data-genre="anime"]').click();
    await p.locator('#sc-level-list .sc-level[data-level="hard"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'PLAY');
    ok('eleven named songs are searched', ctx.searches.length === 11 && ctx.searches.every((t) => ANIME_SONGS.some((x) => `${x.artist} ${x.title}` === t)), ctx.searches.join(', '));
    const titles = await p.locator('.sc-ans .sc-t').allTextContents();
    ok('every answer names its anime in brackets', titles.length === 4 && titles.every((t) => /\(.+\)$/.test(t)), titles.join(' | '));
    const target = await p.evaluate(() => window.__bidlock.arcade.match.rounds[0].target);
    const base = (a) => String(a).replace(/:.*$/, '').replace(/\s+\d+$/, '').trim().toLowerCase();
    const sameAnime = titles.filter((t) => base(/\(([^()]+)\)$/.exec(t)[1]) === base(target.anime)).length;
    const pool = ANIME_SONGS.filter((x) => base(x.anime) === base(target.anime)).length;
    ok('hard: the rivals come from the same anime where they can', sameAnime === Math.min(4, pool), `${target.anime}: ${sameAnime} of ${titles.length}, ${pool} in the catalogue`);
    await p.keyboard.press('1');
    await waitPhase(p, 'REVEAL', 25000);
    await p.waitForSelector('#sc-reveal:not([hidden]) h2');
    ok('the reveal shows the song and its anime', /\(.+\)$/.test(await p.locator('#sc-reveal h2').textContent()));
    // Songs found are kept for the next match on this device.
    await p.evaluate(() => window.__bidlock.arcade.shell.exit());
    await p.waitForFunction(() => window.__bidlock.screen === 'title');
    const cached = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bidlock.sc.songs') || '{}')).length);
    ok('found songs are remembered on the device', cached >= 8, String(cached));
    ok('no console errors (anime crate)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 3. Tier 2: the preview cannot be fetched, so it streams
  {
    const ctx = await context(browser, { itunes: 'nocors' });
    const { page: p, errors } = await page(ctx, `${Q}&seed=4`);
    await p.locator('.channel[data-game="soundclash"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'PLAY');
    await p.waitForFunction(() => window.__bidlock.arcade.deck.tier > 0, null, { timeout: 5000 });
    ok('tier 2: a CORS-blocked preview streams through an audio element', (await deck(p)).tier === 2, JSON.stringify(await deck(p)));
    await p.waitForFunction(() => { const el = window.__bidlock.arcade.deck.el; return el && !el.paused && el.currentTime > 0; }, null, { timeout: 8000 });
    const el = await p.evaluate(() => { const a = window.__bidlock.arcade.deck.el; return { rate: a.playbackRate, pitch: a.preservesPitch, t: a.currentTime, start: window.__bidlock.arcade.deck.elStart }; });
    ok('tier 2: playing inside the hook window', el.t >= el.start - 0.1 && el.t <= el.start + 3.2, JSON.stringify(el));
    const warp = await p.evaluate(() => window.__bidlock.arcade.engine.current.warp);
    const want = { NIGHTCORE_UP: 1.35, CHOPPED_SCREWED: 0.72, UNDERWATER_SUB: 1, REVERSE_SPIN: 0.75 }[warp];
    ok('tier 2: the warp is a playback rate with pitch unlocked', Math.abs(el.rate - want) < 0.01 && el.pitch === false, `${warp}: ${JSON.stringify(el)}`);
    await p.waitForTimeout(600);
    const spec = await p.evaluate(() => Array.from(window.__bidlock.arcade.deck.spectrum()).reduce((a, b) => a + b, 0));
    ok('tier 2: the ring follows a beat-synced envelope', spec > 500, String(spec));
    const real = errors.filter((x) => !/Failed to load resource/.test(x));
    ok('no console errors (tier 2)', real.length === 0, real.join(' | '));
    await ctx.close();
  }

  // ---------- 4. A room: the host picks Soundclash and a crate; a guest plays along
  {
    const ctx = await context(browser);
    const q = `${Q}&net=local&seed=8&music=offline`;
    const { page: host, errors: hostErrors } = await page(ctx, q);
    const { page: guest, errors: guestErrors } = await page(ctx, q);
    await host.locator('.channel[data-game="soundclash"]').click();
    await host.locator('#btn-friends').click();
    await host.locator('#lobby-name').fill('Alpha');
    await host.locator('#lobby-create').click();
    await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open');
    ok('the room starts on Soundclash', (await host.evaluate(() => window.__bidlock.lobby.state.game)) === 'soundclash');
    ok('the lobby shows the crates to the host', await host.locator('#lobby-crates').isVisible() && (await host.locator('#lobby-crates .sc-crate:not([disabled])').count()) === 7);
    await host.locator('#lobby-crates .sc-crate[data-genre="throwback"]').click();
    const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
    await guest.locator('#btn-friends').click();
    await guest.locator('#lobby-name').fill('Bravo');
    await guest.locator('#lobby-code').fill(code);
    await guest.locator('#lobby-join').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.status === 'open' && window.__bidlock.lobby.state.players.length === 2, null, { timeout: 10000 });
    ok('the lobby shows the difficulty too', (await host.locator('#lobby-crates .sc-level').count()) === 3);
    ok('the guest sees the crate, and cannot change it', (await guest.locator('#lobby-crates .sc-crate[aria-pressed="true"]').getAttribute('data-genre')) === 'throwback' && (await guest.locator('#lobby-crates .sc-crate:not([disabled])').count()) === 0);
    ok('six sounds at the table', (await host.evaluate(() => window.__bidlock.lobby.seats().length)) === 6);
    await host.waitForTimeout(300);
    await shot(host, 'lobby-soundclash');
    await host.locator('#lobby-start').click();
    await guest.waitForFunction(() => window.__bidlock.arcade && window.__bidlock.arcade.id === 'soundclash' && window.__bidlock.arcade.engine.phase === 'PLAY', null, { timeout: 30000 });
    ok('the guest drops into the clash on seat 2', (await guest.evaluate(() => window.__bidlock.arcade.engine.localId)) === 1);
    const opts = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.arcade.engine.current.options.map((o) => o.title).join('|'))));
    ok('both hear the same round', opts[0] === opts[1]);
    ok('the guest is not sent the answer', (await guest.evaluate(() => window.__bidlock.arcade.engine.correct)) === -1);
    await guest.waitForFunction(() => window.__bidlock.arcade.deck.tier === 3, null, { timeout: 5000 });
    ok("the guest's own speakers play the loop", true);
    await guest.locator('.sc-ans[data-i="2"]').click();
    await host.waitForFunction(() => window.__bidlock.arcade.engine.players[1].locked && window.__bidlock.arcade.engine.players[1].choice === 2, null, { timeout: 5000 });
    ok("the guest's answer reaches the host", true);
    ok("rivals' picks stay hidden from the guest", (await guest.evaluate(() => window.__bidlock.arcade.engine.players.every((p) => p.choice == null || p.id === 1))));
    // The host throws a dubplate at the guest.
    await host.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[0].score = 900; });
    await guest.locator('.sc-ans').first().waitFor();
    await runUntil(host, "e.phase === 'REVEAL'");
    await runUntil(host, "e.phase === 'PLAY'");
    await guest.waitForFunction(() => window.__bidlock.arcade.engine.phase === 'PLAY' && window.__bidlock.arcade.engine.round === 2, null, { timeout: 10000 });
    await host.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[0].score = 900; e.sabotageFor(0, 'under', 1); });
    await guest.waitForFunction(() => window.__bidlock.arcade.deck.fx.under === true, null, { timeout: 5000 });
    ok("the host's dubplate muffles the guest's audio", true);
    await guest.waitForSelector('#sc-alert:not([hidden])', { timeout: 3000 });
    ok('the guest is told who did it', (await guest.locator('#sc-alert').textContent()).includes('ALPHA'));
    await runUntil(host, "e.phase === 'PODIUM'");
    await guest.waitForSelector('#sc-card:not([hidden]) .ag-rank', { timeout: 15000 });
    const mvps = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.arcade.engine.awards.mvp)));
    ok('both crown the same MVP', mvps[0] === mvps[1]);
    ok('only the host can play again', (await guest.locator('#sc-card [data-ag="again"]').count()) === 0);
    await host.locator('#sc-card [data-ag="exit"]').click();
    await guest.waitForFunction(() => window.__bidlock.screen === 'title' && !window.__bidlock.arcade, null, { timeout: 10000 });
    await host.locator('.lg-game[data-game="bidlock"]').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.game === 'bidlock', null, { timeout: 5000 });
    ok('back in the lobby, the room can switch back to BidLock', (await guest.locator('#lobby-crates').isHidden()));
    ok('no console errors in the room (host)', hostErrors.length === 0, hostErrors.join(' | '));
    ok('no console errors in the room (guest)', guestErrors.length === 0, guestErrors.join(' | '));
    await ctx.close();
  }

  // ---------- 4b. A slow link: 150 ms each way between host and guest
  {
    const ctx = await context(browser);
    const q = `${Q}&net=local&lag=150&seed=9&music=offline`;
    const { page: host, errors: hostErrors } = await page(ctx, q);
    const { page: guest, errors: guestErrors } = await page(ctx, q);
    await host.locator('.channel[data-game="soundclash"]').click();
    await host.locator('#btn-friends').click();
    await host.locator('#lobby-name').fill('Alpha');
    await host.locator('#lobby-create').click();
    await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open');
    const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
    await guest.locator('#btn-friends').click();
    await guest.locator('#lobby-name').fill('Slowpoke');
    await guest.locator('#lobby-code').fill(code);
    await guest.locator('#lobby-join').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.status === 'open' && window.__bidlock.lobby.state.players.length === 2, null, { timeout: 15000 });
    await host.waitForSelector('#lobby-players .lp-link', { timeout: 8000 });
    const shown = await host.locator('#lobby-players .lp-link').textContent();
    ok('the host sees the guest\'s round trip in the lobby', /^\d+ ms$/.test(shown) && Number.parseInt(shown, 10) >= 280 && Number.parseInt(shown, 10) < 450, shown);
    ok('a slow link is flagged', (await host.locator('#lobby-players .lp-link').getAttribute('data-q')) === 'slow');
    await guest.waitForFunction(() => /ms/.test(document.querySelector('#roomchip').textContent), null, { timeout: 5000 });
    ok('the guest sees its own link in the room chip', (await guest.locator('#roomchip').getAttribute('data-slow')) === '1');
    await host.locator('#lobby-players').scrollIntoViewIfNeeded();
    await host.waitForTimeout(300);
    await shot(host, 'lobby-link');
    await host.locator('#lobby-start').click();
    await guest.waitForFunction(() => window.__bidlock.arcade && window.__bidlock.arcade.engine.phase === 'PLAY' && window.__bidlock.arcade.engine.elapsed > 2, null, { timeout: 30000 });
    // The two clocks agree, though every tick is 150 ms old when it lands.
    const drift = [];
    for (let i = 0; i < 6; i++) {
      const [h, g] = await Promise.all([host.evaluate(() => window.__bidlock.arcade.engine.t), guest.evaluate(() => window.__bidlock.arcade.engine.t)]);
      drift.push(Math.abs(h - g));
      await host.waitForTimeout(250);
    }
    const worst = Math.max(...drift);
    ok('the guest\'s clock keeps step with the host\'s despite the delay', worst < 0.2, drift.map((d) => d.toFixed(2)).join(' '));
    // The guest answers; the host times it from when it was pressed, not when it landed.
    const pressedAt = await guest.evaluate(() => { const g = window.__bidlock.arcade; const at = g.engine.elapsed; g.pick(0); return at; });
    await host.waitForFunction(() => window.__bidlock.arcade.engine.players[1].locked, null, { timeout: 5000 });
    const recorded = await host.evaluate(() => window.__bidlock.arcade.engine.players[1].at);
    ok('the guest\'s answer is timed from the press, not the arrival', Math.abs(recorded - pressedAt) < 0.12, `pressed ${pressedAt.toFixed(2)} s, recorded ${recorded.toFixed(2)} s`);
    ok('no console errors on a slow link (host)', hostErrors.length === 0, hostErrors.join(' | '));
    ok('no console errors on a slow link (guest)', guestErrors.length === 0, guestErrors.join(' | '));
    await ctx.close();
  }

  // ---------- 4c. Check my connection, in a browser set up like Brave with WebRTC restricted
  {
    const strict = await chromium.launch({ args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    const ctx = await strict.newContext();
    await ctx.addInitScript(() => localStorage.setItem('bidlock.guide.seen', '1'));
    const p = await ctx.newPage();
    const summaries = [];
    p.on('console', (m) => { if (/\[BidLock rooms\]/.test(m.text())) summaries.push(m.text()); });
    // Without the room server, which would make every network fine (rooms.e2e.mjs checks that).
    await p.goto(`${BASE}${Q}&rooms=off`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title', null, { timeout: 30000 });
    await p.locator('#btn-friends').click();
    await p.locator('#lobby-check-btn').click();
    await p.waitForFunction(() => document.querySelector('#lobby-check').dataset.verdict, null, { timeout: 20000 });
    ok('check: a browser that forbids direct connections is caught', (await p.locator('#lobby-check').getAttribute('data-verdict')) === 'bad');
    const text = await p.locator('#lobby-check').innerText();
    ok('check: it says how to fix it in Brave', /not allowed to make direct connections/.test(text) && /WebRTC IP handling policy/.test(text), text);
    ok('check: one console line sums it up', summaries.length === 1 && / host:0 stun:0 relay:0/.test(summaries[0]), summaries.join(' | '));
    await p.locator('#lobby-check').scrollIntoViewIfNeeded();
    await shot(p, 'lobby-check');
    await strict.close();
  }

  // ---------- 5. Phone
  {
    const ctx = await context(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    const { page: p, errors } = await page(ctx, `${Q}&music=offline`);
    await p.locator('.channel[data-game="soundclash"]').click();
    ok('phone: no overflow on the title', (await overflow(p)) <= 0, String(await overflow(p)));
    await p.locator('#btn-start').click();
    await waitPhase(p, 'PLAY');
    await p.waitForTimeout(600);
    ok('phone: no overflow in the club', (await overflow(p)) <= 0, String(await overflow(p)));
    const rects = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { dock: r('#sc-dock'), deck: r('#sc-q'), clock: r('#sc-clock'), warp: r('#sc-warp') };
    });
    ok('phone: the dock sits above the answers', rects.dock.bottom <= rects.deck.top + 1, JSON.stringify([rects.dock.bottom, rects.deck.top]));
    ok('phone: the clock sits below the chips', rects.clock.top >= rects.warp.bottom - 1, JSON.stringify([rects.clock.top, rects.warp.bottom]));
    await p.locator('.sc-ans').nth(1).tap();
    ok('phone: tapping an answer locks it in', (await p.locator('.sc-ans[data-state="mine"]').count()) === 1);
    await shot(p, 'phone-soundclash');
    ok('phone: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} catch (err) {
  ok('the run completed without a crash', false, String(err && err.message ? err.message : err).slice(0, 400));
} finally {
  await browser.close();
  server.close();
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
