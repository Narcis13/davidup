// Capture: your face and hands on the puppet (4.0 K7). A face or hands landmarker's output, once, becomes a
// *track* in the store (kind 'clip', `track: 'face' | 'hands'`): numbers a frame on the 1/12 s grid, no
// drawing. An actor reads a track at a time and hands back a state patch in its own inputs, so a phone clip
// of you talking drives sam's mouth, eyes and brows, and your hands its mitts.
//
//   raw face  = { fps, frames: [ { jawOpen, mouthSmileLeft, ... 52 blendshapes } | null ] }   (cli/track.py)
//   raw hands = { fps, frames: [ [{ x, lm: [[x, y, z] x 21] }, ...] | null ] }                (x: the wrist's)
//   faceClip(raw)   => { track: 'face', n, fps: 12, keys: FACE_KEYS, frames: [[v, ...]], face }
//   handsClip(raw)  => { track: 'hands', n, fps: 12, frames: [{ l: [5 curls] | null, r }], hands }
//   faceState(actor, track, k, { mirror })    the actor's inputs for frame k
//   handsState(actor, track, k, { mirror })
//   actor.face(id | track, t, t0 = 0, o)      the same at t seconds (a track started at t0); {} outside it
//   actor.hands(id | track, t, t0 = 0, o)
//
// Sides: the picture's left drives the drawing's left (-l). A person facing the camera has their right hand
// and eye on the picture's left, and a puppet facing us its right on the drawing's left (the fox's brow-l),
// so the unmirrored clip drives the same side of the body. A selfie camera's mirrored picture: { mirror: true }.
// MediaPipe names a blendshape by the person's own side (eyeBlinkLeft: their left eye, the picture's right).
//
// The face (52 blendshapes -> 12 channels, 0..1 but look, -1..1):
//   jaw jawOpen; smile the smiles' mean; pucker the pucker or funnel; blink-l blink-r (the picture's sides);
//   wide eyeWide's mean; brow-up browInnerUp; brow-outer browOuterUp's mean; down-l down-r browDown;
//   look-x look-y the eyes' gaze (+x the picture's right, +y down).
// Each channel less its take's resting level (its 10th percentile: a face at rest is not all zeros), each
// 1/12 s the mean of the source frames in it (a blink the max, so a quick one survives), a frame with no face
// taking its neighbours' (ends hold), quantised on 0.05.
// Onto an actor:
//   mouth   jaw 0.5 D, 0.3 C; pucker 0.4 E (open) or F; jaw 0.12 B; a smile 0.4 the happy expression's mouth;
//           else X; as the puppet's mouth by actor.mouthFor (V3: a variant named by the letter, or by count)
//   eye     both blinks 0.5 the puppet's shut eye (sleep, shut, closed); one only a wink; half-shut 'half';
//           wide 0.5 'wide'; else 'open', each only when the puppet has it
//   brows   the puppet's own expressions scaled: brow-up by worried's turn and half surprised's lift,
//           brow-outer by surprised's lift, down-l down-r by angry's turn and lift; on their grids
//   pupils  look-x look-y times the pupil's slide range
// Hands (21 landmarks a hand -> five curls, thumb to little finger, 1 straight, 0 curled): a finger's tip
// from the wrist against its knuckle from the wrist (the thumb: how straight it is, and its tip's distance
// from the index knuckle against the palm's width), the frame nearest the grid (a pose does not blend), a
// hand lost for under half a second held, on 0.1. The hand on the picture's left is `l`. Onto a hand part
// with variants (a stick with `hands: 'fingers'`): the nearest
// of HAND_POSES it has: open (all straight), fist (none), point (the index), thumb (the thumb).
import { FPS } from './curves.js';
import { peek } from './store.js';

// The twelve channels a face track keeps a frame, in order (see the top of this file).
export const FACE_KEYS = Object.freeze(['jaw', 'smile', 'pucker', 'blink-l', 'blink-r', 'wide', 'brow-up', 'brow-outer', 'down-l', 'down-r', 'look-x', 'look-y']);
// The hand shapes as five curls, thumb to little finger (1 straight, 0 curled): a hand part's variants by these names.
export const HAND_POSES = Object.freeze({ open: [1, 1, 1, 1, 1], fist: [0, 0, 0, 0, 0], point: [0, 1, 0, 0, 0], thumb: [1, 0, 0, 0, 0] });
// The kinds of track a clip entry may be.
export const TRACKS = Object.freeze(['face', 'hands']);

const q = (v, st) => Math.round(v / st) * st;
const q05 = (v) => +q(v, 0.05).toFixed(2) || 0;
const q1 = (v) => +q(v, 0.1).toFixed(1) || 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (v, p) => { const a = [...v].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; };

// ---------- the face ----------

// One frame of blendshapes as the channels, the picture's left as -l (see the top of this file).
function channels(b) {
  const g = (k) => (Number.isFinite(b?.[k]) ? b[k] : 0), m2 = (a, c) => (g(a) + g(c)) / 2;
  return {
    jaw: g('jawOpen'), smile: m2('mouthSmileLeft', 'mouthSmileRight'), pucker: Math.max(g('mouthPucker'), g('mouthFunnel')),
    'blink-l': g('eyeBlinkRight'), 'blink-r': g('eyeBlinkLeft'), wide: m2('eyeWideLeft', 'eyeWideRight'),
    'brow-up': g('browInnerUp'), 'brow-outer': m2('browOuterUpLeft', 'browOuterUpRight'),
    'down-l': g('browDownRight'), 'down-r': g('browDownLeft'),
    // Their left is the picture's right: eyes turned to their left look out of the left eye and into the right.
    'look-x': m2('eyeLookOutLeft', 'eyeLookInRight') - m2('eyeLookInLeft', 'eyeLookOutRight'),
    'look-y': m2('eyeLookDownLeft', 'eyeLookDownRight') - m2('eyeLookUpLeft', 'eyeLookUpRight'),
  };
}

// Every frame, one with nothing found taking the nearest found either side (linear between, ends hold).
function mend(frames, what) {
  const have = frames.map((f, k) => (f ? k : -1)).filter((k) => k >= 0);
  if (!have.length) throw new Error(`${what}: nothing found in any of the ${frames.length} frames`);
  return frames.map((f, k) => {
    if (f) return f;
    const a = [...have].reverse().find((j) => j < k), b = have.find((j) => j > k);
    if (a === undefined || b === undefined) return frames[a ?? b];
    const t = (k - a) / (b - a);
    return Object.fromEntries(Object.keys(frames[a]).map((c) => [c, frames[a][c] + (frames[b][c] - frames[a][c]) * t]));
  });
}

// The source frames each 1/12 s covers (at least one: the nearest).
function windows(n, fps) {
  const N = Math.max(1, Math.round(n * FPS / fps));
  return Array.from({ length: N }, (_, k) => {
    const a = Math.floor(k * fps / FPS + 1e-9), b = Math.max(a + 1, Math.floor((k + 1) * fps / FPS + 1e-9));
    return Array.from({ length: Math.min(b, n) - Math.min(a, n - 1) }, (_, i) => Math.min(a, n - 1) + i);
  });
}

// A face landmarker's blendshapes as a face track (see the top of this file).
export function faceClip(raw, { credit = '', source = '' } = {}) {
  if (!raw || !Array.isArray(raw.frames) || !raw.frames.length) throw new Error('face: expected { fps, frames: [blendshapes | null] }');
  const fps = raw.fps ?? FPS, found = raw.frames.filter(Boolean).length;
  const src = mend(raw.frames.map((b) => (b && typeof b === 'object' ? channels(b) : null)), 'face');
  // A take's resting level: most faces rest with a little brow and jaw; the gaze has none.
  const baseline = Object.fromEntries(FACE_KEYS.map((c) => [c, /^look/.test(c) ? 0 : +pct(src.map((f) => f[c]), 0.1).toFixed(3)]));
  const frames = windows(src.length, fps).map((w) => FACE_KEYS.map((c) => {
    const vs = w.map((i) => src[i][c] - baseline[c]), v = /^blink/.test(c) ? Math.max(...vs) : mean(vs);
    return q05(/^look/.test(c) ? clamp(v, -1, 1) : clamp(v, 0, 1));
  }));
  return { track: 'face', n: frames.length, fps: FPS, credit, source, keys: [...FACE_KEYS], frames, face: { from: raw.frames.length, fps, found, baseline } };
}

// ---------- hands ----------

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0));
const FINGERS = [[5, 8], [9, 12], [13, 16], [17, 20]];   // knuckle, tip: index, middle, ring, little

// Five curls, thumb first, 1 straight and 0 curled, from a hand's 21 landmarks.
export function curlsOf(lm) {
  const W = lm[0], palm = dist(lm[5], lm[17]) || 1e-6;
  // The thumb: straight (its tip as far from its knuckle as its joints add up to) and away from the index.
  const straight = clamp((dist(lm[2], lm[4]) / ((dist(lm[2], lm[3]) + dist(lm[3], lm[4])) || 1e-6) - 0.8) / 0.18, 0, 1);
  const thumb = clamp((straight + clamp((dist(lm[4], lm[5]) / palm - 0.8) / 0.8, 0, 1)) / 2, 0, 1);
  return [thumb, ...FINGERS.map(([k, t]) => clamp((dist(W, lm[t]) / (dist(W, lm[k]) || 1e-6) - 1.15) / 0.65, 0, 1))];
}

// A hand landmarker's hands as a hands track (see the top of this file).
export function handsClip(raw, { credit = '', source = '', hold = 0.5 } = {}) {
  if (!raw || !Array.isArray(raw.frames) || !raw.frames.length) throw new Error('hands: expected { fps, frames: [[{ x, lm }] | null] }');
  const fps = raw.fps ?? FPS;
  // Each frame's hands by side: the one further left in the picture is l (one alone: by the picture's middle).
  const sides = raw.frames.map((f) => {
    const hs = (Array.isArray(f) ? f : []).filter((h) => Array.isArray(h?.lm) && h.lm.length >= 21);
    const at = (h) => (Number.isFinite(h.x) ? h.x : h.lm[0][0]);
    if (hs.length >= 2) { const [a, b] = [...hs].sort((u, v) => at(u) - at(v)); return { l: curlsOf(a.lm), r: curlsOf(b.lm) }; }
    if (hs.length === 1) return at(hs[0]) < 0.5 ? { l: curlsOf(hs[0].lm), r: null } : { l: null, r: curlsOf(hs[0].lm) };
    return { l: null, r: null };
  });
  if (!sides.some((s) => s.l || s.r)) throw new Error(`hands: no hand found in any of the ${raw.frames.length} frames`);
  // A hand lost for a moment keeps its last curls.
  const keep = Math.round(hold * fps);
  for (const s of ['l', 'r']) {
    let last = null, since = 0;
    for (const f of sides) {
      if (f[s]) { last = f[s]; since = 0; } else if (last && ++since <= keep) f[s] = last;
    }
  }
  const frames = windows(sides.length, fps).map((w) => {
    const f = sides[w[0]];
    return { l: f.l ? f.l.map(q1) : null, r: f.r ? f.r.map(q1) : null };
  });
  const seen = (s) => sides.filter((f) => f[s]).length;
  return { track: 'hands', n: frames.length, fps: FPS, credit, source, frames, hands: { from: raw.frames.length, fps, l: seen('l'), r: seen('r') } };
}

// The nearest of the poses a hand has to five curls.
export function nearestHand(curls, have = Object.keys(HAND_POSES)) {
  let best = null, bd = Infinity;
  for (const n of have) {
    const t = HAND_POSES[n];
    if (!t) continue;
    const dd = t.reduce((s, v, i) => s + (v - curls[i]) ** 2, 0);
    if (dd < bd) { bd = dd; best = n; }
  }
  return best;
}

// ---------- tracks ----------

// Everything wrong with a track payload, as sentences.
export function checkTrack(d) {
  const bad = [];
  if (!TRACKS.includes(d?.track)) return [`track: ${TRACKS.join(' | ')}`];
  if (!(Number.isInteger(d.n) && d.n > 0)) bad.push('n: an integer > 0');
  if (!Array.isArray(d.frames) || d.frames.length !== d.n) bad.push(`frames: n (${d.n}) of them`);
  else if (d.track === 'face') {
    if (!Array.isArray(d.keys) || !d.keys.length) bad.push('keys: the channels each frame lists');
    else d.frames.forEach((f, i) => { if (!Array.isArray(f) || f.length !== d.keys.length || !f.every(Number.isFinite)) bad.push(`frames[${i}]: ${d.keys.length} numbers`); });
  } else {
    const ok = (c) => c === null || (Array.isArray(c) && c.length === 5 && c.every(Number.isFinite));
    d.frames.forEach((f, i) => { if (!f || !ok(f.l) || !ok(f.r)) bad.push(`frames[${i}]: { l, r }, five curls or null each`); });
  }
  return bad.slice(0, 8);
}

// A track given as itself or by its id in the store; its frame at t (started at t0), or -1 outside it.
export function trackOf(src, kind) {
  const d = typeof src === 'string' ? peek(src) : src;
  if (!d) throw new Error(`${kind}: no track '${src}' (name it in fromStore([...]) at the top of the film)`);
  if (d.track !== kind) throw new Error(`${kind}: '${typeof src === 'string' ? src : 'the track'}' is ${d.track ? `a ${d.track} track` : 'not a track'}, not a ${kind} track (hdf clip --kind ${kind})`);
  return d;
}
export const frameAt = (d, t, t0 = 0) => {
  const k = Math.floor((t - t0) * (d.fps ?? FPS) + 1e-9);
  return k >= 0 && k < d.n ? k : -1;
};

// ---------- onto an actor ----------

const brows = ['brow-l', 'brow-r', 'brow-l.y', 'brow-r.y'];
const sideOf = (k) => (/^brow-l/.test(k) ? 'l' : 'r');

// The actor's inputs for frame k of a face track (see the top of this file).
export function faceState(actor, d, k, { mirror = false } = {}) {
  const f = Object.fromEntries(d.keys.map((c, i) => [c, d.frames[k][i]]));
  if (mirror) {
    for (const [a, b] of [['blink-l', 'blink-r'], ['down-l', 'down-r']]) [f[a], f[b]] = [f[b], f[a]];
    f['look-x'] = -f['look-x'];
  }
  const out = {}, rest = actor.rest ?? {}, inputs = actor.inputs ?? {}, V = actor.variantKeys ?? [];
  const has = (k2) => inputs[k2] !== undefined;
  const eyes = has('eye') && V.includes('eye') ? [...(Array.isArray(inputs.eye) ? inputs.eye : [])] : [];

  // The mouth.
  if (has('mouth') && actor.mouthFor) {
    const jaw = f.jaw ?? 0, pucker = f.pucker ?? 0, smile = f.smile ?? 0;
    const letter = jaw >= 0.5 ? 'D' : jaw >= 0.3 ? 'C' : pucker >= 0.4 ? (jaw >= 0.15 ? 'E' : 'F') : jaw >= 0.12 ? 'B' : smile >= 0.4 ? null : 'X';
    const m = letter ? actor.mouthFor(letter) : actor.emote('happy').mouth ?? actor.mouthFor('B');
    if (m !== undefined) out.mouth = m;
  }
  // The eyes.
  if (eyes.length) {
    const bl = f['blink-l'] ?? 0, br = f['blink-r'] ?? 0, shut = ['sleep', 'shut', 'closed'].find((e) => eyes.includes(e));
    const pick = (...ks) => ks.find((e) => eyes.includes(e));
    const e = bl >= 0.5 && br >= 0.5 ? shut
      : Math.max(bl, br) >= 0.5 && Math.min(bl, br) < 0.3 ? pick('wink') ?? shut
        : (bl + br) / 2 >= 0.3 ? pick('half')
          : (f.wide ?? 0) >= 0.5 ? pick('wide') : undefined;
    const got = e ?? pick('open');
    if (got !== undefined) out.eye = got;
  }
  // The brows: the puppet's own worried, surprised and angry, scaled by the channels.
  const worried = actor.emote('worried'), surprised = actor.emote('surprised'), angry = actor.emote('angry');
  for (const key of brows) {
    if (!has(key)) continue;
    const r = typeof rest[key] === 'number' ? rest[key] : 0, dv = (e) => (typeof e[key] === 'number' ? e[key] - r : 0);
    const down = f[`down-${sideOf(key)}`] ?? 0, up = f['brow-up'] ?? 0, outer = f['brow-outer'] ?? 0;
    const v = /\.y$/.test(key)
      ? r + up * 0.5 * dv(surprised) + outer * dv(surprised) + down * dv(angry)
      : r + up * dv(worried) + down * dv(angry);
    out[key] = snap(inputs[key], v);
  }
  // The pupils.
  for (const [key, c] of [['pupil.x', 'look-x'], ['pupil.y', 'look-y']]) {
    if (!has(key) || !Array.isArray(inputs[key])) continue;
    const [lo, hi] = inputs[key], v = f[c] ?? 0;
    out[key] = snap(inputs[key], v >= 0 ? v * hi : -v * lo);
  }
  return out;
}

// The actor's inputs for frame k of a hands track: each hand part with variants the nearest pose it has.
export function handsState(actor, d, k, { mirror = false } = {}) {
  const f = d.frames[k], out = {}, inputs = actor.inputs ?? {};
  for (const s of ['l', 'r']) {
    const part = `hand-${s}`, curls = f[mirror ? (s === 'l' ? 'r' : 'l') : s];
    if (!curls || !(actor.variantKeys ?? []).includes(part) || !Array.isArray(inputs[part])) continue;
    const got = nearestHand(curls, inputs[part]);
    if (got) out[part] = got;
  }
  return out;
}

// A number on an input's grid and in its range ([min, max, step]; a joint without one: 2 degrees).
function snap(spec, v) {
  const [lo, hi, st] = Array.isArray(spec) && spec.length === 3 && spec.every(Number.isFinite) ? spec : [-180, 180, 2];
  return +clamp(Math.round(v / st) * st, lo, hi).toFixed(6) || 0;
}
