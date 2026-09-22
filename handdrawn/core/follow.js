// Secondary motion (4.0 K6): tails, ears, hair and scarves follow through.
//
//   parts.tail:  { parent: 'body', pivot: [-34, -128], follow: { lag: 2, damp: 0.7 }, ops: [...] }
//   parts.scarf: { parent: 'neck', pivot: [0, -236], chain: { n: 4, len: 18, w: 7, angle: 70 }, follow: { damp: 0.35 } }
//
//   FOX.cycle('walk', t)                      a cycle's frame, its follow parts settled on the loop (frameOf)
//   FOX.settle(stateAt, t)                    { tail: deg }: the follow parts at t, from stateAt's history
//   SAM.place(x, y, s, act.state, t)          the actor settles them itself when handed a state function
//
// A follow part's joint is not a value the film gives but a consequence of what its parent did. Its world
// angle is a damped spring towards its target (the parent's world angle plus the part's own stated angle, so
// a stated wag still wags), and the pivot's acceleration swings it like a pendulum (a jump, a stop). The
// spring is run over the frames before t on the 1/12 s grid, from rest a few settling times back, reading
// the state function at each; so the answer is a pure function of t and needs no frame memory: a worker
// starting its range anywhere draws the same frame. A state that never changes settles to exactly its own
// stated angles, so a still pose draws as it did before the part followed anything.
//
// follow: { lag, damp, inertia, limit, len }
//   lag      frames the part takes to catch up (default 2): the spring's natural frequency is 2 / lag a frame
//   damp     0 < damp <= 1, the damping ratio (default 0.7): 1 settles with no swing, 0.3 swings a few times
//   inertia  how much the pivot's acceleration swings it (default 1, 0 for none)
//   limit    the most it may trail its target, degrees (default 75)
//   len      the pendulum's length in drawing units (default: from the part's own ink, 4/3 of the distance from
//            the pivot to the ink's centre, as a rod swung from one end)
//
// chain: { n, len, w, angle, role, taper } makes a rope of n parts from one: the part itself is the first
// link and `<part>-2` .. `<part>-n` hang from it, each a stroke `len` long pointing `angle` degrees from
// straight down (a positive angle turns it back, towards -x, as a positive joint does), `w` wide narrowing by
// `taper` (0..1) to the tip, in `role` (default ink). Every link follows (the part's follow, or the default),
// so a turn of the neck runs down the scarf a link at a time. The links take the part's place in painter
// order; the part's own ops, if any, draw on the first link (a knot).
import { FPS } from './curves.js';
import { bounds, line, serialise, stroke } from './list.js';

// The follow defaults a part gets for whatever it does not say.
export const FOLLOW = Object.freeze({ lag: 2, damp: 0.7, inertia: 1, limit: 75 });
const RAD = Math.PI / 180;
const SUB = 4;          // spring substeps a frame
const MAX_WINDOW = 96;  // frames of history at most (8 s)

// A part's follow spec, checked and filled with the defaults, or null. `chained` gives a chain link the
// defaults when the part names no follow of its own.
export function followOf(p, n, name = 'puppet', chained = false) {
  const f = p?.follow ?? (chained ? {} : undefined);
  if (f === undefined || f === null || f === false) return null;
  if (f === true) return FOLLOW;
  if (typeof f !== 'object' || Array.isArray(f)) throw new Error(`puppet ${name}: part '${n}' follow is { lag, damp, inertia, limit, len }`);
  for (const k of Object.keys(f)) if (!['lag', 'damp', 'inertia', 'limit', 'len'].includes(k)) throw new Error(`puppet ${name}: part '${n}' follow has '${k}' (takes lag, damp, inertia, limit, len)`);
  const out = { ...FOLLOW, ...f };
  if (!(out.lag > 0 && out.lag <= 24)) throw new Error(`puppet ${name}: part '${n}' follow.lag ${f.lag}: frames, above 0 and at most 24`);
  if (!(out.damp > 0 && out.damp <= 1)) throw new Error(`puppet ${name}: part '${n}' follow.damp ${f.damp}: above 0 and at most 1`);
  if (!(Number.isFinite(out.inertia) && out.inertia >= 0)) throw new Error(`puppet ${name}: part '${n}' follow.inertia ${f.inertia}: 0 or more`);
  if (!(out.limit > 0 && out.limit <= 180)) throw new Error(`puppet ${name}: part '${n}' follow.limit ${f.limit}: degrees, above 0 and at most 180`);
  if (f.len !== undefined && !(f.len > 0)) throw new Error(`puppet ${name}: part '${n}' follow.len ${f.len}: drawing units, above 0`);
  if (p.variants) throw new Error(`puppet ${name}: part '${n}' switches variants; only a part that turns can follow`);
  if (p.parent === undefined) throw new Error(`puppet ${name}: part '${n}' follows, but has no parent to follow`);
  return Object.freeze(out);
}

// ---------- chains ----------

const r2 = (v) => Math.round(v * 100) / 100;
const keyed = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const expanded = new WeakMap();

// A payload with every `chain` part expanded into its links (the same object when it has none).
export function expandChains(d) {
  if (!d?.parts || !Object.values(d.parts).some((p) => p?.chain)) return d;
  let out = expanded.get(d);
  if (out) return out;
  const name = d.name ?? 'puppet', parts = {};
  for (const [n, p] of Object.entries(d.parts)) {
    if (!p?.chain) { parts[n] = p; continue; }
    const c = p.chain;
    if (typeof c !== 'object' || Array.isArray(c)) throw new Error(`puppet ${name}: part '${n}' chain is { n, len, w, angle, role, taper }`);
    for (const k of Object.keys(c)) if (!['n', 'len', 'w', 'angle', 'role', 'taper'].includes(k)) throw new Error(`puppet ${name}: part '${n}' chain has '${k}' (takes n, len, w, angle, role, taper)`);
    const { n: count = 4, len, w = 4, angle = 0, role = 'ink', taper = 0 } = c;
    if (!(Number.isInteger(count) && count >= 1 && count <= 16)) throw new Error(`puppet ${name}: part '${n}' chain.n ${count}: 1 to 16 links`);
    if (!(len > 0)) throw new Error(`puppet ${name}: part '${n}' chain.len ${len}: each link's length, above 0`);
    if (!(w > 0)) throw new Error(`puppet ${name}: part '${n}' chain.w ${w}: above 0`);
    if (!(taper >= 0 && taper < 1)) throw new Error(`puppet ${name}: part '${n}' chain.taper ${taper}: 0 up to 1`);
    if (!Number.isFinite(angle)) throw new Error(`puppet ${name}: part '${n}' chain.angle ${angle}: degrees from straight down`);
    if (p.parent === undefined) throw new Error(`puppet ${name}: part '${n}' is a chain with no parent to hang from`);
    if (p.pivot === undefined) throw new Error(`puppet ${name}: part '${n}' is a chain with no pivot to hang from`);
    if (p.variants) throw new Error(`puppet ${name}: part '${n}' is a chain; a chain's links turn, they do not switch variants`);
    // rotate(angle) . (0, len): down at 0, back (-x) for a positive angle.
    const a = angle * RAD, v = [r2(-Math.sin(a) * len), r2(Math.cos(a) * len)];
    const follow = p.follow ?? {};
    const along = (pv, k) => (keyed(pv)
      ? Object.fromEntries(Object.entries(pv).map(([V, q]) => [V, [r2(q[0] + k * v[0]), r2(q[1] + k * v[1])]]))
      : [r2(pv[0] + k * v[0]), r2(pv[1] + k * v[1])]);
    const { chain: _c, ops: own, ...keep } = p;
    for (let k = 0; k < count; k++) {
      const lw = r2(w * (1 - taper * k / count)), id = k ? `${n}-${k + 1}` : n;
      const seg = JSON.parse(serialise([stroke(line(0, 0, v[0], v[1]), role, { w: lw, name: id })]));
      parts[id] = k === 0
        ? { ...keep, follow, ops: [...seg, ...(Array.isArray(own) ? own : [])] }
        : { parent: k === 1 ? n : `${n}-${k}`, pivot: along(p.pivot, k), follow, ops: seg };
    }
    for (let k = 1; k < count; k++) if (d.parts[`${n}-${k + 1}`]) throw new Error(`puppet ${name}: part '${n}' is a chain of ${count}, but '${n}-${k + 1}' is a part already`);
  }
  out = { ...d, parts };
  expanded.set(d, out);
  return out;
}

// ---------- the spring ----------

// settler(rig) => settle(stateAt, t, { lift }) for a built puppet. rig: { name, names, parentOf, follows:
// { n: spec }, rest, worldOf(n, q), arm(n) } where arm(n) is [x, y], the part's ink centre in its own frame.
// settle returns { n: degrees } for every follow part, each on its joint's grid and in its range.
export function settler({ name, parentOf, follows, rest, worldOf, arm, inputs }) {
  const order = Object.keys(follows);
  if (!order.length) return () => ({});
  // Parents first, so a link reads the settled angle of the one above it.
  const depth = (n) => { let k = 0; for (let c = parentOf(n); c !== undefined; c = parentOf(c)) k++; return k; };
  order.sort((a, b) => depth(a) - depth(b));
  // How far back to start: long enough for the spring (and every follow part above it) to forget where it
  // began, e^-5 of it. Decay per frame is damp * 2 / lag.
  const above = (n) => { let s = 0; for (let c = n; c !== undefined; c = parentOf(c)) if (follows[c]) s += 2.5 * follows[c].lag / follows[c].damp; return s; };
  const window = Math.min(MAX_WINDOW, Math.ceil(Math.max(...order.map(above))) + 2);
  const geo = Object.fromEntries(order.map((n) => {
    const [ax, ay] = arm(n), d = Math.hypot(ax, ay), f = follows[n];
    return [n, { L: f.len ?? Math.max(1, d * 4 / 3), dir: d > 1e-6 ? [ax / d, ay / d] : [0, 1] }];
  }));
  const angleOf = (m) => Math.atan2(m[1], m[0]) / RAD;
  const snap = (n, v) => {
    const [lo, hi, step] = Array.isArray(inputs[n]) && inputs[n].length === 3 ? inputs[n] : [-180, 180, 2];
    const q = Math.round((Math.max(lo, Math.min(hi, v)) - lo) / step) * step + lo;
    return Math.abs(q) < 1e-9 ? 0 : Math.round(q * 1e6) / 1e6;
  };
  const wrap = (a) => a - 360 * Math.round(a / 360);

  return (stateAt, t, o = {}) => {
    if (typeof stateAt !== 'function') throw new TypeError(`puppet ${name}: settle(stateAt, t) takes a state function of time`);
    if (!Number.isFinite(t)) throw new TypeError(`puppet ${name}: settle(stateAt, t) needs a time`);
    const liftK = o.lift ?? 0, N = window;
    // The history, oldest first: frame j is at t - (N - j) / 12.
    const Q = Array.from({ length: N + 1 }, (_, j) => {
      // (t * 12 - k) / 12, so a t on the grid reads its history at exactly the times a film writes as i / 12.
      const s = stateAt((t * FPS - (N - j)) / FPS) ?? {};
      return { ...rest, ...s };
    });
    const lifts = Q.map((q) => (liftK && Number.isFinite(q.lift) ? q.lift * liftK : 0));
    const told = Object.fromEntries(order.map((n) => [n, Q[N][n]]));
    for (const n of order) {
      const f = follows[n], g = geo[n], w = 2 / f.lag, z = f.damp, h = 1 / SUB;
      const P = new Array(N + 1), pos = new Array(N + 1), tgt = new Array(N + 1);
      for (let j = 0; j <= N; j++) {
        const q = Q[j], own = Number.isFinite(q[n]) ? q[n] : 0;
        const mp = worldOf(parentOf(n), q), m = worldOf(n, q);   // a pivot's place does not hang on its own turn
        P[j] = angleOf(mp);
        pos[j] = [m[4], m[5] - lifts[j]];
        tgt[j] = P[j] + own;
      }
      let th = tgt[0], v = 0;
      const out = new Array(N + 1);
      out[0] = th - P[0];
      for (let j = 1; j <= N; j++) {
        // The pivot's acceleration, frame over frame (backward, so t's answer needs nothing after t).
        const a = j >= 2 ? [pos[j][0] - 2 * pos[j - 1][0] + pos[j - 2][0], pos[j][1] - 2 * pos[j - 1][1] + pos[j - 2][1]] : [0, 0];
        // Target unwrapped next to where the part is, so a parent turning through 180 does not spin it.
        const T = th + wrap(tgt[j] - th);
        for (let k = 0; k < SUB; k++) {
          const c = Math.cos(th * RAD), s = Math.sin(th * RAD), dx = c * g.dir[0] - s * g.dir[1], dy = s * g.dir[0] + c * g.dir[1];
          const swing = f.inertia * (a[0] * dy - a[1] * dx) / g.L / RAD;
          const acc = w * w * (T - th) - 2 * z * w * v + swing;
          v += h * acc;
          th += h * v;
          if (th - T > f.limit) { th = T + f.limit; v = Math.min(v, 0); }
          if (T - th > f.limit) { th = T - f.limit; v = Math.max(v, 0); }
        }
        out[j] = th - P[j];
      }
      // Settled angles feed the parts below; only t's is handed back, on the grid.
      for (let j = 0; j <= N; j++) Q[j][n] = out[j];
    }
    const res = {};
    for (const n of order) {
      // A part whose spring came to rest where it was told draws exactly what it was told.
      const own = Q[N][n];
      res[n] = Math.abs(own - told[n]) < 1e-6 ? told[n] : snap(n, wrap(own));
    }
    return res;
  };
}

// The ink centre of a part's own drawing in its own frame (pivot at the origin), for the pendulum's length.
export const inkCentre = (ops) => {
  const b = ops?.length ? bounds(ops) : null;
  return b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : [0, 0];
};
