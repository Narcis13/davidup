// A single-stroke hand font, drawn as polylines in a 100-unit em. Baseline at y = 0, y down:
// x-height -48, ascender and figures -72, descender +24. Each glyph is { w: advance, s: [flat pts, ...] }.
// Capitals stand at cap height -72 (same as the figures). Brackets run from cap height to the descender;
// the operators (+ - = × ÷ → ←) sit on -24, half the x-height.
import { splinePts } from './spline.js';

const D = Math.PI / 180;
// Elliptical arc from angle d0 to d1 in degrees (0 = east, 90 = south; d1 < d0 runs anticlockwise on screen).
function A(cx, cy, rx, ry, d0, d1) {
  const n = Math.max(4, Math.ceil(Math.abs(d1 - d0) / 12)), out = [];
  for (let i = 0; i <= n; i++) { const a = (d0 + (d1 - d0) * i / n) * D; out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  return out;
}
const L = (...xy) => xy;                                  // a polyline
const S = (...xy) => splinePts(xy, { n: 6 });     // a smooth curve through the points
const J = (...parts) => parts.flat();                     // join pieces into one stroke
const dot = (x, y) => A(x, y, 2.2, 2.2, 0, 360);

export const GLYPHS = Object.freeze({
  a: { w: 46, s: [A(22, -24, 18, 24, -35, -370), L(40, -48, 40, -6, 44, 0)] },
  b: { w: 46, s: [L(4, -72, 4, 0), A(23, -24, 19, 24, 180, 540)] },
  c: { w: 42, s: [A(23, -24, 19, 24, -40, -320)] },
  d: { w: 46, s: [A(21, -24, 19, 24, 0, -360), L(40, -72, 40, -6, 44, 0)] },
  e: { w: 44, s: [J(L(5, -24), A(23, -24, 18, 24, 0, -318))] },
  f: { w: 34, s: [J(A(28, -60, 12, 12, -20, -180), L(16, 0)), L(4, -46, 32, -46)] },
  g: { w: 46, s: [A(21, -26, 19, 22, 0, -360), J(L(40, -48, 40, 12), A(22, 12, 18, 12, 0, 150))] },
  h: { w: 46, s: [L(4, -72, 4, 0), J(A(22, -30, 18, 18, 180, 360), L(40, 0))] },
  i: { w: 18, s: [L(9, -46, 9, 0), dot(9, -62)] },
  j: { w: 26, s: [J(L(20, -46, 20, 12), A(8, 12, 12, 12, 0, 160)), dot(20, -62)] },
  k: { w: 40, s: [L(4, -72, 4, 0), L(36, -48, 5, -20, 38, 0)] },
  l: { w: 20, s: [L(8, -72, 8, -6, 15, 0)] },
  m: { w: 66, s: [L(4, -48, 4, 0), J(A(18, -30, 14, 16, 180, 360), L(32, 0)), J(A(46, -30, 14, 16, 180, 360), L(60, 0))] },
  n: { w: 46, s: [L(4, -48, 4, 0), J(A(22, -30, 18, 18, 180, 360), L(40, 0))] },
  o: { w: 46, s: [A(23, -24, 19, 24, -90, -450)] },
  p: { w: 46, s: [L(4, -48, 4, 24), A(24, -24, 19, 24, 180, 540)] },
  q: { w: 46, s: [A(21, -24, 19, 24, 0, -360), L(40, -48, 40, 24, 45, 20)] },
  r: { w: 34, s: [L(4, -48, 4, 0), A(21, -26, 17, 20, 180, 300)] },
  s: { w: 40, s: [S(36, -42, 22, -48, 8, -41, 11, -28, 25, -23, 36, -14, 32, -2, 18, 0, 4, -6)] },
  t: { w: 34, s: [L(15, -66, 15, -6, 22, 0, 31, -3), L(3, -46, 30, -46)] },
  u: { w: 46, s: [J(L(4, -48), A(22, -18, 18, 18, 180, 0)), L(40, -48, 40, -6, 44, 0)] },
  v: { w: 40, s: [L(2, -48, 20, 0, 38, -48)] },
  w: { w: 58, s: [L(2, -48, 14, 0, 28, -36, 42, 0, 55, -48)] },
  x: { w: 42, s: [L(4, -48, 38, 0), L(38, -48, 4, 0)] },
  y: { w: 42, s: [L(4, -48, 21, -6), S(39, -48, 26, -10, 16, 14, 4, 22)] },
  z: { w: 42, s: [L(4, -48, 38, -48, 4, 0, 38, 0)] },

  A: { w: 54, s: [L(3, 0, 27, -72, 51, 0), L(12, -26, 42, -26)] },
  B: { w: 48, s: [L(5, -72, 5, 0), J(L(5, -72, 21, -72), A(21, -55, 16, 17, -90, 90), L(23, -38), A(23, -19, 20, 19, -90, 90), L(5, 0))] },
  C: { w: 56, s: [A(31, -36, 26, 36, -42, -318)] },
  D: { w: 54, s: [L(5, -72, 5, 0), J(L(5, -72, 18, -72), A(18, -36, 31, 36, -90, 90), L(5, 0))] },
  E: { w: 44, s: [L(40, -72, 5, -72, 5, 0, 40, 0), L(5, -37, 32, -37)] },
  F: { w: 42, s: [L(40, -72, 5, -72, 5, 0), L(5, -37, 32, -37)] },
  G: { w: 60, s: [J(A(31, -36, 26, 36, -42, -360), L(57, -36, 57, 0)), L(36, -32, 57, -32)] },
  H: { w: 52, s: [L(5, -72, 5, 0), L(47, -72, 47, 0), L(5, -37, 47, -37)] },
  I: { w: 20, s: [L(10, -72, 10, 0)] },
  J: { w: 42, s: [J(L(36, -72, 36, -20), A(19, -20, 17, 20, 0, 165))] },
  K: { w: 48, s: [L(5, -72, 5, 0), L(44, -72, 6, -30, 46, 0)] },
  L: { w: 42, s: [L(5, -72, 5, 0, 40, 0)] },
  M: { w: 64, s: [L(4, 0, 8, -72, 32, -22, 56, -72, 60, 0)] },
  N: { w: 54, s: [L(5, 0, 5, -72, 49, 0, 49, -72)] },
  O: { w: 62, s: [A(31, -36, 27, 36, -90, -450)] },
  P: { w: 46, s: [L(5, -72, 5, 0), J(L(5, -72, 22, -72), A(22, -53, 18, 19, -90, 90), L(5, -34))] },
  Q: { w: 62, s: [A(31, -36, 27, 36, -90, -450), L(36, -16, 60, 4)] },
  R: { w: 50, s: [L(5, -72, 5, 0), J(L(5, -72, 22, -72), A(22, -53, 18, 19, -90, 90), L(5, -34)), L(20, -34, 46, 0)] },
  S: { w: 48, s: [S(41, -62, 27, -72, 11, -65, 9, -50, 22, -39, 38, -29, 42, -14, 32, -2, 18, 0, 4, -8)] },
  T: { w: 52, s: [L(3, -72, 49, -72), L(26, -72, 26, 0)] },
  U: { w: 54, s: [J(L(5, -72, 5, -24), A(27, -24, 22, 24, 180, 0), L(49, -72))] },
  V: { w: 52, s: [L(2, -72, 26, 0, 50, -72)] },
  W: { w: 70, s: [L(2, -72, 17, 0, 35, -56, 53, 0, 68, -72)] },
  X: { w: 50, s: [L(4, -72, 46, 0), L(46, -72, 4, 0)] },
  Y: { w: 50, s: [L(3, -72, 25, -36, 47, -72), L(25, -36, 25, 0)] },
  Z: { w: 50, s: [L(5, -72, 45, -72, 5, 0, 46, 0)] },

  0: { w: 48, s: [A(24, -36, 19, 36, -90, -450)] },
  1: { w: 34, s: [L(8, -56, 22, -72, 22, 0)] },
  2: { w: 46, s: [J(A(22, -52, 18, 18, 195, 385), L(4, 0, 42, 0))] },
  3: { w: 46, s: [J(A(22, -54, 16, 17, 205, 450), A(22, -19, 19, 19, 270, 515))] },
  4: { w: 48, s: [L(32, 0, 32, -72, 3, -22, 45, -22)] },
  5: { w: 46, s: [J(L(38, -72, 10, -72, 7, -40), A(22, -22, 19, 22, 220, 495))] },
  6: { w: 46, s: [S(37, -68, 22, -72, 9, -58, 4, -30, 9, -6, 23, 0, 37, -10, 37, -28, 23, -40, 7, -30)] },
  7: { w: 44, s: [L(4, -72, 41, -72, 15, 0)] },
  8: { w: 46, s: [A(22, -54, 15, 18, 90, 450), A(22, -19, 19, 19, -90, 270)] },
  9: { w: 46, s: [A(22, -50, 18, 22, 0, 360), L(40, -50, 36, -18, 24, 0)] },

  '.': { w: 14, s: [dot(6, -3)] },
  ',': { w: 14, s: [L(8, -5, 3, 10)] },
  ':': { w: 14, s: [dot(6, -32), dot(6, -3)] },
  "'": { w: 12, s: [L(6, -72, 5, -58)] },
  '-': { w: 32, s: [L(4, -24, 28, -24)] },
  '!': { w: 16, s: [L(8, -72, 8, -18), dot(8, -3)] },
  '?': { w: 42, s: [S(4, -58, 18, -72, 36, -62, 32, -44, 20, -34, 20, -18), dot(20, -3)] },
  '&': { w: 50, s: [S(44, 0, 10, -44, 12, -66, 26, -72, 36, -62, 30, -48, 6, -26, 8, -6, 22, 0, 34, -8, 44, -24)] },
  ';': { w: 14, s: [dot(6, -32), L(8, -5, 3, 10)] },
  '"': { w: 22, s: [L(7, -72, 6, -58), L(16, -72, 15, -58)] },
  '(': { w: 24, s: [A(26, -24, 20, 52, 242, 118)] },
  ')': { w: 24, s: [A(-2, -24, 20, 52, -62, 62)] },
  '[': { w: 24, s: [L(18, -72, 7, -72, 7, 22, 18, 22)] },
  ']': { w: 24, s: [L(6, -72, 17, -72, 17, 22, 6, 22)] },
  '/': { w: 36, s: [L(32, -72, 4, 10)] },
  '+': { w: 44, s: [L(4, -24, 40, -24), L(22, -42, 22, -6)] },
  '=': { w: 42, s: [L(4, -32, 38, -32), L(4, -16, 38, -16)] },
  '%': { w: 58, s: [A(14, -57, 9, 13, -90, -450), L(47, -72, 11, 0), A(44, -15, 9, 13, -90, -450)] },
  '°': { w: 22, s: [A(11, -62, 7, 8, -90, -450)] },
  '×': { w: 40, s: [L(10, -35, 30, -13), L(30, -35, 10, -13)] },
  '÷': { w: 44, s: [L(4, -24, 40, -24), dot(22, -40), dot(22, -8)] },
  '→': { w: 60, s: [L(4, -24, 55, -24), L(41, -37, 56, -24, 41, -11)] },
  '←': { w: 60, s: [L(56, -24, 5, -24), L(19, -37, 4, -24, 19, -11)] },
  '↑': { w: 36, s: [L(18, -70, 18, 0), L(5, -56, 18, -72, 31, -56)] },
  '↓': { w: 36, s: [L(18, -72, 18, -2), L(5, -16, 18, 0, 31, -16)] },
  '~': { w: 46, s: [S(4, -20, 13, -30, 23, -25, 32, -19, 42, -28)] },
  '*': { w: 36, s: [L(18, -70, 18, -40), L(5, -62, 31, -48), L(31, -62, 5, -48)] },
  '_': { w: 44, s: [L(3, 12, 41, 12)] },
  '#': { w: 50, s: [L(20, -68, 14, -4), L(38, -68, 32, -4), L(5, -48, 46, -48), L(3, -24, 44, -24)] },
  '@': { w: 68, s: [A(33, -26, 11, 13, -35, -370), J(L(44, -40, 44, -20), A(51, -20, 7, 7, 180, 0), A(35, -26, 25, 30, 12, -300))] },
  '$': { w: 46, s: [S(38, -60, 26, -67, 11, -61, 10, -47, 23, -37, 36, -27, 37, -12, 26, -5, 13, -5, 5, -13), L(23, -78, 23, 6)] },
  '€': { w: 56, s: [A(33, -36, 24, 34, -42, -318), L(4, -44, 36, -44), L(4, -28, 33, -28)] },
  ' ': { w: 26, s: [] },
});

export const TRACK = 7;         // gap between glyphs, in em units

// ---------- hands (plan 1.4) ----------

// The pen of the house hand: what the tools do when a look names no hand. wobble is the pen's jitter
// amplitude, overshoot the ratio a corner runs past its vertex, hook the entry flick (its radius in 1.5 pen widths),
// pressure the width at 0.1 / 0.5 / 0.9 along a stroke, speed the doodle reveal in units per second,
// tremor and rounding what `hdf hand` measures off a sheet (read by nothing yet).
export const HOUSE_STROKE = Object.freeze({ wobble: 1.8, overshoot: 0, hook: 0, pressure: Object.freeze([1, 1, 1]), speed: 1000, tremor: 0, rounding: 0 });
export const HOUSE_DRIFT = 3;   // the baseline's wander, in em units

let house = null;
// The 2.0 glyph set and tool defaults as a hand record named `house`, in the shape of a hand asset.
export function houseHand() {
  house ??= Object.freeze({
    kind: 'hand', name: 'house', glyphs: GLYPHS, track: TRACK, slant: 0, baselineDrift: HOUSE_DRIFT,
    stroke: HOUSE_STROKE, credit: '', licence: 'own',
  });
  return house;
}

const flatStroke = (st) => (Array.isArray(st[0]) ? st.flat() : st);
const hands = new WeakMap();
// A hand record (a store payload, or houseHand()) with every field there: strokes flat as in GLYPHS, the
// stroke profile over the house one, missing fields the house's. Glyphs are kept by reference when already
// flat, so a record is read once.
export function asHand(rec) {
  if (!rec || rec === house || rec.glyphs === GLYPHS) return houseHand();
  let h = hands.get(rec);
  if (h) return h;
  if (!rec.glyphs || typeof rec.glyphs !== 'object') throw new TypeError(`hand '${rec.name ?? '?'}': no glyphs`);
  const glyphs = {};
  for (const [c, g] of Object.entries(rec.glyphs)) glyphs[c] = Object.freeze({ w: g.w, s: g.s.map(flatStroke) });
  h = Object.freeze({
    ...rec, kind: 'hand', name: rec.name ?? 'hand', glyphs: Object.freeze(glyphs),
    track: rec.track ?? TRACK, slant: rec.slant ?? 0, baselineDrift: rec.baselineDrift ?? HOUSE_DRIFT,
    stroke: Object.freeze({ ...HOUSE_STROKE, ...rec.stroke }),
  });
  hands.set(rec, h);
  return h;
}

// { w, s, k, own } for a character in a hand (house when none), where k is the scale it is drawn at
// (always 1 today) and own is false when the hand lacks it and the house glyph stands in. Accented letters
// draw as their base letter (É -> E); unknown characters draw as '?'.
export function glyph(ch, hand) {
  const G = hand?.glyphs ?? GLYPHS;
  const base = G[ch] ? ch : GLYPHS[ch] ? ch : ch.normalize('NFD')[0];
  if (G[base]) return { ...G[base], k: 1, own: true };
  if (G === GLYPHS || !GLYPHS[base]) return { ...(G['?'] ?? GLYPHS['?']), k: 1, own: G === GLYPHS || !!G['?'] };
  return { ...GLYPHS[base], k: 1, own: false };
}

// The characters of str a hand draws with house glyphs (a hand fitted from a sheet may miss some).
export function fallbacks(str, hand) {
  const h = hand ? asHand(hand) : houseHand(), out = new Set();
  for (const ch of String(str)) if (ch !== ' ' && !glyph(ch, h).own) out.add(ch);
  return [...out];
}

// ---------- the hand of the shot being drawn ----------

let current = null;
// fn() lettered in a hand (null: the house). Cels and shots never see the look, but the letters they write
// belong to its hand: evalShot (tree.js) draws each shot inside withHand(its look's hand), and handText,
// measure and doodle read it when not told. Everything drawn outside a shot gets the house hand.
export function withHand(hand, fn) {
  const prev = current;
  current = hand ? asHand(hand) : null;
  if (current === house) current = null;
  try { return fn(); } finally { current = prev; }
}
// The hand withHand() set, or null for the house.
export const currentHand = () => current;

