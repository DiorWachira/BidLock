# Handoff

Where the work stands, for picking it up after a break. Update this whenever a step finishes.

## Current task: the party arcade (branch `feat/arcade`, issue #3)

Turn BidLock into three games on one "channel", sharing the lobby, sound and trivia engines.

| Game | Folder | What it is |
| --- | --- | --- |
| BidLock | `js/engine`, `js/render`, `js/ui`, `js/main.js` | The $20 draft auction. Live since 2.0. |
| Trapdoor Royale | `js/games/trapdoorRoyale/` | Trivia elimination for up to 12: four answer platforms, the wrong ones drop. |
| Last Lamp | `js/games/lastLamp/` | Trivia survival in a storm-bound lighthouse: three flames each, wrong answers send you to the Undertow for a survival minigame, snuffed players become wraiths, and it ends with a climb. |

### Decisions already made (do not reopen without the owner)

- **Names.** The brief called game 2 "Trivia Royale", which is the name of an existing mobile game, so it is "Trapdoor Royale". The brief's game 3 ("Hotel Grim: Killing Floor", dolls in a murder hotel, chalices, a ghost escape corridor) would have been a recreation of Jackbox's Trivia Murder Party, so it is an original game with the same ingredients the owner asked for: a spooky 3D set, three-life avatars, ghosts that can steal a body at the end, four survival minigames, a final chase.
- **How the new games plug in.** `js/main.js` stays BidLock's orchestrator and is also the shell. Each new game is a self-contained module (engine + 3D + screen) that takes over the `#arcade` section. The shell gives it sound, the lobby, the role (solo / host / client) and an exit callback.
- **Engines are pure** (no DOM, audio or rendering), deterministic for a seed, and have `serialize()` / `hydrate()` so a guest can mirror the host. Same pattern as `auctionEngine.js`.
- **Wire format for the new games:** host sends `{ t: 'G', ev, d, s }` (event, data, snapshot) and `{ t: 'GT', ... }` clock ticks; guests send `{ t: 'GI', a, ... }` inputs. Secrets (the right answer, a saboteur's pick) are never in a snapshot before they are revealed.
- **Movement in Trapdoor Royale is by platform, not by coordinates.** The authoritative state is which platform each player has chosen; avatars run there locally. This keeps 12 players in sync without streaming positions.

### Done

- [x] Branch and issue
- [x] Shared pieces: `js/arcade/games.js`, `bots.js`, `quizBank.js`, `gameBase.js`, `figures3d.js`; `js/render/kit3d.js`
- [x] Trapdoor Royale: engine, arena, screen
- [x] Last Lamp: engine, survival games, lighthouse, screen
- [x] Lobby: game picker, votes, per-game bot fill, `G` / `GT` / `GI` messages
- [x] Title-screen channel guide and shell wiring in `main.js`
- [x] Tests: `tests/arcade.test.mjs` (rules) and `tests/arcade.e2e.mjs` (browser), plus the BidLock suites
- [x] README and screenshots
- [x] Pull request opened

### Left

- Merge the pull request when the owner says so (merging deploys).
- Not verified: sound in the two new games was never listened to, and rooms were only tested between tabs on one machine.

## How to check things

- `node --test tests/engine.test.mjs tests/arcade.test.mjs` for the rules.
- `node tests/e2e.mjs` (BidLock) and `node tests/arcade.e2e.mjs` (the quiz games) for the browser; they need Edge or Chrome and use the real GPU.
- `node tools/serve.mjs` then `http://localhost:5173` to play.

## Standing rules for this repo

- Feature branch, GitHub issue, pull request. Merging to `main` deploys to GitHub Pages, so ask the owner before merging.
- No attribution lines in commits or pull requests.
