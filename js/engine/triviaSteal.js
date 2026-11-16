// BIDLOCK 2.0 — the Oracle: a general-knowledge steal with a double-or-nothing gamble.
//
// Between rounds the Oracle may pick one contender. They get one hard question. Right,
// and they may take any rival's lot for half what the rival paid. Before the lot moves
// they may gamble: answer a second question to take it for nothing, or lose the steal.
//
// Questions come from the Open Trivia DB when it is reachable, filtered to proper general
// knowledge, with a built-in bank of 50 as the fallback. Like the auction engine, this
// file has no DOM, audio or rendering in it.

import { QUESTIONS, questionId } from '../arcade/questionBank.js';

export const ORACLE = Object.freeze({
  chance: 0.45, // per gap between rounds, from the end of round 2
  max: 2, // per match
  introTime: 3.4,
  questionTime: 15,
  revealTime: 2.2,
  pickTime: 14,
  gambleTime: 10,
  resultTime: 3.6,
});

export const OPENTDB_URL = 'https://opentdb.com/api.php?amount=30&difficulty=hard&type=multiple';


const NAMED = {
  quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ', shy: '', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', deg: '°', pi: 'π', times: '×', divide: '÷', micro: 'µ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', aring: 'å',
  iacute: 'í', icirc: 'î', iuml: 'ï', oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', oslash: 'ø', uacute: 'ú',
  ugrave: 'ù', ucirc: 'û', uuml: 'ü', ntilde: 'ñ', ccedil: 'ç', szlig: 'ß', Eacute: 'É', Ouml: 'Ö', Uuml: 'Ü',
  Aring: 'Å', Auml: 'Ä', Oslash: 'Ø', aelig: 'æ', AElig: 'Æ', pound: '£', euro: '€', sup2: '²', frac12: '½',
};

// Open Trivia DB sends text with HTML entities. Decode them without touching the DOM.
export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : whole;
  });
}

// [question, correct answer, three wrong answers, topic]
export const FALLBACK_QUESTIONS = Object.freeze([
  ['In which year was the last Western Roman emperor, Romulus Augustulus, deposed?', '476', '410', '455', '527', 'History'],
  ['Which settlement ended the Thirty Years\' War in 1648?', 'The Peace of Westphalia', 'The Treaty of Utrecht', 'The Peace of Augsburg', 'The Treaty of Tordesillas', 'History'],
  ['Who was the first emperor of a unified China?', 'Qin Shi Huang', 'Emperor Wu of Han', 'Kublai Khan', 'Liu Bang', 'History'],
  ['Which English king was killed at the Battle of Bosworth Field in 1485?', 'Richard III', 'Henry VI', 'Edward IV', 'Richard II', 'History'],
  ['Mansa Musa, famed for his pilgrimage to Mecca in 1324, ruled which empire?', 'The Mali Empire', 'The Songhai Empire', 'The Ghana Empire', 'The Kingdom of Kush', 'History'],
  ['Who wrote the Ninety-five Theses of 1517?', 'Martin Luther', 'John Calvin', 'Jan Hus', 'Erasmus', 'History'],
  ['Which city was the capital of the Byzantine Empire?', 'Constantinople', 'Antioch', 'Ravenna', 'Nicaea', 'History'],
  ['The Rosetta Stone carries the same decree in hieroglyphic, Demotic and which other script?', 'Ancient Greek', 'Latin', 'Aramaic', 'Coptic', 'History'],
  ['Which war was ended by the Treaty of Ghent?', 'The War of 1812', 'The Crimean War', 'The Seven Years\' War', 'The War of the Spanish Succession', 'History'],
  ['Who was the last active ruler of Ptolemaic Egypt?', 'Cleopatra VII', 'Nefertiti', 'Hatshepsut', 'Ptolemy I', 'History'],
  ['In which year was Magna Carta first sealed?', '1215', '1066', '1348', '1415', 'History'],
  ['Which metal has the highest melting point?', 'Tungsten', 'Osmium', 'Rhenium', 'Tantalum', 'Science'],
  ['Which particle carries the electromagnetic force?', 'The photon', 'The gluon', 'The W boson', 'The graviton', 'Science'],
  ['In a cell, which structure is the site of protein synthesis?', 'The ribosome', 'The Golgi apparatus', 'The lysosome', 'The mitochondrion', 'Science'],
  ['What is the SI unit of electrical capacitance?', 'The farad', 'The henry', 'The siemens', 'The weber', 'Science'],
  ['Which physicist formulated the uncertainty principle in 1927?', 'Werner Heisenberg', 'Erwin Schrödinger', 'Niels Bohr', 'Paul Dirac', 'Science'],
  ['What is the chemical symbol for tungsten?', 'W', 'Tu', 'Tn', 'Tg', 'Science'],
  ['Which planet in the Solar System takes longest to rotate once on its axis?', 'Venus', 'Mercury', 'Neptune', 'Mars', 'Science'],
  ['Which mineral defines 1, the softest point, on the Mohs scale of hardness?', 'Talc', 'Gypsum', 'Calcite', 'Fluorite', 'Science'],
  ['To the nearest thousand, what is the speed of light in a vacuum, in kilometres per second?', '300,000', '186,000', '343,000', '1,080,000', 'Science'],
  ['Avogadro\'s constant is approximately which of these?', '6.022 × 10^23', '1.602 × 10^-19', '6.626 × 10^-34', '9.81 × 10^23', 'Science'],
  ['Which is the only non-metallic element that is liquid at room temperature?', 'Bromine', 'Iodine', 'Chlorine', 'Selenium', 'Science'],
  ['In DNA, which base pairs with adenine?', 'Thymine', 'Cytosine', 'Guanine', 'Uracil', 'Science'],
  ['Which is the longest river in Asia?', 'The Yangtze', 'The Mekong', 'The Ganges', 'The Yellow River', 'Geography'],
  ['What is the capital of Kazakhstan?', 'Astana', 'Almaty', 'Tashkent', 'Bishkek', 'Geography'],
  ['Counting overseas territories, which country spans the most time zones?', 'France', 'Russia', 'The United States', 'The United Kingdom', 'Geography'],
  ['The Strait of Malacca separates the Malay Peninsula from which island?', 'Sumatra', 'Borneo', 'Java', 'Sulawesi', 'Geography'],
  ['Which is the deepest lake in Africa?', 'Lake Tanganyika', 'Lake Victoria', 'Lake Malawi', 'Lake Turkana', 'Geography'],
  ['Which is the driest non-polar desert on Earth?', 'The Atacama', 'The Gobi', 'The Namib', 'The Mojave', 'Geography'],
  ['Which is the smallest country on the African mainland by area?', 'The Gambia', 'Eswatini', 'Djibouti', 'Lesotho', 'Geography'],
  ['Which river flows through Baghdad?', 'The Tigris', 'The Euphrates', 'The Jordan', 'The Nile', 'Geography'],
  ['Which country is entirely surrounded by South Africa?', 'Lesotho', 'Eswatini', 'Botswana', 'Malawi', 'Geography'],
  ['Who wrote "One Hundred Years of Solitude"?', 'Gabriel García Márquez', 'Jorge Luis Borges', 'Mario Vargas Llosa', 'Isabel Allende', 'Literature'],
  ['In which novel is Raskolnikov the central character?', 'Crime and Punishment', 'The Brothers Karamazov', 'War and Peace', 'Dead Souls', 'Literature'],
  ['Who wrote "Things Fall Apart"?', 'Chinua Achebe', 'Wole Soyinka', 'Ngũgĩ wa Thiong\'o', 'Ben Okri', 'Literature'],
  ['Which epic poem opens with the anger of Achilles?', 'The Iliad', 'The Odyssey', 'The Aeneid', 'Metamorphoses', 'Literature'],
  ['Who wrote "The Canterbury Tales"?', 'Geoffrey Chaucer', 'William Langland', 'John Milton', 'Edmund Spenser', 'Literature'],
  ['In which Shakespeare play do Goneril, Regan and Cordelia appear?', 'King Lear', 'Macbeth', 'Othello', 'The Tempest', 'Literature'],
  ['"Call me Ishmael" is the opening line of which novel?', 'Moby-Dick', 'Heart of Darkness', 'Billy Budd', 'The Old Man and the Sea', 'Literature'],
  ['Who painted "The Garden of Earthly Delights"?', 'Hieronymus Bosch', 'Pieter Bruegel the Elder', 'Jan van Eyck', 'Albrecht Dürer', 'Art'],
  ['Which composer wrote "The Four Seasons"?', 'Antonio Vivaldi', 'Johann Sebastian Bach', 'George Frideric Handel', 'Arcangelo Corelli', 'Art'],
  ['Who made the bronze sculpture "The Thinker"?', 'Auguste Rodin', 'Donatello', 'Gian Lorenzo Bernini', 'Constantin Brâncuși', 'Art'],
  ['Which Dutch master painted "The Night Watch"?', 'Rembrandt', 'Johannes Vermeer', 'Frans Hals', 'Vincent van Gogh', 'Art'],
  ['What is the sum of the interior angles of a hexagon?', '720 degrees', '540 degrees', '900 degrees', '1080 degrees', 'Logic'],
  ['What is the next prime number after 89?', '97', '91', '93', '95', 'Logic'],
  ['How many edges does a regular dodecahedron have?', '30', '20', '12', '24', 'Logic'],
  ['What is the decimal number 37 written in binary?', '100101', '100111', '101001', '110101', 'Logic'],
  ['At exactly 3:15, what is the angle between the hands of a clock?', '7.5 degrees', '0 degrees', '15 degrees', '22.5 degrees', 'Logic'],
  ['What is 17 squared minus 13 squared?', '120', '100', '130', '144', 'Logic'],
  ['Which of these numbers is both a perfect square and a perfect cube?', '64', '36', '100', '125', 'Logic'],
]);

// Open Trivia DB mixes in film, game and celebrity questions. Keep the proper general knowledge.
const KEEP_TOPIC = /general knowledge|^science|history|geography|^art$|mythology|books|politics|animals/i;

function shuffleWith(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIFFICULTY = { easy: 1, medium: 2, hard: 3 };
export const OPENTDB_PARTY_URL = 'https://opentdb.com/api.php?amount=50&type=multiple';
export const OPENTDB_TOKEN_URL = 'https://opentdb.com/api_token.php?command=request';

// One shape for every question, wherever it came from.
function entry(id, text, correct, wrong, topic, difficulty, style, source) {
  return { id, text, correct, wrong, topic: topic || 'General knowledge', difficulty, style: style || 'mc', source };
}

export class TriviaBank {
  // pool 'oracle': hard general knowledge only, for BidLock's Oracle.
  // pool 'party':  everything, at every difficulty, for the quiz games.
  // seen: ids asked in earlier matches on this device; they are kept back until the
  // unseen ones run out.
  constructor(rng = Math.random, { pool = 'oracle', seen = null } = {}) {
    this.rng = rng;
    this.pool = pool;
    this.seen = new Set(seen || []);
    this.taken = new Set();
    this.usedIds = [];
    this.remote = [];
    this.source = 'built-in';
    const base = FALLBACK_QUESTIONS.map((q) => entry(questionId(q[0], q[1]), q[0], q[1], q.slice(2, 5), q[5], 3, 'mc', 'local'));
    const extra = QUESTIONS
      .filter((q) => pool === 'party' || (q[0] === 3 && q[1] !== 'Pop culture'))
      .map((q) => entry(questionId(q[3], q[4]), q[3], q[4], q.slice(5, 8), q[1], q[0], q[2], 'local'));
    this.local = shuffleWith([...base, ...extra], rng);
  }

  get size() { return this.local.length + this.remote.length; }

  // Try the Open Trivia DB. Never throws: on any failure the built-in bank is used.
  // A session token (kept by the caller between matches) stops the service sending
  // the same question twice until it has run out of them.
  async load({ fetchImpl = null, url = null, timeoutMs = 6000, token = null, onToken = null } = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    const get = async (u) => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try {
        const res = await doFetch(u, ctrl ? { signal: ctrl.signal } : undefined);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const base = url || (this.pool === 'party' ? OPENTDB_PARTY_URL : OPENTDB_URL);
    try {
      let tok = token;
      if (!tok && onToken) {
        const t = await get(OPENTDB_TOKEN_URL).catch(() => null);
        if (t && t.response_code === 0 && t.token) { tok = t.token; onToken(tok); }
      }
      let data = await get(tok ? `${base}&token=${encodeURIComponent(tok)}` : base);
      // 3: the token has expired. 4: it has seen every question. Start a fresh one.
      if (data && (data.response_code === 3 || data.response_code === 4) && onToken) {
        const t = await get(OPENTDB_TOKEN_URL).catch(() => null);
        if (t && t.response_code === 0 && t.token) { onToken(t.token); data = await get(`${base}&token=${encodeURIComponent(t.token)}`); }
      }
      if (!data || data.response_code !== 0 || !Array.isArray(data.results)) throw new Error('no questions');
      const good = [];
      for (const r of data.results) {
        if (!r || r.type !== 'multiple' || !Array.isArray(r.incorrect_answers) || r.incorrect_answers.length !== 3) continue;
        const category = decodeEntities(r.category || '');
        if (this.pool === 'oracle' && !KEEP_TOPIC.test(category)) continue;
        const topic = category.replace(/^Science: /, '').replace(/^Entertainment: /, '');
        const text = decodeEntities(r.question);
        const correct = decodeEntities(r.correct_answer);
        const wrong = r.incorrect_answers.map(decodeEntities);
        if (new Set([correct, ...wrong]).size !== 4) continue;
        const d = DIFFICULTY[r.difficulty] || (this.pool === 'oracle' ? 3 : 2);
        good.push(entry(questionId(text, correct), text, correct, wrong, topic, d, 'mc', 'remote'));
      }
      this.remote = good.filter((q) => !this.seen.has(q.id));
      if (this.remote.length) this.source = 'Open Trivia DB';
      return this.remote.length;
    } catch {
      return 0;
    }
  }

  // The next question, with its four answers in a shuffled order. `difficulty` (1-3)
  // is a preference: the nearest available level is used if that one has run out.
  next({ difficulty = null } = {}) {
    let q = this._pick(difficulty, true) || this._pick(difficulty, false);
    if (!q) {
      // Every question has been asked this match: start round the bank again.
      this.taken.clear();
      q = this._pick(difficulty, false);
    }
    this.taken.add(q.id);
    this.usedIds.push(q.id);
    const answers = shuffleWith([q.correct, ...q.wrong], this.rng);
    return { id: q.id, text: q.text, answers, correct: answers.indexOf(q.correct), topic: q.topic, difficulty: q.difficulty, style: q.style };
  }

  _pick(difficulty, unseenOnly) {
    const ok = (q) => !this.taken.has(q.id) && (!unseenOnly || !this.seen.has(q.id));
    const remote = this.remote.filter(ok);
    const local = this.local.filter(ok);
    if (!remote.length && !local.length) return null;
    const near = (list, gap) => (difficulty == null ? list : list.filter((q) => Math.abs(q.difficulty - difficulty) <= gap));
    for (const gap of [0, 1, 2]) {
      const r = near(remote, gap);
      const l = near(local, gap);
      if (!r.length && !l.length) continue;
      // Fresh questions from the service come first, in the order it sent them, but the
      // built-in styles (odd one out, which came first, sayings) still get a turn.
      const useRemote = r.length && (!l.length || this.pool === 'oracle' || this.rng() < 0.6);
      if (useRemote) return r[0];
      return l[Math.floor(this.rng() * l.length)];
    }
    return null;
  }
}

export function halfPrice(price) {
  return Math.max(1, Math.floor(price / 2));
}

export class OracleSteal {
  constructor(engine) {
    this.engine = engine;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.stage = null; // intro | q1 | reveal | pick | gamble | q2 | result
    this.t = 0;
    this.player = null;
    this.n = 0;
    this.question = null;
    this.correct = -1;
    this.picked = null;
    this.right = null;
    this.target = null;
    this.outcome = null;
    this.next = null;
    this.plan = null;
  }

  get active() { return this.stage != null; }

  // Cash a contender can put towards a steal without breaking their $1-per-slot reserve.
  spare(c) {
    return c.allIn ? c.cash : c.cash - this.engine.emptySlots(c);
  }

  // Every lot this contender could take at half price right now.
  optionsFor(c) {
    const out = [];
    const spare = this.spare(c);
    for (const victim of this.engine.contenders) {
      if (victim.id === c.id) continue;
      for (const entry of this.engine.allEntries(victim)) {
        if (entry.dud || (entry.mystery && !entry.revealed)) continue;
        const cost = halfPrice(entry.price);
        if (cost > spare) continue;
        out.push({ victim, entry, cost, mine: entry.mystery ? null : c.roster[entry.catId] || null });
      }
    }
    return out;
  }

  // Called by the engine when a round ends. Returns true if the Oracle takes over.
  maybeTrigger(catIndex) {
    const e = this.engine;
    const total = e.categories.length;
    if (catIndex < 1 || catIndex >= total - 1 || this.count >= ORACLE.max) return false;
    const chance = e.options.oracleChance == null ? ORACLE.chance : e.options.oracleChance;
    if (e.rng() >= chance) return false;
    const eligible = e.contenders.filter((c) => !c.away && e.emptySlots(c) >= 1 && this.optionsFor(c).length > 0);
    if (!eligible.length) return false;
    const forced = e.options.oracleSeat;
    const chosen = forced != null && eligible.some((c) => c.id === forced) ? e.contenders[forced] : eligible[Math.floor(e.rng() * eligible.length)];
    this.count++;
    this.player = chosen.id;
    this.n = 0;
    this.question = null;
    this.correct = -1;
    this.picked = null;
    this.right = null;
    this.target = null;
    this.outcome = null;
    this.plan = null;
    e._setPhase('ORACLE');
    this.stage = 'intro';
    this.t = ORACLE.introTime;
    e.emit('oracle', { stage: 'intro', player: chosen.id });
    return true;
  }

  _ask(n) {
    const e = this.engine;
    const q = e.trivia.next();
    this.n = n;
    this.question = { text: q.text, answers: q.answers, topic: q.topic };
    this.correct = q.correct;
    this.picked = null;
    this.right = null;
    this.stage = n === 1 ? 'q1' : 'q2';
    this.t = ORACLE.questionTime;
    this.plan = null;
    e.emit('oracle', { stage: 'question', n, player: this.player });
    const ai = e.aiFor(this.player);
    if (ai) {
      const idx = ai.oracleAnswer(this.correct, q.answers.length);
      this.plan = { t: 3 + e.rng() * 6, run: () => this.answer(this.player, idx) };
    }
  }

  update(dt) {
    if (!this.stage) return;
    this.t -= dt;
    if (this.plan) {
      this.plan.t -= dt;
      if (this.plan.t <= 0) {
        const run = this.plan.run;
        this.plan = null;
        run();
        return;
      }
    }
    if (this.t > 0) return;
    switch (this.stage) {
      case 'intro': this._ask(1); break;
      case 'q1':
      case 'q2': this._fail('timeout'); break;
      case 'reveal': {
        const step = this.next;
        this.next = null;
        if (step === 'pick') this._openPick();
        else if (step === 'free') this._steal(true);
        else this._fail(step === 'forfeit' ? 'forfeit' : 'wrong');
        break;
      }
      case 'pick': this._fail('nopick'); break;
      case 'gamble': this._steal(false); break; // no answer means the safe option
      case 'result': this._end(); break;
      default: break;
    }
  }

  answer(id, index) {
    if (this.engine.mirror || (this.stage !== 'q1' && this.stage !== 'q2') || id !== this.player || this.picked != null) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.question.answers.length) return false;
    const second = this.stage === 'q2';
    this.picked = index;
    this.right = index === this.correct;
    this.plan = null;
    this.stage = 'reveal';
    this.t = ORACLE.revealTime;
    this.next = this.right ? (second ? 'free' : 'pick') : (second ? 'forfeit' : 'wrong');
    this.engine.emit('oracle', { stage: 'answer', n: this.n, player: id, picked: index, correct: this.correct, right: this.right });
    return true;
  }

  _openPick() {
    const e = this.engine;
    const c = e.contenders[this.player];
    const options = this.optionsFor(c);
    if (!options.length) { this._fail('nolot'); return; }
    this.stage = 'pick';
    this.t = ORACLE.pickTime;
    e.emit('oracle', { stage: 'pick', player: this.player });
    const ai = e.aiFor(this.player);
    if (ai) {
      const o = ai.oraclePick(options);
      this.plan = { t: 2 + e.rng() * 3, run: () => this.pick(this.player, o.victim.id, o.entry.item.id) };
    }
  }

  pick(id, victimId, itemId) {
    if (this.engine.mirror || this.stage !== 'pick' || id !== this.player) return false;
    const e = this.engine;
    const o = this.optionsFor(e.contenders[id]).find((x) => x.victim.id === victimId && x.entry.item.id === itemId);
    if (!o) return false;
    this.target = { victim: victimId, itemId, cost: o.cost };
    this.stage = 'gamble';
    this.t = ORACLE.gambleTime;
    this.plan = null;
    e.emit('oracle', { stage: 'gamble', player: id, victim: victimId, entry: o.entry, cost: o.cost });
    const ai = e.aiFor(id);
    if (ai) {
      const risk = ai.oracleGamble(o.cost);
      this.plan = { t: 2 + e.rng() * 3, run: () => this.gamble(id, risk) };
    }
    return true;
  }

  gamble(id, risk) {
    if (this.engine.mirror || this.stage !== 'gamble' || id !== this.player) return false;
    this.plan = null;
    if (risk) {
      this.engine.emit('oracle', { stage: 'risk', player: id });
      this._ask(2);
    } else {
      this._steal(false);
    }
    return true;
  }

  _steal(free) {
    const e = this.engine;
    const thief = e.contenders[this.player];
    const victim = e.contenders[this.target.victim];
    const entry = e.allEntries(victim).find((x) => x.item.id === this.target.itemId);
    if (!entry) { this._fail('nolot'); return; }
    const half = halfPrice(entry.price);
    const cost = free ? 0 : half;
    if (cost > thief.cash) { this._fail('nolot'); return; }
    thief.cash -= cost;
    thief.spent += cost;
    // The victim always gets the half price back. On a free steal the house pays it.
    victim.cash += half;
    victim.refund += half;
    const given = e._moveEntry(thief, victim, entry);
    this.outcome = { kind: 'steal', free, cost, half, victim: victim.id, itemId: entry.item.id };
    this.stage = 'result';
    this.t = ORACLE.resultTime;
    this.plan = null;
    e.emit('oracle', { stage: 'steal', thief: thief.id, victim: victim.id, taken: entry, given, cost, half, free });
    for (const ai of e.ais) ai.onHeist({ thief: thief.id, victim: victim.id });
  }

  _fail(why) {
    this.outcome = { kind: 'fail', why };
    this.stage = 'result';
    this.t = ORACLE.resultTime;
    this.plan = null;
    this.engine.emit('oracle', { stage: 'fail', player: this.player, why, correct: this.correct });
  }

  _end() {
    this.stage = null;
    this.plan = null;
    this.engine.emit('oracle', { stage: 'end', player: this.player });
    this.engine._advance();
  }

  // The correct answer is only put on the wire once the question has been answered.
  serialize() {
    const answered = this.picked != null || this.stage === 'result';
    return {
      count: this.count, stage: this.stage, t: this.t, player: this.player, n: this.n,
      question: this.question, correct: answered ? this.correct : -1,
      picked: this.picked, right: this.right, target: this.target, outcome: this.outcome,
    };
  }

  hydrate(o) {
    this.reset();
    if (!o) return;
    Object.assign(this, {
      count: o.count, stage: o.stage, t: o.t, player: o.player, n: o.n, question: o.question,
      correct: o.correct, picked: o.picked, right: o.right, target: o.target, outcome: o.outcome,
    });
  }
}
