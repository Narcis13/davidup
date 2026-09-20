// The time tree. Cels are timeless drawings, shots are drawings over time, and seq/par/hold/cut/lookOn
// arrange them. frame(film, i) is the one entry point the rasteriser and lint use.
import { FPS } from './curves.js';
import { fitFor, format } from './fit.js';
import { fx, group, lookNode, mmul, norm, rotate, scale, translate, walk, withProps } from './list.js';
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

// cel(name, draw, { box, inputs: { key: [min, max, step] }, desc }) => (inputs = {}) => group op.
// Continuous inputs are quantised before drawing so a wing angle does not defeat the cache; the same
// quantised inputs return the same (frozen) group object.
export function cel(name, draw, { box, inputs = {}, desc } = {}) {
  if (typeof name !== 'string' || !name) throw new TypeError('cel: needs a name');
  if (typeof draw !== 'function') throw new TypeError(`cel ${name}: draw must be a function`);
  const memo = new Map();
  const make = (given = {}) => {
    const q = {};
    for (const k of Object.keys(given).sort()) q[k] = quantise(given[k], inputs[k]);
    const key = JSON.stringify(q);
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

// A transition: `a` frozen at its last frame under `b` at its first, revealed by fx(kind, { p }).
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
// as seq), score ((cues) => synth events), format ('1:1' | '16:9' | '9:16'), assets ({ id: { src, ... } }).
export function film({ name, look, timeline, score, format: ar = '1:1', assets = {} } = {}) {
  if (typeof name !== 'string' || !name) throw new TypeError('film: needs a name');
  if (!look) throw new TypeError(`film ${name}: needs a look`);
  if (Array.isArray(timeline)) timeline = seq(...timeline);
  [timeline] = nodes([timeline], `film ${name}`);
  return Object.freeze({
    name, look: typeof look === 'string' ? { name: look } : look, timeline, score, assets,
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
  const raw = node.draw({ t: k / FPS, k, i, T: node.dur, seed, ...env, look: eff });
  return { list: seedList(norm(raw), seed), wrap, seed, look: eff, env };
}

function evalNode(node, k, ctx, look) {
  switch (node.kind) {
    case 'shot': {
      const own = node.look ?? look;
      const s = evalShot(ctx.film, node, k, { i: ctx.i, target: ctx.target, look });
      let list = s.wrap(s.list, s.seed);
      if (own) list = [lookNode(own, list)];
      ctx.hit ??= { name: node.name, k, look: s.look };
      return list;
    }
    case 'seq': {
      for (const c of node.kids) { if (k < c.n) return evalNode(c, k, ctx, look); k -= c.n; }
      throw new RangeError('seq: frame past the end');
    }
    case 'par': return node.kids.flatMap((c) => evalNode(c, Math.min(k, c.n - 1), ctx, look));
    case 'hold': return evalNode(node.child, node.child.n - 1, ctx, look);
    case 'cut': {
      const sub = { ...ctx, hit: null };
      const la = evalNode(node.a, node.a.n - 1, sub, look);
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

// frame(film, i, { ar }) => { list, look, shot, t, k } for drawn frame i (0 <= i < film.n).
export function frame(f, i, { ar } = {}) {
  if (!Number.isInteger(i) || i < 0 || i >= f.n) throw new RangeError(`frame ${i} outside 0..${f.n - 1} of film ${f.name}`);
  const ctx = { film: f, i, target: ar ? format(ar) : f.format, hit: null };
  const list = evalNode(f.timeline, i, ctx, undefined);
  const { name, k, look } = ctx.hit;
  return { list, look, shot: name, t: k / FPS, k };
}

// ---------- artefacts ----------

// { shots: [{ name, t0, dur, hold?, cut? }], cuts: [t], end }. Times come from frame counts, so they sit on the grid.
export function cues(f) {
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
  return { shots, cuts: [...cuts].sort((a, b) => a - b).map((x) => x / FPS), end: f.n / FPS };
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
        out.push(`${head} ${sec(node.n)}  ${node.n}f  ${span(f0, node.n)}`);
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
