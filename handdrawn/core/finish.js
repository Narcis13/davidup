// Finishes as geometry. expand(list, look, env) is a list-to-list pass run before rasterising:
//   fill{finish:true} -> the flat fill plus the look's texture clipped to it (hatch strokes, grain specks)
//   paper / night     -> the stock: a frame fill, light bands, grain, drawn in screen space
//   text              -> hand-lettered strokes (text.js)
// Output is still a plain display list, so it hashes, projects and serialises like the input.
// This phase: hatch, graphite and grain. halftone, dots and wash land in P5 (they draw flat until then).
import { clip, group, fill, rect, stroke, withProps, xf as xfPath, mkPath } from './list.js';
import { hashLook, resolveLook } from './looks.js';
import { rng } from './rand.js';
import { handText } from './text.js';
import { seedList } from './tree.js';

// { op: 'specks', rects: [x, y, w, h, ...], role, alpha }: grain as explicit rectangles.
const specks = (rects, role, alpha) => Object.freeze({ op: 'specks', rects, role, alpha });

// n speckles scattered over box (v1 grain).
function grain(box, n, role, alpha, seed, size) {
  const r = rng(seed), [bx, by, bw, bh] = box, rects = new Array(n * 4);
  for (let i = 0; i < n; i++) {
    rects[4 * i] = bx + r() * bw; rects[4 * i + 1] = by + r() * bh;
    rects[4 * i + 2] = size * (0.4 + r()); rects[4 * i + 3] = size * (0.4 + r());
  }
  return specks(rects, role, alpha);
}

// Short parallel strokes across the box at an angle (v1 hatch), as one stroke op with many subs.
function hatch(box, { angle, gap, len, jitter, role, alpha, w, seed }) {
  const r = rng(seed), [bx, by, bw, bh] = box, cx = bx + bw / 2, cy = by + bh / 2, R = Math.hypot(bw, bh) / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle), sub = [];
  for (let v = -R; v <= R; v += gap) for (let u = -R; u <= R; u += len * 1.7) {
    const uu = u + (r() - 0.5) * jitter * 2, L = len * (0.6 + r() * 0.8);
    const x0 = cx + ca * uu - sa * v + (r() - 0.5) * jitter * 0.6, y0 = cy + sa * uu + ca * v + (r() - 0.5) * jitter * 0.6;
    sub.push({ pts: [x0, y0, x0 + ca * L, y0 + sa * L], closed: false });
  }
  return stroke(mkPath(sub), role, { w, wobble: 0, alpha, seed, name: 'hatch' });
}

// Texture per finish, as ops in the fill's own coordinates. Parameters are v1 surface()'s.
const FINISH = {
  hatch: (box, role, seed, o) => [
    hatch(box, { angle: o.angle ?? 1.2, gap: o.gap ?? 4.5, len: o.len ?? 9, jitter: 3, role, alpha: o.alpha ?? 0.35, w: o.width ?? 1, seed }),
    grain(box, o.grain ?? 140, role, 0.35, seed + 1, 1.4),
  ],
  graphite: (box, role, seed, o) => [
    hatch(box, { angle: o.angle ?? 1.1, gap: o.gap ?? 9, len: o.len ?? 30, jitter: 4, role, alpha: o.alpha ?? 0.22, w: 0.7, seed }),
    grain(box, o.grain ?? 40, role, 0.3, seed + 1, 1.2),
  ],
};

// A finished fill: flat colour, then the texture clipped to the same path. `finish` on the op may name
// a finish or carry options ({ angle, gap, len, grain, role }); `true` takes the look's.
function finished(op, look) {
  const { finish, ...rest } = op;
  const flat = Object.freeze(rest), o = typeof finish === 'object' ? finish : {};
  const kind = o.kind ?? (typeof finish === 'string' ? finish : look.finish);
  const make = FINISH[kind];
  if (!make) return [flat];   // halftone, dots, wash: P5
  return [flat, clip(op.path, make(op.path.box, o.role ?? 'shade', op.seed ?? 1, o))];
}

// The stock, in screen space: frame fill, bands at -45 degrees (paper: 'bands'), grain scaled to the area.
function stock(op, look, { W, H }, dark) {
  const p = look.palette, frame = [-2, -2, W + 4, H + 4], area = (W * H) / (1080 * 1080), seed = op.seed ?? 5;
  const kids = [fill(rect(...frame), dark ? 'night' : 'paper', { name: 'stock' })];
  if (dark) {
    kids.push(grain(frame, Math.round(400 * area), { base: 'night', tint: 1 }, 0.5, seed, 1.6));
  } else {
    if (look.paper === 'bands' && p.paperBand) {
      const half = Math.hypot(W, H) / 2 + 80, n = Math.ceil(half / 160), c = Math.cos(-Math.PI / 4), s = Math.sin(-Math.PI / 4);
      const m = [c, s, -s, c, W / 2, H / 2], sub = [];
      for (let i = -n; i <= n; i++) sub.push(...xfPath(rect(-half, i * 160 - 40, 2 * half, 80), m).sub);
      kids.push(fill(mkPath(sub), 'paperBand', { name: 'bands' }));
    }
    kids.push(grain(frame, Math.round(1400 * area), { base: 'paper', shade: 0.5 }, 0.06, seed, 1.6));
  }
  return group({ name: dark ? 'night' : 'paper', screen: true, seed }, kids);
}

// Expansions are memoised per (op, look, frame size) so an unchanged op expands to the same object.
const memo = new WeakMap();
function remember(op, key, make) {
  let per = memo.get(op);
  if (!per) memo.set(op, (per = new Map()));
  let out = per.get(key);
  if (!out) { out = make(); if (per.size > 16) per.clear(); per.set(key, out); }
  return out;
}

export function expand(list, look, { W = 1080, H = 1080 } = {}) {
  const run = (ops, lk) => {
    const key = `${hashLook(lk)}:${W}x${H}`;
    let changed = false;
    const out = ops.flatMap((op) => {
      const next = one(op, lk, key);
      if (next.length !== 1 || next[0] !== op) changed = true;
      return next;
    });
    return changed ? out : ops;
  };
  const one = (op, lk, key) => {
    switch (op.op) {
      case 'paper': return [remember(op, key, () => stock(op, lk, { W, H }, lk.paper === 'night'))];
      case 'night': return [remember(op, key, () => stock(op, lk, { W, H }, true))];
      case 'fill': return op.finish ? remember(op, key, () => finished(op, lk)) : [op];
      case 'text': return remember(op, key, () => {
        const g = handText(op);
        return [withProps(g, { kids: seedList(g.kids, op.seed ?? 1) })];
      });
      case 'look': {
        const inner = resolveLook(op.look), kids = run(op.kids, inner);
        return [kids === op.kids ? op : withProps(op, { kids })];
      }
      default: {
        if (!op.kids) return [op];
        const kids = remember(op, key, () => run(op.kids, lk));
        return [kids === op.kids ? op : remember(op, key + ':op', () => withProps(op, { kids }))];
      }
    }
  };
  return run(Array.isArray(list) ? list : [list], resolveLook(look));
}

