// Text layout from a hand's own glyphs: advances place the letters, the strokes' ink makes the box. Nothing
// here draws or reads a look; text.js lays out in a look's hand, list.js measures a text op's box with it.
import { asHand, currentHand, glyph, houseHand } from './glyphs.js';

export const LINE_H = 1.25;       // the default line height, in sizes
export const ELLIPSIS = '...';    // what a line cut by maxLines ends in
const D = Math.PI / 180, CAP = 0.72;   // cap height and figures, in sizes (glyphs.js: -72 in a 100 em)

// A hand record, or the hand of the shot being drawn, or the house.
export const handOr = (hand) => (hand ? asHand(hand) : currentHand() ?? houseHand());

// Advance width of a one-line string at a size (what handText steps the pen by; no track after the last glyph).
export function advance(str, size, H) {
  const k = size / 100;
  let w = 0;
  for (const ch of str) { const g = glyph(ch, H); w += (g.w * g.k + H.track) * k; }
  return Math.max(0, w - H.track * k);
}

// A glyph's ink [x0, y0, x1, y1] in em units, leaned by slant tangent sl as handText leans it; null for none.
const inkMemo = new WeakMap();
function inkOf(g, sl) {
  let byS = inkMemo.get(g.s);
  if (!byS) inkMemo.set(g.s, byS = new Map());
  if (byS.has(sl)) return byS.get(sl);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of g.s) for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] - pts[i + 1] * sl, y = pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const out = x0 === Infinity ? null : [x0, y0, x1, y1];
  byS.set(sl, out);
  return out;
}

// The ink of one line from its pen start on the baseline: [x0, y0, x1, y1] or null (blank).
function lineInk(str, size, H) {
  const k = size / 100, sl = H.slant ? Math.tan(H.slant * D) : 0;
  let gx = 0, out = null;
  for (const ch of str) {
    const g = glyph(ch, H), s = k * g.k, b = inkOf(g, sl);
    if (b) {
      const q = [gx + b[0] * s, b[1] * s, gx + b[2] * s, b[3] * s];
      out = out ? [Math.min(out[0], q[0]), Math.min(out[1], q[1]), Math.max(out[2], q[2]), Math.max(out[3], q[3])] : q;
    }
    gx += (g.w * g.k + H.track) * k;
  }
  return out;
}

// The longest head of chars (at least one) that fits in w.
function fitHead(chars, size, H, w) {
  let n = 1;
  while (n < chars.length && advance(chars.slice(0, n + 1).join(''), size, H) <= w + 1e-6) n++;
  return n;
}

// One paragraph (no '\n') broken into lines no wider than w. 'word' breaks at spaces (the space is eaten)
// and cuts a word that is wider than w on its own; 'char' breaks anywhere; 'none' never.
function breakPara(para, size, H, w, wrap) {
  if (wrap === 'none' || !(w < Infinity)) return [para];
  const fits = (s) => advance(s, size, H) <= w + 1e-6;
  if (wrap === 'char') {
    const out = [];
    let chars = [...para];
    while (chars.length > 1 && !fits(chars.join(''))) {
      const n = fitHead(chars, size, H, w);
      out.push(chars.slice(0, n).join(''));
      chars = chars.slice(n);
      while (chars[0] === ' ' && chars.length > 1) chars.shift();
    }
    out.push(chars.join(''));
    return out;
  }
  const out = [];
  let cur = null;
  for (const word of para.split(' ')) {
    if (cur !== null && fits(`${cur} ${word}`)) { cur = `${cur} ${word}`; continue; }
    if (cur !== null) out.push(cur);
    let chars = [...word];
    while (chars.length > 1 && !fits(chars.join(''))) {
      const n = fitHead(chars, size, H, w);
      out.push(chars.slice(0, n).join(''));
      chars = chars.slice(n);
    }
    cur = chars.join('');
  }
  out.push(cur ?? '');
  return out;
}

// The strings of each line: '\n' always breaks, then each paragraph wraps to w. Past maxLines the rest is
// dropped and the last line ends in ELLIPSIS (cut to fit).
export function breakLines(str, size, H, { w = Infinity, wrap = 'word', maxLines = Infinity } = {}) {
  let strs = String(str).split('\n').flatMap((p) => breakPara(p, size, H, w, wrap));
  let truncated = false;
  if (strs.length > maxLines) {
    truncated = true;
    strs = strs.slice(0, Math.max(1, maxLines));
    let last = [...strs[strs.length - 1].trimEnd()];
    while (last.length && advance(last.join('') + ELLIPSIS, size, H) > w + 1e-6) last.pop();
    strs[strs.length - 1] = last.join('').trimEnd() + ELLIPSIS;
  }
  return { strs, truncated };
}

// layout(str, o, H) => { lines: [{ str, x, y, w }], box: [x, y, w, h], size, lineH, truncated }
// Each line's x is its pen start, y its baseline, w its advance. box is the ink of the glyph strokes (no pen
// width, no wander). Anchored at (x, y) like a text op (align about x; valign 'baseline': y is the first
// baseline, or 'top' | 'middle' | 'bottom' of the ink), or in a box [x, y, w, h] (align within it, wrap to
// its width, valign 'top' by default; 'baseline' there sets the first baseline a cap height below the top,
// so copy with and without capitals sits alike).
export function layoutWith(str, o = {}, H = handOr()) {
  const size = o.size ?? 48, lineH = o.lineH ?? size * LINE_H, align = o.align ?? 'left', bx = o.box;
  const w = o.w ?? (bx ? bx[2] : Infinity);
  const { strs, truncated } = breakLines(str, size, H, { w, wrap: o.wrap, maxLines: o.maxLines });
  const ax = bx ? (align === 'center' ? bx[0] + bx[2] / 2 : align === 'right' ? bx[0] + bx[2] : bx[0]) : o.x ?? 0;
  let ink = null;
  const lines = strs.map((s, i) => {
    const aw = advance(s, size, H), x = align === 'center' ? ax - aw / 2 : align === 'right' ? ax - aw : ax, y = i * lineH;
    const b = lineInk(s, size, H);
    if (b) {
      const q = [x + b[0], y + b[1], x + b[2], y + b[3]];
      ink = ink ? [Math.min(ink[0], q[0]), Math.min(ink[1], q[1]), Math.max(ink[2], q[2]), Math.max(ink[3], q[3])] : q;
    }
    return { str: s, x, y, w: aw };
  });
  const top = ink ? ink[1] : 0, bot = ink ? ink[3] : 0;
  const valign = o.valign ?? (bx ? 'top' : 'baseline');
  const y0 = bx ? bx[1] : o.y ?? 0, h0 = bx ? bx[3] : 0;
  const dy = valign === 'top' ? y0 - top
    : valign === 'middle' ? y0 + h0 / 2 - (top + bot) / 2
      : valign === 'bottom' ? y0 + h0 - bot
        : bx ? y0 + size * CAP : y0;
  for (const l of lines) l.y += dy;
  const box = ink ? [ink[0], ink[1] + dy, ink[2] - ink[0], ink[3] - ink[1]] : [lines[0].x, lines[0].y, 0, 0];
  return { lines, box, size, lineH, truncated };
}

// A text op's layout options (width is the wrap width: w on a text op is the pen's).
export const opLayout = (op) => ({ size: op.size, x: op.x, y: op.y, w: op.width, lineH: op.lineH, wrap: op.wrap, maxLines: op.maxLines, align: op.align, valign: op.valign });

// The pen width handText letters a text op with, by default.
export const penOf = (op) => op.w ?? Math.max(1.2, op.size * 0.045);

// What a text op draws, as a bounds box in its own coordinates: the ink of its glyphs in the hand (the shot's
// when none is given), grown by what handText adds on the way: half the pen, the baseline's wander and each
// glyph's small turn, and the second ink's offset.
const opMemo = new WeakMap();
export function opBox(op, hand) {
  const H = handOr(hand);
  let byHand = opMemo.get(op);
  if (!byHand) opMemo.set(op, byHand = new Map());
  if (byHand.has(H)) return byHand.get(H);
  const [x, y, w, h] = layoutWith(op.str, opLayout(op), H).box;
  const m = op.size * (0.04 + 0.0125 * H.baselineDrift) + penOf(op) / 2;
  const off = op.ink2 === null ? 0 : op.offset ?? Math.max(1, op.size * 0.035);
  const out = [x - m, y - m, w + 2 * m + off, h + 2 * m + off * 0.6];
  byHand.set(H, out);
  return out;
}
