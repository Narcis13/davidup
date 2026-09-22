// Lip sync from a recording (4.0 V3): a mouth shape per 1/12 s of a sample, so a voiced actor.say and
// actor.mouth move the mouth with the voice rather than with a syllable cycle. Browser-safe: the player makes
// the same track from the same bytes.
//
//   mouthFrom(id)                { id, by, shapes, from, to }: one letter per frame of the sample (1/12 s
//                                from its start), from / to the first and one past the last frame not X
//   energyMouth(samples, sr)     the default: the voice band's energy per frame, dips shut, quantised
//   cuesMouth(cues, sec, by)     a tool's cues ([{ start, end, value }], Rhubarb's mouthCues) on the grid
//   mouthAt(M, t)                the letter at t seconds into the sample, null outside it
//   mouthIndex(shape, n)         a letter as the variant index of a puppet with n mouths
//
// The letters are the Preston Blair set as Rhubarb Lip Sync names them: A shut (M B P), B a little open on
// clenched teeth (most consonants, ee), C open (eh), D wide (ah), E slightly rounded (aw, er), F puckered
// (oo, w), G teeth on the lip (f, v), H the tongue up (l), X at rest (silence). Energy gives A to D and X;
// `hdf align <id> --mouth` stores Rhubarb's on the sample's catalogue entry (`mouth`), which wins when there.
import { FPS } from './curves.js';
import { peek } from './store.js';
import { pcmOf, SR } from './synth.js';

// The letters a track is written in, A to H and X for rest.
export const MOUTH_SHAPES = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);

// ---------- the energy track ----------

// One-pole filters: the voice band (300 Hz to 2.5 kHz) is where the vowels are loud and most consonants
// (s, f, th, h) are not, so its energy opens on the vowels and falls on the consonants between them.
function band(x, sr) {
  const hp = Math.exp(-2 * Math.PI * 300 / sr), lp = Math.exp(-2 * Math.PI * 2500 / sr), y = new Float32Array(x.length);
  let a = 0, b = 0;
  for (let i = 0; i < x.length; i++) {
    a = (1 - hp) * x[i] + hp * a;
    b = (1 - lp) * (x[i] - a) + lp * b;
    y[i] = b;
  }
  return y;
}

// Four sub-windows a frame (1/48 s): a frame's mean opens the mouth, a sub-window that dips between louder
// ones shuts it (a consonant inside a phrase), a frame all below the floor rests.
const SUB = 4, DIP = 0.25, LOUD = 0.5, OPEN = [0.4, 0.8];

// energyMouth(samples, sr) => { by: 'energy', shapes } (a string, a letter a frame).
export function energyMouth(x, sr = SR) {
  const y = band(x, sr), n = Math.ceil((x.length / sr) * FPS - 1e-9), m = n * SUB, rms = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const a = Math.round((j * sr) / (FPS * SUB)), e = Math.min(y.length, Math.round(((j + 1) * sr) / (FPS * SUB)));
    let s = 0;
    for (let i = a; i < e; i++) s += y[i] * y[i];
    rms[j] = e > a ? Math.sqrt(s / (e - a)) : 0;
  }
  // The loud part (the 90th percentile of what is above an absolute floor) sets the scale, so a quiet take
  // opens as wide as a loud one; the floor under it is silence.
  const heard = [...rms].filter((v) => v > 0.002).sort((p, q) => p - q);
  const loud = heard[Math.floor(heard.length * 0.9)] ?? 0, floor = Math.max(0.002, loud * 0.08);
  const lv = Array.from(rms, (v) => (loud ? v / loud : 0));
  // A dip: below DIP with a sub-window at LOUD or more within a frame before it and within a frame after it.
  const dip = (j) => lv[j] < DIP && lv.slice(Math.max(0, j - SUB), j).some((v) => v >= LOUD) && lv.slice(j + 1, j + 1 + SUB).some((v) => v >= LOUD);
  const out = [];
  for (let k = 0; k < n; k++) {
    const sub = [...rms.slice(k * SUB, (k + 1) * SUB)];
    if (sub.every((v) => v <= floor)) { out.push('X'); continue; }
    if (sub.some((_, q) => dip(k * SUB + q))) { out.push('A'); continue; }
    const mean = sub.reduce((p, q) => p + q, 0) / sub.length / loud;
    out.push(mean < OPEN[0] ? 'B' : mean < OPEN[1] ? 'C' : 'D');
  }
  // A single frame of rest between two voiced ones is a closure, not a breath.
  for (let k = 1; k < n - 1; k++) if (out[k] === 'X' && out[k - 1] !== 'X' && out[k + 1] !== 'X') out[k] = 'A';
  return { by: 'energy', shapes: out.join('') };
}

// ---------- a tool's cues ----------

// cuesMouth([{ start, end, value }], sec, by) => { by, shapes }: each frame takes the cue that covers most of
// it, except that a shut mouth (A) held for a quarter of a frame or more wins it, so a quick m, b or p still
// closes the lips on the twelves. Letters outside the set (Rhubarb's basic shapes are A to F) are refused.
export function cuesMouth(cues, sec, by = 'json') {
  const list = (Array.isArray(cues) ? cues : cues?.mouthCues ?? []).map((c) => ({ a: +c.start, b: +c.end, v: String(c.value).toUpperCase() }));
  for (const c of list) {
    if (!MOUTH_SHAPES.includes(c.v)) throw new Error(`mouth: cue '${c.v}' is not one of ${MOUTH_SHAPES.join(' ')}`);
    if (!Number.isFinite(c.a) || !Number.isFinite(c.b) || c.b < c.a) throw new Error(`mouth: a cue needs start <= end in seconds, got ${c.a}..${c.b}`);
  }
  const end = Math.max(+sec || 0, ...list.map((c) => c.b)), n = Math.ceil(end * FPS - 1e-9), F = 1 / FPS, out = [];
  for (let k = 0; k < n; k++) {
    const a = k * F, b = a + F, over = (c) => Math.max(0, Math.min(b, c.b) - Math.max(a, c.a));
    const shut = list.filter((c) => c.v === 'A').reduce((p, c) => p + over(c), 0);
    if (shut >= F / 4 - 1e-9) { out.push('A'); continue; }
    let best = 'X', most = 0;
    for (const c of list) { const o = over(c); if (o > most + 1e-9) { most = o; best = c.v; } }
    out.push(best);
  }
  return { by, shapes: out.join('') };
}

// ---------- by id ----------

// Everything wrong with a stored track, as sentences (core/assets.js validates the entry with it).
export function checkMouth(s) {
  if (!s || typeof s !== 'object') return ["mouth: { by, shapes: 'XBDCA...' } (a letter per 1/12 s)"];
  const bad = [];
  if (!['energy', 'rhubarb', 'json'].includes(s.by)) bad.push("mouth.by: 'energy', 'rhubarb' or 'json'");
  if (typeof s.shapes !== 'string' || !/^[A-HX]*$/.test(s.shapes)) bad.push('mouth.shapes: a string of A to H and X, a letter per 1/12 s');
  return bad;
}

const span = (shapes) => {
  const from = shapes.search(/[^X]/);
  return from < 0 ? { from: 0, to: 0 } : { from, to: shapes.length - /[^X]/.exec([...shapes].reverse().join('')).index };
};

const MEMO = new Map();

// mouthFrom(id) => { id, by, shapes, from, to }: the stored track on the sample's entry when it has one, else
// the energy track made from its wav (once per process).
export function mouthFrom(id) {
  if (MEMO.has(id)) return MEMO.get(id);
  const r = peek(id), M = r?.mouth && !checkMouth(r.mouth).length ? { by: r.mouth.by, shapes: r.mouth.shapes } : energyMouth(pcmOf(id).samples, SR);
  const out = Object.freeze({ id, ...M, ...span(M.shapes) });
  MEMO.set(id, out);
  return out;
}

// Forget the memo (a test that changes a sample, `hdf align --mouth` after it stores a new track).
export const clearMouths = () => MEMO.clear();

// The letter at t seconds into the sample, or null before it or past its last frame.
export function mouthAt(M, t) {
  const k = Math.floor(t * FPS + 1e-9);
  return k < 0 || k >= M.shapes.length ? null : M.shapes[k];
}

// ---------- onto a puppet ----------

// Per mouth count, each letter's variant index; OPENNESS is how open a letter is, for any other count.
const BY_COUNT = {
  4: { A: 0, B: 0, C: 2, D: 2, E: 1, F: 1, G: 0, H: 1, X: 0 },
  6: { A: 0, B: 1, C: 2, D: 3, E: 2, F: 4, G: 1, H: 2, X: 0 },
  8: { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, X: 0 },
};
const OPENNESS = { A: 0, B: 1, C: 2, D: 3, E: 2, F: 1, G: 0, H: 1, X: 0 };

// A letter as a mouth variant index for a puppet with n of them. Four is the fox's (0 shut, 1 a little open,
// 2 wide, 3 a smile; with so few, clenched teeth read as shut, so it closes on the consonants), six the stick
// face's (0 shut, 1 a little open, 2 open, 3 wide, 4 an oo, 5 a smile), eight or more a puppet that draws the
// set itself (A to H as 0 to 7, rest shut). Any other count opens by how open the letter is, up to its widest.
export function mouthIndex(shape, n) {
  if (!(n > 0)) return undefined;
  const t = BY_COUNT[n >= 8 ? 8 : n];
  return t ? t[shape] ?? 0 : Math.min(n - 1, OPENNESS[shape] ?? 0);
}
