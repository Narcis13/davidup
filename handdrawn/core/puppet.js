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
// Browser-safe: the payload comes from the registry (core/store.js), which `fromStore` fills in node and
// `hdf dev` / `hdf bundle` fill from `window.HDF.assets`.
import { FPS } from './curves.js';
import { bounds, group, mmul, norm, parse, rotate, serialise, translate } from './list.js';
import { record } from './store.js';
import { cel } from './tree.js';

// A joint input: degrees on a 2 degree step, so a pose blend and a cycle land on the same quantised values.
export const JOINT = Object.freeze([-180, 180, 2]);

const RAD = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (i, n) => ((i % n) + n) % n;
const revive = (list) => parse(serialise(list));   // ops as data ($p paths) -> frozen ops with real paths

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
  const parent = {}, pivot = {}, ops = {}, variants = {};

  for (const n of names) {
    const p = d.parts[n];
    if (p.parent !== undefined && !d.parts[p.parent]) throw new Error(`puppet ${name}: part '${n}' names parent '${p.parent}', which is not a part`);
    parent[n] = p.parent;
  }
  for (const n of names) {
    const seen = [];
    for (let c = n; c !== undefined; c = parent[c]) {
      if (seen.includes(c)) throw new Error(`puppet ${name}: parts ${[...seen, c].join(' -> ')} parent each other in a loop`);
      seen.push(c);
    }
  }
  // A part without a pivot turns about its parent's: an eye rides the head, it does not turn on its own.
  const pivotOf = (n) => {
    for (let c = n; c !== undefined; c = parent[c]) if (Array.isArray(d.parts[c].pivot)) return [d.parts[c].pivot[0], d.parts[c].pivot[1]];
    return [0, 0];
  };
  for (const n of names) {
    pivot[n] = pivotOf(n);
    ops[n] = d.parts[n].ops ? revive(d.parts[n].ops) : null;
    if (d.parts[n].variants) variants[n] = Object.fromEntries(Object.entries(d.parts[n].variants).map(([k, v]) => [k, revive(v)]));
  }

  // A part's kids: its child parts and its own ops, merged back into the global key order, so painter order
  // survives the nesting. `{ i }` without `kid` is the part itself.
  const kidOrder = Object.fromEntries(names.map((n) => [n,
    [...names.filter((c) => parent[c] === n).map((c) => ({ kid: c, i: at.get(c) })), { i: at.get(n) }].sort((a, b) => a.i - b.i)]));
  const roots = names.filter((n) => parent[n] === undefined);

  // Declared inputs win, so a puppet may narrow a joint's range or add one of its own (plan 1.2 `dir`).
  const declared = d.inputs ?? {};
  const inputs = {};
  for (const n of names) inputs[n] = variants[n] ? Object.keys(variants[n]) : JOINT;
  for (const [k, v] of Object.entries(declared)) inputs[k] = v;

  const variantDefault = (n) => {
    const first = Array.isArray(declared[n]) ? declared[n][0] : undefined;
    return variants[n][String(first)] !== undefined ? first : Object.keys(variants[n])[0];
  };
  const rest = Object.freeze({
    ...Object.fromEntries(names.map((n) => [n, variants[n] ? variantDefault(n) : 0])),
    ...(d.poses?.rest ?? {}),
  });

  const angleOf = (n, q) => {
    const v = q[n] ?? rest[n] ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`puppet ${name}: joint '${n}' takes degrees, got ${JSON.stringify(v)}`);
    return v;
  };
  const ownOps = (n, q) => {
    const out = ops[n] ? [...ops[n]] : [];
    if (!variants[n]) return out;
    const key = String(q[n] ?? rest[n]);
    const v = variants[n][key];
    if (!v) throw new Error(`puppet ${name}: part '${n}' has no variant '${key}' (has ${Object.keys(variants[n]).join(', ')})`);
    return [...out, ...v];
  };
  // A turned part draws direct, as place() does for a rotation; a part at rest stays a cacheable layer.
  const partGroup = (n, q) => {
    const ang = variants[n] ? 0 : angleOf(n, q);
    const [px, py] = pivot[n], [qx, qy] = parent[n] === undefined ? [0, 0] : pivot[parent[n]];
    let m = translate(px - qx, py - qy);
    if (ang) m = mmul(m, rotate(ang * RAD));
    const kids = kidOrder[n].map((s) => (s.kid === undefined ? ownOps(n, q) : partGroup(s.kid, q)));
    return group({ name: n, xf: m, ...(ang ? { cache: 'never' } : {}) }, kids);
  };

  const draw = (q) => roots.map((n) => partGroup(n, q));
  const box = d.box ?? bounds(norm(draw(rest))) ?? [0, 0, 0, 0];
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
  make.ground = d.ground ?? [0, 0];
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
