// Hand lettering as strokes: text ops become groups of pen strokes from glyphs.js, so text wobbles,
// reveals in stroke order and hashes like any other drawing. No host fonts anywhere.
import { FPS } from './curves.js';
import { asHand, currentHand, glyph, HOUSE_DRIFT, HOUSE_STROKE, houseHand } from './glyphs.js';
import { advance, layoutWith, LINE_H, opLayout, penOf } from './layout.js';
import { arc, at, bounds, circle, fill, group, len, meta, mkPath, mmul, text, stroke, withProps } from './list.js';
import { handOf } from './looks.js';
import { hash32, rng } from './rand.js';
import { reveal } from './tools.js';

const TAU = Math.PI * 2, D = Math.PI / 180;

// The hand to letter in: a hand record, a look (its hand), or, when neither is given, the hand of the shot
// being drawn. Always a full record; house when nothing names another.
function handFor(v) {
  if (v === undefined || v === null) return currentHand() ?? houseHand();
  if (v.kind === 'hand' || (v.glyphs && !v.palette)) return asHand(v);
  return handOf(v) ?? houseHand();
}

// Advance width of a string at a size, in logical units, in the look's hand (or a hand record; the hand of
// the shot being drawn when neither is given). One line: '\n' is not a break here (see layout).
export const measure = (str, size, look) => advance(str, size, handFor(look));

// layout(str, { size, w, lineH, wrap: 'word' | 'char' | 'none', maxLines, align, valign, x, y, box, look | hand })
//   => { lines: [{ str, x, y, w }], box: [x, y, w, h], size, lineH, truncated }
// Copy broken into lines from the hand's real advances: '\n' always breaks, then each paragraph wraps to w.
// A line's x is where its pen starts, y its baseline, w its advance; box is the ink of the glyphs (no pen).
// Anchored at (x, y) as a text op is (valign 'baseline': y is the first baseline; 'top', 'middle', 'bottom'
// put the ink's edge or centre on y), or inside box [x, y, w, h] (wraps to its width; valign 'top' default,
// 'baseline' puts the first baseline a cap height, 0.72 size, below the top).
// Past maxLines the last line ends in '...' and truncated is true.
export function layout(str, o = {}) {
  const { look, hand, ...rest } = o;
  return layoutWith(String(str), rest, handFor(hand ?? look));
}

// measureBox(str, size, { w, lineH, wrap, maxLines, look | hand }) => [x, y, w, h]: the ink box the copy
// needs, first baseline at y = 0, pen starting at x = 0 (x and y are the ink's offsets from there).
export const measureBox = (str, size, o = {}) => layout(str, { ...o, size, x: 0, y: 0, align: 'left', valign: 'baseline', box: undefined }).box;

// The strokes of one line from pen start gx on baseline y, pushed into st (running glyph and order counters).
// The baseline's wander runs from ox (the op's anchor), so a one-line op letters exactly as it always has.
function letterLine(st, str, gx, y, ox, seed) {
  const { H, size, k, w, wobble, ink2, off, op } = st, r = rng(seed), sl = H.slant ? Math.tan(H.slant * D) : 0;
  const phase = r() * TAU, amp = size * (H.baselineDrift * 0.01), jit = H.baselineDrift / HOUSE_DRIFT;
  for (const ch of str) {
    const g = glyph(ch, H), s = k * g.k;
    const rot = (r() - 0.5) * 0.08, dy = Math.sin(phase + (gx - ox) / size * 1.3) * amp + (r() - 0.5) * size * 0.015 * jit;
    const ca = Math.cos(rot) * s, sa = Math.sin(rot) * s, px0 = gx, py0 = y + dy;
    g.s.forEach((pts, si) => {
      const out = new Array(pts.length);
      for (let i = 0; i < pts.length; i += 2) {
        const px = sl ? pts[i] - pts[i + 1] * sl : pts[i];
        out[i] = px0 + ca * px - sa * pts[i + 1]; out[i + 1] = py0 + sa * px + ca * pts[i + 1];
      }
      const path = mkPath([{ pts: out, closed: false }]), name = `g${st.gi}.${si}`;
      const common = { tool: op.tool ?? 'pen', w, wobble, order: st.order };
      st.main.push(stroke(path, op.role ?? 'ink', { ...common, name }));
      if (ink2) {
        const shifted = mkPath([{ pts: out.map((v, i) => v + (i % 2 ? off * 0.6 : off)), closed: false }]);
        st.under.push(stroke(shifted, ink2, { ...common, name: `${name}b`, alpha: 0.85 }));
      }
      st.order++;
    });
    gx += (g.w * g.k + H.track) * k;
    st.gi++;
  }
}

// Does a text op need layout (more than one line, or a wrap width)?
const isBlock = (op) => op.str.includes('\n') || op.width !== undefined || op.valign !== undefined;

// handText(op, { look | hand }) or handText(str, x, y, { size, role, tool, align, w, ink2, offset, seed,
// width, lineH, maxLines, wrap, valign, look | hand }) => group of stroke ops. Glyph placement (baseline
// drift, small turns) comes from each line's own seed, so the letters only move when the words change; the
// pen wobble comes from each stroke's seed. ink2 (default accents.0, null for none) is a misregistered
// second ink drawn under the first. w is the pen; width wraps the copy (see layout), '\n' breaks it.
// The hand (plan 1.4; the shot's when none is given) brings the glyphs, the track between them, the slant
// (degrees, positive leans right), the baseline drift (em units) and the pen's wobble.
export function handText(a, x, y, o = {}) {
  let op, H;
  if (typeof a === 'string') { const { look, hand, ...rest } = o; op = text(a, x, y, rest); H = handFor(hand ?? look); }
  else { op = a; H = handFor(x?.hand ?? x?.look); }
  const { str, size } = op, w = penOf(op);
  const wobble = H.stroke.wobble === HOUSE_STROKE.wobble ? w * 0.3 : w * 0.3 * (H.stroke.wobble / HOUSE_STROKE.wobble);
  const ink2 = op.ink2 === undefined ? 'accents.0' : op.ink2, off = op.offset ?? Math.max(1, size * 0.035);
  const st = { H, size, k: size / 100, w, wobble, ink2, off, op, main: [], under: [], order: op.order ?? 0, gi: 0 };
  if (isBlock(op)) {
    layoutWith(str, opLayout(op), H).lines.forEach((l, i) => letterLine(st, l.str, l.x, l.y, op.x, op.glyphSeed !== undefined ? hash32(op.glyphSeed, i) : hash32('text', l.str, i)));
  } else {
    const width = advance(str, size, H);
    const gx = op.align === 'center' ? op.x - width / 2 : op.align === 'right' ? op.x - width : op.x;
    letterLine(st, str, gx, op.y, op.x, op.glyphSeed ?? hash32('text', str));
  }
  const props = { name: op.name ?? `text:${str}` };
  if (op.seed !== undefined) props.seed = op.seed;
  return group(props, [...st.under, ...st.main]);
}

// textOnPath(str, path, { size, offset, align: 'start' | 'center' | 'end', at, role, tool, w, ink2, seed,
// look | hand }) => a handText group (named text:<str>, so lint counts and reads it) of one line whose glyphs
// sit along the path by arc length, each turned to the path's heading at its middle: a label round a ring, a
// name along a river (4.0 T8's first piece, made for E3's cycleDiagram). The letters stand on the path's left
// as it runs (above a path run left to right), raised `offset` off it; `at` is the arc length the first glyph
// starts at (default: `align` on the path's length). Run a path right to left to letter under it upright.
export function textOnPath(str, path, o = {}) {
  const { offset = 0, align = 'center', at: s0, look, hand, ...rest } = o, H = handFor(hand ?? look);
  const s = String(str), size = rest.size ?? 48, k = size / 100;
  const flat = handText(s, 0, 0, { ...rest, size, align: 'left', hand: H });
  const mid = [];
  let gx = 0;
  for (const ch of s) { const g = glyph(ch, H); mid.push(gx + g.w * g.k * k / 2); gx += (g.w * g.k + H.track) * k; }
  const total = advance(s, size, H), L = len(path);
  const start = s0 ?? (align === 'center' ? (L - total) / 2 : align === 'end' ? L - total : 0);
  const kids = flat.kids.map((op) => {
    const gi = +(/^g(\d+)\./.exec(op.name ?? '')?.[1] ?? NaN);
    if (!Number.isFinite(gi)) return op;
    const c = mid[gi], p = at(path, start + c), ca = Math.cos(p.heading), sa = Math.sin(p.heading);
    return withProps(op, { path: mkPath(op.path.sub.map((sub) => {
      const pts = new Array(sub.pts.length);
      for (let i = 0; i < pts.length; i += 2) {
        const dx = sub.pts[i] - c, dy = sub.pts[i + 1] - offset;
        pts[i] = p.x + ca * dx - sa * dy; pts[i + 1] = p.y + sa * dx + ca * dy;
      }
      return { pts, closed: sub.closed };
    })) });
  });
  return withProps(flat, { kids });
}

// textRound(str, { x, y, r, at, side: 'out' | 'in', gap, size, ...textOnPath's options }) => one label round a
// circle of radius r about (x, y), its middle at angle `at` (radians, 0 east, clockwise; -PI/2, the top), upright
// wherever it is: on the upper half (and the sides) it runs clockwise, on the lower half anticlockwise, so it
// never reads upside down. side 'out' stands it outside the circle (`gap` off it, a quarter size), 'in'
// inside: the months round a year, the names round a cycle (4.0 T8). A textOnPath group, so lint reads it.
export function textRound(str, o = {}) {
  const { x = 0, y = 0, r = 200, at: a = -Math.PI / 2, side = 'out', gap, ...rest } = o, size = rest.size ?? 48;
  if (side !== 'out' && side !== 'in') throw new TypeError(`textRound: side '${side}' (out, in)`);
  // Clockwise the letters stand outward from their baseline, anticlockwise inward: the baseline goes where the
  // letters' feet must be.
  const g = gap ?? size * 0.25, cap = size * 0.72, top = Math.sin(a) < 1e-9;
  const R = top ? (side === 'out' ? r + g : r - g - cap) : (side === 'out' ? r + g + cap : r - g);
  const path = top ? arc(x, y, R, a - Math.PI, a + Math.PI, 144) : arc(x, y, R, a + Math.PI, a - Math.PI, 144);
  return textOnPath(str, path, { ...rest, size, align: 'center' });
}

// glyphUnits(op | str, { look | hand }) => [{ ch, word, line }] for each glyph handText letters, by its index
// (the gi of a stroke named g<gi>.<si>): the character, which word it is in (counted from 0 across the lines; a
// space starts no word) and which line. A string is lines split at '\n' (what an expanded handText group is
// named after); a text op is laid out as handText lays it out. Reading-speed reveals (writeOn) group by these.
export function glyphUnits(op, o = {}) {
  const lines = typeof op === 'string' ? op.split('\n')
    : isBlock(op) ? layoutWith(op.str, opLayout(op), handFor(o.hand ?? o.look)).lines.map((l) => l.str) : [op.str];
  const out = [];
  let word = -1;
  lines.forEach((str, line) => {
    let gap = true;
    for (const ch of str) {
      const space = /\s/.test(ch);
      if (!space && gap) word++;
      gap = space;
      out.push({ ch, word: Math.max(0, word), line });
    }
  });
  return out;
}

// wordBox(lettered, word, { nth }) => [x, y, w, h]: the ink of one word of lettering (no pen width), for a
// mark to go round (4.0 T7: underline(wordBox(g, 'light'))). lettered is a lettered group (textBox, handText,
// or any group holding one: the first found); word its index (from 0, across the lines) or the word itself,
// matched without case or the punctuation round it (nth: which of several, from 0). In the coordinates of
// the group's kids, as textBox's .box is.
export function wordBox(lettered, word, { nth = 0 } = {}) {
  const find = (op) => (op?.op === 'group' && typeof op.name === 'string' && op.name.startsWith('text:') ? op : op?.kids?.reduce((a, k) => a ?? find(k), null) ?? null);
  const g = find(lettered);
  if (!g) throw new TypeError('wordBox: no lettering (a text:<copy> group) in what was given');
  const units = glyphUnits(g.name.slice(5)), bare = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const words = [];
  units.forEach((u) => { if (!/\s/.test(u.ch)) words[u.word] = (words[u.word] ?? '') + u.ch; });
  let idx = word;
  if (typeof word === 'string') {
    const hits = words.flatMap((w, i) => (bare(w) === bare(word) ? [i] : []));
    idx = hits[nth];
    if (idx === undefined) throw new TypeError(`wordBox: no '${word}'${nth ? ` (#${nth})` : ''} in "${g.name.slice(5)}"`);
  }
  if (!Number.isInteger(idx) || !words[idx]) throw new TypeError(`wordBox: no word ${idx} in "${g.name.slice(5)}" (${words.length} words)`);
  const ink = [];
  const visit = (ops, m) => {
    for (const op of ops) {
      const hit = op.op === 'stroke' && typeof op.name === 'string' && /^g(\d+)\.\d+$/.exec(op.name);
      if (hit) { if (units[+hit[1]]?.word === idx) ink.push(bounds([{ ...op, w: 0 }], m)); }
      else if (op.kids) visit(op.kids, op.op === 'group' ? mmul(m, op.xf) : m);
    }
  };
  visit(g.kids, [1, 0, 0, 1, 0, 0]);
  const b = ink.filter(Boolean);
  if (!b.length) throw new TypeError(`wordBox: word ${idx} ('${words[idx]}') draws nothing`);
  const x0 = Math.min(...b.map((q) => q[0])), y0 = Math.min(...b.map((q) => q[1]));
  return [x0, y0, Math.max(...b.map((q) => q[0] + q[2])) - x0, Math.max(...b.map((q) => q[1] + q[3])) - y0];
}

// textBox(str, [x, y, w, h], { size, align, valign, lineH, maxLines, wrap, role, tool, w, ink2, seed, name,
// look | hand }) => a handText group of the copy wrapped into the box ('\n' honoured, valign 'top' by
// default), its .box the bounds of what it draws and .lines the layout's lines. The copy may run out of a
// box too short for it: give maxLines to cut it, or read .lines to size the box.
export function textBox(str, bx, o = {}) {
  const { look, hand, ...rest } = o, H = handFor(hand ?? look);
  const L = layoutWith(String(str), { ...rest, w: undefined, box: bx }, H);   // rest.w is the pen
  // One text op per box: its anchor is the first line's, its width the box's; lines letter from the layout.
  const x0 = rest.align === 'center' ? bx[0] + bx[2] / 2 : rest.align === 'right' ? bx[0] + bx[2] : bx[0];
  const op = text(L.lines.map((l) => l.str).join('\n'), x0, L.lines[0].y, { ...rest, width: undefined, valign: undefined, lineH: L.lineH });
  const g = handText(op, { hand: H });
  return withProps(g, { box: bounds(g.kids) ?? L.box, lines: L.lines.map((l) => [l.str, l.x, l.y, l.w]) });
}

// The drawn markers of bullets(), each at (x, y) on a line's baseline, size s.
const MARKERS = {
  dot: (x, y, s, role) => fill(circle(x + s * 0.12, y - s * 0.24, s * 0.07, 16), role, { name: 'marker' }),
  dash: (x, y, s, role, w) => stroke(mkPath([{ pts: [x, y - s * 0.24, x + s * 0.3, y - s * 0.25], closed: false }]), role, { w, name: 'marker' }),
  check: (x, y, s, role, w) => stroke(mkPath([{ pts: [x, y - s * 0.26, x + s * 0.12, y - s * 0.08, x + s * 0.4, y - s * 0.52], closed: false }]), role, { w, name: 'marker' }),
};

// bullets(items, [x, y, w, h], { marker: 'dot' | 'dash' | 'number' | 'check', start, size, gap, lineH,
// role, markerRole, ink2, look | hand, ... textBox options }) => a group: one marker and one textBox per
// item (named text:..., so lint counts their words), stacked from the top of the box with gap (default a third of a line) between items. Numbers count
// from start (1) and right-align, so the copy of every item starts on the same x. Its .box is what it draws.
export function bullets(items, bx, o = {}) {
  const { marker = 'dot', start = 1, gap, markerRole, ...rest } = o, H = handFor(rest.hand ?? rest.look);
  const size = rest.size ?? 48, lineH = rest.lineH ?? size * LINE_H, role = markerRole ?? rest.role ?? 'ink', pen = penOf({ size, w: rest.w });
  const label = (i) => `${start + i}.`;
  const indent = marker === 'number'
    ? Math.max(...items.map((_, i) => advance(label(i), size, H))) + size * 0.3
    : size * (marker === 'check' ? 0.75 : 0.55);
  const kids = [];
  let top = bx[1];
  items.forEach((item, i) => {
    const body = textBox(item, [bx[0] + indent, top, Math.max(1, bx[2] - indent), Math.max(0, bx[1] + bx[3] - top)], { ...rest, size, lineH, align: 'left', valign: 'baseline', hand: H });
    const [, , y0] = body.lines[0];
    const mark = marker === 'number'
      ? handText(label(i), bx[0] + indent - size * 0.3, y0, { ...rest, size, role, align: 'right', hand: H })
      : MARKERS[marker]?.(bx[0], y0, size, role, pen) ?? (() => { throw new TypeError(`bullets: no marker '${marker}' (dot, dash, number, check)`); })();
    kids.push(group(`bullet${i}`, [mark, body]));
    top = body.lines[body.lines.length - 1][2] + lineH - size * 0.72 + (gap ?? lineH / 3);
  });
  const g = group(`bullets:${marker}`, kids);
  return withProps(g, { box: bounds(g.kids) ?? [bx[0], bx[1], 0, 0] });
}

// The film's signature: two dots, then word a, then word b (smaller, below), each revealed in stroke
// order by pA and pB. Carries meta{tag:'signOff'} so lint can check it completes in time.
export function signOff(a, b, { x = 540, y = 540, size = 60, pA = 1, pB = 1, ink = 'ink', ink2 = 'accents.0' } = {}) {
  const A = handText(a, x, y - 12, { size, align: 'center', role: ink, ink2 });
  const B = handText(b, x, y + size * 1.1, { size: size * 0.75, align: 'center', role: ink, ink2 });
  return group('signOff', [
    meta('signOff', { a, b, pA, pB }),
    fill(circle(x - 10, y + size * 0.35, 6, 16), ink, { name: 'dotA' }),
    fill(circle(x + 10, y + size * 0.35, 6, 16), ink2, { name: 'dotB' }),
    pA > 0 && reveal(pA, A),
    pB > 0 && reveal(pB, B),
  ]);
}

// Illegible handwriting: rows of little arches filling box [x, y, w, h?] (v1 squiggleText).
export function squiggleText(box, lines, seed = 1, { role = 'ink', lineH, amp = 4, w = 1.3, gap = 0.4 } = {}) {
  const [x, y, bw, bh] = box, r = rng(seed), lh = lineH ?? (bh ? bh / lines : 16), sub = [];
  for (let l = 0; l < lines; l++) {
    let px = x;
    const py = y + l * lh, end = x + bw * (l === lines - 1 ? 0.35 + r() * 0.5 : 0.9 + r() * 0.1);
    while (px < end) {
      const wl = 14 + r() * 40, f = 0.6 + r() * 0.6, pts = [px, py];
      for (let u = 2; u <= wl; u += 2) pts.push(px + u, py - Math.abs(Math.sin(u * f + r() * 0.3)) * amp * (0.5 + r() * 0.8));
      sub.push({ pts, closed: false });
      px += wl + amp * 2 * gap + r() * 8;
    }
  }
  return stroke(mkPath(sub), role, { w, wobble: 0, name: 'squiggle' });
}

// ---------- speech (actor.say, plan S9) ----------

const VOWELS = /[aeiouy]+/g;

// A word's syllables as vowel groups: each ends where its vowel group does, the last takes the tail. A final
// silent 'e' (not '-le') joins the group before it; a word with no vowel is one syllable.
//   syllablesOf('hello') => ['he', 'llo']      syllablesOf('there') => ['there']
export function syllablesOf(word) {
  const low = word.toLowerCase(), ends = [...low.matchAll(VOWELS)].map((m) => m.index + m[0].length);
  if (ends.length > 1 && /[^aeiouy]e$/.test(low) && !/[^aeiouy]le$/.test(low)) ends.pop();
  if (!ends.length) return [word];
  ends[ends.length - 1] = word.length;
  return ends.map((e, k) => word.slice(k ? ends[k - 1] : 0, e));
}

// The mouth over one syllable, a step (1/12 s) each: shut, wide, smiling, a little open (a puppet's mouth
// variants 0..3).
export const VISEMES = Object.freeze([0, 2, 3, 1]);

// A line of speech on the 1/12 s grid from t0: each syllable is one viseme cycle (VISEMES, a step each), a
// space rests the mouth a step, a comma or a full stop two. The letters of a syllable arrive over its steps.
//   => { syllables: [{ text, from, to, t, dur }], steps: [viseme per step], letters: [time per char], dur, end }
// from / to index str; letters[j] is when character j appears (spaces and stops at their own rest).
export function speech(str, t0 = 0) {
  str = String(str);
  const syllables = [], steps = [], letters = new Array(str.length).fill(0);
  let step = 0, j = 0;
  const at = () => t0 + step / FPS;
  while (j < str.length) {
    const word = /^[^\s,.;:!?]+/.exec(str.slice(j));
    if (!word) {
      const ch = str[j];
      letters[j] = at();
      const rest = /[,.;:!?]/.test(ch) ? 2 : /\s/.test(ch) ? 1 : 0;
      for (let r = 0; r < rest; r++) steps.push(0);
      step += rest;
      j++;
      continue;
    }
    for (const syl of syllablesOf(word[0])) {
      const from = j, to = j + syl.length, t = at(), n = VISEMES.length;
      syllables.push({ text: syl, from, to, t, dur: n / FPS });
      for (let c = from; c < to; c++) letters[c] = t0 + (step + Math.floor((c - from) * n / syl.length)) / FPS;
      steps.push(...VISEMES);
      step += n;
      j = to;
    }
  }
  return { syllables, steps, letters, dur: step / FPS, end: t0 + step / FPS };
}
