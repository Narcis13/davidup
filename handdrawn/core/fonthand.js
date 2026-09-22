// Any font as a hand (4.0 T4): the half of `hdf hand --font` that needs no canvas. cli/hand.mjs draws each glyph
// of a TTF or OTF black on white and hands the raster to traceGlyph (core/handsheet.js), the sheet reader's path
// without the photo; this file says which characters to draw, how the em is scaled, what pen profile the widths
// give and which glyphs to eyeball.
import { COMPOSE, GLYPHS, MARKS } from './glyphs.js';
import { CHARS } from './handsheet.js';

const range = (a, b, skip = []) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)).filter((c) => !skip.includes(c));
const isLetter = (c) => /\p{L}/u.test(c), isWord = (c) => /[\p{L}\p{N}]/u.test(c);
const uniq = (a) => [...new Set(a)];

// --glyphs latin,cyrillic,greek,symbols: the characters each set asks a font for (the font draws those it has).
// latin: a-z A-Z 0-9, the house's other letters (ß ð þ...) and every accented letter COMPOSE knows, so the font's own
// ă wins over a composed one; cyrillic: U+0400-045F; greek: the monotonic alphabet with its tonos letters; symbols:
// the house's punctuation and signs, the typographic ones COMPOSE writes, and the rest of printable ASCII.
export const GLYPH_SETS = Object.freeze({
  latin: Object.freeze(uniq([...CHARS, ...Object.keys(GLYPHS).filter(isLetter), ...Object.keys(COMPOSE).filter(isLetter)])),
  cyrillic: Object.freeze(range(0x400, 0x45f)),
  greek: Object.freeze(range(0x386, 0x3ce, ['\u0387', '\u038b', '\u038d', '\u03a2'])),
  symbols: Object.freeze(uniq([
    ...Object.keys(GLYPHS).filter((c) => c !== ' ' && !isWord(c)),
    ...Object.keys(COMPOSE).filter((c) => c !== '\u00a0' && !isWord(c)),
    ...range(0x21, 0x7e).filter((c) => !isWord(c)),
  ])),
});

// --glyphs latin,cyrillic -> ['latin', 'cyrillic'], every set when not given. Throws on a set it does not know.
export function setsOf(flag) {
  if (flag === undefined || flag === true) return Object.keys(GLYPH_SETS);
  const sets = uniq(String(flag).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)), bad = sets.filter((s) => !GLYPH_SETS[s]);
  if (!sets.length || bad.length) throw new Error(`--glyphs ${flag} (expected a list of ${Object.keys(GLYPH_SETS).join(', ')})`);
  return sets;
}

// The spacing forms of the marks (4.0 T2's MARKS): a font that has them gives the hand its own accents, for the
// letters it does not draw whole. Only a mark's shape counts (composing places it), so the font's spacing acute
// is as good as its combining one. comma-below and stroke have no spacing form: the house's stand in.
export const FONT_MARKS = Object.freeze({
  acute: '\u00b4', grave: '`', circumflex: '\u02c6', umlaut: '\u00a8', tilde: '\u02dc', breve: '\u02d8', caron: '\u02c7',
  ring: '\u02da', cedilla: '\u00b8', ogonek: '\u02db', macron: '\u00af', 'dot-above': '\u02d9',
});
for (const m of Object.keys(FONT_MARKS)) if (!MARKS[m]) throw new Error(`FONT_MARKS: no mark '${m}'`);

// The house's capitals stand at 72 and its x-height at 48. A font's ratio of the two is its own, so no one scale puts
// both on the house's lines: the scale (em units per pixel) splits the difference, the geometric mean of the two
// that would. A face with the house's 2:3 lands on both; Arial's capitals stand at 69, its x-height at 50. (cli/hand.mjs
// measures both off the traced centre lines of an H and a z, the lines the pen draws.)
export function emScale(capPx, xPx) {
  if (!(capPx > 0) || !(xPx > 0)) throw new Error(`a font's cap height and x-height must be > 0 (got ${capPx}, ${xPx})`);
  return Math.sqrt((72 / capPx) * (48 / xPx));
}

const r2 = (v) => Math.round(v * 100) / 100;

// The pen profile from traced glyphs ([{ widths, lens }] as traceGlyph returns them): the ink's width at 0.1, 0.5
// and 0.9 along every open stroke, weighted by the stroke's length, over the widest of the three. A font with
// even strokes gives [1, 1, 1]; one whose strokes swell in the middle, less at the ends.
export function pressureOf(traced) {
  const sum = [0, 0, 0];
  let wt = 0;
  for (const g of traced) (g.widths ?? []).forEach((ws, i) => {
    const l = g.lens?.[i] ?? 0;
    if (!ws || !(l > 0)) return;
    ws.forEach((v, j) => { sum[j] += v * l; });
    wt += l;
  });
  if (!wt) return [1, 1, 1];
  const top = Math.max(...sum);
  return sum.map((v) => r2(v / top));
}

// The glyphs to eyeball on the hand's sheet: those whose stroke count differs from the house glyph's by more than
// two (a serif left as a spur, a bowl broken in two), as [{ ch, n, house }].
export function strays(glyphs) {
  return Object.entries(glyphs)
    .filter(([c, g]) => GLYPHS[c] && Math.abs(g.s.length - GLYPHS[c].s.length) > 2)
    .map(([ch, g]) => ({ ch, n: g.s.length, house: GLYPHS[ch].s.length }));
}

// The hand record for a font's traced glyphs and marks. The advance is the font's (its side bearings in it), so the
// track is 0. A font has no pen of its own: hook is 0 and the wobble is left to the pen that letters it (a stored 0
// would switch the look's wobble off); the pressure is the font's width profile.
export function fontHandRecord({ name, glyphs, marks = {}, pressure = [1, 1, 1], credit = '', licence = 'unknown' }) {
  return {
    kind: 'hand', name, glyphs, ...(Object.keys(marks).length ? { marks } : {}), track: 0,
    stroke: { hook: 0, pressure }, credit, licence,
  };
}
