// Headless tests for Cold Open: the film library, the loader against fake store lookups,
// the rules engine with bots, faults and booth sabotage. Run with: node --test tests/coldopen.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FILMS } from '../js/games/coldOpen/films.js';
import {
  PROGRAMMES, programmeById, FILM_LEVELS, filmsFor, pickFilms, filmRivals, loadMatch, posterUrl, ROUNDS, CLIP, CLIP_FROM, CLIP_TO,
} from '../js/games/coldOpen/filmLoader.js';
import { ColdOpenEngine, C_PHASE, C_RULES, FAULTS, FAULT_ORDER, FAULTS_BY_LEVEL, BOOTH, BOOTH_ORDER, filmPoints, filmMult } from '../js/games/coldOpen/coldOpenEngine.js';
import { clipStart } from '../js/games/coldOpen/projector.js';
import { botSeats } from '../js/arcade/bots.js';
import { gameById } from '../js/arcade/games.js';
import { mulberry32 } from '../js/engine/auctionEngine.js';

test('the library: famous films, filed in programmes, each with a store ID', () => {
  assert.ok(FILMS.length >= 200, `${FILMS.length} films`);
  assert.equal(new Set(FILMS.map((f) => f.id)).size, FILMS.length, 'no film twice');
  assert.equal(new Set(FILMS.map((f) => `${f.title}|${f.year}`)).size, FILMS.length);
  for (const f of FILMS) {
    assert.ok(/^\d{6,12}$/.test(f.id), f.id);
    assert.ok(f.title && f.year >= 1930 && f.year <= 2026, `${f.title} ${f.year}`);
    assert.ok(['us', 'gb', 'au', 'in', undefined].includes(f.store), `${f.title}: ${f.store}`);
    assert.ok(PROGRAMMES.some((p) => p.id === f.crate), f.crate);
  }
  for (const p of PROGRAMMES) assert.ok(filmsFor(p.id).length >= ROUNDS + 3, `${p.id}: ${filmsFor(p.id).length} films`);
  assert.equal(programmeById('nope').id, 'all');
  assert.deepEqual(FILM_LEVELS.map((l) => l.id), ['easy', 'normal', 'hard']);
  assert.equal(gameById('coldopen').slot, '23:00');
  assert.equal(posterUrl('https://x/pr_source.lsr/100x100bb.jpg'), 'https://x/pr_source.lsr/400x600bb.jpg');
});

test('picking films: one per series where it can, and rivals by level', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const picks = pickFilms(filmsFor('all'), mulberry32(seed), ROUNDS + 3);
    assert.equal(picks.length, ROUNDS + 3);
    const series = picks.filter((f) => f.series).map((f) => f.series);
    assert.equal(new Set(series).size, series.length, 'no two from one series in the big programme');
  }
  // A small programme still fills a match.
  assert.equal(pickFilms(filmsFor('heroes'), mulberry32(2), ROUNDS + 3).length, ROUNDS + 3);
  const potter = FILMS.find((f) => f.series === 'potter');
  const batman = FILMS.find((f) => f.title === 'The Dark Knight');
  for (let seed = 1; seed <= 40; seed++) {
    const easy = filmRivals(potter, mulberry32(seed), 'easy');
    assert.equal(easy.length, 3);
    assert.ok(easy.every((x) => x.series !== 'potter' && x.id !== potter.id), 'easy: never a sequel');
    assert.ok(easy.filter((x) => x.crate !== potter.crate).length >= 2, 'easy: mostly other programmes');
    const normal = filmRivals(batman, mulberry32(seed), 'normal');
    assert.ok(normal.every((x) => x.series !== 'batman'), 'normal: never a sequel');
    assert.ok(normal.every((x) => x.crate === batman.crate), 'normal: the same programme');
    const hard = filmRivals(batman, mulberry32(seed), 'hard');
    assert.ok(hard.every((x) => x.series === 'batman'), 'hard: the other Batman films');
    assert.equal(new Set([...hard.map((x) => x.title), batman.title]).size, 4);
  }
});

// A fake store: answers a lookup with the films asked for, as feature films with trailers.
function fakeStore(calls = []) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const ids = (u.searchParams.get('id') || '').split(',');
    return {
      ok: true,
      json: async () => ({
        resultCount: ids.length,
        results: ids.map((id) => ({ kind: 'feature-movie', trackId: Number(id), trackName: 'x', previewUrl: `https://video-ssl.itunes.apple.com/t/${id}.m4v`, artworkUrl100: `https://is1-ssl.mzstatic.com/a/${id}/100x100bb.jpg`, trackViewUrl: `https://itunes.apple.com/us/movie/x/id${id}` })),
      }),
    };
  };
}

test('loading a match: one lookup per store, eight rounds, a clip in each trailer', async () => {
  for (const [programme, level] of [['all', 'normal'], ['animated', 'easy'], ['heroes', 'hard']]) {
    const calls = [];
    const m = await loadMatch({ programme, level, rng: mulberry32(7), fetchImpl: fakeStore(calls) });
    assert.equal(m.source, 'itunes');
    assert.equal(m.rounds.length, ROUNDS);
    const stores = new Set(calls.map((c) => new URL(c).searchParams.get('country')));
    assert.equal(calls.length, stores.size, 'one lookup per store');
    assert.ok(calls.every((c) => c.startsWith('https://itunes.apple.com/lookup?id=')));
    for (const r of m.rounds) {
      assert.equal(r.options.length, 4);
      assert.equal(new Set(r.options.map((o) => o.title)).size, 4, 'four different films');
      assert.equal(r.options[r.correct].title, r.target.title);
      assert.ok(r.target.url.endsWith('.m4v') && r.target.art.endsWith('400x600bb.jpg') && r.target.link.includes('/movie/'));
      assert.ok(r.start >= CLIP_FROM && r.start <= CLIP_TO, 'the clip is past the logos and before the title card');
      assert.equal(r.len, CLIP[level]);
      if (programme !== 'all') assert.ok(filmsFor(programme).some((f) => f.id === r.target.id), 'from the programme');
    }
  }
  // The library out of reach: the screen is told why.
  await assert.rejects(loadMatch({ rng: mulberry32(1), fetchImpl: async () => { throw new Error('offline'); } }), (e) => e.code === 'unreachable');
  // A store that has lost most of the films.
  const sparse = async (url) => {
    const ids = new URL(url).searchParams.get('id').split(',').slice(0, 2);
    return { ok: true, json: async () => ({ results: ids.map((id) => ({ kind: 'feature-movie', trackId: Number(id), previewUrl: 'https://v/x.m4v', artworkUrl100: 'https://a/100x100bb.jpg' })) }) };
  };
  await assert.rejects(loadMatch({ programme: 'heroes', rng: mulberry32(1), fetchImpl: sparse }), (e) => e.code === 'short');
});

test('scoring and timing: the changeover after eleven seconds', () => {
  const W = C_RULES.warpTime;
  const T = C_RULES.roundTime;
  assert.equal(filmPoints(0), 1000);
  assert.equal(filmPoints(W), 500);
  assert.equal(filmPoints(W + 0.0001), 350);
  assert.equal(filmPoints(T), 150);
  assert.deepEqual([1, 2, 3, 4, 7].map(filmMult), [1, 1.2, 1.5, 2, 2]);
  assert.deepEqual(BOOTH_ORDER.map((k) => BOOTH[k].cost), [300, 450, 600]);
  assert.equal(clipStart(0.5, 140, 3), 70);
  assert.equal(clipStart(0.99, 140, 3), 136, 'never past the end');
  assert.equal(clipStart(0.5, Infinity, 3), 0, 'a video of unknown length starts at the top');
});

async function match(level = 'normal', seed = 5) {
  return loadMatch({ programme: 'all', level, rng: mulberry32(seed), fetchImpl: fakeStore() });
}

test('cold open: 150 bot matches keep every invariant', async () => {
  const m = await match();
  let mvpBots = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const e = new ColdOpenEngine();
    const n = 2 + (seed % 5);
    e.startMatch({ seats: botSeats(n, []), seed, match: m });
    let guard = 0;
    while (e.phase !== C_PHASE.PODIUM && guard++ < 20000) e.update(1 / 30);
    assert.equal(e.phase, C_PHASE.PODIUM, `seed ${seed} finished`);
    assert.equal(e.round, ROUNDS);
    assert.equal(e.rounds.at(-1).warp, 'PREMIERE', 'the last reel is the premiere');
    assert.ok(e.rounds.slice(0, -1).every((r) => FAULT_ORDER.includes(r.warp)));
    for (let i = 1; i < e.rounds.length - 1; i++) assert.notEqual(e.rounds[i].warp, e.rounds[i - 1].warp, 'never the same fault twice in a row');
    for (const p of e.players) assert.ok(p.score >= 0 && p.right <= ROUNDS);
    assert.equal(e.ranking.length, n);
    if (e.awards.mvp >= 0) mvpBots++;
  }
  assert.equal(mvpBots, 150);
});

test('faults by level: easy keeps to the gentle ones', async () => {
  const easy = await match('easy', 9);
  const e = new ColdOpenEngine();
  e.startMatch({ seats: botSeats(3, []), seed: 3, match: easy });
  assert.ok(e.rounds.slice(0, -1).every((r) => FAULTS_BY_LEVEL.easy.includes(r.warp)), e.rounds.map((r) => r.warp).join());
  for (const k of FAULT_ORDER) assert.ok(FAULTS[k].badge && FAULTS[k].line, k);
});

test('the booth: soft focus, a wrong reel with a decoy, and film burn breaking a run', async () => {
  const m = await match();
  const e = new ColdOpenEngine();
  e.startMatch({ seats: [{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }, ...botSeats(2, [])], seed: 11, match: m });
  // Every trailer carries where its clip starts, for guests to thread ahead.
  assert.ok(e.urls().every((u, i) => u === `${m.rounds[i].target.url}#co=${m.rounds[i].start}`));
  while (e.phase !== C_PHASE.PLAY) e.update(1 / 30);
  e.update(0.5);
  assert.equal(e.current.len, CLIP.normal);
  assert.equal(e.correct >= 0 && e.serialize().c, -1, 'the answer stays out of snapshots');
  e.players[1].score = 3000;
  assert.ok(e.sabotageFor(1, 'focus', 0));
  assert.ok(e.effects(e.players[0]).focus, 'soft focus lands');
  assert.equal(e.sabotageFor(1, 'reel', 0), false, 'one a reel');
  e.players[0].streak = 3;
  // Next reel: a wrong reel and a film burn.
  while (e.phase !== C_PHASE.PLAY || e.round < 2) e.update(1 / 30);
  e.update(0.3);
  e.players[0].streak = 3;
  e.players[2].score = 3000;
  e.players[1].score = 3000;
  assert.ok(e.sabotageFor(1, 'reel', 0));
  const reel = e.effects(e.players[0]).reel;
  assert.ok(reel && reel.perm.length === 4 && Number.isInteger(reel.decoy) && reel.decoy !== e.round - 1, 'answers mixed up, and another film to cut to');
  assert.ok(e.sabotageFor(2, 'burn', 0));
  assert.equal(e.players[0].streak, 0, 'film burn breaks the run');
  // A guest's mirror carries the effects and the clip URLs.
  const g = new ColdOpenEngine();
  g.hydrate(JSON.parse(JSON.stringify(e.serialize())), 0);
  assert.deepEqual(g.urls(), e.urls());
  assert.ok(g.effects(g.players[0]).burn && g.effects(g.players[0]).reel);
});
