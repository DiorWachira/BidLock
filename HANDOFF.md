# Handoff

The project's final state (2026-11-17), for anyone who picks it up later.

## Live

https://diorwachira.github.io/BidLock/, served by GitHub Pages from `main`. Merging to `main` deploys.

| Show | Folder | What it is |
| --- | --- | --- |
| BidLock | `js/engine`, `js/render`, `js/ui`, `js/main.js` | The $20 draft auction: 140 real lots with photos, mystery crates, the Oracle trivia steal, vault, heist, verdict, Marathon mode. |
| Trapdoor Royale | `js/games/trapdoorRoyale/` | Trivia elimination for up to 12: four answer platforms, the wrong ones drop. Six twists. 16 s a question (10 in speed rounds). |
| Last Lamp | `js/games/lastLamp/` | Trivia survival in a lighthouse: three flames each, seven Undertow survival games, five kinds of weather, wraiths, a final climb. 20 s a question. |
| Soundclash | `js/games/sampleArena/` | Name that tune from a warped three-second loop of a real iTunes preview, with point-funded sabotage. Seven crates (including Anime Openings & Endings), three difficulties, answers can be changed. |

Shared by all four: one room-code lobby (PeerJS, 2 to 6 people, bots fill the rest), a game picker with votes, the Channel 20 design, and the sound engine. The quiz games share 310 built-in questions plus the Open Trivia DB, with a per-device memory of questions already asked.

## Running and testing

- Play locally: `node tools/serve.mjs`, then open `http://localhost:5173`.
- `npm test` runs everything:
  - the rules suites in Node (`engine`, `arcade`, `soundclash` and `net` tests, 40 in all)
  - then the browser suites `e2e.mjs` (BidLock, 123 checks), `arcade.e2e.mjs` (76) and `soundclash.e2e.mjs` (94)
  - all passed on 2026-11-17
- The browser tests use Playwright's headless shell, so they open no windows, and they use the real GPU.
- Debug URL switches:
  - `?trivia=local` and `?media=off`: no trivia service, no photos
  - `?speed=4`, `?seed=1` and `?auto=1`: faster clock, fixed match, autopilot
  - `?net=local`, with `&lag=150` for a slow link: rooms between tabs, no network
  - `?music=offline`: Soundclash's synth tunes only

## Keeping Soundclash's songs current

- Store listings drift. `node tools/check-songs.mjs` re-checks the anime catalogue (`animeSongs.js`, 59 songs from 32 anime) and every artist crate's hit list (`hits.js`) against the live iTunes Search API. It prints what to fix and takes about eight minutes, paced for Apple's limit.
- A song that has gone missing only shrinks the pool: each match searches three spare songs, and falls back to the offline synth crate if too little is found.

## Not verified

- Nobody has listened to the sound. The tests prove the audio graph runs (tier, rate, filters, a non-zero spectrum), not that it sounds good.
- Rooms were tested on one machine: six players over real PeerJS, plus simulated lag and a paused host. They have never been tested across separate networks.
- **No TURN relay is configured**, so players behind strict networks (often mobile data or school Wi-Fi) may time out. "Check my connection" in the lobby tells them why.

## Waiting on the owner

- **TURN credentials.** The owner was going to sign up for a free Metered (or ExpressTURN) account. Put the restricted credentials, or Metered's credentials URL, in `js/net/iceServers.js`, then re-test six players.
- **Planned, deferred:** a room server on Cloudflare Workers with Durable Objects, one per room code, every player on a WebSocket and the host still the authority. PeerJS stays as a fallback and `?net=local` for tests. Moving hosting off GitHub Pages may come with it. Before starting, tell the owner exactly what to set up in Cloudflare.

## Decisions worth knowing

- **Originality.** Trapdoor Royale and Last Lamp were made original rather than copies of Trivia Royale or Jackbox's Trivia Murder Party. Soundclash is a name-that-tune game built on the sound-clash tradition, not SongPop or Heardle.
- **Apple's terms.** iTunes previews are meant to promote the store, so every Soundclash reveal links to Apple Music and the screen credits iTunes.
- **Secrets.** Snapshots never carry answers before the reveal. Soundclash guests do get preview URLs, because their speakers must play them.
- **Fact-check.** The built-in question banks were fact-checked on 2026-11-17: about 300 questions and 32 number estimates, with no errors found.

## Standing rules

- Feature branch, GitHub issue, pull request. Ask the owner before merging, because merging deploys.
- No attribution lines in commits or pull requests.
