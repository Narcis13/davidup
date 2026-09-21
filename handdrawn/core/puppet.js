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
//   fox.liftOf('gallop', t)          // how far that frame lifts the puppet (a retargeted cycle), up positive
//
// Parts are drawn in key order (painter's), each as a group whose `xf` turns it about its pivot: a part
// nests inside its parent, but keeps its place in the global order, so a tail listed before the body is
// drawn before it and still swings with it. A part's ops are in its own coordinates with its pivot at the
// origin; a part without a pivot turns about its parent's. Joint inputs are degrees on a 2 degree step, so
// two frames of a cycle that quantise the same are one group object and dedup. A part with `variants` takes
// its variant's key as its input instead of an angle.
//
// Slide and scale (4.0 K1): a part may also move without turning. `slide: { x: [min, max, step], y: [...] }`
// declares inputs `<part>.x` and `<part>.y` (logical units, in the parent's frame before the part turns: a
// pupil that looks, a brow that rises); `scale: { x: [...], y: [...] }` declares `<part>.sx` and `<part>.sy`
// (about the pivot: a body that squashes). With `keepArea: true` a scale names one axis and the other is its
// inverse, so a squash is a stretch the other way. A part's xf is translate(pivot) . translate(dx, dy) .
// rotate(a) . scale(sx, sy); at rest (0, 0, 1, 1) it is exactly what it was without the inputs, so a puppet
// that declares none draws and hashes as before. The inputs are quantised on their step like joints.
// `when: { eye: ['open'] }` draws a part only while each named input holds one of the listed values (the
// pupil shows with the open eye, not the happy one).
//
// Turnarounds: a puppet may declare `views: ['side', 'three-quarter', 'front']` and key any part's `ops`, any
// variant and any `pivot` by view ({ side: [...], front: [...] }). A part with no drawing of its own in a view
// uses the first declared view's (and that view's pivot), so only what changes needs drawing again; a pivot
// keyed by view moves a part whose drawing is shared. Such a puppet takes a `dir`
// input [-1, 1, 0.5]: |dir| 1 draws `side`, 0.5 `three-quarter`, 0 `front` (the first declared view when that
// one is missing), and a negative dir mirrors the drawing about the ground point, so the puppet turns itself
// and a stage does not flip it again. Painter order is the key order in every view.
//
// The cut-out look (3.0 S10): every puppet built is registered by its cel name with its units, ground and each
// part's kind -- 'joint' (a pivot of its own, on a parent), 'card' (a pivot, no parent) or 'print' (it rides
// its parent: an eye, a mouth). The drawing carries nothing extra, so a puppet still hashes like the same cel
// in code. Under a look with a `cutout` field the finish pass (core/finish.js) hands a cel that cutoutOf()
// knows to asCutout(), which rebuilds it as card on a table: see there.
//
// Pack mirrors (3.0 S13): `hdf donate --manifest` writes every pack cel into the store as `pack:<name>`, a
// puppet of one part whose variants are the cel drawn at each input combination (keyed 'lid=0,steam=1',
// inputs sorted), with a `mirror` field: { pack, export, defaults, values, pool }. `values` are the inputs
// each variant was drawn at (every step when the grid is small, else min, default and max), `defaults` what
// the cel draws for an input it is not given, and `pool` every op once (its kids as indices into the pool);
// a variant is the indices of its ops, so what two states share is stored once. The mirror is a cel with the code cel's name, box and inputs, and hands back the code
// cel's ops, so `puppet('pack:boat')({ note: 1 })` hashes as `boat({ note: 1 })` does. An input between two
// mirrored values draws the nearest one; an input the cel does not declare (boat's mode) needs the code cel.
//
// Browser-safe: the payload comes from the registry (core/store.js), which `fromStore` fills in node and
// `hdf dev` / `hdf bundle` fill from `window.HDF.assets`.
import { FPS } from './curves.js';
import { bounds, circle, dots, fill, fx, group, mmul, norm, parse, rotate, scale, serialise, stroke, translate, withProps } from './list.js';
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

// A move spec [min, max, step] and the rest it must hold (0 for a slide, 1 for a scale), checked.
const spec3 = (name, n, key, v, rest) => {
  const ok = Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && v[0] < v[1] && v[2] > 0;
  if (!ok) throw new Error(`puppet ${name}: part '${n}' ${key} takes [min, max, step] with min < max and step > 0, got ${JSON.stringify(v)}`);
  if (rest === 1 && v[0] <= 0) throw new Error(`puppet ${name}: part '${n}' ${key} scales from ${v[0]}; a scale stays above 0`);
  const off = (rest - v[0]) / v[2];
  if (rest < v[0] || rest > v[1] || Math.abs(off - Math.round(off)) > 1e-3) {
    throw new Error(`puppet ${name}: part '${n}' ${key} ${JSON.stringify(v)} does not hold its rest ${rest} on its grid`);
  }
  return Object.freeze(v.slice());
};

// A part's slide and scale inputs: { x, y, sx, sy } input keys (or undefined), keep (sx = 1 / sy or the
// reverse), and the specs as { key: [min, max, step] }. null when the part declares neither.
export function movesOf(p, n, name = 'puppet') {
  if (!p?.slide && !p?.scale) return null;
  const out = { specs: {} };
  const axes = (field, v, keys, rest) => {
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`puppet ${name}: part '${n}' ${field} is { x: [min, max, step], y: [...] }`);
    for (const k of Object.keys(v)) if (!['x', 'y', ...(field === 'scale' ? ['keepArea'] : [])].includes(k)) throw new Error(`puppet ${name}: part '${n}' ${field} has '${k}' (takes x, y${field === 'scale' ? ', keepArea' : ''})`);
    for (const a of ['x', 'y']) {
      if (v[a] === undefined) continue;
      const key = `${n}.${keys[a]}`;
      out[keys[a]] = key;
      out.specs[key] = spec3(name, n, `${field}.${a}`, v[a], rest);
    }
  };
  if (p.slide) axes('slide', p.slide, { x: 'x', y: 'y' }, 0);
  if (p.scale) {
    axes('scale', p.scale, { x: 'sx', y: 'sy' }, 1);
    if (p.scale.keepArea) {
      if (!!out.sx === !!out.sy) throw new Error(`puppet ${name}: part '${n}' scale keeps its area with one axis; it names ${out.sx ? 'both' : 'neither'}`);
      out.keep = true;
    }
  }
  if (!Object.keys(out.specs).length) throw new Error(`puppet ${name}: part '${n}' declares a slide or scale with no axis`);
  return out;
}

const built = new WeakMap();
const CUT = new Map();   // cel name -> { units, ground, kinds }: what the cut-out look needs of a puppet

// The cut-out record of a cel group, when a puppet drew it (its name is a puppet's, its kids its parts).
export function cutoutOf(g) {
  const c = g?.op === 'group' && typeof g.cel === 'string' ? CUT.get(g.cel) : undefined;
  return c && g.kids.every((k) => k.op === 'group' && (c.kinds[k.name] || k.name === 'mirror')) ? c : undefined;
}

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
  if (d.mirror) return mirror(d, id);
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
  const moves = {};
  for (const n of names) { const m = movesOf(d.parts[n], n, name); if (m) moves[n] = m; }
  for (const n of names) {
    const w = d.parts[n].when;
    if (w === undefined) continue;
    if (!w || typeof w !== 'object' || Array.isArray(w)) throw new Error(`puppet ${name}: part '${n}' when is { input: [values] }`);
    for (const [k, vs] of Object.entries(w)) {
      const keys = d.parts[k]?.variants ? Object.keys(d.parts[k].variants) : null;
      if (!keys) throw new Error(`puppet ${name}: part '${n}' shows when '${k}' ..., but '${k}' is not a part with variants`);
      if (!Array.isArray(vs) || !vs.length) throw new Error(`puppet ${name}: part '${n}' when.${k} lists no values`);
      for (const v of vs) if (!keys.includes(String(v))) throw new Error(`puppet ${name}: part '${n}' shows when ${k} is '${v}', which '${k}' has no variant for (has ${keys.join(', ')})`);
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
  for (const m of Object.values(moves)) Object.assign(inputs, m.specs);
  if (views) inputs.dir = DIR;
  for (const [k, v] of Object.entries(declared)) inputs[k] = v;

  const variantDefault = (n) => {
    const first = Array.isArray(declared[n]) ? declared[n][0] : undefined;
    return variantKeys[n].includes(String(first)) ? first : variantKeys[n][0];
  };
  const rest = Object.freeze({
    ...Object.fromEntries(names.map((n) => [n, variantKeys[n] ? variantDefault(n) : 0])),
    ...Object.fromEntries(Object.values(moves).flatMap((m) => Object.keys(m.specs).map((k) => [k, /\.s[xy]$/.test(k) ? 1 : 0]))),
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
  const amount = (key, q) => {
    const v = q[key] ?? rest[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`puppet ${name}: '${key}' takes a number, got ${JSON.stringify(v)}`);
    return v;
  };
  const shown = (n, q) => {
    const w = d.parts[n].when;
    return !w || Object.entries(w).every(([k, vs]) => vs.map(String).includes(String(q[k] ?? rest[k])));
  };
  // A turned or scaled part draws direct, as place() does; a part at rest or slid stays a cacheable layer.
  const partGroup = (n, q, R) => {
    const ang = variantKeys[n] ? 0 : angleOf(n, q);
    const [px, py] = R.pivot[n], [qx, qy] = parent[n] === undefined ? [0, 0] : R.pivot[parent[n]];
    let m = translate(px - qx, py - qy), scaled = false;
    const mv = moves[n];
    if (mv) {
      const dx = mv.x ? amount(mv.x, q) : 0, dy = mv.y ? amount(mv.y, q) : 0;
      if (dx || dy) m = mmul(m, translate(dx, dy));
    }
    if (ang) m = mmul(m, rotate(ang * RAD));
    if (mv && (mv.sx || mv.sy)) {
      let sx = mv.sx ? amount(mv.sx, q) : 1, sy = mv.sy ? amount(mv.sy, q) : 1;
      if (mv.keep) { if (mv.sx) sy = 1 / sx; else sx = 1 / sy; }
      if (sx !== 1 || sy !== 1) { m = mmul(m, scale(sx, sy)); scaled = true; }
    }
    const kids = kidOrder[n].filter((s) => s.kid === undefined || shown(s.kid, q))
      .map((s) => (s.kid === undefined ? ownOps(n, q, R) : partGroup(s.kid, q, R)));
    return group({ name: n, xf: m, ...(ang || scaled ? { cache: 'never' } : {}) }, kids);
  };

  const ground = d.ground ?? [0, 0];
  // A negative dir mirrors the whole drawing about the ground point (an x-flip stays cacheable).
  const draw = (q) => {
    const dir = q.dir ?? rest.dir, R = rig.get(viewOf(dir));
    const kids = roots.filter((n) => shown(n, q)).map((n) => partGroup(n, q, R));
    return views && dir < 0 ? [group({ name: 'mirror', xf: [-1, 0, 0, 1, 2 * ground[0], 0] }, kids)] : kids;
  };
  // A puppet with views turns both ways, so its box holds the drawing and its mirror.
  let box = d.box ?? (views ? views.reduce((b, V) => unite(b, bounds(norm(draw({ ...rest, dir: VIEW_DIRS[V] ?? 1 })))), null) : bounds(norm(draw(rest)))) ?? [0, 0, 0, 0];
  if (views) box = unite(box, [2 * ground[0] - box[0] - box[2], box[1], box[2], box[3]]);
  const make = cel(name, draw, { box, inputs, desc: d.desc });
  CUT.set(name, Object.freeze({
    units: d.units ?? 300, ground,
    // A part that slides (a pupil, a brow) is printed on its parent's card, whatever its pivot.
    kinds: Object.fromEntries(names.map((n) => [n, d.parts[n].pivot === undefined || d.parts[n].slide ? 'print' : parent[n] === undefined ? 'card' : 'joint'])),
  }));

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
    const { lift: _lift, ...q } = c.frames[wrap(Math.floor(t * (c.fps ?? FPS) + 1e-9), c.frames.length)];
    return { ...rest, ...q };
  };
  // A retargeted cycle (3.0 S14) may lift the whole puppet off its ground point in a frame, in its own units,
  // up positive: a gallop's moment in the air. The drawing does not move (its box stays put); a stage does.
  const liftOf = (cycle, t) => {
    const c = d.cycles?.[cycle];
    if (!c?.frames?.length) return 0;
    return c.frames[wrap(Math.floor(t * (c.fps ?? FPS) + 1e-9), c.frames.length)].lift ?? 0;
  };

  make.puppet = d;
  make.units = d.units;
  make.ground = ground;
  make.views = views;
  make.viewOf = viewOf;
  make.pivotAt = (n, V = viewOf(rest.dir)) => (rig.get(V) ?? rig.get(VIEWS[0])).pivot[n];
  make.rest = rest;
  make.parts = Object.freeze(names.slice());
  // Every slide and scale input: { '<part>.x': [min, max, step], ... } (4.0 K1).
  make.moves = Object.freeze(Object.assign({}, ...Object.values(moves).map((m) => m.specs)));
  make.poses = Object.freeze(Object.keys(d.poses ?? {}));
  make.cycles = Object.freeze(Object.keys(d.cycles ?? {}));
  make.poseOf = poseOf;
  make.frameOf = frameOf;
  make.liftOf = liftOf;
  make.pose = (pose, k = 1, extra) => make({ ...poseOf(pose, k), ...extra });
  make.cycle = (cycle, t, extra) => make({ ...frameOf(cycle, t), ...extra });
  return make;
}

// ---------- pack mirrors (3.0 S13) ----------

// The variant key of a full input set: 'k=v' pairs, keys sorted.
export const mirrorKey = (q) => Object.keys(q).sort().map((k) => `${k}=${q[k]}`).join(',');

function mirror(d, id) {
  const m = d.mirror, name = d.name ?? id ?? 'puppet';
  const [part] = Object.keys(d.parts), variants = d.parts[part].variants ?? {};
  const values = m.values ?? {}, defaults = m.defaults ?? {}, pool = m.pool ?? [], keys = Object.keys(values).sort();
  const where = `import { ${m.export ?? name} } from packs/${m.pack}.js`;
  const snap = (k, v) => (typeof v !== 'number' ? v : values[k].reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)));
  // Pool entries revived once each, so an op two states share is one object (and one cache entry).
  const ops = new Map();
  const op = (i) => {
    let o = ops.get(i);
    if (o) return o;
    const raw = pool[i];
    if (!raw) throw new Error(`puppet ${name}: the mirror names op ${i}, which is not in its pool`);
    o = parse(JSON.stringify(Array.isArray(raw.kids) ? { ...raw, kids: undefined } : raw));
    if (Array.isArray(raw.kids)) o = withProps(o, { kids: raw.kids.map(op) });
    ops.set(i, o);
    return o;
  };
  const drawn = new Map();
  const draw = (q) => {
    for (const k of Object.keys(q)) {
      if (!values[k]) throw new Error(`puppet ${name}: the pack mirror takes ${keys.join(', ') || 'no inputs'}; '${k}' needs the code cel (${where})`);
    }
    const full = {};
    for (const k of keys) {
      const v = q[k] ?? defaults[k];
      if (v === undefined) throw new Error(`puppet ${name}: no default for '${k}' in the mirror; give it`);
      full[k] = snap(k, v);
    }
    const key = mirrorKey(full);
    if (!variants[key]) throw new Error(`puppet ${name}: the mirror has no drawing for ${key} (re-export it: hdf donate --manifest)`);
    let r = drawn.get(key);
    if (!r) drawn.set(key, (r = variants[key].map(op)));
    return r;
  };
  const make = cel(name, draw, { box: d.box, inputs: d.inputs ?? {}, desc: d.desc });
  const none = (what) => () => { throw new Error(`puppet ${name}: a pack mirror has no ${what}`); };
  make.puppet = d;
  make.mirror = m;
  make.units = d.units;
  make.ground = d.ground ?? [0, 0];
  make.views = null;
  make.viewOf = () => null;
  make.pivotAt = () => [0, 0];
  make.rest = Object.freeze({ ...defaults });
  make.parts = Object.freeze([part]);
  make.moves = Object.freeze({});
  make.poses = Object.freeze([]);
  make.cycles = Object.freeze([]);
  make.poseOf = none('poses');
  make.frameOf = none('cycles');
  make.liftOf = () => 0;
  make.pose = none('poses');
  make.cycle = none('cycles');
  // Every mirrored input set, as { key: inputs }.
  make.states = () => Object.fromEntries(Object.keys(variants)
    .map((k) => [k, Object.fromEntries(k ? k.split(',').map((kv) => { const [a, b] = kv.split('='); return [a, isNaN(+b) ? b : +b]; }) : [])]));
  return make;
}

// ---------- the cut-out look (3.0 S10) ----------

// A puppet's cel (a group tagged `puppet`) as cut card, for a look whose `cutout` is { shadow, fastener, edge,
// tilt }. Every part with a pivot of its own is a piece of card: a soft drop shadow of its silhouette falls
// down-right on what lies under it (alpha `shadow`, fx soft), then the piece, then its paper edge (a `light`
// stroke `edge` hundredths of the puppet's units wide, offset up-left, along each coloured fill), and a
// jointed piece a brass fastener at its pivot (accents.2, a dot screen on a disc `fastener` hundredths
// across). Directions are the table's, whatever the joints and the mirror turn. A print part (an eye, a mouth)
// is printed on its card and gets none of it. The whole puppet is squashed to `tilt` about its ground point:
// the camera sits above the table. Shots and parts never ask for this; the look does.
export function asCutout(g, look) {
  const pup = cutoutOf(g);
  if (!pup) throw new TypeError(`asCutout: '${g?.cel ?? g?.name}' is not a puppet's cel`);
  const c = look.cutout, u = pup.units / 100, [gx, gy] = pup.ground;
  const off = 3 * u, q = 2 * u, ew = c.edge * u, r = c.fastener * u;
  // A screen-space offset (dx, dy) in the coordinates under matrix m.
  const local = (m, dx, dy) => { const det = m[0] * m[3] - m[1] * m[2] || 1; return [(m[3] * dx - m[2] * dy) / det, (m[0] * dy - m[1] * dx) / det]; };
  const silhouette = (ops) => ops.flatMap((op) => (op.op === 'fill' ? [fill(op.path, 'ink', { seed: op.seed })]
    : op.op === 'stroke' ? [withProps(op, { role: 'ink', alpha: undefined })]
      : op.op === 'group' ? [withProps(op, { kids: silhouette(op.kids) })] : []));
  const edges = (ops) => ops.flatMap((op) => (op.op === 'fill' && op.role !== 'light' && op.role !== 'paper' && op.role !== 'ink'
    ? [stroke(op.path, 'light', { w: ew, wobble: 0, alpha: 0.9, seed: op.seed, name: 'edge' })]
    : op.op === 'group' ? [withProps(op, { kids: edges(op.kids) })] : []));
  // One piece's own drawing (a run of its kids that are not parts) as card, in coordinates under m.
  const card = (run, m, part) => {
    if (part === 'print' || !run.length) return run;
    const [sx, sy] = local(m, off, off), [ex, ey] = local(m, -ew, -ew);
    const sil = silhouette(run), rim = edges(run);
    return [
      ...(sil.length ? [fx('soft', { q, alpha: c.shadow }, [group({ name: 'shadow', xf: translate(sx, sy) }, sil)])] : []),
      ...run,
      ...(rim.length ? [group({ name: 'edge', xf: translate(ex, ey) }, rim)] : []),
    ];
  };
  // A domed brass head: a dark rim, the brass, a fine dot screen of light towards the upper left.
  const fastener = () => [
    fill(circle(0, 0, r, 16), { base: 'accents.2', shade: 0.45 }, { name: 'fastener' }),
    fill(circle(0, 0, r * 0.82, 16), 'accents.2', { name: 'fastener' }),
    dots(circle(-r * 0.2, -r * 0.2, r * 0.5, 12), { base: 'accents.2', tint: 0.6 }, { cell: r * 0.22, density: 0.6, name: 'fastener' }),
  ];
  const walkIn = (ops, m, part) => {
    const out = [];
    let run = [];
    const flush = () => { out.push(...card(run, m, part)); run = []; };
    for (const op of ops) {
      const kind = op.op === 'group' ? pup.kinds[op.name] ?? (op.name === 'mirror' ? 'print' : undefined) : undefined;
      if (kind) {
        flush();
        out.push(withProps(op, { kids: [...walkIn(op.kids, mmul(m, op.xf), kind), ...(kind === 'joint' ? fastener() : [])] }));
      } else run.push(op);
    }
    flush();
    return out;
  };
  const tilt = mmul(translate(gx, gy), mmul(scale(1, c.tilt), translate(-gx, -gy)));
  const { cel: _cel, box, ...rest } = g;   // no longer a puppet's cel: the pass does not see it twice
  const grown = box && [box[0] - ew, box[1] - ew, box[2] + ew + off + 2 * q, box[3] + ew + off + 2 * q];
  return group({ ...rest, cutout: g.cel, ...(grown ? { box: grown } : {}) }, [group({ name: 'table', xf: tilt, cache: 'never' }, walkIn(g.kids, tilt, 'print'))]);
}
