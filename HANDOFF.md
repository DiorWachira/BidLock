# Handoff

The project's final state (2026-11-19), for anyone who picks it up later.

## Live

https://diorwachira.github.io/BidLock/, served by GitHub Pages from `main`. Merging to `main` deploys.

| Show | Folder | What it is |
| --- | --- | --- |
| BidLock | `js/engine`, `js/render`, `js/ui`, `js/main.js` | The $20 draft auction: 140 real lots with photos, mystery crates, the Oracle trivia steal, vault, heist, verdict, Marathon mode. |
| Trapdoor Royale | `js/games/trapdoorRoyale/` | Trivia elimination for up to 12: four answer platforms, the wrong ones drop. Six twists. 16 s a question (10 in speed rounds). |
| Last Lamp | `js/games/lastLamp/` | Trivia survival in a lighthouse: three flames each, seven Undertow survival games, five kinds of weather, wraiths, a final climb. 20 s a question. |
| Soundclash | `js/games/sampleArena/` | Name that tune from a warped three-second loop of a real iTunes preview, with point-funded sabotage. Seven warped seconds, then eight clean ones with the song playing on. Seven crates (including Anime Openings & Endings), five artists a match and at most two answers from any one, three difficulties, answers can be changed. |
| Cold Open | `js/games/coldOpen/` | Name that film from a few seconds of a real trailer on a faulty projector, with sabotage from the projection booth. 208 films in six programmes, three difficulties. Runs on Soundclash's rules engine with its own spec. |

Shared by all five: one room-code lobby (through the BidLock room server, with direct PeerJS connections as the fallback; 2 to 6 people, bots fill the rest), a game picker with votes, the Channel 20 design, and the sound engine. The quiz games share 310 built-in questions plus the Open Trivia DB, with a per-device memory of questions already asked.

## Running and testing

- Play locally: `node tools/serve.mjs`, then open `http://localhost:5173`.
- `npm test` runs everything:
  - the rules suites in Node (`engine`, `arcade`, `soundclash`, `coldopen`, `net` and `rooms` tests, 62 in all; `rooms` starts the room server locally with `wrangler dev`)
  - then the browser suites `e2e.mjs` (BidLock, 123 checks), `arcade.e2e.mjs` (76), `soundclash.e2e.mjs` (94), `coldopen.e2e.mjs` (50) and `rooms.e2e.mjs` (six browsers through the room server, 22)
  - all passed on 2026-11-19
- The browser tests use Playwright's headless shell, so they open no windows, and they use the real GPU.
- Debug URL switches:
  - `?trivia=local` and `?media=off`: no trivia service, no photos
  - `?speed=4`, `?seed=1` and `?auto=1`: faster clock, fixed match, autopilot
  - `?net=local`, with `&lag=150` for a slow link: rooms between tabs, no network
  - `?net=relay` or `?net=peer`: rooms through the room server only, or direct only
  - `?rooms=<address>`: rooms through another room server (`?rooms=ws://127.0.0.1:8787` for `npm run rooms:dev`)
  - `?music=offline`: Soundclash's synth tunes only

## The room server

- `server/` is a Cloudflare Worker with one Durable Object per room code. It passes messages between the host and the players over WebSockets (so it works on networks and browsers that block WebRTC), keeps places for people who drop out, and counts messages both ways so a dropped connection loses nothing. The host's browser still runs every game.
- It was deployed to the owner's Cloudflare account on 2026-11-18; its address is `ROOM_SERVER` in `js/net/roomServer.js`. Deploy again with `npm run rooms:deploy` (after `npx wrangler login`). It only needs deploying again when `server/` changes; deploying the site does not touch it.
- It runs on Cloudflare's free Workers plan: 100,000 Durable Object requests and 13,000 GB-seconds a day, about 25 to 30 hours of six-player rooms. When a day's allowance runs out, rooms fall back to PeerJS until midnight UTC.
- If the site's address changes, add it to `ALLOWED_ORIGINS` in `server/wrangler.jsonc` and deploy again.

## Keeping Soundclash's songs and Cold Open's films current

- Store listings drift. `node tools/check-songs.mjs` re-checks the anime catalogue (`animeSongs.js`, 59 songs from 32 anime) and every artist crate's hit list (`hits.js`) against the live iTunes Search API. It prints what to fix and takes about eight minutes, paced for Apple's limit.
- `node tools/check-films.mjs` does the same for Cold Open's 208 films (a lookup by store ID, one call per batch; under a minute). Apple's search no longer finds films at all, which is why films.js keeps their IDs: to add a film, find its ID in Apple's top-movie charts (`https://itunes.apple.com/us/rss/topmovies/limit=200/genre=<id>/json`) and check it with a lookup.
- A song that has gone missing only shrinks the pool: each match searches three spare songs, and falls back to the offline synth crate if too little is found.

## Not verified

- Nobody has listened to the sound. The tests prove the audio graph runs (tier, rate, filters, a non-zero spectrum), not that it sounds good.
- Cold Open was played with real Apple trailers in Edge on one machine; its browser tests use a recorded colour-bar film, because the test browser cannot play Apple's H.264 trailers. It has not been tried on phones or by friends in a room.
- Rooms through the room server were tested from one machine, against both a local copy and the deployed server: six browsers (one restricting WebRTC as Brave does, one with no WebRTC), a frozen host tab, and host connections that drop or die silently, all passing. They have not yet been tried by friends on separate networks, such as the school Wi-Fi that kept timing out.
- From the test machine a round trip between two players through the deployed server took about 320 to 390 ms, almost all of it the machine's own route to Cloudflare (via Budapest, about 150 ms each way); the room itself added about 15 ms. The game makes up for up to 300 ms each way. Players whose network reaches a nearer Cloudflare city will see less.
- The direct (PeerJS) fallback has no TURN relay. With the room server it should rarely matter.

## Waiting on the owner

- **A room with friends on the school Wi-Fi**, to confirm the timeouts are gone there.
- **Hosting** can stay on GitHub Pages: the room server is separate. Moving the site to Cloudflare as well is possible but not needed.

## Decisions worth knowing

- **Originality.** Trapdoor Royale and Last Lamp were made original rather than copies of Trivia Royale or Jackbox's Trivia Murder Party. Soundclash is a name-that-tune game built on the sound-clash tradition, not SongPop or Heardle. Cold Open is built on the projection booth (leaders, cue marks, changeovers, marquees), not any existing film quiz.
- **Apple's terms.** iTunes previews are meant to promote the store, so every Soundclash reveal links to Apple Music and every Cold Open reveal to the film on Apple TV, and both screens credit Apple.
- **A room server instead of a TURN relay.** A TURN relay only rescues WebRTC, and Brave's WebRTC setting or a school network can still stop it. A WebSocket through the room server is an ordinary HTTPS connection, so it gets through wherever the site itself loads. The server stays a dumb pipe: the host's browser remains the only authority, so no game code had to move.
- **Secrets.** Snapshots never carry answers before the reveal. Soundclash and Cold Open guests do get preview and trailer URLs, because their own speakers and screens must play them.
- **Fact-check.** The built-in question banks were fact-checked on 2026-11-17: about 300 questions and 32 number estimates, with no errors found.

## Standing rules

- Feature branch, GitHub issue, pull request. Ask the owner before merging, because merging deploys.
- No attribution lines in commits or pull requests.
