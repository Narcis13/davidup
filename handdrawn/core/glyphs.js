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
  // 4.0 T2: the letters of Latin-1 and Latin Extended-A that are no base letter with a mark.
  ß: { w: 48, s: [J(L(5, 0, 5, -56), A(20, -56, 15, 16, 180, 360), S(35, -56, 33, -45, 23, -38, 37, -31, 43, -16, 35, -3, 21, -1))] },
  ð: { w: 46, s: [A(22, -22, 18, 22, -90, -450), S(12, -72, 29, -62, 38, -44, 40, -22), L(18, -62, 38, -54)] },
  þ: { w: 46, s: [L(4, -72, 4, 24), A(24, -24, 19, 24, 180, 540)] },
  Þ: { w: 46, s: [L(5, -72, 5, 0), J(L(5, -58, 20, -58), A(20, -40, 17, 18, -90, 90), L(5, -22))] },
  ŋ: { w: 46, s: [L(4, -48, 4, 0), J(A(22, -30, 18, 18, 180, 360), L(40, 12), A(28, 12, 12, 12, 0, 150))] },
  Ŋ: { w: 54, s: [L(5, 0, 5, -72), J(A(27, -50, 22, 22, 180, 360), L(49, 4), A(37, 4, 12, 12, 0, 150))] },
  ĸ: { w: 38, s: [L(4, -48, 4, 0), L(34, -48, 5, -22, 36, 0)] },
  ſ: { w: 30, s: [J(A(28, -60, 12, 12, -20, -180), L(16, 0))] },
  '«': { w: 44, s: [L(20, -40, 6, -24, 20, -8), L(38, -40, 24, -24, 38, -8)] },
  '»': { w: 44, s: [L(6, -40, 20, -24, 6, -8), L(24, -40, 38, -24, 24, -8)] },
  ' ': { w: 26, s: [] },
});

// ---------- composed glyphs (4.0 T2) ----------

// The marks a composed glyph adds to its base, drawn where they sit over a small letter centred on x = 22 (the
// template's exemplars); composing moves them, so only their shape matters. at: where a mark goes on its base
// unless COMPOSE says otherwise ('above' the base's ink top, 'below' its baseline, 'attach' hanging from its
// ink bottom, 'ogonek' from its bottom right, 'through' its ink centre).
export const MARKS = Object.freeze({
  acute: { at: 'above', s: [L(28, -68, 18, -55)] },
  grave: { at: 'above', s: [L(16, -68, 26, -55)] },
  circumflex: { at: 'above', s: [L(12, -55, 22, -67, 32, -55)] },
  umlaut: { at: 'above', s: [dot(14, -60), dot(30, -60)] },
  tilde: { at: 'above', s: [S(10, -56, 16, -63, 23, -59, 29, -55, 35, -62)] },
  breve: { at: 'above', s: [A(22, -64, 10, 9, 180, 0)] },
  caron: { at: 'above', s: [L(12, -67, 22, -55, 32, -67)] },
  ring: { at: 'above', s: [A(22, -61, 6, 6, -90, -450)] },
  cedilla: { at: 'attach', s: [S(23, -1, 21, 5, 27, 8, 27, 14, 18, 16)] },
  'comma-below': { at: 'below', s: [L(24, 6, 19, 19)] },
  ogonek: { at: 'ogonek', s: [S(34, -1, 28, 7, 29, 14, 36, 16)] },
  stroke: { at: 'through', s: [L(13, -30, 31, -42)] },
  macron: { at: 'above', s: [L(10, -60, 34, -60)] },
  'dot-above': { at: 'above', s: [dot(22, -60)] },
});

// Unicode's combining marks as MARKS (U+030B, the double acute, is two acutes side by side).
const COMBINING = Object.freeze({
  '\u0300': ['grave'], '\u0301': ['acute'], '\u0302': ['circumflex'], '\u0303': ['tilde'], '\u0304': ['macron'],
  '\u0306': ['breve'], '\u0307': ['dot-above'], '\u0308': ['umlaut'], '\u030A': ['ring'], '\u030C': ['caron'],
  '\u0326': ['comma-below'], '\u0327': ['cedilla'], '\u0328': ['ogonek'],
  '\u030B': [['acute', 'above', { dx: -6 }], ['acute', 'above', { dx: 6, stack: false }]],
});

// COMPOSE[ch] = [base, ...marks]. base: the character(s) the glyph is built on, side by side at the hand's track
// ('ij'), or { ch | seq, join, sx, dy, turn, dotless } (join: the gap between them in em units instead of the
// track; sx a horizontal stretch; dy a drop; turn a half turn about the ink's centre; dotless drops an i's or j's
// dot). A mark: a MARKS name, or [name, at, { dx, dy, fit: [w, h], turn, stack }] where at is a place (above
// the table) or [fx, fy], a point of the base's ink box as fractions, the mark centred on it; fit sizes the mark
// to fractions of the base's ink; stack: false keeps an above mark level with the one before it.
// Every letter of Latin-1 and Latin Extended-A that Unicode decomposes into a base and these marks is filled in
// from its decomposition (an i or a j losing its dot under an above mark); the table below is what differs, and
// the characters written as others (typographic quotes and dashes, ligatures, ¿ ¡).
const EXPLICIT = {
  'ı': [{ ch: 'i', dotless: true }], 'ȷ': [{ ch: 'j', dotless: true }],
  'ł': ['l', ['stroke', [0.5, 0.52]]], 'Ł': ['L', ['stroke', [0.1, 0.56]]],
  'ø': ['o', ['stroke', 'through', { fit: [1.05, 1.3] }]], 'Ø': ['O', ['stroke', 'through', { fit: [0.95, 1.2] }]],
  'đ': ['d', ['macron', [0.9, 0.18], { fit: [0.5] }]], 'Đ': ['D', ['macron', [0.12, 0.5], { fit: [0.4] }]],
  'Ð': ['D', ['macron', [0.12, 0.5], { fit: [0.4] }]],
  'ħ': ['h', ['macron', [0.1, 0.18], { fit: [0.5] }]], 'Ħ': ['H', ['macron', [0.5, 0.24], { fit: [1.15] }]],
  'ŧ': ['t', ['macron', [0.43, 0.62], { fit: [0.6] }]], 'Ŧ': ['T', ['macron', [0.5, 0.5], { fit: [0.45] }]],
  // Czech and Slovak write the caron on an ascender as an apostrophe beside it.
  'ď': ['d', ['comma-below', [1, 0], { dx: 7, dy: 7 }]], 'ť': ['t', ['comma-below', [0.75, 0], { dx: 3, dy: 6 }]],
  'ľ': ['l', ['comma-below', [1, 0], { dx: 6, dy: 7 }]], 'Ľ': ['L', ['comma-below', [0.2, 0], { dx: 7, dy: 7 }]],
  // Latvian's cedillas are commas; its g takes the comma above, turned.
  'ģ': ['g', ['comma-below', 'above', { turn: true }]], 'Ģ': ['G', 'comma-below'], 'ķ': ['k', 'comma-below'], 'Ķ': ['K', 'comma-below'],
  'ļ': ['l', 'comma-below'], 'Ļ': ['L', 'comma-below'], 'ņ': ['n', 'comma-below'], 'Ņ': ['N', 'comma-below'],
  'ŗ': ['r', 'comma-below'], 'Ŗ': ['R', 'comma-below'],
  // Romanian's comma-below s and t (Latin Extended-B).
  'ș': ['s', 'comma-below'], 'Ș': ['S', 'comma-below'], 'ț': ['t', 'comma-below'], 'Ț': ['T', 'comma-below'],
  'ŀ': ['l', ['dot-above', [1, 0.55], { dx: 6 }]], 'Ŀ': ['L', ['dot-above', [0.35, 0.55]]],
  'ẞ': ['ß'], 'ŉ': ["'n"], 'ĳ': ['ij'], 'Ĳ': ['IJ'],
  'æ': [{ seq: 'ae', join: -6 }], 'Æ': [{ seq: 'AE', join: -12 }], 'œ': [{ seq: 'oe', join: -6 }], 'Œ': [{ seq: 'OE', join: -10 }],
  '¡': [{ ch: '!', turn: true, dy: 24 }], '¿': [{ ch: '?', turn: true, dy: 24 }], '·': [{ ch: '.', dy: -21 }],
  '’': ["'"], '‘': ["'"], '‚': [','], '“': ['"'], '”': ['"'], '„': [{ seq: ',,', join: 2 }],
  '–': ['-'], '—': [{ ch: '-', sx: 1.8 }], '…': ['...'], '\u00a0': [' '],
};

// A character's decomposition as a COMPOSE entry, or null when it is no drawable base with known marks.
function decomposed(ch) {
  const [base, ...rest] = [...ch.normalize('NFD')];
  if (!rest.length || !GLYPHS[base] || !rest.every((m) => COMBINING[m])) return null;
  const marks = rest.flatMap((m) => COMBINING[m]);
  const dotless = (base === 'i' || base === 'j') && marks.some((m) => (MARKS[m]?.at ?? m[1]) === 'above');
  return [dotless ? { ch: base, dotless } : base, ...marks];
}

export const COMPOSE = (() => {
  const out = {};
  for (let c = 0xc0; c <= 0x17f; c++) { const ch = String.fromCharCode(c), e = decomposed(ch); if (e) out[ch] = e; }
  return Object.freeze(Object.assign(out, EXPLICIT));
})();

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
    kind: 'hand', name: 'house', glyphs: GLYPHS, marks: MARKS, track: TRACK, slant: 0, baselineDrift: HOUSE_DRIFT,
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
  const glyphs = {}, marks = {};
  for (const [c, g] of Object.entries(rec.glyphs)) glyphs[c] = Object.freeze({ w: g.w, s: g.s.map(flatStroke) });
  for (const [m, g] of Object.entries(rec.marks ?? {})) if (MARKS[m] && g?.s?.length) marks[m] = Object.freeze({ s: g.s.map(flatStroke) });
  h = Object.freeze({
    ...rec, kind: 'hand', name: rec.name ?? 'hand', glyphs: Object.freeze(glyphs), marks: Object.freeze(marks),
    track: rec.track ?? TRACK, slant: rec.slant ?? 0, baselineDrift: rec.baselineDrift ?? HOUSE_DRIFT,
    stroke: Object.freeze({ ...HOUSE_STROKE, ...rec.stroke }),
  });
  hands.set(rec, h);
  return h;
}

// { w, s, k, own } for a character in a hand (house when none), where k is the scale it is drawn at
// (always 1 today) and own is false when the house stands in for any of it. A hand's own drawing of a
// character wins; then COMPOSE builds it (4.0 T2: 'ă' is the hand's a and its breve, the house's breve when
// the hand has no marks); then the house's glyph; then Unicode's decomposition into a base and known marks
// (unknown marks dropped); anything else draws as '?'. Results are memoised per hand, so a composed glyph's
// strokes are one array layout can measure once.
export function glyph(ch, hand) {
  const key = hand?.glyphs && hand.glyphs !== GLYPHS ? hand : houseHand();
  let memo = glyphMemo.get(key);
  if (!memo) glyphMemo.set(key, memo = new Map());
  let g = memo.get(ch);
  if (!g) memo.set(ch, g = Object.freeze(lookup(ch, key)));
  return g;
}
const glyphMemo = new WeakMap();

function lookup(ch, H) {
  const G = H.glyphs, house = G === GLYPHS;
  if (G[ch]) return { ...G[ch], k: 1, own: true };
  const spec = COMPOSE[ch];
  if (spec) return compose(spec, H);
  if (GLYPHS[ch]) return { ...GLYPHS[ch], k: 1, own: house };
  const dec = decomposed(ch) ?? (() => {
    const base = ch.normalize('NFD')[0];
    return base !== ch && GLYPHS[base] ? [base] : null;
  })();
  if (dec) return compose(dec, H);
  return { ...(G['?'] ?? GLYPHS['?']), k: 1, own: house || !!G['?'] };
}

const CORNER = Math.cos(50 * Math.PI / 180);   // as core/tools.js's overshoot: a turn sharper than 50 degrees
// A glyph's ink box [x0, y0, x1, y1] over flat strokes (null for none). With over > 0 the box takes in what a
// pen that overshoots corners by that ratio adds (tools.js: the line in runs on by over x its length), so a
// mark clears an A's apex in a quick hand.
function inkBox(strokes, over = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const pts of strokes) {
    for (let i = 0; i < pts.length; i += 2) take(pts[i], pts[i + 1]);
    if (over > 0) for (let i = 2; i < pts.length - 2; i += 2) {
      const ix = pts[i] - pts[i - 2], iy = pts[i + 1] - pts[i - 1], ox = pts[i + 2] - pts[i], oy = pts[i + 3] - pts[i + 1];
      const li = Math.hypot(ix, iy), lo = Math.hypot(ox, oy);
      if (li > 0 && lo > 0 && (ix * ox + iy * oy) / (li * lo) < CORNER) { take(pts[i] + ix * over, pts[i + 1] + iy * over); take(pts[i] - ox * over, pts[i + 1] - oy * over); }
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}
const mapPts = (pts, f) => { const out = new Array(pts.length); for (let i = 0; i < pts.length; i += 2) [out[i], out[i + 1]] = f(pts[i], pts[i + 1]); return out; };

const GAP = 10, TALL = -60;   // em units: an above mark's gap over its base's ink (a pen's width of it is ink); a base whose ink rises past TALL is a capital or ascender
// A COMPOSE entry built in hand H: the base's characters side by side, then each mark placed on the base's ink.
function compose([base, ...marks], H) {
  const b = typeof base === 'string' ? { seq: base } : base;
  const seq = [...(b.seq ?? b.ch)], sx = b.sx ?? 1, join = b.join ?? H.track;
  let own = true, pen = 0, w = 0;
  const s = [];
  seq.forEach((c, i) => {
    const mine = H.glyphs[c], g = mine ?? GLYPHS[c] ?? GLYPHS['?'];
    own &&= !!mine || H.glyphs === GLYPHS;
    let strokes = g.s;
    if (b.dotless) strokes = strokes.filter((pts) => { const [x0, y0, x1, y1] = inkBox([pts]); return x1 - x0 >= 16 || y1 - y0 >= 16 || (y0 + y1) / 2 > -40; });
    for (const pts of strokes) s.push(mapPts(pts, (x, y) => [pen + x * sx, y]));
    w = pen + g.w * sx;
    if (i < seq.length - 1) pen = w + join;
  });
  if (b.turn || b.dy) {
    const box = inkBox(s), cx = box ? (box[0] + box[2]) / 2 : w / 2, cy = box ? (box[1] + box[3]) / 2 : -36, t = b.turn ? -1 : 1, dy = b.dy ?? 0;
    for (let i = 0; i < s.length; i++) s[i] = mapPts(s[i], (x, y) => [cx + (x - cx) * t, cy + (y - cy) * t + dy]);
  }
  const over = H.stroke?.overshoot ?? 0, box = inkBox(s) ?? [0, -48, w, 0], [x0, y0, x1, y1] = box, bw = x1 - x0, bh = y1 - y0, tall = y0 < TALL;
  const [, rTop, , rBottom] = over > 0 ? inkBox(s, over) ?? box : box;   // the ink as the pen draws it: marks clear it
  let top = rTop, level = rTop;
  for (const m of marks) {
    const [name, at0, o = {}] = typeof m === 'string' ? [m] : m, at = at0 ?? MARKS[name].at;
    const mine = H.marks?.[name], ms = mine?.s ?? MARKS[name].s, mb = inkBox(ms);
    if (!mb) continue;
    own &&= !!mine || H.glyphs === GLYPHS;
    const mw = mb[2] - mb[0], mh = mb[3] - mb[1], mcx = (mb[0] + mb[2]) / 2, mcy = (mb[1] + mb[3]) / 2;
    let kx = o.fit?.[0] ? o.fit[0] * bw / Math.max(mw, 1) : 1, ky = o.fit?.[1] ? o.fit[1] * bh / Math.max(mh, 1) : 1;
    if (at === 'above' && tall) ky *= 0.8;
    if (o.turn) { kx = -kx; ky = -ky; }
    const hh = Math.abs(mh * ky) / 2, dx = o.dx ?? 0, dy = o.dy ?? 0;
    // A mark's own corners overshoot too (a caron's point runs down): its drawn reach past its ink, in em.
    const [, mt, , mbt] = over > 0 ? inkBox(ms, over) : mb, down = Math.max(0, (ky > 0 ? mbt - mb[3] : mb[1] - mt) * Math.abs(ky)), up = Math.max(0, (ky > 0 ? mb[1] - mt : mbt - mb[3]) * Math.abs(ky));
    let tx, ty;
    if (at === 'above') {
      const from = o.stack === false ? level : top;
      tx = w / 2; ty = from - (tall ? GAP - 2 : GAP) - hh - down;
      level = from; top = Math.min(top, ty - hh - up + dy);
    } else if (at === 'below') { tx = w / 2; ty = Math.max(rBottom, 0) + 8 + hh + up; }
    else if (at === 'attach') { tx = w / 2; ty = y1 - 1 + hh; }
    else if (at === 'ogonek') { tx = x1 - 0.18 * bw; ty = y1 - 1 + hh; }
    else if (at === 'through') { tx = (x0 + x1) / 2; ty = (y0 + y1) / 2; }
    else if (Array.isArray(at)) { tx = x0 + at[0] * bw; ty = y0 + at[1] * bh; }
    else throw new Error(`COMPOSE: mark '${name}' at '${at}' (expected above | below | attach | ogonek | through | [fx, fy])`);
    for (const pts of ms) s.push(mapPts(pts, (x, y) => [tx + dx + (x - mcx) * kx, ty + dy + (y - mcy) * ky]));
  }
  return { w, s, k: 1, own };
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

