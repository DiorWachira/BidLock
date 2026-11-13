// BIDLOCK — HUD. Reads engine state and paints the DOM: desk, room, rundown, lot card,
// bid block, lower-third chyrons, the vault/heist board and the verdict table.

import { EggcrateDisplay, money } from './eggcrate.js';
import { SYNERGY_TAGS, SYNERGY_RULE, hypeLamps } from '../data/categories.js';
import { PHASE, HUMAN_ID, RULES } from '../engine/auctionEngine.js';

const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CALLS_BID = ['', 'GOING ONCE', 'GOING TWICE', 'LAST CALL'];
const CALLS_OPEN = ['', 'ANY BIDS?', 'NO TAKERS?', 'LAST CHANCE'];
const TIER_LABEL = { S: 'S', A: 'A', B: 'B', C: 'C', CURSED: 'CURSED', DUD: 'DUD' };

export class Hud {
  constructor({ colors }) {
    this.colors = colors; // contender id -> css colour
    this.el = {
      round: $('#roundinfo'), rundown: $('#rundown'), camLabel: $('#cam-label'), timecode: $('#timecode'),
      maxbid: $('#maxbid'), mode: $('#modechip'), roster: $('#roster'), synergy: $('#synergy'),
      rivals: $('#rival-list'),
      lotSlug: $('#lot-slug'), lotName: $('#lot-name'), lotTags: $('#lot-tags'), lotHype: $('#lot-hype'), lotLine: $('#lot-line'),
      highbid: $('#highbid'), clock: $('#clock'), clockText: $('#clocktext'), callText: $('#calltext'),
      bid1: $('#btn-bid1'), bid2: $('#btn-bid2'), pass: $('#btn-pass'), note: $('#action-note'),
      bid1Label: $('#btn-bid1 .b-label'), bid2Label: $('#btn-bid2 .b-label'),
      chyCall: $('#chy-call'), chyBanter: $('#chy-banter'), bigcall: $('#bigcall'),
      boardTitle: $('#board-title'), boardHelp: $('#board-help'), boardTable: $('#board-table'), boardDone: $('#btn-board-done'),
      verdictHead: $('#verdict-head'), verdictSub: $('#verdict-sub'), verdictTable: $('#verdict-table'), verdictActions: $('#verdict-actions'),
      toast: $('#toast'), tally: $('#tally'), onair: $('#onair'),
    };
    this.cash = new EggcrateDisplay($('#ec-cash'), { cols: 3, cell: 7, label: 'Your cash' });
    this.bid = new EggcrateDisplay($('#ec-bid'), { cols: 3, cell: 10, label: 'Current bid' });
    this.boardClock = new EggcrateDisplay($('#ec-board'), { cols: 2, cell: 6, label: 'Seconds left' });
    this.rivalCash = new Map();
    this.banterQueue = [];
    this.banterBusy = false;
    this.cache = {};
    this.onBoardAction = null;
    this.el.boardTable.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b && !b.disabled && this.onBoardAction) this.onBoardAction(b.dataset.act, Number(b.dataset.owner), b.dataset.item);
    });
    this.el.clock.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  }

  set(key, node, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    node[prop] = value;
  }

  // ---------- match scaffolding ----------
  buildMatch(engine) {
    this.cache = {};
    this.rivalCash.clear();
    this.el.rivals.innerHTML = engine.contenders.filter((c) => !c.isHuman).map((c) => `
      <li class="rival" data-id="${c.id}" data-mood="CALM" style="--who:${this.colors[c.id]}">
        <div class="rv-head"><span class="rv-swatch" aria-hidden="true"></span><b>${esc(c.name)}</b><span class="rv-mood">CALM</span></div>
        <p class="rv-title">${esc(c.persona.title)}</p>
        <div class="rv-row"><canvas class="rv-cash"></canvas><span class="rv-pips" aria-label="Lineup slots"></span></div>
        <p class="rv-state"></p>
      </li>`).join('');
    for (const li of this.el.rivals.querySelectorAll('.rival')) {
      const id = Number(li.dataset.id);
      this.rivalCash.set(id, new EggcrateDisplay($('.rv-cash', li), { cols: 3, cell: 4, label: `${engine.contenders[id].name} cash` }));
    }
    this.sync(engine);
  }

  // ---------- event-driven repaint ----------
  sync(engine) {
    const lot = engine.lot;
    const human = engine.human;
    const total = engine.categories.length;

    // Top bar.
    let round = '';
    if (engine.phase === PHASE.VAULT) round = 'ENDGAME <b>THE VAULT</b>';
    else if (engine.phase === PHASE.HEIST || engine.phase === PHASE.HEIST_DONE) round = 'ENDGAME <b>THE HEIST</b>';
    else if (engine.phase === PHASE.VERDICT) round = '<b>GRAND JURY VERDICT</b>';
    else if (lot && lot.kind === 'mystery') round = `SURPRISE LOT <b>MYSTERY CRATE ${lot.lotIndex + 1}/${lot.lotsInCat}</b>`;
    else if (lot) round = `ROUND ${lot.catIndex + 1}/${total} <b>${esc(lot.cat.name.toUpperCase())}</b>`;
    this.set('round', this.el.round, round, 'innerHTML');

    this._rundown(engine);
    this._desk(engine);
    this._rivals(engine);
    this._lotCard(engine);

    // Bid block.
    const hi = engine.highBidder;
    this.bid.set(money(engine.currentBid), { red: hi === HUMAN_ID });
    let hb = 'OPENS AT $1';
    if (engine.phase === PHASE.SOLD && lot && lot.result) {
      hb = lot.result.winner == null ? 'NO SALE' : `SOLD TO ${engine.contenders[lot.result.winner].name}`;
    } else if (hi != null) hb = hi === HUMAN_ID ? 'HIGH BID: YOU' : `HIGH BID: ${engine.contenders[hi].name}`;
    this.set('highbid', this.el.highbid, hb);
    this.el.highbid.dataset.you = hi === HUMAN_ID ? '1' : '0';
    this.el.tally.classList.toggle('live', hi === HUMAN_ID && engine.phase === PHASE.BIDDING);
    this.cash.set(money(human.cash));
    this.set('bid1', this.el.bid1Label, engine.currentBid === 0 ? 'OPEN AT $1' : `BID $${engine.currentBid + 1}`);
    this.set('bid2', this.el.bid2Label, `JUMP TO $${engine.currentBid + 2}`);
  }

  _rundown(engine) {
    const lot = engine.lot;
    let html = '';
    const inAuction = [PHASE.CATEGORY_INTRO, PHASE.LOT_INTRO, PHASE.BIDDING, PHASE.SOLD, PHASE.REVEAL].includes(engine.phase);
    if (lot && inAuction) {
      if (lot.kind === 'mystery') {
        html = `<li class="rd-chip">CRATE</li><li class="rd-tile" data-state="now"><span class="rd-n">?</span><span class="rd-name">Sealed mystery crate</span><span class="rd-res">${lot.result && lot.result.winner != null ? `${esc(engine.contenders[lot.result.winner].name)} $${lot.result.price}` : 'BLIND LOT'}</span></li>`;
      } else {
        html = `<li class="rd-chip">${esc(lot.cat.short)}</li>` + engine.lotsOfCategory(lot.catIndex).map((l) => {
          const state = l.result ? (l.result.winner != null ? 'sold' : 'burned') : l === lot && engine.phase !== PHASE.CATEGORY_INTRO ? 'now' : 'next';
          const res = l.result ? (l.result.winner != null ? `${esc(engine.contenders[l.result.winner].name)} $${l.result.price}` : 'NO SALE') : state === 'now' ? 'ON THE BLOCK' : 'COMING UP';
          return `<li class="rd-tile" data-state="${state}"><span class="rd-n">${l.lotIndex + 1}</span><span class="rd-name">${esc(l.item.name)}</span><span class="rd-res">${res}</span></li>`;
        }).join('');
      }
    }
    this.set('rundown', this.el.rundown, html, 'innerHTML');
  }

  _desk(engine) {
    const human = engine.human;
    const lot = engine.lot;
    this.set('maxbid', this.el.maxbid, lot && engine.isEligible(human, lot) ? money(engine.maxBidFor(human, lot)) : '--');
    this.set('mode', this.el.mode, human.allIn ? 'ALL-IN' : 'RESERVE');
    const rows = engine.categories.map((cat) => {
      const e = human.roster[cat.id];
      const now = lot && lot.kind === 'cat' && lot.cat.id === cat.id && !e;
      if (!e) return `<li data-state="${now ? 'now' : 'open'}"><span class="slot-cat">${esc(cat.short)}</span><span class="slot-name">${now ? 'bidding now' : 'open slot'}</span><span class="slot-price">${now ? '' : '$1 held'}</span></li>`;
      return `<li data-state="${e.dud ? 'dud' : 'filled'}"><span class="slot-cat">${esc(cat.short)}</span><span class="slot-name">${esc(e.item.name)}${e.vaulted ? ' <em>LOCKED</em>' : ''}${e.stolenFrom != null ? ' <em>STOLEN</em>' : ''}</span><span class="slot-price">${e.dud ? 'DUD' : money(e.price)}</span></li>`;
    });
    for (const e of human.bonus) {
      rows.push(`<li data-state="filled"><span class="slot-cat">CRATE</span><span class="slot-name">${esc(e.item.name)}${e.vaulted ? ' <em>LOCKED</em>' : ''}</span><span class="slot-price">${money(e.price)}</span></li>`);
    }
    this.set('roster', this.el.roster, rows.join(''), 'innerHTML');

    const counts = engine.tagCounts(human);
    const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const syn = tags.length
      ? tags.map(([t, n]) => `<li data-hit="${n >= SYNERGY_RULE.at ? 1 : 0}"><span>${esc(SYNERGY_TAGS[t])}</span><b>${'●'.repeat(Math.min(n, 5))}${'○'.repeat(Math.max(0, SYNERGY_RULE.at - n))}</b>${n >= SYNERGY_RULE.at ? `<em>+${n >= SYNERGY_RULE.megaAt ? SYNERGY_RULE.megaBonus : SYNERGY_RULE.bonus}</em>` : ''}</li>`).join('')
      : '<li class="empty">No tags yet. Three of a kind pays +40.</li>';
    this.set('synergy', this.el.synergy, syn, 'innerHTML');
  }

  _rivals(engine) {
    const bidding = engine.phase === PHASE.BIDDING || engine.phase === PHASE.LOT_INTRO;
    for (const c of engine.contenders) {
      if (c.isHuman) continue;
      const li = this.el.rivals.querySelector(`[data-id="${c.id}"]`);
      if (!li) continue;
      this.rivalCash.get(c.id).set(money(c.cash));
      if (li.dataset.mood !== c.mood) {
        li.dataset.mood = c.mood;
        $('.rv-mood', li).textContent = c.mood;
      }
      const pips = engine.categories.map((cat) => {
        const e = c.roster[cat.id];
        return `<i data-s="${e ? (e.dud ? 'dud' : 'on') : 'off'}" title="${esc(cat.name)}: ${e ? esc(e.item.name) : 'open'}"></i>`;
      }).join('') + (c.bonus.length ? `<u>+${c.bonus.length}</u>` : '');
      this.set(`pips${c.id}`, $('.rv-pips', li), pips, 'innerHTML');
      let state = '';
      let key = '';
      if (bidding) {
        if (engine.highBidder === c.id) { state = `HIGH BID $${engine.currentBid}`; key = 'high'; }
        else if (!engine.active.has(c.id)) { state = 'SITTING OUT'; key = 'out'; }
        else if (engine.passed.has(c.id)) { state = 'DROPPED OUT'; key = 'out'; }
        else { state = 'IN THE BIDDING'; key = 'in'; }
      }
      this.set(`state${c.id}`, $('.rv-state', li), state);
      li.dataset.state = key;
    }
  }

  _lotCard(engine) {
    const lot = engine.lot;
    if (!lot) return;
    const human = engine.human;
    const sealed = lot.kind === 'mystery' && !(lot.result && lot.result.winner != null && engine.phase !== PHASE.SOLD && engine.revealed);
    this.set('lotslug', this.el.lotSlug, `LOT ${String(lot.n).padStart(2, '0')} / ${String(engine.queue.length).padStart(2, '0')} · ${lot.cat.name.toUpperCase()}`);
    if (lot.kind === 'mystery' && sealed) {
      this.set('lotname', this.el.lotName, 'Mystery Crate');
      this.set('lottags', this.el.lotTags, '<span class="tag">Sealed</span><span class="tag">Jackpot or curse</span>', 'innerHTML');
      this.set('lothype', this.el.lotHype, '<span class="hype-sealed">SEALED</span>', 'innerHTML');
      this.set('lotline', this.el.lotLine, `Clue: ${lot.clue}`);
      return;
    }
    const item = lot.item;
    const counts = engine.tagCounts(human);
    const wants = engine.isEligible(human, lot) || lot.kind === 'mystery';
    const tags = item.synergyTags.map((t) => {
      const have = counts[t] || 0;
      const combo = wants && have === SYNERGY_RULE.at - 1;
      return `<span class="tag" data-combo="${combo ? 1 : 0}">${esc(SYNERGY_TAGS[t])}${have ? ` <b>${have} held</b>` : ''}${combo ? ' <b>+40 if won</b>' : ''}</span>`;
    }).join('');
    this.set('lotname', this.el.lotName, item.name);
    this.set('lottags', this.el.lotTags, tags || '<span class="tag">No tags</span>', 'innerHTML');
    const lamps = hypeLamps(item);
    this.set('lothype', this.el.lotHype, lot.kind === 'mystery' ? `<span class="hype-sealed">${esc(item.tier)}-TIER · ${item.trueValue} PTS</span>` : Array.from({ length: 5 }, (_, i) => `<i data-on="${i < lamps ? 1 : 0}"></i>`).join('') + `<span class="visually-hidden">${lamps} of 5</span>`, 'innerHTML');
    this.set('lotline', this.el.lotLine, item.commentaryLine);
  }

  // ---------- per-frame ----------
  frame(engine, seconds) {
    const tc = Math.floor(seconds);
    this.set('tc', this.el.timecode, `${String(Math.floor(tc / 3600)).padStart(2, '0')}:${String(Math.floor(tc / 60) % 60).padStart(2, '0')}:${String(tc % 60).padStart(2, '0')}`);
    if (!engine.contenders.length || engine.phase === PHASE.IDLE) return;
    const bidding = engine.phase === PHASE.BIDDING;
    const clock = bidding ? Math.max(0, engine.clock) : 0;
    const lit = bidding ? Math.ceil(clock) : 0;
    const key = `${lit}|${engine.callStage}|${bidding ? 1 : 0}`;
    if (this.cache.clockKey !== key) {
      this.cache.clockKey = key;
      const segs = this.el.clock.children;
      for (let i = 0; i < segs.length; i++) segs[i].dataset.on = i < lit ? '1' : '0';
      this.el.clock.dataset.hot = bidding && engine.callStage > 0 ? '1' : '0';
      const calls = engine.highBidder != null ? CALLS_BID : CALLS_OPEN;
      this.el.callText.textContent = bidding ? calls[engine.callStage] || 'OPEN' : engine.phase === PHASE.SOLD ? 'HAMMER DOWN' : 'STAND BY';
    }
    this.set('clocktext', this.el.clockText, bidding ? clock.toFixed(1) : '-.-');

    const hs = engine.humanState();
    this._btn(this.el.bid1, !hs.canBid1);
    this._btn(this.el.bid2, !hs.canBid2);
    this._btn(this.el.pass, !hs.canPass);
    let note = '';
    if (engine.phase === PHASE.CATEGORY_INTRO) note = 'Four lots this round. You must take exactly one.';
    else if (engine.phase === PHASE.LOT_INTRO) note = hs.inLot ? 'Lot coming up. Bidding opens at $1.' : hs.reason;
    else if (bidding) note = hs.reason || (engine.currentBid === 0 ? 'No bids yet. Open at $1, or wait and see.' : `Your max on this lot: $${hs.maxBid}.`);
    else if (engine.phase === PHASE.SOLD) note = 'Press Enter to move on.';
    else if (engine.phase === PHASE.REVEAL) note = 'Opening the crate…';
    this.set('note', this.el.note, note);

    if (engine.phase === PHASE.VAULT || engine.phase === PHASE.HEIST) {
      this.boardClock.set(String(Math.max(0, Math.ceil(engine.phaseT))), { red: engine.phase === PHASE.HEIST });
    }
  }

  _btn(b, disabled) {
    if (b.disabled !== disabled) b.disabled = disabled;
  }

  setCamLabel(text) { this.set('cam', this.el.camLabel, text); }

  setOnAir(state) {
    this.set('onair', this.el.onair, state);
    this.el.onair.dataset.state = state;
  }

  flashBid() {
    const c = this.bid.canvas;
    c.classList.remove('flash');
    void c.offsetWidth;
    c.classList.add('flash');
  }

  // ---------- chyrons ----------
  call(text) {
    const row = this.el.chyCall;
    $('.chy-text', row).textContent = text;
    row.classList.remove('on');
    void row.offsetWidth;
    row.classList.add('on');
  }

  banter({ name, text, color }) {
    this.banterQueue.push({ name, text, color });
    if (this.banterQueue.length > 2) this.banterQueue.splice(0, this.banterQueue.length - 2);
    if (!this.banterBusy) this._nextBanter();
  }

  _nextBanter() {
    const row = this.el.chyBanter;
    const b = this.banterQueue.shift();
    if (!b) { this.banterBusy = false; row.classList.remove('on'); return; }
    this.banterBusy = true;
    row.style.setProperty('--who', b.color);
    $('.chy-tab', row).textContent = b.name;
    $('.chy-text', row).textContent = b.text;
    row.classList.remove('on');
    void row.offsetWidth;
    row.classList.add('on');
    clearTimeout(this.banterTimer);
    this.banterTimer = setTimeout(() => this._nextBanter(), Math.min(4200, 1500 + b.text.length * 38));
  }

  clearChyrons() {
    this.banterQueue = [];
    this.banterBusy = false;
    clearTimeout(this.banterTimer);
    this.el.chyBanter.classList.remove('on');
    this.el.chyCall.classList.remove('on');
  }

  bigCall(text, kind = 'sold') {
    const el = this.el.bigcall;
    el.textContent = text;
    el.dataset.kind = kind;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  // ---------- vault + heist board ----------
  renderBoard(engine) {
    const vault = engine.phase === PHASE.VAULT;
    const heist = engine.phase === PHASE.HEIST;
    const human = engine.human;
    this.el.boardTitle.textContent = vault ? 'THE VAULT' : heist ? 'THE HEIST' : 'HANDS OFF';
    this.el.boardHelp.innerHTML = vault
      ? `Pay <b>$${RULES.vaultCost}</b> to lock one of your lots. Locked lots cannot be stolen. You have <b>$${human.cash}</b>.`
      : heist
        ? (human.heistUsed ? 'Your heist is done. Watch your lineup.' : `One steal each. It costs what the owner paid <b>plus $${RULES.heistPremium}</b>, and they get your lot from that category in return. You have <b>$${human.cash}</b>.`)
        : 'The heist is over. To the jury.';
    this.el.boardDone.textContent = vault ? 'DONE LOCKING' : 'DONE';
    this.el.boardDone.disabled = !(vault || heist);
    const options = heist ? engine.heistOptions(human) : [];
    const head = `<thead><tr><th scope="col" class="b-corner">LOT</th>${engine.contenders.map((c) => `<th scope="col" style="--who:${this.colors[c.id]}"><span class="b-who">${esc(c.name)}</span><span class="b-cash">$${c.cash}${c.heistUsed ? ' · HEIST USED' : ''}</span></th>`).join('')}</tr></thead>`;
    const cell = (c, e) => {
      if (!e) return '<td><span class="cell empty">—</span></td>';
      const badges = [];
      if (e.vaulted) badges.push('<span class="c-badge" data-k="lock">LOCKED</span>');
      if (e.hot) badges.push('<span class="c-badge" data-k="hot">JUST MOVED</span>');
      if (e.dud) badges.push('<span class="c-badge" data-k="dud">DUD</span>');
      let act = '';
      let label = '';
      if (vault && c.isHuman && engine.canVault(c, e)) { act = 'vault'; label = `LOCK FOR $${RULES.vaultCost}`; }
      const opt = options.find((o) => o.victim.id === c.id && o.entry === e);
      if (opt) { act = 'heist'; label = `STEAL FOR $${opt.cost}`; }
      const inner = `<span class="c-name">${esc(e.item.name)}</span><span class="c-meta">${e.dud ? 'penalty dud' : `paid $${e.price}`}</span>${badges.join('')}${label ? `<span class="c-act">${label}</span>` : ''}`;
      return act
        ? `<td><button type="button" class="cell" data-act="${act}" data-owner="${c.id}" data-item="${esc(e.item.id)}">${inner}</button></td>`
        : `<td><span class="cell" data-locked="${e.vaulted ? 1 : 0}">${inner}</span></td>`;
    };
    const rows = engine.categories.map((cat) => `<tr><th scope="row">${esc(cat.short)}</th>${engine.contenders.map((c) => cell(c, c.roster[cat.id])).join('')}</tr>`);
    const maxBonus = Math.max(0, ...engine.contenders.map((c) => c.bonus.length));
    for (let i = 0; i < maxBonus; i++) {
      rows.push(`<tr><th scope="row">CRATE</th>${engine.contenders.map((c) => cell(c, c.bonus[i])).join('')}</tr>`);
    }
    this.el.boardTable.innerHTML = `${head}<tbody>${rows.join('')}</tbody>`;
  }

  // ---------- verdict ----------
  renderVerdict(results, engine) {
    this.results = results;
    this.totals = [];
    const P = results.players;
    this.el.verdictHead.textContent = 'The jury is counting…';
    this.el.verdictSub.textContent = 'Sealed values, revealed one category at a time.';
    this.el.verdictActions.hidden = true;
    const tier = (item) => `<span class="tier" data-t="${item.tier}">${TIER_LABEL[item.tier] || item.tier}</span>`;
    const head = `<thead><tr><th class="b-corner" scope="col">ROUND</th>${P.map((p) => `<th scope="col" data-col="${p.id}" style="--who:${this.colors[p.id]}"><span class="b-who">${esc(p.name)}</span><span class="v-rank" data-rank></span></th>`).join('')}</tr></thead>`;
    const rows = results.rows.map((row) => {
      const best = Math.max(...row.cells.map((c) => c.value));
      return `<tr class="vrow" data-step><th scope="row">${esc(row.cat.short)}</th>${row.cells.map((c) => `
        <td data-col="${c.id}" data-best="${c.value === best && best > 0 ? 1 : 0}">
          <span class="v-item">${c.item ? esc(c.item.name) : '—'} ${c.item ? tier(c.item) : ''}</span>
          <span class="v-bar"><i style="--w:${c.value}%"></i></span>
          <span class="v-val" data-count="${c.value}">0</span><span class="v-paid">${c.item && !c.item.dud ? `$${c.price}` : ''}${c.entry && c.entry.stolenFrom != null ? ' · stolen' : ''}</span>
        </td>`).join('')}</tr>`;
    });
    if (P.some((p) => p.bonus.length)) {
      rows.push(`<tr class="vrow" data-step><th scope="row">CRATES</th>${P.map((p) => `
        <td data-col="${p.id}">${p.bonus.length ? p.bonus.map((e) => `<span class="v-item">${esc(e.item.name)} ${tier(e.item)}</span>`).join('') : '<span class="v-item v-none">no crate</span>'}
          <span class="v-bar"><i style="--w:${Math.min(100, p.bonusValue)}%"></i></span><span class="v-val" data-count="${p.bonusValue}">0</span></td>`).join('')}</tr>`);
    }
    rows.push(`<tr class="vrow" data-step><th scope="row">SYNERGY</th>${P.map((p) => `
      <td data-col="${p.id}">${p.combos.length ? p.combos.map((x) => `<span class="v-combo">${esc(SYNERGY_TAGS[x.tag])} ×${x.count}</span>`).join('') : '<span class="v-item v-none">no combo</span>'}
        <span class="v-val" data-count="${p.synergy}" data-plus>0</span></td>`).join('')}</tr>`);
    rows.push(`<tr class="vrow vtotal" data-step><th scope="row">TOTAL</th>${P.map((p) => `<td data-col="${p.id}"><canvas class="v-total" data-id="${p.id}"></canvas><span class="v-paid">$${p.cash} left</span></td>`).join('')}</tr>`);
    this.el.verdictTable.innerHTML = `${head}<tbody>${rows.join('')}</tbody>`;
    this.el.verdictTable.dataset.done = '0';
    for (const cv of this.el.verdictTable.querySelectorAll('.v-total')) {
      const d = new EggcrateDisplay(cv, { cols: 3, cell: 5, label: 'Total' });
      d.set('---');
      this.totals.push({ id: Number(cv.dataset.id), d });
    }
    this.steps = [...this.el.verdictTable.querySelectorAll('[data-step]')];
    return this.steps.length;
  }

  revealStep(i, instant = false) {
    const tr = this.steps[i];
    if (!tr || tr.classList.contains('shown')) return;
    tr.classList.add('shown');
    for (const el of tr.querySelectorAll('[data-count]')) {
      const to = Number(el.dataset.count);
      const plus = el.hasAttribute('data-plus') && to > 0 ? '+' : '';
      if (instant) { el.textContent = plus + to; continue; }
      const t0 = performance.now();
      const run = (now) => {
        const k = Math.min(1, (now - t0) / 650);
        el.textContent = plus + Math.round(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    }
    if (tr.classList.contains('vtotal')) {
      for (const t of this.totals) {
        const p = this.results.players[t.id];
        t.d.set(String(p.total), { red: p.rank === 1 });
      }
    }
  }

  showWinner(results) {
    const P = results.players;
    const me = P[HUMAN_ID];
    const win = P[results.winner];
    const place = ['1st', '2nd', '3rd', '4th'][me.rank - 1];
    this.el.verdictHead.textContent = me.rank === 1 ? `You win the draft with ${me.total} points.` : `${win.name} wins with ${win.total}. You finish ${place} on ${me.total}.`;
    const margin = me.rank === 1 ? me.total - P[results.ranking[1]].total : win.total - me.total;
    this.el.verdictSub.textContent = me.rank === 1
      ? `Clear by ${margin} point${margin === 1 ? '' : 's'}. Leftover cash only breaks ties.`
      : `${margin} point${margin === 1 ? '' : 's'} short. Leftover cash only breaks ties.`;
    for (const th of this.el.verdictTable.querySelectorAll('thead th[data-col]')) {
      const p = P[Number(th.dataset.col)];
      th.querySelector('[data-rank]').textContent = p.rank === 1 ? 'WINNER' : ['', '2ND', '3RD', '4TH'][p.rank - 1];
      th.dataset.win = p.rank === 1 ? '1' : '0';
    }
    this.el.verdictTable.dataset.done = '1';
    this.el.verdictActions.hidden = false;
  }

  scorecard(results, engine) {
    const P = results.players;
    const me = P[HUMAN_ID];
    const human = engine.human;
    const budget = results.options.budget;
    const place = ['1st', '2nd', '3rd', '4th'][me.rank - 1];
    const lines = [];
    lines.push(`BIDLOCK — THE $${budget} DRAFT`);
    lines.push(me.rank === 1 ? `WON THE DRAFT · ${me.total} pts` : `Finished ${place} of 4 · ${me.total} pts`);
    lines.push('--------------------------------');
    for (const row of results.rows) {
      const c = row.cells[HUMAN_ID];
      const name = c.item ? c.item.name : 'nothing';
      const paid = c.item && c.item.dud ? 'dud' : `$${c.price}`;
      lines.push(`${row.cat.name}: ${name} (${paid}) = ${c.value}`);
    }
    for (const e of human.bonus) lines.push(`Mystery crate: ${e.item.name} ($${e.price}) = ${e.item.trueValue}`);
    lines.push(me.combos.length ? `Synergy: ${me.combos.map((x) => `${SYNERGY_TAGS[x.tag]} x${x.count} (+${x.bonus})`).join(', ')}` : 'Synergy: none');
    lines.push(`Spent $${me.spent} of $${budget} · $${me.cash} left${human.allIn ? ' · All-In' : ''}`);
    lines.push('--------------------------------');
    lines.push(results.ranking.map((id, i) => `${i + 1}. ${P[id].name} ${P[id].total}`).join('  '));
    lines.push(`Seed ${results.options.seed}`);
    return lines.join('\n');
  }
}
