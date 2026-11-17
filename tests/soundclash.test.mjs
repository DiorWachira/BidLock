// Headless rules tests for Soundclash. Run with: node --test tests/soundclash.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/engine/auctionEngine.js';
import { botSeats } from '../js/arcade/bots.js';
import {
  SampleArenaEngine, S_PHASE, S_RULES, SABOTAGES, WARP_ORDER, FINAL_WARP, speedPoints, streakMult,
} from '../js/games/sampleArena/sampleArenaEngine.js';
import {
  GENRES, GENRE_CHOICES, genreById, cleanTitle, parseResults, buildRounds, offlineRounds, planSearches, loadMatch, ROUND_COUNT,
} from '../js/games/sampleArena/itunesLoader.js';
import { SYNTH_TUNES, renderTune } from '../js/games/sampleArena/synthTunes.js';
import { makeLoop, WARPS } from '../js/games/sampleArena/sampleAudioFX.js';

const table = (people, bots) => [
  ...Array.from({ length: people }, (_, i) => ({ name: `P${i + 1}`, kind: 'human' })),
  ...botSeats(bots, []),
];
const wire = (x) => JSON.parse(JSON.stringify(x));
const offline = (seed) => ({ source: 'offline', genre: 'all', rounds: offlineRounds(mulberry32(seed)) });

// A fake iTunes answer: `n` songs by `artist`, plus junk that must be filtered out.
function fixture(artist, n = 20) {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push({
      kind: 'song', trackId: `${artist}-${i}`, trackName: `${artist} Song ${i} (feat. Guest) [Remastered 2011]`, artistName: artist,
      previewUrl: `https://audio.example/${artist}/${i}.m4a`, artworkUrl100: `https://art.example/${artist}/${i}/100x100bb.jpg`, trackViewUrl: `https://music.example/${artist}/${i}`,
    });
  }
  results.push({ kind: 'song', trackId: 'k1', trackName: 'Hit (Karaoke Version)', artistName: 'Karaoke Kings', previewUrl: 'x', artworkUrl100: 'y' });
  results.push({ kind: 'song', trackId: 'k2', trackName: 'No Preview', artistName: artist, artworkUrl100: 'y' });
  results.push({ kind: 'music-video', trackId: 'k3', trackName: 'Video', artistName: artist, previewUrl: 'x', artworkUrl100: 'y' });
  results.push({ kind: 'song', trackId: 'k4', trackName: 'Cover', artistName: 'Someone Else', previewUrl: 'x', artworkUrl100: 'y' });
  return { resultCount: results.length, results };
}

test('the crates: six genres and the shuffle', () => {
  assert.equal(GENRES.length, 6);
  assert.equal(GENRE_CHOICES[0].id, 'all');
  assert.equal(genreById('nope').id, 'all');
  for (const g of GENRES) assert.ok(g.terms.length >= 12 && g.name && g.short, g.id);
  const rng = mulberry32(3);
  assert.equal(planSearches('all', rng).length, 4);
  const plan = planSearches('rock', rng);
  assert.equal(plan.length, 3);
  assert.ok(plan.every((p) => GENRES.find((g) => g.id === 'rock').terms.includes(p.term)));
});

test('the crate digger: titles, filtering and artwork', () => {
  assert.equal(cleanTitle('Song (feat. X) [Remastered 2011]'), 'Song');
  assert.equal(cleanTitle('Song - 2009 Remaster'), 'Song');
  assert.equal(cleanTitle('Song (with Y)'), 'Song');
  const list = parseResults(fixture('Muse'), { term: 'Muse' });
  assert.equal(list.length, 20, 'junk, video, no-preview and other-artist rows are dropped');
  assert.equal(list[0].title, 'Muse Song 0');
  assert.ok(list[0].art.endsWith('/400x400bb.jpg'), 'artwork upgraded to 400 px');
  assert.ok(list[0].pop > list[19].pop, 'earlier results count as more popular');
  assert.equal(parseResults(fixture('Muse'), { term: 'Oasis' }).length, 0);
  assert.equal(parseResults(fixture('Muse'), { term: 'Oasis', loose: true }).length, 21, 'scene searches keep other artists');
  assert.deepEqual(parseResults(null), []);
});

test('the crate digger: eight fair rounds', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = mulberry32(seed);
    const pool = [...parseResults(fixture('Muse', 12), { term: 'Muse' }), ...parseResults(fixture('Oasis', 12), { term: 'Oasis' })];
    const rounds = buildRounds(pool, rng);
    assert.equal(rounds.length, ROUND_COUNT);
    assert.equal(new Set(rounds.map((r) => r.target.id)).size, ROUND_COUNT, 'no song is the target twice');
    for (const r of rounds) {
      assert.equal(r.options.length, 4);
      assert.equal(new Set(r.options.map((o) => o.title)).size, 4, 'four different titles');
      assert.equal(r.options[r.correct].title, r.target.title);
      assert.ok(r.start >= 8 && r.start <= 18, `the hook starts at ${r.start}`);
      assert.ok(r.options.filter((o) => o.artist === r.target.artist).length <= 2, 'at most one rival by the same artist');
    }
  }
  assert.equal(buildRounds(parseResults(fixture('Muse', 6), { term: 'Muse' }), mulberry32(1)), null, 'too few songs: no match');
  const off = offlineRounds(mulberry32(9));
  assert.equal(off.length, ROUND_COUNT);
  assert.ok(off.every((r) => r.target.synth && r.start === 0));
});

test('the crate digger: iTunes, or the offline crate when it fails', async () => {
  const calls = [];
  const ok = async (url) => {
    calls.push(url);
    const term = decodeURIComponent(/term=([^&]+)/.exec(url)[1]);
    return { ok: true, json: async () => fixture(term, 15) };
  };
  const live = await loadMatch({ genre: 'pop', rng: mulberry32(4), fetchImpl: ok });
  assert.equal(live.source, 'itunes');
  assert.equal(live.rounds.length, ROUND_COUNT);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((u) => u.includes('media=music') && u.includes('entity=song') && u.includes('limit=35')));
  const down = await loadMatch({ genre: 'pop', rng: mulberry32(4), fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(down.source, 'offline');
  assert.equal(down.rounds.length, ROUND_COUNT);
  const empty = await loadMatch({ genre: 'all', rng: mulberry32(4), fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) }) });
  assert.equal(empty.source, 'offline');
  const forced = await loadMatch({ offline: true, rng: mulberry32(4), fetchImpl: ok });
  assert.equal(forced.source, 'offline');
});

test('scoring: speed, overtime and streaks', () => {
  assert.equal(speedPoints(0), 1000);
  assert.equal(speedPoints(4), 750);
  assert.equal(speedPoints(8), 500);
  assert.equal(speedPoints(8.0001), 350);
  assert.equal(speedPoints(10), 250);
  assert.equal(speedPoints(12), 150);
  assert.deepEqual([1, 2, 3, 4, 9].map(streakMult), [1, 1.2, 1.5, 2, 2]);
  assert.deepEqual(Object.values(SABOTAGES).map((s) => s.cost), [300, 450, 600]);
});

test('soundclash: 200 bot matches keep every invariant', () => {
  const warpCount = {};
  let sabs = 0;
  let overtimes = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const e = new SampleArenaEngine();
    let reveals = 0;
    e.on('sabotage', () => { sabs++; });
    e.on('overtime', () => { overtimes++; });
    e.on('reveal', (d) => {
      reveals++;
      assert.equal(d.gains.length, e.players.length);
      for (const g of d.gains) if (g.ok) assert.ok(g.gain >= 150 && g.gain <= 4000, `gain ${g.gain}`);
    });
    e.startMatch({ seats: table(0, 6), seed, match: offline(seed) });
    const warps = e.rounds.map((r) => r.warp);
    assert.equal(warps.at(-1), FINAL_WARP);
    assert.equal(new Set(warps.slice(0, 4)).size, 4, 'every warp before a repeat');
    for (let i = 1; i < warps.length; i++) assert.notEqual(warps[i], warps[i - 1], 'never the same warp twice running');
    for (const w of warps) { warpCount[w] = (warpCount[w] || 0) + 1; assert.ok(WARPS[w], w); }
    let guard = 0;
    while (e.phase !== S_PHASE.PODIUM && guard++ < 100000) {
      e.update(1 / 30);
      for (const p of e.players) assert.ok(p.score >= 0, 'scores never go negative');
    }
    assert.equal(e.phase, S_PHASE.PODIUM);
    assert.equal(reveals, ROUND_COUNT);
    const scores = e.ranking.map((id) => e.players[id].score);
    assert.deepEqual(scores, scores.slice().sort((a, b) => b - a), 'ranking is by score');
    assert.equal(e.awards.mvp, e.ranking[0]);
  }
  for (const w of WARP_ORDER) assert.ok(warpCount[w] > 250, `${w}: ${warpCount[w]}`);
  assert.ok(sabs > 100, `bots throw dubplates (${sabs})`);
  assert.ok(overtimes > 200, `some rounds reach overtime (${overtimes})`);
});

test('soundclash: inputs are checked and the answer stays secret', () => {
  const e = new SampleArenaEngine();
  e.startMatch({ seats: table(2, 1), seed: 7, match: offline(7) });
  assert.equal(e.answerFor(0, 1), false, 'no answers before the drop');
  while (e.phase !== S_PHASE.PLAY) e.update(1 / 30);
  // Secrets during play.
  let snap = wire(e.serialize());
  assert.equal(snap.c, -1);
  assert.equal(snap.last, null);
  assert.ok(snap.cur.options.length === 4 && snap.cur.url === '' && snap.cur.synth);
  assert.equal(e.answerFor(0, 9), false);
  assert.equal(e.answerFor(0, e.correct), true);
  assert.equal(e.answerFor(0, 0), false, 'one answer a round');
  snap = wire(e.serialize());
  assert.equal(snap.pl[0].lk, 1);
  assert.equal(snap.pl[0].ch, null, 'nobody can see what you picked');
  assert.equal(snap.pl[0].ok, null);
  // Sabotage: costs, one a round, not on yourself or a locked player.
  assert.equal(e.sabotageFor(1, 'under', 0), false, 'no points, no throw');
  e.players[1].score = 1000;
  assert.equal(e.sabotageFor(1, 'under', 1), false, 'not at yourself');
  assert.equal(e.sabotageFor(1, 'under', 0), false, 'not at someone who has locked in');
  assert.equal(e.sabotageFor(1, 'nope', 2), false);
  assert.equal(e.sabotageFor(1, 'scratch', 2), true);
  assert.equal(e.players[1].score, 550);
  assert.equal(e.sabotageFor(1, 'under', 2), false, 'one throw a round');
  const fx = e.effects(e.players[2]);
  assert.ok(fx.scratch && fx.scratch.perm.length === 4 && fx.scratch.left > 2.9);
  // The mirror agrees, and gets the effects.
  const m = new SampleArenaEngine();
  m.hydrate(wire(e.serialize()), 2);
  assert.equal(m.me.name, e.players[2].name);
  assert.ok(m.effects(m.me).scratch, 'the target sees the scramble');
  assert.deepEqual(m.urls(), e.urls());
  // Until the reveal.
  while (e.phase !== S_PHASE.REVEAL) e.update(1 / 30);
  snap = wire(e.serialize());
  assert.equal(snap.c, e.correct);
  assert.equal(snap.pl[0].ch, e.correct);
  assert.ok(snap.last.title && snap.last.gains.length === 3);
  assert.equal(e.players[0].streak, 1);
  assert.ok(e.players[0].gain >= 500 && e.players[0].gain <= 1000);
});

test('soundclash: the leader target, the dubplate special and the bots', () => {
  const e = new SampleArenaEngine();
  e.startMatch({ seats: table(2, 0), seed: 11, match: offline(11) });
  while (e.phase !== S_PHASE.PLAY) e.update(1 / 30);
  e.players[0].score = 900;
  e.players[1].score = 2000;
  assert.equal(e.sabotageFor(0, 'shock', 'leader'), true);
  assert.ok(['reverse', 'chipmunk'].includes(e.effects(e.players[1]).shock.mode));
  // Jump to the last round.
  let guard = 0;
  while (!(e.final && e.phase === S_PHASE.PLAY) && guard++ < 100000) e.update(1 / 30);
  assert.equal(e.current.warp, FINAL_WARP);
  e.players[0].score = 100;
  e.players[0].streak = 0;
  const wrong = (e.correct + 1) % 4;
  e.answerFor(0, wrong);
  e.answerFor(1, e.correct);
  const before1 = e.players[1].score;
  while (e.phase !== S_PHASE.REVEAL) e.update(1 / 30);
  assert.equal(e.players[0].score, 0, 'a wrong answer costs up to 250, never below zero');
  assert.ok(e.players[1].score - before1 >= 1000, 'double points');
  // Bots aim at a person in the lead.
  let atHuman = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const g = new SampleArenaEngine();
    g.on('sabotage', (d) => { if (d.to === 0) atHuman++; });
    g.startMatch({ seats: table(1, 5), seed, match: offline(seed) });
    while (g.phase !== S_PHASE.PLAY) g.update(1 / 30);
    g.players[0].score = 5000;
    while (g.phase !== S_PHASE.PODIUM) {
      g.update(1 / 30);
      if (g.phase === S_PHASE.PLAY && !g.players[0].locked && g.elapsed > 7) g.answerFor(0, g.correct);
    }
  }
  assert.ok(atHuman > 30, `bots go after the leader (${atHuman} throws)`);
});

test('the offline crate: public-domain tunes render to real audio', () => {
  assert.ok(SYNTH_TUNES.length >= 20);
  assert.equal(new Set(SYNTH_TUNES.map((t) => t.id)).size, SYNTH_TUNES.length);
  assert.equal(new Set(SYNTH_TUNES.map((t) => t.title)).size, SYNTH_TUNES.length);
  for (const t of SYNTH_TUNES) {
    const secs = t.notes.reduce((s, [, b]) => s + b, 0) * 60 / t.bpm;
    assert.ok(secs >= 2.4, `${t.id} hook lasts ${secs.toFixed(2)} s`);
    assert.ok(t.notes.every(([m, b]) => (m === 0 || (m >= 36 && m <= 96)) && b > 0), t.id);
  }
  const pcm = renderTune(SYNTH_TUNES[0], 8000, 4);
  assert.equal(pcm.length, 32000);
  let peak = 0;
  let energy = 0;
  for (const v of pcm) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); energy += v * v; }
  assert.ok(peak > 0.2 && peak <= 1, `peak ${peak}`);
  assert.ok(energy / pcm.length > 0.005, 'not silent');
});

test('the loop maker: three seconds, a seamless seam, and reverse', () => {
  // A minimal stand-in for an AudioContext and its buffers.
  class Buf {
    constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.data = Array.from({ length: ch }, () => new Float32Array(len)); }
    getChannelData(c) { return this.data[c]; }
  }
  const ctx = { createBuffer: (ch, len, sr) => new Buf(ch, len, sr) };
  const sr = 1000;
  const src = new Buf(1, 30 * sr, sr);
  src.getChannelData(0).forEach((_, i, a) => { a[i] = i / (30 * sr); }); // a slow ramp
  const loop = makeLoop(ctx, src, 10, { len: 3, xf: 0.02 });
  const d = loop.getChannelData(0);
  assert.equal(loop.length, 3 * sr);
  const step = 1 / (30 * sr);
  assert.ok(Math.abs(d[0] - (d[d.length - 1] + step)) < step * 1.01, 'the seam continues the waveform');
  assert.ok(Math.abs(d[100] - (10 * sr + 100) * step) < 1e-6, 'after the crossfade it is the source');
  const rev = makeLoop(ctx, src, 10, { len: 3, xf: 0.02, reverse: true });
  const r = rev.getChannelData(0);
  assert.ok(r[100] > r[200], 'reversed slices run backwards');
});
