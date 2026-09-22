// A hand as a font (4.0 D3): the half of `hdf hand --export-ttf` that needs no file system. Every character the
// hand letters is its centre lines as handText draws them (slanted, corners overshot, entries hooked), swept by the
// pen: a round cap or join where the line turns, a four-sided run along each step as wide as the pressure there.
// The pieces overlap and all wind one way (clockwise, y up), so TrueType's non-zero fill is the union; a composed
// glyph (4.0 T2) that is a base and marks moved into place is written as a composite of the base's glyph and the
// marks' own. core/ttf.js writes the bytes.
import { COMPOSE, GLYPHS, MARKS, asHand, glyph } from './glyphs.js';
import { GLYPH_SETS } from './fonthand.js';
import { hash32, rng } from './rand.js';
import { hook, overshoot, pressureAt } from './tools.js';
import { ttfBytes } from './ttf.js';

export const UPM = 1000;
const S = UPM / 100;            // font units per em unit (the hand's em is 100, y down)
export const TTF_PEN = 4.5;     // the pen in em units: handText's own (layout.js penOf: 0.045 of the size)
export const TTF_TOL = 0.15;    // em units a centre line may move when it is simplified
const TURN = Math.cos(20 * Math.PI / 180);   // a join turning more than this gets a round join, less a wedge
const K = Math.cos(Math.PI / 8);

// A circle as eight quadratic arcs, clockwise with y up (on-curve points at the eighths, control points between).
function circle(cx, cy, r) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = -i * Math.PI / 4, b = a - Math.PI / 8;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 1], [cx + (r / K) * Math.cos(b), cy + (r / K) * Math.sin(b), 0]);
  }
  return out;
}

const area = (c) => { let s = 0; for (let i = 0; i < c.length; i++) { const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % c.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
const clockwise = (c) => (area(c) > 0 ? c.reverse() : c);   // y up: clockwise has negative area

// Douglas-Peucker over [[x, y], ...] (ends kept).
function simplify(p, tol) {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = L ? Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / L : Math.hypot(p[i][0] - ax, p[i][1] - ay);
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return p.filter((_, i) => keep[i]);
}

// One centre line ([[x, y], ...] in font units, y up) swept by a pen of radius r(u) (u: arc length over the whole)
// into contours: caps, joins and runs, each wound clockwise. As the pen presses (tools.js pressed), each step is as
// wide as the pressure at its middle, and a vertex's round is the wider of the two steps that meet there.
export function sweep(pts, radius) {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]), out = [];
  const lens = [0];
  for (let i = 1; i < p.length; i++) lens.push(lens[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const L = lens.at(-1);
  if (p.length < 2) return [circle(p[0][0], p[0][1], radius(0.5))];
  const rs = p.slice(1).map((_, i) => radius((lens[i] + lens[i + 1]) / 2 / L));   // step i runs from p[i] to p[i + 1]
  const r = p.map((_, i) => Math.max(rs[i - 1] ?? 0, rs[i] ?? 0));
  const dirs = [];
  for (let i = 1; i < p.length; i++) { const d = lens[i] - lens[i - 1]; dirs.push([(p[i][0] - p[i - 1][0]) / d, (p[i][1] - p[i - 1][1]) / d]); }
  const closed = L > 0 && Math.hypot(p[0][0] - p.at(-1)[0], p[0][1] - p.at(-1)[1]) < 1e-6;
  for (let i = 0; i < p.length; i++) {
    const inD = dirs[i - 1] ?? (closed ? dirs.at(-1) : null), outD = dirs[i] ?? (closed ? dirs[0] : null);
    if (!inD || !outD || inD[0] * outD[0] + inD[1] * outD[1] < TURN) { if (!(closed && i === p.length - 1)) out.push(circle(p[i][0], p[i][1], r[i])); continue; }
    // a small turn: the outer gap between the two runs, on both sides (the inner one lies in the ink anyway)
    for (const s of [1, -1]) {
      const a = [p[i][0] - inD[1] * r[i] * s, p[i][1] + inD[0] * r[i] * s], b = [p[i][0] - outD[1] * r[i] * s, p[i][1] + outD[0] * r[i] * s];
      const w = [[p[i][0], p[i][1], 1], [...a, 1], [...b, 1]];
      if (Math.abs(area(w)) > 1e-3) out.push(clockwise(w));
    }
  }
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i], w = rs[i - 1], [ux, uy] = dirs[i - 1];
    out.push(clockwise([[ax - uy * w, ay + ux * w, 1], [bx - uy * w, by + ux * w, 1], [bx + uy * w, by - ux * w, 1], [ax + uy * w, ay - ux * w, 1]]));
  }
  return out;
}

const rounded = (cs) => cs.map((c) => c.map(([x, y, on]) => [Math.round(x), Math.round(y), on]))
  .filter((c) => new Set(c.map(([x, y]) => `${x},${y}`)).size >= 3);

// A glyph's strokes (flat, em units, y down) as contours in font units: slanted as letterLine slants them, run
// through the hand's pen (overshoot, and the hook seeded per stroke), simplified and swept. pen in em units.
export function strokeContours(strokes, H, { pen = TTF_PEN, tol = TTF_TOL, seed = 'glyph' } = {}) {
  const sl = H.slant ? Math.tan(H.slant * Math.PI / 180) : 0, st = H.stroke, out = [];
  strokes.forEach((flat, si) => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(flat[i] - flat[i + 1] * sl, flat[i + 1]);
    const sub = hook(overshoot([{ pts, closed: false }], st.overshoot, pen), st.hook, pen, rng(hash32('ttf', H.name, seed, si)));
    for (const s of sub) {
      const line = [];
      for (let i = 0; i < s.pts.length; i += 2) line.push([s.pts[i], s.pts[i + 1]]);
      const flatP = !st.pressure || st.pressure.every((v) => v === 1);
      const r = (u) => (pen * S / 2) * (flatP ? 1 : pressureAt(st.pressure, u));
      out.push(...sweep(simplify(line, tol).map(([x, y]) => [x * S, -y * S]), r));
    }
  });
  return rounded(out);
}

// The characters a hand letters: its own glyphs, the house's, everything COMPOSE builds and every character of the
// glyph sets that decomposes onto a glyph it has (a Cyrillic hand's Ё). Not the ones that letter as '?'.
export function handChars(H) {
  const all = new Set([...Object.keys(GLYPHS), ...Object.keys(H.glyphs), ...Object.keys(COMPOSE), ...Object.values(GLYPH_SETS).flat()]);
  return [...all].filter((ch) => [...ch].length === 1 && ch.codePointAt(0) < 0xffff && ch.codePointAt(0) >= 0x20 && !glyph(ch, H).none)
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

const hex = (c) => c.toString(16).toUpperCase().padStart(4, '0');

// The font's glyph list and metrics for a hand record: { font (ttfBytes' input), chars, composites, marks }.
// composites: false writes every composed glyph as outlines.
export function handFont(rec, { family, pen = TTF_PEN, tol = TTF_TOL, composites = true, credit, licence } = {}) {
  const H = asHand(rec), track = H.track, chars = handChars(H);
  const adv = (g) => Math.round((g.w * g.k + track) * S);
  const q = glyph('?', H);
  const glyphs = [{ name: '.notdef', advance: adv(q), contours: strokeContours(q.s, H, { pen, tol, seed: '.notdef' }) }];
  const index = new Map(), markIndex = new Map();
  const slant = H.slant ? Math.tan(H.slant * Math.PI / 180) : 0;
  // A composite only where moving the parts is all it takes: a base the font has, marks at their own size (turned
  // half round at most). A mark scaled to fit, or squashed over a capital, is drawn as outlines with the rest.
  const asParts = (g) => composites && g.parts && g.parts.slice(1).every((m) => Math.abs(m.kx) === 1 && m.kx === m.ky) ? g.parts : null;
  const wanted = chars.map((ch) => ({ ch, g: glyph(ch, H) }));
  for (const { ch, g } of wanted) {
    if (asParts(g)) continue;
    index.set(ch, glyphs.length);
    glyphs.push({ name: `uni${hex(ch.codePointAt(0))}`, unicode: ch.codePointAt(0), advance: adv(g), contours: strokeContours(g.s, H, { pen, tol, seed: ch }) });
  }
  let composed = 0;
  for (const { ch, g } of wanted) {
    const parts = asParts(g);
    if (!parts) continue;
    const base = index.get(parts[0].ch);
    if (base === undefined) {   // the base is not a glyph of its own: outlines after all
      index.set(ch, glyphs.length);
      glyphs.push({ name: `uni${hex(ch.codePointAt(0))}`, unicode: ch.codePointAt(0), advance: adv(g), contours: strokeContours(g.s, H, { pen, tol, seed: ch }) });
      continue;
    }
    const components = [{ glyph: base, x: 0, y: 0 }];
    for (const m of parts.slice(1)) {
      if (!markIndex.has(m.mark)) {
        markIndex.set(m.mark, glyphs.length);
        glyphs.push({ name: `mark.${m.mark}`, advance: 0, contours: strokeContours((H.marks[m.mark] ?? MARKS[m.mark]).s, H, { pen, tol, seed: `mark.${m.mark}` }) });
      }
      // the mark's point (x, y) lands at (kx x + m.x, ky y + m.y) in em units, y down; slanted and flipped, in units
      components.push({ glyph: markIndex.get(m.mark), x: Math.round((m.x - m.y * slant) * S), y: Math.round(-m.y * S), ...(m.kx === 1 ? {} : { scale: m.kx }) });
    }
    index.set(ch, glyphs.length);
    glyphs.push({ name: `uni${hex(ch.codePointAt(0))}`, unicode: ch.codePointAt(0), advance: adv(g), components });
    composed++;
  }
  // glyphs[1..] in code point order, the marks after them: an unencoded glyph needs no place in cmap's runs
  const head = glyphs.slice(1).filter((g) => g.unicode !== undefined).sort((a, b) => a.unicode - b.unicode);
  const tail = glyphs.slice(1).filter((g) => g.unicode === undefined), order = [glyphs[0], ...head, ...tail];
  const remap = new Map(order.map((g, i) => [glyphs.indexOf(g), i]));
  for (const g of order) if (g.components) g.components = g.components.map((c) => ({ ...c, glyph: remap.get(c.glyph) }));
  const name = family ?? H.name;
  const font = {
    family: name, style: 'Regular', unitsPerEm: UPM, ascender: 950, descender: -300, lineGap: 0,   // 1.25 em, layout.js's LINE_H
    capHeight: 720, xHeight: 480, italicAngle: -(H.slant ?? 0),
    copyright: credit ?? (H.credit || `the hand '${H.name}', exported by hdf hand --export-ttf`),
    licence: licence ?? H.licence, glyphs: order,
  };
  return { font, chars, composites: composed, marks: markIndex.size };
}

export const handTtf = (rec, o) => ttfBytes(handFont(rec, o).font);
