// End-to-end tests for Cold Open, with no real network: Apple's lookup, the trailers and
// the posters are all served by the test. The "trailer" is a short colour-bar film the
// test records in the browser itself (WebM, which the headless browser can play).
// Writes screenshots to screenshots/. Usage: node tests/coldopen.e2e.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../tools/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let failed = 0;
function ok(name, cond, detail) {
  results.push(`${cond ? 'pass ' : 'FAIL '}${name}${cond || detail == null ? '' : `  -> ${detail}`}`);
  if (!cond) failed++;
}

async function launch() {
  const args = ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
  for (const channel of [undefined, 'msedge', 'chrome']) {
    try { return await chromium.launch({ channel, args }); } catch { /* next */ }
  }
  throw new Error('No browser found');
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const Q = '?trivia=local&media=off';
// A plain poster: 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8z/D/PwAHggJ/Pp3WJgAAAABJRU5ErkJggg==', 'base64');

// Record six seconds of colour bars with a moving block, as WebM.
async function makeFilm(browser) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE + Q, { waitUntil: 'domcontentloaded' });
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 500000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(250);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * c.width / 7, 0, c.width / 7 + 1, c.height); });
        g.fillStyle = '#111';
        g.fillRect((t * 70) % c.width, 60, 40, 60);
        g.fillStyle = '#fff';
        g.font = 'bold 26px sans-serif';
        g.fillText(t.toFixed(1), 10, 165);
        if (t < 6) requestAnimationFrame(draw); else resolve();
      };
      draw();
    });
    rec.stop();
    await new Promise((r) => { rec.onstop = r; });
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await ctx.close();
  return Buffer.from(b64, 'base64');
}

// lookup: 'ok' (every film found) or 'off' (the library cannot be reached).
async function context(browser, film, { viewport = { width: 1366, height: 768 }, lookup = 'ok', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript(() => { if (!localStorage.getItem('bidlock.guide.seen')) localStorage.setItem('bidlock.guide.seen', '1'); });
  await ctx.route('https://opentdb.com/**', (r) => r.abort());
  await ctx.route('https://en.wikipedia.org/**', (r) => r.abort());
  ctx.lookups = [];
  await ctx.route('https://itunes.apple.com/**', (r) => {
    if (lookup === 'off') return r.abort();
    const u = new URL(r.request().url());
    ctx.lookups.push(u.href);
    const ids = (u.searchParams.get('id') || '').split(',').filter(Boolean);
    const body = { resultCount: ids.length, results: ids.map((id) => ({ kind: 'feature-movie', trackId: Number(id), trackName: 'x', previewUrl: `https://video-ssl.itunes.apple.com/test/${id}.m4v`, artworkUrl100: `https://is1-ssl.mzstatic.com/test/${id}/100x100bb.jpg`, trackViewUrl: `https://itunes.apple.com/us/movie/test/id${id}` })) };
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  await ctx.route('https://video-ssl.itunes.apple.com/**', (r) => {
    const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    const head = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    if (range) {
      const a = Number(range[1]);
      const b = range[2] ? Math.min(Number(range[2]), film.length - 1) : film.length - 1;
      return r.fulfill({ status: 206, contentType: 'video/webm', body: film.subarray(a, b + 1), headers: { ...head, 'Content-Range': `bytes ${a}-${b}/${film.length}` } });
    }
    return r.fulfill({ status: 200, contentType: 'video/webm', body: film, headers: head });
  });
  await ctx.route('https://is1-ssl.mzstatic.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } }));
  return ctx;
}

async function page(ctx, query = Q) {
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|GPU stall|GL Driver Message/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title', null, { timeout: 30000 });
  return { page: p, errors };
}

const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const phase = (p) => p.evaluate(() => (window.__bidlock.arcade ? window.__bidlock.arcade.engine.phase : null));
const waitPhase = (p, ph, timeout = 40000) => p.waitForFunction((x) => window.__bidlock.arcade && window.__bidlock.arcade.engine.phase === x, ph, { timeout });
const film = (p) => p.evaluate(() => window.__bidlock.arcade.projector.status());
const uniforms = (p) => p.evaluate(() => { const u = window.__bidlock.arcade.stage.uniforms; return { focus: u.uFocus.value, burn: u.uBurn.value, decoyMix: u.uDecoyMix.value, clear: u.uClear.value, cue: u.uCue.value, fault: u.uFault.value }; });
const runUntil = (p, body) => p.evaluate((b) => {
  const e = window.__bidlock.arcade.engine;
  const test = new Function('e', `return (${b});`);
  for (let i = 0; i < 400000 && !test(e); i++) { if (e.phase === 'PODIUM') break; e.update(1 / 30); }
  return test(e);
}, body);

const browser = await launch();

try {
  const reel = await makeFilm(browser);
  ok('a test film was recorded', reel.length > 20000, `${reel.length} bytes`);

  // ---------- 1. The title: six shows, Cold Open's programmes and difficulty
  {
    const ctx = await context(browser, reel);
    const { page: p, errors } = await page(ctx);
    ok('the title lists six shows', (await p.locator('#channels .channel').count()) === 6);
    ok('the programme picker is hidden for other shows', !(await p.locator('#coldopen-opts').isVisible()));
    await p.locator('.channel[data-game="coldopen"]').click();
    ok('picking Cold Open shows its programmes', await p.locator('#coldopen-opts').isVisible() && (await p.locator('#co-prog-list .co-prog').count()) === 7);
    ok('the slot is the late movie', /23:00/.test(await p.locator('#title-slug').textContent()));
    await p.locator('.co-prog[data-programme="heroes"]').click();
    await p.locator('#co-level-list .sc-level[data-level="hard"]').click();
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title');
    ok('the programme is remembered', (await p.locator('.co-prog[aria-checked="true"]').getAttribute('data-programme')) === 'heroes');
    ok('one difficulty for Soundclash and Cold Open', (await p.locator('#sc-level-list .sc-level[aria-checked="true"]').getAttribute('data-level')) === 'hard');
    await p.locator('#co-level-list .sc-level[data-level="normal"]').click();
    await shot(p, 'title-coldopen');
    ok('no console errors (title)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 2. The library out of reach: the show says so, and the way back works
  {
    const ctx = await context(browser, reel, { lookup: 'off' });
    const { page: p } = await page(ctx);
    await p.locator('.channel[data-game="coldopen"]').click();
    await p.locator('#btn-start').click();
    await p.waitForSelector('#co-card:not([hidden]) [data-ag="exit"]', { timeout: 30000 });
    ok('no library: the card says the film library cannot be reached', /film library cannot be reached/.test(await p.locator('#co-card').textContent()));
    await p.locator('#co-card [data-ag="exit"]').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'title', null, { timeout: 10000 });
    ok('and the way back works', true);
    await ctx.close();
  }

  // ---------- 3. A solo match, start to box office
  {
    const ctx = await context(browser, reel);
    const { page: p, errors } = await page(ctx, `${Q}&seed=6`);
    await p.locator('.channel[data-game="coldopen"]').click();
    await p.locator('.co-prog[data-programme="all"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'CUE');
    ok('one lookup per store for the whole match', ctx.lookups.length >= 1 && ctx.lookups.length <= 4 && ctx.lookups.every((u) => u.startsWith('https://itunes.apple.com/lookup?id=')), ctx.lookups.length);
    await p.waitForTimeout(500);
    ok('the countdown leader runs before the reel', (await p.evaluate(() => window.__bidlock.arcade.stage.mode)) === 'leader');
    await shot(p, 'coldopen-leader');
    await waitPhase(p, 'PLAY');
    await p.waitForFunction(() => window.__bidlock.arcade.projector.status().tier === 1, null, { timeout: 10000 }).catch(() => {});
    let f = await film(p);
    ok('the trailer runs on the screen', f.tier === 1 && f.playing && f.looping && !f.sound, JSON.stringify(f));
    ok('the source chip says trailer', (await p.locator('#co-tier').textContent()) === 'SOURCE: TRAILER');
    ok('the print fault is named', /^PRINT: /.test(await p.locator('#co-fault').textContent()));
    ok('Apple is credited', await p.locator('#co-credit').isVisible());
    const labels = await p.locator('.co-ans').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    ok('four films on the marquee, each with its year', labels.length === 4 && labels.every((l) => /\(\d{4}\)$/.test(l)), labels.join(' | '));
    ok('the titles are spelled out in marquee letters', (await p.locator('.co-ans .co-mq i').count()) >= 8);
    ok('the answer is not on the page', (await p.evaluate(() => window.__bidlock.arcade.engine.serialize().c)) === -1);
    await p.waitForTimeout(3500);
    f = await film(p);
    ok('the clip loops: it stays inside its few seconds', f.time >= f.start - 0.05 && f.time <= f.start + f.len + 0.4, JSON.stringify(f));
    await shot(p, 'coldopen-play');
    await p.keyboard.press('1');
    ok('key 1 picks a film', (await p.locator('.co-ans[data-state="mine"]').count()) === 1);
    // The booth, aimed at me.
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[1].score = 3000; e.sabotageFor(1, 'focus', 0); });
    await p.waitForTimeout(250);
    ok('soft focus blurs my picture', (await uniforms(p)).focus === 1);
    await p.waitForSelector('#co-alert:not([hidden])', { timeout: 3000 });
    ok('the alert names who did it', /FROM THE BOOTH, .+: SOFT FOCUS!/.test(await p.locator('#co-alert').textContent()));
    await runUntil(p, 'e.overtime');
    await p.waitForTimeout(900);
    f = await film(p);
    ok('the changeover: the loop lets go and the sound comes up', !f.looping && f.sound, JSON.stringify(f));
    ok('the fault badge says changeover', /CHANGEOVER/.test(await p.locator('#co-fault').textContent()));
    ok('the picture clears', (await uniforms(p)).clear > 0.9);
    await waitPhase(p, 'REVEAL', 20000);
    await p.waitForSelector('#co-reveal:not([hidden]) h2');
    ok('the reveal: the poster in its case', (await p.locator('#co-reveal img.co-poster').getAttribute('src')).endsWith('400x600bb.jpg'));
    ok('the reveal links to the film on Apple TV', (await p.locator('#co-reveal a.co-store').getAttribute('href')).startsWith('https://itunes.apple.com/'));
    // (The test film is six seconds long, so it may have run out by now: the reel stays on.)
    ok('the reel stays on under the reveal', (await film(p)).url !== '' && !(await film(p)).looping);
    ok('the right film lights up', (await p.locator('.co-ans[data-state="right"]').count()) === 1);
    await shot(p, 'coldopen-reveal');
    // Reel two: a wrong reel (now there is another film to cut to) and a film burn.
    await waitPhase(p, 'PLAY', 20000);
    await p.waitForFunction(() => window.__bidlock.arcade.projector.status().tier === 1, null, { timeout: 10000 }).catch(() => {});
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[2].score = 3000; e.sabotageFor(2, 'reel', 0); });
    await p.waitForTimeout(300);
    const order = await p.evaluate(() => window.__bidlock.arcade.order().join(''));
    const shown = await p.locator('.co-ans').evaluateAll((bs) => bs.map((b) => b.dataset.i).join(''));
    ok('wrong reel: the answers are mixed up', shown === order && order !== '0123', `${shown} (${order})`);
    ok('wrong reel: another film cuts in', (await uniforms(p)).decoyMix === 1);
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[3].score = 3000; e.sabotageFor(3, 'burn', 0); });
    await p.waitForTimeout(1300);
    ok('film burn eats through the picture', (await uniforms(p)).burn > 0.3);
    await shot(p, 'coldopen-burn');
    // To the end.
    await runUntil(p, "e.phase === 'PODIUM'");
    await p.waitForSelector('#co-card:not([hidden]) .ag-rank', { timeout: 10000 });
    ok('the weekend box office', /WEEKEND BOX OFFICE/.test(await p.locator('#co-card').textContent()) && (await p.locator('#co-card .ag-rank li').count()) === 6);
    ok('four awards, Best Picture first', (await p.locator('.co-award').count()) === 4 && /BEST PICTURE/.test(await p.locator('.co-award').first().textContent()));
    ok('takings, not points', /\$\d+\.\d\dM/.test(await p.locator('#co-card .ag-rank').textContent()));
    ok('the screen says The End', (await p.evaluate(() => window.__bidlock.arcade.stage.mode)) === 'end');
    ok('the projector stops', !(await film(p)).playing);
    await p.waitForTimeout(1000);
    await shot(p, 'coldopen-boxoffice');
    await p.locator('#co-card [data-ag="exit"]').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'title');
    ok('no console errors (solo)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 4. A phone
  {
    const ctx = await context(browser, reel, { viewport: { width: 390, height: 844 }, mobile: true });
    const { page: p, errors } = await page(ctx, `${Q}&seed=3`);
    await p.locator('.channel[data-game="coldopen"]').click();
    ok('phone: no overflow on the title', (await overflow(p)) <= 0);
    await p.locator('#btn-start').click();
    await waitPhase(p, 'PLAY');
    await p.waitForTimeout(1500);
    ok('phone: no overflow in play', (await overflow(p)) <= 0, String(await overflow(p)));
    const cols = await p.locator('.co-answers').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    ok('phone: the marquee stacks its four films', cols === 1);
    await shot(p, 'phone-coldopen');
    ok('no console errors (phone)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 5. A room: the programme in the lobby, and a guest threading its own reels
  {
    const ctx = await context(browser, reel);
    const q = `${Q}&net=local&seed=8`;
    const { page: host, errors: hostErrors } = await page(ctx, q);
    const { page: guest, errors: guestErrors } = await page(ctx, q);
    await host.locator('.channel[data-game="coldopen"]').click();
    await host.locator('#btn-friends').click();
    await host.locator('#lobby-name').fill('Alpha');
    await host.locator('#lobby-create').click();
    await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open');
    const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
    await guest.locator('#btn-friends').click();
    await guest.locator('#lobby-name').fill('Bravo');
    await guest.locator('#lobby-code').fill(code);
    await guest.locator('#lobby-join').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.status === 'open' && window.__bidlock.lobby.state.players.length === 2, null, { timeout: 10000 });
    ok('the lobby shows tonight\'s programme', (await host.locator('#lobby-crates .co-prog').count()) === 7);
    await host.locator('#lobby-crates .co-prog[data-programme="animated"]').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.programme === 'animated', null, { timeout: 5000 });
    ok('the guest sees the host\'s programme', (await guest.locator('#lobby-crates .co-prog[aria-pressed="true"]').getAttribute('data-programme')) === 'animated');
    await host.waitForTimeout(300);
    await shot(host, 'lobby-coldopen');
    await host.locator('#lobby-start').click();
    await guest.waitForFunction(() => window.__bidlock.arcade && window.__bidlock.arcade.id === 'coldopen' && window.__bidlock.arcade.engine.phase === 'PLAY', null, { timeout: 40000 });
    await guest.waitForFunction(() => window.__bidlock.arcade.projector.status().tier === 1, null, { timeout: 10000 }).catch(() => {});
    ok('the guest runs the same trailer on its own projector', (await film(guest)).tier === 1 && (await film(guest)).url === (await film(host)).url);
    ok('the guest is not sent the answer', (await guest.evaluate(() => window.__bidlock.arcade.engine.correct)) === -1);
    await guest.locator('.co-ans').nth(2).click();
    const pick = Number(await guest.locator('.co-ans').nth(2).getAttribute('data-i'));
    await host.waitForFunction((i) => window.__bidlock.arcade.engine.players[1].choice === i, pick, { timeout: 5000 }).then(() => ok("the guest's pick reaches the host", true), () => ok("the guest's pick reaches the host", false));
    await runUntil(host, "e.phase === 'REVEAL'");
    await guest.waitForSelector('#co-reveal:not([hidden]) h2', { timeout: 10000 });
    const titles = await Promise.all([host, guest].map((x) => x.locator('#co-reveal h2').textContent()));
    ok('both see the same film revealed', titles[0] === titles[1], titles.join(' / '));
    await host.close();
    await guest.waitForSelector('#lost:not([hidden])', { timeout: 10000 });
    ok('no console errors (room)', [...hostErrors, ...guestErrors].length === 0, [...hostErrors, ...guestErrors].join(' | '));
    await ctx.close();
  }
} catch (err) {
  ok(`the run finished (${String(err.message).split('\n')[0]})`, false);
} finally {
  await browser.close();
  server.close();
}

for (const r of results) console.log(r);
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
