// BIDLOCK — orchestrator. Owns the screen state machine, the fixed-timestep loop, input,
// and the wiring between the rules engine, the 3D stage, the sound engine and the HUD.

import { AuctionEngine, PHASE, RULES, HUMAN_ID } from './engine/auctionEngine.js';
import { PERSONAS } from './engine/aiBidders.js';
import { CATEGORIES, MYSTERY_CATEGORY, CRATE_CLUES, SYNERGY_TAGS, hypeLamps } from './data/categories.js';
import { SoundEngine } from './audio/soundEngine.js';
import { EggcrateDisplay } from './ui/eggcrate.js';
import { Hud, esc } from './ui/hud.js';
import { Guide, HelpDrawer } from './ui/guide.js';

const $ = (s, r = document) => r.querySelector(s);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`bidlock.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`bidlock.${key}`, JSON.stringify(value)); } catch { /* storage blocked: settings just will not persist */ }
  },
};

const params = new URLSearchParams(location.search);
const debug = {
  speed: Math.max(0.25, Math.min(40, Number(params.get('speed')) || 1)),
  seed: params.has('seed') ? Number(params.get('seed')) | 0 : null,
  auto: params.get('auto') === '1',
};

const settings = {
  budget: store.get('budget', 20) === 50 ? 50 : 20,
  allIn: !!store.get('allIn', false),
  volume: Math.max(0, Math.min(1, Number(store.get('volume', 0.7)) || 0)),
  muted: !!store.get('muted', false),
  theme: store.get('theme', 'dark') === 'light' ? 'light' : 'dark',
  ff: store.get('ff', true) !== false,
};

const COLORS = ['#f3ead6', ...PERSONAS.map((p) => p.color)];
const CAM_LABELS = { title: 'CAM 1 · WIDE', wide: 'CAM 1 · WIDE', bid: 'CAM 2 · FLOOR', pedestal: 'CAM 3 · PEDESTAL', gavel: 'CAM 4 · GAVEL', heist: 'CAM 5 · OVERHEAD', podium: 'CAM 6 · PODIUM' };
const STEP = 1 / 60;

const engine = new AuctionEngine();
const audio = new SoundEngine();
const hud = new Hud({ colors: COLORS });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let stage = null;
let screen = 'boot';
const pauseReasons = new Set();
let seconds = 0;
let acc = 0;
let last = performance.now();
let lastTickClock = 99;
let camReturn = 0;
const verdict = { active: false, step: 0, total: 0, timer: 0, done: false };
const hero = { cat: 0, idx: new Array(CATEGORIES.length + 1).fill(0), auto: 0, touched: -99 };
const heroCats = [...CATEGORIES, MYSTERY_CATEGORY];

// Calls go straight through when the 3D stage exists and quietly vanish when it does not.
const S = new Proxy({}, {
  get: (_, name) => (...args) => {
    if (!stage || typeof stage[name] !== 'function') return undefined;
    try { return stage[name](...args); } catch (err) { console.warn(`[bidlock] stage.${String(name)} failed:`, err); return undefined; }
  },
});

function setCam(mode) {
  S.setCamera(mode);
  hud.setCamLabel(CAM_LABELS[mode] || 'CAM 1 · WIDE');
}

const inMatch = () => engine.phase !== PHASE.IDLE;
const isPaused = () => pauseReasons.size > 0;

function refreshAir() {
  hud.setOnAir(isPaused() ? 'STANDBY' : inMatch() && engine.phase !== PHASE.VERDICT ? 'ON AIR' : 'OFF AIR');
}

function setPaused(reason, on) {
  if (on) pauseReasons.add(reason); else pauseReasons.delete(reason);
  $('#pause').hidden = !pauseReasons.has('user');
  if (pauseReasons.has('user') || pauseReasons.has('hidden')) audio.suspend(); else audio.resume();
  refreshAir();
}

function setScreen(name) {
  screen = name;
  document.body.dataset.screen = name;
  document.body.dataset.tension = '0';
  $('#bigcall').classList.remove('on'); // a banner from the last screen should not linger on this one
  refreshAir();
  S.resize();
}

// ---------- settings ----------
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  S.setTheme(settings.theme);
  $('#btn-theme').setAttribute('aria-pressed', String(settings.theme === 'light'));
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', settings.theme === 'light' ? '#d9d6ce' : '#0b0d10');
}

function applySound() {
  audio.setVolume(settings.volume);
  audio.setMuted(settings.muted);
  const b = $('#btn-mute');
  b.setAttribute('aria-pressed', String(settings.muted));
  b.textContent = settings.muted ? 'MUTED' : 'SOUND';
  $('#vol').value = String(Math.round(settings.volume * 100));
}

function toggleMute() {
  audio.unlock();
  settings.muted = !settings.muted;
  store.set('muted', settings.muted);
  applySound();
}

function toggleFF() {
  settings.ff = !settings.ff;
  store.set('ff', settings.ff);
  $('#btn-ff').setAttribute('aria-pressed', String(settings.ff));
  hud.toast(settings.ff ? 'Fast-forward on: lots you are out of run at speed.' : 'Fast-forward off.');
}

function applyModes() {
  for (const r of document.querySelectorAll('input[name="budget"]')) r.checked = Number(r.value) === settings.budget;
  $('#allin').checked = settings.allIn;
  $('#strap-budget').textContent = String(settings.budget);
  document.title = `BidLock — The $${settings.budget} Draft`;
  S.setSign(`$${settings.budget}`);
}

// ---------- title hero: browse the real catalogue on the pedestal ----------
function buildHero() {
  $('#hero-cats').innerHTML = heroCats.map((c, i) => `<button type="button" class="cat" data-cat="${i}" aria-pressed="false"><span class="cat-n">${String(i + 1).padStart(2, '0')}</span><span class="cat-name">${esc(c.name)}</span></button>`).join('');
  const wrap = $('#hero-cats');
  const pick = (i, advance) => {
    hero.touched = seconds;
    if (advance && hero.cat === i) hero.idx[i] = (hero.idx[i] + 1) % heroCats[i].items.length;
    showHero(i);
  };
  wrap.addEventListener('pointerover', (e) => { const b = e.target.closest('.cat'); if (b && e.pointerType === 'mouse') pick(Number(b.dataset.cat), false); });
  wrap.addEventListener('focusin', (e) => { const b = e.target.closest('.cat'); if (b) pick(Number(b.dataset.cat), false); });
  wrap.addEventListener('click', (e) => { const b = e.target.closest('.cat'); if (b) { audio.unlock(); audio.blip(); pick(Number(b.dataset.cat), true); } });
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const btns = [...wrap.querySelectorAll('.cat')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    btns[(i + d + btns.length) % btns.length].focus();
  });
}

function showHero(catIndex) {
  hero.cat = catIndex;
  const cat = heroCats[catIndex];
  const mystery = cat === MYSTERY_CATEGORY;
  const item = cat.items[hero.idx[catIndex]];
  for (const b of document.querySelectorAll('#hero-cats .cat')) b.setAttribute('aria-pressed', String(Number(b.dataset.cat) === catIndex));
  $('#hero-slug').textContent = `${cat.name.toUpperCase()} · LOT ${hero.idx[catIndex] + 1} OF ${cat.items.length}`;
  if (mystery) {
    $('#hero-name').textContent = 'Sealed Mystery Crate';
    $('#hero-hype').innerHTML = '<span class="hype-sealed">SEALED</span>';
    $('#hero-tags').innerHTML = '<span class="tag">Jackpot or curse</span>';
    $('#hero-line').textContent = `Clue: ${CRATE_CLUES[hero.idx[catIndex] % CRATE_CLUES.length]}`;
  } else {
    const lamps = hypeLamps(item);
    $('#hero-name').textContent = item.name;
    $('#hero-hype').innerHTML = Array.from({ length: 5 }, (_, i) => `<i data-on="${i < lamps ? 1 : 0}"></i>`).join('') + `<span class="visually-hidden">${lamps} of 5</span>`;
    $('#hero-tags').innerHTML = item.synergyTags.map((t) => `<span class="tag">${esc(SYNERGY_TAGS[t])}</span>`).join('');
    $('#hero-line').textContent = item.commentaryLine;
  }
  S.showLot(item, { mystery });
  S.setPrice(mystery ? 0 : Math.max(1, Math.round(item.baseAppeal / 10)));
  S.setSign(`$${settings.budget}`);
}

function heroAttract(dt) {
  if (screen !== 'title' || isPaused()) return;
  hero.auto += dt;
  if (hero.auto < 4.2 || seconds - hero.touched < 9) return;
  hero.auto = 0;
  const i = (hero.cat + 1) % heroCats.length;
  hero.idx[i] = (hero.idx[i] + 1) % heroCats[i].items.length;
  showHero(i);
}

// ---------- match control ----------
function startMatch() {
  audio.unlock();
  applySound();
  audio.startMusic();
  audio.setTension(0);
  verdict.active = false;
  verdict.done = false;
  acc = 0;
  hud.clearChyrons();
  const seed = debug.seed != null ? debug.seed : (Date.now() ^ (Math.random() * 0x7fffffff)) & 0x7fffffff;
  engine.startMatch({ budget: settings.budget, allIn: settings.allIn, seed });
  $('#deck').focus({ preventScroll: true });
}

function quitToTitle() {
  engine.abort();
  audio.stopMusic();
  verdict.active = false;
  pauseReasons.delete('user');
  setPaused('user', false);
  hud.clearChyrons();
  S.setContenders(defaultUnits());
  S.setCallStage(0);
  setScreen('title');
  setCam('title');
  hero.touched = -99;
  showHero(hero.cat);
  $('#btn-start').focus({ preventScroll: true });
}

function defaultUnits() {
  return [
    { id: 0, name: 'YOU', key: 'you', color: COLORS[0], cash: settings.budget },
    ...PERSONAS.map((p, i) => ({ id: i + 1, name: p.name, key: p.key, color: p.color, cash: settings.budget })),
  ];
}

function togglePause() {
  if (!inMatch()) return;
  const on = !pauseReasons.has('user');
  setPaused('user', on);
  if (on) $('#btn-resume').focus();
  else $('#btn-pause').focus({ preventScroll: true });
}

function doBid(inc) {
  audio.unlock();
  if (isPaused() || engine.phase !== PHASE.BIDDING) return;
  if (!engine.humanBid(inc)) {
    audio.denied();
    const note = $('#action-note');
    note.classList.remove('nudge');
    void note.offsetWidth;
    note.classList.add('nudge');
  }
}

function doPass() {
  audio.unlock();
  if (isPaused() || engine.phase !== PHASE.BIDDING) return;
  if (!engine.humanPass()) audio.denied();
}

// ---------- engine events ----------
function wireEngine() {
  const name = (id) => (id === HUMAN_ID ? 'YOU' : engine.contenders[id].name);
  const syncCash = () => { for (const c of engine.contenders) S.setCash(c.id, c.cash); };

  engine.on('matchStart', () => {
    S.setContenders(engine.contenders.map((c) => ({ id: c.id, name: c.name, key: c.persona ? c.persona.key : 'you', color: COLORS[c.id], cash: c.cash })));
    S.setTheme(settings.theme);
    hud.buildMatch(engine);
    setScreen('game');
  });

  engine.on('categoryIntro', ({ cat, catIndex }) => {
    setScreen('game');
    S.clearLot();
    S.setPrice(0);
    S.setCallStage(0);
    setCam('wide');
    hud.sync(engine);
    hud.bigCall(cat.name, 'round');
    hud.call(`Round ${catIndex + 1} of ${engine.categories.length}: ${cat.name}. ${cat.blurb}`);
    audio.whoosh();
    audio.setTension(0);
  });

  engine.on('lotIntro', ({ lot }) => {
    const mystery = lot.kind === 'mystery';
    S.showLot(lot.item, { mystery });
    S.setPrice(0);
    S.setCallStage(0);
    setCam('pedestal');
    document.body.dataset.tension = '0';
    hud.sync(engine);
    if (mystery) {
      hud.bigCall('Mystery Crate', 'crate');
      hud.call(`Surprise lot. A sealed crate. The only clue: ${lot.clue}`);
      audio.riser(1.4);
    } else {
      hud.call(`Lot ${lot.lotIndex + 1} of ${lot.lotsInCat}: ${lot.item.name}. ${lot.item.commentaryLine}`);
      audio.whoosh();
    }
    lastTickClock = 99;
  });

  engine.on('biddingOpen', () => {
    setCam('bid');
    hud.sync(engine);
  });

  engine.on('bid', ({ by, amount, inc }) => {
    S.bid(by, amount);
    S.setCallStage(0);
    audio.knock(inc === 2 ? 1.2 : 1);
    audio.arp(amount);
    audio.setTension(Math.min(0.5, amount / 20));
    document.body.dataset.tension = '0';
    setCam('bid');
    hud.sync(engine);
    hud.flashBid();
    hud.call(`${inc === 2 ? 'Power jump! ' : ''}$${amount} from ${by === HUMAN_ID ? 'you' : name(by)}.`);
    lastTickClock = 99;
  });

  engine.on('pass', ({ by }) => {
    S.react(by, 'shake');
    audio.pass();
    hud.sync(engine);
    if (by === HUMAN_ID) hud.call('You drop out of this lot.');
  });

  engine.on('call', ({ stage: st, hasBid }) => {
    S.setCallStage(st);
    document.body.dataset.tension = String(st);
    audio.heartbeat();
    audio.setTension(0.4 + st * 0.2);
    if (st >= 2) setCam('pedestal');
    const text = hasBid
      ? [`Going once at $${engine.currentBid}…`, `Going twice at $${engine.currentBid}…`, 'Last call…'][st - 1]
      : ['Any bids? It opens at one dollar.', 'No takers?', 'Last chance…'][st - 1];
    hud.call(text);
  });

  engine.on('sold', ({ lot, winner, price, uncontested }) => {
    S.setCallStage(0);
    S.setPrice(price);
    S.sold(winner);
    syncCash();
    setCam('gavel');
    camReturn = 1.25;
    audio.slam();
    setTimeout(() => audio.register(), 240);
    audio.setTension(0);
    document.body.dataset.tension = '0';
    hud.sync(engine);
    hud.bigCall(uncontested ? 'Uncontested' : 'Sold!', 'sold');
    const what = lot.kind === 'mystery' ? 'The crate' : lot.item.name;
    hud.call(uncontested
      ? `${what} goes uncontested to ${winner === HUMAN_ID ? 'you' : name(winner)} for $1.`
      : `Sold! ${what} to ${winner === HUMAN_ID ? 'you' : name(winner)} for $${price}.`);
  });

  engine.on('nosale', ({ lot }) => {
    S.setCallStage(0);
    S.noSale();
    audio.denied();
    audio.setTension(0);
    document.body.dataset.tension = '0';
    hud.sync(engine);
    hud.bigCall('No sale', 'nosale');
    hud.call(`No sale. ${lot.kind === 'mystery' ? 'The crate goes back to the vault' : lot.item.name + ' is withdrawn'}.`);
  });

  engine.on('mysteryOpen', () => {
    S.crateShake(true);
    setCam('pedestal');
    audio.riser(RULES.revealTime - RULES.revealAt);
    hud.call('Crowbar, please. Opening the crate…');
  });

  engine.on('mysteryReveal', ({ item, winner, jackpot, cursed }) => {
    S.crateShake(false);
    S.crateBurst(item, jackpot);
    if (jackpot) audio.fanfare(); else if (cursed) audio.trombone(); else audio.register();
    hud.sync(engine);
    hud.bigCall(jackpot ? 'Jackpot!' : cursed ? 'Cursed!' : 'Fair enough', jackpot ? 'sold' : 'nosale');
    hud.call(`${winner === HUMAN_ID ? 'You open' : name(winner) + ' opens'} it: ${item.name}. ${item.commentaryLine}`);
  });

  engine.on('dud', ({ who, item }) => {
    hud.sync(engine);
    hud.call(`${who === HUMAN_ID ? 'You are' : name(who) + ' is'} handed a Penalty Dud: ${item.name}. ${item.commentaryLine}`);
    if (who === HUMAN_ID) audio.trombone();
  });

  engine.on('banter', ({ who, name: n, text }) => {
    hud.banter({ name: n, text, color: COLORS[who] });
    S.react(who, 'nod');
  });

  engine.on('mood', ({ who, mood }) => {
    S.setMood(who, mood);
    if (engine.contenders.length) hud.sync(engine);
  });

  engine.on('vaultOpen', () => {
    setScreen('endgame');
    S.clearLot();
    S.setPrice(0);
    S.setSign('LOCK');
    setCam('heist');
    audio.whoosh();
    audio.setTension(0.3);
    hud.sync(engine);
    hud.renderBoard(engine);
    hud.call(`The vault is open. $${RULES.vaultCost} locks a lot. Anything left unlocked is fair game.`);
    $('#board').querySelector('.scroll-x').scrollTop = 0;
  });

  engine.on('vaultLock', ({ who, entry }) => {
    audio.vaultLock();
    S.vaultFlash(who);
    syncCash();
    hud.sync(engine);
    hud.renderBoard(engine);
    hud.call(`${who === HUMAN_ID ? 'You lock' : name(who) + ' locks'} ${entry.item.name} in the vault.`);
  });

  engine.on('heistOpen', () => {
    audio.alarm();
    audio.setTension(0.9);
    S.setSign('HEIST', true);
    document.body.dataset.tension = '2';
    hud.sync(engine);
    hud.renderBoard(engine);
    hud.bigCall('The Heist', 'crate');
    hud.call('The heist is on. Ten seconds. One steal each.');
  });

  engine.on('heist', ({ thief, victim, taken, cost }) => {
    audio.alarm();
    setTimeout(() => audio.register(), 380);
    S.heistFlash(thief, victim);
    syncCash();
    hud.sync(engine);
    hud.renderBoard(engine);
    hud.bigCall('Heist!', 'sold');
    hud.call(`${thief === HUMAN_ID ? 'You steal' : name(thief) + ' steals'} ${taken.item.name} from ${victim === HUMAN_ID ? 'you' : name(victim)} for $${cost}.`);
  });

  engine.on('heistClosed', () => {
    document.body.dataset.tension = '0';
    audio.setTension(0);
    hud.sync(engine);
    hud.renderBoard(engine);
    hud.call('Hands off. The lineups are final. To the jury.');
  });

  engine.on('verdict', (results) => {
    setScreen('verdict');
    setCam('wide');
    S.setSign('JURY');
    hud.sync(engine);
    verdict.total = hud.renderVerdict(results, engine);
    verdict.step = 0;
    verdict.timer = 0.7;
    verdict.active = true;
    verdict.done = false;
    $('#btn-verdict-skip').hidden = false;
    hud.call('The grand jury opens the sealed values.');
    $('#verdict').querySelector('.scroll-x').scrollTop = 0;
  });
}

function finishVerdict() {
  if (verdict.done) return;
  const results = engine.results;
  for (let i = verdict.step; i < verdict.total; i++) hud.revealStep(i, true);
  verdict.step = verdict.total;
  verdict.active = false;
  verdict.done = true;
  $('#btn-verdict-skip').hidden = true;
  hud.showWinner(results);
  S.showdown(results.ranking);
  hud.setCamLabel(CAM_LABELS.podium);
  const rank = results.players[HUMAN_ID].rank;
  if (rank === 1) audio.fanfare(); else if (rank === 4) audio.trombone(); else audio.register();
  hud.call(rank === 1 ? 'The winner of tonight\'s draft: you.' : `The winner of tonight's draft: ${results.players[results.winner].name}.`);
  refreshAir();
  if (!debug.auto) $('#btn-again').focus({ preventScroll: true });
}

function copyScorecard() {
  const text = hud.scorecard(engine.results, engine);
  const done = () => hud.toast('Scorecard copied. Paste it anywhere.');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (ok) done(); else hud.toast('Could not reach the clipboard. Select the text and copy it by hand.');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

// ---------- input ----------
function wireInput(guide, drawer) {
  $('#btn-start').addEventListener('click', startMatch);
  $('#btn-how').addEventListener('click', () => drawer.open());
  $('#btn-help').addEventListener('click', () => drawer.toggle());
  $('#btn-bid1').addEventListener('click', () => doBid(1));
  $('#btn-bid2').addEventListener('click', () => doBid(2));
  $('#btn-pass').addEventListener('click', doPass);
  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-resume').addEventListener('click', togglePause);
  $('#btn-quit').addEventListener('click', quitToTitle);
  $('#btn-mute').addEventListener('click', toggleMute);
  $('#btn-ff').addEventListener('click', toggleFF);
  $('#btn-board-done').addEventListener('click', () => { audio.blip(); engine.skip(); });
  $('#btn-verdict-skip').addEventListener('click', finishVerdict);
  $('#btn-again').addEventListener('click', startMatch);
  $('#btn-title').addEventListener('click', quitToTitle);
  $('#btn-copy').addEventListener('click', copyScorecard);
  $('#btn-theme').addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', settings.theme);
    applyTheme();
  });
  $('#vol').addEventListener('input', (e) => {
    audio.unlock();
    settings.volume = Number(e.target.value) / 100;
    if (settings.muted && settings.volume > 0) settings.muted = false;
    store.set('volume', settings.volume);
    store.set('muted', settings.muted);
    applySound();
  });
  for (const r of document.querySelectorAll('input[name="budget"]')) {
    r.addEventListener('change', () => {
      settings.budget = Number(r.value) === 50 ? 50 : 20;
      store.set('budget', settings.budget);
      applyModes();
      S.setContenders(defaultUnits());
    });
  }
  $('#allin').addEventListener('change', (e) => {
    settings.allIn = e.target.checked;
    store.set('allIn', settings.allIn);
  });

  hud.onBoardAction = (act, owner, itemId) => {
    audio.unlock();
    if (isPaused()) return;
    const ok = act === 'vault' ? engine.humanVault(itemId) : engine.humanHeist(owner, itemId);
    if (!ok) audio.denied();
  };

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    const k = e.key;
    if (k === '?') { e.preventDefault(); drawer.toggle(); return; }
    if (drawer.isOpen || guide.active) return;
    if (k === 'Escape') { if (inMatch()) { e.preventDefault(); togglePause(); } return; }
    if (pauseReasons.has('user')) return;
    if (k === 'm' || k === 'M') { toggleMute(); return; }
    if (k === 'f' || k === 'F') { toggleFF(); return; }
    const onControl = tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || tag === 'SELECT';
    const onAction = !!(t && t.closest && t.closest('#actions'));
    if (screen === 'title') {
      if (k === 'Enter' && !onControl) { e.preventDefault(); startMatch(); }
      return;
    }
    if (screen === 'game') {
      if (k === ' ' || k === 'b' || k === 'B') {
        if (k === ' ' && onControl && !onAction) return;
        e.preventDefault();
        if (!e.repeat) doBid(1);
      } else if (k === 'j' || k === 'J') { e.preventDefault(); if (!e.repeat) doBid(2); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); if (!e.repeat) doPass(); }
      else if (k === 'Enter' && (!onControl || onAction)) { e.preventDefault(); if (!e.repeat) engine.skip(); }
      return;
    }
    if (screen === 'endgame') {
      if (k === 'Enter' && !onControl) { e.preventDefault(); engine.skip(); }
      return;
    }
    if (screen === 'verdict' && k === 'Enter' && !onControl) {
      e.preventDefault();
      if (verdict.done) startMatch(); else finishVerdict();
    }
  });

  document.addEventListener('visibilitychange', () => {
    setPaused('hidden', document.hidden && inMatch());
    last = performance.now();
  });
  // Browsers only allow audio after a gesture.
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
}

// ---------- frame loop ----------
function matchSpeed() {
  let s = debug.speed;
  if (settings.ff && [PHASE.LOT_INTRO, PHASE.BIDDING, PHASE.SOLD].includes(engine.phase) && engine.humanState().spectating) s *= 2.5;
  return s;
}

function tickClockSounds() {
  if (engine.phase !== PHASE.BIDDING) return;
  const c = engine.clock;
  if (c > lastTickClock) lastTickClock = c;
  if (c > 3) { lastTickClock = Math.min(lastTickClock, 3.001); return; }
  const interval = c > 2 ? 0.5 : c > 1 ? 0.33 : 0.2;
  if (lastTickClock - c >= interval) {
    lastTickClock = c;
    audio.tick(c <= 1);
  }
}

function autopilot() {
  if (engine.phase === PHASE.BIDDING) {
    const hs = engine.humanState();
    if (hs.canBid1 && engine.currentBid < 3 && Math.random() < 0.04) engine.humanBid(1);
  } else if ((engine.phase === PHASE.VAULT || engine.phase === PHASE.HEIST) && engine.phaseClock > 1) {
    engine.skip();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  seconds += dt;

  if (inMatch() && !isPaused()) {
    const speed = matchSpeed();
    acc += dt * speed;
    let n = 0;
    while (acc >= STEP && n < 90) {
      if (debug.auto) autopilot();
      engine.update(STEP);
      tickClockSounds();
      acc -= STEP;
      n++;
    }
    if (n === 90) acc = 0;
    if (camReturn > 0) {
      camReturn -= dt * speed;
      if (camReturn <= 0 && engine.phase === PHASE.SOLD) setCam('wide');
    }
    if (verdict.active) {
      verdict.timer -= dt * debug.speed;
      if (verdict.timer <= 0) {
        if (verdict.step < verdict.total) {
          hud.revealStep(verdict.step);
          audio.countUp(verdict.step);
          verdict.step++;
          verdict.timer = verdict.step === verdict.total ? 1.3 : 1.0;
        } else {
          finishVerdict();
        }
      }
    }
  }

  heroAttract(dt);
  hud.frame(engine, seconds);
  logo.speed = screen === 'title' ? 1 : 0;
  logo.tick(reduceMotion.matches ? 0 : dt);
  if (stage) {
    try {
      stage.update(dt, reduceMotion.matches);
      stage.render();
    } catch (err) {
      console.error('[bidlock] the studio feed stopped:', err);
      stage = null;
      showNoSignal('The studio feed stopped. The auction carries on at the desk.');
    }
  }
}

function showNoSignal(text) {
  document.body.classList.add('no-stage');
  $('#standby-title').textContent = 'NO SIGNAL';
  $('#standby-text').textContent = text;
  $('#title-note').textContent = text;
}

// ---------- boot ----------
let logo;

async function boot() {
  const logoCanvas = $('#logo');
  logoCanvas.style.width = '100%';
  logo = new EggcrateDisplay(logoCanvas, { cols: 7, cell: 8, align: 'center', marquee: true, label: 'BidLock' });
  logo.set('BIDLOCK');

  const guide = new Guide({
    getScreen: () => screen,
    ensureScreen: async (want) => {
      if (want === 'game' && screen === 'title') {
        startMatch();
        // Run the opening up to the first live lot so every control has something to show.
        for (let i = 0; i < 2000 && engine.phase !== PHASE.BIDDING; i++) engine.update(1 / 30);
        acc = 0;
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    onOpen: () => setPaused('guide', true),
    onClose: () => {
      setPaused('guide', false);
      if (screen === 'game') hud.toast('You are on air. Good luck.');
    },
  });
  const drawer = new HelpDrawer({
    onOpen: () => setPaused('drawer', true),
    onClose: () => setPaused('drawer', false),
    onTour: (mode) => guide.start(mode),
  });

  applyTheme();
  applySound();
  $('#btn-ff').setAttribute('aria-pressed', String(settings.ff));
  buildHero();
  wireEngine();
  wireInput(guide, drawer);

  try {
    const mod = await import('./render/stage3d.js');
    stage = new mod.Stage3D($('#stage'));
    stage.onContextLost = () => showNoSignal('The graphics context was lost. The auction carries on at the desk.');
  } catch (err) {
    console.warn('[bidlock] 3D studio unavailable:', err);
    stage = null;
    showNoSignal('No 3D feed here (WebGL or the Three.js CDN is blocked). The auction still runs at the desk.');
  }

  S.setContenders(defaultUnits());
  applyTheme();
  applyModes();
  setScreen('title');
  setCam('title');
  showHero(0);
  hero.touched = -99;
  requestAnimationFrame((t) => { last = t; frame(t); });
  if (params.get('guide') !== 'off' && !debug.auto) guide.maybeInvite();

  window.__bidlock = { engine, settings, guide, drawer, get stage() { return stage; }, get screen() { return screen; }, startMatch, finishVerdict };
}

boot().catch((err) => {
  console.error('[bidlock] failed to start:', err);
  document.body.dataset.screen = 'boot';
  const t = $('#standby-title');
  const s = $('#standby-text');
  if (t) t.textContent = 'TECHNICAL FAULT';
  if (s) s.textContent = 'BidLock could not start. Reload the page to try again.';
});
