// The arcade's programme guide: five shows on one channel. The shell reads this to
// build the title-screen selector and the lobby's game picker, and to decide how many
// seats bots should fill.

export const GAMES = Object.freeze([
  {
    id: 'bidlock',
    name: 'BidLock',
    marquee: 'BIDLOCK',
    slot: '20:00',
    strap: 'The $20 Draft',
    kind: 'Auction draft',
    tagline: 'One $20 budget. Six heated categories. Outbid, bait, and heist your way to the ultimate lineup.',
    people: '1 to 6 players',
    minSeats: 2,
    fillTo: 4,
    how: [
      'Everyone gets the same money and drafts one lot per round, a dollar at a time.',
      'Every bid resets a five-second shot clock. The weakest lot of a round always comes last.',
      'Mystery crates, an Oracle trivia steal, a vault and a heist all move lots between lineups.',
      'Sealed values are revealed at the end. Highest total wins.',
    ],
  },
  {
    id: 'royale',
    name: 'Trapdoor Royale',
    marquee: 'TRAPDOOR',
    slot: '21:00',
    strap: 'Last One Standing',
    kind: 'Trivia elimination',
    tagline: 'Four platforms, one right answer, three trapdoors. Run to the answer you trust and hope the floor holds.',
    people: '1 to 6 players, 12 on the floor',
    minSeats: 2,
    fillTo: 12,
    how: [
      'A question goes up with four answers, one per coloured platform.',
      'Run to a platform with WASD or the arrow keys, press 1 to 4, or click it. You can change your mind until the clock runs out. E shoves: once a question, it pins everyone on your platform for two seconds.',
      'The three wrong platforms drop. So does anyone still dithering in the middle. The first one onto the right platform earns a safety net, which catches them once.',
      'Rounds get faster and questions harder. About every other question carries a twist: a blackout, a shuffle, a crumbling platform, a reprieve, two safe platforms, or half the time.',
      'In sudden death the last one onto the right platform drops too, nets or not. Once you are out, keep calling the answers for the record.',
    ],
  },
  {
    id: 'lamp',
    name: 'Last Lamp',
    marquee: 'LASTLAMP',
    slot: '00:00',
    strap: 'The Undertow',
    kind: 'Trivia survival',
    tagline: 'A storm, a lighthouse, and three flames each. Answer wrong and the hatch opens. Keep one flame alive to the top of the stairs.',
    people: '1 to 6 players, 6 keepers',
    minSeats: 2,
    fillTo: 6,
    how: [
      'Everyone answers each question in secret. Right, and you stay by the fire.',
      'Wrong, and you drop to the Undertow for one of seven survival games. Lose it and one of your three flames goes out. Some questions bring weather: calm, lightning, fog, a strong undertow or a sweeping beacon.',
      'With no flames left you become a wraith. Keep answering: every two right answers is a step of head start on the stairs.',
      'It ends on a true-or-false sprint up the stairs. Wraiths drift up faster, and a wraith that catches a keeper takes their lantern.',
    ],
  },
  {
    id: 'soundclash',
    name: 'Soundclash',
    marquee: 'SNDCLASH', // eight lamps on the sign: a callsign
    slot: '22:00',
    strap: 'The 3-Second Sample Arena',
    kind: 'Name that tune',
    tagline: 'Every player is a sound system. Three seconds of a real song, warped. Name it first, then spend your points throwing dubplates at the leader.',
    people: '1 to 6 players, 6 sounds',
    minSeats: 2,
    fillTo: 6,
    how: [
      'Each of eight rounds loops a three-second hook from a real song, warped: nightcore, chopped and screwed, underwater, or reversed. Pick the title from four with a click or 1 to 4.',
      'Faster is richer: 1,000 points at the drop, 500 by seven seconds. Then the warp lifts and the song plays on, clean, for eight seconds of overtime, worth 350 to 150. You can change your answer until the clock runs out, but your time is when you last picked. Right answers in a row multiply: ×1.2, ×1.5, ×2.',
      'Points are ammunition. Once a round, throw a dubplate at a rival or the leader: Underwater (300) muffles their sound, Scratch (450) scrambles their buttons, Shockwave (600) flips their loop and their card. Z, X and C, and T to change target.',
      'The last round is the dubplate special: clean audio, double points, and a wrong answer costs 250. Pick a crate of music on the title screen or in the lobby.',
    ],
  },
  {
    id: 'coldopen',
    name: 'Cold Open',
    marquee: 'COLDOPEN',
    slot: '23:00',
    strap: 'The Late Movie',
    kind: 'Name that film',
    tagline: 'A few seconds of a real trailer through a faulty projector. Name the film before the changeover, then wreck your rivals’ picture from the booth.',
    people: '1 to 6 players, 6 seats',
    minSeats: 2,
    fillTo: 6,
    how: [
      'Each of eight reels runs a few seconds of a real film trailer on a loop, through a fault: soft focus, a scratched print, a flipped reel, a squeezed widescreen print, a frame slipped out of the gate, an iris, or the negative. Pick the film from four with a click or 1 to 4.',
      'Faster is richer: 1,000 points at the first frame, 500 by eleven seconds. Watch the top-right corner: two cue marks warn of the changeover, when the picture clears and the sound comes up for five seconds, worth 350 to 150. You can change your answer until the clock runs out. Right answers in a row multiply.',
      'Points pay for the projection booth. Once a reel, hit a rival or the leader: Soft Focus (300) blurs their picture, Wrong Reel (450) cuts them to another film and mixes up their answers, Film Burn (600) burns through their picture and breaks their run. Z, X and C, and T to change target.',
      'The last reel is the premiere: a clean print, double points, and a wrong answer costs 250. Pick a programme of films on the title screen or in the lobby: blockbusters, heroes and villains, animated, horror and thrillers, comedy and romance, or classics.',
    ],
  },
]);

export function gameById(id) {
  return GAMES.find((g) => g.id === id) || GAMES[0];
}
