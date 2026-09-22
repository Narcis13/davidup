// Numbers a teacher draws (4.0 T8): a fraction, an equation whose ? resolves, a tally, a number axis, a clock,
// dice, coins and a pictograph, and digits that count on as objects appear. Each is a group maths:<kind> built
// about its anchor ({ x, y }, the middle of what it draws unless it says otherwise), its .box what it draws when
// done (so an anchor or a mark has it from the first frame), lettered in the shot's hand (or o.hand / o.look)
// with no second ink unless o.ink2 names one. Drawn things (fraction, equation, tally, numberAxis, clock, dice)
// draw on with o.p in stroke order, a fill arriving with the stroke before it; objects (coins, pictograph)
// appear one at a time as p passes each one's share, each popping in. Numbers are lettering, so lint counts
// them as words; the lines, ticks, pips and tally marks are not.
import { circle, ellipse, fill, group, mkPath, rect, roundRect, stroke, clip, bounds, withProps, walk } from './list.js';
import { place } from './tree.js';
import { ease } from './curves.js';
import { hash32, rng } from './rand.js';
import { handText, measure } from './text.js';
import { question } from './marks.js';
import { reveal } from './tools.js';

const TAU = Math.PI * 2;
const CAP = 0.72;   // a figure's height, in sizes (glyphs stand 72 of a 100-unit em)

// The seed of a maths group: its own, else its kind and name.
const seedOf = (kind, o) => o.seed ?? hash32('maths', kind, o.name ?? '');
// The hand or look lettering takes, when the options name one.
const handOpts = (o) => (o.hand !== undefined ? { hand: o.hand } : o.look !== undefined ? { look: o.look } : {});

// The pieces of a drawing in the order they draw: next() is the order for a stroke, letter() letters a string
// with its strokes numbered on from there (one order a stroke, as handText numbers them).
function orders(base = 0) {
  let n = base;
  return {
    next: () => n++,
    letter(str, x, y, o, extra = {}) {
      const g = handText(String(str), x, y, { size: o.size, align: 'center', role: o.role ?? 'ink', ink2: o.ink2 ?? null, order: n, seed: extra.seed, ...handOpts(o), ...extra });
      let top = n - 1;
      walk([g], (op) => { if (op.op === 'stroke') top = Math.max(top, op.order ?? n); });
      n = top + 1;
      return g;
    },
    // Moves the counter past every stroke of a node already numbered from here (a mark, a fraction).
    adopt(node) { walk([node], (op) => { if (op.op === 'stroke' && op.order >= n) n = op.order + 1; }); return node; },
    get at() { return n; },
  };
}

// A pen line of a drawing, through [x, y] points (straight, or o.smooth), wobbling with the look's pen.
function pen(pts, role, w, seed, name, order, o = {}) {
  const s = { w, seed, name, order };
  if (o.wobble !== undefined) s.wobble = o.wobble;
  return stroke(mkPath([{ pts: pts.flat(), closed: !!o.closed }]), role, s);
}

// The group drawn on to p in stroke order (reveal's), each fill shown once the stroke before it in the list is
// whole (a fill before any stroke shows from the first bit of ink). Its .box is the whole drawing's.
function drawnOn(kind, seed, kids, p, props = {}) {
  const g = group({ name: `maths:${kind}`, seed }, kids);
  const all = { ...props, box: props.box ?? bounds(g.kids) ?? [0, 0, 0, 0] };
  if (p >= 1) return withProps(g, all);
  if (p <= 0) return withProps(group({ name: `maths:${kind}`, seed }, []), all);
  const anchor = new Map();
  let last = null;
  walk([g], (op) => { if (op.op === 'stroke') last = op; else if (op.op === 'fill') anchor.set(op, last); });
  const out = reveal(p, g), whole = new Set();
  walk([out], (op) => { if (op.op === 'stroke') whole.add(op); });
  const keep = (ops) => ops.flatMap((op) => {
    if (op.op === 'fill') { const a = anchor.get(op); return (a ? whole.has(a) : true) ? [op] : []; }
    return op.kids ? [withProps(op, { kids: keep(op.kids) })] : [op];
  });
  return withProps(out, { ...all, kids: keep(out.kids) });
}

// n objects appearing one at a time over p (the k-th once p passes k / n), each scaled up from 60% over its
// share (the last sliver snapped to 1, so a hash never mistakes it for the next frame's).
function appearing(items, p) {
  const n = items.length;
  return items.flatMap((it, k) => {
    const u = Math.min(1, p * n - k);
    if (u <= 0) return [];
    const s = 0.6 + 0.4 * ease.out(u);
    return [place(it.x, it.y, s > 0.9995 ? {} : { scale: s }, it.node)];
  });
}

// ---------- fraction ----------

// fraction(a, b, { x, y, size, whole, role, bar, w, p, hand | look, seed, name }) => a over b, stacked about a
// bar whose middle is (x, y): the numerator, the bar (as wide as the wider of the two and a bit), the
// denominator; with `whole` a mixed number, the whole lettered first to the left, level with the bar. .bar is
// the bar's [x0, y, x1].
export function fraction(a, b, o = {}) {
  const { x = 0, y = 0, size = 64, p = 1 } = o, seed = seedOf('fraction', o), r = rng(seed), role = o.role ?? 'ink';
  const H = handOpts(o), wa = measure(String(a), size, H.hand ?? H.look), wb = measure(String(b), size, H.hand ?? H.look);
  const bw = Math.max(wa, wb) + size * 0.3, ww = o.whole !== undefined ? measure(String(o.whole), size, H.hand ?? H.look) + size * 0.2 : 0;
  const cx = x + ww / 2, O = orders(), gap = size * 0.2, lo = { ...o, size, role };
  const kids = [];
  if (o.whole !== undefined) kids.push(O.letter(o.whole, x - (ww + bw) / 2 + (ww - size * 0.2) / 2, y + size * CAP / 2, lo, { seed: hash32(seed, 'whole') }));
  kids.push(O.letter(a, cx, y - gap, lo, { seed: hash32(seed, 'a') }));
  const j = () => (r() - 0.5) * size * 0.03;
  kids.push(pen([[cx - bw / 2, y + j()], [cx + bw / 2, y + j()]], o.bar ?? role, o.w ?? Math.max(2, size * 0.05), hash32(seed, 'bar'), 'bar', O.next(), o));
  kids.push(O.letter(b, cx, y + gap + size * CAP, lo, { seed: hash32(seed, 'b') }));
  return drawnOn('fraction', seed, kids, p, { bar: [cx - bw / 2, y, cx + bw / 2] });
}

// ---------- equation ----------

const OPS = { '+': '+', '-': '−', '−': '−', '*': '×', '×': '×', '÷': '÷', ':': ':', '/': '/', '=': '=', '≠': '≠', '<': '<', '>': '>', '≤': '≤', '≥': '≥' };
const TOKEN = /\s*(\d+\/\d+|\d+(?:[.,]\d+)?|\?|[\p{L}]+|[()]|[-+−*×÷:/=≠<>≤≥])/uy;

// The tokens of an equation: { k: 'num' | 'frac' | 'slot' | 'op' | 'open' | 'close' | 'unary', s }.
function tokens(str) {
  const out = [];
  TOKEN.lastIndex = 0;
  const src = String(str).trim();
  while (TOKEN.lastIndex < src.length) {
    const at = TOKEN.lastIndex, m = TOKEN.exec(src);
    if (!m) throw new TypeError(`equation: cannot read "${src.slice(at)}" in "${src}"`);
    const s = m[1], prev = out[out.length - 1];
    if (/^\d+\/\d+$/.test(s)) out.push({ k: 'frac', s });
    else if (s === '?') out.push({ k: 'slot', s });
    else if (s === '(') out.push({ k: 'open', s });
    else if (s === ')') out.push({ k: 'close', s });
    else if (OPS[s]) {
      // A minus with nothing to take from (at the start, after an operator or an open bracket) is a sign.
      const unary = (s === '-' || s === '−') && (!prev || prev.k === 'op' || prev.k === 'open' || prev.k === 'unary');
      out.push(unary ? { k: 'unary', s: '−' } : { k: 'op', s: OPS[s] });
    } else out.push({ k: 'num', s });
  }
  return out;
}
// Whether a space goes between two tokens: round an operator, never inside brackets or after a sign, never
// between two operands written together (2x, 3(4)).
const spaced = (a, b) => !!a && !!b && (a.k === 'op' || b.k === 'op') && a.k !== 'open' && b.k !== 'close' && a.k !== 'unary';

// equation(str, { answer, p, x, y, size, align: 'left' | 'center' | 'right', role, answerRole, fractions, hand |
// look, seed, name }) => the equation lettered on one baseline y with a teacher's spacing: a space round each
// operator (* written ×, a minus −), none inside brackets or after a sign; digits over digits (3/4) stacked as
// a fraction unless fractions: false. Each ? is a slot: a big drawn ? (a mark, not a word) as wide as its
// answer, so nothing moves when it resolves. With `answer` (a value, or a list, one a slot), p to 0.5 writes
// the equation with its ?s, and as p passes 0.5 each ? gives way to its answer, written on by 1 (answerRole,
// the role by default); without, p writes it all and the ?s stay. .slots are the slots' boxes, .resolved
// whether the answers are up, .str the equation as lettered (the answers in).
export function equation(str, o = {}) {
  const { x = 0, y = 0, size = 96, p = 1, align = 'center' } = o, seed = seedOf('equation', o), role = o.role ?? 'ink';
  const H = handOpts(o), hand = H.hand ?? H.look, space = measure(' ', size, hand);
  const toks = tokens(str).map((t) => (t.k === 'frac' && o.fractions === false ? { k: 'num', s: t.s.replace('/', ' / ') } : t));
  const answers = o.answer === undefined ? [] : [o.answer].flat().map(String);
  const nSlots = toks.filter((t) => t.k === 'slot').length;
  if (answers.length && answers.length !== nSlots) throw new TypeError(`equation: ${answers.length} answer(s) for ${nSlots} ? in "${str}"`);
  const resolved = answers.length > 0 && p > 0.5;
  // Segments: runs of lettering, fractions and slots, with the gap before each.
  const segs = [];
  let slot = 0;
  toks.forEach((t, i) => {
    const gap = spaced(toks[i - 1], t) ? space : 0, run = segs[segs.length - 1];
    if (t.k === 'frac' || t.k === 'slot') {
      const ans = t.k === 'slot' ? answers[slot++] : null;
      const w = t.k === 'frac' ? Math.max(...t.s.split('/').map((v) => measure(v, size * 0.7, hand))) + size * 0.25
        : Math.max(measure('?', size, hand), ans === null || ans === undefined ? 0 : measure(ans, size, hand));
      segs.push({ k: t.k, s: t.s, ans, gap, w });
    } else if (run && run.k === 'run') run.s += (gap ? ' ' : '') + t.s;
    else segs.push({ k: 'run', s: t.s, gap });
  });
  for (const s of segs) if (s.k === 'run') s.w = measure(s.s, size, hand);
  const total = segs.reduce((a, s) => a + s.gap + s.w, 0);
  let cur = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const O = orders(), lo = { ...o, size, role }, kids = [], slots = [], lettered = [];
  // Everything written before the answers: the runs, the fractions, the ?s, in reading order.
  const before = [], after = [];
  segs.forEach((s, i) => {
    cur += s.gap;
    const mid = cur + s.w / 2;
    if (s.k === 'run') { before.push(O.letter(s.s, cur, y, lo, { align: 'left', seed: hash32(seed, 'run', i) })); lettered.push(s.s); }
    else if (s.k === 'frac') {
      const [a, b] = s.s.split('/');
      const f = fraction(a, b, { ...lo, x: mid, y: y - size * CAP / 2, size: size * 0.7, seed: hash32(seed, 'frac', i) });
      before.push(O.adopt(retime(f, O.at))); lettered.push(s.s);
    } else {
      const box = [cur, y - size * CAP, s.w, size * CAP];
      slots.push(box);
      before.push(O.adopt(question([mid, y - size * CAP / 2], size * CAP * 1.02, 1, { role, w: Math.max(2, size * 0.05), order: O.at, seed: hash32(seed, 'q', i), ...(H.hand ? { hand: H.hand } : {}) })));
      if (s.ans !== null && s.ans !== undefined) after.push({ s: s.ans, mid });
      lettered.push(resolved ? s.ans : '?');
    }
    cur += s.w;
  });
  // The whole equation, both ways, so the box holds still when the ? resolves.
  const answerKids = after.map((a, k) => O.letter(a.s, a.mid, y, { ...lo, role: o.answerRole ?? role }, { seed: hash32(seed, 'ans', k) }));
  const box = bounds([...before, ...answerKids]) ?? [x, y - size * CAP, 0, size * CAP];
  const props = { box, slots, resolved, str: lettered.join(' ') };
  if (!answers.length) return drawnOn('equation', seed, before, p, props);
  if (!resolved) return drawnOn('equation', seed, before, p / 0.5, props);
  // Resolved: the ?s are gone and the answers write on over the rest of p.
  const kept = before.filter((k) => k.name !== 'mark:question');
  const written = drawnOn('answers', hash32(seed, 'answers'), answerKids, (p - 0.5) / 0.5);
  kids.push(...kept, ...written.kids);
  return withProps(group({ name: 'maths:equation', seed }, kids), props);
}
// A drawing's strokes numbered on from base (so a fraction in an equation writes in its turn).
function retime(node, base) {
  const bump = (op) => (op.op === 'stroke' ? withProps(op, { order: base + (op.order ?? 0) }) : op.kids ? withProps(op, { kids: op.kids.map(bump) }) : op);
  return bump(node);
}

// ---------- tally ----------

// tally(n, { x, y, h, role, w, p, seed, name }) => n tally marks from (x, y), the top left, h tall (60): fours of
// uprights struck through by the fifth, a gate at a time, each mark a stroke of its own. A fractional n draws
// the last mark part way (tally(2.5): two marks and half the third), so a tally can grow in step with a count;
// p draws the whole on. .box is where its ceil(n) marks go; .count the whole marks.
export function tally(n, o = {}) {
  if (!(n >= 0)) throw new TypeError(`tally: n must be a count, got ${n}`);
  const { x = 0, y = 0, h = 60, p = 1 } = o, seed = seedOf('tally', o), role = o.role ?? 'ink', w = o.w ?? Math.max(2.5, h * 0.06);
  const whole = Math.floor(n + 1e-9), part = n - whole > 1e-9 ? n - whole : 0, count = whole + (part ? 1 : 0), kids = [];
  for (let j = 0; j < count; j++) {
    const r = rng(hash32(seed, j)), g = Math.floor(j / 5), gx = x + g * h * 1.1, k = j % 5, jx = () => (r() - 0.5) * h * 0.05;
    const pts = k === 4
      ? [[gx - h * 0.14 + jx(), y + h * 0.78], [gx + h * 0.76 + jx(), y + h * 0.18]]
      : [[gx + k * h * 0.19 + jx(), y + jx()], [gx + k * h * 0.19 + jx() + h * 0.03, y + h]];
    kids.push(pen(pts, role, w, hash32(seed, 'mark', j), `mark${j}`, j, o));
  }
  const box = count ? bounds(kids) : [x, y, 0, h];
  if (part) kids[count - 1] = reveal(part, kids[count - 1]);
  return drawnOn('tally', seed, kids, p, { box, count: whole });
}

// ---------- number axis ----------

// numberAxis(a, b, { x, y, width, step, marks, at, size, role, dot, arrows, p, seed, name }) => a number line
// from a to b, `width` long (700) with its middle at (x, y): the line (arrowed both ends with arrows: true), a
// tick every `step`, the numbers under the ticks (`marks`: a list, or every how many; by default every tick up
// to 11 of them, else the ends), then a dot on the line at each value of `at` (a number or a list) in `dot`
// ('accents.0'). The recipe AT (numberLine) hops along one; this is the line itself. .xs are [value, x] for
// every tick, .ends the line's [x0, x1].
export function numberAxis(a, b, o = {}) {
  if (!(b > a) || !(Number(o.step ?? 1) > 0)) throw new TypeError(`numberAxis: ${a} to ${b} by ${o.step ?? 1} is not a line`);
  const { x = 0, y = 0, width = 700, step = 1, size = 40, p = 1 } = o, seed = seedOf('numberAxis', o), role = o.role ?? 'ink';
  const x0 = x - width / 2, xAt = (v) => x0 + ((v - a) / (b - a)) * width, O = orders(), kids = [], w = Math.max(2.5, size * 0.07);
  const over = size * 0.8;
  kids.push(pen([[x0 - over, y], [x0 + width + over, y]], role, w, hash32(seed, 'line'), 'line', O.next(), o));
  if (o.arrows) for (const [ex, d] of [[x0 - over, -1], [x0 + width + over, 1]]) {
    kids.push(pen([[ex - d * size * 0.35, y - size * 0.25], [ex, y], [ex - d * size * 0.35, y + size * 0.25]], role, w, hash32(seed, 'arrow', d), 'arrow', O.next(), o));
  }
  const xs = [];
  for (let v = a; v <= b + 1e-9; v += step) xs.push([+v.toFixed(6), xAt(v)]);
  xs.forEach(([v, tx], i) => kids.push(pen([[tx, y - size * 0.3], [tx, y + size * 0.3]], role, w * 0.8, hash32(seed, 'tick', i), `tick${i}`, O.next(), o)));
  const every = typeof o.marks === 'number' ? o.marks : null;
  const shown = Array.isArray(o.marks) ? o.marks
    : every ? xs.map(([v]) => v).filter((v, i) => i % Math.max(1, Math.round(every / step)) === 0)
      : xs.length <= 11 ? xs.map(([v]) => v) : [a, b];
  shown.forEach((v, i) => kids.push(O.letter(v, xAt(v), y + size * 0.55 + size * CAP, { ...o, size, role }, { seed: hash32(seed, 'num', i) })));
  const dots = o.at === undefined ? [] : [o.at].flat();
  dots.forEach((v, i) => {
    if (!(v >= a && v <= b)) throw new TypeError(`numberAxis: at ${v} is not on the line ${a} to ${b}`);
    const c = circle(xAt(v), y, size * 0.22, 20);
    kids.push(stroke(c, o.dot ?? 'accents.0', { w: w * 0.8, seed: hash32(seed, 'dot', i), name: `dot${i}`, order: O.next() }), fill(c, o.dot ?? 'accents.0', { name: `dotFill${i}` }));
  });
  return drawnOn('numberAxis', seed, kids, p, { xs, ends: [x0, x0 + width] });
}

// ---------- clock ----------

// clock(h, m, { x, y, r, numbers: 'quarters' | 'all' | 'none', minutes, face, role, hands, p, seed, name }) => a
// clock face of radius r (160) round (x, y) showing h:m: the rim, a tick each hour (and each minute with
// minutes: true), the numbers (by default 12, 3, 6 and 9: four words, not twelve), the hour hand (moved on by the
// minutes, so clock(3, 30) has it half way to 4), the minute hand, the pin; `face` a fill role under it all.
// m may run past 60 or be fractional, so clock(9, t * 60) turns. .hands the two tips.
export function clock(h, m = 0, o = {}) {
  const { x = 0, y = 0, r = 160, p = 1, numbers = 'quarters' } = o, seed = seedOf('clock', o), role = o.role ?? 'ink', hr = o.hands ?? role;
  if (!['quarters', 'all', 'none'].includes(numbers)) throw new TypeError(`clock: numbers '${numbers}' (quarters, all, none)`);
  const O = orders(), kids = [], w = Math.max(2.5, r * 0.025), q = rng(seed), size = o.size ?? r * 0.3;
  const rimPath = mkPath([{ pts: Array.from({ length: 49 }, (_, i) => { const a = -Math.PI / 2 + i / 48 * TAU * 1.03, k = 1 + (q() - 0.5) * 0.012; return [x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]; }).flat(), closed: false }]);
  if (o.face) kids.push(fill(circle(x, y, r, 48), o.face, { name: 'face' }));
  kids.push(stroke(rimPath, role, { w: w * 1.3, seed: hash32(seed, 'rim'), name: 'rim', order: O.next() }));
  const ticks = o.minutes ? 60 : 12;
  for (let i = 0; i < ticks; i++) {
    const a = i / ticks * TAU - Math.PI / 2, big = i % (ticks / 12) === 0, r0 = r * (big ? 0.84 : 0.9), r1 = r * 0.95;
    kids.push(pen([[x + Math.cos(a) * r0, y + Math.sin(a) * r0], [x + Math.cos(a) * r1, y + Math.sin(a) * r1]], role, big ? w : w * 0.5, hash32(seed, 'tick', i), `tick${i}`, O.next(), o));
  }
  const hours = numbers === 'all' ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : numbers === 'quarters' ? [12, 3, 6, 9] : [];
  for (const n of hours) {
    const a = (n % 12) / 12 * TAU - Math.PI / 2, rr = r * 0.66;
    kids.push(O.letter(n, x + Math.cos(a) * rr, y + Math.sin(a) * rr + size * CAP / 2, { ...o, size, role }, { seed: hash32(seed, 'n', n) }));
  }
  const ah = ((h % 12) + m / 60) / 12 * TAU - Math.PI / 2, am = (m / 60) * TAU - Math.PI / 2;
  const tip = (a, L) => [x + Math.cos(a) * L, y + Math.sin(a) * L];
  const hourTip = tip(ah, r * 0.5), minTip = tip(am, r * 0.78);
  kids.push(pen([tip(ah + Math.PI, r * 0.1), hourTip], hr, w * 2, hash32(seed, 'hour'), 'hour', O.next(), o));
  kids.push(pen([tip(am + Math.PI, r * 0.12), minTip], hr, w * 1.3, hash32(seed, 'minute'), 'minute', O.next(), o));
  kids.push(fill(circle(x, y, w * 1.6, 16), hr, { name: 'pin' }));
  return drawnOn('clock', seed, kids, p, { box: [x - r * 1.04, y - r * 1.04, r * 2.08, r * 2.08], hands: [hourTip, minTip] });
}

// ---------- dice ----------

// Where a die's pips go for 1 to 6, in its own unit square.
const PIPS = {
  1: [[0.5, 0.5]], 2: [[0.26, 0.26], [0.74, 0.74]], 3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.26, 0.26], [0.74, 0.26], [0.26, 0.74], [0.74, 0.74]], 5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.26, 0.24], [0.74, 0.24], [0.26, 0.5], [0.74, 0.5], [0.26, 0.76], [0.74, 0.76]],
};
// dice(n, { x, y, s, role, pip, face, turn, p, seed, name }) => a die showing n (1 to 6), s (100) square round
// (x, y), turned a touch (`turn`, radians; a little by its seed): its outline, then its pips a ring at a time,
// each filled as it closes; `face` a fill role under it. A list of n draws a row of dice, one after another.
export function dice(n, o = {}) {
  const list = [n].flat(), { x = 0, y = 0, s = 100, p = 1 } = o, seed = seedOf('dice', o);
  for (const v of list) if (!PIPS[v]) throw new TypeError(`dice: ${v} is not a face (1 to 6)`);
  const O = orders(), kids = [], role = o.role ?? 'ink', pip = o.pip ?? role, w = Math.max(2.5, s * 0.04);
  list.forEach((v, d) => {
    const r = rng(hash32(seed, d)), cx = x + (d - (list.length - 1) / 2) * s * 1.35, a = o.turn ?? (r() - 0.5) * 0.24;
    const ca = Math.cos(a), sa = Math.sin(a), to = ([u, w2]) => [cx + (u - 0.5) * s * ca - (w2 - 0.5) * s * sa, y + (u - 0.5) * s * sa + (w2 - 0.5) * s * ca];
    const body = roundRect(0, 0, 1, 1, 0.16, 5), pts = [];
    for (let i = 0; i < body.sub[0].pts.length; i += 2) pts.push(to([body.sub[0].pts[i], body.sub[0].pts[i + 1]]));
    const outline = mkPath([{ pts: pts.flat(), closed: true }]);
    if (o.face) kids.push(fill(outline, o.face, { name: `face${d}` }));
    kids.push(stroke(outline, role, { w, seed: hash32(seed, 'die', d), name: `die${d}`, order: O.next() }));
    PIPS[v].forEach((c, k) => {
      const [px, py] = to(c), ring = circle(px, py, s * 0.08, 14);
      kids.push(stroke(ring, pip, { w: w * 0.6, seed: hash32(seed, 'pip', d, k), name: `pip${d}.${k}`, order: O.next() }), fill(ring, pip, { name: `pipFill${d}.${k}` }));
    });
  });
  return drawnOn('dice', seed, kids, p, { box: bounds(kids) });
}

// ---------- coins ----------

// coins(n, { x, y, r, value, layout: 'row' | 'stack', cols, face, role, p, seed, name }) => n coins round (x, y),
// each r (40) in radius, a face (`face`, 'fills.3') inside a rim and an inner ring, `value` lettered on each
// (one word however many coins); in rows of `cols` (5), or a stack seen from the side, each coin on the one
// before. They appear one at a time as p passes each one's share. .box is where all n go.
export function coins(n, o = {}) {
  if (!(Number.isInteger(n) && n >= 0)) throw new TypeError(`coins: n must be a whole count, got ${n}`);
  const { x = 0, y = 0, r = 40, p = 1, layout = 'row', cols = 5 } = o, seed = seedOf('coins', o), role = o.role ?? 'ink', face = o.face ?? 'fills.3';
  if (!['row', 'stack'].includes(layout)) throw new TypeError(`coins: layout '${layout}' (row, stack)`);
  const w = Math.max(2, r * 0.07), items = [];
  const rows = Math.ceil(n / cols), size = o.size ?? r * 0.9;
  for (let k = 0; k < n; k++) {
    const q = rng(hash32(seed, k)), kids = [];
    let cx, cy;
    if (layout === 'stack') {
      cx = x + (q() - 0.5) * r * 0.16; cy = y - k * r * 0.3;
      const top = ellipse(0, 0, r, r * 0.34, 32), side = mkPath([{ pts: [r, 0, ...ellipse(0, r * 0.22, r, r * 0.34, 32).sub[0].pts.slice(0, 34), -r, 0], closed: false }]);
      kids.push(fill(ellipse(0, r * 0.11, r, r * 0.4, 32), face, { name: 'edge' }), stroke(side, role, { w, seed: hash32(seed, 'side', k), name: 'side' }));
      kids.push(fill(top, face, { name: 'top' }), stroke(top, role, { w, seed: hash32(seed, 'rim', k), name: 'rim' }), stroke(ellipse(0, 0, r * 0.72, r * 0.24, 28), role, { w: w * 0.6, seed: hash32(seed, 'ring', k), name: 'ring' }));
    } else {
      const row = Math.floor(k / cols), inRow = row < rows - 1 ? cols : n - row * cols;
      cx = x + (k % cols - (inRow - 1) / 2) * r * 2.3; cy = y + (row - (rows - 1) / 2) * r * 2.3;
      kids.push(fill(circle(0, 0, r, 36), face, { name: 'face' }), stroke(circle(0, 0, r, 36), role, { w, seed: hash32(seed, 'rim', k), name: 'rim' }));
      kids.push(stroke(circle(0, 0, r * 0.78, 30), role, { w: w * 0.6, seed: hash32(seed, 'ring', k), name: 'ring' }));
      if (o.value !== undefined && o.value !== null) kids.push(handText(String(o.value), 0, size * CAP / 2, { size, align: 'center', role, ink2: o.ink2 ?? null, seed: hash32(seed, 'value'), ...handOpts(o) }));
    }
    items.push({ x: cx, y: cy, node: group({ name: `coin${k}`, seed: hash32(seed, k) }, kids) });
  }
  const box = n ? bounds(items.map((it) => place(it.x, it.y, it.node))) : [x, y, 0, 0];
  return withProps(group({ name: 'maths:coins', seed }, appearing(items, p)), { box });
}

// ---------- pictograph ----------

// pictograph(n, cel, { x, y, cols, cell, fill, p, seed, name }) => n pictures of `cel` (a cel, a node, or
// (j) => node) in rows of `cols` (5) round (x, y), each fitted to a `cell` (90) square at `fill` (0.85) of it; a
// fractional n cuts the last picture down to what is left of it (a half apple is its left half). They appear
// one at a time as p passes each one's share. .box is where all ceil(n) go.
export function pictograph(n, cel, o = {}) {
  if (!(n >= 0)) throw new TypeError(`pictograph: n must be a count, got ${n}`);
  const { x = 0, y = 0, cols = 5, cell = 90, p = 1 } = o, seed = seedOf('pictograph', o);
  const count = Math.ceil(n - 1e-9), rows = Math.ceil(count / cols), items = [];
  const draw = (j) => (typeof cel === 'function' ? (cel.cel ? cel({}) : cel(j)) : cel);
  for (let j = 0; j < count; j++) {
    const node = draw(j), b = node.box ?? bounds(node), k = (cell * (o.fill ?? 0.85)) / Math.max(1, b[2], b[3]);
    const row = Math.floor(j / cols), inRow = row < rows - 1 ? cols : count - row * cols;
    const cx = x + (j % cols - (inRow - 1) / 2) * cell, cy = y + (row - (rows - 1) / 2) * cell;
    let pic = place(-(b[0] + b[2] / 2) * k, -(b[1] + b[3] / 2) * k, { scale: k }, node);
    const part = j === count - 1 ? n - j : 1;
    if (part < 1 - 1e-9) pic = clip(rect(-cell / 2, -cell / 2, cell * part, cell), [pic]);
    items.push({ x: cx, y: cy, node: group({ name: `pic${j}` }, [pic]) });
  }
  const box = count ? [x - (Math.min(count, cols) * cell) / 2, y - (rows * cell) / 2, Math.min(count, cols) * cell, rows * cell] : [x, y, 0, 0];
  return withProps(group({ name: 'maths:pictograph', seed }, appearing(items, p)), { box });
}

// ---------- counting on ----------

// countTimes(n, { t0, per }) => the seconds at which each of n objects arrives and its number is written:
// t0 + j * per (per 0.5, a recipe's counting pace), so the objects and countOn keep the same beat.
export const countTimes = (n, { t0 = 0, per = 0.5 } = {}) => Array.from({ length: n }, (_, j) => t0 + j * per);

// countOn(n, t, { t0, per, at, from, size, write, role, hand | look, seed, name }) => the numbers of a count at
// time t: as each of n objects arrives (countTimes), its number (from `from`, 1) is written on over `write`
// seconds (0.3, at most 0.6 of a beat). `at` is where: a point [x, y] writes the running count there, the
// last number replacing the one before; a list of points or (j) => [x, y] writes each number at its object
// (the point the middle of its figures). .count is how many have arrived, .times when.
export function countOn(n, t, o = {}) {
  const { t0 = 0, per = 0.5, from = 1, size = 48, at = [0, 0] } = o, seed = seedOf('countOn', o), role = o.role ?? 'ink';
  const times = countTimes(n, { t0, per }), write = o.write ?? Math.min(0.3, per * 0.6);
  const arrived = times.filter((tj) => t >= tj).length;
  const where = typeof at === 'function' ? at : Array.isArray(at[0]) ? (j) => at[j] : null;
  const one = (j) => {
    const [px, py] = where ? where(j) : at, g = handText(String(from + j), px, py + size * CAP / 2, { size, align: 'center', role, ink2: o.ink2 ?? null, seed: hash32(seed, j), ...handOpts(o) });
    const u = Math.min(1, (t - times[j]) / write);
    return u >= 1 ? g : reveal(u, g);
  };
  const shown = !arrived ? [] : where ? Array.from({ length: arrived }, (_, j) => one(j)) : [one(arrived - 1)];
  return withProps(group({ name: 'maths:count', seed }, shown), { count: arrived, times });
}
