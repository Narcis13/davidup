// Puppets (plan 1.2): a cel whose drawing is data. A puppet payload in the asset store carries its parts as
// serialised display lists, its pivots, its named poses and its cycles; `puppet(id)` turns that into a cel
// exactly like `cel()` makes one, so everything downstream (sheets, lint, the cache, hashing, dedup) treats a
// puppet and a hand-written cel the same way.
//
//   fromStore(['fox']);              // the record, as any asset is read
//   const fox = puppet('fox');
//   fox({ 'arm-r': -110, eye: 'happy' })   // a group tagged `cel`, frozen, memoised, boxed
//   fox.pose('wave', k)              // rest -> wave by k: joints lerp, variants switch at k >= 0.5
//   fox.cycle('walk', t)             // the frame on the 1/12 s grid, wrapping
//
// Parts are drawn in key order (painter's), each as a group whose `xf` turns it about its pivot: a part
// nests inside its parent, but keeps its place in the global order, so a tail listed before the body is
// drawn before it and still swings with it. A part's ops are in its own coordinates with its pivot at the
// origin; a part without a pivot turns about its parent's. Joint inputs are degrees on a 2 degree step, so
// two frames of a cycle that quantise the same are one group object and dedup. A part with `variants` takes
// its variant's key as its input instead of an angle.
//
// Turnarounds: a puppet may declare `views: ['side', 'three-quarter', 'front']` and key any part's `ops`, any
// variant and any `pivot` by view ({ side: [...], front: [...] }). A part with no drawing of its own in a view
// uses the first declared view's (and that view's pivot), so only what changes needs drawing again; a pivot
// keyed by view moves a part whose drawing is shared. Such a puppet takes a `dir`
// input [-1, 1, 0.5]: |dir| 1 draws `side`, 0.5 `three-quarter`, 0 `front` (the first declared view when that
// one is missing), and a negative dir mirrors the drawing about the ground point, so the puppet turns itself
// and a stage does not flip it again. Painter order is the key order in every view.
//
// Browser-safe: the payload comes from the registry (core/store.js), which `fromStore` fills in node and
// `hdf dev` / `hdf bundle` fill from `window.HDF.assets`.
import { FPS } from './curves.js';
import { bounds, group, mmul, norm, parse, rotate, serialise, translate } from './list.js';
import { record } from './store.js';
import { cel } from './tree.js';

// A joint input: degrees on a 2 degree step, so a pose blend and a cycle land on the same quantised values.
export const JOINT = Object.freeze([-180, 180, 2]);

// The dir input of a puppet with views: -1 .. 1 on a half step, the sign its facing, |dir| its view.
export const DIR = Object.freeze([-1, 1, 0.5]);
// The |dir| each view is drawn at: side 1, three-quarter 0.5, front 0.
export const VIEW_DIRS = Object.freeze({ side: 1, 'three-quarter': 0.5, front: 0 });

const RAD = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (i, n) => ((i % n) + n) % n;
const revive = (list) => parse(serialise(list));   // ops as data ($p paths) -> frozen ops with real paths
// A value keyed by view ({ side: [...] }) rather than one for every view (an op list, a pivot [x, y]).
const keyed = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const unite = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
  Math.max(a[0] + a[2], b[0] + b[2]) - Math.min(a[0], b[0]), Math.max(a[1] + a[3], b[1] + b[3]) - Math.min(a[1], b[1])]);

const built = new WeakMap();

// puppet(id) => the cel of the puppet that id names in the registry; puppet(data) builds one from a payload
// in hand (a test, or `hdf sheet store <id>` reading the blob itself). Built once per payload object: the ops
// are deserialised through list.js one time and every pose reuses them.
export function puppet(idOrData) {
  const d = typeof idOrData === 'string' ? record(idOrData) : idOrData;
  if (!d || typeof d !== 'object' || !d.parts || typeof d.parts !== 'object' || !Object.keys(d.parts).length) {
    throw new TypeError(`puppet ${typeof idOrData === 'string' ? `'${idOrData}'` : ''}: expected a puppet payload { units, parts: { ... } } (plan 1.2)`);
  }
  let made = built.get(d);
  if (!made) built.set(d, (made = build(d, typeof idOrData === 'string' ? idOrData : d.name)));
  return made;
}

function build(d, id) {
  const name = d.name ?? id ?? 'puppet';
  const names = Object.keys(d.parts);
  const at = new Map(names.map((n, j) => [n, j]));
  const views = Array.isArray(d.views) && d.views.length ? Object.freeze(d.views.map(String)) : null;
  const parent = {};

  for (const n of names) {
    const p = d.parts[n];
    if (p.parent !== undefined && !d.parts[p.parent]) throw new Error(`puppet ${name}: part '${n}' names parent '${p.parent}', which is not a part`);
    parent[n] = p.parent;
    for (const [what, v] of [['ops', p.ops], ['pivot', p.pivot], ...Object.entries(p.variants ?? {}).map(([k, vv]) => [`variant '${k}'`, vv])]) {
      if (!keyed(v)) continue;
      if (!views) throw new Error(`puppet ${name}: part '${n}' ${what} is keyed by view, but the puppet declares no views`);
      for (const k of Object.keys(v)) if (!views.includes(k)) throw new Error(`puppet ${name}: part '${n}' ${what} names view '${k}' (views: ${views.join(', ')})`);
    }
  }
  for (const n of names) {
    const seen = [];
    for (let c = n; c !== undefined; c = parent[c]) {
      if (seen.includes(c)) throw new Error(`puppet ${name}: parts ${[...seen, c].join(' -> ')} parent each other in a loop`);
      seen.push(c);
    }
  }

  // The view a part draws from in view V: V when it has a drawing of its own there, else the first view.
  const drawnIn = (n, V) => {
    const p = d.parts[n];
    return (keyed(p.ops) && p.ops[V] !== undefined) || Object.values(p.variants ?? {}).some((v) => keyed(v) && v[V] !== undefined);
  };
  const viewFor = (n, V) => (!views || drawnIn(n, V) ? V : views[0]);
  const inView = (v, V) => (keyed(v) ? v[V] ?? v[views[0]] : v);
  // A part without a pivot turns about its parent's: an eye rides the head, it does not turn on its own. A
  // pivot keyed by view moves the part in that view (its ops shared or its own); a part drawn in a view with
  // no pivot there rides its parent; a part that falls back to the first view keeps that view's pivot.
  const ownPivot = (n, V) => {
    const pv = d.parts[n].pivot;
    const at = !keyed(pv) ? pv : pv[V] !== undefined || (views && drawnIn(n, V)) ? pv[V] : pv[views[0]];
    return Array.isArray(at) ? [at[0], at[1]] : undefined;
  };
  const pivotIn = (n, V) => ownPivot(n, V) ?? (parent[n] === undefined ? [0, 0] : pivotIn(parent[n], V));
  const revived = new Map();   // one deserialisation per op list, shared by the views that fall back to it
  const reviveOnce = (list) => { let r = revived.get(list); if (!r) revived.set(list, (r = revive(list))); return r; };

  // Per view: every part's pivot, own ops and variants (a puppet without views has one, keyed null).
  const VIEWS = views ?? [null], rig = new Map();
  for (const V of VIEWS) {
    const pivot = {}, ops = {}, variants = {};
    for (const n of names) {
      const p = d.parts[n], W = viewFor(n, V);
      pivot[n] = pivotIn(n, V);
      const own = inView(p.ops, W);
      ops[n] = own ? reviveOnce(own) : null;
      if (p.variants) variants[n] = Object.fromEntries(Object.entries(p.variants).map(([k, v]) => [k, reviveOnce(inView(v, W) ?? [])]));
    }
    rig.set(V, { pivot, ops, variants });
  }
  const variantKeys = Object.fromEntries(names.filter((n) => d.parts[n].variants).map((n) => [n, Object.keys(d.parts[n].variants)]));

  // A part's kids: its child parts and its own ops, merged back into the global key order, so painter order
  // survives the nesting. `{ i }` without `kid` is the part itself.
  const kidOrder = Object.fromEntries(names.map((n) => [n,
    [...names.filter((c) => parent[c] === n).map((c) => ({ kid: c, i: at.get(c) })), { i: at.get(n) }].sort((a, b) => a.i - b.i)]));
  const roots = names.filter((n) => parent[n] === undefined);

  // Declared inputs win, so a puppet may narrow a joint's range or add one of its own (plan 1.2 `dir`).
  const declared = d.inputs ?? {};
  const inputs = {};
  for (const n of names) inputs[n] = variantKeys[n] ?? JOINT;
  if (views) inputs.dir = DIR;
  for (const [k, v] of Object.entries(declared)) inputs[k] = v;

  const variantDefault = (n) => {
    const first = Array.isArray(declared[n]) ? declared[n][0] : undefined;
    return variantKeys[n].includes(String(first)) ? first : variantKeys[n][0];
  };
  const rest = Object.freeze({
    ...Object.fromEntries(names.map((n) => [n, variantKeys[n] ? variantDefault(n) : 0])),
    ...(views ? { dir: 1 } : {}),
    ...(d.poses?.rest ?? {}),
  });

  // |dir| to a view: 1 side, 0.5 three-quarter, 0 front, each only when declared.
  const viewOf = (dir = 1) => {
    if (!views) return null;
    const a = Math.abs(typeof dir === 'number' && Number.isFinite(dir) ? dir : 1);
    const want = a >= 0.75 ? 'side' : a >= 0.25 ? 'three-quarter' : 'front';
    return views.includes(want) ? want : views[0];
  };
  const angleOf = (n, q) => {
    const v = q[n] ?? rest[n] ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`puppet ${name}: joint '${n}' takes degrees, got ${JSON.stringify(v)}`);
    return v;
  };
  const ownOps = (n, q, R) => {
    const out = R.ops[n] ? [...R.ops[n]] : [];
    if (!variantKeys[n]) return out;
    const key = String(q[n] ?? rest[n]);
    const v = R.variants[n][key];
    if (!v) throw new Error(`puppet ${name}: part '${n}' has no variant '${key}' (has ${variantKeys[n].join(', ')})`);
    return [...out, ...v];
  };
  // A turned part draws direct, as place() does for a rotation; a part at rest stays a cacheable layer.
  const partGroup = (n, q, R) => {
    const ang = variantKeys[n] ? 0 : angleOf(n, q);
    const [px, py] = R.pivot[n], [qx, qy] = parent[n] === undefined ? [0, 0] : R.pivot[parent[n]];
    let m = translate(px - qx, py - qy);
    if (ang) m = mmul(m, rotate(ang * RAD));
    const kids = kidOrder[n].map((s) => (s.kid === undefined ? ownOps(n, q, R) : partGroup(s.kid, q, R)));
    return group({ name: n, xf: m, ...(ang ? { cache: 'never' } : {}) }, kids);
  };

  const ground = d.ground ?? [0, 0];
  // A negative dir mirrors the whole drawing about the ground point (an x-flip stays cacheable).
  const draw = (q) => {
    const dir = q.dir ?? rest.dir, R = rig.get(viewOf(dir));
    const kids = roots.map((n) => partGroup(n, q, R));
    return views && dir < 0 ? [group({ name: 'mirror', xf: [-1, 0, 0, 1, 2 * ground[0], 0] }, kids)] : kids;
  };
  // A puppet with views turns both ways, so its box holds the drawing and its mirror.
  let box = d.box ?? (views ? views.reduce((b, V) => unite(b, bounds(norm(draw({ ...rest, dir: VIEW_DIRS[V] ?? 1 })))), null) : bounds(norm(draw(rest)))) ?? [0, 0, 0, 0];
  if (views) box = unite(box, [2 * ground[0] - box[0] - box[2], box[1], box[2], box[3]]);
  const make = cel(name, draw, { box, inputs, desc: d.desc });

  // Poses and cycles hand the cel a full input set (every joint, every variant), so two states that draw the
  // same are the same object however they were asked for.
  const poseOf = (pose, k = 1) => {
    const target = d.poses?.[pose];
    if (!target) throw new Error(`puppet ${name}: no pose '${pose}' (has ${Object.keys(d.poses ?? {}).join(', ') || 'none'})`);
    const out = { ...rest };
    for (const [key, v] of Object.entries(target)) {
      out[key] = typeof v === 'number' && typeof rest[key] === 'number' ? lerp(rest[key], v, k) : k >= 0.5 ? v : rest[key];
    }
    return out;
  };
  const frameOf = (cycle, t) => {
    const c = d.cycles?.[cycle];
    if (!c || !Array.isArray(c.frames) || !c.frames.length) throw new Error(`puppet ${name}: no cycle '${cycle}' (has ${Object.keys(d.cycles ?? {}).join(', ') || 'none'})`);
    return { ...rest, ...c.frames[wrap(Math.floor(t * (c.fps ?? FPS) + 1e-9), c.frames.length)] };
  };

  make.puppet = d;
  make.units = d.units;
  make.ground = ground;
  make.views = views;
  make.viewOf = viewOf;
  make.pivotAt = (n, V = viewOf(rest.dir)) => (rig.get(V) ?? rig.get(VIEWS[0])).pivot[n];
  make.rest = rest;
  make.parts = Object.freeze(names.slice());
  make.poses = Object.freeze(Object.keys(d.poses ?? {}));
  make.cycles = Object.freeze(Object.keys(d.cycles ?? {}));
  make.poseOf = poseOf;
  make.frameOf = frameOf;
  make.pose = (pose, k = 1, extra) => make({ ...poseOf(pose, k), ...extra });
  make.cycle = (cycle, t, extra) => make({ ...frameOf(cycle, t), ...extra });
  return make;
}
