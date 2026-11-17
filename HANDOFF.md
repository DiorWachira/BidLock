# Handoff

Where the work stands, for picking it up after a break. Update this whenever a step finishes.

## Live now

https://diorwachira.github.io/BidLock/ (GitHub Pages, deployed from `main`).

| Game | Folder | What it is | Shipped in |
| --- | --- | --- | --- |
| BidLock | `js/engine`, `js/render`, `js/ui`, `js/main.js` | The $20 draft auction: photos of real lots, Oracle trivia steal, vault, heist, Marathon mode. | #2 |
| Trapdoor Royale | `js/games/trapdoorRoyale/` | Trivia elimination for up to 12: four answer platforms, the wrong ones drop. Six twists (blackout, shuffle, crumble, reprieve, double up, last gasp). | #4, #6, #8 |
| Last Lamp | `js/games/lastLamp/` | Trivia survival in a storm-bound lighthouse: three flames each, seven Undertow survival games, five kinds of weather, wraiths, a final climb. | #4, #6, #8 |

Shared: one room-code lobby (PeerJS, 2 to 6 people, bots fill), a game picker and votes, 310 built-in questions plus the Open Trivia DB, and a per-device memory of asked questions.

## Current task: Soundclash (branch `feat/soundclash`, issue #10)

A fourth game: name the song from a warped three-second loop of a real iTunes preview.

- Folder `js/games/sampleArena/`: `itunesLoader.js` (genres, search, rounds), `synthTunes.js` (offline melodies), `sampleAudioFX.js` (the three audio tiers and the sabotage effects), `sampleArenaEngine.js` (rules), `sampleArena3d.js` (the club), `sampleArenaGame.js` (the screen).
- 8 rounds of 12 s: 8 s warped, 4 s clean overtime. Speed points (1,000 to 500, then 350 to 150 in overtime) times a streak multiplier (1.2x, 1.5x, 2x). The last round is a clean, double-points "dubplate special".
- Sabotages cost points: Underwater 300, Scratch 450, Reverse/Chipmunk 600.
- The audio has three tiers: a decoded Web Audio buffer, then HTML5 audio with a synth overlay, then offline synth tunes (public-domain melodies only).

### Done (on the branch, not merged)

- [x] Loader, offline synth crate (24 public-domain tunes), the three-tier audio, the rules engine, the 3D club and the screen
- [x] Wired into the title channel guide (with a crate picker), the lobby (the host picks the crate; guests see it), the shell and the help drawer
- [x] Balance from simulations against five bots: knowing 50% of songs wins about 23% of matches, knowing 90% wins about 77%. Sabotage pays when aimed at a leader on a streak and loses the match when spammed. Bots hit a leading person about once a match.
- [x] Tests: `tests/soundclash.test.mjs` (rules) and `tests/soundclash.e2e.mjs` (68 browser checks, including all three audio tiers), plus a fix for a start-up bug where a stored arcade game booted with a BidLock lot on the pedestal
- [x] README section and screenshots

### Left

- Merge when the owner says so (merging deploys).
- Not verified: listening to it. The tests prove the audio graph runs (tier, rate, filters, a non-zero spectrum), not that it sounds good. The live iTunes path was played once on this machine (tier 1, all 8 previews decoded, no errors).

### Decisions

- **Concept: a sound clash.** It is drawn from the Jamaican sound-system tradition: each player is a "sound" with a speaker stack, the centre is a Technics-style turntable, and thrown dubplates are the sabotages. It is an original game in the name-that-tune genre, not a copy of SongPop, Heardle or Red Bull Culture Clash.
- **Apple's terms.** iTunes previews are meant to promote the store. The reveal card links each track to its Apple Music page, and the game credits the previews to iTunes.
- **Secrets.** The right option and the artwork stay out of snapshots until the reveal. Guests need the preview URL to play the audio, so a determined guest could look a track up. This is accepted.

## How to check things

- `npm test` runs everything. Or separately: `node --test tests/engine.test.mjs tests/arcade.test.mjs` for the rules, then `node tests/e2e.mjs` (BidLock) and `node tests/arcade.e2e.mjs` (the arcade games) in the browser.
- The browser tests use Playwright's headless shell first: it opens no OS windows and still uses the real GPU. Edge and Chrome are fallbacks; headless Edge and Chrome leave hidden windows that can show in Alt+Tab.
- `node tools/serve.mjs`, then open `http://localhost:5173` to play. Debug parameters: `?trivia=local`, `?media=off`, `?speed=4`, `?seed=1`, `?auto=1`, `?net=local`. For Soundclash, `?music=offline` forces the synth tunes.

## Not verified yet

- Nobody has listened to the sound in the arcade games.
- Rooms have only been tested between tabs on one machine, never across two networks.
- Nobody has independently fact-checked the 260 newer built-in questions.

## Standing rules for this repo

- Feature branch, GitHub issue, pull request. Merging to `main` deploys to GitHub Pages, so ask the owner before merging.
- No attribution lines in commits or pull requests.
