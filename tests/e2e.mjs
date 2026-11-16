// End-to-end tests in a real browser, plus screenshots of every screen.
// Usage: node tests/e2e.mjs      (needs: npm i, and Edge or Chrome installed)
//
// Most checks run offline: Wikipedia, Wikimedia and the trivia service are intercepted
// and answered from fixtures, and rooms use the same-browser loopback transport. Two
// sections at the end use the real network (photographs for the README screenshots, and
// one real WebRTC room); they are reported as skipped, not failed, if the network is down.
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
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
function skip(name, why) {
  results.push(`skip ${name}  -> ${why}`);
}

// A small solid-colour PNG, built by hand so the tests need no image files.
function png(w, h, [r, g, b]) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNGS = [[178, 64, 48], [48, 110, 178], [70, 150, 90], [200, 160, 40], [130, 90, 180], [60, 160, 170]].map((c) => png(96, 64, c));

async function launch() {
  // Use the real GPU: software WebGL renders this scene at about one frame a second.
  const args = ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
  // Playwright's own headless shell first: it opens no OS windows at all. Headless Edge and
  // Chrome each leave a hidden window per page that Windows can show in Alt+Tab.
  for (const channel of [undefined, 'msedge', 'chrome']) {
    try { return await chromium.launch({ channel, args }); } catch { /* try the next browser */ }
  }
  throw new Error('No Edge or Chrome found');
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

// media: 'mock' (fixtures), 'real' (the network), or anything else for no interception.
async function context(browser, { viewport = { width: 1366, height: 768 }, guideSeen = true, theme = null, reducedMotion = 'no-preference', media = 'mock' } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await ctx.addInitScript(({ seen, th }) => {
    if (seen && !localStorage.getItem('bidlock.guide.seen')) localStorage.setItem('bidlock.guide.seen', '1');
    if (th && !localStorage.getItem('bidlock.theme')) localStorage.setItem('bidlock.theme', JSON.stringify(th));
  }, { seen: guideSeen, th: theme });
  if (media === 'mock') {
    const cors = { 'access-control-allow-origin': '*' };
    await ctx.route('https://en.wikipedia.org/**', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname !== '/w/api.php') return route.abort();
      const titles = (u.searchParams.get('titles') || '').split('|').filter(Boolean);
      const pages = titles.map((t, i) => ({ title: t, fullurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`, thumbnail: { source: `https://upload.wikimedia.org/mock/${i % PNGS.length}.png`, width: 96, height: 64 } }));
      return route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ query: { pages } }) });
    });
    await ctx.route('https://upload.wikimedia.org/**', (route) => {
      const n = Number((/(\d)\.png/.exec(route.request().url()) || [0, 0])[1]);
      return route.fulfill({ contentType: 'image/png', headers: cors, body: PNGS[n % PNGS.length] });
    });
    await ctx.route('https://opentdb.com/**', (route) => route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ response_code: 1, results: [] }) }));
  }
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

async function open(browser, { query = '', ...opts } = {}) {
  const ctx = await context(browser, opts);
  const { page: p, errors } = await page(ctx, query);
  return { ctx, page: p, errors };
}

const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const phase = (p) => p.evaluate(() => window.__bidlock.engine.phase);
// Run the rules forward without waiting for wall-clock time (solo or host only).
const runTo = (p, target) => p.evaluate((t) => {
  const e = window.__bidlock.engine;
  for (let i = 0; i < 600000 && e.phase !== t; i++) e.update(1 / 30);
  return e.phase;
}, target);
const runUntil = (p, fnBody) => p.evaluate((body) => {
  const e = window.__bidlock.engine;
  const test = new Function('e', `return (${body});`);
  for (let i = 0; i < 600000 && !test(e) && e.phase !== 'VERDICT'; i++) e.update(1 / 30);
  return test(e);
}, fnBody);

const browser = await launch();

try {
  // ---------- 1. Title, hero catalogue with photographs, settings
  {
    const { ctx, page: p, errors } = await open(browser);
    ok('title screen is up with the 3D feed', await p.locator('#stage canvas').count() === 1 && !(await p.evaluate(() => document.body.classList.contains('no-stage'))));
    ok('tagline is on the title', (await p.locator('.tagline').textContent()).includes('Outbid, bait, and heist'));
    ok('hero lists 14 categories', (await p.locator('#hero-cats .cat').count()) === 14);
    await p.waitForFunction(() => document.querySelector('#hero-img').src.startsWith('https://upload.wikimedia.org/'), null, { timeout: 10000 });
    ok('the hero shows a photograph with a Wikipedia credit', (await p.locator('#hero-credit a').getAttribute('href')).startsWith('https://en.wikipedia.org/wiki/'));
    await p.locator('#hero-cats .cat').nth(1).hover();
    ok('hovering a category reads one of its lots', (await p.locator('#hero-slug').textContent()).startsWith('HYPERCARS'));
    const first = await p.locator('#hero-name').textContent();
    await p.locator('#hero-cats .cat').nth(1).click();
    const second = await p.locator('#hero-name').textContent();
    ok('clicking steps to the next lot in that category', first !== second, `${first} / ${second}`);
    await p.locator('#hero-cats .cat').nth(1).focus();
    await p.keyboard.press('ArrowRight');
    ok('arrow keys move along the categories', (await p.locator('#hero-slug').textContent()).startsWith('INTERNET'));
    await p.locator('#hero-cats .cat').nth(13).click();
    ok('the mystery category stays sealed', (await p.locator('#hero-name').textContent()) === 'Sealed Mystery Crate' && (await p.locator('#hero-img').getAttribute('src')).startsWith('data:image'));
    await p.locator('#mode-budget label').nth(1).click();
    ok('high-roller toggle changes the strap', (await p.locator('#strap-budget').textContent()) === '50');
    await p.locator('#mode-budget label').nth(0).click();
    await p.locator('#marathon').check();
    ok('marathon is remembered', await p.evaluate(() => window.__bidlock.settings.marathon === true && JSON.parse(localStorage.getItem('bidlock.marathon')) === true));
    await p.locator('#marathon').uncheck();
    await p.locator('#btn-theme').click();
    await p.waitForTimeout(400);
    ok('lights toggle switches theme', (await p.evaluate(() => document.documentElement.dataset.theme)) === 'light');
    await shot(p, 'title-light');
    ok('no console errors on the title', errors.length === 0, errors.join(' | '));
    ok('no horizontal overflow on the title', (await overflow(p)) <= 0);
    await ctx.close();
  }

  // ---------- 2. First-run guide: invite -> tour across screens -> Esc -> never shown again
  {
    const { ctx, page: p, errors } = await open(browser, { guideSeen: false, query: '?seed=11&trivia=local&oracle=0' });
    await p.waitForSelector('#invite.on');
    ok('first visit shows the invitation', await p.locator('#invite').isVisible());
    await p.locator('#invite-start').click();
    await p.waitForSelector('#cue');
    ok('tour opens on cue 1', (await p.locator('#cue-count').textContent()) === 'CUE 1 / 13');
    ok('focus moves into the cue card', await p.evaluate(() => document.activeElement.id === 'cue-next'));
    await shot(p, 'guide-title');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowRight');
    ok('arrow keys step the tour', (await p.locator('#cue-count').textContent()) === 'CUE 3 / 13');
    await p.keyboard.press('ArrowLeft');
    ok('left arrow goes back', (await p.locator('#cue-count').textContent()) === 'CUE 2 / 13');
    for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowRight');
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    ok('the tour crosses into a rehearsal match', (await p.locator('#cue-count').textContent()) === 'CUE 6 / 13');
    ok('the match is held while the guide is open', (await p.locator('#onair').textContent()) === 'STANDBY' && (await phase(p)) === 'BIDDING');
    const clock1 = await p.evaluate(() => window.__bidlock.engine.clock);
    await p.waitForTimeout(600);
    ok('the shot clock does not run under the guide', clock1 === (await p.evaluate(() => window.__bidlock.engine.clock)));
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(300);
    await shot(p, 'guide-game');
    const spot = await p.locator('#cue-spot').boundingBox();
    const target = await p.locator('#bidblock').boundingBox();
    ok('the spotlight sits on the target', Math.abs(spot.x - (target.x - 6)) < 3 && Math.abs(spot.y - (target.y - 6)) < 3, JSON.stringify([spot, target]));
    await p.keyboard.press('Escape');
    ok('Esc closes the tour', !(await p.locator('#guide').isVisible()));
    ok('the match goes live when the guide closes', (await p.locator('#onair').textContent()) === 'ON AIR');
    await p.reload();
    await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title');
    await p.waitForTimeout(400);
    ok('the invitation is never shown again', !(await p.locator('#invite').isVisible()));
    ok('no console errors in the guide', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 3. Help drawer
  {
    const { ctx, page: p } = await open(browser);
    await p.keyboard.press('?');
    await p.waitForSelector('#drawer.on');
    ok('? opens the run sheet', await p.locator('#drawer').isVisible());
    ok('the run sheet has keys, glossary and pipeline', (await p.locator('.keymap div').count()) >= 9 && (await p.locator('.glossary div').count()) >= 15 && (await p.locator('.pipeline li').count()) === 6);
    await p.waitForTimeout(300);
    await shot(p, 'run-sheet');
    await p.keyboard.press('Escape');
    ok('Esc closes the run sheet', !(await p.locator('#drawer').isVisible()));
    await p.locator('#btn-help').click();
    await p.locator('#drawer-tour-screen').click();
    await p.waitForSelector('#cue');
    ok('"cues for this screen" starts a short tour', (await p.locator('#cue-count').textContent()) === 'CUE 1 / 6');
    await p.locator('#cue-close').click();
    await ctx.close();
  }

  // ---------- 4. Solo bidding, with photographs in the HUD and on the pedestal
  {
    const { ctx, page: p, errors } = await open(browser, { query: '?seed=7&trivia=local&oracle=0' });
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    ok('Enter goes live', (await p.locator('#onair').textContent()) === 'ON AIR');
    ok('a round runs four lots', (await p.locator('#rundown .rd-tile').count()) === 4);
    ok('max bid holds $1 back per other slot', (await p.locator('#maxbid').textContent()) === '$15');
    await p.waitForFunction(() => window.__bidlock.engine.phase === 'BIDDING', null, { timeout: 20000 });
    await p.waitForFunction(() => document.querySelector('#lot-img').src.startsWith('https://upload.wikimedia.org/'), null, { timeout: 10000 });
    ok('the lot card shows the lot\'s photograph and credit', (await p.locator('#lot-credit a').count()) === 1);
    ok('one batched lookup covers the whole match', await p.evaluate(() => window.__bidlock.media.stats.requests <= 4 && window.__bidlock.media.stats.photos >= 26), JSON.stringify(await p.evaluate(() => window.__bidlock.media.stats)));
    ok('the pedestal shows the photograph in a frame', await p.evaluate(() => { const s = window.__bidlock.stage; return !!s.icon && !!s.icon.userData.rim && window.__bidlock.media.isPhoto(s.lotItem); }));
    await p.keyboard.press('Space');
    const st = await p.evaluate(() => ({ hi: window.__bidlock.engine.highBidder, bid: window.__bidlock.engine.currentBid }));
    ok('Space places a bid', st.hi === 0 && st.bid >= 1, JSON.stringify(st));
    ok('holding the high bid lights the tally and locks the buttons', (await p.locator('#tally.live').count()) === 1 && await p.locator('#btn-bid1').isDisabled());
    await p.waitForFunction(() => window.__bidlock.engine.highBidder !== 0 || window.__bidlock.engine.phase !== 'BIDDING', null, { timeout: 20000 });
    if ((await phase(p)) === 'BIDDING') {
      const before = await p.evaluate(() => window.__bidlock.engine.currentBid);
      await p.locator('#btn-bid2').click();
      ok('power jump raises by two', (await p.evaluate(() => window.__bidlock.engine.currentBid)) === before + 2);
    }
    await p.keyboard.press('Escape');
    ok('Esc pauses on the test card', await p.locator('#pause').isVisible() && (await p.locator('#onair').textContent()) === 'STANDBY');
    await shot(p, 'pause');
    await p.keyboard.press('Escape');
    ok('Esc resumes', !(await p.locator('#pause').isVisible()));
    // Finish the round: the lineup should carry photo thumbnails.
    await runUntil(p, 'e.lot && e.lot.catIndex >= 1');
    ok('lineups carry photo thumbnails', (await p.locator('#roster img.thumb').count()) >= 1 && (await p.locator('.rv-thumbs img.thumb').count()) >= 3);
    ok('no horizontal overflow in the match', (await overflow(p)) <= 0);
    ok('no console errors while bidding', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 5. No photographs available: every lot still has an illustrated card
  {
    const { ctx, page: p, errors } = await open(browser, { query: '?seed=7&media=off&trivia=local&oracle=0' });
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    await runTo(p, 'BIDDING');
    ok('offline: the lot card falls back to an illustrated card', (await p.locator('#lot-img').getAttribute('src')).startsWith('data:image/') && (await p.locator('#lot-credit').textContent()) === 'Illustration');
    ok('offline: the pedestal is not blank', await p.evaluate(() => { const s = window.__bidlock.stage; return !!s.icon && s.icon.children.length > 4 && !window.__bidlock.media.isPhoto(s.lotItem); }));
    await p.waitForTimeout(900);
    await shot(p, 'offline-card');
    ok('offline: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 6. The Oracle: question, half-price steal, then double or nothing
  {
    const { ctx, page: p, errors } = await open(browser, { query: '?seed=21&oracle=1&oracleseat=0&trivia=local' });
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    const got = await runUntil(p, "e.phase === 'ORACLE' && e.oracle.stage === 'q1'");
    ok('the Oracle steps in between rounds', got === true && (await p.evaluate(() => window.__bidlock.engine.oracle.player)) === 0);
    await p.waitForSelector('#oracle:not([hidden])');
    ok('the question shows four live answers to the chosen player', (await p.locator('#oracle .ans:not([disabled])').count()) === 4);
    ok('the snapshot keeps the answer secret', (await p.evaluate(() => window.__bidlock.engine.serialize().or.correct)) === -1);
    await p.waitForTimeout(500);
    await shot(p, 'oracle-question');
    const correct = await p.evaluate(() => window.__bidlock.engine.oracle.correct);
    await p.locator(`#oracle .ans[data-ans="${correct}"]`).click();
    ok('a right answer is marked', (await p.locator('#oracle .ans[data-state="right"]').count()) === 1 && (await p.evaluate(() => window.__bidlock.engine.oracle.right)) === true);
    await runUntil(p, "e.oracle.stage === 'pick'");
    await p.waitForSelector('#oracle .pick');
    ok('the player is offered rivals\' lots at half price', (await p.locator('#oracle .pick').count()) >= 1);
    await p.waitForTimeout(300);
    await shot(p, 'oracle-pick');
    const before = await p.evaluate(() => ({ cash: window.__bidlock.engine.me.cash }));
    await p.locator('#oracle .pick').first().click();
    await p.waitForSelector('#oracle [data-gamble="0"]');
    const target = await p.evaluate(() => window.__bidlock.engine.oracle.target);
    await shot(p, 'oracle-gamble');
    await p.locator('#oracle [data-gamble="0"]').click();
    const after = await p.evaluate((t) => {
      const e = window.__bidlock.engine;
      return { cash: e.me.cash, mine: e.allEntries(e.me).some((x) => x.item.id === t.itemId), outcome: e.oracle.outcome };
    }, target);
    ok('locking in takes the lot for half price', after.mine && after.cash === before.cash - target.cost && after.outcome.kind === 'steal' && !after.outcome.free, JSON.stringify(after));
    await p.waitForTimeout(600);
    await shot(p, 'oracle-steal');

    // Second intervention: risk it.
    const again = await runUntil(p, "e.phase === 'ORACLE' && e.oracle.stage === 'q1' && e.oracle.count === 2");
    if (again) {
      await p.keyboard.press(String((await p.evaluate(() => window.__bidlock.engine.oracle.correct)) + 1));
      ok('number keys answer the question', (await p.evaluate(() => window.__bidlock.engine.oracle.right)) === true);
      await runUntil(p, "e.oracle.stage === 'pick'");
      await p.locator('#oracle .pick').first().click();
      const cash2 = await p.evaluate(() => window.__bidlock.engine.me.cash);
      const target2 = await p.evaluate(() => window.__bidlock.engine.oracle.target);
      await p.locator('#oracle [data-gamble="1"]').click();
      ok('risking it asks a second question', (await p.evaluate(() => window.__bidlock.engine.oracle.stage)) === 'q2');
      const c2 = await p.evaluate(() => window.__bidlock.engine.oracle.correct);
      await p.locator(`#oracle .ans[data-ans="${c2}"]`).click();
      await runUntil(p, "e.oracle.stage === 'result'");
      const res = await p.evaluate((t) => {
        const e = window.__bidlock.engine;
        return { cash: e.me.cash, mine: e.allEntries(e.me).some((x) => x.item.id === t.itemId), outcome: e.oracle.outcome };
      }, target2);
      ok('winning double or nothing takes the lot for free', res.mine && res.cash === cash2 && res.outcome.free === true, JSON.stringify(res));
    } else {
      skip('double or nothing', 'the Oracle did not come back a second time on this seed');
    }
    await runUntil(p, "e.phase !== 'ORACLE'");
    await p.waitForTimeout(200);
    ok('the Oracle panel closes afterwards', !(await p.locator('#oracle').isVisible()));
    ok('no console errors through the Oracle', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 7. A wrong answer loses the chance
  {
    const { ctx, page: p } = await open(browser, { query: '?seed=33&oracle=1&oracleseat=0&trivia=local' });
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    if (await runUntil(p, "e.phase === 'ORACLE' && e.oracle.stage === 'q1' && e.oracle.player === 0")) {
      const wrong = ((await p.evaluate(() => window.__bidlock.engine.oracle.correct)) + 1) % 4;
      await p.locator(`#oracle .ans[data-ans="${wrong}"]`).click();
      await runUntil(p, "e.oracle.stage === 'result'");
      ok('a wrong answer ends the intervention with no steal', (await p.evaluate(() => window.__bidlock.engine.oracle.outcome.kind)) === 'fail');
    } else skip('wrong answer', 'the Oracle did not pick the player on this seed');
    await ctx.close();
  }

  // ---------- 8. Crate, vault, heist, verdict, scorecard, play again
  {
    const { ctx, page: p, errors } = await open(browser, { query: '?seed=21&trivia=local&oracle=0' });
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    await p.evaluate(() => {
      const e = window.__bidlock.engine;
      for (let i = 0; i < 400000 && !(e.phase === 'REVEAL' && e.revealed); i++) e.update(1 / 30);
    });
    ok('a mystery crate gets opened', (await phase(p)) === 'REVEAL');
    ok('the opened crate shows its photograph', await p.evaluate(() => { const s = window.__bidlock.stage; return !!s.icon && !s.icon.userData.crate; }));
    await p.waitForTimeout(700);
    await shot(p, 'crate-reveal');
    ok('reaching the vault', (await runTo(p, 'VAULT')) === 'VAULT');
    ok('the board lists four lineups by round', (await p.locator('#board-table thead th').count()) === 5 && (await p.locator('#board-table tbody tr').count()) >= 6);
    const lockable = p.locator('#board-table button[data-act="vault"]');
    const cashBefore = await p.evaluate(() => window.__bidlock.engine.me.cash);
    if (cashBefore >= 2 && (await lockable.count()) > 0) {
      await lockable.first().click();
      ok('locking a lot costs $2', (await p.evaluate(() => window.__bidlock.engine.me.cash)) === cashBefore - 2);
    }
    await p.waitForTimeout(300);
    await shot(p, 'vault');
    ok('reaching the heist', (await runTo(p, 'HEIST')) === 'HEIST');
    const steal = p.locator('#board-table button[data-act="heist"]');
    if ((await steal.count()) > 0) {
      await steal.first().click();
      ok('a steal uses up the heist', await p.evaluate(() => window.__bidlock.engine.me.heistUsed));
    }
    ok('reaching the verdict', (await runTo(p, 'VERDICT')) === 'VERDICT');
    await p.waitForFunction(() => window.__bidlock.screen === 'verdict');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#verdict-actions:not([hidden])');
    const totals = await p.evaluate(() => window.__bidlock.engine.results.players.map((x) => x.total));
    ok('every contender has a total', totals.length === 4 && totals.every((t) => t > 0), totals.join(','));
    ok('a winner is named', (await p.locator('#verdict-table th[data-win="1"]').count()) === 1);
    await p.locator('#btn-copy').click();
    await p.waitForTimeout(300);
    const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok('the scorecard is copied', clip.startsWith('BIDLOCK — THE $20 DRAFT') && clip.includes('Seed 21'), clip.slice(0, 80));
    await p.locator('#btn-again').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    ok('play again starts a fresh match', (await p.evaluate(() => window.__bidlock.engine.me.cash)) === 20);
    ok('no console errors through the endgame', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 9. A room: create, join by code, bid from both sides, verdict, back to lobby
  {
    const ctx = await context(browser);
    const q = '?net=local&trivia=local&oracle=0&seed=5';
    const { page: host, errors: hostErrors } = await page(ctx, q);
    const { page: guest, errors: guestErrors } = await page(ctx, q);

    await host.locator('#btn-friends').click();
    await host.waitForSelector('#lobby.on');
    await host.locator('#lobby-name').fill('Alpha');
    await host.locator('#lobby-create').click();
    await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open');
    const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
    ok('creating a lobby gives a five-character room code', /^BL-[A-Z2-9]{3}$/.test(code), code);
    await host.locator('#lobby-copy').click();
    await host.waitForTimeout(200);
    ok('the invite code can be copied', (await host.evaluate(() => navigator.clipboard.readText().catch(() => ''))) === code);
    ok('the display name is remembered', (await host.evaluate(() => JSON.parse(localStorage.getItem('bidlock.name')))) === 'Alpha');
    ok('one person cannot start without bots or friends', await host.evaluate(() => { const l = window.__bidlock.lobby; l.setFillBots(false); const can = l.canStart(); l.setFillBots(true); return can === false; }));

    await guest.locator('#btn-friends').click();
    await guest.locator('#lobby-name').fill('Bravo');
    await guest.locator('#lobby-code').fill(code.toLowerCase().replace('-', ' '));
    await guest.locator('#lobby-join').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.status === 'open' && window.__bidlock.lobby.state.players.length === 2, null, { timeout: 10000 });
    await host.waitForFunction(() => window.__bidlock.lobby.state.players.length === 2);
    ok('a friend joins with the code', (await guest.locator('#lobby-players li b').allTextContents()).join(',').startsWith('ALPHA,BRAVO'));
    ok('bots fill the table to four', (await host.locator('#lobby-players .lp-tag', { hasText: 'BOT' }).count()) === 2);
    ok('only the host can start', await guest.locator('#lobby-start').isHidden());
    await host.waitForTimeout(300);
    await shot(host, 'lobby');

    const wrong = await page(ctx, q);
    await wrong.page.locator('#btn-friends').click();
    await wrong.page.locator('#lobby-name').fill('Nobody');
    await wrong.page.locator('#lobby-code').fill('BL-222');
    await wrong.page.locator('#lobby-join').click();
    await wrong.page.waitForFunction(() => document.querySelector('#lobby-status').dataset.bad === '1', null, { timeout: 10000 });
    ok('a wrong code is refused with a clear message', (await wrong.page.locator('#lobby-status').textContent()).includes('No room with the code'));
    await wrong.page.close();

    await host.locator('#lobby-start').click();
    await host.waitForFunction(() => window.__bidlock.screen === 'game');
    await guest.waitForFunction(() => window.__bidlock.screen === 'game' && window.__bidlock.role === 'client', null, { timeout: 10000 });
    ok('the match starts for everyone', (await host.evaluate(() => window.__bidlock.role)) === 'host');
    const seats = await guest.evaluate(() => { const e = window.__bidlock.engine; return { me: e.localId, names: e.contenders.map((c) => c.name), mirror: e.mirror }; });
    ok('the guest holds seat 2 on a mirror of the host\'s match', seats.me === 1 && seats.mirror === true && seats.names.join(',') === 'ALPHA,BRAVO,LEDGER,HAVOC', JSON.stringify(seats));
    ok('each player sees the other in the room', (await host.locator('.rival[data-kind="human"] b').textContent()) === 'BRAVO' && (await guest.locator('.rival[data-kind="human"] b').textContent()) === 'ALPHA');
    ok('pause is switched off in a room', await host.locator('#btn-pause').isDisabled());

    await host.waitForFunction(() => window.__bidlock.engine.phase === 'BIDDING', null, { timeout: 20000 });
    await guest.waitForFunction(() => window.__bidlock.engine.phase === 'BIDDING' && !document.querySelector('#btn-bid1').disabled, null, { timeout: 10000 });
    const sameLot = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.engine.lot.item.id)));
    ok('both see the same lot', sameLot[0] === sameLot[1]);
    await guest.locator('#btn-bid1').click();
    await host.waitForFunction(() => window.__bidlock.engine.highBidder === 1, null, { timeout: 5000 });
    ok('the guest\'s bid reaches the host', true);
    await guest.waitForFunction(() => window.__bidlock.engine.highBidder === 1 && document.querySelector('#highbid').textContent === 'HIGH BID: YOU', null, { timeout: 5000 });
    ok('the guest sees their own high bid', (await host.locator('#highbid').textContent()) === 'HIGH BID: BRAVO');
    await host.bringToFront();
    await host.keyboard.press('j');
    await guest.waitForFunction(() => window.__bidlock.engine.highBidder === 0, null, { timeout: 5000 });
    ok('the host\'s power jump reaches the guest', (await guest.evaluate(() => window.__bidlock.engine.currentBid)) === (await host.evaluate(() => window.__bidlock.engine.currentBid)));
    const clocks = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.engine.clock)));
    ok('shot clocks agree to within half a second', Math.abs(clocks[0] - clocks[1]) < 0.5, clocks.join(' / '));
    await guest.locator('#emotes .emote').first().click();
    await host.waitForFunction(() => document.querySelector('#chy-banter .chy-tab').textContent === 'BRAVO', null, { timeout: 5000 });
    ok('reactions travel across the room', (await host.locator('#chy-banter .chy-text').textContent()) === 'NICE ONE');
    await host.waitForTimeout(400);
    await shot(host, 'room-host');
    await shot(guest, 'room-guest');

    // Run the host's match to the end; the guest should follow every step.
    await runTo(host, 'VAULT');
    await guest.waitForFunction(() => window.__bidlock.screen === 'endgame', null, { timeout: 10000 });
    ok('the guest follows into the vault', (await guest.locator('#board-table thead th').count()) === 5);
    await host.locator('#btn-board-done').click();
    ok('the vault waits for everyone in the room', (await phase(host)) === 'VAULT');
    await guest.locator('#btn-board-done').click();
    await host.waitForFunction(() => window.__bidlock.engine.phase === 'HEIST', null, { timeout: 5000 });
    ok('when both are done the vault closes early', true);
    await runTo(host, 'VERDICT');
    await guest.waitForFunction(() => window.__bidlock.screen === 'verdict', null, { timeout: 10000 });
    const [ht, gt] = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.engine.results.players.map((pl) => pl.total).join(','))));
    ok('both arrive at the same verdict', ht === gt && ht.split(',').length === 4, `${ht} / ${gt}`);
    await guest.locator('#btn-verdict-skip').click();
    ok('the guest cannot restart the room', await guest.locator('#btn-again').isHidden());
    await host.locator('#btn-verdict-skip').click();
    await host.locator('#btn-title').click();
    await host.waitForFunction(() => window.__bidlock.screen === 'title' && window.__bidlock.lobby.state.status === 'open');
    await guest.waitForFunction(() => window.__bidlock.screen === 'title' && window.__bidlock.lobby.state.inMatch === false, null, { timeout: 10000 });
    ok('back to lobby keeps the room and its code', (await guest.evaluate(() => window.__bidlock.lobby.state.code)) === code && (await guest.evaluate(() => window.__bidlock.lobby.state.players.length)) === 2);
    await host.locator('#lobby-start').click();
    await guest.waitForFunction(() => window.__bidlock.screen === 'game' && window.__bidlock.role === 'client', null, { timeout: 10000 });
    ok('a second match starts without re-entering the code', (await guest.evaluate(() => window.__bidlock.engine.me.cash)) === 20);

    // A guest who leaves mid-match becomes an away seat; a host who leaves ends the room.
    await runTo(host, 'BIDDING');
    await host.close();
    await guest.waitForSelector('#lost:not([hidden])', { timeout: 10000 });
    ok('if the host leaves, the guest gets a clear signal-lost card', (await guest.locator('#lost-h').textContent()) === 'SIGNAL LOST');
    await guest.locator('#btn-lost').click();
    ok('and can go back to the title', (await guest.evaluate(() => window.__bidlock.screen)) === 'title');
    ok('no console errors in the room (host)', hostErrors.length === 0, hostErrors.join(' | '));
    ok('no console errors in the room (guest)', guestErrors.length === 0, guestErrors.join(' | '));
    await ctx.close();
  }

  // ---------- 10. Six people in one room, and a guest who drops out
  {
    const ctx = await context(browser, { viewport: { width: 1280, height: 720 } });
    const q = '?net=local&trivia=local&oracle=1&seed=8';
    const pages = [];
    for (let i = 0; i < 6; i++) pages.push((await page(ctx, q)).page);
    const [host, ...guests] = pages;
    await host.locator('#btn-friends').click();
    await host.locator('#lobby-name').fill('Host');
    await host.locator('#lobby-create').click();
    await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open');
    const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
    for (let i = 0; i < guests.length; i++) {
      await guests[i].locator('#btn-friends').click();
      await guests[i].locator('#lobby-name').fill(`Guest ${i + 1}`);
      await guests[i].locator('#lobby-code').fill(code);
      await guests[i].locator('#lobby-join').click();
      await host.waitForFunction((n) => window.__bidlock.lobby.state.players.length === n, i + 2, { timeout: 10000 });
    }
    ok('six people fit in a room, with no bots added', (await host.evaluate(() => window.__bidlock.lobby.seats().length)) === 6);
    const seventh = (await page(ctx, q)).page;
    await seventh.locator('#btn-friends').click();
    await seventh.locator('#lobby-name').fill('Late');
    await seventh.locator('#lobby-code').fill(code);
    await seventh.locator('#lobby-join').click();
    await seventh.waitForFunction(() => document.querySelector('#lobby-status').dataset.bad === '1', null, { timeout: 10000 });
    ok('a seventh player is told the room is full', (await seventh.locator('#lobby-status').textContent()).includes('full'));
    await seventh.close();
    await host.locator('#lobby-start').click();
    await guests[4].waitForFunction(() => window.__bidlock.screen === 'game' && window.__bidlock.role === 'client', null, { timeout: 10000 });
    ok('six lots a round at a table of six', (await host.evaluate(() => window.__bidlock.engine.lotsOfCategory(0).length)) === 6 && (await host.locator('.rival').count()) === 5);
    await runTo(host, 'BIDDING');
    await host.waitForTimeout(500);
    await shot(host, 'room-six');
    ok('no horizontal overflow with six at the table', (await overflow(host)) <= 0);
    await guests[2].close();
    await host.waitForFunction(() => window.__bidlock.engine.contenders[3].away === true, null, { timeout: 10000 });
    ok('a guest who leaves becomes an away seat and the match carries on', (await host.evaluate(() => window.__bidlock.lobby.state.players.find((x) => x.seat === 3).away)) === true);
    // Everyone watches the Oracle, whoever it picks. Somebody has to buy something first,
    // so the host's engine opens the bidding for each seat in turn.
    const reached = await host.evaluate(() => {
      const e = window.__bidlock.engine;
      for (let i = 0; i < 600000 && e.phase !== 'VERDICT' && !(e.phase === 'ORACLE' && e.oracle.stage === 'q1'); i++) {
        if (e.phase === 'BIDDING' && e.highBidder == null) e.bidFor(e.lot.lotIndex % 6, 1 + (e.lot.lotIndex % 2));
        e.update(1 / 30);
      }
      return e.phase === 'ORACLE';
    });
    if (reached) {
      await guests[0].waitForSelector('#oracle:not([hidden]) .ans', { timeout: 10000 });
      const chosen = await host.evaluate(() => window.__bidlock.engine.oracle.player);
      const watcher = chosen === 1 ? guests[1] : guests[0];
      ok('everyone in the room sees the Oracle question, but only the chosen player can answer', (await watcher.locator('#oracle .ans').count()) === 4 && (await watcher.locator('#oracle .ans:not([disabled])').count()) === 0);
      ok('the answer is not sent to the room before it is given', (await watcher.evaluate(() => window.__bidlock.engine.oracle.correct)) === -1);
    } else skip('Oracle in a room', 'no intervention on this seed');
    ok('the match still reaches a verdict', (await runTo(host, 'VERDICT')) === 'VERDICT');
    await guests[0].waitForFunction(() => window.__bidlock.screen === 'verdict', null, { timeout: 10000 });
    await host.locator('#btn-verdict-skip').click();
    await host.waitForTimeout(1500);
    await shot(host, 'verdict-six');
    await ctx.close();
  }

  // ---------- 11. A whole match on autopilot, at speed, in real frames
  {
    const { ctx, page: p, errors } = await open(browser, { query: '?seed=5&auto=1&speed=40&trivia=local', reducedMotion: 'reduce' });
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => window.__bidlock.engine.phase === 'VERDICT', null, { timeout: 240000 });
    await p.waitForSelector('#verdict-actions:not([hidden])', { timeout: 60000 });
    ok('an unattended match runs to the verdict', true);
    ok('no console errors over a whole match', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 12. Phone
  {
    const { ctx, page: p, errors } = await open(browser, { viewport: { width: 390, height: 844 }, query: '?seed=9&trivia=local&oracle=1&oracleseat=0' });
    ok('phone: no overflow on the title', (await overflow(p)) <= 0, String(await overflow(p)));
    await p.locator('#btn-friends').click();
    await p.waitForSelector('#lobby.on');
    const lb = await p.locator('#lobby').boundingBox();
    ok('phone: the lobby fits the screen', lb.x >= 0 && lb.x + lb.width <= 390 && (await overflow(p)) <= 0, JSON.stringify(lb));
    await shot(p, 'phone-lobby');
    await p.locator('#lobby-close').click();
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'game');
    await runTo(p, 'BIDDING');
    await p.locator('#btn-bid1').scrollIntoViewIfNeeded();
    await p.locator('#btn-bid1').click();
    ok('phone: tapping bids', (await p.evaluate(() => window.__bidlock.engine.highBidder)) === 0);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);
    ok('phone: no overflow in the match', (await overflow(p)) <= 0, String(await overflow(p)));
    await shot(p, 'phone-game');
    if (await runUntil(p, "e.phase === 'ORACLE' && e.oracle.stage === 'q1'")) {
      await p.waitForSelector('#oracle:not([hidden]) .ans');
      const ob = await p.locator('#oracle').boundingBox();
      ok('phone: the Oracle panel fits the screen', ob.x >= 0 && ob.x + ob.width <= 390 && ob.y >= 0 && ob.y + ob.height <= 844 && (await overflow(p)) <= 0, JSON.stringify(ob));
      await p.waitForTimeout(300);
      await shot(p, 'phone-oracle');
    }
    await runTo(p, 'HEIST');
    await p.waitForTimeout(300);
    ok('phone: no overflow on the heist board', (await overflow(p)) <= 0, String(await overflow(p)));
    await runTo(p, 'VERDICT');
    await p.locator('#btn-verdict-skip').click();
    await p.waitForTimeout(600);
    ok('phone: no overflow on the verdict', (await overflow(p)) <= 0, String(await overflow(p)));
    await shot(p, 'phone-verdict');
    await p.keyboard.press('?');
    await p.locator('#drawer-tour').click();
    await p.waitForSelector('#cue');
    await p.waitForTimeout(200);
    const card = await p.locator('#cue').boundingBox();
    ok('phone: the cue card stays on screen', card.x >= 0 && card.x + card.width <= 390 && card.y >= 0 && card.y + card.height <= 844, JSON.stringify(card));
    await p.keyboard.press('Escape');
    ok('phone: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 13. Real network: Wikipedia photographs, for the README screenshots
  {
    const { ctx, page: p } = await open(browser, { media: 'real', query: '?seed=7&oracle=1&oracleseat=0&trivia=local' });
    const got = await p.waitForFunction(() => window.__bidlock.media.stats.photos >= 10, null, { timeout: 15000 }).then(() => true, () => false);
    if (got) {
      ok('real photographs load from Wikipedia', true);
      await p.locator('#hero-cats .cat').nth(1).click();
      await p.waitForFunction(() => document.querySelector('#hero-img').src.startsWith('https://upload.wikimedia.org/'), null, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(1500);
      await shot(p, 'title-dark');
      await p.locator('#btn-start').click();
      await p.waitForFunction(() => window.__bidlock.screen === 'game');
      await p.waitForFunction(() => window.__bidlock.media.stats.photos + window.__bidlock.media.stats.fallbacks >= 36, null, { timeout: 20000 }).catch(() => {});
      await runTo(p, 'BIDDING');
      await p.keyboard.press('Space');
      await p.waitForTimeout(1600);
      await shot(p, 'game-dark');
      await p.locator('#btn-theme').click();
      await p.waitForTimeout(700);
      await shot(p, 'game-light');
      await p.locator('#btn-theme').click();
      if (await runUntil(p, "e.phase === 'ORACLE' && e.oracle.stage === 'q1'")) {
        const c = await p.evaluate(() => window.__bidlock.engine.oracle.correct);
        await p.locator(`#oracle .ans[data-ans="${c}"]`).click();
        await runUntil(p, "e.oracle.stage === 'pick'");
        await p.waitForSelector('#oracle .pick');
        await p.waitForTimeout(400);
        await shot(p, 'oracle-pick');
      }
      await runTo(p, 'HEIST');
      await p.waitForTimeout(400);
      await shot(p, 'heist');
      await runTo(p, 'VERDICT');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(2500);
      await shot(p, 'verdict');
      const stats = await p.evaluate(() => window.__bidlock.media.stats);
      ok('a real match needs only a handful of lookups', stats.requests <= 8, JSON.stringify(stats));
    } else {
      skip('real photographs', 'Wikipedia was not reachable from this machine');
    }
    await ctx.close();
  }

  // ---------- 14. Real network: one WebRTC room through the public PeerJS server
  {
    const ctx = await context(browser, { media: 'off' });
    const q = '?media=off&trivia=local&oracle=0&seed=5';
    const { page: host } = await page(ctx, q);
    const { page: guest } = await page(ctx, q);
    try {
      await host.locator('#btn-friends').click();
      await host.locator('#lobby-name').fill('Alpha');
      await host.locator('#lobby-create').click();
      await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open', null, { timeout: 25000 });
      const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
      await guest.locator('#btn-friends').click();
      await guest.locator('#lobby-name').fill('Bravo');
      await guest.locator('#lobby-code').fill(code);
      await guest.locator('#lobby-join').click();
      await host.waitForFunction(() => window.__bidlock.lobby.state.players.length === 2, null, { timeout: 25000 });
      await host.locator('#lobby-start').click();
      await guest.waitForFunction(() => window.__bidlock.screen === 'game' && window.__bidlock.role === 'client', null, { timeout: 15000 });
      await guest.waitForFunction(() => window.__bidlock.engine.phase === 'BIDDING' && !document.querySelector('#btn-bid1').disabled, null, { timeout: 25000 });
      await guest.locator('#btn-bid1').click();
      await host.waitForFunction(() => window.__bidlock.engine.highBidder === 1, null, { timeout: 10000 });
      ok('a real WebRTC room works: create, join by code, bid across browsers', true);
    } catch (err) {
      skip('real WebRTC room', `the public PeerJS server or WebRTC was not reachable (${String(err.message).split('\n')[0].slice(0, 90)})`);
    }
    await ctx.close();
  }
} catch (err) {
  ok('the run completed without a crash', false, String(err && err.message ? err.message : err).slice(0, 400));
} finally {
  await browser.close();
  server.close();
}

console.log(results.join('\n'));
const skipped = results.filter((r) => r.startsWith('skip')).length;
console.log(`\n${results.length - failed - skipped}/${results.length - skipped} passed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
