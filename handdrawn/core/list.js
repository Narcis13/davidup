// Display lists: paths (flattened polylines), op constructors, hashing, bounds, walking and JSON.
// A list is an array of frozen op objects. Every value in an op is data, never a function,
// so a list is always hashable and serialisable (plan 1.2).
import { opBox } from './layout.js';
import { hash64 } from './rand.js';
import { splinePts } from './spline.js';

const TAU = Math.PI * 2;

// ---------- matrices: [a, b, c, d, e, f] as in canvas setTransform ----------

export const I = Object.freeze([1, 0, 0, 1, 0, 0]);
// Matrix product m x n: n applied first, then m.
export const mmul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const mapply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const translate = (x, y) => [1, 0, 0, 1, x, y];   // a translation matrix
// A rotation matrix, a in radians (clockwise on screen, y down).
export const rotate = (a) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
export const scale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];   // a scale matrix

// ---------- paths (plan 1.1) ----------
// { sub: [{ pts: number[] (flat x0,y0,x1,y1,...), closed }], box: [x, y, w, h] }

function boxOfSubs(sub) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sub) for (let i = 0; i < s.pts.length; i += 2) {
    const x = s.pts[i], y = s.pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1 - x0, y1 - y0];
}

export const mkPath = (sub) => Object.freeze({ sub, box: boxOfSubs(sub) });
const flat = (pts) => (pts.length && Array.isArray(pts[0]) ? pts.flat() : [...pts]);
export const isPath = (v) => !!v && typeof v === 'object' && Array.isArray(v.sub) && Array.isArray(v.box);

// A closed ellipse of n points (plan 1.1: curves are flattened at construction).
export function ellipse(cx, cy, rx, ry, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  return mkPath([{ pts, closed: true }]);
}
export const circle = (cx, cy, r, n = 48) => ellipse(cx, cy, r, r, n);   // a closed circle of n points
// An axis-aligned rectangle from its top left corner.
export const rect = (x, y, w, h) => mkPath([{ pts: [x, y, x + w, y, x + w, y + h, x, y + h], closed: true }]);

// A rectangle with corners of radius r, n points per corner.
export function roundRect(x, y, w, h, r, n = 6) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [], corners = [[x + w - r, y + r, -1], [x + w - r, y + h - r, 0], [x + r, y + h - r, 1], [x + r, y + r, 2]];
  for (const [cx, cy, q] of corners) for (let i = 0; i <= n; i++) {
    const a = (q + i / n) * TAU / 4;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return mkPath([{ pts, closed: true }]);
}

// A polyline through pts ([[x, y], ...] or flat [x0, y0, ...]), closed by default.
export const poly = (pts, closed = true) => mkPath([{ pts: flat(pts), closed }]);
// One open segment.
export const line = (x0, y0, x1, y1) => mkPath([{ pts: [x0, y0, x1, y1], closed: false }]);

// An open cubic Bezier from p0 to p1 with control points c0, c1, as n segments.
export function cubic(p0, c0, c1, p1, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    pts.push(a * p0[0] + b * c0[0] + c * c1[0] + d * p1[0], a * p0[1] + b * c0[1] + c * c1[1] + d * p1[1]);
  }
  return mkPath([{ pts, closed: false }]);
}

// Cardinal spline through the points; tension 0 is Catmull-Rom, 1 is straight segments.
export const spline = (points, o = {}) => mkPath([{ pts: splinePts(points, o), closed: !!o.closed }]);

// An open arc from angle a0 to a1 (radians), about 48 points per turn.
export function arc(cx, cy, r, a0, a1, n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / TAU * 48))) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return mkPath([{ pts, closed: false }]);
}

// The path with every point through matrix m ([a, b, c, d, e, f]).
export function xf(path, m) {
  return mkPath(path.sub.map((s) => {
    const pts = new Array(s.pts.length);
    for (let i = 0; i < s.pts.length; i += 2) {
      const x = s.pts[i], y = s.pts[i + 1];
      pts[i] = m[0] * x + m[2] * y + m[4]; pts[i + 1] = m[1] * x + m[3] * y + m[5];
    }
    return { pts, closed: s.closed };
  }));
}

export const box = (path) => path.box;   // [x, y, w, h]

// Segments of one sub as [x0, y0, x1, y1], including the closing edge.
function segments(s) {
  const p = s.pts, out = [];
  for (let i = 2; i < p.length; i += 2) out.push([p[i - 2], p[i - 1], p[i], p[i + 1]]);
  if (s.closed && p.length >= 4) out.push([p[p.length - 2], p[p.length - 1], p[0], p[1]]);
  return out;
}

// Total length of every sub, closing edges included.
export const len = (path) => path.sub.reduce((L, s) => L + segments(s).reduce((a, [x0, y0, x1, y1]) => a + Math.hypot(x1 - x0, y1 - y0), 0), 0);

// Point and heading at arc length s along the subs in order (clamped to the ends).
export function at(path, s) {
  let last = null;
  for (const sub of path.sub) for (const [x0, y0, x1, y1] of segments(sub)) {
    const L = Math.hypot(x1 - x0, y1 - y0), heading = Math.atan2(y1 - y0, x1 - x0);
    if (s <= L && L > 0) { const u = Math.max(0, s) / L; return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, heading }; }
    s -= L;
    last = { x: x1, y: y1, heading };
  }
  if (last) return last;
  const p = path.sub[0]?.pts ?? [0, 0];
  return { x: p[0], y: p[1], heading: 0 };
}

// Even-odd rule over every sub (open subs are treated as closed).
export function inside(path, x, y) {
  let hit = false;
  for (const s of path.sub) {
    const p = s.pts, n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

// The same path with points every `step` units along it (for even wobble, dashes or particles on a line).
export function resample(path, step) {
  return mkPath(path.sub.map((s) => {
    const pts = [s.pts[0], s.pts[1]];
    let carry = 0;
    for (const [x0, y0, x1, y1] of segments(s)) {
      const L = Math.hypot(x1 - x0, y1 - y0);
      let d = step - carry;
      for (; d <= L; d += step) pts.push(x0 + (x1 - x0) * d / L, y0 + (y1 - y0) * d / L);
      carry = L - (d - step);
    }
    if (!s.closed) {
      const ex = s.pts[s.pts.length - 2], ey = s.pts[s.pts.length - 1];
      if (pts[pts.length - 2] !== ex || pts[pts.length - 1] !== ey) pts.push(ex, ey);
    } else if (carry < step * 1e-6) pts.length -= 2;   // closing point landed back on the start
    return { pts, closed: s.closed };
  }));
}

// Several paths as one (their subs together; fills use even-odd).
export const union = (...paths) => mkPath(paths.flatMap((p) => p.sub));

// ---------- ops (plan 1.2) ----------

const mkOp = (o) => Object.freeze(o);

function needPath(p, who) {
  if (!isPath(p)) throw new TypeError(`${who}: expected a path (circle, rect, poly, ...)`);
  return p;
}

// Kids and shot lists may nest arrays and contain falsy values (`cond && op`: a guide drawn one frame in
// six); flatten them.
export function norm(list) {
  const out = [];
  const add = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(add); return; }
    if (typeof v !== 'object' || typeof v.op !== 'string') throw new TypeError(`display list: not an op: ${String(v)}`);
    out.push(v);
  };
  add(list);
  return out;
}

// The paper stock of the look (colour, bands, grain): first op of a daylight shot.
export const paper = (o = {}) => mkOp({ op: 'paper', ...o });
// The dark stock (palette night): first op of a night or blueprint shot.
export const night = (o = {}) => mkOp({ op: 'night', ...o });
// A flat fill in a role; o: finish (true: the look's texture, or a finish name / options), cov (riso coverage),
// alpha, blend, name, seed.
export const fill = (path, role = 'fills.0', o = {}) => mkOp({ op: 'fill', path: needPath(path, 'fill'), role, ...o });
// A hand-drawn line along the path; o: tool (pen brush pencil chalk crayon marker), w, wobble, taper, dash, alpha,
// order (for reveal), name, seed. Without w (or wobble) the look's tool setting applies.
export const stroke = (path, role = 'ink', o = {}) => mkOp({ op: 'stroke', path: needPath(path, 'stroke'), role, tool: 'pen', ...o });
// A dot screen inside the path; o: cell (spacing), density or cov, angle, blend: 'multiply'.
export const dots = (path, role = 'ink', o = {}) => mkOp({ op: 'dots', path: needPath(path, 'dots'), role, cell: 8, ...o });
// Hand-lettered text (expanded into strokes, no fonts); o: size, role, tool, align, w (the pen), width (wraps
// to it), lineH, maxLines, wrap, valign; '\n' breaks a line. Counted by lint's word rule.
export const text = (str, x, y, o = {}) => mkOp({ op: 'text', str: String(str), x, y, size: 48, role: 'ink', tool: 'pen', align: 'left', ...o });
// An image asset (src: an id in film assets) in the box; o: sil (silhouette path), alpha, blend.
export const image = (src, x, y, w, h, o = {}) => mkOp({ op: 'image', src, x, y, w, h, ...o });
// Kids drawn only inside the path.
export const clip = (path, kids) => mkOp({ op: 'clip', path: needPath(path, 'clip'), kids: norm(kids) });
// Kids drawn through a raster effect (FX: dissolve, blot, iris, mosaic, nightShot, glow, scribble, ...).
export const fx = (kind, args = {}, kids = [], o = {}) => mkOp({ op: 'fx', kind, args, kids: norm(kids), ...o });
// Kids drawn in another look (lint allows it inside a shot only with inset: true).
export const lookNode = (look, kids) => mkOp({ op: 'look', look, kids: norm(kids) });
// Data for lint and the board, never drawn: meta('anchor', { cel } | { name }), meta('intent', 'crop').
export const meta = (tag, data = {}) => mkOp({ op: 'meta', tag, data });

// group(kids) | group(name, kids, opts) | group({ name, xf, box, cache, ... }, kids)
export function group(a, b, c) {
  let o, kids;
  if (Array.isArray(a)) { kids = a; o = b ?? {}; }
  else if (typeof a === 'string') { kids = b ?? []; o = { ...c, name: a }; }
  else { o = a ?? {}; kids = b ?? []; }
  return mkOp({ op: 'group', xf: I, ...o, kids: norm(kids) });
}

// A copy of an op with some fields replaced (ops are frozen).
export const withProps = (op, props) => mkOp({ ...op, ...props });

// ---------- hashing (plan 1.3) ----------

const pathMemo = new WeakMap();
const opMemo = new WeakMap();

export function hashPath(p) {
  let h = pathMemo.get(p);
  if (h) return h;
  h = hash64((f) => {
    f.byte(0x50);
    for (const s of p.sub) { f.byte(s.closed ? 1 : 0); f.num(s.pts.length); for (const v of s.pts) f.num(v); }
  });
  pathMemo.set(p, h);
  return h;
}

function feedValue(v, f, where) {
  if (v === null || v === undefined) { f.byte(0); return; }
  switch (typeof v) {
    case 'boolean': f.byte(1); f.byte(v ? 1 : 0); return;
    case 'number': f.byte(2); f.num(v); return;
    case 'string': f.byte(3); f.str(v); return;
    case 'function': throw new TypeError(`display list: a function at ${where}; ops hold data only (evaluate curves before building the op)`);
    case 'object': break;
    default: throw new TypeError(`display list: cannot hash ${typeof v} at ${where}`);
  }
  if (Array.isArray(v)) { f.byte(4); f.num(v.length); v.forEach((x, i) => feedValue(x, f, `${where}[${i}]`)); return; }
  if (isPath(v)) { f.byte(6); f.str(hashPath(v)); return; }
  if (typeof v.op === 'string') { f.byte(7); f.str(hashOp(v)); return; }
  feedObject(v, f, where);
}

function feedObject(v, f, where) {
  f.byte(5);
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue;
    f.str(k);
    feedValue(v[k], f, `${where}.${k}`);
  }
}

// 16 hex digits over the op's canonical form (keys sorted, numbers at 1/1024). Memoised per op object.
export function hashOp(op) {
  let h = opMemo.get(op);
  if (h) return h;
  h = hash64((f) => feedObject(op, f, op.op));
  if (Object.isFrozen(op)) opMemo.set(op, h);
  return h;
}

// Any plain data (a look, cel inputs) in the same canonical form.
export const hashData = (v) => hash64((f) => feedValue(v, f, 'data'));

// 16 hex digits over a whole list (what frame dedup and `hdf changed` compare).
export const hashList = (list) => hash64((f) => { f.byte(0x4c); for (const op of norm(list)) f.str(hashOp(op)); });

// ---------- bounds, walk, mapPaths ----------

function boxThrough(b, m) {
  const [x, y, w, h] = b, c = [mapply(m, x, y), mapply(m, x + w, y), mapply(m, x, y + h), mapply(m, x + w, y + h)];
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}
function unite(a, b) {
  if (!a) return b; if (!b) return a;
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
}
function intersect(a, b) {
  if (!a || !b) return null;
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x1 < x0 || y1 < y0 ? null : [x0, y0, x1 - x0, y1 - y0];
}
const inflate = (b, d) => [b[0] - d, b[1] - d, b[2] + 2 * d, b[3] + 2 * d];

// Union of the ops' boxes in the list's coordinates (through each group's xf). paper/night/meta have
// no box. A text op is measured from its glyphs (layout.js opBox) in the hand of the shot being drawn.
export function bounds(list, m = I) {
  let out = null;
  for (const op of norm(list)) {
    let b = null;
    switch (op.op) {
      case 'fill': case 'dots': b = boxThrough(op.path.box, m); break;
      case 'stroke': b = boxThrough(inflate(op.path.box, (op.w ?? 2) / 2), m); break;
      case 'text': b = boxThrough(opBox(op), m); break;
      case 'image': b = boxThrough([op.x, op.y, op.w, op.h], m); break;
      case 'mesh': {   // a projected image grid (engines/stage3d.js); NaN points are behind the camera
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < op.grid.length; i += 2) if (op.grid[i] === op.grid[i]) { x0 = Math.min(x0, op.grid[i]); x1 = Math.max(x1, op.grid[i]); y0 = Math.min(y0, op.grid[i + 1]); y1 = Math.max(y1, op.grid[i + 1]); }
        if (x0 !== Infinity) b = boxThrough([x0, y0, x1 - x0, y1 - y0], m);
        break;
      }
      case 'specks': {   // internal grain op from finish.js: rects [x, y, w, h, ...]
        const q = op.rects;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < q.length; i += 4) {
          x0 = Math.min(x0, q[i]); y0 = Math.min(y0, q[i + 1]); x1 = Math.max(x1, q[i] + q[i + 2]); y1 = Math.max(y1, q[i + 1] + q[i + 3]);
        }
        if (q.length) b = boxThrough([x0, y0, x1 - x0, y1 - y0], m);
        break;
      }
      case 'group': { const mm = mmul(m, op.xf); b = op.box ? boxThrough(op.box, mm) : bounds(op.kids, mm); break; }
      case 'clip': b = intersect(boxThrough(op.path.box, m), bounds(op.kids, m)); break;
      case 'fx': case 'look': b = bounds(op.kids, m); break;
      default: break;
    }
    out = unite(out, b);
  }
  return out;
}

// Depth first. visit(op, m, depth) sees each op with the matrix of its parent; returning false skips its kids.
export function walk(list, visit, m = I, depth = 0) {
  for (const op of norm(list)) {
    if (visit(op, m, depth) === false || !op.kids) continue;
    walk(op.kids, visit, op.op === 'group' ? mmul(m, op.xf) : m, depth + 1);
  }
}

// A new list with every path (op.path, image sil) replaced by f(path, op).
export function mapPaths(list, f) {
  return norm(list).map((op) => {
    const next = { ...op };
    if (op.path) next.path = f(op.path, op);
    if (op.sil) next.sil = f(op.sil, op);
    if (op.kids) next.kids = mapPaths(op.kids, f);
    return mkOp(next);
  });
}

// ---------- JSON (paths as flat arrays: { $p: [[closed, x0, y0, ...], ...] }) ----------

// A list as JSON, paths as flat arrays.
export const serialise = (list) => JSON.stringify(norm(list), (k, v) => (isPath(v) ? { $p: v.sub.map((s) => [s.closed ? 1 : 0, ...s.pts]) } : v));

// The inverse of serialise.
export const parse = (json) => JSON.parse(json, (k, v) => {
  if (v && typeof v === 'object' && Array.isArray(v.$p)) return mkPath(v.$p.map(([c, ...pts]) => ({ pts, closed: !!c })));
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.op === 'string') return mkOp(v);
  return v;
});
