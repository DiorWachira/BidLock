// BIDLOCK 2.0 — orchestrator. Owns the screen state machine, the fixed-timestep loop,
// input, and the wiring between the rules engine, the 3D stage, the sound engine, the
// HUD, the photo loader and the multiplayer room.
//
// Three roles share this file:
//   solo    one person and the house rivals; this browser runs the engine.
//   host    a room; this browser runs the engine and broadcasts every event.
//   client  a room; this browser holds a mirror, rebuilt from the host's snapshots,
//           and sends its inputs to the host.
// Engine events drive the HUD, stage and sound the same way in all three.

import { AuctionEngine, PHASE, RULES, soloSeats } from './engine/auctionEngine.js';
import { PERSONAS } from './engine/aiBidders.js';
import { CATEGORIES, MYSTERY_CATEGORY, CRATE_CLUES, SYNERGY_TAGS, hypeLamps } from './data/categories.js';
import { SoundEngine } from './audio/soundEngine.js';
import { EggcrateDisplay } from './ui/eggcrate.js';
import { Hud, esc } from './ui/hud.js';
import { Guide, HelpDrawer } from './ui/guide.js';
import { LobbyView } from './ui/lobbyView.js';
import { MediaLoader } from './utils/mediaLoader.js';
import { LobbyManager, WIRE, wireType, packEvent, unpackEvent, EMOTES } from './net/lobbyManager.js';
import { roomServerUrl } from './net/roomServer.js';
import { GAMES, gameById } from './arcade/games.js';
import { botSeats } from './arcade/bots.js';
import { GENRE_CHOICES, genreById, LEVELS, levelById } from './games/sampleArena/itunesLoader.js';

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
  oracle: params.get('oracle') === '1' ? 1 : params.get('oracle') === '0' ? 0 : null,
  oracleSeat: params.has('oracleseat') ? Number(params.get('oracleseat')) | 0 : null,
  triviaLocal: params.get('trivia') === 'local',
  mediaOff: params.get('media') === 'off',
  netLocal: params.get('net') === 'local',
  // ?net=relay: the room server only; ?net=peer: direct WebRTC only. Default: both.
  net: ['relay', 'peer'].includes(params.get('net')) ? params.get('net') : 'auto',
  lag: Math.max(0, Math.min(2000, Number(params.get('lag')) || 0)), // ms of simulated delay on ?net=local
  musicOffline: params.get('music') === 'offline',
};

const settings = {
  budget: store.get('budget', 20) === 50 ? 50 : 20,
  allIn: !!store.get('allIn', false),
  marathon: !!store.get('marathon', false),
  game: gameById(store.get('game', 'bidlock')).id,
  genre: genreById(store.get('genre', 'all')).id,
  level: levelById(store.get('scLevel', 'normal')).id,
  volume: Math.max(0, Math.min(1, Number(store.get('volume', 0.7)) || 0)),
  muted: !!store.get('muted', false),
  theme: store.get('theme', 'dark') === 'light' ? 'light' : 'dark',
  ff: store.get('ff', true) !== false,
};

const HUMAN_COLORS = ['#f3ead6', '#e89b4c', '#6ea3d8', '#8fd08a', '#c58be0', '#e6d24a'];
// Bots in the quiz games take these, after the people have taken theirs.
const BOT_COLORS = ['#c0392b', '#2e86ab', '#8e6c8a', '#5c946e', '#d17a22', '#7f8c8d', '#b5838d', '#3d5a80', '#9a8c3a', '#6d4c41', '#4a8f8f', '#a33b6b'];
const CAM_LABELS = { title: 'CAM 1 · WIDE', wide: 'CAM 1 · WIDE', bid: 'CAM 2 · FLOOR', pedestal: 'CAM 3 · PEDESTAL', gavel: 'CAM 4 · GAVEL', heist: 'CAM 5 · OVERHEAD', podium: 'CAM 6 · PODIUM', focus: 'CAM 7 · CONTENDER' };
const STEP = 1 / 60;

// One colour per seat: people take the six seat colours in order, rivals keep their own.
function colorsFor(seats) {
  let k = 0;
  return seats.map((s) => {
    if (s.kind === 'ai') return (PERSONAS.find((p) => p.key === s.persona) || PERSONAS[0]).color;
    return HUMAN_COLORS[k++ % HUMAN_COLORS.length];
  });
}

// Seat colours for the quiz games: people first, then bots.
function arcadeColors(seats) {
  let h = 0;
  let b = 0;
  return seats.map((s) => (s.kind === 'ai' ? BOT_COLORS[b++ % BOT_COLORS.length] : HUMAN_COLORS[h++ % HUMAN_COLORS.length]));
}

const media = new MediaLoader(debug.mediaOff ? { fetchImpl: async () => { throw new Error('media switched off'); } } : {});
const engine = new AuctionEngine();
const audio = new SoundEngine();
const hud = new Hud({ media });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let stage = null;
let screen = 'boot';
let role = 'solo';
let mySeat = 0;
let colors = HUMAN_COLORS.slice(0, 1).concat(PERSONAS.map((p) => p.color));
const pauseReasons = new Set();
let seconds = 0;
let acc = 0;
let lastStep = performance.now();
let lastFrame = performance.now();
let lastTickClock = 99;
let camReturn = 0;
let tickAcc = 0;
let oracleBeat = 0;
let lobbyView = null;
// The quiz game that is running, if any (BidLock itself runs through the code above).
let arcade = null;
let arcadeLoading = false;
let arcadeQueue = [];
const gameModules = {};
let autoDone = '';
const verdict = { active: false, step: 0, total: 0, timer: 0, done: false };
const heroCats = [...CATEGORIES, MYSTERY_CATEGORY];
const hero = { cat: 0, idx: new Array(heroCats.length).fill(0), auto: 0, touched: -99, item: null, px: -1, py: -1 };

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
const who = (id, cap = false) => hud.who(engine, id, cap);

function refreshAir() {
  hud.setOnAir(isPaused() ? 'STANDBY' : inMatch() && engine.phase !== PHASE.VERDICT ? 'ON AIR' : 'OFF AIR');
}

// Only a solo match can be held. A live room keeps running whatever one player opens.
function setPaused(reason, on) {
  if (on && role !== 'solo') return;
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

function setRole(next) {
  role = next;
  document.body.dataset.room = next;
  hud.solo = next === 'solo';
  hud.setEmotes(EMOTES, next !== 'solo');
  if (next !== 'solo') {
    pauseReasons.clear();
    $('#pause').hidden = true;
  }
  $('#btn-pause').disabled = next !== 'solo';
  $('#btn-ff').disabled = next !== 'solo';
  $('#btn-again').hidden = next === 'client';
  $('#btn-title .b-label').textContent = next === 'host' ? 'BACK TO LOBBY' : next === 'client' ? 'LEAVE ROOM' : 'BACK TO TITLE';
  $('#btn-quit .b-label').textContent = 'QUIT TO TITLE';
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
  if (role !== 'solo') { hud.toast('Fast-forward is for solo matches. A room runs on one clock.'); return; }
  settings.ff = !settings.ff;
  store.set('ff', settings.ff);
  $('#btn-ff').setAttribute('aria-pressed', String(settings.ff));
  hud.toast(settings.ff ? 'Fast-forward on: lots you are out of run at speed.' : 'Fast-forward off.');
}

function applyModes() {
  for (const r of document.querySelectorAll('input[name="budget"]')) r.checked = Number(r.value) === settings.budget;
  $('#allin').checked = settings.allIn;
  $('#marathon').checked = settings.marathon;
  const strapBudget = $('#strap-budget');
  if (strapBudget) strapBudget.textContent = String(settings.budget);
  if (settings.game === 'bidlock') document.title = `BidLock — The $${settings.budget} Draft`;
  S.setSign(`$${settings.budget}`);
  if (lobbyView) lobbyView.render(lobby.state);
}

function modeSummary() {
  const g = gameById(lobby.state.game);
  if (g.id === 'soundclash') return `${g.name}: crate ${genreById(lobby.state.genre || settings.genre).name}, ${levelById(lobby.state.level || settings.level).name.toLowerCase()}. With bots on, the table fills to ${g.fillTo}.`;
  if (g.id !== 'bidlock') return `${g.name}: ${g.kind.toLowerCase()}. With bots on, the table fills to ${g.fillTo}.`;
  return `$${settings.budget} bankroll · ${settings.marathon ? 'Marathon, 8 rounds' : '6 rounds'}${settings.allIn ? ' · All-In for every player' : ''}. Change these on the title screen.`;
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
  // Only a pointer that actually moved counts as a hover. If the layout shifts under a
  // still pointer, the lot on the pedestal should not change by itself.
  wrap.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.cat');
    if (!b || e.pointerType !== 'mouse') return;
    if (e.clientX === hero.px && e.clientY === hero.py) return;
    hero.px = e.clientX;
    hero.py = e.clientY;
    pick(Number(b.dataset.cat), false);
  });
  const track = (e) => { hero.px = e.clientX; hero.py = e.clientY; };
  wrap.addEventListener('pointermove', track);
  wrap.addEventListener('pointerdown', track);
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

function heroPhoto() {
  const item = hero.item;
  if (!item) return;
  const sealed = heroCats[hero.cat] === MYSTERY_CATEGORY;
  const img = $('#hero-img');
  img.src = media.src(item, { sealed });
  img.alt = sealed ? 'A sealed wooden crate' : item.name;
  if (sealed) img.removeAttribute('data-media'); else img.dataset.media = item.id;
  $('#hero-credit').innerHTML = hud.credit(item, sealed);
}

function showHero(catIndex) {
  hero.cat = catIndex;
  const cat = heroCats[catIndex];
  const mystery = cat === MYSTERY_CATEGORY;
  const item = cat.items[hero.idx[catIndex]];
  hero.item = item;
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
    media.prefetch([item]);
  }
  heroPhoto();
  S.showLot(item, { mystery });
  S.setPrice(mystery ? 0 : Math.max(1, Math.round(item.baseAppeal / 10)));
  S.setSign(`$${settings.budget}`);
}

function heroAttract(dt) {
  if (screen !== 'title' || isPaused() || (lobbyView && lobbyView.isOpen) || settings.game !== 'bidlock') return;
  hero.auto += dt;
  if (hero.auto < 4.6 || seconds - hero.touched < 9) return;
  hero.auto = 0;
  const i = (hero.cat + 1) % heroCats.length;
  hero.idx[i] = (hero.idx[i] + 1) % heroCats[i].items.length;
  showHero(i);
}

// ---------- the room ----------
const lobby = new LobbyManager({
  transport: debug.netLocal ? 'local' : debug.net,
  relayUrl: roomServerUrl(),
  lag: debug.lag,
  onState: (state) => {
    // A new room starts with this device's Soundclash crate.
    if (state.role === 'host' && state.status === 'open' && !state.genre) { lobby.setGenre(settings.genre); return; }
    if (state.role === 'host' && state.status === 'open' && !state.level) { lobby.setLevel(settings.level); return; }
    if (lobbyView) lobbyView.render(state);
    const chip = $('#roomchip');
    const open = state.status === 'open' && state.role != null;
    chip.hidden = !open;
    if (open) renderRoomChip();
  },
  onMessage: (msg) => fromHost(msg),
  onInput: (seat, msg) => fromPlayer(seat, msg),
  onClosed: () => {
    stopArcade();
    engine.abort();
    audio.stopMusic();
    setRole('solo');
    if (lobbyView) lobbyView.close();
    $('#lost').hidden = false;
    $('#btn-lost').focus();
  },
});

// What the local player does. A client sends it to the host; everyone else acts directly.
const act = {
  bid(inc) { if (role === 'client') { lobby.send({ t: WIRE.PLACE_BID, inc }); return true; } return engine.bidFor(engine.localId, inc); },
  pass() { if (role === 'client') { lobby.send({ t: WIRE.PASS }); return true; } return engine.passFor(engine.localId); },
  vault(itemId) { if (role === 'client') { lobby.send({ t: WIRE.VAULT_LOCK, item: itemId }); return true; } return engine.vaultFor(engine.localId, itemId); },
  heist(victim, itemId) { if (role === 'client') { lobby.send({ t: WIRE.STEAL_TARGET, mode: 'heist', victim, item: itemId }); return true; } return engine.heistFor(engine.localId, victim, itemId); },
  done() { if (role === 'client') { lobby.send({ t: WIRE.DONE }); return true; } return engine.doneFor(engine.localId); },
  answer(index) { if (role === 'client') { lobby.send({ t: WIRE.SUBMIT_TRIVIA_ANSWER, index }); return true; } return engine.oracle.answer(engine.localId, index); },
  pick(victim, itemId) { if (role === 'client') { lobby.send({ t: WIRE.STEAL_TARGET, mode: 'oracle', victim, item: itemId }); return true; } return engine.oracle.pick(engine.localId, victim, itemId); },
  gamble(risk) { if (role === 'client') { lobby.send({ t: WIRE.DOUBLE_OR_NOTHING_CHOICE, risk: !!risk }); return true; } return engine.oracle.gamble(engine.localId, !!risk); },
  emote(k) { if (role === 'client') lobby.send({ t: WIRE.EMOTE, k }); else if (EMOTES[k]) engine.say(engine.localId, EMOTES[k], 'emote'); },
};

// Host: an input from a player's seat. Everything is checked again by the engine.
function fromPlayer(seat, msg) {
  if (arcade && role === 'host') { arcade.fromPlayer(seat, msg); return; }
  if (role !== 'host' || !inMatch() || !engine.contenders[seat]) return;
  const int = (v) => (Number.isInteger(v) ? v : -1);
  switch (msg.t) {
    case WIRE.PLACE_BID: engine.bidFor(seat, msg.inc === 2 ? 2 : 1); break;
    case WIRE.PASS: engine.passFor(seat); break;
    case WIRE.VAULT_LOCK: engine.vaultFor(seat, String(msg.item)); break;
    case WIRE.STEAL_TARGET:
      if (msg.mode === 'oracle') engine.oracle.pick(seat, int(msg.victim), String(msg.item));
      else engine.heistFor(seat, int(msg.victim), String(msg.item));
      break;
    case WIRE.SUBMIT_TRIVIA_ANSWER: engine.oracle.answer(seat, int(msg.index)); break;
    case WIRE.DOUBLE_OR_NOTHING_CHOICE: engine.oracle.gamble(seat, !!msg.risk); break;
    case WIRE.DONE: engine.doneFor(seat); break;
    case WIRE.EMOTE: if (EMOTES[int(msg.k)]) engine.say(seat, EMOTES[msg.k], 'emote'); break;
    case WIRE.BYE: engine.setAway(seat, true); break;
    default: break;
  }
}

// The room chip in the top bar: the code, how many are in, and for a guest how quick
// the link to the host is. A slow link turns the chip amber.
function renderRoomChip() {
  const chip = $('#roomchip');
  const state = lobby.state;
  if (!chip || state.status !== 'open' || state.role == null) return;
  const n = state.players.filter((p) => !p.away).length;
  const ms = lobby.isClient ? (lobby.latencyMs(state.you) ?? (lobby.myRtt ? Math.round(lobby.myRtt * 1000) : null)) : null;
  // A player whose host has dropped out: the room holds everyone's places until they are back.
  const away = lobby.isClient && state.hostAway;
  chip.textContent = away ? `ROOM ${state.code} · HOST AWAY` : `ROOM ${state.code} · ${n}${ms ? ` · ${ms} ms` : ''}`;
  chip.dataset.slow = away || (ms != null && ms >= 250) ? '1' : '0';
  const via = state.via === 'relay' ? 'Connected through the BidLock room server.' : state.via === 'peer' ? 'Connected directly (peer to peer).' : '';
  chip.title = away ? 'The host has lost their connection. The room is keeping everyone’s places until they are back.'
    : `${ms ? `Round trip to the host: ${ms} ms. The host makes up for delays up to 300 ms each way. ` : ''}${via}`.trim();
}
setInterval(renderRoomChip, 2000);

// Client: something from the host.
function fromHost(msg) {
  if (msg.t === WIRE.START && msg.game && msg.game !== 'bidlock') {
    launchArcade(msg.game, 'client', null, Number.isInteger(msg.seat) ? msg.seat : 0);
    return;
  }
  if (msg.t === WIRE.GAME_EVENT || msg.t === WIRE.GAME_TICK) {
    if (msg.t === WIRE.GAME_EVENT && msg.ev === 'abort') { clientArcadeEnded(); return; }
    if (arcade) arcade.fromHost(msg);
    else if (arcadeLoading) arcadeQueue.push(msg);
    return;
  }
  // While a quiz game runs, BidLock's own messages do not apply.
  if (arcade || arcadeLoading) return;
  if (msg.t === WIRE.START) {
    stopArcade();
    mySeat = Number.isInteger(msg.seat) ? msg.seat : 0;
    setRole('client');
    if (lobbyView) lobbyView.close();
    audio.unlock();
    applySound();
    audio.startMusic();
    audio.setTension(0);
    verdict.active = false;
    verdict.done = false;
    hud.clearChyrons();
    return;
  }
  if (role !== 'client') return;
  if (msg.t === WIRE.TIMER_TICK) {
    if (engine.mirror && inMatch()) {
      // Each tick is one network delay old: correct for it, and ease small drifts in.
      const ow = lobby.oneWay;
      const ease = (cur, v) => { const target = Math.max(0, v - ow); return Math.abs(target - cur) > 0.35 ? target : cur + (target - cur) * 0.5; };
      engine.clock = ease(engine.clock, msg.ck);
      engine.phaseT = ease(engine.phaseT, msg.pt);
      engine.oracle.t = ease(engine.oracle.t, msg.ot);
    }
    return;
  }
  if (!msg.ev || !msg.s) return;
  engine.hydrate(msg.s, mySeat);
  {
    const ow = lobby.oneWay;
    if (ow > 0) {
      if (engine.clock > 0) engine.clock = Math.max(0, engine.clock - ow);
      if (engine.phaseT > 0) engine.phaseT = Math.max(0, engine.phaseT - ow);
    }
  }
  engine.emit(msg.ev, unpackEvent(engine, msg.ev, msg.d));
}

// ---------- match control ----------
function launch(seats) {
  audio.unlock();
  applySound();
  audio.startMusic();
  audio.setTension(0);
  verdict.active = false;
  verdict.done = false;
  acc = 0;
  tickAcc = 0;
  autoDone = '';
  hud.clearChyrons();
  const seed = debug.seed != null ? debug.seed : (Date.now() ^ (Math.random() * 0x7fffffff)) & 0x7fffffff;
  engine.startMatch({ budget: settings.budget, allIn: settings.allIn, marathon: settings.marathon, seed, seats, localId: 0, oracleChance: debug.oracle, oracleSeat: debug.oracleSeat });
  // Fresh questions if the trivia service is reachable; the built-in bank otherwise.
  if (!debug.triviaLocal) engine.trivia.load().catch(() => 0);
  $('#deck').focus({ preventScroll: true });
}

function startSolo() {
  if (lobby.active) lobby.leave();
  setRole('solo');
  if (settings.game !== 'bidlock') {
    const g = gameById(settings.game);
    const me = String(store.get('name', '') || 'YOU').toUpperCase().slice(0, 14);
    launchArcade(g.id, 'solo', [{ name: me, kind: 'human' }, ...botSeats(g.fillTo - 1, [me])]);
    return;
  }
  stopArcade();
  launch(soloSeats());
}

function startRoom() {
  if (!lobby.canStart()) return;
  const game = lobby.state.game;
  const seats = lobby.beginMatch();
  setRole('host');
  if (lobbyView) lobbyView.close();
  if (game !== 'bidlock') { launchArcade(game, 'host', seats); return; }
  stopArcade();
  launch(seats);
}

// ---------- the quiz games ----------
// What a quiz game is given to work with.
const shell = {
  get root() { return $('#arcade'); },
  audio,
  store,
  debug,
  colors: (seats) => arcadeColors(seats),
  broadcast: (m) => lobby.broadcast(m),
  send: (m) => lobby.send(m),
  toast: (t) => hud.toast(t),
  again: () => arcadeAgain(),
  exit: () => arcadeExit(),
  // The link: how late a seat's inputs arrive (host), how stale the host's news is (guest).
  lagFor: (seat) => lobby.lagFor(seat),
  oneWay: () => lobby.oneWay,
  // Soundclash's crate: the room's in a room, this device's otherwise.
  genre: () => (role === 'host' && lobby.state.genre ? lobby.state.genre : settings.genre),
  level: () => (role === 'host' && lobby.state.level ? lobby.state.level : settings.level),
};

async function loadGame(id) {
  if (!gameModules[id]) {
    gameModules[id] = id === 'royale'
      ? import('./games/trapdoorRoyale/royaleGame.js').then((m) => m.RoyaleGame)
      : id === 'soundclash'
        ? import('./games/sampleArena/sampleArenaGame.js').then((m) => m.SampleArenaGame)
        : import('./games/lastLamp/lampGame.js').then((m) => m.LampGame);
  }
  return gameModules[id];
}

async function launchArcade(id, arcRole, seats, seat = 0) {
  stopArcade();
  // Only stop a BidLock match that is actually running: on a host, an abort is
  // broadcast, and guests would take it as the end of the new game too.
  if (inMatch()) engine.abort();
  if (lobbyView) lobbyView.close();
  setRole(arcRole);
  setScreen('arcade');
  document.body.dataset.game = id;
  hud.clearChyrons();
  audio.unlock();
  applySound();
  audio.stopMusic();
  if (id === 'royale') audio.startMusic();
  audio.setTension(0);
  arcadeLoading = true;
  arcadeQueue = [];
  let Game;
  try {
    Game = await loadGame(id);
  } catch (err) {
    console.error('[arcade] could not load the game:', err);
    arcadeLoading = false;
    hud.toast('That game could not be loaded. Check your connection and try again.');
    arcadeExit();
    return;
  }
  if (!arcadeLoading) return; // left while it was loading
  arcadeLoading = false;
  arcade = new Game(shell);
  const seed = debug.seed != null ? debug.seed : (Date.now() ^ (Math.random() * 0x7fffffff)) & 0x7fffffff;
  arcade.begin({ role: arcRole, seats, localSeat: seat, seed });
  for (const m of arcadeQueue) arcade.fromHost(m);
  arcadeQueue = [];
  lastStep = performance.now();
}

function stopArcade() {
  arcadeLoading = false;
  arcadeQueue = [];
  if (arcade) {
    try { arcade.stop(); } catch (err) { console.warn('[arcade] stop failed:', err); }
    arcade = null;
  }
  delete document.body.dataset.game;
  audio.ambience(false);
}

// Solo: back to the title. Host: the room returns to the lobby. Guest: leave the room.
function arcadeExit() {
  const was = role;
  if (arcade && was === 'host') arcade.engine.abort(); // reaches every guest
  if (was === 'host') lobby.endMatch();
  if (was === 'client') lobby.leave();
  stopArcade();
  setRole('solo');
  toTitle();
  if (was === 'host' && lobbyView) lobbyView.open();
  else $('#btn-start').focus({ preventScroll: true });
}

function arcadeAgain() {
  if (role === 'client') return;
  if (role === 'host') { lobby.endMatch(); startRoom(); return; }
  startSolo();
}

// Guest: the host ended the game; back to the lobby.
function clientArcadeEnded() {
  stopArcade();
  setRole('solo');
  toTitle();
  if (lobbyView && lobby.active) lobbyView.open();
}

// ---------- the title-screen channel guide ----------
function buildChannels() {
  const wrap = $('#channels');
  wrap.innerHTML = GAMES.map((g) => `<button type="button" class="channel" role="radio" data-game="${g.id}" aria-checked="false"><span class="ch-slot">${esc(g.slot)}</span><span class="ch-name">${esc(g.name)}</span><span class="ch-kind">${esc(g.kind)}</span></button>`).join('');
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.channel');
    if (!b) return;
    audio.unlock();
    audio.blip();
    selectGame(b.dataset.game);
  });
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const ids = GAMES.map((g) => g.id);
    const i = ids.indexOf(settings.game);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    selectGame(ids[(i + d + ids.length) % ids.length]);
    wrap.querySelector(`[data-game="${settings.game}"]`).focus();
  });
  const drawerGames = $('#drawer-games');
  if (drawerGames) drawerGames.innerHTML = GAMES.filter((g) => g.id !== 'bidlock').map((g) => `<div><dt>${esc(g.name)}</dt><dd>${esc(g.tagline)} ${g.how.map(esc).join(' ')}</dd></div>`).join('');
}

function buildCrates() {
  const wrap = $('#sc-crate-list');
  if (!wrap) return;
  wrap.innerHTML = GENRE_CHOICES.map((g) => `<button type="button" class="sc-crate" role="radio" data-genre="${g.id}" aria-checked="${g.id === settings.genre}" tabindex="${g.id === settings.genre ? 0 : -1}"><span>${esc(g.short)}</span><b>${esc(g.name)}</b></button>`).join('');
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.sc-crate');
    if (!b) return;
    audio.unlock();
    audio.blip();
    selectGenre(b.dataset.genre);
  });
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const ids = GENRE_CHOICES.map((g) => g.id);
    const i = ids.indexOf(settings.genre);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    selectGenre(ids[(i + d + ids.length) % ids.length]);
    wrap.querySelector(`[data-genre="${settings.genre}"]`).focus();
  });
}

function selectGenre(id) {
  settings.genre = genreById(id).id;
  store.set('genre', settings.genre);
  for (const b of document.querySelectorAll('#sc-crate-list .sc-crate')) {
    const on = b.dataset.genre === settings.genre;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  if (lobby.isHost) lobby.setGenre(settings.genre);
  if (lobbyView) lobbyView.render(lobby.state);
}

function buildLevels() {
  const wrap = $('#sc-level-list');
  if (!wrap) return;
  wrap.innerHTML = LEVELS.map((l) => `<button type="button" class="sc-level" role="radio" data-level="${l.id}" aria-checked="${l.id === settings.level}" tabindex="${l.id === settings.level ? 0 : -1}"><b>${esc(l.name)}</b><span>${esc(l.line)}</span></button>`).join('');
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.sc-level');
    if (!b) return;
    audio.unlock();
    audio.blip();
    selectLevel(b.dataset.level);
  });
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const ids = LEVELS.map((l) => l.id);
    const i = ids.indexOf(settings.level);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    selectLevel(ids[(i + d + ids.length) % ids.length]);
    wrap.querySelector(`[data-level="${settings.level}"]`).focus();
  });
}

function selectLevel(id) {
  settings.level = levelById(id).id;
  store.set('scLevel', settings.level);
  for (const b of document.querySelectorAll('#sc-level-list .sc-level')) {
    const on = b.dataset.level === settings.level;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  if (lobby.isHost) lobby.setLevel(settings.level);
  if (lobbyView) lobbyView.render(lobby.state);
}

function selectGame(id) {
  const g = gameById(id);
  settings.game = g.id;
  store.set('game', g.id);
  document.body.dataset.pick = g.id;
  for (const b of document.querySelectorAll('#channels .channel')) {
    const on = b.dataset.game === g.id;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $('#bidlock-opts').hidden = g.id !== 'bidlock';
  $('#soundclash-opts').hidden = g.id !== 'soundclash';
  $('#hero').hidden = g.id !== 'bidlock';
  $('#strap-text').innerHTML = g.id === 'bidlock' ? `The $<span id="strap-budget">${settings.budget}</span> Draft` : esc(g.strap);
  $('#title-tagline').textContent = g.tagline;
  const how = $('#title-how');
  how.hidden = g.id === 'bidlock';
  how.innerHTML = g.id === 'bidlock' ? '' : g.how.map((h) => `<li>${esc(h)}</li>`).join('');
  $('#title-slug').textContent = `CH 20 · ${g.slot} · ${g.kind.toUpperCase()} · ${g.people.toUpperCase()}`;
  if (logo) logo.set(g.marquee);
  if (g.id === 'bidlock') { if (screen === 'title') showHero(hero.cat); } else { S.clearLot(); S.setPrice(0); S.setSign('LIVE'); }
  document.title = g.id === 'bidlock' ? `BidLock — The $${settings.budget} Draft` : `${g.name} — BidLock Arcade`;
}

function startMatch() {
  if (role === 'host' && lobby.isHost) startRoom(); else if (role !== 'client') startSolo();
}

function toTitle() {
  audio.stopMusic();
  verdict.active = false;
  pauseReasons.delete('user');
  $('#pause').hidden = true;
  hud.clearChyrons();
  hud.hideOracle();
  S.setOracle(false);
  S.setContenders(defaultUnits(), 0);
  S.setCallStage(0);
  setScreen('title');
  setCam('title');
  hero.touched = -99;
  showHero(hero.cat);
  selectGame(settings.game);
}

// Solo: back to the title. Host: the room stays open and everyone returns to the lobby.
// Client: leave the room.
function quitToTitle() {
  const was = role;
  engine.abort(); // a host's abort reaches every client as a phase change
  if (was === 'host') lobby.endMatch();
  if (was === 'client') lobby.leave();
  setRole('solo');
  toTitle();
  if (was === 'host' && lobbyView) lobbyView.open();
  else $('#btn-start').focus({ preventScroll: true });
}

function defaultUnits() {
  return [
    { id: 0, name: 'YOU', key: 'you', color: HUMAN_COLORS[0], cash: settings.budget },
    ...PERSONAS.map((p, i) => ({ id: i + 1, name: p.name, key: p.key, color: p.color, cash: settings.budget })),
  ];
}

function togglePause() {
  if (!inMatch()) return;
  if (role !== 'solo') { hud.toast('No pausing a live room.'); return; }
  const on = !pauseReasons.has('user');
  setPaused('user', on);
  if (on) $('#btn-resume').focus();
  else $('#btn-pause').focus({ preventScroll: true });
}

function nudge() {
  audio.denied();
  const note = $('#action-note');
  note.classList.remove('nudge');
  void note.offsetWidth;
  note.classList.add('nudge');
}

function doBid(inc) {
  audio.unlock();
  if (isPaused() || engine.phase !== PHASE.BIDDING) return;
  const hs = engine.humanState();
  if (!(inc === 2 ? hs.canBid2 : hs.canBid1) || !act.bid(inc)) nudge();
}

function doPass() {
  audio.unlock();
  if (isPaused() || engine.phase !== PHASE.BIDDING) return;
  if (!engine.humanState().canPass || !act.pass()) audio.denied();
}

// ---------- engine events ----------
function wireEngine() {
  const syncCash = () => { for (const c of engine.contenders) S.setCash(c.id, c.cash); };

  // Host: every event goes to the room with a snapshot of the match.
  engine.on('*', (type, data) => {
    if (role === 'host') lobby.broadcast({ t: wireType(type), ev: type, d: packEvent(type, data), s: engine.serialize() });
  });

  engine.on('phase', ({ phase }) => {
    // The host ended the match under us: back to the lobby.
    if (role === 'client' && phase === PHASE.IDLE) {
      setRole('solo');
      toTitle();
      if (lobbyView && lobby.active) lobbyView.open();
    }
  });

  engine.on('matchStart', () => {
    colors = colorsFor(engine.contenders.map((c) => ({ kind: c.isHuman ? 'human' : 'ai', persona: c.persona ? c.persona.key : null })));
    S.setContenders(engine.contenders.map((c) => ({ id: c.id, name: c.id === engine.localId ? 'YOU' : c.name, key: c.persona ? c.persona.key : 'you', color: colors[c.id], cash: c.cash })), engine.localId);
    S.setTheme(settings.theme);
    hud.hideOracle();
    hud.buildMatch(engine, colors);
    setScreen('game');
    $('#lost').hidden = true;
    media.prefetch(engine.queue.map((l) => l.item));
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
    hud.call(`${inc === 2 ? 'Power jump! ' : ''}$${amount} from ${who(by)}.`);
    lastTickClock = 99;
  });

  engine.on('pass', ({ by }) => {
    S.react(by, 'shake');
    audio.pass();
    hud.sync(engine);
    if (by === engine.localId) hud.call('You drop out of this lot.');
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
    hud.call(uncontested ? `${what} goes uncontested to ${who(winner)} for $1.` : `Sold! ${what} to ${who(winner)} for $${price}.`);
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
    hud.call(`${winner === engine.localId ? 'You open' : who(winner) + ' opens'} it: ${item.name}. ${item.commentaryLine}`);
  });

  engine.on('dud', ({ who: id, item }) => {
    hud.sync(engine);
    hud.call(`${id === engine.localId ? 'You are' : who(id) + ' is'} handed a Penalty Dud: ${item.name}. ${item.commentaryLine}`);
    if (id === engine.localId) audio.trombone();
  });

  engine.on('banter', ({ who: id, name, text, kind }) => {
    hud.banter({ name: id === engine.localId ? 'YOU' : name, text, color: colors[id] });
    S.react(id, kind === 'emote' ? 'hop' : 'nod');
    if (kind === 'emote') audio.blip();
  });

  engine.on('mood', ({ who: id, mood }) => {
    S.setMood(id, mood);
    if (engine.contenders.length) hud.sync(engine);
  });

  engine.on('away', ({ who: id, away }) => {
    if (away) hud.toast(`${engine.contenders[id].name} left the room. Their seat sits out.`);
    S.setStatus(id, away ? 'AWAY' : '');
    hud.sync(engine);
  });

  // ---------- the Oracle ----------
  engine.on('oracle', (d) => {
    const or = engine.oracle;
    const mine = or.player === engine.localId;
    switch (d.stage) {
      case 'intro':
        setScreen('game');
        S.clearLot();
        S.setOracle(true);
        S.setSign('QUIZ', true);
        S.focusUnit(or.player, false);
        hud.setCamLabel(CAM_LABELS.focus);
        audio.siren();
        audio.setTension(0.7);
        document.body.dataset.tension = '1';
        hud.bigCall('Oracle Intervention', 'crate');
        hud.call(`Oracle intervention. ${mine ? 'You have' : who(or.player) + ' has'} been chosen for a steal question.`);
        oracleBeat = 0;
        break;
      case 'question':
        if (d.n === 2) {
          S.focusUnit(or.player, true);
          audio.setTension(1);
          document.body.dataset.tension = '2';
          hud.call('Double or nothing. One more question for the whole lot.');
        } else {
          hud.call(`${mine ? 'Your' : who(or.player) + "'s"} question. Fifteen seconds.`);
        }
        oracleBeat = 0;
        break;
      case 'answer':
        if (d.right) { audio.chime(); S.react(or.player, 'hop'); } else { audio.buzzer(); S.react(or.player, 'shake'); }
        hud.call(d.right ? 'Correct.' : 'That is wrong.');
        break;
      case 'pick':
        hud.call(`${mine ? 'Choose' : who(or.player, true) + ' chooses'} a lot. Half price, straight from a rival's lineup.`);
        break;
      case 'gamble':
        hud.call(`${d.entry ? d.entry.item.name : 'The lot'} for $${d.cost}. Lock it in, or double or nothing?`);
        break;
      case 'risk':
        hud.bigCall('Double or nothing', 'sold');
        audio.alarm();
        break;
      case 'steal':
        S.flyItem(d.taken.item, d.victim, d.thief);
        S.heistFlash(d.thief, d.victim);
        if (d.free) audio.fanfare(); else { audio.slam(); setTimeout(() => audio.register(), 240); }
        syncCash();
        hud.bigCall(d.free ? 'Stolen for free!' : 'Stolen!', 'sold');
        hud.call(`${d.thief === engine.localId ? 'You take' : who(d.thief) + ' takes'} ${d.taken.item.name} from ${who(d.victim)} ${d.free ? 'for nothing' : `for $${d.cost}`}.`);
        break;
      case 'fail':
        if (d.why === 'forfeit' || d.why === 'timeout') audio.trombone();
        hud.bigCall(d.why === 'forfeit' ? 'Forfeited' : 'No steal', 'nosale');
        hud.call(d.why === 'forfeit' ? 'The gamble fails. The steal is gone.' : 'The Oracle withdraws. No steal.');
        break;
      case 'end':
        S.setOracle(false);
        S.setSign(`$${engine.options.budget}`);
        setCam('wide');
        audio.setTension(0);
        document.body.dataset.tension = '0';
        break;
      default:
        break;
    }
    hud.sync(engine);
    hud.renderOracle(engine);
  });

  // ---------- endgame ----------
  engine.on('vaultOpen', () => {
    setScreen('endgame');
    hud.hideOracle();
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

  engine.on('vaultLock', ({ who: id, entry }) => {
    audio.vaultLock();
    S.vaultFlash(id);
    syncCash();
    hud.sync(engine);
    hud.renderBoard(engine);
    hud.call(`${id === engine.localId ? 'You lock' : who(id) + ' locks'} ${entry.item.name} in the vault.`);
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
    S.flyItem(taken.item, victim, thief);
    syncCash();
    hud.sync(engine);
    hud.renderBoard(engine);
    hud.bigCall('Heist!', 'sold');
    hud.call(`${thief === engine.localId ? 'You steal' : who(thief) + ' steals'} ${taken.item.name} from ${who(victim)} for $${cost}.`);
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
  if (verdict.done || !engine.results) return;
  const results = engine.results;
  for (let i = verdict.step; i < verdict.total; i++) hud.revealStep(i, true);
  verdict.step = verdict.total;
  verdict.active = false;
  verdict.done = true;
  $('#btn-verdict-skip').hidden = true;
  hud.showWinner(results, engine);
  S.showdown(results.ranking);
  hud.setCamLabel(CAM_LABELS.podium);
  const rank = results.players[engine.localId].rank;
  if (rank === 1) audio.fanfare(); else if (rank === results.players.length) audio.trombone(); else audio.register();
  hud.call(rank === 1 ? 'The winner of tonight\'s draft: you.' : `The winner of tonight's draft: ${results.players[results.winner].name}.`);
  refreshAir();
  if (!debug.auto) (role === 'client' ? $('#btn-copy') : $('#btn-again')).focus({ preventScroll: true });
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
  $('#btn-start').addEventListener('click', startSolo);
  $('#btn-friends').addEventListener('click', () => { audio.unlock(); lobbyView.open(); });
  $('#btn-how').addEventListener('click', () => drawer.open());
  $('#btn-help').addEventListener('click', () => drawer.toggle());
  $('#btn-bid1').addEventListener('click', () => doBid(1));
  $('#btn-bid2').addEventListener('click', () => doBid(2));
  $('#btn-pass').addEventListener('click', doPass);
  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-resume').addEventListener('click', togglePause);
  $('#btn-quit').addEventListener('click', quitToTitle);
  $('#btn-lost').addEventListener('click', () => { $('#lost').hidden = true; toTitle(); $('#btn-start').focus({ preventScroll: true }); });
  $('#btn-mute').addEventListener('click', toggleMute);
  $('#btn-ff').addEventListener('click', toggleFF);
  $('#btn-board-done').addEventListener('click', () => { audio.blip(); act.done(); if (role === 'client') hud.toast('Waiting for the rest of the room.'); });
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
      S.setContenders(defaultUnits(), 0);
    });
  }
  $('#allin').addEventListener('change', (e) => { settings.allIn = e.target.checked; store.set('allIn', settings.allIn); applyModes(); });
  $('#marathon').addEventListener('change', (e) => { settings.marathon = e.target.checked; store.set('marathon', settings.marathon); applyModes(); });

  hud.onBoardAction = (kind, owner, itemId) => {
    audio.unlock();
    if (isPaused()) return;
    const ok = kind === 'vault' ? act.vault(itemId) : act.heist(owner, itemId);
    if (!ok) audio.denied();
  };
  hud.onOracle = (kind, a, b) => {
    audio.unlock();
    if (kind === 'answer') act.answer(a);
    else if (kind === 'pick') act.pick(a, b);
    else if (kind === 'gamble') act.gamble(a);
  };
  hud.onEmote = (k) => { audio.unlock(); act.emote(k); };

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type));
    if (typing) return;
    const k = e.key;
    if (k === '?') { e.preventDefault(); drawer.toggle(); return; }
    if (drawer.isOpen || guide.active || (lobbyView && lobbyView.isOpen)) return;
    if (k === 'Escape') { if (inMatch()) { e.preventDefault(); togglePause(); } return; }
    if (pauseReasons.has('user')) return;
    if (k === 'm' || k === 'M') { toggleMute(); return; }
    if (k === 'f' || k === 'F') { toggleFF(); return; }
    const onControl = tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || tag === 'SELECT';
    const onAction = !!(t && t.closest && t.closest('#actions'));
    if (screen === 'title') {
      if (k === 'Enter' && !onControl) { e.preventDefault(); if (lobby.active) lobbyView.open(); else startSolo(); }
      return;
    }
    if (screen === 'arcade') {
      if (arcade && !e.repeat && (!onControl || /^[1-6eEwasdWASDzxcZXCtT]$|^Arrow/.test(k)) && arcade.key(e)) e.preventDefault();
      return;
    }
    if (screen === 'game') {
      const or = engine.oracle;
      if (engine.phase === PHASE.ORACLE) {
        if (or.player === engine.localId && (or.stage === 'q1' || or.stage === 'q2') && k >= '1' && k <= '4') { e.preventDefault(); if (!e.repeat) act.answer(Number(k) - 1); }
        return;
      }
      if (k === ' ' || k === 'b' || k === 'B') {
        if (k === ' ' && onControl && !onAction) return;
        e.preventDefault();
        if (!e.repeat) doBid(1);
      } else if (k === 'j' || k === 'J') { e.preventDefault(); if (!e.repeat) doBid(2); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); if (!e.repeat) doPass(); }
      else if (k === 'Enter' && (!onControl || onAction)) { e.preventDefault(); if (!e.repeat && role === 'solo') engine.skip(); }
      return;
    }
    if (screen === 'endgame') {
      if (k === 'Enter' && !onControl) { e.preventDefault(); act.done(); }
      return;
    }
    if (screen === 'verdict' && k === 'Enter' && !onControl) {
      e.preventDefault();
      if (!verdict.done) finishVerdict(); else if (role !== 'client') startMatch();
    }
  });

  document.addEventListener('keyup', (e) => { if (arcade) arcade.keyup(e); });
  window.addEventListener('blur', () => { if (arcade && arcade.keys) arcade.keys.clear(); });

  document.addEventListener('visibilitychange', () => {
    setPaused('hidden', document.hidden && inMatch() && role === 'solo');
    lastStep = performance.now();
    lastFrame = lastStep;
  });
  // Browsers only allow audio after a gesture.
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('pagehide', () => { if (lobby.active) lobby.leave(true); });
}

// ---------- the loop ----------
function matchSpeed() {
  let s = debug.speed;
  if (role === 'solo' && settings.ff && [PHASE.LOT_INTRO, PHASE.BIDDING, PHASE.SOLD].includes(engine.phase) && engine.humanState().spectating) s *= 2.5;
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

// A heartbeat under every Oracle question: quicker for double or nothing, with a tick
// for each of the last five seconds.
function oracleSounds(dt) {
  const or = engine.oracle;
  if (engine.phase !== PHASE.ORACLE || (or.stage !== 'q1' && or.stage !== 'q2')) return;
  oracleBeat -= dt;
  if (oracleBeat > 0) return;
  oracleBeat = or.stage === 'q2' ? 0.55 : 1;
  audio.heartbeat();
  if (or.t <= 5) audio.tick(or.t <= 2);
}

// Test and demo helper: plays the local seat with a simple policy.
function autopilot() {
  const me = engine.me;
  if (!me) return;
  if (engine.phase === PHASE.BIDDING) {
    const hs = engine.humanState();
    if (hs.canBid1 && engine.currentBid < 3 && Math.random() < 0.04) act.bid(1);
  } else if (engine.phase === PHASE.VAULT || engine.phase === PHASE.HEIST) {
    if (engine.phaseClock > 1 && autoDone !== engine.phase) { autoDone = engine.phase; act.done(); }
  } else if (engine.phase === PHASE.ORACLE && engine.oracle.player === me.id && Math.random() < 0.05) {
    const or = engine.oracle;
    if (or.stage === 'q1' || or.stage === 'q2') act.answer(Math.floor(Math.random() * 4));
    else if (or.stage === 'pick') { const o = or.optionsFor(me)[0]; if (o) act.pick(o.victim.id, o.entry.item.id); }
    else if (or.stage === 'gamble') act.gamble(false);
  }
}

// Advances the match by real time. Called from the frame loop, and from a timer when the
// tab is hidden, because a host's room must keep running while they look at another tab.
function advance(now) {
  const cap = document.hidden ? 1.5 : 0.25;
  const dt = Math.min(cap, Math.max(0, (now - lastStep) / 1000));
  lastStep = now;
  if (arcade) { arcade.advance(dt); return; }
  if (!inMatch() || isPaused()) return;

  if (role === 'client') {
    if (debug.auto) autopilot();
    engine.update(dt);
    tickClockSounds();
  } else {
    acc += dt * matchSpeed();
    let n = 0;
    while (acc >= STEP && n < 90) {
      if (debug.auto) autopilot();
      engine.update(STEP);
      tickClockSounds();
      acc -= STEP;
      n++;
    }
    if (n === 90) acc = 0;
    if (role === 'host') {
      // Hold the hammer for the slowest guest's delay, so a bid made in time counts.
      engine.bidGrace = lobby.maxLag();
      tickAcc += dt;
      if (tickAcc >= 0.25) {
        tickAcc = 0;
        lobby.broadcast({ t: WIRE.TIMER_TICK, ck: engine.clock, pt: engine.phaseT, ot: engine.oracle.t });
      }
    }
  }
  oracleSounds(dt);

  if (camReturn > 0) {
    camReturn -= dt;
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

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  seconds += dt;
  advance(now);
  heroAttract(dt);
  hud.frame(engine, seconds);
  logo.speed = screen === 'title' ? 1 : 0;
  logo.tick(reduceMotion.matches ? 0 : dt);
  if (screen === 'arcade') {
    // The studio stays dark while another game has the screen.
    if (arcade) {
      try { arcade.frame(dt, reduceMotion.matches); } catch (err) { console.error('[arcade] frame failed:', err); }
    }
    return;
  }
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
  logo = new EggcrateDisplay(logoCanvas, { cols: 8, cell: 8, align: 'center', marquee: true, label: 'Now showing' });
  logo.set('BIDLOCK');

  const guide = new Guide({
    getScreen: () => screen,
    ensureScreen: async (want) => {
      if (want === 'game' && screen === 'title' && !lobby.active) {
        startSolo();
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
  buildChannels();
  buildCrates();
  buildLevels();
  lobbyView = new LobbyView({
    lobby,
    loadName: () => store.get('name', ''),
    saveName: (n) => store.set('name', String(n).slice(0, 14)),
    colorsFor: (seats) => (lobby.state.game === 'bidlock' ? colorsFor(seats) : arcadeColors(seats)),
    defaultGame: () => settings.game,
    genre: () => settings.genre,
    onGenre: (id) => { audio.blip(); selectGenre(id); },
    level: () => settings.level,
    onLevel: (id) => { audio.blip(); selectLevel(id); },
    summary: modeSummary,
    onStart: startRoom,
    onOpen: () => {},
    onClose: () => {},
    toast: (t) => hud.toast(t),
  });

  setRole('solo');
  applyTheme();
  applySound();
  $('#btn-ff').setAttribute('aria-pressed', String(settings.ff));
  buildHero();
  wireEngine();
  wireInput(guide, drawer);

  media.onChange((item) => {
    hud.refreshMedia(item);
    S.refreshLot(item);
    if (hero.item && hero.item.id === item.id && screen === 'title') heroPhoto();
  });

  try {
    const mod = await import('./render/stage3d.js');
    stage = new mod.Stage3D($('#stage'), { media });
    stage.onContextLost = () => showNoSignal('The graphics context was lost. The auction carries on at the desk.');
  } catch (err) {
    console.warn('[bidlock] 3D studio unavailable:', err);
    stage = null;
    showNoSignal('No 3D feed here (WebGL or the Three.js CDN is blocked). The auction still runs at the desk.');
  }

  S.setContenders(defaultUnits(), 0);
  applyTheme();
  applyModes();
  setScreen('title');
  setCam('title');
  showHero(0);
  // After the hero, so a stored arcade game boots with its own (empty) pedestal.
  selectGame(settings.game);
  hero.touched = -99;
  // One request fetches the photograph for the first lot of every category.
  media.prefetch(CATEGORIES.map((c) => c.items[0]));
  const t0 = performance.now();
  lastStep = t0;
  lastFrame = t0;
  requestAnimationFrame(frame);
  setInterval(() => { if (document.hidden && role !== 'solo') advance(performance.now()); }, 250);

  const room = params.get('room');
  if (room) lobbyView.open(room);
  else if (params.get('guide') !== 'off' && !debug.auto) guide.maybeInvite();

  window.__bidlock = {
    engine, settings, guide, drawer, lobby, media, act,
    get stage() { return stage; }, get screen() { return screen; }, get role() { return role; },
    startMatch: startSolo, startRoom, finishVerdict, selectGame,
    get arcade() { return arcade; },
  };
}

boot().catch((err) => {
  console.error('[bidlock] failed to start:', err);
  document.body.dataset.screen = 'boot';
  const t = $('#standby-title');
  const s = $('#standby-text');
  if (t) t.textContent = 'TECHNICAL FAULT';
  if (s) s.textContent = 'BidLock could not start. Reload the page to try again.';
});
