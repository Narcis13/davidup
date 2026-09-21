// Finishes as geometry. expand(list, look, env) is a list-to-list pass run before rasterising:
//   fill{finish:true} -> the flat fill plus the look's texture clipped to it (hatch strokes, grain specks)
//   paper / night     -> the stock: a frame fill, light bands, grain, drawn in screen space
//   text              -> hand-lettered strokes (text.js)
//   a puppet's cel    -> card on a table (puppet.js asCutout), only under a look with a `cutout` field
// Output is still a plain display list, so it hashes, projects and serialises like the input.
// Finishes: hatch (ink), halftone (riso), dots (screen), graphite (pencil), wash (doodle watercolour).
// Riso plates are list helpers here too: plate() is the v1 plate + printPlate model as data, a dots op whose
// coverage is evaluated per cell centre from painter-ordered shapes; knockout() is a cov 0 shape.
import { clip, dots, group, fill, hashOp, inside, rect, stroke, translate, withProps, xf as xfPath, mkPath, norm } from './list.js';
import { hashLook, parse as parseColour, resolveLook } from './looks.js';
import { asCutout, cutoutOf } from './puppet.js';
import { rng } from './rand.js';
import { handText } from './text.js';
import { reveal } from './tools.js';
import { seedList } from './tree.js';

// { op: 'specks', rects: [x, y, w, h, ...], role, alpha }: grain as explicit rectangles.
const specks = (rects, role, alpha) => Object.freeze({ op: 'specks', rects, role, alpha });

// n speckles scattered over box (v1 grain). A list helper too: clip it to a path for a textured area.
export function grain(box, n, role, alpha, seed, size) {
  const r = rng(seed), [bx, by, bw, bh] = box, rects = new Array(n * 4);
  for (let i = 0; i < n; i++) {
    rects[4 * i] = bx + r() * bw; rects[4 * i + 1] = by + r() * bh;
    rects[4 * i + 2] = size * (0.4 + r()); rects[4 * i + 3] = size * (0.4 + r());
  }
  return specks(rects, role, alpha);
}

// Short parallel strokes across the box at an angle (v1 hatch), as one stroke op with many subs.
export function hatch(box, { angle, gap, len, jitter, role, alpha, w, seed }) {
  const r = rng(seed), [bx, by, bw, bh] = box, cx = bx + bw / 2, cy = by + bh / 2, R = Math.hypot(bw, bh) / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle), sub = [];
  for (let v = -R; v <= R; v += gap) for (let u = -R; u <= R; u += len * 1.7) {
    const uu = u + (r() - 0.5) * jitter * 2, L = len * (0.6 + r() * 0.8);
    const x0 = cx + ca * uu - sa * v + (r() - 0.5) * jitter * 0.6, y0 = cy + sa * uu + ca * v + (r() - 0.5) * jitter * 0.6;
    sub.push({ pts: [x0, y0, x0 + ca * L, y0 + sa * L], closed: false });
  }
  return stroke(mkPath(sub), role, { w, wobble: 0, alpha, seed, name: 'hatch' });
}

// Hatching clipped to a path (v1 hatch(c, path, box, o)): a light or shadow patch laid over a fill.
export const hatchIn = (path, { angle = 0.9, gap = 7, len = 14, jitter = 6, role = 'ink', alpha = 0.35, w = 1.2, seed = 1 } = {}) =>
  clip(path, [hatch(path.box, { angle, gap, len, jitter, role, alpha, w, seed })]);

// ---------- coverage (riso density, gradients as data) ----------

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Distance from (x, y) to the nearest segment of a path.
function distTo(path, x, y) {
  let best = Infinity;
  for (const s of path.sub) {
    const p = s.pts, n = p.length / 2, segs = s.closed ? n : n - 1;
    if (n === 1) best = Math.min(best, Math.hypot(x - p[0], y - p[1]));
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n, ax = p[2 * i], ay = p[2 * i + 1], dx = p[2 * j] - ax, dy = p[2 * j + 1] - ay, L = dx * dx + dy * dy;
      const u = L ? clamp01(((x - ax) * dx + (y - ay) * dy) / L) : 0;
      best = Math.min(best, Math.hypot(x - ax - u * dx, y - ay - u * dy));
    }
  }
  return best;
}

const inBox = (b, x, y, pad = 0) => x >= b[0] - pad && y >= b[1] - pad && x <= b[0] + b[2] + pad && y <= b[1] + b[3] + pad;

// cov at a point: a number, { kind: 'radial', x, y, r0 = 0, r1, c0 = 1, c1 = 0 },
// { kind: 'linear', x0, y0, x1, y1, c0 = 1, c1 = 0 } or { kind: 'plate', shapes: [{ path, cov, w? }], base = 0 }
// (painter's order: the last shape containing the point wins; a shape with w is a stroke of that width).
export function covAt(cov, x, y) {
  if (cov === undefined || cov === null) return 1;
  if (typeof cov === 'number') return cov;
  switch (cov.kind) {
    case 'radial': {
      const r0 = cov.r0 ?? 0, u = clamp01((Math.hypot(x - cov.x, y - cov.y) - r0) / Math.max(1e-9, cov.r1 - r0));
      return (cov.c0 ?? 1) + ((cov.c1 ?? 0) - (cov.c0 ?? 1)) * u;
    }
    case 'linear': {
      const dx = cov.x1 - cov.x0, dy = cov.y1 - cov.y0, u = clamp01(((x - cov.x0) * dx + (y - cov.y0) * dy) / Math.max(1e-9, dx * dx + dy * dy));
      return (cov.c0 ?? 1) + ((cov.c1 ?? 0) - (cov.c0 ?? 1)) * u;
    }
    case 'plate': {
      const sh = cov.shapes;
      for (let j = sh.length - 1; j >= 0; j--) {
        const { path, w } = sh[j];
        if (!inBox(path.box, x, y, w ? w / 2 : 0)) continue;
        if (w ? distTo(path, x, y) <= w / 2 : inside(path, x, y)) return covAt(sh[j].cov, x, y);
      }
      return cov.base ?? 0;
    }
    default: throw new Error(`cov: unknown kind '${cov.kind}' (expected a number, radial, linear or plate)`);
  }
}
// Coverage falling from c0 at radius r0 to c1 at r1 about (x, y): the only gradient, printed as dot size.
export const radial = (x, y, r0, r1, c0 = 1, c1 = 0) => ({ kind: 'radial', x, y, r0, r1, c0, c1 });
// Coverage from c0 at (x0, y0) to c1 at (x1, y1).
export const linear = (x0, y0, x1, y1, c0 = 1, c1 = 0) => ({ kind: 'linear', x0, y0, x1, y1, c0, c1 });

// ---------- riso plates ----------

// A plate: one ink's coverage over box, printed as a rotated halftone screen and multiplied onto what is
// under it (v1 plate + printPlate). kids are fill ops (their cov, default 1, is the ink's coverage there)
// and stroke ops (a band of the stroke's width); later kids cover earlier ones, so knockout(path) clears.
export function plate(role, kids, { box = [0, 0, 1080, 1080], cell = 7, angle = 0.26, jitter = 0.2, maxCov = 0.78, alpha = 0.95, seed, name } = {}) {
  const shapes = norm(kids).map((op) => {
    if (op.op === 'fill') return { path: op.path, cov: op.cov ?? 1 };
    if (op.op === 'stroke') return { path: op.path, cov: op.cov ?? 1, w: op.w ?? 2 };
    throw new TypeError(`plate: kids are fill or stroke ops, got '${op.op}'`);
  });
  const o = { cell, angle, jitter, maxCov, alpha, blend: 'multiply', cov: { kind: 'plate', shapes }, name: name ?? `plate:${typeof role === 'string' ? role : 'ink'}` };
  if (seed !== undefined) o.seed = seed;
  return dots(rect(...box), role, o);
}
// White on this plate: nothing printed inside the path.
export const knockout = (path) => fill(path, 'paper', { cov: 0 });

// Ink indices ordered for printing: lightest first, darkest last (the darkest plate sits on top).
export function plateOrder(look, idx) {
  const inks = resolveLook(look).palette.inks, lum = (c) => { const [r, g, b] = parseColour(c); return 0.299 * r + 0.587 * g + 0.114 * b; };
  return [...(idx ?? inks.map((_, i) => i))].sort((a, b) => lum(inks[b % inks.length]) - lum(inks[a % inks.length]) || a - b);
}

// ---------- watercolour and body colour ----------

// wash: watercolour off register from the line, soft edge, darker rim; multiplied onto the paper (v1 wash).
// blend 'wash' multiplies, except in nightShot's chalk pass where it goes source-over at 0.6.
export function wash(path, role, { al = 0.5, off = 5, seed = 1, rim = true, blend = 'wash', name = 'wash' } = {}) {
  if (al <= 0) return null;
  const r = rng(seed), dx = (r() - 0.5) * 2 * off, dy = (r() - 0.5) * 2 * off, kids = [fill(path, role, { alpha: al * 0.55, blend })];
  for (let k = 0; k < 4; k++) kids.push(fill(xfPath(path, translate((r() - 0.5) * 7, (r() - 0.5) * 7)), role, { alpha: al * 0.17, blend }));
  if (rim) kids.push(stroke(path, role, { w: 2.2, wobble: 0, alpha: al * 0.3, blend }));
  return group({ name, xf: translate(dx, dy) }, kids);
}
// gouache: opaque body colour, so a drawing reads on top of a photo.
export const gouache = (path, role = 'light', al = 0.97) => fill(path, role, { alpha: al, name: 'gouache' });

// Texture per finish, as ops in the fill's own coordinates. Parameters are v1 surface()'s.
const INK_ANGLES = [0.26, 1.31, 0, 0.79];
const angleFor = (role, o, dflt) => o.angle ?? (typeof role === 'string' && role.startsWith('inks.') ? INK_ANGLES[+role.slice(5) % 4] : dflt);
const FINISH = {
  hatch: (box, role, seed, o) => [
    hatch(box, { angle: o.angle ?? 1.2, gap: o.gap ?? 4.5, len: o.len ?? 9, jitter: 3, role, alpha: o.alpha ?? 0.35, w: o.width ?? 1, seed }),
    grain(box, o.grain ?? 140, role, 0.35, seed + 1, 1.4),
  ],
  graphite: (box, role, seed, o) => [
    hatch(box, { angle: o.angle ?? 1.1, gap: o.gap ?? 9, len: o.len ?? 30, jitter: 4, role, alpha: o.alpha ?? 0.22, w: 0.7, seed }),
    grain(box, o.grain ?? 40, role, 0.3, seed + 1, 1.2),
  ],
  // riso: a rotated halftone screen with a little jitter (per-ink angle for inks.N roles; plate() multiplies)
  halftone: (box, role, seed, o, cov) => [
    dots(rect(...box), role, { cell: o.cell ?? 7, angle: angleFor(role, o, 0.26), jitter: 0.35, cov: cov ?? o.density ?? 0.5, alpha: o.alpha ?? 0.9, seed, name: 'halftone' }),
  ],
  // screen print: a regular straight dot grid
  dots: (box, role, seed, o, cov) => [
    dots(rect(...box), role, { cell: o.cell ?? 6, angle: o.angle ?? 0, jitter: 0.06, cov: cov ?? o.density ?? 0.5, alpha: o.alpha ?? 0.9, seed, name: 'screen' }),
  ],
};

// A finished fill: flat colour, then the texture clipped to the same path. `finish` on the op may name
// a finish or carry options ({ angle, gap, len, grain, role }); `true` takes the look's.
// A finished fill's cov is the texture's density, not the flat colour's alpha. wash replaces the flat fill.
function finished(op, look) {
  const { finish, cov, ...rest } = op;
  const flat = Object.freeze(rest), o = typeof finish === 'object' ? finish : {};
  const kind = o.kind ?? (typeof finish === 'string' ? finish : look.finish), seed = op.seed ?? 1;
  if (kind === 'wash') return [wash(op.path, op.role, { al: o.alpha ?? cov ?? 0.5, off: o.off ?? 5, seed, rim: o.rim ?? true })];
  if (kind === 'flat') return [flat];
  const make = FINISH[kind];
  if (!make) throw new Error(`finish '${kind}' is unknown (expected hatch, halftone, dots, graphite, wash or flat)`);
  return [flat, clip(op.path, make(op.path.box, o.role ?? 'shade', seed, o, cov))];
}

// The stock, in screen space: frame fill, bands at -45 degrees (paper: 'bands'), grain scaled to the area;
// card (paper: 'card') is heavier, with coarser grain and a few fibres.
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
    if (look.paper === 'card') {
      kids.push(grain(frame, Math.round(2600 * area), { base: 'paper', shade: 0.4 }, 0.08, seed + 1, 2.4));
      kids.push(grain(frame, Math.round(900 * area), 'light', 0.35, seed + 2, 2));
    }
    kids.push(grain(frame, Math.round(1400 * area), { base: 'paper', shade: 0.5 }, 0.06, seed, 1.6));
  }
  return group({ name: dark ? 'night' : 'paper', screen: true, seed }, kids);
}

// Expansions are memoised per (op, look, frame size) so an unchanged op expands to the same object.
// Groups by identity; leaves (paper, fills, text) by content hash, because a shot's draw rebuilds them
// every frame and the rasteriser keys its layer cache on the expanded object's (memoised) hash.
const memo = new WeakMap();
function remember(op, key, make) {
  let per = memo.get(op);
  if (!per) memo.set(op, (per = new Map()));
  let out = per.get(key);
  if (!out) { out = make(); if (per.size > 16) per.clear(); per.set(key, out); }
  return out;
}
// LRU capped by entries and by a rough size (points + specks), so a finished fill that moves every frame
// cannot grow it to gigabytes; each render worker holds its own.
const byHash = new Map();
const LEAF_MAX = 4096, LEAF_BUDGET = 24e6;   // ~24M numbers (~200 MB of arrays) at most
let leafSize = 0;
const sizeOf = (ops) => {
  let n = 0;
  const walk = (op) => {
    if (op.path) for (const s of op.path.sub) n += s.pts.length;
    if (op.rects) n += op.rects.length;
    if (op.kids) op.kids.forEach(walk);
  };
  (Array.isArray(ops) ? ops : [ops]).forEach(walk);
  return n;
};
function rememberLeaf(op, key, make) {
  const k = `${hashOp(op)}:${key}`;
  let hit = byHash.get(k);
  if (hit) { byHash.delete(k); byHash.set(k, hit); return hit.out; }   // refresh LRU position
  const out = make(), n = sizeOf(out);
  byHash.set(k, { out, n });
  leafSize += n;
  while (byHash.size > 1 && (byHash.size > LEAF_MAX || leafSize > LEAF_BUDGET)) {
    const [old, v] = byHash.entries().next().value;
    byHash.delete(old);
    leafSize -= v.n;
  }
  return out;
}

const envKey = (lk, W, H) => `${hashLook(lk)}:${W}x${H}`;

// One op, one level: leaves that need expanding become drawable ops, everything else passes through
// unchanged (the rasteriser recurses into kids itself). Returns a list.
export function expandOp(op, look, { W = 1080, H = 1080 } = {}) {
  const lk = resolveLook(look), key = envKey(lk, W, H);
  switch (op.op) {
    case 'paper': return [rememberLeaf(op, key, () => stock(op, lk, { W, H }, lk.paper === 'night'))];
    case 'night': return [rememberLeaf(op, key, () => stock(op, lk, { W, H }, true))];
    case 'fill': return op.finish ? rememberLeaf(op, key, () => finished(op, lk)) : [op];
    case 'text': return rememberLeaf(op, key, () => {
      const g = handText(op), seeded = withProps(g, { kids: seedList(g.kids, op.seed ?? 1) });
      return [op.p != null && op.p < 1 ? reveal(op.p, seeded) : seeded];   // p: set by reveal() on a text op
    });
    case 'group': return lk.cutout && cutoutOf(op) ? [remember(op, key + ':cut', () => asCutout(op, lk))] : [op];
    default: return [op];
  }
}

// look: only a puppet's cel depends on it (the cut-out look); without one a cel is never expanded.
export const needsExpand = (op, look) => op.op === 'paper' || op.op === 'night' || op.op === 'text' || (op.op === 'fill' && !!op.finish)
  || (op.op === 'group' && !!look && !!resolveLook(look).cutout && !!cutoutOf(op));

// The whole list, recursively (lint, projection and tests use this; the rasteriser expands lazily).
export function expand(list, look, { W = 1080, H = 1080 } = {}) {
  const run = (ops, lk) => {
    const key = envKey(lk, W, H);
    let changed = false;
    const out = ops.flatMap((op) => {
      const next = one(op, lk, key);
      if (next.length !== 1 || next[0] !== op) changed = true;
      return next;
    });
    return changed ? out : ops;
  };
  const one = (op, lk, key) => {
    if (op.op === 'group' && lk.cutout && cutoutOf(op)) return one(expandOp(op, lk, { W, H })[0], lk, key);
    if (needsExpand(op)) return expandOp(op, lk, { W, H });
    if (op.op === 'look') {
      const inner = resolveLook(op.look), kids = run(op.kids, inner);
      return [kids === op.kids ? op : withProps(op, { kids })];
    }
    if (!op.kids) return [op];
    const kids = remember(op, key, () => run(op.kids, lk));
    return [kids === op.kids ? op : remember(op, key + ':op', () => withProps(op, { kids }))];
  };
  return run(Array.isArray(list) ? list : [list], resolveLook(look));
}
