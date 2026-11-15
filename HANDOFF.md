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
- [x] Shared pieces: `js/arcade/games.js`, `bots.js`, `quizBank.js`; `js/render/kit3d.js` (particle pool and helpers moved out of `stage3d.js`)
- [x] Trapdoor Royale engine (`royaleEngine.js`) and Last Lamp engine (`lampEngine.js`, `undertowMinigames.js`), with `tests/arcade.test.mjs` passing
- [x] Lobby: `setGame`, `vote`, per-game bot fill, generic `G` / `GT` / `GI` messages

### Left (in order)

- [ ] Shared 3D figure (`js/arcade/figures3d.js`)
- [ ] Lobby dialog: game picker and vote buttons (`js/ui/lobbyView.js`)
- [ ] Trapdoor Royale 3D arena and screen
- [ ] Last Lamp 3D set and screen
- [ ] Title-screen game selector and shell wiring in `main.js`
- [ ] Browser tests, screenshots, fixes
- [ ] README, pull request

## How to check things

- `node --test tests/engine.test.mjs tests/arcade.test.mjs` for the rules.
- `node tests/e2e.mjs` for the browser (needs Edge or Chrome; uses the real GPU).
- `node tools/serve.mjs` then `http://localhost:5173` to play.

## Standing rules for this repo

- Feature branch, GitHub issue, pull request. Merging to `main` deploys to GitHub Pages, so ask the owner before merging.
- No attribution lines in commits or pull requests.
