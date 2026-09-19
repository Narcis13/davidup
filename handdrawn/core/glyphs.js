// A single-stroke hand font, drawn as polylines in a 100-unit em. Baseline at y = 0, y down:
// x-height -48, ascender and figures -72, descender +24. Each glyph is { w: advance, s: [flat pts, ...] }.
// Uppercase maps to the lowercase forms at 1.25x until true capitals land (P5).
import { spline } from './list.js';

const D = Math.PI / 180;
// Elliptical arc from angle d0 to d1 in degrees (0 = east, 90 = south; d1 < d0 runs anticlockwise on screen).
function A(cx, cy, rx, ry, d0, d1) {
  const n = Math.max(4, Math.ceil(Math.abs(d1 - d0) / 12)), out = [];
  for (let i = 0; i <= n; i++) { const a = (d0 + (d1 - d0) * i / n) * D; out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  return out;
}
const L = (...xy) => xy;                                  // a polyline
const S = (...xy) => spline(xy, { n: 6 }).sub[0].pts;     // a smooth curve through the points
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
  ' ': { w: 26, s: [] },
});

export const TRACK = 7;         // gap between glyphs, in em units
export const UPPER = 1.25;      // capitals are lowercase forms at this scale

// { w, s, k } for a character, where k is the scale it is drawn at; unknown characters draw as '?'.
export function glyph(ch) {
  if (GLYPHS[ch]) return { ...GLYPHS[ch], k: 1 };
  const lo = ch.toLowerCase();
  if (lo !== ch && GLYPHS[lo]) return { ...GLYPHS[lo], k: UPPER };
  return { ...GLYPHS['?'], k: 1 };
}
