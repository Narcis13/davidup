// Hershey fonts as hands (4.0 T3): a .jhf file read into a hand record, so Cyrillic, Greek and a handful of
// stroke styles letter a film through the pen like any hand.
//
// The JHF format (James Hurt's): one glyph per entry, columns 0-4 a glyph number, 5-7 the count of
// coordinate pairs (the bounds pair included), then the pairs as letters about 'R' (x = code - 82, y down):
// the first pair the glyph's left and right bounds, then vertices, ' R' lifting the pen. An entry longer than a
// line wraps onto the next. The distributed files (github.com/kamalmostafa/hershey-fonts) number every glyph
// 12345 and give 96 of them in ASCII order (space to DEL), so a glyph's character is its position in the file,
// looked up in a map: `ascii` for the Latin files, `greek` and `cyrillic` for the files that put those letters
// in the Latin slots.
//
// Hershey's simplex em: baseline at y = 9, capitals 21 units tall, x-height 14. Scaled so the capitals stand at
// the house's cap height (72: 21 units to 72, 3.43 a unit), the x-height lands on the house's 48 as well.

export const HERSHEY = Object.freeze({ baseline: 9, cap: 21 });
export const HERSHEY_K = 72 / HERSHEY.cap;

// The notice the Hershey licence requires to travel with the data.
export const HERSHEY_CREDIT = 'The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. '
  + 'National Bureau of Standards. The format of the font data in this distribution was originally created by '
  + 'James Hurt, Cognition, Inc.';

// A .jhf file's text as [{ n, l, r, s: [[x, y, x, y, ...], ...] }] in Hershey units, in file order.
export function parseJhf(text) {
  const lines = String(text).split(/\r?\n/), out = [];
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i];
    if (!ln.trim()) continue;
    const n = +ln.slice(0, 5), count = +ln.slice(5, 8);
    if (!Number.isInteger(n) || !Number.isInteger(count) || count < 1) throw new Error(`jhf line ${i + 1}: expected a glyph number and a pair count, got '${ln.slice(0, 8)}'`);
    let body = ln.slice(8);
    while (body.length < count * 2 && i + 1 < lines.length) body += lines[++i];   // a wrapped entry
    if (body.length < count * 2) throw new Error(`jhf glyph ${out.length + 1}: ${count} pairs, the file ends after ${Math.floor(body.length / 2)}`);
    const v = (k) => body.charCodeAt(k) - 82, s = [];
    let cur = [];
    for (let k = 2; k < count * 2; k += 2) {
      if (body[k] === ' ' && body[k + 1] === 'R') { if (cur.length) s.push(cur); cur = []; continue; }
      cur.push(v(k), v(k + 1));
    }
    if (cur.length) s.push(cur);
    out.push({ n, l: v(0), r: v(1), s: s.filter((pts) => pts.length >= 4) });   // a lone vertex draws nothing
  }
  return out;
}

// Maps from a glyph's place in the file (0 = space) to its character; null leaves the glyph out.
const ASCII = Array.from({ length: 96 }, (_, i) => (i < 95 ? String.fromCharCode(32 + i) : null));
const overlay = (base, over) => ASCII.map((c, i) => (c !== null && c in over ? over[c] : base[i]));
const pairs = (from, to) => Object.fromEntries([...from].map((c, i) => [c, to[i] === '·' ? null : to[i]]));

export const MAPS = Object.freeze({
  ascii: Object.freeze(ASCII),
  // greek.jhf, greekc.jhf, greeks.jhf: the capitals A-X and small a-x in Greek order, Y and Z blank, ` a breathing.
  greek: Object.freeze(overlay(ASCII, {
    ...pairs('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ··'),
    ...pairs('abcdefghijklmnopqrstuvwxyz', 'αβγδεζηθικλμνξοπρστυφχψω··'),
    '`': null,
  })),
  // cyrillic.jhf: the Russian alphabet over the letters and the slots after them ($ % & ` too); E repeats I's И
  // (Й composes from И and a breve), DEL is the tilde.
  cyrillic: Object.freeze([...overlay(ASCII, {
    ...pairs('ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`', 'АБЭД·ФГЖИЧКЛМНОПШРСТЮВЩХУЗЕЪЯЬЦ'),
    ...pairs('abcdefghijklmnopqrstuvwxyz{|}~', 'абэдйфгжичклмнопшрстювщхузеъяь'),
    $: 'Ы', '%': 'ц', '&': 'ы',
  }).slice(0, 95), '~']),
});

// The map a file's name implies (greek*.jhf, cyrillic.jhf; ascii otherwise).
export function mapFor(file) {
  const b = String(file).split(/[\\/]/).pop().replace(/\.jhf$/i, '').toLowerCase();
  return /^greek/.test(b) ? 'greek' : b === 'cyrillic' ? 'cyrillic' : 'ascii';
}

const r1 = (v) => Math.round(v * 10) / 10;

// A .jhf file's text as a hand record: each mapped glyph's strokes in the file's order, moved so its left bound
// is x = 0 and its baseline y = 0, scaled to the house em; its advance the bounds' span. The bounds carry the
// side bearings, so the hand's track is 0 (and a script's joins meet). The pen is the house's: a font has no
// wobble of its own, the look's pen adds it.
export function hersheyHand(text, { name = 'hershey', map = 'ascii', credit = HERSHEY_CREDIT } = {}) {
  const table = MAPS[map];
  if (!table) throw new Error(`hershey: no map '${map}' (${Object.keys(MAPS).join(', ')})`);
  const parsed = parseJhf(text), glyphs = {};
  if (parsed.length > table.length) throw new Error(`hershey: ${parsed.length} glyphs; a ${map} file has at most ${table.length} (space to DEL, in order)`);
  parsed.forEach((g, i) => {
    const ch = table[i];
    if (ch === null || ch === undefined || (!g.s.length && ch !== ' ') || glyphs[ch]) return;
    glyphs[ch] = {
      w: r1((g.r - g.l) * HERSHEY_K),
      s: g.s.map((pts) => pts.map((v, j) => r1((j % 2 ? v - HERSHEY.baseline : v - g.l) * HERSHEY_K))),
    };
  });
  return { kind: 'hand', name, glyphs, track: 0, credit, licence: 'PD' };
}

// A hand with another file's glyphs added (--merge): the hand's own glyphs stay, the new ones come in, the
// credits join. Returns { hand, added, kept }.
export function mergeHand(hand, more) {
  const added = [], kept = [], glyphs = { ...hand.glyphs };
  for (const [c, g] of Object.entries(more.glyphs)) {
    if (glyphs[c]) kept.push(c);
    else { glyphs[c] = g; added.push(c); }
  }
  const credit = [hand.credit, more.credit].filter(Boolean).filter((c, i, a) => a.indexOf(c) === i).join(' ');
  return { hand: { ...hand, glyphs, credit }, added, kept };
}
