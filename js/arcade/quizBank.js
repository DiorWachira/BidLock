// The question source shared by the quiz games: BidLock's trivia bank in its "party"
// form (the whole built-in bank of 300, at every difficulty, plus the Open Trivia DB
// when reachable), with three extra kinds of prompt built from it: true-or-false trios,
// number estimates and quick sums.

import { TriviaBank } from '../engine/triviaSteal.js';
import { ESTIMATES } from './questionBank.js';

export class QuizBank extends TriviaBank {
  constructor(rng = Math.random, opts = {}) {
    super(rng, { pool: 'party', ...opts });
    this.estimatesUsed = new Set();
  }

  // Three "question -> answer" pairings, each either the right answer (true) or one of
  // the wrong ones (false).
  trio(difficulty = null) {
    const statements = [];
    for (let i = 0; i < 3; i++) {
      const q = this.next({ difficulty });
      const truth = this.rng() < 0.5;
      let idx = q.correct;
      if (!truth) {
        const wrong = q.answers.map((_, k) => k).filter((k) => k !== q.correct);
        idx = wrong[Math.floor(this.rng() * wrong.length)];
      }
      // Odd-one-out and which-came-first questions read badly as statements; ask again.
      if (q.style === 'odd' || q.style === 'first') { i--; this.taken.add(q.id); continue; }
      statements.push({ q: q.text, a: q.answers[idx], truth, topic: q.topic });
    }
    return statements;
  }

  // A number question and four options, none of them exactly right: the point is to be
  // the least wrong.
  estimate() {
    let pool = ESTIMATES.filter((_, i) => !this.estimatesUsed.has(i));
    if (!pool.length) { this.estimatesUsed.clear(); pool = ESTIMATES.slice(); }
    const pick = pool[Math.floor(this.rng() * pool.length)];
    this.estimatesUsed.add(ESTIMATES.indexOf(pick));
    const [text, truth, unit] = pick;
    const year = unit === '' && truth > 1000 && truth < 2100;
    let options;
    if (year) {
      const spread = [-31, -12, 7, 23].map((d) => d + Math.round((this.rng() - 0.5) * 6));
      options = spread.map((d) => truth + (d === 0 ? 3 : d));
    } else {
      const factors = [0.45, 0.78, 1.27, 1.85].map((f) => f * (0.92 + this.rng() * 0.16));
      options = factors.map((f) => round(truth * f, truth));
    }
    options = [...new Set(options)].filter((v) => v !== truth);
    while (options.length < 4) options.push(round(truth * (2.3 + options.length * 0.4), truth));
    options = options.slice(0, 4);
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { text, truth, unit, options, year };
  }
}

// Round a guess to something a person would say: 2 figures for big numbers.
function round(v, truth) {
  if (truth < 1) return Math.round(v * 100) / 100;
  if (truth < 20 && !Number.isInteger(truth)) return Math.round(v * 10) / 10;
  if (v < 20) return Math.max(1, Math.round(v));
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  return Math.round(v / mag) * mag;
}

// How far a guess is from the truth, by ratio, so 50 vs 100 counts like 100 vs 200.
export function guessError(guess, truth, year = false) {
  if (year) return Math.abs(guess - truth);
  return Math.abs(Math.log(Math.max(guess, 1e-6) / truth));
}

// A quick sum with three options, for reflex rounds. `level` 0 to 2 makes it harder.
export function makeSum(rng, level = 0) {
  const pick = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  let text;
  let value;
  const kind = rng();
  if (kind < 0.4) {
    const a = pick(6, 19 + level * 20);
    const b = pick(4, 15 + level * 15);
    text = `${a} + ${b}`;
    value = a + b;
  } else if (kind < 0.7) {
    const a = pick(15, 40 + level * 30);
    const b = pick(3, 14);
    text = `${a} − ${b}`;
    value = a - b;
  } else {
    const a = pick(3, 9 + level * 2);
    const b = pick(3, 9);
    text = `${a} × ${b}`;
    value = a * b;
  }
  const offsets = [1, -1, 2, -2, 10, -10, 3].sort(() => rng() - 0.5);
  const options = [value, value + offsets[0], value + offsets[1]];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { text, options, correct: options.indexOf(value) };
}
