// Score motifs from the v1 table (references/scenes.md, "Score"), as functions returning synth events.
// A film's score is (cues) => events[]; concatenate motifs placed at cue times:
//   score: (c) => [plucks(0, c.shots[0].dur), dyad(c.end - 1, 1)]
// Loops count steps rather than adding floats, so onsets land exactly on their grid.
import { pentHz } from '../core/synth.js';
import { hash32, rng } from '../core/rand.js';
import { speech } from '../core/text.js';

export { pentHz };

// One enveloped oscillator (v1 note).
export const note = (t, hz, dur, type = 'triangle', gain = 0.25) => ({ t, hz, dur, type, gain });

// A noise burst (v1 noiseBurst).
export const burst = (t, dur = 0.25, gain = 0.3, seed = 1) => ({ t, dur, type: 'noise', gain, seed });

const steps = (t0, dur, every) => Array.from({ length: Math.max(0, Math.ceil(dur / every - 1e-9)) }, (_, k) => [k, t0 + k * every]);
const stepOf = (how, k, r) => (Array.isArray(how) ? how[k % how.length] : how === 'rise' ? k : Math.floor(r() * 5));

// Establishing, sea: slow pentatonic plucks, triangle, one every 0.5 s.
// steps: 'random' (seeded), 'rise' (0, 1, 2, ...) or a list of steps.
export function plucks(t0, dur, { every = 0.5, oct = 0, type = 'triangle', gain = 0.2, len = 0.7, steps: how = 'random', seed = 7 } = {}) {
  const r = rng(seed);
  return steps(t0, dur, every).map(([k, t]) => note(t, pentHz(oct, stepOf(how, k, r)), len, type, gain));
}

// Blueprint interlude: 55 Hz sawtooth swell plus a sine an octave up.
export const swell = (t0, dur = 1.2, { gain = 0.12 } = {}) => [
  note(t0, 55, dur, 'saw', gain),
  note(t0 + 0.1, 110, Math.max(0.1, dur - 0.2), 'sine', gain * 1.25),
];

// Doubling, cues, cards: one short note per cue, rising through the pentatonic (octaves carry).
// Cards: type 'square' at a low gain.
export function cueNotes(times, { oct = 1, type = 'sine', gain = 0.22, len = 0.5, from = 0 } = {}) {
  return times.map((t, k) => { const s = from + k; return note(t, pentHz(oct + Math.floor(s / 5), s % 5), len, type, gain); });
}

// Travel: 1/8-note square arpeggio plus a sine pulse every 0.5 s.
export function travel(t0, dur, { seed = 11, gain = 0.05 } = {}) {
  const r = rng(seed);
  return [
    ...steps(t0, dur, 0.125).map(([, t]) => note(t, pentHz(1, Math.floor(r() * 5)), 0.14, 'square', gain)),
    ...steps(t0, dur, 0.5).map(([, t]) => note(t, pentHz(0, 0), 0.4, 'sine', gain * 2.4)),
  ];
}

// Page, pencil: sparse sines an octave down, one per 0.75 s.
export function sparse(t0, dur, { seed = 13, gain = 0.12, every = 0.75 } = {}) {
  const r = rng(seed);
  return steps(t0, dur, every).map(([, t]) => note(t, pentHz(-1, Math.floor(r() * 5)), 0.9, 'sine', gain));
}

// Impact: a noise burst plus a 55 Hz sine.
export const impact = (t, { gain = 0.3, seed = 1 } = {}) => [burst(t, 0.25, gain, seed), note(t, 55, 0.6, 'sine', gain)];

// Gallery, sign-off: a long sine dyad with a 1 s release.
export const dyad = (t0, dur = 1, { gain = 0.25, root = [-1, 0], third = [0, 2] } = {}) => [
  note(t0, pentHz(...root), dur, 'sine', gain),
  note(t0 + 0.1, pentHz(...third), Math.max(0.1, dur - 0.1), 'sine', gain * 0.6),
];

// Speech (actor.say): one pluck on each syllable's onset, the step from the syllable's own letters, so a line
// always plays the same tune; a line ending in '?' rises on its last syllable.
export function pluckPerSyllable(text, t0, { oct = 1, type = 'triangle', gain = 0.14, len = 0.22, seed = 0 } = {}) {
  const { syllables } = speech(text, t0), ask = /\?\s*$/.test(text);
  return syllables.map((s, k) => {
    const up = ask && k === syllables.length - 1;
    return note(s.t, pentHz(oct + (up ? 1 : 0), up ? 2 : hash32('say', s.text.toLowerCase(), seed) % 5), len, type, gain);
  });
}
