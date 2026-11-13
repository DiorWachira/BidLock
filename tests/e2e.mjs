// End-to-end tests in a real browser, plus screenshots of every screen.
// Usage: node tests/e2e.mjs      (needs: npm i, and Edge or Chrome installed)
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
  // Use the real GPU: software WebGL renders this scene at about one frame a second.
  const args = ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, args }); } catch { /* try the next browser */ }
  }
  throw new Error('No Edge or Chrome found');
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

async function open(browser, { viewport = { width: 1366, height: 768 }, query = '', guideSeen = true, theme = null, reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await ctx.addInitScript(({ seen, th }) => {
    if (seen && !localStorage.getItem('bidlock.guide.seen')) localStorage.setItem('bidlock.guide.seen', '1');
    if (th && !localStorage.getItem('bidlock.theme')) localStorage.setItem('bidlock.theme', JSON.stringify(th));
  }, { seen: guideSeen, th: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title', null, { timeout: 30000 });
  return { ctx, page, errors };
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const phase = (page) => page.evaluate(() => window.__bidlock.engine.phase);
// Run the rules forward without waiting for wall-clock time.
const runTo = (page, target) => page.evaluate((t) => {
  const e = window.__bidlock.engine;
  for (let i = 0; i < 400000 && e.phase !== t; i++) e.update(1 / 30);
  return e.phase;
}, target);

const browser = await launch();

try {
  // ---------- 1. Title, hero catalogue, settings
  {
    const { ctx, page, errors } = await open(browser);
    ok('title screen is up with the 3D feed', await page.locator('#stage canvas').count() === 1 && !(await page.evaluate(() => document.body.classList.contains('no-stage'))));
    ok('tagline is on the title', (await page.locator('.tagline').textContent()).includes('Outbid, bait, and heist'));
    ok('hero lists 8 categories', (await page.locator('#hero-cats .cat').count()) === 8);
    await page.locator('#hero-cats .cat').nth(1).hover();
    ok('hovering a category reads one of its lots', (await page.locator('#hero-slug').textContent()).startsWith('SUPERCARS & RIDES'));
    const first = await page.locator('#hero-name').textContent();
    await page.locator('#hero-cats .cat').nth(1).click();
    const second = await page.locator('#hero-name').textContent();
    ok('clicking steps to the next lot in that category', first !== second, `${first} / ${second}`);
    await page.locator('#hero-cats .cat').nth(1).focus();
    await page.keyboard.press('ArrowRight');
    ok('arrow keys move along the categories', (await page.locator('#hero-slug').textContent()).startsWith('SUPERPOWERS'));
    await page.locator('#hero-cats .cat').nth(7).click();
    ok('the mystery category stays sealed', (await page.locator('#hero-name').textContent()) === 'Sealed Mystery Crate');
    await page.locator('#mode-budget label').nth(1).click();
    ok('high-roller toggle changes the strap', (await page.locator('#strap-budget').textContent()) === '50');
    await page.locator('#mode-budget label').nth(0).click();
    await page.locator('#hero-cats .cat').nth(0).click();
    await page.waitForTimeout(900);
    await shot(page, 'title-dark');
    await page.locator('#btn-theme').click();
    await page.waitForTimeout(500);
    ok('lights toggle switches theme', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
    await shot(page, 'title-light');
    ok('no console errors on the title', errors.length === 0, errors.join(' | '));
    ok('no horizontal overflow on the title', (await overflow(page)) <= 0);
    await ctx.close();
  }

  // ---------- 2. First-run guide: invite -> tour across screens -> Esc -> never shown again
  {
    const { ctx, page, errors } = await open(browser, { guideSeen: false, query: '?seed=11' });
    await page.waitForSelector('#invite.on');
    ok('first visit shows the invitation', await page.locator('#invite').isVisible());
    await page.locator('#invite-start').click();
    await page.waitForSelector('#cue');
    ok('tour opens on cue 1', (await page.locator('#cue-count').textContent()) === 'CUE 1 / 11');
    ok('focus moves into the cue card', await page.evaluate(() => document.activeElement.id === 'cue-next'));
    await shot(page, 'guide-title');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    ok('arrow keys step the tour', (await page.locator('#cue-count').textContent()) === 'CUE 3 / 11');
    await page.keyboard.press('ArrowLeft');
    ok('left arrow goes back', (await page.locator('#cue-count').textContent()) === 'CUE 2 / 11');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__bidlock.screen === 'game');
    ok('the tour crosses into a rehearsal match', (await page.locator('#cue-count').textContent()) === 'CUE 4 / 11');
    ok('the match is held while the guide is open', (await page.locator('#onair').textContent()) === 'STANDBY' && (await phase(page)) === 'BIDDING');
    const clock1 = await page.evaluate(() => window.__bidlock.engine.clock);
    await page.waitForTimeout(600);
    ok('the shot clock does not run under the guide', clock1 === (await page.evaluate(() => window.__bidlock.engine.clock)));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await shot(page, 'guide-game');
    const spot = await page.locator('#cue-spot').boundingBox();
    const target = await page.locator('#bidblock').boundingBox();
    ok('the spotlight sits on the target', Math.abs(spot.x - (target.x - 6)) < 3 && Math.abs(spot.y - (target.y - 6)) < 3, JSON.stringify([spot, target]));
    await page.keyboard.press('Escape');
    ok('Esc closes the tour', !(await page.locator('#guide').isVisible()));
    ok('the match goes live when the guide closes', (await page.locator('#onair').textContent()) === 'ON AIR');
    await page.reload();
    await page.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title');
    await page.waitForTimeout(400);
    ok('the invitation is never shown again', !(await page.locator('#invite').isVisible()));
    ok('no console errors in the guide', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 3. Help drawer
  {
    const { ctx, page } = await open(browser);
    await page.keyboard.press('?');
    await page.waitForSelector('#drawer.on');
    ok('? opens the run sheet', await page.locator('#drawer').isVisible());
    ok('the run sheet has keys, glossary and pipeline', (await page.locator('.keymap div').count()) >= 8 && (await page.locator('.glossary div').count()) >= 12 && (await page.locator('.pipeline li').count()) === 5);
    await page.waitForTimeout(300);
    await shot(page, 'run-sheet');
    await page.keyboard.press('Escape');
    ok('Esc closes the run sheet', !(await page.locator('#drawer').isVisible()));
    await page.locator('#btn-help').click();
    await page.locator('#drawer-tour-screen').click();
    await page.waitForSelector('#cue');
    ok('"cues for this screen" starts a short tour', (await page.locator('#cue-count').textContent()) === 'CUE 1 / 4');
    await page.locator('#cue-close').click();
    await ctx.close();
  }

  // ---------- 4. Bidding by keyboard and mouse
  {
    const { ctx, page, errors } = await open(browser, { query: '?seed=7' });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__bidlock.screen === 'game');
    ok('Enter goes live', (await page.locator('#onair').textContent()) === 'ON AIR');
    ok('a round runs four lots', (await page.locator('#rundown .rd-tile').count()) === 4);
    ok('max bid holds $1 back per other slot', (await page.locator('#maxbid').textContent()) === '$15');
    await page.waitForFunction(() => window.__bidlock.engine.phase === 'BIDDING', null, { timeout: 20000 });
    await page.keyboard.press('Space');
    const st = await page.evaluate(() => ({ hi: window.__bidlock.engine.highBidder, bid: window.__bidlock.engine.currentBid }));
    ok('Space places a bid', st.hi === 0 && st.bid >= 1, JSON.stringify(st));
    ok('holding the high bid lights the tally and locks the buttons', (await page.locator('#tally.live').count()) === 1 && await page.locator('#btn-bid1').isDisabled());
    await page.waitForTimeout(500);
    await shot(page, 'game-dark');
    // Let a rival outbid, then power jump with the mouse.
    await page.waitForFunction(() => window.__bidlock.engine.highBidder !== 0 || window.__bidlock.engine.phase !== 'BIDDING', null, { timeout: 20000 });
    if ((await phase(page)) === 'BIDDING') {
      const before = await page.evaluate(() => window.__bidlock.engine.currentBid);
      await page.locator('#btn-bid2').click();
      ok('power jump raises by two', (await page.evaluate(() => window.__bidlock.engine.currentBid)) === before + 2);
    }
    await page.keyboard.press('Escape');
    ok('Esc pauses on the test card', await page.locator('#pause').isVisible() && (await page.locator('#onair').textContent()) === 'STANDBY');
    await shot(page, 'pause');
    await page.keyboard.press('Escape');
    ok('Esc resumes', !(await page.locator('#pause').isVisible()));
    await page.locator('#btn-theme').click();
    await page.waitForTimeout(700);
    await shot(page, 'game-light');
    ok('no horizontal overflow in the match', (await overflow(page)) <= 0);
    ok('no console errors while bidding', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 5. Crate, vault, heist, verdict, scorecard, play again
  {
    const { ctx, page, errors } = await open(browser, { query: '?seed=21' });
    await page.locator('#btn-start').click();
    await page.waitForFunction(() => window.__bidlock.screen === 'game');
    // Run forward to the first crate reveal.
    await page.evaluate(() => {
      const e = window.__bidlock.engine;
      for (let i = 0; i < 400000 && !(e.phase === 'REVEAL' && e.revealed); i++) e.update(1 / 30);
    });
    ok('a mystery crate gets opened', (await phase(page)) === 'REVEAL');
    await page.waitForTimeout(700);
    await shot(page, 'crate-reveal');
    ok('reaching the vault', (await runTo(page, 'VAULT')) === 'VAULT');
    ok('the board lists four lineups by round', (await page.locator('#board-table thead th').count()) === 5 && (await page.locator('#board-table tbody tr').count()) >= 6);
    const lockable = page.locator('#board-table button[data-act="vault"]');
    const cashBefore = await page.evaluate(() => window.__bidlock.engine.human.cash);
    if (cashBefore >= 2 && (await lockable.count()) > 0) {
      await lockable.first().click();
      ok('locking a lot costs $2', (await page.evaluate(() => window.__bidlock.engine.human.cash)) === cashBefore - 2);
    }
    await page.waitForTimeout(300);
    await shot(page, 'vault');
    ok('reaching the heist', (await runTo(page, 'HEIST')) === 'HEIST');
    await page.waitForTimeout(300);
    await shot(page, 'heist');
    const steal = page.locator('#board-table button[data-act="heist"]');
    if ((await steal.count()) > 0) {
      await steal.first().click();
      ok('a steal uses up the heist', await page.evaluate(() => window.__bidlock.engine.human.heistUsed));
    }
    ok('reaching the verdict', (await runTo(page, 'VERDICT')) === 'VERDICT');
    await page.waitForFunction(() => window.__bidlock.screen === 'verdict');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#verdict-actions:not([hidden])');
    const totals = await page.evaluate(() => window.__bidlock.engine.results.players.map((p) => p.total));
    ok('every contender has a total', totals.length === 4 && totals.every((t) => t > 0), totals.join(','));
    ok('a winner is named', (await page.locator('#verdict-table th[data-win="1"]').count()) === 1);
    await page.waitForTimeout(2500);
    await shot(page, 'verdict');
    await page.locator('#btn-copy').click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok('the scorecard is copied', clip.startsWith('BIDLOCK — THE $20 DRAFT') && clip.includes('Seed 21'), clip.slice(0, 80));
    await page.locator('#btn-again').click();
    await page.waitForFunction(() => window.__bidlock.screen === 'game');
    ok('play again starts a fresh match', (await page.evaluate(() => window.__bidlock.engine.human.cash)) === 20);
    ok('no console errors through the endgame', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 6. A whole match on autopilot, at speed, in real frames
  {
    const { ctx, page, errors } = await open(browser, { query: '?seed=5&auto=1&speed=40', reducedMotion: 'reduce' });
    await page.locator('#btn-start').click();
    await page.waitForFunction(() => window.__bidlock.engine.phase === 'VERDICT', null, { timeout: 180000 });
    await page.waitForSelector('#verdict-actions:not([hidden])', { timeout: 60000 });
    ok('an unattended match runs to the verdict', true);
    ok('no console errors over a whole match', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 7. Phone
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 390, height: 844 }, query: '?seed=9' });
    ok('phone: no overflow on the title', (await overflow(page)) <= 0, String(await overflow(page)));
    await shot(page, 'phone-title');
    await page.locator('#btn-start').click();
    await page.waitForFunction(() => window.__bidlock.screen === 'game');
    await runTo(page, 'BIDDING');
    await page.locator('#btn-bid1').scrollIntoViewIfNeeded();
    await page.locator('#btn-bid1').click();
    ok('phone: tapping bids', (await page.evaluate(() => window.__bidlock.engine.highBidder)) === 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    ok('phone: no overflow in the match', (await overflow(page)) <= 0, String(await overflow(page)));
    await shot(page, 'phone-game');
    await runTo(page, 'HEIST');
    await page.waitForTimeout(300);
    ok('phone: no overflow on the heist board', (await overflow(page)) <= 0, String(await overflow(page)));
    await shot(page, 'phone-heist');
    await runTo(page, 'VERDICT');
    await page.locator('#btn-verdict-skip').click();
    await page.waitForTimeout(600);
    ok('phone: no overflow on the verdict', (await overflow(page)) <= 0, String(await overflow(page)));
    await shot(page, 'phone-verdict');
    await page.keyboard.press('?');
    await page.locator('#drawer-tour').click();
    await page.waitForSelector('#cue');
    await page.waitForTimeout(200);
    const card = await page.locator('#cue').boundingBox();
    ok('phone: the cue card stays on screen', card.x >= 0 && card.x + card.width <= 390 && card.y >= 0 && card.y + card.height <= 844, JSON.stringify(card));
    await page.keyboard.press('Escape');
    ok('phone: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} catch (err) {
  ok('the run completed without a crash', false, String(err && err.message ? err.message : err).slice(0, 300));
} finally {
  await browser.close();
  server.close();
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
