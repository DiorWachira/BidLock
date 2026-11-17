// SOUNDCLASH — the offline crate: tunes everyone knows, all long out of copyright
// (traditional songs and 18th to 19th century classics), played by a small chiptune
// band. When the iTunes Search API cannot be reached, the match uses these, and the
// whole warp-and-sabotage pipeline works on them exactly as on a real preview.
//
// Notes are [midi, beats]; 0 is a rest. Only the opening hook of each tune is written.

export const SYNTH_TUNES = Object.freeze([
  { id: 'ode', title: 'Ode to Joy', by: 'Ludwig van Beethoven', bpm: 132,
    notes: [[64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2]] },
  { id: 'elise', title: 'Für Elise', by: 'Ludwig van Beethoven', bpm: 150,
    notes: [[76, 0.5], [75, 0.5], [76, 0.5], [75, 0.5], [76, 0.5], [71, 0.5], [74, 0.5], [72, 0.5], [69, 1.5], [60, 0.5], [64, 0.5], [69, 0.5], [71, 1.5], [64, 0.5], [68, 0.5], [71, 0.5], [72, 1.5]] },
  { id: 'mountain', title: 'In the Hall of the Mountain King', by: 'Edvard Grieg', bpm: 150,
    notes: [[57, 0.5], [59, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [64, 1], [63, 0.5], [59, 0.5], [63, 1], [62, 0.5], [58, 0.5], [62, 1], [57, 0.5], [59, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [60, 0.5], [64, 0.5], [69, 0.5], [67, 0.5], [64, 0.5], [60, 0.5], [64, 0.5], [67, 2]] },
  { id: 'tell', title: 'William Tell Overture (Finale)', by: 'Gioachino Rossini', bpm: 150,
    notes: [[67, 0.25], [67, 0.25], [67, 0.5], [67, 0.25], [67, 0.25], [67, 0.5], [67, 0.25], [67, 0.25], [72, 0.5], [74, 0.5], [76, 1], [67, 0.25], [67, 0.25], [67, 0.5], [67, 0.25], [67, 0.25], [67, 0.5], [67, 0.25], [67, 0.25], [76, 0.5], [74, 0.5], [71, 1]] },
  { id: 'cancan', title: 'Galop Infernal (Can-Can)', by: 'Jacques Offenbach', bpm: 160,
    notes: [[60, 1], [62, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [67, 1], [67, 1], [67, 0.5], [69, 0.5], [64, 0.5], [65, 0.5], [62, 1], [62, 1], [62, 0.5], [65, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [72, 0.5], [71, 0.5], [69, 0.5], [67, 1]] },
  { id: 'entertainer', title: 'The Entertainer', by: 'Scott Joplin', bpm: 96,
    notes: [[62, 0.25], [63, 0.25], [64, 0.25], [72, 0.5], [64, 0.25], [72, 0.5], [64, 0.25], [72, 1.25], [72, 0.25], [74, 0.25], [75, 0.25], [76, 0.25], [72, 0.25], [74, 0.25], [76, 0.5], [71, 0.25], [74, 0.5], [72, 1.5]] },
  { id: 'greensleeves', title: 'Greensleeves', by: 'Traditional (England)', bpm: 270,
    notes: [[57, 1], [60, 2], [62, 1], [64, 1.5], [65, 0.5], [64, 1], [62, 2], [59, 1], [55, 1.5], [57, 0.5], [59, 1], [60, 2], [57, 1], [57, 1.5], [56, 0.5], [57, 1], [59, 2], [56, 1], [52, 2]] },
  { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', by: 'Traditional', bpm: 140,
    notes: [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2]] },
  { id: 'jacques', title: 'Frère Jacques', by: 'Traditional (France)', bpm: 150,
    notes: [[60, 1], [62, 1], [64, 1], [60, 1], [60, 1], [62, 1], [64, 1], [60, 1], [64, 1], [65, 1], [67, 2], [64, 1], [65, 1], [67, 2]] },
  { id: 'nachtmusik', title: 'Eine kleine Nachtmusik', by: 'Wolfgang Amadeus Mozart', bpm: 140,
    notes: [[67, 1], [0, 0.5], [62, 0.5], [67, 1], [0, 0.5], [62, 0.5], [67, 0.5], [62, 0.5], [67, 0.5], [71, 0.5], [74, 2], [72, 1], [0, 0.5], [69, 0.5], [72, 1], [0, 0.5], [69, 0.5], [72, 0.5], [69, 0.5], [66, 0.5], [69, 0.5], [62, 2]] },
  { id: 'turca', title: 'Rondo alla Turca', by: 'Wolfgang Amadeus Mozart', bpm: 120,
    notes: [[71, 0.25], [69, 0.25], [68, 0.25], [69, 0.25], [72, 1], [74, 0.25], [72, 0.25], [71, 0.25], [72, 0.25], [76, 1], [77, 0.25], [76, 0.25], [75, 0.25], [76, 0.25], [83, 0.25], [81, 0.25], [80, 0.25], [81, 0.25], [83, 0.25], [81, 0.25], [80, 0.25], [81, 0.25], [84, 2]] },
  { id: 'spring', title: 'Spring (The Four Seasons)', by: 'Antonio Vivaldi', bpm: 120,
    notes: [[64, 1], [68, 0.5], [68, 0.5], [68, 0.5], [66, 0.25], [64, 0.25], [71, 1.5], [71, 0.25], [69, 0.25], [68, 0.5], [68, 0.5], [68, 0.5], [66, 0.25], [64, 0.25], [71, 1.5], [71, 0.25], [69, 0.25], [68, 0.5], [69, 0.25], [71, 0.25], [69, 0.5], [68, 0.5], [66, 2]] },
  { id: 'swan', title: 'Swan Lake (Theme)', by: 'Pyotr Ilyich Tchaikovsky', bpm: 100,
    notes: [[66, 3], [59, 0.5], [61, 0.5], [62, 0.5], [64, 0.5], [66, 1.5], [62, 0.5], [66, 1.5], [62, 0.5], [66, 1.5], [59, 0.5], [62, 0.5], [59, 0.5], [55, 0.5], [62, 0.5], [59, 3]] },
  { id: 'habanera', title: 'Habanera (Carmen)', by: 'Georges Bizet', bpm: 104,
    notes: [[74, 1.5], [73, 0.5], [72, 1], [72, 0.5], [71, 0.5], [70, 1], [69, 0.5], [68, 0.5], [67, 1.5], [0, 0.5], [74, 1.5], [73, 0.5], [72, 1], [72, 0.5], [71, 0.5], [70, 1], [69, 0.5], [68, 0.5], [67, 2]] },
  { id: 'valkyries', title: 'Ride of the Valkyries', by: 'Richard Wagner', bpm: 132,
    notes: [[54, 0.25], [59, 0.75], [54, 0.25], [59, 0.5], [62, 1.5], [59, 0.75], [62, 0.25], [59, 0.5], [62, 0.25], [66, 0.75], [62, 0.25], [66, 0.5], [69, 1.5], [57, 0.75], [62, 0.25], [57, 0.5], [62, 0.25], [66, 2]] },
  { id: 'danube', title: 'The Blue Danube', by: 'Johann Strauss II', bpm: 190,
    notes: [[62, 1], [62, 1], [66, 1], [69, 1], [69, 2], [0, 1], [81, 1], [81, 2], [78, 1], [78, 2], [61, 1], [61, 1], [64, 1], [71, 1], [71, 2], [0, 1], [83, 1], [83, 2], [79, 1], [79, 2]] },
  { id: 'bridal', title: 'Bridal Chorus ("Here Comes the Bride")', by: 'Richard Wagner', bpm: 96,
    notes: [[60, 1], [65, 1.5], [65, 0.5], [65, 2], [60, 1], [67, 1.5], [64, 0.5], [65, 2], [60, 1], [65, 1.5], [70, 0.5], [70, 1.5], [69, 0.5], [67, 1.5], [65, 0.5], [64, 1.5], [65, 0.5], [67, 2]] },
  { id: 'korobeiniki', title: 'Korobeiniki', by: 'Traditional (Russia)', bpm: 150,
    notes: [[76, 1], [71, 0.5], [72, 0.5], [74, 1], [72, 0.5], [71, 0.5], [69, 1], [69, 0.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5], [71, 1.5], [72, 0.5], [74, 1], [76, 1], [72, 1], [69, 1], [69, 2]] },
  { id: 'saints', title: 'When the Saints Go Marching In', by: 'Traditional (US)', bpm: 220,
    notes: [[60, 1], [64, 1], [65, 1], [67, 4], [60, 1], [64, 1], [65, 1], [67, 4], [60, 1], [64, 1], [65, 1], [67, 2], [64, 2], [60, 2], [64, 2], [62, 4]] },
  { id: 'jingle', title: 'Jingle Bells', by: 'James Lord Pierpont', bpm: 180,
    notes: [[64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2], [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4], [65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5], [67, 1], [67, 1], [65, 1], [62, 1], [60, 4]] },
  { id: 'langsyne', title: 'Auld Lang Syne', by: 'Traditional (Scotland)', bpm: 110,
    notes: [[60, 1], [65, 1.5], [65, 0.5], [65, 1], [69, 1], [67, 1.5], [65, 0.5], [67, 1], [69, 1], [65, 1.5], [65, 0.5], [69, 1], [72, 1], [74, 3]] },
  { id: 'susanna', title: 'Oh! Susanna', by: 'Stephen Foster', bpm: 170,
    notes: [[60, 0.5], [62, 0.5], [64, 1], [67, 1], [67, 1.5], [69, 0.5], [67, 1], [64, 1], [60, 1.5], [62, 0.5], [64, 1], [64, 1], [62, 1], [60, 1], [62, 3]] },
  { id: 'yankee', title: 'Yankee Doodle', by: 'Traditional (US)', bpm: 170,
    notes: [[60, 1], [60, 1], [62, 1], [64, 1], [60, 1], [64, 1], [62, 2], [60, 1], [60, 1], [62, 1], [64, 1], [60, 2], [59, 2]] },
  { id: 'morning', title: 'Morning Mood (Peer Gynt)', by: 'Edvard Grieg', bpm: 150,
    notes: [[67, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [62, 0.5], [64, 0.5], [67, 0.5], [64, 0.5], [62, 0.5], [60, 0.5], [62, 0.5], [64, 0.25], [62, 0.25], [64, 0.5], [67, 0.5], [64, 0.5], [67, 0.5], [69, 0.5], [64, 0.5], [69, 0.5], [67, 0.5], [64, 0.5], [62, 0.5], [60, 2]] },
]);

export function tuneById(id) {
  return SYNTH_TUNES.find((t) => t.id === id) || null;
}

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Render a tune to PCM: a pulse-wave lead, a triangle bass on each beat, a soft kick and
// a hat. The hook repeats to fill `seconds`, so the 3-second window always has music.
export function renderTune(tune, sampleRate = 44100, seconds = 12) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const beat = 60 / tune.bpm;
  const total = tune.notes.reduce((s, [, b]) => s + b, 0) * beat;
  // the lead
  let t0 = 0;
  while (t0 < seconds) {
    let t = t0;
    for (const [m, b] of tune.notes) {
      const dur = b * beat;
      if (m > 0) {
        const f = hz(m);
        const a = Math.floor(t * sampleRate);
        const len = Math.floor(Math.min(dur * 0.92, seconds - t) * sampleRate);
        for (let i = 0; i < len && a + i < n; i++) {
          const tt = i / sampleRate;
          const env = Math.min(1, tt / 0.006) * Math.min(1, (len - i) / (sampleRate * 0.02)) * (0.75 + 0.25 * Math.exp(-tt * 6));
          const ph = (tt * f) % 1;
          const vib = 1 + 0.004 * Math.sin(tt * 34) * Math.min(1, tt * 3);
          const ph2 = (tt * f * vib * 1.003) % 1;
          out[a + i] += env * 0.17 * ((ph < 0.25 ? 1 : -1) + 0.5 * (ph2 < 0.5 ? 1 : -1));
        }
      }
      t += dur;
      if (t >= seconds) break;
    }
    t0 += total;
  }
  // the rhythm section: root of the first note of each phrase, an octave or two down
  const root = (tune.notes.find(([m]) => m > 0) || [60])[0];
  const bassHz = hz(root - 24);
  for (let k = 0; k * beat < seconds; k++) {
    const a = Math.floor(k * beat * sampleRate);
    const len = Math.floor(beat * 0.85 * sampleRate);
    const f = k % 4 === 2 ? bassHz * 1.498 : bassHz; // root, root, fifth, root
    for (let i = 0; i < len && a + i < n; i++) {
      const tt = i / sampleRate;
      const ph = (tt * f) % 1;
      const tri = 4 * Math.abs(ph - 0.5) - 1;
      out[a + i] += tri * 0.2 * Math.exp(-tt * 3);
      // kick on every beat: a falling sine
      if (tt < 0.12) out[a + i] += Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-tt * 40)) * tt) * 0.32 * Math.exp(-tt * 22);
    }
    // a hat on the off-beat
    const h = Math.floor((k + 0.5) * beat * sampleRate);
    let seed = (k * 9301 + 49297) % 233280;
    for (let i = 0; i < sampleRate * 0.04 && h + i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      out[h + i] += ((seed / 233280) * 2 - 1) * 0.06 * Math.exp(-i / (sampleRate * 0.012));
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.1);
  return out;
}
