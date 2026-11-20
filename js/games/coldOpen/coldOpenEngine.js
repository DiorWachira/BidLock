// COLD OPEN — rules. Pure: no DOM, video or rendering. Deterministic for a seed.
//
// Channel 20's late movie. Each of eight rounds runs a few seconds of a real trailer
// through a faulty projector, and offers four films. Name it fast: 1,000 points at the
// first frame, falling to 500 by eleven seconds. Then the changeover: the picture clears
// and the sound comes up for five seconds of overtime, worth 350 falling to 150. Right
// answers in a row multiply. Points are also ammunition: from the projection booth, spend
// them to wreck a rival's picture.
//
// It runs on the Soundclash engine with its own spec: the same scoring, bots and room
// sync, with film faults for warps and booth sabotage.

import { SampleArenaEngine, S_PHASE, multFor, pointsFor } from '../sampleArena/sampleArenaEngine.js';

export { S_PHASE as C_PHASE };

export const C_RULES = Object.freeze({
  maxSounds: 6,
  introTime: 4,
  cueTime: 2.4, // the countdown leader: 3, 2, pop
  roundTime: 16,
  warpTime: 11, // then the changeover: clean picture, sound up
  revealTime: 4.5,
  allInGrace: 2,
  warpMax: 1000,
  warpMin: 500,
  overMax: 350,
  overMin: 150,
  finalWrong: 250, // the premiere: a wrong answer costs this
  streaks: [1, 1.2, 1.5, 2],
});

// The print's condition: what is wrong with the picture this round.
export const FAULTS = Object.freeze({
  SOFT_FOCUS: { id: 'SOFT_FOCUS', label: 'Soft focus', badge: 'SOFT FOCUS', line: 'the projectionist is still finding focus' },
  SCRATCHED: { id: 'SCRATCHED', label: 'Scratched print', badge: 'SCRATCHED PRINT', line: 'a worn print: scratches, dust and a flicker' },
  FLIPPED: { id: 'FLIPPED', label: 'Flipped print', badge: 'FLIPPED', line: 'the reel went on the wrong way round: the picture is mirrored' },
  SQUEEZED: { id: 'SQUEEZED', label: 'Squeezed', badge: 'SQUEEZED 2×', line: 'a widescreen print without its lens: everything squeezed in half' },
  RACKED: { id: 'RACKED', label: 'Out of frame', badge: 'OUT OF FRAME', line: 'the frame has slipped in the gate and keeps rolling' },
  IRIS: { id: 'IRIS', label: 'Iris', badge: 'IRIS', line: 'a silent-film iris: one small circle of picture, wandering' },
  NEGATIVE: { id: 'NEGATIVE', label: 'Negative', badge: 'NEGATIVE', line: 'the negative, not the print: colours inverted' },
  PREMIERE: { id: 'PREMIERE', label: 'The premiere', badge: 'PREMIERE · CLEAN PRINT', line: 'a clean print, double points, and a wrong answer costs 250' },
});
export const FAULT_ORDER = Object.freeze(['SOFT_FOCUS', 'SCRATCHED', 'FLIPPED', 'SQUEEZED', 'RACKED', 'IRIS', 'NEGATIVE']);
export const FAULTS_BY_LEVEL = Object.freeze({
  easy: Object.freeze(['SOFT_FOCUS', 'SCRATCHED', 'FLIPPED']),
  normal: Object.freeze(['SOFT_FOCUS', 'SCRATCHED', 'FLIPPED', 'SQUEEZED', 'RACKED', 'IRIS']),
  hard: FAULT_ORDER,
});
// How much each fault hides a film from a bot's eye.
const FAULT_EASE = { SOFT_FOCUS: 0.86, SCRATCHED: 0.86, FLIPPED: 0.8, SQUEEZED: 0.74, RACKED: 0.72, IRIS: 0.6, NEGATIVE: 0.62, PREMIERE: 1 };

// From the projection booth. Once a round, at a rival or the leader.
export const BOOTH = Object.freeze({
  focus: { id: 'focus', name: 'Soft Focus', short: 'SOFT FOCUS', cost: 300, time: 4, line: 'knocks their picture out of focus for four seconds' },
  reel: { id: 'reel', name: 'Wrong Reel', short: 'WRONG REEL', cost: 450, time: 3, perm: true, decoy: true, line: 'cuts them to another film and mixes up their answers for three seconds' },
  burn: { id: 'burn', name: 'Film Burn', short: 'FILM BURN', cost: 600, time: 3, breaks: true, line: 'burns a hole through their picture for three seconds, and breaks their streak' },
});
export const BOOTH_ORDER = Object.freeze(['focus', 'reel', 'burn']);
const BOT_HIT = { focus: { delay: 2, fumble: 0.2, overtime: true }, reel: { delay: 1.8, fumble: 0.55, overtime: true }, burn: { delay: 2.6, fumble: 0.7, overtime: true } };

export const COLD_OPEN = Object.freeze({
  name: 'Cold Open',
  rules: C_RULES,
  warps: { order: FAULT_ORDER, byLevel: FAULTS_BY_LEVEL, final: 'PREMIERE', ease: FAULT_EASE },
  sabotages: BOOTH,
  sabOrder: BOOTH_ORDER,
  botHit: BOT_HIT,
});

export const filmPoints = (at) => pointsFor(C_RULES, at);
export const filmMult = (streak) => multFor(C_RULES, streak);

export class ColdOpenEngine extends SampleArenaEngine {
  constructor() { super(COLD_OPEN); }

  // Every trailer in the match, with where its clip starts (a share of its length) on the
  // end: "…m4v#co=0.42". Guests thread the next reel from this before its round.
  urls() {
    return this.rounds.map((r) => {
      const url = (r.target && r.target.url) || '';
      if (!url || /#co=/.test(url) || r.start == null) return url;
      return `${url}#co=${r.start}`;
    });
  }
}
