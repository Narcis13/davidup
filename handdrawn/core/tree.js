// The time tree. Cels are timeless drawings, shots are drawings over time, and seq/par/hold/cut/lookOn
// arrange them. frame(film, i) is the one entry point the rasteriser and lint use.
import { FPS } from './curves.js';
import { audienceOf } from './audience.js';
import { fitFor, format } from './fit.js';
import { currentHand, withHand } from './glyphs.js';
import { fx, group, hashData, lookNode, mmul, norm, rotate, scale, translate, walk, withProps } from './list.js';
import { ghostOf, handOf } from './looks.js';
import { hash32, seedOf } from './rand.js';

// Durations must land on the 1/12 s grid; everything downstream counts drawn frames.
function frames(dur, who) {
  const n = dur * FPS;
  if (!(dur > 0) || !Number.isFinite(dur)) throw new RangeError(`${who}: duration must be > 0, got ${dur}`);
  if (Math.abs(n - Math.round(n)) >= 1e-9) throw new RangeError(`${who}: duration ${dur}s is off the 1/${FPS} s grid (${n} frames)`);
  return Math.round(n);
}

const isNode = (v) => !!v && typeof v === 'object' && typeof v.kind === 'string' && Number.isInteger(v.n);
function nodes(list, who) {
  const out = list.flat(Infinity);
  if (!out.length) throw new Error(`${who}: needs at least one node`);
  for (const v of out) {
    if (!isNode(v)) throw new TypeError(`${who}: not a timeline node: ${String(v)}`);
    frames(v.dur, `${who} > ${nameOf(v)}`);   // re-checked here so foreign nodes cannot slip off the grid
  }
  return out;
}
export const nameOf = (node) => node.name ?? node.kind;

// ---------- cels and placement ----------

function quantise(v, spec) {
  if (typeof v !== 'number' || !Array.isArray(spec)) return v;
  const [lo, hi, step] = spec;
  const c = Math.min(hi, Math.max(lo, v));
  return step > 0 ? +(lo + Math.round((c - lo) / step) * step).toFixed(9) : c;
}

const handKeys = new WeakMap();
const handKey = (h) => { let k = handKeys.get(h); if (!k) { k = hashData(h); handKeys.set(h, k); } return k; };

// cel(name, draw, { box, inputs: { key: [min, max, step] }, desc }) => (inputs = {}) => group op.
// Continuous inputs are quantised before drawing so a wing angle does not defeat the cache; the same
// quantised inputs return the same (frozen) group object. A cel drawn in a shot lettered in another hand is
// cached apart (its words are in that hand).
export function cel(name, draw, { box, inputs = {}, desc } = {}) {
  if (typeof name !== 'string' || !name) throw new TypeError('cel: needs a name');
  if (typeof draw !== 'function') throw new TypeError(`cel ${name}: draw must be a function`);
  const memo = new Map();
  const make = (given = {}) => {
    const q = {};
    for (const k of Object.keys(given).sort()) q[k] = quantise(given[k], inputs[k]);
    const hand = currentHand(), key = hand ? `${JSON.stringify(q)}~${handKey(hand)}` : JSON.stringify(q);
    let g = memo.get(key);
    if (!g) {
      if (memo.size >= 512) memo.clear();
      g = group({ name, cel: name, box, inputs: q }, draw(q));
      memo.set(key, g);
    }
    return g;
  };
  make.cel = Object.freeze({ name, box, inputs, desc });
  return make;
}

// place(x, y, [{ rot, scale, flip }], node): a group op with its xf set. Rotating or scaling groups draw
// direct (plan 1.5), so they are marked cache: 'never'; an x-flip stays cacheable.
export function place(x, y, o, node) {
  if (node === undefined) { node = o; o = {}; }
  const { rot = 0, scale: s = 1, flip = false } = o ?? {};
  const g = Array.isArray(node) ? group(node) : node.op === 'group' ? node : group([node]);
  let m = translate(x, y);
  if (rot) m = mmul(m, rotate(rot));
  if (s !== 1 || flip) m = mmul(m, scale(flip ? -s : s, s));
  const props = { xf: mmul(m, g.xf) };
  if (rot || s !== 1) props.cache = 'never';
  return withProps(g, props);
}

// ---------- timeline nodes ----------

// draw({ t, k, i, T, seed, W, H, CX, CY, look }) => display list
// recipe and camera are labels for `hdf board` (recipes/ set them); they do not change any frame.
export function shot(name, dur, draw, { fit = 'anchor', look, recipe, camera } = {}) {
  if (typeof name !== 'string' || !name) throw new TypeError('shot: needs a name');
  if (typeof draw !== 'function') throw new TypeError(`shot ${name}: draw must be a function`);
  fitFor(fit, format(), format());   // validates the mode
  return Object.freeze({ kind: 'shot', name, dur, n: frames(dur, `shot ${name}`), draw, fit, look, recipe, camera });
}

// Children one after another; lasts the sum of their durations.
export function seq(...kids) {
  kids = nodes(kids, 'seq');
  const n = kids.reduce((s, c) => s + c.n, 0);
  return Object.freeze({ kind: 'seq', dur: n / FPS, n, kids });
}

// Stacked; lasts as long as the longest child, shorter children hold their last frame.
export function par(...kids) {
  kids = nodes(kids, 'par');
  const n = Math.max(...kids.map((c) => c.n));
  return Object.freeze({ kind: 'par', dur: n / FPS, n, kids });
}

// The child's last frame (T - 1/12) for `dur` seconds.
export function hold(dur, child) {
  [child] = nodes([child], 'hold');
  return Object.freeze({ kind: 'hold', dur, n: frames(dur, 'hold'), child });
}

// A chapter (4.0 E1): a seq that carries a title, so the board, grid, render and lint can take a film a
// chapter at a time. Frames are the seq's own: marking a seq a chapter changes no pixel. `card` is the chapter's
// title card (the recipes' chapter() makes one with titleCard), put first; `hold` seconds of the last node's
// last frame end it. Chapters do not nest. recipes/teach.js chapter(title, ...nodes) is the author's form.
export function chapterSeq(title, kids, { card = null, hold: h = 0 } = {}) {
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('chapter: needs a title');
  kids = nodes(kids, `chapter '${title}'`);
  const inner = [];
  kids.forEach((k) => visitNodes(k, (n) => { if (n.chapter) inner.push(n.chapter.title); }));
  if (inner.length) throw new TypeError(`chapter '${title}': chapters do not nest ('${inner[0]}' is inside it)`);
  const all = [...(card ? nodes([card], `chapter '${title}' card`) : []), ...kids];
  if (h) all.push(hold(h, all.at(-1)));
  const s = seq(...all);
  return Object.freeze({ ...s, chapter: Object.freeze({ title, card: card ? all[0].name ?? null : null, hold: h }) });
}

// Every node under (and including) node, once per place it sits in the tree.
function visitNodes(node, fn) {
  fn(node);
  for (const c of [node.child, node.a, node.b, ...(node.kids ?? [])]) if (c) visitNodes(c, fn);
}

// A transition between two shots the timeline also plays: seq(a, cut('iris', 0.5, a, b), b). The cut shows `a`
// frozen at its last frame under `b` at its first, revealed by fx(kind, { p }); it does not play either shot, so
// a timeline with only the cut drops them (lint rule cut-orphan).
export function cut(kind, dur, a, b) {
  [a, b] = nodes([a, b], `cut ${kind}`);
  return Object.freeze({ kind: 'cut', fx: kind, name: `${kind}:${nameOf(a)}>${nameOf(b)}`, dur, n: frames(dur, `cut ${kind}`), a, b });
}

// A look for a subtree; the innermost look wins.
export function lookOn(look, child) {
  [child] = nodes([child], 'lookOn');
  look = typeof look === 'string' ? { name: look } : look;
  return Object.freeze({ kind: 'look', look, dur: child.dur, n: child.n, child });
}

// The film: name (seeds everything), look (a preset name or look object), timeline (a node or an array, read
// as seq), score ((cues) => synth events), format ('1:1' | '16:9' | '9:16'), assets ({ id: { src, ... } }),
// audience (4.0 T10: a key of AUDIENCES, the profile lint checks the film against; 'general' by default).
export function film({ name, look, timeline, score, format: ar = '1:1', assets = {}, audience = 'general' } = {}) {
  if (typeof name !== 'string' || !name) throw new TypeError('film: needs a name');
  if (!look) throw new TypeError(`film ${name}: needs a look`);
  try { audienceOf(audience); } catch (e) { throw new TypeError(`film ${name}: ${e.message}`); }
  if (Array.isArray(timeline)) timeline = seq(...timeline);
  [timeline] = nodes([timeline], `film ${name}`);
  return Object.freeze({
    name, look: typeof look === 'string' ? { name: look } : look, timeline, score, assets, audience,
    format: format(ar), seed: hash32(name), dur: timeline.n / FPS, n: timeline.n,
  });
}

// ---------- evaluation ----------

// Every op gets a seed from its parent's seed and its name (its index if unnamed); an explicit seed wins.
// Memoised per (op, seed) so a cel's seeded copy is the same object frame after frame (hash memo holds).
const seedMemo = new WeakMap();
export function seedList(list, parent) { return list.map((op, j) => seedOp(op, parent, j)); }
function seedOp(op, parent, j) {
  const own = op.seed ?? seedOf(parent, op.name ?? `#${j}`);
  let per = seedMemo.get(op);
  if (!per) seedMemo.set(op, (per = new Map()));
  let out = per.get(own);
  if (!out) {
    const props = { seed: own };
    if (op.kids) props.kids = seedList(op.kids, own);
    out = withProps(op, props);
    per.set(own, out);
  }
  return out;
}

// One shot at local frame k, before its fit wrap and look: { list (seeded), wrap, seed, look, env }.
// `look` is the one inherited from lookOn ancestors. Lint reads shots through this.
// A look's edition (0 by default) reseeds the shot, so another edition is another print of the same film.
export function evalShot(f, node, k, { i = 0, target = f.format, look } = {}) {
  const eff = node.look ?? look ?? f.look;
  const edition = eff?.edition ?? 0;   // presets (by name) are edition 0
  const seed = edition ? seedOf(seedOf(f.seed, node.name), `edition ${edition}`) : seedOf(f.seed, node.name);
  const { env, wrap } = fitFor(node.fit, f.format, target);
  const raw = withHand(handOf(eff), () => node.draw({ t: k / FPS, k, i, T: node.dur, seed, ...env, look: eff }));
  return { list: seedList(norm(raw), seed), wrap, seed, look: eff, env };
}

// ---------- the ghost of the shot before (4.0 L2) ----------

// Under a look with a ghost (chalkboard~ghost:0.15), each shot or hold draws the one before it in its seq, at its
// last frame, half erased: its stock dropped, the rest flattened and wiped by fx('erase', { mode: 'clear' }) to
// that alpha, laid just over the shot's own stock. Before is the sibling before it (a cut passed over, a hold of
// that sibling passed back over to what it had); the first of a seq has what its seq had. Only one shot back:
// the ghost is drawn without its own ghost. A cut shows its a with a's ghost and its b over a's.

// What kids[j] of a seq has as its ghost, as { node, look } or the seq's own (inherited).
function ghostBefore(kids, j, look, inherited) {
  const c = kids[j];
  if (c.kind === 'cut') { const i = kids.lastIndexOf(c.a, j - 1); return i >= 0 ? ghostBefore(kids, i, look, inherited) : inherited; }
  let i = j - 1;
  while (i >= 0 && kids[i].kind === 'cut') i--;
  if (i < 0) return inherited;
  if (c.kind === 'hold' && c.child === kids[i]) return ghostBefore(kids, i, look, inherited);
  return { node: kids[i], look };
}

const inv = (m) => {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
};
const isStock = (op) => op.op === 'paper' || op.op === 'night';
const noStock = (list) => list.flatMap((op) => (isStock(op) ? [] : op.kids ? [withProps(op, { kids: noStock(op.kids) })] : [op]));
// list with g laid just over its first stock, through groups (g undoing their transforms, being in screen space);
// under everything when it has none.
function overStock(list, g, m = null) {
  for (let i = 0; i < list.length; i++) {
    const op = list[i];
    if (isStock(op)) return [...list.slice(0, i + 1), m ? group({ name: 'ghost-screen', xf: inv(m) }, [g]) : g, ...list.slice(i + 1)];
    if (op.kids) {
      const mm = op.op === 'group' && op.xf ? (m ? mmul(m, op.xf) : op.xf) : m;
      const kids = overStock(op.kids, g, mm);
      if (kids) return [...list.slice(0, i), withProps(op, { kids }), ...list.slice(i + 1)];
    }
  }
  return null;
}
function withGhost(list, ctx, alpha) {
  const { node, look } = ctx.ghost;
  const sub = { ...ctx, hit: null, ghost: null };
  const seed = seedOf(ctx.film.seed, `ghost:${nameOf(node)}`);
  const g = group({ name: 'ghost', seed }, [fx('erase', { p: 1, mode: 'clear', ghost: alpha, eraser: false }, noStock(evalNode(node, node.n - 1, sub, look)), { seed })]);
  return overStock(list, g) ?? [g, ...list];
}

function evalNode(node, k, ctx, look) {
  switch (node.kind) {
    case 'shot': {
      const own = node.look ?? look;
      const s = evalShot(ctx.film, node, k, { i: ctx.i, target: ctx.target, look });
      let list = s.wrap(s.list, s.seed);
      const ga = ctx.ghost ? ghostOf(s.look) : 0;
      if (ga > 0) list = withGhost(list, ctx, ga);
      if (own) list = [lookNode(own, list)];
      ctx.hit ??= { name: node.name, k, look: s.look };
      return list;
    }
    case 'seq': {
      for (let j = 0; j < node.kids.length; j++) {
        const c = node.kids[j];
        if (k < c.n) {
          const g0 = ctx.ghost;
          ctx.ghost = ghostBefore(node.kids, j, look, g0 ?? null);
          try { return evalNode(c, k, ctx, look); } finally { ctx.ghost = g0; }
        }
        k -= c.n;
      }
      throw new RangeError('seq: frame past the end');
    }
    case 'par': {
      const g0 = ctx.ghost;
      try { return node.kids.flatMap((c, j) => { ctx.ghost = j ? null : g0; return evalNode(c, Math.min(k, c.n - 1), ctx, look); }); } finally { ctx.ghost = g0; }
    }
    case 'hold': return evalNode(node.child, node.child.n - 1, ctx, look);
    case 'cut': {
      const sub = { ...ctx, hit: null };
      const la = evalNode(node.a, node.a.n - 1, sub, look);
      sub.ghost = { node: node.a, look };
      const lb = evalNode(node.b, 0, sub, look);
      const seed = seedOf(ctx.film.seed, node.name);
      ctx.hit ??= { name: node.name, k, look: sub.hit?.look ?? look ?? ctx.film.look };
      // p runs strictly inside (0, 1): the first cut frame already moves off `a`, the last is not yet all `b`.
      return [group({ name: nameOf(node.a), seed }, la), fx(node.fx, { p: (k + 1) / (node.n + 1) }, lb, { seed: seedOf(seed, 'fx') })];
    }
    case 'look': return evalNode(node.child, k, ctx, node.look);
    default: throw new TypeError(`unknown timeline node '${node.kind}'`);
  }
}

// frame(film, i, { ar }) => { list, look, shot, t, k } for drawn frame i (0 <= i < film.n). An excerpt's frame
// i is its whole film's frame from + i, drawn exactly as the whole film draws it (shots see the whole film's i).
export function frame(f, i, { ar } = {}) {
  if (!Number.isInteger(i) || i < 0 || i >= f.n) throw new RangeError(`frame ${i} outside 0..${f.n - 1} of film ${f.name}`);
  const g = i + (f.from ?? 0);
  const ctx = { film: f, i: g, target: ar ? format(ar) : f.format, hit: null };
  const list = evalNode(f.timeline, g, ctx, undefined);
  const { name, k, look } = ctx.hit;
  return { list, look, shot: name, t: k / FPS, k };
}

// ---------- chapters and excerpts ----------

// chapters(film) => [{ n, title, card, f0, frames, t0, dur, node }] in the order they play (n from 1): every
// chapter() in the tree, where it starts in the whole film and how long it lasts. A film with none has [].
// A chapter inside a par starts where the par does; one held or cut into is not a play of its own.
export function chapters(f) {
  const out = [];
  const visit = (node, f0) => {
    if (node.chapter) {
      out.push({ n: out.length + 1, title: node.chapter.title, card: node.chapter.card, f0, frames: node.n, t0: f0 / FPS, dur: node.n / FPS, node });
      return;
    }
    switch (node.kind) {
      case 'seq': { let at = f0; for (const c of node.kids) { visit(c, at); at += c.n; } break; }
      case 'par': node.kids.forEach((c) => visit(c, f0)); break;
      case 'look': visit(node.child, f0); break;
      default: break;
    }
  };
  visit(f.timeline, 0);
  return out;
}

// The chapter a whole-film frame falls in, or null (a title before the first, the sign-off after the last).
export function chapterAt(f, i, list = chapters(f)) {
  return list.find((c) => i >= c.f0 && i < c.f0 + c.frames) ?? null;
}

// excerpt(film, f0, n): frames f0 .. f0 + n - 1 of the film as a film of n frames. Its frames are the whole
// film's, pixel for pixel; `from` says where it starts, `whole` is the film it came from (for the score).
export function excerpt(f, f0, n) {
  const whole = f.whole ?? f, at = (f.from ?? 0) + f0;
  if (!Number.isInteger(f0) || !Number.isInteger(n) || f0 < 0 || n < 1 || f0 + n > f.n) throw new RangeError(`excerpt ${f0}+${n} outside 0..${f.n} of film ${f.name}`);
  return Object.freeze({ ...f, n, dur: n / FPS, from: at, whole });
}

// chapterFilm(film, k): chapter k (from 1) as an excerpt, with `chapter` the entry chapters() gives.
export function chapterFilm(f, k) {
  const all = chapters(f);
  if (!all.length) throw new RangeError(`film ${f.name} has no chapters`);
  const c = all[k - 1];
  if (!Number.isInteger(k) || !c) throw new RangeError(`film ${f.name} has chapters 1..${all.length}, not ${k}`);
  return Object.freeze({ ...excerpt(f, c.f0, c.frames), chapter: c });
}

// An excerpt's cues in its own time: what overlaps its window, shifted so it starts at 0 (a shot or chapter
// under way at the start keeps its whole length, starting before 0). The whole film's cues for a whole film.
export function localCues(f) {
  const c = cues(f), t0 = (f.from ?? 0) / FPS, t1 = t0 + f.n / FPS, eps = 1e-9;
  if (!f.whole) return c;
  const within = (x) => x.t0 < t1 - eps && x.t0 + x.dur > t0 + eps;
  return {
    shots: c.shots.filter(within).map((s) => ({ ...s, t0: s.t0 - t0 })),
    cuts: c.cuts.filter((t) => t > t0 + eps && t < t1 - eps).map((t) => t - t0),
    chapters: c.chapters.filter(within).map((x) => ({ ...x, t0: x.t0 - t0 })),
    end: f.n / FPS,
  };
}

// ---------- artefacts ----------

// { shots: [{ name, t0, dur, hold?, cut? }], cuts: [t], chapters: [{ n, title, t0, dur }], end }. Times come from
// frame counts, so they sit on the grid. An excerpt's cues are its whole film's (the score is the whole film's).
export function cues(f) {
  f = f.whole ?? f;
  const shots = [], cuts = new Set();
  const visit = (node, f0) => {
    const t0 = f0 / FPS, dur = node.n / FPS;
    switch (node.kind) {
      case 'shot': shots.push({ name: node.name, t0, dur }); break;
      case 'seq': { let at = f0; node.kids.forEach((c, j) => { if (j) cuts.add(at); visit(c, at); at += c.n; }); break; }
      case 'par': node.kids.forEach((c) => visit(c, f0)); break;
      case 'hold': shots.push({ name: nameOf(node.child), t0, dur, hold: true }); break;
      case 'cut': shots.push({ name: node.name, t0, dur, cut: node.fx }); break;
      case 'look': visit(node.child, f0); break;
    }
  };
  visit(f.timeline, 0);
  const chaps = chapters(f).map((c) => ({ n: c.n, title: c.title, t0: c.t0, dur: c.dur }));
  return { shots, cuts: [...cuts].sort((a, b) => a - b).map((x) => x / FPS), chapters: chaps, end: f.n / FPS };
}

const sec = (n) => `${(n / FPS).toFixed(2)}s`;
const lookName = (l) => (l ? l.name ?? '(anonymous)' : '');

// Cel names a shot uses, from its first and last frame.
function celsOf(node, f, f0, ks) {
  const names = new Set();
  try {
    for (const k of ks) {
      walk(evalNode(node, k, { film: f, i: f0 + k, target: f.format, hit: null }, undefined), (op) => { if (op.cel) names.add(op.cel); });
    }
  } catch (e) {
    return `(draw failed: ${e.message})`;
  }
  return names.size ? [...names].join(', ') : '-';
}

// Indented text: the tree with durations and spans, cels per shot, then the cues.
export function describe(f) {
  const out = [`film ${f.name}  ${sec(f.n)}  ${f.n} frames @${FPS}  ${f.format.ar} ${f.format.W}x${f.format.H}  look ${lookName(f.look)}`];
  const span = (f0, n) => `[${(f0 / FPS).toFixed(2)}-${((f0 + n) / FPS).toFixed(2)}]`;
  let chapterNo = 0;
  const visit = (node, f0, depth, ks) => {
    const pad = '  '.repeat(depth + 1), head = `${pad}${node.kind.padEnd(5)}`;
    switch (node.kind) {
      case 'shot': {
        const extra = [node.fit !== 'anchor' && `fit ${node.fit}`, node.look && `look ${lookName(node.look)}`].filter(Boolean).join('  ');
        const at = ks ?? [...new Set([0, node.n - 1])];
        out.push(`${head} ${node.name}  ${sec(node.n)}  ${node.n}f  ${span(f0, node.n)}${extra ? '  ' + extra : ''}  cels: ${celsOf(node, f, f0, at)}`);
        break;
      }
      case 'seq': case 'par': {
        const ch = node.chapter ? `  chapter ${++chapterNo} '${node.chapter.title}'` : '';
        out.push(`${head} ${sec(node.n)}  ${node.n}f  ${span(f0, node.n)}${ch}`);
        let at = f0;
        for (const c of node.kids) { visit(c, at, depth + 1, ks); if (node.kind === 'seq') at += c.n; }
        break;
      }
      case 'hold':
        out.push(`${head} ${sec(node.n)}  ${node.n}f  ${span(f0, node.n)}  last frame of:`);
        visit(node.child, f0, depth + 1, node.child.kind === 'shot' ? [node.child.n - 1] : null);
        break;
      case 'cut':
        out.push(`${head} ${node.fx}  ${sec(node.n)}  ${node.n}f  ${span(f0, node.n)}  ${nameOf(node.a)} (last) -> ${nameOf(node.b)} (first)`);
        break;
      case 'look':
        out.push(`${head} ${lookName(node.look)}`);
        visit(node.child, f0, depth + 1, ks);
        break;
    }
  };
  visit(f.timeline, 0, 0, null);
  const c = cues(f);
  out.push(`cuts  ${c.cuts.length ? c.cuts.map((t) => t.toFixed(2)).join('  ') : '-'}`);
  out.push(`end   ${c.end.toFixed(2)}`);
  return out.join('\n');
}

// The same film under another root look (a preset name or a look object). Shots and lookOn()s that name
// their own look keep it. `hdf ... --look <name>` uses this.
export function withRootLook(f, look) {
  return Object.freeze({ ...f, look: typeof look === 'string' ? { name: look } : look });
}

// The same film with fn over every look it pins: the root, every lookOn() and every shot that names one.
// `--look 'preset~from:teapot'` uses this, because a modifier is a change of palette rather than another
// look: a shot that pins its own sheet keeps it, repainted. Nothing else about the tree moves.
export function mapLooks(f, fn) {
  const node = (n) => {
    const own = n.look ? { look: fn(n.look) } : null;
    switch (n.kind) {
      case 'shot': return own ? Object.freeze({ ...n, ...own }) : n;
      case 'look': return Object.freeze({ ...n, ...own, child: node(n.child) });
      case 'seq': case 'par': return Object.freeze({ ...n, kids: n.kids.map(node) });
      case 'hold': return Object.freeze({ ...n, child: node(n.child) });
      case 'cut': return Object.freeze({ ...n, a: node(n.a), b: node(n.b) });
      default: return n;
    }
  };
  return Object.freeze({ ...f, look: fn(f.look), timeline: node(f.timeline) });
}
