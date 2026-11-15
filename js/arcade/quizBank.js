// The question source shared by the quiz games. It is BidLock's trivia bank (Open Trivia
// DB when reachable, 50 built-in questions otherwise) with two extra kinds of prompt
// built from the same material: true-or-false trios and quick sums.

import { TriviaBank } from '../engine/triviaSteal.js';

export class QuizBank extends TriviaBank {
  // Three "question -> answer" pairings, each of which is either the right answer (true)
  // or one of the wrong ones (false).
  trio() {
    const statements = [];
    for (let i = 0; i < 3; i++) {
      const q = this.next();
      const truth = this.rng() < 0.5;
      let idx = q.correct;
      if (!truth) {
        const wrong = q.answers.map((_, k) => k).filter((k) => k !== q.correct);
        idx = wrong[Math.floor(this.rng() * wrong.length)];
      }
      statements.push({ q: q.text, a: q.answers[idx], truth, topic: q.topic });
    }
    return statements;
  }
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
  // Shuffle the three options.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { text, options, correct: options.indexOf(value) };
}
