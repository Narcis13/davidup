// The workbench (4.0 W2): what the player's Rig tab does to a puppet, as pure functions. Two halves:
//
// Posing, on a built puppet (`make`, puppet(payload)) and a full input set (`state`), in the drawing's own
// coordinates (a negative dir's mirror included, as the tab draws it):
//
//   handles(make, state, { ik })         where the tab draws its grips: [{ part, kind, at, pivot }], kind
//                                        'turn' (the part turns about its pivot; the grip at its one child's
//                                        pivot, its own drawing's middle, or that drawing's far end when the
//                                        middle is the pivot or a slide grip), 'slide' (a pupil, a brow: its
//                                        slide inputs) or 'reach' (with ik, a hand or foot at the wrist or
//                                        ankle of a two-bone limb: K5's reach moves the limb)
//   turnTo(make, part, from, start, to)  FK: the joint that turns the part so a point grabbed at `from` (with
//                                        the puppet at `start`) follows to `to`, on the joint's grid
//   slideTo(make, part, from, start, to) the slide inputs that carry the part's grip from `from` to `to`
//   reachTo(make, part, state, to)       IK: the two-bone limb's patch putting the wrist or ankle at `to`
//   poseOf(make, state)                  the state as a pose: the inputs that differ from rest (dir left out)
//   zeroOf(make, dir)                    every joint at 0, slides 0, scales 1: the drawing pivots are set in
//
// Editing, on the payload's JSON (what the store holds: ops serialised with $p paths); each returns a new
// payload and leaves the one it was given alone:
//
//   recordPose(d, name, pose, { rest })  poses[name] = pose; recording 'rest' fills the old rest values (the
//                                        built puppet's `rest` for a key the payload leaves to its default)
//                                        into every other pose and frame, so they draw as before
//   dropPose(d, name)
//   recordFrame(d, cycle, frame, { at, replace, fps })   a frame into cycles[cycle] (made at fps, default 12):
//                                        appended, inserted at `at`, or replacing frame `at`; n kept, a
//                                        captured advance (K7) kept a number a frame
//   dropFrame(d, cycle, i)               the last frame drops the cycle
//   cycleFps(d, cycle, fps)
//   movePivot(d, part, [x, y], { view }) the part turns about a new point and draws where it did: its ops (and
//                                        its variants, the parts riding its pivot, the sockets on them) move
//                                        the other way; with views, only `view` moves when anything of it is
//                                        drawn by view (the part is keyed by every view first, each as it
//                                        resolved, so the other views draw as they did); a rig sheet's
//                                        skeleton follows a side-view move
//   setSocket(d, name, { part, at, angle }, { view })     a socket (K8) placed; keyed by view when it was
//   dropSocket(d, name)
//   growBox(d, box)                      the declared box grown to hold `box` (the stage fits a figure by its
//                                        box's height, so a taller box draws the puppet smaller everywhere)
//
// A payload the workbench recorded into lists what it recorded under `workbench: { poses, cycles }`, so a
// source re-imported over it (`hdf sketch`, `hdf stick`, `hdf svg`) keeps them (cli/svg.mjs keepRetargeted).
// Browser-safe.
import { FPS } from './curves.js';
import { reachIn } from './ik.js';
import { mapply } from './list.js';

const RAD = Math.PI / 180;
const wrap180 = (a) => ((a + 540) % 360) - 180;
const r2 = (v) => Math.round(v * 100) / 100 || 0;
const keyed = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const NAME = /^[a-z][a-z0-9-]*$/i;
const inv = (m) => {
  const [a, b, c, d, e, f] = m, det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
const originOf = (m) => [m[4], m[5]];

// ---------- posing ----------

const specOf = (make, key) => make.cel.inputs?.[key];
// A numeric input (a joint, a slide, a scale) on its own grid and inside its range; never -0.
export function quantise(make, key, v) {
  const s = specOf(make, key);
  if (!Array.isArray(s) || s.length !== 3 || !s.every(Number.isFinite)) return v;
  const [lo, hi, st] = s;
  return +Math.min(hi, Math.max(lo, lo + Math.round((v - lo) / st) * st)).toFixed(6) || 0;
}
const isVariant = (make, n) => !!make.puppet?.parts?.[n]?.variants;
const hasPivot = (make, n) => make.puppet?.parts?.[n]?.pivot !== undefined;
const full = (make, state) => ({ ...make.rest, ...state });

// The two-bone limbs whose end is this part: { upper, lower } or null.
function limbEnd(make, n) {
  const m = /^(hand|foot)-(l|r)$/.exec(n);
  if (!m) return null;
  const [up, low] = m[1] === 'hand' ? ['arm', 'fore'] : ['leg', 'shin'];
  const upper = `${up}-${m[2]}`, lower = `${low}-${m[2]}`;
  return make.parentOf(n) === lower && make.parentOf(lower) === upper ? { upper, lower } : null;
}

export function handles(make, state = {}, { ik = true } = {}) {
  const q = full(make, state), out = [];
  const reachEnds = ik ? make.parts.filter((n) => limbEnd(make, n)) : [];
  const driven = new Set(reachEnds.map((n) => make.parentOf(n)));   // a forearm or shin the reach turns
  const middle = (n) => { const b = make.inkOf(n, q); return b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : null; };
  // The far end of a part's drawing from its pivot: a grip for a part that turns about its own middle (a brow).
  const end = (n, pv) => {
    const b = make.inkOf(n, q);
    if (!b) return null;
    const ends = [[b[0], b[1] + b[3] / 2], [b[0] + b[2], b[1] + b[3] / 2], [b[0] + b[2] / 2, b[1]], [b[0] + b[2] / 2, b[1] + b[3]]];
    return ends.reduce((a, c) => (Math.hypot(c[0] - pv[0], c[1] - pv[1]) > Math.hypot(a[0] - pv[0], a[1] - pv[1]) ? c : a));
  };
  const apart = (a, b) => !!a && Math.hypot(a[0] - b[0], a[1] - b[1]) >= 1;
  for (const n of make.parts) {
    if (isVariant(make, n)) continue;
    const pivot = originOf(make.worldOf(n, q)), slides = !!(make.moves[`${n}.x`] || make.moves[`${n}.y`]);
    if (hasPivot(make, n) && !driven.has(n)) {
      const kids = make.parts.filter((c) => make.parentOf(c) === n && hasPivot(make, c));
      let at = kids.length === 1 ? originOf(make.worldOf(kids[0], q)) : middle(n);
      if (!apart(at, pivot) || (slides && kids.length !== 1)) at = end(n, pivot);
      if (apart(at, pivot)) out.push({ part: n, kind: 'turn', at, pivot });
    }
    if (slides) out.push({ part: n, kind: 'slide', at: middle(n) ?? pivot, pivot });
  }
  for (const n of reachEnds) out.push({ part: n, kind: 'reach', at: originOf(make.worldOf(n, q)), pivot: originOf(make.worldOf(make.parentOf(n), q)) });
  return out;
}

// FK: the joint of `part` after a drag from `from` to `to` (drawing points) that began at state `start`.
export function turnTo(make, part, from, start, to) {
  const q = full(make, start), m = make.worldOf(part, q), [px, py] = originOf(m);
  let d = wrap180((Math.atan2(to[1] - py, to[0] - px) - Math.atan2(from[1] - py, from[0] - px)) / RAD);
  if (m[0] * m[3] - m[1] * m[2] < 0) d = -d;   // a mirrored drawing turns the other way
  return { [part]: quantise(make, part, wrap180((q[part] ?? 0) + d)) };
}

// The slide inputs after a drag from `from` to `to`: the move in the parent's frame (a slide is applied
// there, before the part turns), on each axis's grid.
export function slideTo(make, part, from, start, to) {
  const q = full(make, start), pn = make.parentOf(part);
  const pm = pn === undefined ? make.worldOf(part, { ...q, [part]: 0 }) : make.worldOf(pn, q);
  const I = inv([pm[0], pm[1], pm[2], pm[3], 0, 0]), [dx, dy] = mapply(I, to[0] - from[0], to[1] - from[1]);
  const out = {};
  for (const [a, dv] of [['x', dx], ['y', dy]]) {
    const key = `${part}.${a}`;
    if (make.moves[key]) out[key] = quantise(make, key, (q[key] ?? 0) + dv);
  }
  return out;
}

// IK: the limb whose end is `part` reaches `to` (a drawing point) with K5's two-bone solve.
export function reachTo(make, part, state, to) {
  const q = full(make, state), mirrored = !!make.views && (q.dir ?? 1) < 0;
  const t = mirrored ? [2 * make.ground[0] - to[0], to[1]] : to;
  return reachIn({ puppet: make, name: make.cel.name }, part, t, q);
}

// The state as a pose: every input that differs from rest, the view (dir) and anything not an input left out.
export function poseOf(make, state) {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (k === 'dir' || specOf(make, k) === undefined) continue;
    if (String(v) !== String(make.rest[k])) out[k] = v;
  }
  return out;
}

// The zero drawing (joints 0, slides 0, scales 1, variants at rest) facing +x in the view of dir: where the
// payload's pivots are, drawing point for drawing point.
export function zeroOf(make, dir = 1) {
  const out = { ...make.rest };
  for (const n of make.parts) if (!isVariant(make, n)) out[n] = 0;
  for (const k of Object.keys(make.moves)) out[k] = /\.s[xy]$/.test(k) ? 1 : 0;
  if (make.views) out.dir = Math.abs(dir);
  return out;
}

// ---------- editing the payload ----------

const need = (d, what) => {
  if (!d || typeof d !== 'object' || !d.parts) throw new TypeError(`workbench: ${what} takes a puppet payload`);
};
const named = (what, name) => {
  if (typeof name !== 'string' || !NAME.test(name)) throw new TypeError(`workbench: a ${what} name is letters, digits and dashes, starting with a letter (got ${JSON.stringify(name)})`);
};
const noted = (d, list, name) => {
  const w = { poses: [], cycles: [], ...(d.workbench ?? {}) };
  if (!w[list].includes(name)) w[list] = [...w[list], name].sort();
  return { ...d, workbench: w };
};
const unnoted = (d, list, name) => {
  if (!d.workbench?.[list]?.includes(name)) return d;
  const w = { ...d.workbench, [list]: d.workbench[list].filter((x) => x !== name) };
  const { workbench: _w, ...rest } = d;
  return w.poses.length || w.cycles.length ? { ...rest, workbench: w } : rest;
};

export function recordPose(d, name, pose, { rest = {} } = {}) {
  need(d, 'recordPose');
  named('pose', name);
  const out = clone(d);
  out.poses = { ...(out.poses ?? {}) };
  if (name === 'rest') {
    // Every other pose and frame names what it moves against rest; a key the new rest moves keeps its old value
    // there, so they draw as they did.
    const old = out.poses.rest ?? {};
    const moved = Object.keys(pose).filter((k) => String(pose[k]) !== String(old[k]));
    const fill = (st) => { for (const k of moved) if (st[k] === undefined) st[k] = old[k] ?? rest[k] ?? 0; };
    for (const [pn, p] of Object.entries(out.poses)) if (pn !== 'rest') fill(p);
    for (const c of Object.values(out.cycles ?? {})) for (const f of c.frames ?? []) fill(f);
    out.poses.rest = { ...old, ...pose };
    return out;
  }
  out.poses[name] = { ...pose };
  return noted(out, 'poses', name);
}

export function dropPose(d, name) {
  need(d, 'dropPose');
  if (!d.poses?.[name]) throw new Error(`workbench: no pose '${name}' (has ${Object.keys(d.poses ?? {}).join(', ') || 'none'})`);
  if (name === 'rest') throw new Error("workbench: the rest pose stays (record over it instead)");
  const out = clone(d);
  delete out.poses[name];
  return unnoted(out, 'poses', name);
}

export function recordFrame(d, cycle, frame, { at, replace = false, fps = FPS } = {}) {
  need(d, 'recordFrame');
  named('cycle', cycle);
  const out = clone(d);
  out.cycles = { ...(out.cycles ?? {}) };
  const c = out.cycles[cycle] ?? { fps, n: 0, frames: [] };
  const frames = [...(c.frames ?? [])], i = at === undefined ? frames.length : Math.max(0, Math.min(frames.length, at | 0));
  if (replace && !frames.length) throw new Error(`workbench: cycle '${cycle}' has no frame ${i} to replace`);
  const advance = Array.isArray(c.advance) ? [...c.advance] : null;
  if (replace) frames[Math.min(i, frames.length - 1)] = { ...frame };
  else {
    frames.splice(i, 0, { ...frame });
    advance?.splice(i, 0, advance[Math.max(0, i - 1)] ?? 0);
  }
  out.cycles[cycle] = { ...c, n: frames.length, frames, ...(advance ? { advance } : {}) };
  return noted(out, 'cycles', cycle);
}

export function dropFrame(d, cycle, i) {
  need(d, 'dropFrame');
  const c = d.cycles?.[cycle];
  if (!c?.frames?.[i]) throw new Error(`workbench: cycle '${cycle}' has no frame ${i}`);
  const out = clone(d);
  if (c.frames.length === 1) { delete out.cycles[cycle]; return unnoted(out, 'cycles', cycle); }
  const oc = out.cycles[cycle];
  oc.frames.splice(i, 1);
  oc.advance?.splice(i, 1);
  oc.n = oc.frames.length;
  return out;
}

export function cycleFps(d, cycle, fps) {
  need(d, 'cycleFps');
  if (!d.cycles?.[cycle]) throw new Error(`workbench: no cycle '${cycle}'`);
  if (!(fps > 0 && fps <= 60)) throw new TypeError(`workbench: fps ${fps}; a cycle plays at 1..60 frames a second`);
  const out = clone(d);
  out.cycles[cycle].fps = +fps;
  return noted(out, 'cycles', cycle);
}

// ---------- pivots ----------

// Serialised ops moved by (dx, dy): paths point by point, a group's matrix, a text's or an image's place.
export function shiftOps(list, dx, dy) {
  const pts = (a) => a.map((v, i) => r2(v + (i % 2 ? dy : dx)));
  const path = (p) => (Array.isArray(p?.$p) ? { $p: p.$p.map(([c, ...xy]) => [c, ...pts(xy)]) }
    : Array.isArray(p?.sub) ? { ...p, sub: p.sub.map((s) => ({ ...s, pts: pts(s.pts) })), ...(p.box ? { box: [r2(p.box[0] + dx), r2(p.box[1] + dy), p.box[2], p.box[3]] } : {}) } : p);
  const op = (o) => {
    const out = { ...o };
    if (o.op === 'group') { const m = o.xf ?? [1, 0, 0, 1, 0, 0]; out.xf = [m[0], m[1], m[2], m[3], r2(m[4] + dx), r2(m[5] + dy)]; return out; }
    if (o.path) out.path = path(o.path);
    if ((o.op === 'text' || o.op === 'image') && Number.isFinite(o.x)) { out.x = r2(o.x + dx); out.y = r2(o.y + dy); }
    if (Array.isArray(o.kids)) out.kids = o.kids.map(op);
    return out;
  };
  return list.map(op);
}

// How puppet.js resolves a part in a view (see there): the view it draws from, its own pivot.
function resolver(d) {
  const views = Array.isArray(d.views) && d.views.length ? d.views : null;
  const drawnIn = (n, V) => { const p = d.parts[n]; return (keyed(p.ops) && p.ops[V] !== undefined) || Object.values(p.variants ?? {}).some((v) => keyed(v) && v[V] !== undefined); };
  const viewFor = (n, V) => (!views || drawnIn(n, V) ? V : views[0]);
  const inView = (v, V) => (keyed(v) ? v[V] ?? v[views[0]] : v);
  const ownPivot = (n, V) => {
    const pv = d.parts[n].pivot;
    return !keyed(pv) ? pv : pv[V] !== undefined || (views && drawnIn(n, V)) ? pv[V] : pv[views[0]];
  };
  return { views, viewFor, inView, ownPivot };
}

// The joint a rig sheet's skeleton (4.0 W1) keeps at a part's pivot, by the part's stem.
const SKELETON_JOINT = { arm: 'shoulder', fore: 'elbow', hand: 'wrist', leg: 'hip', shin: 'knee', foot: 'ankle', head: 'neck', hips: 'hip' };

export function movePivot(d, part, to, { view } = {}) {
  need(d, 'movePivot');
  const p = d.parts[part];
  if (!p) throw new Error(`workbench: no part '${part}' (has ${Object.keys(d.parts).join(', ')})`);
  if (p.pivot === undefined) throw new Error(`workbench: '${part}' has no pivot of its own (it rides its parent's)`);
  if (!Array.isArray(to) || to.length !== 2 || !to.every(Number.isFinite)) throw new TypeError(`workbench: a pivot is [x, y], got ${JSON.stringify(to)}`);
  const R = resolver(d), V = R.views ? view ?? R.views[0] : null;
  if (R.views && !R.views.includes(V)) throw new Error(`workbench: no view '${V}' (views: ${R.views.join(', ')})`);
  const out = clone(d), P = out.parts;
  // The part and every part that rides its pivot (no pivot of its own, all the way down).
  const riders = [part];
  for (let i = 0; i < riders.length; i++) for (const [n, q] of Object.entries(d.parts)) if (q.parent === riders[i] && q.pivot === undefined) riders.push(n);
  const sockets = Object.entries(out.sockets ?? {}).map(([sn, s]) => [sn, Array.isArray(s) ? { part: sn, at: s.slice(0, 2), angle: s[2] ?? 0 } : s]).filter(([, s]) => riders.includes(s.part));
  const byView = R.views && (keyed(p.pivot) || riders.some((n) => keyed(d.parts[n].ops) || Object.values(d.parts[n].variants ?? {}).some(keyed))
    || sockets.some(([, s]) => keyed(s.at)));
  const to2 = [r2(to[0]), r2(to[1])];
  let from;
  if (!byView) {
    from = p.pivot;
    const dx = to2[0] - from[0], dy = to2[1] - from[1];
    P[part].pivot = to2;
    for (const n of riders) {
      if (P[n].ops) P[n].ops = shiftOps(P[n].ops, -dx, -dy);
      for (const k of Object.keys(P[n].variants ?? {})) P[n].variants[k] = shiftOps(P[n].variants[k], -dx, -dy);
    }
    for (const [sn, s] of sockets) out.sockets[sn] = { ...s, at: [r2(s.at[0] - dx), r2(s.at[1] - dy)] };
  } else {
    // Every view spelt out as it resolved, then only V moves.
    const all = (fn) => Object.fromEntries(R.views.map((W) => [W, clone(fn(W))]));
    P[part].pivot = all((W) => R.ownPivot(part, W));
    for (const n of riders) {
      const q = d.parts[n];
      if (q.ops !== undefined) P[n].ops = all((W) => R.inView(q.ops, R.viewFor(n, W)) ?? []);
      for (const k of Object.keys(q.variants ?? {})) P[n].variants[k] = all((W) => R.inView(q.variants[k], R.viewFor(n, W)) ?? []);
    }
    from = P[part].pivot[V];
    const dx = to2[0] - from[0], dy = to2[1] - from[1];
    P[part].pivot[V] = to2;
    for (const n of riders) {
      if (P[n].ops) P[n].ops[V] = shiftOps(P[n].ops[V], -dx, -dy);
      for (const k of Object.keys(P[n].variants ?? {})) P[n].variants[k][V] = shiftOps(P[n].variants[k][V], -dx, -dy);
    }
    for (const [sn, s] of sockets) {
      const at = keyed(s.at) ? { ...s.at } : Object.fromEntries(R.views.map((W) => [W, s.at]));
      const was = at[V] ?? at[R.views[0]];
      out.sockets[sn] = { ...s, at: { ...at, [V]: [r2(was[0] - dx), r2(was[1] - dy)] } };
    }
  }
  // A rig sheet's skeleton is the side view's joints: a side move takes its joint along.
  const stem = part.replace(/-(l|r)$/, ''), side = /-(l|r)$/.exec(part)?.[1], j = SKELETON_JOINT[stem];
  if (out.skeleton?.joints && j && (!R.views || V === 'side' || (!R.views.includes('side') && V === R.views[0]))) {
    const key = side && stem !== 'head' && stem !== 'hips' ? `${j}-${side}` : j;
    if (out.skeleton.joints[key]) out.skeleton.joints[key] = to2;
  }
  return out;
}

// ---------- sockets ----------

export function setSocket(d, name, { part, at, angle = 0 }, { view } = {}) {
  need(d, 'setSocket');
  named('socket', name);
  if (!d.parts[part]) throw new Error(`workbench: no part '${part}' for socket '${name}'`);
  if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isFinite)) throw new TypeError(`workbench: a socket is at [x, y], got ${JSON.stringify(at)}`);
  const R = resolver(d), V = R.views ? view ?? R.views[0] : null;
  const was = d.sockets?.[name], cur = Array.isArray(was) ? { part: name, at: was.slice(0, 2), angle: was[2] ?? 0 } : was;
  const at2 = [r2(at[0]), r2(at[1])], ang = Math.round(angle);
  let next;
  if (cur && cur.part === part && R.views && (keyed(cur.at) || keyed(cur.angle))) {
    const spell = (v, W) => (keyed(v) ? v[W] ?? v[R.views[0]] : v);
    next = {
      part,
      at: keyed(cur.at) ? { ...cur.at, [V]: at2 } : Object.fromEntries(R.views.map((W) => [W, W === V ? at2 : spell(cur.at, W)])),
      angle: keyed(cur.angle) ? { ...cur.angle, [V]: ang } : cur.angle === ang ? ang : Object.fromEntries(R.views.map((W) => [W, W === V ? ang : cur.angle])),
    };
  } else next = part === name && !keyed(cur?.at) && Array.isArray(was) ? [...at2, ang] : { part, at: at2, angle: ang };
  return { ...clone(d), sockets: { ...(d.sockets ?? {}), [name]: next } };
}

export function dropSocket(d, name) {
  need(d, 'dropSocket');
  if (!d.sockets?.[name]) throw new Error(`workbench: no socket '${name}'`);
  const out = clone(d);
  delete out.sockets[name];
  if (!Object.keys(out.sockets).length) delete out.sockets;
  return out;
}

export function growBox(d, b) {
  need(d, 'growBox');
  const a = Array.isArray(d.box) ? d.box : null;
  if (!a) return d;   // no declared box: the import measures it
  const x0 = Math.floor(Math.min(a[0], b[0])), y0 = Math.floor(Math.min(a[1], b[1]));
  const x1 = Math.ceil(Math.max(a[0] + a[2], b[0] + b[2])), y1 = Math.ceil(Math.max(a[1] + a[3], b[1] + b[3]));
  return { ...clone(d), box: [x0, y0, x1 - x0, y1 - y0] };
}
