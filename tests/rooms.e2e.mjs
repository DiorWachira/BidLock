// End-to-end: real browsers in a room through the BidLock room server (server/, run
// locally with wrangler dev). Six players, one of them on a browser that blocks WebRTC
// the way Brave and school networks do; a host whose tab is frozen; a host whose
// connection drops mid-match; and "Check my connection" with the room server.
// Usage: node tests/rooms.e2e.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../tools/serve.mjs';
import { startRoomServer } from './roomServer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let failed = 0;
function ok(name, cond, detail) {
  results.push(`${cond ? 'pass ' : 'FAIL '}${name}${cond || detail == null ? '' : `  -> ${detail}`}`);
  if (!cond) failed++;
}

const ARGS = ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
async function launch(extra = []) {
  for (const channel of [undefined, 'msedge', 'chrome']) {
    try { return await chromium.launch({ channel, args: [...ARGS, ...extra] }); } catch { /* next */ }
  }
  throw new Error('No browser found');
}

// BIDLOCK_ROOMS=wss://... runs the same checks against a deployed room server instead.
const rooms = process.env.BIDLOCK_ROOMS ? { ws: process.env.BIDLOCK_ROOMS, stop: async () => {} } : await startRoomServer();
const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
// The default connection mode (the room server first, PeerJS as the fallback), with the
// room server running here. PeerJS is blocked below, so everything goes through the server.
const Q = `?trivia=local&media=off&seed=8&rooms=${encodeURIComponent(rooms.ws)}`;

async function context(browser, { viewport = { width: 1280, height: 720 }, noWebRTC = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { if (!localStorage.getItem('bidlock.guide.seen')) localStorage.setItem('bidlock.guide.seen', '1'); });
  if (noWebRTC) await ctx.addInitScript(() => { delete window.RTCPeerConnection; delete window.webkitRTCPeerConnection; });
  await ctx.route('https://opentdb.com/**', (r) => r.abort());
  await ctx.route('https://en.wikipedia.org/**', (r) => r.abort());
  await ctx.route(/peerjs|esm\.sh/, (r) => r.abort());
  return ctx;
}

// While the host's connection is deliberately broken, the browser reports each failed reconnect.
let wsErrorsExpected = false;
async function page(ctx) {
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => {
    if (m.type() !== 'error' || /Failed to load resource/.test(m.text())) return;
    if (wsErrorsExpected && /WebSocket connection to .* failed/.test(m.text())) return;
    errors.push(m.text());
  });
  await p.goto(BASE + Q, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__bidlock && window.__bidlock.screen === 'title', null, { timeout: 30000 });
  return { page: p, errors };
}

const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const lobbyOf = (p) => p.evaluate(() => { const s = window.__bidlock.lobby.state; return { status: s.status, n: s.players.length, via: s.via, away: s.hostAway, inMatch: s.inMatch }; });

// What the host saw: the phase, a seat's state, its link, and the last inputs received.
async function readout(seat) {
  try {
    return JSON.stringify(await hostPage.evaluate((x) => {
      const e = window.__bidlock.arcade && window.__bidlock.arcade.engine;
      const p = e && e.players[x];
      const t = window.__bidlock.lobby.transport;
      const link = t && (t.relay ? t.relay.link : t.link);
      return { phase: e && e.phase, t: e && +e.t.toFixed(2), seat: p && { alive: p.alive, choice: p.choice, call: p.call }, blocked: e && e.blocked, link: link && { ready: link.ready, got: link.got, sent: link.sent, epoch: link.epoch }, inputs: (window.__inputs || []).slice(-8) };
    }, seat));
  } catch (err) { return `(no readout: ${err.message.split('\n')[0]})`; }
}
let hostPage = null;

const browser = await launch();
// Like Brave's "Disable non-proxied UDP": WebRTC cannot make direct connections.
const strict = await launch(['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']);
const contexts = [];

try {
  // ---------- 1. Six players: open a room, join it, start Trapdoor Royale
  const hostCtx = await context(browser);
  contexts.push(hostCtx);
  const { page: host, errors: hostErrors } = await page(hostCtx);
  hostPage = host;
  await host.locator('.channel[data-game="royale"]').click();
  await host.locator('#btn-friends').click();
  await host.locator('#lobby-name').fill('Alpha');
  await host.locator('#lobby-create').click();
  await host.waitForFunction(() => window.__bidlock.lobby.state.status === 'open', null, { timeout: 15000 });
  const code = await host.evaluate(() => window.__bidlock.lobby.state.code);
  ok('the room opens on the room server', (await lobbyOf(host)).via === 'relay');
  ok('the host is told late arrivals will wait for them', /gets in when you are back/.test(await host.locator('#lobby-status').textContent()));

  const guests = [];
  const names = ['Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
  for (let i = 0; i < names.length; i++) {
    // Bravo: WebRTC restricted like Brave. Charlie: no WebRTC at all. The rest: normal.
    const ctx = await context(i === 0 ? strict : browser, { noWebRTC: i === 1, viewport: i === 4 ? { width: 390, height: 844 } : undefined });
    contexts.push(ctx);
    const g = await page(ctx);
    guests.push(g);
    await g.page.locator('#btn-friends').click();
    await g.page.locator('#lobby-name').fill(names[i]);
    await g.page.locator('#lobby-code').fill(code);
    await g.page.locator('#lobby-join').click();
  }
  await Promise.all(guests.map((g) => g.page.waitForFunction(() => window.__bidlock.lobby.state.status === 'open' && window.__bidlock.lobby.state.players.length === 6, null, { timeout: 20000 })));
  ok('six players in the room', (await lobbyOf(host)).n === 6);
  const vias = await Promise.all(guests.map((g) => lobbyOf(g.page).then((s) => s.via)));
  ok('every guest is connected through the room server', vias.every((v) => v === 'relay'), vias.join(','));
  ok('including the Brave-style browser and the one without WebRTC', vias[0] === 'relay' && vias[1] === 'relay');

  // Check my connection, on the strict browser: ready, because of the room server.
  const b = guests[0].page;
  await b.locator('#lobby-check-btn').click();
  await b.waitForFunction(() => document.querySelector('#lobby-check').dataset.verdict, null, { timeout: 20000 });
  ok('check my connection: ready for rooms on a strict browser', (await b.locator('#lobby-check').getAttribute('data-verdict')) === 'ok' && /room server can be reached/.test(await b.locator('#lobby-check').textContent()), await b.locator('#lobby-check').textContent());
  await b.locator('#lobby-check').scrollIntoViewIfNeeded();
  await shot(b, 'lobby-rooms-check');
  const c = guests[1].page;
  await c.locator('#lobby-check-btn').click();
  await c.waitForFunction(() => document.querySelector('#lobby-check').dataset.verdict, null, { timeout: 20000 });
  ok('check my connection: ready even with WebRTC switched off', (await c.locator('#lobby-check').getAttribute('data-verdict')) === 'ok');

  // Every input the host receives, with the game's phase, for the readout of a failed check.
  await host.evaluate(() => {
    const l = window.__bidlock.lobby;
    const orig = l.onInput;
    window.__inputs = [];
    l.onInput = (seat, m) => { const a = window.__bidlock.arcade; window.__inputs.push(`${seat}:${m.t}/${m.a || ''}/${m.to ?? ''}@${a ? a.engine.phase : '-'}`); orig(seat, m); };
  });
  await host.locator('#lobby-start').click();
  await Promise.all(guests.map((g) => g.page.waitForFunction(() => window.__bidlock.arcade && window.__bidlock.arcade.engine.phase === 'QUESTION', null, { timeout: 30000 })));
  ok('Trapdoor Royale starts for all six', true);
  const qs = await Promise.all([host, ...guests.map((g) => g.page)].map((p) => p.evaluate(() => window.__bidlock.arcade.engine.question.text)));
  ok('everyone sees the same question', new Set(qs).size === 1);
  await b.locator('.tr-ans[data-p="2"]').click();
  await host.waitForFunction(() => window.__bidlock.arcade.engine.players[1].choice === 2, null, { timeout: 5000 }).then(() => ok("the Brave-style player's answer reaches the host", true), () => ok("the Brave-style player's answer reaches the host", false));

  // ---------- 2. The host's tab is frozen (a phone screen turned off), then wakes
  const cdp = await hostCtx.newCDPSession(host);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await c.locator('.tr-ans[data-p="1"]').click(); // sent while the host is frozen
  await host.waitForTimeout(6000);
  ok('guests stay in the room while the host is frozen', (await Promise.all(guests.map((g) => lobbyOf(g.page)))).every((s) => s.status === 'open' && s.inMatch));
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await host.waitForFunction(() => window.__bidlock.arcade.engine.players[2].choice === 1, null, { timeout: 8000 }).then(() => ok('an answer sent during the freeze arrives when the host wakes', true), async () => ok('an answer sent during the freeze arrives when the host wakes', false, await readout(2)));

  // ---------- 3. The host's connection drops mid-match, and comes back by itself
  // Both drills run on one fresh question, with the host's game clock held still, so they
  // test the connection rather than how long a question lasts (over a real network a drill
  // can take longer than a question). The answers come from a guest still in the game (an
  // eliminated player's tap is only a "call"), on platforms that have not crumbled.
  async function freshQuestion() {
    await host.evaluate(() => {
      const e = window.__bidlock.arcade.engine;
      for (let i = 0; i < 20000 && e.phase === 'QUESTION'; i++) e.update(1 / 30);
      for (let i = 0; i < 20000 && e.phase !== 'QUESTION' && e.phase !== 'CHAMPION'; i++) e.update(1 / 30);
    });
    const t = await host.evaluate(() => {
      const e = window.__bidlock.arcade.engine;
      const seat = e.players.findIndex((x, i) => i > 0 && x.alive && x.isHuman);
      const open = [3, 2, 1, 0].filter((x) => x !== e.blocked);
      return { seat: seat > 0 ? seat : 4, alive: seat > 0, p: open[0], p2: open[1] };
    });
    t.page = guests[t.seat - 1].page;
    await t.page.waitForFunction(() => window.__bidlock.arcade.engine.phase === 'QUESTION', null, { timeout: 8000 }).catch(() => {});
    return t;
  }
  const counted = (t) => host.waitForFunction(({ seat, alive, p }) => window.__bidlock.arcade.engine.players[seat][alive ? 'choice' : 'call'] === p, { seat: t.seat, alive: t.alive, p: t.p }, { timeout: 10000 }).then(() => true, () => false);
  const countedOr = async (name, t) => { const yes = await counted(t); ok(name, yes, yes ? null : `${JSON.stringify({ seat: t.seat, alive: t.alive, p: t.p })} ${await readout(t.seat)}`); };

  // a) The connection breaks and the room server sees it go: the guests are told.
  const t = await freshQuestion();
  const hold = (on) => host.evaluate((x) => {
    const e = window.__bidlock.arcade.engine;
    if (!e.__update) { e.__update = e.update.bind(e); e.update = (dt) => { if (!window.__hold) e.__update(dt); }; }
    window.__hold = x;
  }, on);
  await hold(true);
  wsErrorsExpected = true;
  await host.evaluate(() => { const link = window.__bidlock.lobby.transport.relay.link; window.__roomUrl = link.url; link.url = 'ws://127.0.0.1:9/room/x'; link._drop(); });
  await Promise.all(guests.map((g) => g.page.waitForFunction(() => window.__bidlock.lobby.state.hostAway, null, { timeout: 8000 }))).then(() => ok('guests are told the host is away', true), () => ok('guests are told the host is away', false));
  await guests[2].page.waitForFunction(() => /HOST AWAY/.test(document.querySelector('#roomchip').textContent), null, { timeout: 4000 }).catch(() => {});
  ok('the room chip says HOST AWAY', /HOST AWAY/.test(await guests[2].page.locator('#roomchip').textContent()));
  await shot(guests[2].page, 'room-host-away');
  await t.page.locator(`.tr-ans[data-p="${t.p}"]`).click(); // sent while the host is away
  await host.waitForTimeout(2500);
  await host.evaluate(() => { window.__bidlock.lobby.transport.relay.link.url = window.__roomUrl; window.dispatchEvent(new Event('online')); });
  await Promise.all(guests.map((g) => g.page.waitForFunction(() => !window.__bidlock.lobby.state.hostAway, null, { timeout: 15000 }))).then(() => ok('the host reconnects and the guests see them back', true), () => ok('the host reconnects and the guests see them back', false));
  await countedOr('an answer sent while the host was away still counts', t);
  wsErrorsExpected = false;

  // b) The connection dies silently (the browser goes offline): the room server cannot
  // tell, and keeps sending to a dead socket. Counting and resending make up for it.
  t.p = t.p2; // a second answer, on the same question
  wsErrorsExpected = true;
  await hostCtx.setOffline(true);
  await host.evaluate(() => window.__bidlock.lobby.transport.relay.link._drop());
  await t.page.locator(`.tr-ans[data-p="${t.p}"]`).click(); // into the dead socket
  await host.waitForTimeout(1500);
  await hostCtx.setOffline(false);
  await host.evaluate(() => window.dispatchEvent(new Event('online')));
  await countedOr('an answer lost in a dead connection is resent and counts', t);
  wsErrorsExpected = false;
  await hold(false);
  ok('nobody lost their seat', (await host.evaluate(() => window.__bidlock.lobby.state.players.filter((p) => !p.away).length)) === 6);
  // The match carries on for everyone.
  const before = await guests[4].page.evaluate(() => window.__bidlock.arcade.engine.round || 0);
  await host.evaluate(() => { const e = window.__bidlock.arcade.engine; const r = e.round; for (let i = 0; i < 20000 && e.round === r && e.phase !== 'CHAMPION'; i++) e.update(1 / 30); });
  await guests[4].page.waitForFunction((r) => (window.__bidlock.arcade.engine.round || 0) > r || window.__bidlock.arcade.engine.phase === 'CHAMPION', before, { timeout: 15000 }).then(() => ok('the match carries on for everyone after the drop', true), () => ok('the match carries on for everyone after the drop', false));
  ok('no horizontal overflow on the phone guest', (await guests[4].page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);

  // ---------- 4. The host closes the tab: everyone is told at once
  await host.close();
  await Promise.all(guests.map((g) => g.page.waitForSelector('#lost:not([hidden])', { timeout: 10000 }))).then(() => ok('closing the host tab tells every guest', true), () => ok('closing the host tab tells every guest', false));

  const errs = [...hostErrors, ...guests.flatMap((g) => g.errors)];
  ok('no console errors', errs.length === 0, errs.slice(0, 5).join(' | '));
} catch (err) {
  ok(`the run finished (${err.message.split('\n')[0]})`, false);
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
  await browser.close();
  await strict.close();
  server.close();
  await rooms.stop();
}

for (const r of results) console.log(r);
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
