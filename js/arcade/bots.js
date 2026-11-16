// House contestants for the quiz games. They do not know the answers: each has a chance
// of being right, a pace, and a habit. BidLock keeps its own three rivals.

export const BOT_ROSTER = Object.freeze([
  { name: 'PIXEL', style: 'expert', skill: 0.8, pace: 0.45 },
  { name: 'MOSS', style: 'herd', skill: 0.45, pace: 0.7 },
  { name: 'JUNO', style: 'bold', skill: 0.55, pace: 0.2 },
  { name: 'RIGBY', style: 'wobbler', skill: 0.6, pace: 0.5 },
  { name: 'TANGO', style: 'chaos', skill: 0.3, pace: 0.35 },
  { name: 'ODETTE', style: 'expert', skill: 0.72, pace: 0.6 },
  { name: 'BRAMBLE', style: 'herd', skill: 0.4, pace: 0.8 },
  { name: 'QUILL', style: 'wobbler', skill: 0.65, pace: 0.55 },
  { name: 'NOVA', style: 'bold', skill: 0.5, pace: 0.15 },
  { name: 'FERN', style: 'herd', skill: 0.5, pace: 0.75 },
  { name: 'COBALT', style: 'expert', skill: 0.68, pace: 0.4 },
  { name: 'WREN', style: 'chaos', skill: 0.35, pace: 0.3 },
]);

export function botProfile(name) {
  return BOT_ROSTER.find((b) => b.name === name) || BOT_ROSTER[0];
}

// Seats for `count` bots, avoiding names already at the table.
export function botSeats(count, taken = []) {
  const used = new Set(taken.map((n) => String(n).toUpperCase()));
  const out = [];
  for (const b of BOT_ROSTER) {
    if (out.length >= count) break;
    if (used.has(b.name)) continue;
    out.push({ name: b.name, kind: 'ai', bot: b.name });
  }
  return out;
}

// A bot's answer to a question with `count` options: right with probability `skill`.
export function botAnswer(profile, correct, count, rng) {
  if (rng() < profile.skill) return correct;
  const wrong = [];
  for (let i = 0; i < count; i++) if (i !== correct) wrong.push(i);
  return wrong[Math.floor(rng() * wrong.length)];
}
