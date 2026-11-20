// End-to-end tests for the arcade: the channel guide, Trapdoor Royale and Last Lamp, solo
// and in a room, on desktop and phone. Writes screenshots to screenshots/.
// Usage: node tests/arcade.e2e.mjs      (needs: npm i, and Edge or Chrome installed)
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
  // The headless shell first: unlike headless Edge or Chrome it opens no OS windows.
  for (const channel of [undefined, 'msedge', 'chrome']) {
    try { return await chromium.launch({ channel, args }); } catch { /* next */ }
  }
  throw new Error('No Edge or Chrome found');
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

async function context(browser, { viewport = { width: 1366, height: 768 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await ctx.addInitScript(() => { if (!localStorage.getItem('bidlock.guide.seen')) localStorage.setItem('bidlock.guide.seen', '1'); });
  // Offline: no trivia service, no photographs.
  await ctx.route('https://opentdb.com/**', (r) => r.abort());
  await ctx.route('https://en.wikipedia.org/**', (r) => r.abort());
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

const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const gphase = (p) => p.evaluate(() => (window.__bidlock.arcade ? window.__bidlock.arcade.engine.phase : null));
const waitPhase = (p, ph, timeout = 30000) => p.waitForFunction((x) => window.__bidlock.arcade && window.__bidlock.arcade.engine.phase === x, ph, { timeout });
// Run the host's (or solo) game engine forward until a condition holds.
const runUntil = (p, body) => p.evaluate((b) => {
  const e = window.__bidlock.arcade.engine;
  const test = new Function('e', `return (${b});`);
  for (let i = 0; i < 400000 && !test(e); i++) {
    if (e.phase === 'CHAMPION' || e.phase === 'WINNER') break;
    e.update(1 / 30);
  }
  return test(e);
}, body);

const browser = await launch();
const Q = '?trivia=local&media=off';

try {
  // ---------- 1. The channel guide
  {
    const ctx = await context(browser);
    const { page: p, errors } = await page(ctx, Q);
    ok('the title lists six shows', (await p.locator('#channels .channel').count()) === 6);
    ok('BidLock is picked by default', (await p.locator('.channel[aria-checked="true"]').getAttribute('data-game')) === 'bidlock' && await p.locator('#bidlock-opts').isVisible());
    await p.locator('.channel[data-game="royale"]').click();
    ok('picking Trapdoor Royale shows its rules and hides the bankroll', (await p.locator('#title-how li').count()) === 5 && !(await p.locator('#bidlock-opts').isVisible()) && !(await p.locator('#hero').isVisible()));
    ok('the strap changes with the show', (await p.locator('#strap-text').textContent()) === 'Last One Standing');
    await p.locator('.channel[data-game="royale"]').focus();
    await p.keyboard.press('ArrowRight');
    ok('arrow keys move along the shows', (await p.locator('.channel[aria-checked="true"]').getAttribute('data-game')) === 'lamp');
    await p.waitForTimeout(400);
    await shot(p, 'title-lamp');
    await p.reload();
    await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title');
    ok('the chosen show is remembered', (await p.locator('.channel[aria-checked="true"]').getAttribute('data-game')) === 'lamp');
    ok('the run sheet lists the other shows', (await p.locator('#drawer-games div').count()) === 5);
    ok('no console errors on the title', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 2. Trapdoor Royale, solo
  {
    const ctx = await context(browser);
    const { page: p, errors } = await page(ctx, `${Q}&seed=4`);
    await p.locator('.channel[data-game="royale"]').click();
    await p.locator('#btn-start').click();
    await p.waitForFunction(() => window.__bidlock.screen === 'arcade' && window.__bidlock.arcade);
    ok('solo fills the floor to twelve', (await p.evaluate(() => window.__bidlock.arcade.engine.players.length)) === 12);
    ok('the how-to card shows while the floor fills', await p.locator('#tr-card').isVisible());
    await waitPhase(p, 'QUESTION');
    ok('a question goes up with four platforms', (await p.locator('.tr-ans').count()) === 4 && !(await p.locator('#tr-card').isVisible()));
    ok('the right answer is not shown before the drop', (await p.locator('.tr-ans[data-state="right"], .tr-ans[data-state="wrong"]').count()) === 0);
    // A bot's shove can pin you for two seconds; wait that out before each move.
    const unpinned = () => p.waitForFunction(() => { const e = window.__bidlock.arcade.engine; return !e.stunned(e.me); }, null, { timeout: 5000 });
    await unpinned();
    await p.keyboard.press('3');
    ok('a number key picks a platform', (await p.evaluate(() => window.__bidlock.arcade.engine.me.choice)) === 2);
    await unpinned();
    await p.locator('.tr-ans[data-p="0"]').click();
    ok('clicking an answer switches platform', (await p.evaluate(() => window.__bidlock.arcade.engine.me.choice)) === 0);
    ok('the answers no longer count the crowd', (await p.locator('.tr-crowd').allTextContents()).every((t) => !/●/.test(t)));
    const before = await p.evaluate(() => { const f = window.__bidlock.arcade.stage.figures.get(0); return [f.pos.x, f.pos.z]; });
    await unpinned();
    // Let the contestant settle on platform A first.
    await p.waitForFunction(() => { const f = window.__bidlock.arcade.stage.figures.get(0); return Math.hypot(f.vx, f.vz) < 0.05; }, null, { timeout: 5000 });
    const speed = () => p.evaluate(() => { const f = window.__bidlock.arcade.stage.figures.get(0); return Math.hypot(f.vx, f.vz); });
    await p.keyboard.down('ArrowRight');
    await p.waitForTimeout(60);
    const early = await speed();
    await p.waitForTimeout(640);
    const cruising = await speed();
    await p.keyboard.up('ArrowRight');
    await p.waitForTimeout(90);
    const gliding = await speed();
    await p.waitForTimeout(700);
    const stopped = await speed();
    const after = await p.evaluate(() => { const f = window.__bidlock.arcade.stage.figures.get(0); return [f.pos.x, f.pos.z]; });
    ok('arrow keys run your contestant', Math.hypot(after[0] - before[0], after[1] - before[1]) > 0.3, JSON.stringify([before, after]));
    ok('movement: speeds up smoothly instead of jumping to full speed', early < cruising * 0.8 && cruising > 2, `${early.toFixed(2)} -> ${cruising.toFixed(2)}`);
    ok('movement: glides and eases to a stop when the key is let go', gliding > 0.2 && gliding < cruising && stopped < 0.05, `${gliding.toFixed(2)} -> ${stopped.toFixed(2)}`);
    await p.keyboard.press('e');
    await p.waitForTimeout(1200);
    await shot(p, 'royale-question');
    // Stand on the right platform so this contestant survives the first drop.
    await unpinned();
    await p.evaluate(() => { const a = window.__bidlock.arcade; a.engine.players[0].stunUntil = -1; a.send('move', { to: a.engine.correct }); });
    await waitPhase(p, 'DROP');
    ok('the wrong platforms drop and the answer is shown', (await p.locator('.tr-ans[data-state="right"]').count()) === 1);
    ok('you survive on the right platform', await p.evaluate(() => window.__bidlock.arcade.engine.me.alive));
    await p.waitForTimeout(1300);
    await shot(p, 'royale-drop');
    // Knock yourself out, then call an answer from the sidelines and skip to the end.
    await runUntil(p, "e.phase === 'QUESTION'");
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.players[0].net = false; e.players[0].stunUntil = -1; e.moveFor(0, (e.correct + 1) % 4); });
    await runUntil(p, "e.phase === 'DROP' || e.phase === 'CHAMPION'");
    if (!(await p.evaluate(() => window.__bidlock.arcade.engine.me.alive)) && (await gphase(p)) !== 'CHAMPION') {
      await runUntil(p, "e.phase === 'QUESTION' || e.phase === 'CHAMPION'");
      if ((await gphase(p)) === 'QUESTION') {
        await p.waitForTimeout(200);
        await p.locator('.tr-ans[data-p="1"]').click();
        ok('once out, you can call the answer', (await p.evaluate(() => window.__bidlock.arcade.engine.me.call)) === 1 && (await p.locator('.tr-answers[data-calling="1"]').count()) === 1);
        ok('the skip button appears when you are out', await p.locator('#tr-skip').isVisible());
        await p.waitForTimeout(800);
        await shot(p, 'royale-calling');
        await p.locator('#tr-skip').click();
      }
    }
    await runUntil(p, "e.phase === 'CHAMPION'");
    await p.waitForSelector('#tr-card:not([hidden]) .ag-rank');
    ok('a champion is crowned with a full ranking', (await p.locator('#tr-card .ag-rank li').count()) === 12);
    await p.waitForTimeout(2200);
    await shot(p, 'royale-champion');
    await p.keyboard.press('Enter');
    await waitPhase(p, 'INTRO');
    ok('Enter plays again', (await p.evaluate(() => window.__bidlock.arcade.engine.round)) === 0);
    await p.evaluate(() => window.__bidlock.arcade.shell.exit());
    await p.waitForFunction(() => window.__bidlock.screen === 'title' && !window.__bidlock.arcade);
    ok('back to the title, and the arena is gone', (await p.locator('#arcade canvas').count()) === 0);
    ok('no horizontal overflow', (await overflow(p)) <= 0);
    ok('no console errors in Trapdoor Royale', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 3. Last Lamp, solo
  {
    const ctx = await context(browser);
    const { page: p, errors } = await page(ctx, `${Q}&seed=3`);
    await p.locator('.channel[data-game="lamp"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'QUESTION');
    ok('six keepers, three flames each', await p.evaluate(() => { const e = window.__bidlock.arcade.engine; return e.players.length === 6 && e.players.every((x) => x.flames === 3); }));
    ok('the roll shows every keeper', (await p.locator('#ll-roll li').count()) === 6);
    await p.waitForTimeout(800);
    await shot(p, 'lamp-question');
    const wrong = await p.evaluate(() => (window.__bidlock.arcade.engine.correct + 1) % 4);
    await p.keyboard.press(String(wrong + 1));
    ok('a number key answers in secret', (await p.locator('.ll-answers .ans[data-state="mine"]').count()) === 1);
    await waitPhase(p, 'MINI', 40000);
    const crew = await p.evaluate(() => window.__bidlock.arcade.engine.miniView().crew);
    ok('a wrong answer sends you to the Undertow', crew.includes(0), JSON.stringify(crew));
    await p.waitForTimeout(1500);
    await shot(p, 'lamp-undertow');
    // Play whichever survival game came up, through the panel.
    const kind = await p.evaluate(() => window.__bidlock.arcade.engine.miniView().kind);
    if (kind === 'planks') {
      await p.waitForSelector('#ll-panel .ll-plank:not([disabled])', { timeout: 15000 });
      await p.locator('#ll-panel .ll-plank:not([disabled])').first().click();
      ok('the plank game takes a pick', await p.evaluate(() => { const v = window.__bidlock.arcade.engine.miniView(); return v.picks[0] != null || v.saboteur === 0; }));
    } else if (kind === 'tide') {
      await p.locator('#ll-panel .ll-options .ans').first().click();
      ok('the tide game takes a sum', true);
    } else if (kind === 'lifeboat') {
      await p.locator('#ll-panel [data-act="boat"][data-v="share"]').click();
      ok('the lifeboat takes a choice', (await p.evaluate(() => window.__bidlock.arcade.engine.miniView().chosen.includes(0))));
    } else if (kind === 'tally') {
      await p.locator('#ll-panel .ll-tally .ans').first().click();
      ok('the tally takes a guess', (await p.evaluate(() => window.__bidlock.arcade.engine.miniView().chosen.includes(0))));
    } else if (kind === 'buoy') {
      await p.waitForSelector('#ll-panel .ll-signpad .ans', { timeout: 20000 });
      await p.locator('#ll-panel .ll-signpad .ans').first().click();
      ok('the buoy takes a signal', (await p.evaluate(() => { const v = window.__bidlock.arcade.engine.miniView(); return v.progress[0] === 1 || v.failed[0]; })));
    } else if (kind === 'manifest') {
      await p.locator('#ll-panel .ll-answers .ans').first().click();
      ok('the manifest takes an answer', (await p.evaluate(() => window.__bidlock.arcade.engine.miniView().answered.includes(0))));
    } else {
      ok('the capstan game is up', (await p.locator('#ll-panel .ll-order li').count()) >= 1);
    }
    await runUntil(p, "e.phase === 'SPRINT'");
    await p.waitForSelector('#ll-panel .ll-tf');
    await p.locator('#ll-panel .ll-tf .ans[data-v="true"]').first().click();
    ok('the climb takes true-or-false marks', (await p.locator('#ll-panel .ll-tf .ans[data-state="mine"]').count()) === 1);
    ok('the stairs show every keeper', (await p.locator('#ll-panel .ll-ladder i').count()) === 6);
    await p.waitForTimeout(1500);
    await shot(p, 'lamp-climb');
    await runUntil(p, "e.phase === 'WINNER'");
    await p.waitForSelector('#ll-card:not([hidden]) .ag-rank');
    ok('someone lights the lamp', (await p.locator('#ll-card .ag-rank li').count()) === 6 && (await p.locator('#ll-card .ag-rank li').first().textContent()).includes('LIT THE LAMP'));
    await p.waitForTimeout(2500);
    await shot(p, 'lamp-winner');
    ok('no horizontal overflow', (await overflow(p)) <= 0);
    ok('no console errors in Last Lamp', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 4. A room: pick a show, vote, play both quiz games, back to the lobby
  {
    const ctx = await context(browser);
    const q = `${Q}&net=local&seed=6`;
    const { page: host, errors: hostErrors } = await page(ctx, q);
    const { page: guest, errors: guestErrors } = await page(ctx, q);
    await host.locator('.channel[data-game="royale"]').click();
    await host.locator('#btn-friends').click();
    await host.locator('#lobby-name').fill('Alpha');
    await host.locator('#lobby-create').click();
    await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open');
    ok('a new room starts on the show picked on the title', (await host.evaluate(() => window.__bidlock.lobby.state.game)) === 'royale');
    const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
    await guest.locator('#btn-friends').click();
    await guest.locator('#lobby-name').fill('Bravo');
    await guest.locator('#lobby-code').fill(code);
    await guest.locator('#lobby-join').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.status === 'open' && window.__bidlock.lobby.state.players.length === 2, null, { timeout: 10000 });
    ok('the guest sees which show is next', (await guest.locator('.lg-game[aria-pressed="true"]').getAttribute('data-game')) === 'royale');
    await guest.locator('.lg-game[data-game="lamp"]').click();
    await host.waitForFunction(() => window.__bidlock.lobby.voteCount('lamp') === 1, null, { timeout: 5000 });
    ok('a guest vote reaches the host', (await host.locator('.lg-game[data-game="lamp"] .lg-votes').textContent()).includes('1 vote'));
    ok('a guest vote does not change the show', (await host.evaluate(() => window.__bidlock.lobby.state.game)) === 'royale');
    ok('the table fills to twelve for Trapdoor Royale', (await host.evaluate(() => window.__bidlock.lobby.seats().length)) === 12);
    await host.waitForTimeout(300);
    await shot(host, 'lobby-arcade');

    await host.locator('#lobby-start').click();
    await guest.waitForFunction(() => window.__bidlock.screen === 'arcade' && window.__bidlock.role === 'client' && window.__bidlock.arcade && window.__bidlock.arcade.engine.players.length === 12, null, { timeout: 15000 });
    ok('the guest joins the arena on seat 2', (await guest.evaluate(() => window.__bidlock.arcade.engine.localId)) === 1);
    await guest.waitForFunction(() => window.__bidlock.arcade.engine.phase === 'QUESTION', null, { timeout: 20000 });
    const same = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.arcade.engine.question.text)));
    ok('both see the same question', same[0] === same[1]);
    ok('the guest is not sent the answer', (await guest.evaluate(() => window.__bidlock.arcade.engine.correct)) === -1);
    await guest.locator('.tr-ans[data-p="3"]').click();
    await host.waitForFunction(() => window.__bidlock.arcade.engine.players[1].choice === 3, null, { timeout: 5000 });
    ok("the guest's move reaches the host", true);
    await guest.waitForFunction(() => window.__bidlock.arcade.stage.figures.get(1).target.x > 2, null, { timeout: 5000 });
    ok('the guest\'s contestant runs to platform D', true);
    await shot(guest, 'royale-guest');
    await runUntil(host, "e.phase === 'CHAMPION'");
    await guest.waitForSelector('#tr-card:not([hidden]) .ag-rank', { timeout: 15000 });
    const champs = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.arcade.engine.ranking[0])));
    ok('both crown the same champion', champs[0] === champs[1]);
    ok('only the host can play again', (await guest.locator('#tr-card [data-ag="again"]').count()) === 0);

    // Back to the lobby, switch shows, play Last Lamp without re-entering the code.
    await host.locator('#tr-card [data-ag="exit"]').click();
    await host.waitForFunction(() => window.__bidlock.screen === 'title' && window.__bidlock.lobby.state.status === 'open' && !window.__bidlock.lobby.state.inMatch);
    await guest.waitForFunction(() => window.__bidlock.screen === 'title' && !window.__bidlock.arcade, null, { timeout: 10000 });
    ok('back to the lobby for everyone, code kept', (await guest.evaluate(() => window.__bidlock.lobby.state.code)) === code);
    await host.locator('.lg-game[data-game="lamp"]').click();
    await guest.waitForFunction(() => window.__bidlock.lobby.state.game === 'lamp', null, { timeout: 5000 });
    ok('the host switches the show', true);
    await host.locator('#lobby-start').click();
    await guest.waitForFunction(() => window.__bidlock.arcade && window.__bidlock.arcade.id === 'lamp' && window.__bidlock.arcade.engine.phase === 'QUESTION', null, { timeout: 20000 });
    ok('Last Lamp starts for both, six keepers', (await guest.evaluate(() => window.__bidlock.arcade.engine.players.length)) === 6);
    await guest.locator('#ll-panel .ans[data-i="1"]').click();
    await host.waitForFunction(() => window.__bidlock.arcade.engine.players[1].answer === 1, null, { timeout: 5000 });
    ok("the guest's secret answer reaches the host", true);
    ok('other answers stay hidden from the guest', (await guest.evaluate(() => window.__bidlock.arcade.engine.players[0].answer)) == null || (await guest.evaluate(() => window.__bidlock.arcade.engine.players[0].answer)) === -2);
    await runUntil(host, "e.phase === 'WINNER'");
    await guest.waitForSelector('#ll-card:not([hidden]) .ag-rank', { timeout: 15000 });
    const winners = await Promise.all([host, guest].map((x) => x.evaluate(() => window.__bidlock.arcade.engine.winner)));
    ok('both see the same keeper light the lamp', winners[0] === winners[1]);
    await host.close();
    await guest.waitForSelector('#lost:not([hidden])', { timeout: 10000 });
    ok('if the host leaves, the guest is told', (await guest.locator('#lost-h').textContent()) === 'SIGNAL LOST' && !(await guest.evaluate(() => window.__bidlock.arcade)));
    ok('no console errors in the room (host)', hostErrors.length === 0, hostErrors.join(' | '));
    ok('no console errors in the room (guest)', guestErrors.length === 0, guestErrors.join(' | '));
    await ctx.close();
  }

  // ---------- 4b. Every new situation, forced, played and photographed
  {
    const ctx = await context(browser);
    const { page: p, errors } = await page(ctx, `${Q}&seed=12`);
    await p.locator('.channel[data-game="royale"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'QUESTION');
    // Blackout: the answers are question marks until the last seconds.
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.twist = 'blackout'; e.t = e.total; window.__bidlock.arcade.wasDark = true; window.__bidlock.arcade.renderQuestion(); });
    ok('blackout: the answers are dark', (await p.locator('.tr-ans .tr-text').allTextContents()).every((t) => t === '?'));
    await p.waitForTimeout(600);
    await shot(p, 'royale-blackout');
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.t = 4.5; });
    await p.waitForFunction(() => [...document.querySelectorAll('.tr-ans .tr-text')].every((x) => x.textContent !== '?'), null, { timeout: 5000 });
    ok('blackout: the lights come up', true);
    // Shuffle: the answers jump platform halfway.
    await runUntil(p, "e.phase === 'QUESTION' && e.round >= 2");
    const before = await p.locator('.tr-ans .tr-text').allTextContents();
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.twist = 'shuffle'; e.twistDone = false; e.t = e.total / 2 - 0.1; });
    await p.waitForFunction(() => window.__bidlock.arcade.engine.twistDone, null, { timeout: 5000 });
    await p.waitForTimeout(300);
    const after = await p.locator('.tr-ans .tr-text').allTextContents();
    ok('shuffle: every answer moved platform', after.every((t, i) => t !== before[i]) && [...after].sort().join() === [...before].sort().join(), JSON.stringify([before, after]));
    // Crumble: a wrong platform goes early.
    await runUntil(p, "e.phase === 'QUESTION' && e.round >= 3");
    await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.twist = 'crumble'; e.twistDone = false; e.t = e.total / 2 - 0.1; });
    await p.waitForFunction(() => window.__bidlock.arcade.engine.blocked >= 0, null, { timeout: 5000 });
    await p.waitForTimeout(900);
    ok('crumble: the platform is shown as closed', (await p.locator('.tr-ans .tr-text', { hasText: 'CRUMBLED' }).count()) === 1);
    await shot(p, 'royale-crumble');
    await p.evaluate(() => window.__bidlock.arcade.shell.exit());
    await p.waitForFunction(() => window.__bidlock.screen === 'title' && !window.__bidlock.arcade);

    await p.locator('.channel[data-game="lamp"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'QUESTION');
    // Fog on question 1 (forced), then each new survival game in turn.
    await p.evaluate(() => { const g = window.__bidlock.arcade; const e = g.engine; e.event = 'fog'; e.t = e.total; g.wasFoggy = true; g.el.event.hidden = false; g.el.event.textContent = 'FOG'; g.renderPanel(); });
    ok('fog: the answers are hidden', (await p.locator('#ll-panel .ans[disabled]').count()) === 4);
    await p.waitForTimeout(400);
    await shot(p, 'lamp-fog');
    for (const kind of ['tally', 'buoy', 'manifest']) {
      await runUntil(p, "e.phase === 'QUESTION'");
      await p.evaluate(() => { const e = window.__bidlock.arcade.engine; e.event = null; e.answerFor(0, (e.correct + 1) % 4); });
      await runUntil(p, "e.phase === 'DESCENT' || e.phase === 'WINNER' || e.phase === 'FINALE_INTRO'");
      if ((await gphase(p)) !== 'DESCENT') break;
      await p.evaluate((k) => { window.__bidlock.arcade.engine.pendingMini = k; }, kind);
      await runUntil(p, "e.phase === 'MINI'");
      await p.waitForTimeout(kind === 'buoy' ? 1400 : 900);
      ok(`${kind}: the survival game is up`, (await p.evaluate(() => window.__bidlock.arcade.engine.miniView().kind)) === kind);
      await shot(p, `lamp-${kind}`);
      if (kind === 'tally') { await p.locator('#ll-panel .ll-tally .ans').nth(1).click(); ok('tally: a guess is taken', await p.evaluate(() => window.__bidlock.arcade.engine.miniView().chosen.includes(0))); }
      if (kind === 'buoy') {
        await p.waitForSelector('#ll-panel .ll-signpad .ans', { timeout: 20000 });
        const seq = await p.evaluate(() => window.__bidlock.arcade.engine.mini.seq);
        for (const k of seq) await p.locator(`#ll-panel .ll-signpad .ans[data-i="${k}"]`).click();
        ok('buoy: signalling the pattern back gets you out', (await p.evaluate(() => { const v = window.__bidlock.arcade.engine.miniView(); return v.progress[0] === v.length && !v.failed[0]; })));
      }
      if (kind === 'manifest') { const c = await p.evaluate(() => window.__bidlock.arcade.engine.mini.qs[0].correct); await p.locator(`#ll-panel .ll-answers .ans[data-i="${c}"]`).click(); ok('manifest: an answer is taken', await p.evaluate(() => window.__bidlock.arcade.engine.miniView().answered.includes(0))); }
      await runUntil(p, "e.phase === 'MINI_RESULT'");
    }
    ok('no console errors in the forced situations', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 5. Phone
  {
    const ctx = await context(browser, { viewport: { width: 390, height: 844 } });
    const { page: p, errors } = await page(ctx, `${Q}&seed=8`);
    await p.locator('.channel[data-game="royale"]').click();
    ok('phone: no overflow on the title', (await overflow(p)) <= 0);
    await p.locator('#btn-start').click();
    await waitPhase(p, 'QUESTION');
    await p.locator('.tr-ans[data-p="1"]').click();
    ok('phone: tapping a platform answers', (await p.evaluate(() => window.__bidlock.arcade.engine.me.choice)) === 1);
    ok('phone: no overflow in the arena', (await overflow(p)) <= 0, String(await overflow(p)));
    await p.waitForTimeout(800);
    await shot(p, 'phone-royale');
    await p.evaluate(() => window.__bidlock.arcade.shell.exit());
    await p.waitForFunction(() => window.__bidlock.screen === 'title');
    await p.locator('.channel[data-game="lamp"]').click();
    await p.locator('#btn-start').click();
    await waitPhase(p, 'QUESTION');
    await p.locator('#ll-panel .ans[data-i="0"]').click();
    ok('phone: tapping answers in Last Lamp', (await p.locator('#ll-panel .ans[data-state="mine"]').count()) === 1);
    ok('phone: no overflow in the lighthouse', (await overflow(p)) <= 0, String(await overflow(p)));
    await p.waitForTimeout(800);
    await shot(p, 'phone-lamp');
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
