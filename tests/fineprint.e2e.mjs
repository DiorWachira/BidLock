// End-to-end tests for Fine Print in a real browser: the title and its departments, a
// solo match from the first offer to the sales figures (writing, the truth bouncing, the
// call board read out, the reveal, the tote board), a phone, light mode, and a room with
// a guest who writes and calls from their own browser.
// Writes screenshots to screenshots/. Usage: node tests/fineprint.e2e.mjs
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
  const args = ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'];
  for (const channel of [undefined, 'msedge', 'chrome']) {
    try { return await chromium.launch({ channel, args }); } catch { /* next */ }
  }
  throw new Error('No browser found');
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const Q = '?trivia=local&media=off';

async function context(browser, { viewport = { width: 1366, height: 768 }, mobile = false, theme = null } = {}) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript((t) => {
    if (!localStorage.getItem('bidlock.guide.seen')) localStorage.setItem('bidlock.guide.seen', '1');
    if (t) localStorage.setItem('bidlock.theme', JSON.stringify(t));
  }, theme);
  await ctx.route('https://opentdb.com/**', (r) => r.abort());
  await ctx.route('https://en.wikipedia.org/**', (r) => r.abort());
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
const waitPhase = (p, ph, timeout = 40000) => p.waitForFunction((x) => window.__bidlock.arcade && window.__bidlock.arcade.engine.phase === x, ph, { timeout });
// Run the host's engine forward (fast) until a condition holds.
const runUntil = (p, body) => p.evaluate((b) => {
  const e = window.__bidlock.arcade.engine;
  const test = new Function('e', `return (${b});`);
  for (let i = 0; i < 400000 && !test(e); i++) { if (e.phase === 'PODIUM') break; e.update(1 / 30); }
  return test(e);
}, body);

const browser = await launch();

try {
  // ---------- 1. The title: six shows, and Fine Print's departments
  {
    const ctx = await context(browser);
    const { page: p, errors } = await page(ctx);
    ok('the title lists six shows', (await p.locator('#channels .channel').count()) === 6);
    ok('the department picker is hidden for other shows', !(await p.locator('#fineprint-opts').isVisible()));
    await p.locator('.channel[data-game="fineprint"]').click();
    ok('picking Fine Print shows its departments', await p.locator('#fineprint-opts').isVisible() && (await p.locator('#fp-dept-list .fp-dept').count()) === 7);
    ok('the slot is the small hours', /01:00/.test(await p.locator('#title-slug').textContent()));
    await p.locator('.fp-dept[data-dept="kitchen"]').click();
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title');
    ok('the department is remembered', (await p.locator('.fp-dept[aria-checked="true"]').getAttribute('data-dept')) === 'kitchen');
    await p.locator('.fp-dept[data-dept="all"]').click();
    await shot(p, 'title-fineprint');
    ok('no console errors (title)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 2. A solo match, from the first offer to the sales figures
  {
    const ctx = await context(browser);
    const { page: p, errors } = await page(ctx, `${Q}&seed=11`);
    await p.locator('.channel[data-game="fineprint"]').click();
    await p.locator('#btn-start').click();
    await p.waitForSelector('#fp-card:not([hidden]) h2', { timeout: 20000 });
    ok('the how-to card opens the hour', /Fine Print/i.test(await p.locator('#fp-card h2').textContent()));
    await waitPhase(p, 'PITCH');
    await p.waitForTimeout(400);
    ok('the offer goes up with its ending blanked', await p.locator('#fp-offer').isVisible() && (await p.locator('#fp-fact .fp-blank').count()) === 1);
    ok('the offer is numbered', /OFFER Nº 01 OF 05/.test(await p.locator('#fp-no').textContent()));
    ok('the tote board lists all six', (await p.locator('#fp-tote li').count()) === 6);
    await waitPhase(p, 'WRITE');
    await p.waitForTimeout(300);
    ok('the writing desk opens, with the field ready', await p.locator('#fp-input').isVisible() && (await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'fp-input');
    ok('the warehouse offers some stock', (await p.locator('.fp-crate').count()) >= 1);
    ok('the clock counts the writing down', await p.locator('#fp-clock').isVisible() && /WRITING ENDS IN/.test(await p.locator('#fp-clock').textContent()));
    // The real ending bounces.
    const truth = await p.evaluate(() => window.__bidlock.arcade.engine.fact.truth);
    await p.locator('#fp-input').fill(truth);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    ok('writing the real ending bounces', /real ending/.test(await p.locator('#fp-wstatus').textContent()) && !(await p.evaluate(() => window.__bidlock.arcade.engine.me.wrote)));
    // A warehouse item fills the field; then my own knock-off is filed.
    await p.locator('.fp-crate').first().click();
    ok('a warehouse item fills the field', (await p.locator('#fp-input').inputValue()).length > 0);
    await p.locator('#fp-input').fill('a flock of very determined accountants');
    await p.locator('#fp-file').click();
    await p.waitForTimeout(150);
    ok('my knock-off is filed', /Filed:/.test(await p.locator('#fp-wstatus').textContent()) && (await p.evaluate(() => window.__bidlock.arcade.engine.me.wrote)));
    ok('my lamp is lit', (await p.locator('#fp-lamps li[data-on="1"]').count()) >= 1);
    await shot(p, 'fineprint-write');
    // The lines open.
    await runUntil(p, "e.phase === 'CALL'");
    await p.waitForTimeout(400);
    const lines = await p.locator('.fp-line').count();
    ok('the call board: the genuine article among the knock-offs', lines >= 4 && lines <= 7, lines);
    ok('my own line is marked and cannot be called', (await p.locator('.fp-line[data-mine="1"] .fp-pick[disabled]').count()) === 1);
    ok('the small print is read out, line by line', (await p.locator('.fp-line[data-reading="1"]').count()) === 1);
    ok('nobody can see who wrote what', !/authors/.test(JSON.stringify(await p.evaluate(() => window.__bidlock.arcade.engine.serialize()))));
    const mine = await p.evaluate(() => window.__bidlock.arcade.mineLine());
    const callKey = mine === 0 ? 2 : 1;
    await p.keyboard.press(String(callKey));
    ok(`key ${callKey} phones in line ${callKey}`, (await p.evaluate(() => window.__bidlock.arcade.engine.me.vote)) === callKey - 1 && (await p.locator('.fp-line[data-picked="1"]').count()) === 1);
    const starLine = [0, 1, 2].find((i) => i !== mine);
    await p.locator(`.fp-star[data-star="${starLine}"]`).click();
    ok('a five-star review goes to another line', (await p.evaluate(() => window.__bidlock.arcade.engine.me.star)) === starLine);
    await p.waitForTimeout(1200);
    ok('the reading lights the words as it goes', (await p.locator('.fp-line[data-reading="1"] .fp-txt span[data-on="1"]').count()) >= 1);
    await shot(p, 'fineprint-call');
    // The reveal.
    await runUntil(p, "e.phase === 'REVEAL'");
    await p.waitForFunction(() => document.querySelector('.fp-line[data-verdict="genuine"]'), null, { timeout: 30000 });
    await p.waitForTimeout(700);
    ok('the genuine article gets its burst', (await p.locator('.fp-line[data-verdict="genuine"] .fp-burst').count()) === 1);
    ok('the blank fills with the real ending', ((await p.locator('#fp-fact .fp-fill').textContent()) || '').toLowerCase() === truth.toLowerCase());
    ok('every knock-off is unmasked with its author', (await p.locator('.fp-line[data-verdict="knockoff"] .fp-sash').count()) + (await p.locator('.fp-line[data-verdict="house"]').count()) === lines - 1);
    ok('the source is linked', (await p.locator('a.fp-src').getAttribute('href')).startsWith('https://en.wikipedia.org/wiki/'));
    const score = await p.evaluate(() => window.__bidlock.arcade.engine.me.score);
    ok('the tote board shows my points', (await p.locator('#fp-tote li[data-me="1"] .sr-only').textContent()) === `${score.toLocaleString('en-GB')} points`);
    await shot(p, 'fineprint-reveal');
    // On through the premium-rate offers to the end.
    await runUntil(p, "e.phase === 'PITCH' && e.round === 3");
    ok('offer three is premium rate', /PREMIUM RATE/.test(await p.locator('#fp-rate').textContent()));
    await runUntil(p, "e.phase === 'PODIUM'");
    await p.waitForSelector('#fp-card:not([hidden]) .ag-rank', { timeout: 10000 });
    ok('the overnight sales figures', /OVERNIGHT SALES FIGURES/.test(await p.locator('#fp-card').textContent()) && (await p.locator('#fp-card .ag-rank li').count()) === 6);
    ok('four awards, top of the tote first', (await p.locator('.fp-award').count()) === 4 && /TOP OF THE TOTE/.test(await p.locator('.fp-award').first().textContent()));
    await p.waitForTimeout(800);
    await shot(p, 'fineprint-results');
    const seen = await p.evaluate(() => JSON.parse(localStorage.getItem('bidlock.fpSeen') || '[]'));
    ok('tonight\'s facts are remembered for next time', seen.length === 5);
    await p.locator('#fp-card [data-ag="exit"]').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'title');
    ok('no console errors (solo)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 3. A phone
  {
    const ctx = await context(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    const { page: p, errors } = await page(ctx, `${Q}&seed=4`);
    await p.locator('.channel[data-game="fineprint"]').click();
    ok('phone: no overflow on the title', (await overflow(p)) <= 0);
    await p.locator('#btn-start').click();
    await waitPhase(p, 'WRITE');
    await p.waitForTimeout(600);
    ok('phone: no overflow while writing', (await overflow(p)) <= 0, String(await overflow(p)));
    const box = await p.locator('#fp-input').boundingBox();
    ok('phone: the field is on screen and full width', box && box.width > 300, JSON.stringify(box));
    await shot(p, 'phone-fineprint');
    await p.locator('#fp-input').fill('a very small horse');
    await p.locator('#fp-file').click();
    await runUntil(p, "e.phase === 'CALL'");
    await p.waitForTimeout(600);
    ok('phone: no overflow on the call board', (await overflow(p)) <= 0);
    await p.locator('.fp-line').last().scrollIntoViewIfNeeded();
    await shot(p, 'phone-fineprint-call');
    ok('no console errors (phone)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 4. Light mode: the show stays on air; its cards follow the theme
  {
    const ctx = await context(browser, { theme: 'light' });
    const { page: p, errors } = await page(ctx, `${Q}&seed=5`);
    await p.locator('.channel[data-game="fineprint"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'WRITE');
    await runUntil(p, "e.phase === 'CALL'");
    await p.waitForTimeout(500);
    ok('light: the call board is drawn', (await p.locator('.fp-line').count()) >= 4);
    await shot(p, 'fineprint-light');
    ok('no console errors (light)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 5. A room: the department in the lobby, and a guest writing and calling
  {
    const ctx = await context(browser);
    const q = `${Q}&net=local&seed=8`;
    const { page: host, errors: hostErrors } = await page(ctx, q);
    const { page: guest, errors: guestErrors } = await page(ctx, q);
    await host.locator('.channel[data-game="fineprint"]').click();
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
    ok('the lobby shows the departments', (await host.locator('#lobby-crates .fp-dept').count()) === 7);
    await host.locator('#lobby-crates .fp-dept[data-dept="space"]').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.dept === 'space', null, { timeout: 5000 });
    ok('the guest sees the host\'s department', (await guest.locator('#lobby-crates .fp-dept[aria-pressed="true"]').getAttribute('data-dept')) === 'space');
    await host.waitForTimeout(300);
    await shot(host, 'lobby-fineprint');
    await host.locator('#lobby-start').click();
    await guest.waitForFunction(() => window.__bidlock.arcade && window.__bidlock.arcade.id === 'fineprint' && window.__bidlock.arcade.engine.phase === 'WRITE', null, { timeout: 40000 });
    await guest.waitForTimeout(300);
    ok('the guest sees the same offer', (await guest.locator('#fp-fact').textContent()) === (await host.locator('#fp-fact').textContent()));
    ok('the offer is from the chosen department', (await host.evaluate(() => window.__bidlock.arcade.engine.fact.dept)) === 'space');
    ok('the guest is not sent the real ending', !(await guest.evaluate(() => JSON.stringify(window.__bidlock.arcade.engine.current))).toLowerCase().includes((await host.evaluate(() => window.__bidlock.arcade.engine.fact.truth)).toLowerCase()));
    // The guest tries the truth, then files a knock-off.
    const truth = await host.evaluate(() => window.__bidlock.arcade.engine.fact.truth);
    await guest.locator('#fp-input').fill(truth);
    await guest.locator('#fp-file').click();
    await guest.waitForFunction(() => /real ending/.test(document.querySelector('#fp-wstatus').textContent), null, { timeout: 5000 }).then(() => ok('the host bounces the guest\'s real ending', true), () => ok('the host bounces the guest\'s real ending', false));
    await guest.locator('#fp-input').fill('a tremendously polite walrus');
    await guest.locator('#fp-file').click();
    await host.waitForFunction(() => window.__bidlock.arcade.engine.players[1].wrote, null, { timeout: 5000 }).then(() => ok('the guest\'s knock-off reaches the host', true), () => ok('the guest\'s knock-off reaches the host', false));
    await guest.waitForFunction(() => /Filed:/.test(document.querySelector('#fp-wstatus').textContent), null, { timeout: 5000 }).catch(() => {});
    ok('the guest is told it is filed', /Filed:/.test(await guest.locator('#fp-wstatus').textContent()));
    await runUntil(host, "e.phase === 'CALL'");
    await guest.waitForFunction(() => window.__bidlock.arcade.engine.phase === 'CALL', null, { timeout: 10000 });
    await guest.waitForTimeout(400);
    ok('the guest\'s own line is marked on their board', (await guest.locator('.fp-line[data-mine="1"]').count()) === 1);
    const pick = await guest.evaluate(() => [0, 1, 2, 3].find((i) => i !== window.__bidlock.arcade.mineLine()));
    await guest.locator(`.fp-line:nth-child(${pick + 1}) .fp-pick`).click();
    await host.waitForFunction((i) => window.__bidlock.arcade.engine.players[1].vote === i, pick, { timeout: 5000 }).then(() => ok('the guest\'s call reaches the host', true), () => ok('the guest\'s call reaches the host', false));
    await runUntil(host, "e.phase === 'REVEAL'");
    // Skip ahead to the genuine article (the last step of the reveal).
    await host.evaluate(() => { const e = window.__bidlock.arcade.engine; e.t = 4.6; });
    await guest.waitForFunction(() => document.querySelector('.fp-line[data-verdict="genuine"]'), null, { timeout: 15000 });
    const fills = await Promise.all([host, guest].map((x) => x.locator('#fp-fact .fp-fill').textContent().catch(() => '')));
    ok('both see the same genuine article', fills[0] && fills[0] === fills[1], fills.join(' / '));
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
