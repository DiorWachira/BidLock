// BIDLOCK — first-run guide and help drawer.
// The guide is the floor manager's cue cards: opt-in, never forced, one card per cue.
// It spotlights the real control (which stays clickable), can cross from the title
// screen into a paused rehearsal match, and is reachable again from the GUIDE key or "?".

const $ = (s, r = document) => r.querySelector(s);
const SEEN_KEY = 'bidlock.guide.seen';

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: the invite may show again */ }
}

export const TOUR = [
  { screen: 'title', target: '#channels', title: 'Four shows tonight', body: 'Pick a game here. BidLock is the $20 draft auction. Trapdoor Royale is a trivia elimination for twelve. Last Lamp is trivia survival in a storm. Soundclash is name-that-tune with warped songs and sabotage. This walk-through covers BidLock.' },
  { screen: 'title', target: '#mode-budget', title: 'Pick your bankroll', body: 'Everyone at the table gets the same money. $20 is the classic: six lots to buy, so about three dollars each. $50 is looser and louder.' },
  { screen: 'title', target: '#mode-allin', title: 'Reserve or All-In', body: 'Normally the house holds back $1 for every slot you still have to fill, so you can never get stuck. Tick All-In to spend the lot. Any slot you cannot fill gets a $0 Penalty Dud.' },
  { screen: 'title', target: '#hero', title: 'Tonight\'s catalogue', body: 'Hover or tap a category to put a lot on the pedestal, with its real photograph. The lamps show hype, which everyone can see. The real value stays sealed until the verdict, and hype is sometimes wrong.' },
  { screen: 'title', target: '#btn-friends', title: 'Solo, or with friends', body: 'Solo puts you against three house rivals. Play with friends opens a room: you get a five-character code, up to six people join from their own browsers, and bots can fill the empty seats.' },
  { screen: 'game', target: '#rundown', title: 'The running order', body: 'Each round sells four lots from one category and every contender must take exactly one. It is musical chairs: three real lots, then a booby prize that goes to whoever is left for $1. Commit too early and you overpay. Never commit and you get the stinker.' },
  { screen: 'game', target: '#lotcard', title: 'The lot on the block', body: 'Photograph, name, hype and tags. Three lots sharing a tag pay +40 at the verdict, so a middling lot can be worth chasing if it completes a set.' },
  { screen: 'game', target: '#bidblock', title: 'Price and shot clock', body: 'Lots open at $1. Every bid resets the clock to five seconds. Going once at 3, going twice at 2, last call at 1, then the hammer.' },
  { screen: 'game', target: '#actions', title: 'Your three moves', body: 'Space or B bids one dollar more. J jumps two. P drops you out of this lot for good. You cannot raise your own high bid.' },
  { screen: 'game', target: '#desk', title: 'Your desk', body: 'Cash, the most you may bid on this lot, your lineup, and your tags. Spend big early and you will be watching rounds five and six from the cheap seats.' },
  { screen: 'game', target: '#rivals', title: 'The room', body: 'LEDGER bids late and never overpays. HAVOC jumps junk and crates to bait you, then drops out. THRIFT hoards for three rounds and sweeps the last three. Watch their moods.' },
  { screen: 'game', target: '#stage', title: 'Crates, the Oracle, vault and heist', body: 'Two sealed crates turn up mid-show: jackpot or curse. Between rounds the Oracle may hand one contender a hard question: get it right and steal any lot at half price, or gamble on a second question to take it free. After the last lot, $2 locks a lot in your vault, then leftover cash buys one steal from any unlocked lineup.' },
  { screen: 'any', target: '#btn-help', title: 'Where to find this again', body: 'The GUIDE key, or ? on your keyboard, opens the run sheet: this walk-through, the keys, and every rule. That is everything. You are on air.' },
];

export class Guide {
  constructor({ getScreen, ensureScreen, onOpen, onClose }) {
    this.getScreen = getScreen;
    this.ensureScreen = ensureScreen;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.active = false;
    this.steps = [];
    this.i = 0;
    this.root = $('#guide');
    this.card = $('#cue');
    this.spot = $('#cue-spot');
    this.veils = [...this.root.querySelectorAll('.veil')];
    this.live = $('#guide-live');
    this.invite = $('#invite');
    this._reposition = () => { if (this.active) this._place(); };

    $('#cue-next').addEventListener('click', () => this.next());
    $('#cue-back').addEventListener('click', () => this.back());
    $('#cue-close').addEventListener('click', () => this.stop());
    $('#invite-start').addEventListener('click', () => { this.hideInvite(); this.start('full'); });
    $('#invite-skip').addEventListener('click', () => this.hideInvite());
    window.addEventListener('resize', this._reposition);
    window.addEventListener('scroll', this._reposition, true);
    document.addEventListener('keydown', (e) => this._key(e), true);
  }

  // Shown once, on the first visit, and only as an offer.
  maybeInvite() {
    if (seen()) return false;
    this.invite.hidden = false;
    requestAnimationFrame(() => this.invite.classList.add('on'));
    markSeen();
    return true;
  }

  hideInvite() {
    markSeen();
    this.invite.classList.remove('on');
    this.invite.hidden = true;
  }

  // mode 'full': the whole walk. mode 'screen': only the cues for what is on screen now.
  async start(mode = 'full') {
    this.hideInvite();
    const screen = this.getScreen();
    let steps;
    if (mode === 'screen') steps = TOUR.filter((s) => s.screen === screen || s.screen === 'any');
    else if (screen === 'title') steps = TOUR.slice();
    else steps = TOUR.filter((s) => s.screen !== 'title');
    if (screen !== 'title' && screen !== 'game') steps = TOUR.filter((s) => s.screen === 'any');
    if (!steps.length) return;
    this.steps = steps;
    this.i = 0;
    this.active = true;
    this.returnFocus = document.activeElement;
    this.root.hidden = false;
    this.onOpen();
    await this._show();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.root.hidden = true;
    this.live.textContent = 'Guide closed.';
    this.onClose();
    if (this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus({ preventScroll: true });
  }

  next() {
    if (this.i >= this.steps.length - 1) { this.stop(); return; }
    this.i++;
    this._show(1);
  }

  back() {
    if (this.i <= 0) return;
    this.i--;
    this._show(-1);
  }

  async _show(dir = 1) {
    // Find the next cue whose target is actually on screen, crossing screens if needed.
    for (let guard = 0; guard < this.steps.length; guard++) {
      const step = this.steps[this.i];
      if (step.screen !== 'any' && step.screen !== this.getScreen()) await this.ensureScreen(step.screen);
      if (!this.active) return;
      const el = $(step.target);
      if (el && el.getClientRects().length) break;
      const n = this.i + dir;
      if (n < 0 || n >= this.steps.length) { if (dir < 0) { dir = 1; continue; } this.stop(); return; }
      this.i = n;
    }
    const step = this.steps[this.i];
    const el = $(step.target);
    this.target = el;
    const n = this.i + 1;
    const N = this.steps.length;
    $('#cue-count').textContent = `CUE ${n} / ${N}`;
    $('#cue-title').textContent = step.title;
    $('#cue-body').textContent = step.body;
    $('#cue-bar').style.setProperty('--p', `${(n / N) * 100}%`);
    $('#cue-back').disabled = this.i === 0;
    $('#cue-next').textContent = n === N ? 'FINISH' : 'NEXT';
    this.live.textContent = `Cue ${n} of ${N}. ${step.title}. ${step.body}`;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    this._place();
    requestAnimationFrame(() => {
      this._place();
      $('#cue-next').focus({ preventScroll: true });
    });
  }

  _place() {
    const el = this.target;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    const pad = 6;
    const x0 = Math.max(0, r.left - pad);
    const y0 = Math.max(0, r.top - pad);
    const x1 = Math.min(vw, r.right + pad);
    const y1 = Math.min(vh, r.bottom + pad);
    const [vt, vb, vl, vr] = this.veils;
    vt.style.cssText = `left:0;top:0;width:${vw}px;height:${y0}px`;
    vb.style.cssText = `left:0;top:${y1}px;width:${vw}px;height:${Math.max(0, vh - y1)}px`;
    vl.style.cssText = `left:0;top:${y0}px;width:${x0}px;height:${Math.max(0, y1 - y0)}px`;
    vr.style.cssText = `left:${x1}px;top:${y0}px;width:${Math.max(0, vw - x1)}px;height:${Math.max(0, y1 - y0)}px`;
    this.spot.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px`;

    const card = this.card;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 14;
    const phone = vw <= 640;
    let left;
    let top;
    let dock = '';
    if (phone) {
      // Dock to whichever edge is further from the target.
      const mid = (y0 + y1) / 2;
      dock = mid > vh / 2 ? 'top' : 'bottom';
      left = 8;
      top = dock === 'top' ? 8 : vh - ch - 8;
    } else if (vh - y1 >= ch + gap + 8) { top = y1 + gap; left = x0 + (x1 - x0) / 2 - cw / 2; }
    else if (y0 >= ch + gap + 8) { top = y0 - gap - ch; left = x0 + (x1 - x0) / 2 - cw / 2; }
    else if (vw - x1 >= cw + gap + 8) { left = x1 + gap; top = y0 + (y1 - y0) / 2 - ch / 2; }
    else if (x0 >= cw + gap + 8) { left = x0 - gap - cw; top = y0 + (y1 - y0) / 2 - ch / 2; }
    else { left = vw - cw - 16; top = vh - ch - 16; }
    left = Math.max(8, Math.min(vw - cw - 8, left));
    top = Math.max(8, Math.min(vh - ch - 8, top));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.dataset.dock = dock;
  }

  _key(e) {
    if (!this.active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.stop(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.next(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); this.back(); return; }
    if (e.key === 'Tab') {
      // Keep focus on the card's controls.
      const f = [...this.card.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const idx = f.indexOf(document.activeElement);
      e.preventDefault();
      e.stopPropagation();
      const n = idx === -1 ? 0 : (idx + (e.shiftKey ? -1 : 1) + f.length) % f.length;
      f[n].focus({ preventScroll: true });
      return;
    }
    // While a cue is up, game hotkeys stay quiet (Enter and Space still press the focused card button).
    if (!['Enter', ' '].includes(e.key)) e.stopPropagation();
    else if (!this.card.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); }
  }
}

export class HelpDrawer {
  constructor({ onOpen, onClose, onTour }) {
    this.el = $('#drawer');
    this.scrim = $('#drawer-scrim');
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.open_ = false;
    $('#drawer-close').addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', () => this.close());
    $('#drawer-tour').addEventListener('click', () => { this.close(true); onTour('full'); });
    $('#drawer-tour-screen').addEventListener('click', () => { this.close(true); onTour('screen'); });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      if (e.key !== 'Tab') return;
      const f = [...this.el.querySelectorAll('button, [href], [tabindex="0"]')].filter((x) => !x.disabled);
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  get isOpen() { return this.open_; }

  open() {
    if (this.open_) return;
    this.open_ = true;
    this.returnFocus = document.activeElement;
    this.el.hidden = false;
    this.scrim.hidden = false;
    requestAnimationFrame(() => { this.el.classList.add('on'); $('#drawer-close').focus(); });
    this.onOpen();
  }

  close(silent = false) {
    if (!this.open_) return;
    this.open_ = false;
    this.el.classList.remove('on');
    this.el.hidden = true;
    this.scrim.hidden = true;
    this.onClose();
    if (!silent && this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus({ preventScroll: true });
  }

  toggle() { if (this.open_) this.close(); else this.open(); }
}
