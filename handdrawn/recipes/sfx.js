// Sound effects and a music bed (4.0 V4), from the synth: pitch sweeps, noise bursts, swept band-passes and
// envelopes. Each is (t, options) => synth events, placed in film seconds like the motifs in score.js:
//   score: (c) => [bed({ mood: 'bright', to: c.end }), pop(c.shots[1].t0), ...hits(c.cuts)]
//
//   pop(t)             a cork: a sine swept up an octave and a half in 70 ms, and a click
//   boing(t)           a spring: a triangle bent up a fifth with a wide vibrato, half a second
//   whoosh(t, { dur }) air going past: noise swelling through a band-pass swept up (down: true, down)
//   ding(t)            a bell: a sine, a bright partial and a faint octave, ringing 1.4 s
//   tada(t, { key })   a fanfare: a short triad, then the same triad held with its octave
//   tick(t)            a mark: a short high noise and a click
//   squeak(t, { tool })  a tool on the surface: marker (a squeal), chalk, pen, pencil, crayon
//   flip(t)            a page turning: a swell falling through the band, and the page landing
//   erase(t, dur, { strokes })   an eraser scrubbing: a swell a stroke, alternately up and down
//   pencilScratch(t, dur)        graphite on paper: seeded grains of high, narrow noise
//   chalkTap(t)        chalk meeting the board: a knock and a dry tick
//   hits(cuts, { kind })          an accent on each cut: a whoosh centred on it (or pop, tick, boing, ding, flip)
//   writerSounds(node, { tool, ...writing's schedule })   the writer's pen (T6): its tool on each unit it writes
//   chalkTaps(node, { t0, ...writing's schedule })        chalk meeting the board at each line it starts (L2)
//   eraserSounds({ t, dur, box, band })                   the eraser's rows (fx('erase'), T6/L1)
//   bed({ tempo, key, mood, from, to })   a chord loop, its bar a whole number of twelfths; .stop(t), .sting(t)
//
// Everything is seeded and counted on integers, so a score always sounds the same. The whole score ducks 9 dB
// under a voice (V1), a bed with it.
import { FPS } from '../core/curves.js';
import { rng } from '../core/rand.js';
import { strokeStarts, writing } from '../core/write.js';
import { burst, note, pentHz } from './score.js';

// A hiss event (band-passed noise at hz; hz1 sweeps the band, swell rises and falls over dur).
const hiss = (t, dur, hz, gain, o = {}) => ({ t, dur, hz, type: 'hiss', gain, ...o });

// A cork: a sine swept up an octave and a half in 70 ms, and a click.
export const pop = (t, { gain = 0.22, hz = 380, seed = 31 } = {}) => [
  { ...note(t, hz, 0.09, 'sine', gain), attack: 0.003, hz1: hz * 2.6, bend: 0.07 },
  burst(t, 0.012, gain * 0.35, seed),
];

// A spring: a triangle bent up a fifth with a wide vibrato, and a faint octave (dur 0.55 s).
export const boing = (t, { gain = 0.16, hz = 150, dur = 0.55 } = {}) => [
  { ...note(t, hz, dur, 'triangle', gain), attack: 0.005, hz1: hz * 1.5, bend: dur * 0.4, vib: 11, vibDepth: 0.09 },
  { ...note(t, hz * 2, dur * 0.7, 'sine', gain * 0.3), attack: 0.005, hz1: hz * 3, bend: dur * 0.4, vib: 11, vibDepth: 0.09 },
];

// Air going past: noise swelling through a band-pass swept from `from` to `to` Hz (down: the other way).
export const whoosh = (t, { dur = 0.45, gain = 0.2, from = 350, to = 2600, down = false, q = 0.9, seed = 41 } = {}) =>
  [hiss(t, dur, down ? to : from, gain, { hz1: down ? from : to, swell: true, q, seed })];

// A bell: a sine at hz, a bright partial (2.76 hz) and a faint octave, ringing 1.4 s.
export const ding = (t, { gain = 0.3, hz = pentHz(2, 2) } = {}) => [
  note(t, hz, 1.4, 'sine', gain),
  { ...note(t, hz * 2.76, 0.5, 'sine', gain * 0.18), attack: 0.004 },
  note(t + 0.02, hz * 2, 1.1, 'sine', gain * 0.4),
];

// A mark: a short high noise and a click (a wrong answer crossed).
export const tick = (t, { gain = 0.18, seed = 91 } = {}) => [burst(t, 0.04, gain, seed), note(t, 1760, 0.06, 'square', gain * 0.28)];

// The tools a squeak (and the writer) knows, and how each sounds for dur seconds on the surface.
const TOOLS = {
  marker: (t, d, g, s) => [{ ...note(t, 1900, d, 'sine', g * 0.2), attack: 0.02, sus: 0.6, hz1: 2350, bend: d, vib: 17, vibDepth: 0.025 }, hiss(t, d, 2600, g * 0.35, { q: 2, swell: true, seed: s })],
  chalk: (t, d, g, s) => [...chalkTap(t, { gain: g, seed: s }), hiss(t, d, 3200, g * 0.6, { q: 1.6, swell: true, seed: s + 1 })],
  pen: (t, d, g, s) => [hiss(t, d, 4200, g * 0.45, { q: 1.4, swell: true, seed: s })],
  pencil: (t, d, g, s) => pencilScratch(t, d, { gain: g * 0.6, seed: s }),
  crayon: (t, d, g, s) => [hiss(t, d, 1300, g * 0.7, { q: 1, swell: true, seed: s })],
};
// The tools a squeak and the writer know.
export const SFX_TOOLS = Object.freeze(Object.keys(TOOLS));
const toolOf = (tool) => {
  if (!TOOLS[tool]) throw new TypeError(`sfx: unknown tool '${tool}' (${SFX_TOOLS.join(', ')})`);
  return TOOLS[tool];
};

// A tool on the surface for dur seconds: marker (a squeal), chalk (a tap, then dust), pen, pencil, crayon.
export const squeak = (t, { tool = 'marker', dur = 0.25, gain = 0.2, seed = 51 } = {}) => toolOf(tool)(t, dur, gain, seed);

// A page turning: a swell falling through the band, and the page landing.
export const flip = (t, { gain = 0.18, seed = 61 } = {}) => [
  hiss(t, 0.22, 2600, gain, { hz1: 700, swell: true, q: 0.8, seed }),
  burst(t + 0.2, 0.03, gain * 0.5, seed + 1),
];

// An eraser scrubbing for dur seconds: a swell a stroke, the band alternately up and down.
export function erase(t, dur, { strokes = 4, gain = 0.12, seed = 71 } = {}) {
  const n = Math.max(1, Math.round(strokes)), d = dur / n;
  return Array.from({ length: n }, (_, k) => hiss(t + k * d, d * 0.95, k % 2 ? 1300 : 900, gain, { hz1: k % 2 ? 900 : 1300, swell: true, q: 0.7, seed: seed + k }));
}

// Graphite on paper for dur seconds: grains every 1/16 s or so, each 50 to 90 ms, their level and band
// drawn from the seed.
export function pencilScratch(t, dur, { gain = 0.07, seed = 81 } = {}) {
  const r = rng(seed), out = [];
  for (let k = 0, u = 0; u < dur - 0.03; k++) {
    const d = Math.min(0.05 + r() * 0.04, dur - u);
    out.push(hiss(t + u, Math.max(0.03, d), 3400 + r() * 900, gain * (0.6 + r() * 0.4), { q: 1.4, swell: true, seed: seed + k }));
    u += 0.05 + r() * 0.025;
  }
  return out;
}

// Chalk meeting the board: a knock, a dry tick and a little dust.
export const chalkTap = (t, { gain = 0.2, seed = 101 } = {}) => [
  burst(t, 0.018, gain, seed),
  { ...note(t, 900, 0.03, 'sine', gain * 0.3), attack: 0.002 },
  hiss(t, 0.06, 2000, gain * 0.5, { q: 1.2, swell: true, seed: seed + 1 }),
];

const HITS = { whoosh, pop, tick, boing, ding, flip };

// An accent on each cut. kind a name of HITS or (t, k) => events; a whoosh is centred on the cut.
export function hits(cuts, { kind = 'whoosh', gain, dur = 0.45 } = {}) {
  const f = typeof kind === 'function' ? kind : HITS[kind];
  if (!f) throw new TypeError(`sfx hits: unknown kind '${kind}' (${Object.keys(HITS).join(', ')}, or a function)`);
  return cuts.flatMap((t, k) => {
    if (typeof kind === 'function') return f(t, k);
    const o = { ...(gain === undefined ? {} : { gain }), seed: 200 + k };
    return kind === 'whoosh' ? whoosh(Math.max(0, t - dur / 2), { ...o, dur }) : f(t, o);
  });
}

// The writer's sound (T6): the tool on the surface for each unit writing(node, sched) puts down, from the end
// of its lift to the end of its slot, t0 seconds on (the shot's start in film time). tool: a key of SFX_TOOLS
// (packs/hands.js toolFor(look) names marker, chalk and pen; pencil and crayon too).
export function writerSounds(node, { t0 = 0, tool = 'marker', gain = 0.2, seed = 121, ...sched } = {}) {
  const f = toolOf(tool);
  return writing(node, sched).units.flatMap((u, k) => f(t0 + u.t1, Math.max(0.05, u.t2 - u.t1), gain, seed + k));
}

// The chalkboard's sound (4.0 L2): a chalkTap each time writeOn(node, sched) puts the chalk down to start a line,
// t0 seconds on (the shot's start in film time), each seeded apart. With writerSounds(node, { tool: 'chalk' })
// the unit's scratch goes under the taps; alone, a board that only knocks.
export function chalkTaps(node, { t0 = 0, gain = 0.16, seed = 141, ...sched } = {}) {
  return strokeStarts(node, sched).flatMap((t, k) => chalkTap(t0 + t, { gain, seed: seed + k }));
}

// The eraser's sound: a stroke per row of fx('erase')'s track over box (default the 1080 frame) with a band
// (default 0.14 of its short side), as the effect sweeps it from t over dur.
export function eraserSounds({ t = 0, dur, box = [0, 0, 1080, 1080], band, gain, seed } = {}) {
  if (!(dur > 0)) throw new TypeError(`sfx eraserSounds: dur must be positive, got ${dur}`);
  const bw = band ?? Math.min(box[2], box[3]) * 0.14, rows = Math.max(1, Math.ceil(box[3] / (bw * 0.85)));
  return erase(t, dur, { strokes: rows, ...(gain === undefined ? {} : { gain }), ...(seed === undefined ? {} : { seed }) });
}

// ---------- the bed ----------

// Semitones above C, a key's name (a trailing 'm' makes it minor whatever the mood).
const NOTES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TRIAD = { M: [0, 4, 7], m: [0, 3, 7] };

// The bed's moods. Each: its tempo, its four chords (root semitones above the key, quality; a minor key flips I's
// quality), and how a bar is played: chord hits (beats and length in beats), a bass, an arpeggio, a snare.
export const MOODS = Object.freeze({
  bright: { tempo: 112, chords: [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']], hit: { beats: [0, 2], len: 1.6, type: 'triangle' }, bass: [0, 1, 2, 3], arp: 'eighths' },
  calm: { tempo: 72, chords: [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']], pad: { type: 'sine' }, bass: [0], arp: 'halves' },
  mystery: { tempo: 80, chords: [[0, 'm'], [8, 'M'], [5, 'm'], [7, 'M']], pad: { type: 'triangle', oct: -1 }, bass: [0, 2], arp: 'sparse' },
  march: { tempo: 116, chords: [[0, 'M'], [5, 'M'], [7, 'M'], [0, 'M']], hit: { beats: [0, 1, 2, 3], len: 0.35, type: 'square' }, bass: [0, 2], snare: [1, 3] },
});

// The bar, snapped: a whole number of twelfths (so every downbeat is a frame), four beats a bar.
export function barOf(tempo) {
  if (!(tempo > 0)) throw new TypeError(`bed: tempo must be a positive number of beats a minute, got ${tempo}`);
  const k = Math.max(4, Math.round((240 / tempo) * FPS));
  return { frames: k, bar: k / FPS, tempo: (240 * FPS) / k };
}

function keyOf(key) {
  const m = /^([A-G][#b]?)(m?)$/.exec(String(key));
  if (!m) throw new TypeError(`bed: key '${key}' is not a note name (C, F#, Bb, ... with an 'm' for minor)`);
  return { root: 48 + NOTES[m[1]], minor: m[2] === 'm' };
}

// The chord of bar k: its root near the key's (a fifth above at most) and its notes as MIDI numbers.
function chordOf(M, K, k) {
  const [r0, q0] = M.chords[k % M.chords.length], r = r0 > 7 ? r0 - 12 : r0;
  const q = K.minor && r0 === 0 ? 'm' : q0;
  return { root: K.root + r, notes: TRIAD[q].map((i) => K.root + r + i) };
}

// A music bed: an array of synth events (drop it in a score as it is) with
//   bar, tempo (snapped), bars (each bar's start), stop(t) (the bed ending at t, everything released by
//   t + 0.35) and sting(t) (a flourish in its key: an arpeggio up the tonic on the frames, then the chord held).
// A chord a bar through the mood's four; nothing starts at or after `to`, what is sounding rings out.
export function bed({ mood = 'bright', tempo, key = 'C', from = 0, to, gain = 0.07, seed = 7 } = {}) {
  const M = MOODS[mood];
  if (!M) throw new TypeError(`bed: unknown mood '${mood}' (${Object.keys(MOODS).join(', ')})`);
  if (!(to > from)) throw new TypeError(`bed: to (${to}) must be after from (${from})`);
  const K = keyOf(key), B = barOf(tempo ?? M.tempo), beat = B.bar / 4, r = rng(seed), ev = [], bars = [];
  const at = (k, b) => from + (k * B.frames) / FPS + b * beat;
  const add = (e) => { if (e.t < to - 1e-9) ev.push(e); };
  for (let k = 0; at(k, 0) < to - 1e-9; k++) {
    bars.push(at(k, 0));
    const C = chordOf(M, K, k);
    if (M.hit) for (const b of M.hit.beats) for (const m of C.notes) add(note(at(k, b), midiHz(m), M.hit.len * beat, M.hit.type, gain * 0.7));
    if (M.pad) for (const m of C.notes) add({ ...note(at(k, 0), midiHz(m + 12 * (M.pad.oct ?? 0)), B.bar * 1.05, M.pad.type, gain * 0.6), attack: 0.25, sus: 0.6 });
    for (const b of M.bass) add({ ...note(at(k, b), midiHz(C.root - 12), beat * 0.9, 'sine', gain * 1.4), attack: 0.01 });
    if (M.snare) for (const b of M.snare) add(burst(at(k, b), 0.08, gain * 0.9, seed + k * 4 + b));
    const up = [...C.notes, C.notes[0] + 12];
    if (M.arp === 'eighths') for (let j = 0; j < 8; j++) add(note(at(k, j / 2), midiHz(up[j % 4] + 12), beat * 0.45, 'sine', gain * 0.55));
    if (M.arp === 'halves') for (let j = 0; j < 2; j++) add(note(at(k, j * 2), midiHz(up[(j * 2 + k) % 4] + 12), beat * 1.8, 'sine', gain * 0.5));
    if (M.arp === 'sparse' && r() < 0.6) add({ ...note(at(k, 1 + Math.floor(r() * 2)), midiHz(up[Math.floor(r() * 4)] + 24), beat * 2.5, 'sine', gain * 0.35), vib: 5, vibDepth: 0.008 });
  }
  const opts = { mood, tempo: tempo ?? M.tempo, key, from, to, gain, seed };
  return Object.assign(ev, {
    bar: B.bar, tempo: B.tempo, bars,
    stop: (t) => {
      const cut = bed({ ...opts, to: Math.min(t, to) });
      const out = cut.map((e) => (e.t + e.dur > t + 0.35 ? { ...e, dur: Math.max(0.03, t + 0.35 - e.t), ...(e.sus ? { sus: 0 } : {}) } : e));
      return Object.assign(out, { bar: B.bar, tempo: B.tempo, bars: cut.bars, stop: cut.stop, sting: cut.sting });
    },
    sting: (t, { gain: g = gain * 3 } = {}) => {
      const tonic = chordOf(M, K, 0).notes.map((m) => m + 12), top = [...tonic, tonic[0] + 12];
      return [
        ...top.map((m, j) => note(t + j / FPS, midiHz(m), 0.3, 'triangle', g * 0.6)),
        ...top.map((m) => ({ ...note(t + 4 / FPS, midiHz(m), 1.4, 'triangle', g * 0.5), sus: 0.3 })),
        note(t + 4 / FPS, midiHz(tonic[0] - 24), 1.2, 'sine', g),
      ];
    },
  });
}

// A fanfare: ta (a short triad), then da (the triad held with its octave), in key (C by default).
export function tada(t, { key = 'C', gain = 0.1 } = {}) {
  const K = keyOf(key), T = TRIAD[K.minor ? 'm' : 'M'].map((i) => K.root + 12 + i), all = [...T, T[0] + 12];
  return [
    ...T.map((m) => ({ ...note(t, midiHz(m), 0.12, 'saw', gain * 0.8), attack: 0.005 })),
    ...all.map((m) => ({ ...note(t + 2 / FPS, midiHz(m), 1.1, 'saw', gain), attack: 0.01, sus: 0.4 })),
  ];
}
