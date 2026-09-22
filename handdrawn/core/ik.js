// Reach, look-at, planted feet (4.0 K5): inverse kinematics where it earns its place -- hands, eyes, feet.
//
//   SAM.place(x, y, s, { ...state, ...reach(SAM, 'hand-r', [700, 380], { at: [x, y, s], state }) })
//   SAM.place(x, y, s, { ...state, reach: { 'hand-r': [700, 380] } })          // the same, done by place
//   SAM.place(x, y, s, { ...state, ...lookAt(SAM, [900, 200], { at: [x, y, s], state }) })
//   const w = walkTo(SAM, -150, 520, 0.5, 3, { s: 260 });  SAM.place(w.x(t), y, 260, w.state(t))
//   SAM.place(x, y, s, stand(SAM, act.state(t)))                               // feet on the ground line
//
// Everything works in the puppet's own drawing, unmirrored and facing +x (a stage point comes in through the
// actor's stage fit, `stager.local`), on the standard biped names, and hands back a state patch quantised on
// each input's own step, so a held reach dedups like a held pose. A code cel or a doodle builder has no
// skeleton: reach and lookAt give {} (lookAt turns it to face), walkTo slides it at `speed`.
//
// reach(actor, part, [x, y], { at: [x, y, s], state, elbow }) => { upper: deg, lower: deg }
//   part     'hand-l' | 'hand-r' (arm-, fore-, hand-) or 'foot-l' | 'foot-r' (leg-, shin-, foot-); naming
//            the upper or lower bone means the same limb
//   at       the actor's stage place; without it the target is in the drawing's own units
//   state    what the rest of the body is doing (a lean, a view, dir): the limb reaches from there
//   elbow    which way the middle joint bends: 'down' | 'up' | 'front' | 'back' | 'out' | 'in' (default: an
//            arm 'down', a leg 'front', in the front view 'out')
//   Analytic two-bone IK on shoulder-elbow-wrist (hip-knee-ankle): the end lands on the target, or the limb
//   straightens towards it when it is out of reach. A single-segment limb (the fox's arm) is aimed at it as
//   actor.place's `hand` always aimed one.
//
// lookAt(actor, target, { at, state, other, turn, max }) => { dir?, head?, 'pupil.x'?, 'pupil.y'? }
//   target   a stage point, or another actor (o.other: its place [x, y, s, state?]) to look at its head
//   turn     true (default): a puppet facing away turns round (dir, keeping its view); front on, it does not
//   max      the head's turn at most, degrees (default 30), and never so far the figure leaves its box; the
//            pupils take the rest of the way
//   The head (a side or three-quarter view) turns towards the target and the pupils slide the rest of the way,
//   in the head's frame; front on, only the pupils move. headAt(actor, x, y, s, state) is where its head is,
//   partAt(actor, part, [x, y, s], state) where a part's pivot is (a wrist, an ankle), on the stage.
//
// strideOf(actor, cycle) => { n, fps, advance: [per frame], stride, contacts, strikes }: how far the body
//   travels per frame of a cycle so the foot on the ground stays put, in drawing units: from the cycle's own
//   `advance` (K7) when its frames carry one, else measured from the ankles, frame to frame: the planted foot
//   is the lower of the feet moving back. contacts: the frames where both feet are down (a step's end); strikes:
//   the frames where the planted foot changes (a step lands).
// walkTo(actor, x0, x1, t0, t1, { s, cycle: 'walk', stand: true, hold }) => { x(t), state(t), t0, end, steps }
//   the actor walks from stage x0 to x1 at size s, starting at t0 and arriving at t1 (null: at the cycle's own
//   pace): the cycle's frames are dealt out over the time (a slow walk holds frames, a quick one skips), and
//   x follows the planted foot frame by frame, so feet do not slide; it arrives on a contact frame and holds
//   it `hold` s (default 1/6) before standing. state carries `walking` so place draws its feet for lint;
//   steps are the times a foot lands (for a score).
// stand(actor, state) => state with `lift` so the lower ankle is where the rest pose has it: feet on the
//   ground line whatever the pose (a bent knee sinks the body, a straight one lifts it).
// feetOf(actor, state) => [[x, y] -l, [x, y] -r] the ankles in the unmirrored drawing (null without legs).
import { FPS } from './curves.js';
import { celOverflow } from './lint.js';
import { mapply, meta } from './list.js';

const RAD = Math.PI / 180;
const wrap180 = (a) => ((a + 540) % 360) - 180;
const sideOf = (n) => /-(l|r)$/.exec(n)?.[1] ?? null;
const LIMBS = Object.freeze({ arm: ['arm', 'fore', 'hand'], leg: ['leg', 'shin', 'foot'] });
const BENDS = Object.freeze(['down', 'up', 'front', 'back', 'out', 'in']);
const inv = (m) => {
  const [a, b, c, d, e, f] = m, det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
const angleOfXf = (m) => Math.atan2(m[1], m[0]);

const skeleton = (actor, what) => {
  const p = actor?.puppet;
  if (!p?.worldOf) throw new TypeError(`${what}: ${actor?.name ?? 'actor'} is not a puppet (reach, lookAt and stride need a skeleton)`);
  return p;
};
// The full input set at a state (the stage's keys, dir aside, are ignored by the puppet).
const full = (p, state = {}) => ({ ...p.rest, ...state });
const mirrored = (p, q) => !!p.views && (q.dir ?? p.rest.dir) < 0;
// A stage point -> the unmirrored drawing, and back.
const toDrawing = (actor, [x, y, s], q, pt) => {
  const p = actor.puppet, [u, v] = actor.stage.local(x, y, s, q, pt);
  return mirrored(p, q) ? [2 * p.ground[0] - u, v] : [u, v];
};
const toStage = (actor, [x, y, s], q, pt) => {
  const p = actor.puppet, u = mirrored(p, q) ? [2 * p.ground[0] - pt[0], pt[1]] : pt;
  return mapply(actor.stage.xf(x, y, s, q), u[0], u[1]);
};
const origin = (p, n, q) => { const m = p.worldOf(n, q, { mirror: false }); return [m[4], m[5]]; };
// A joint input's step and range.
const stepOf = (p, key) => (Array.isArray(p.cel.inputs[key]) ? p.cel.inputs[key] : [-180, 180, 2]);
const quantise = (p, key, v) => {
  const [lo, hi, st] = stepOf(p, key);
  return +(Math.min(hi, Math.max(lo, Math.round(v / st) * st))).toFixed(6) || 0;   // never -0
};

// The limb a part names: { kind, side, upper, lower, end } (end the part whose pivot is the tip), or a single
// segment { kind, side, one }; null when the puppet has neither.
function limbOf(p, part) {
  const s = sideOf(part), stem = part.replace(/-(l|r)$/, '');
  const kind = Object.keys(LIMBS).find((k) => LIMBS[k].includes(stem));
  if (!s || !kind) throw new TypeError(`reach: '${part}' is not a limb (hand-l, hand-r, foot-l, foot-r, or their arm, fore, leg, shin)`);
  const [up, low, end] = LIMBS[kind].map((n) => `${n}-${s}`), has = (n) => p.parts.includes(n);
  if (has(up) && has(low) && has(end) && p.parentOf(end) === low && p.parentOf(low) === up) return { kind, side: s, upper: up, lower: low, end };
  if (has(up)) return { kind, side: s, one: up };
  return null;
}

// The two-bone solve in the unmirrored drawing: target t (drawing units) for limb L at state q.
function twoBone(p, L, t, q, bend) {
  // Zero the limb's own turns, so the frame below is the upper bone's rest, whatever the body does.
  const z = { ...q, [L.upper]: 0, [L.lower]: 0 }, W = p.worldOf(L.upper, z, { mirror: false }), I = inv(W);
  const e = mapply(I, ...origin(p, L.lower, z)), w = mapply(I, ...origin(p, L.end, z));
  const u1 = e, u2 = [w[0] - e[0], w[1] - e[1]], L1 = Math.hypot(...u1), L2 = Math.hypot(...u2);
  const T = mapply(I, t[0], t[1]), dT = Math.hypot(...T) || 1e-6;
  const d = Math.min(L1 + L2 - 1e-6, Math.max(Math.abs(L1 - L2) + 1e-6, dT)), phiT = Math.atan2(T[1], T[0]);
  const A = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const Tc = [Math.cos(phiT) * d, Math.sin(phiT) * d];
  const solve = (sg) => {
    const p1 = phiT + sg * A, el = [L1 * Math.cos(p1), L1 * Math.sin(p1)], p2 = Math.atan2(Tc[1] - el[1], Tc[0] - el[0]);
    const a1 = p1 - Math.atan2(u1[1], u1[0]), a2 = p2 - Math.atan2(u2[1], u2[0]) - a1;
    return { a1, a2, elbow: mapply(W, el[0], el[1]) };
  };
  const [P, M] = [solve(1), solve(-1)], hipX = p.ground[0];
  const score = {
    down: (s) => s.elbow[1], up: (s) => -s.elbow[1], front: (s) => s.elbow[0], back: (s) => -s.elbow[0],
    out: (s) => Math.abs(s.elbow[0] - hipX), in: (s) => -Math.abs(s.elbow[0] - hipX),
  }[bend];
  const got = score(P) >= score(M) ? P : M;
  return { [L.upper]: quantise(p, L.upper, wrap180(got.a1 / RAD)), [L.lower]: quantise(p, L.lower, wrap180(got.a2 / RAD)) };
}

const bendFor = (p, L, q, elbow) => {
  if (elbow !== undefined) {
    if (!BENDS.includes(elbow)) throw new TypeError(`reach: elbow '${elbow}' (${BENDS.join(', ')})`);
    return elbow;
  }
  if (L.kind === 'arm') return 'down';
  return p.views && p.viewOf(q.dir ?? p.rest.dir) === 'front' ? 'out' : 'front';
};

// reach in the drawing's own units (actor.place's `hand` has already brought the point in): a patch.
export function reachIn(actor, part, t, state = {}, o = {}) {
  const p = skeleton(actor, 'reach'), q = full(p, state), L = limbOf(p, part);
  if (!L) return {};
  if (L.one) {
    // A single segment points at the target: it hangs down (+y) at 0 degrees.
    const piv = origin(p, L.one, { ...q, [L.one]: 0 });
    const pm = p.parentOf(L.one), base = pm === undefined ? 0 : angleOfXf(p.worldOf(pm, q, { mirror: false })) / RAD;
    return { [L.one]: quantise(p, L.one, wrap180(Math.atan2(-(t[0] - piv[0]), t[1] - piv[1]) / RAD - base)) };
  }
  return twoBone(p, L, t, q, bendFor(p, L, q, o.elbow ?? state.elbow));
}

// reach(actor, part, [x, y], { at, state, elbow }) => the limb's two joints (two-bone IK) so its end lands on
// the point, quantised; a one-segment limb aimed at it (see the top of this file).
export function reach(actor, part, target, o = {}) {
  if (!actor?.puppet) return {};
  if (!Array.isArray(target) || target.length < 2 || !target.every(Number.isFinite)) throw new TypeError(`reach ${actor.name}: target is [x, y], got ${JSON.stringify(target)}`);
  const state = o.state ?? {}, q = full(actor.puppet, state);
  const t = o.at ? toDrawing(actor, o.at, q, target) : target;
  return reachIn(actor, part, t, state, o);
}

// Where a part's pivot (a hand's wrist, a foot's ankle) is on the stage at a state.
export function partAt(actor, part, [x, y, s], state = {}) {
  const p = skeleton(actor, 'partAt'), q = full(p, state);
  return toStage(actor, [x, y, s], q, origin(p, part, q));
}

// Where an actor's head is on the stage: the middle of its head part's drawing (a code cel: near its top).
export function headAt(actor, x, y, s, state = {}) {
  const p = actor.puppet;
  if (!p?.worldOf || !p.parts.includes('head')) {
    const top = actor.stage ? actor.stage.xf(x, y, s, state) : null;
    return top ? [x, mapply(top, actor.ground?.[0] ?? 0, (actor.box?.[1] ?? 0) + 0.18 * (actor.box?.[3] ?? 0))[1]] : [x, y - 0.8 * s];
  }
  const q = full(p, state), b = p.inkOf('head', q, { mirror: false }) ?? [...origin(p, 'head', q), 0, 0];
  return toStage(actor, [x, y, s], q, [b[0] + b[2] / 2, b[1] + b[3] / 2]);
}

// lookAt(actor, point | actor, { at, state, other, turn, max }) => { dir?, head?, pupils }: the head turned
// towards it and the pupils sliding the rest of the way (see the top of this file).
export function lookAt(actor, target, o = {}) {
  const state = o.state ?? {};
  let T = target;
  if (typeof target === 'function') {
    if (!o.other) throw new TypeError(`lookAt ${actor.name}: looking at ${target.name} needs its place, { other: [x, y, s, state?] }`);
    const [ox, oy, os, oq = {}] = o.other;
    T = headAt(target, ox, oy, os, oq);
  }
  if (!Array.isArray(T) || !T.every(Number.isFinite)) throw new TypeError(`lookAt ${actor.name}: target is [x, y] or an actor, got ${JSON.stringify(target)}`);
  const p = actor.puppet, at = o.at;
  if (!p?.worldOf) {
    // No skeleton: it faces the target, and nothing more.
    if (!at) return {};
    return actor.look(T[0] < at[0] ? -1 : 1);
  }
  const out = {};
  let q = full(p, state);
  const turn = o.turn !== false;
  if (at && turn) {
    const h = headAt(actor, at[0], at[1], at[2], q), dx = T[0] - h[0], dir = q.dir ?? p.rest.dir ?? 1;
    const front = p.views && p.viewOf(dir) === 'front';
    if (!front && Math.abs(dx) > 1e-6) {
      const want = Math.sign(dx) * (p.views ? Math.abs(dir) || 1 : 1);
      if (want !== (p.views ? dir : Math.sign(dir) || 1)) { out.dir = want; q = { ...q, dir: want }; }
    }
  }
  // Everything else in the unmirrored drawing, facing +x.
  const t = at ? toDrawing(actor, at, q, T) : T;
  const hasHead = p.parts.includes('head');
  const front = p.views && p.viewOf(q.dir ?? p.rest.dir) === 'front';
  let world = 0;   // the head's world angle, radians
  if (hasHead) {
    const hb = p.inkOf('head', { ...q, head: 0 }, { mirror: false }), c = hb ? [hb[0] + hb[2] / 2, hb[1] + hb[3] / 2] : origin(p, 'head', q);
    const pm = p.parentOf('head'), base = pm === undefined ? 0 : angleOfXf(p.worldOf(pm, q, { mirror: false }));
    const phi = Math.atan2(t[1] - c[1], t[0] - c[0]);
    if (!front) {
      const max = o.max ?? 30;
      // Facing +x, a target behind (it did not turn) is looked at over the shoulder only as far as max.
      const want = wrap180((phi - base) / RAD), st = stepOf(p, 'head')[2];
      let head = quantise(p, 'head', Math.max(-max, Math.min(max, want)));
      // Turned no further than the figure keeps to its box (a fox's ears), when it does at rest.
      if (!celOverflow(p({ ...q, head: 0 }))) while (head && celOverflow(p({ ...q, head }))) head = quantise(p, 'head', head - Math.sign(head) * st);
      out.head = head;
      world = base + out.head * RAD;
    } else world = base + (q.head ?? 0) * RAD;
    const px = p.moves?.['pupil.x'], py = p.moves?.['pupil.y'];
    if (px || py) {
      const r = front ? Math.atan2(t[1] - c[1], t[0] - c[0]) - world : phi - world;
      const k = front ? Math.min(1, Math.hypot(t[0] - c[0], t[1] - c[1]) / (2 * (hb?.[3] || 1))) : 1;
      if (px) out['pupil.x'] = quantise(p, 'pupil.x', Math.cos(r) * k * (Math.cos(r) >= 0 ? px[1] : -px[0]));
      if (py) out['pupil.y'] = quantise(p, 'pupil.y', Math.sin(r) * k * (Math.sin(r) >= 0 ? py[1] : -py[0]));
    }
  }
  return out;
}

// ---------- feet ----------

// The ankle of a side: the foot's pivot, else the bottom middle of the lowest leg bone's drawing.
function ankle(p, s, q) {
  if (p.parts.includes(`foot-${s}`)) return origin(p, `foot-${s}`, q);
  const n = [`shin-${s}`, `leg-${s}`].find((x) => p.parts.includes(x));
  if (!n) return null;
  const b = p.inkOf(n, q, { mirror: false });
  return b ? [b[0] + b[2] / 2, b[1] + b[3]] : null;
}

// feetOf(actor, state) => [-l ankle, -r ankle] in the unmirrored drawing, or null.
export function feetOf(actor, state = {}) {
  const p = skeleton(actor, 'feetOf'), q = full(p, state);
  const f = ['l', 'r'].map((s) => ankle(p, s, q));
  return f.every(Boolean) ? f : null;
}

const restLow = new WeakMap();   // puppet -> the rest pose's lower ankle, per view
function restAnkleY(p, dir) {
  let m = restLow.get(p);
  if (!m) restLow.set(p, (m = new Map()));
  const V = p.viewOf(dir) ?? '';
  if (!m.has(V)) {
    const f = ['l', 'r'].map((s) => ankle(p, s, { ...p.rest, ...(p.views ? { dir: Math.abs(dir) || 0 } : {}) })).filter(Boolean);
    m.set(V, f.length ? Math.max(...f.map((a) => a[1])) : null);
  }
  return m.get(V);
}

// stand(actor, state) => state with the lift that puts its lower ankle where the rest pose has it.
export function stand(actor, state = {}) {
  const p = actor?.puppet;
  if (!p?.worldOf) return state;
  const q = full(p, state), feet = ['l', 'r'].map((s) => ankle(p, s, q)).filter(Boolean);
  const r = restAnkleY(p, q.dir ?? p.rest.dir);
  if (!feet.length || r === null) return state;
  const low = Math.max(...feet.map((a) => a[1])), units = p.cel.box[3] || 1;
  return { ...state, lift: +((low - r) / (0.04 * units)).toFixed(2) || 0 };
}

// The stage ankles of a walking actor as a meta for lint's foot-slide: [[x, y] -l, -r], the stage's ground
// (the rest ankle's height at lift 0) and the figure's height on the stage.
export function feetMeta(actor, at, state) {
  const p = actor.puppet, q = full(p, state), f = ['l', 'r'].map((s) => ankle(p, s, q));
  if (!f.every(Boolean)) return null;
  const r = restAnkleY(p, q.dir ?? p.rest.dir), [x, y, s] = at;
  const ground = toStage(actor, at, { ...q, lift: 0 }, [p.ground[0], r])[1], h = actor.stage.k(s) * p.cel.box[3];
  const r2 = (v) => Math.round(v * 100) / 100;
  return meta('feet', { actor: actor.name, cycle: state.walking === true ? 'walk' : state.walking, at: f.map((a) => toStage(actor, at, q, a).map(r2)), ground: r2(ground), h: r2(h), x: r2(x), y: r2(y) });
}

// ---------- the walk ----------

const strides = new WeakMap();   // actor -> cycle -> stride

// strideOf(actor, cycle) => { n, fps, advance, stride, contacts, strikes }: how far the body travels each
// frame of a cycle so the planted foot stays put (see the top of this file).
export function strideOf(actor, name = 'walk') {
  let m = strides.get(actor);
  if (!m) strides.set(actor, (m = new Map()));
  if (m.has(name)) return m.get(name);
  const p = skeleton(actor, 'strideOf'), c = actor.cycleOf(name);
  if (!c) throw new Error(`strideOf: ${actor.name} has no cycle '${name}'`);
  const side = p.views ? { dir: 1 } : {};
  const frames = Array.from({ length: c.n }, (_, j) => full(p, { ...side, ...actor.cycle(name, j / c.fps) }));
  const feet = frames.map((q) => ['l', 'r'].map((s) => ankle(p, s, q)));
  if (feet.some((f) => !f.every(Boolean))) throw new Error(`strideOf: ${actor.name} has no two feet to walk on`);
  const units = p.cel.box[3] || 1;
  // The planted foot from frame j to j + 1: of the feet moving back, the lower over both frames (a swinging
  // foot that brushes the ground on its way forward is not it).
  const planted = feet.map((f, j) => {
    const g = feet[(j + 1) % c.n], low = (k) => f[k][1] + g[k][1], back = [0, 1].filter((k) => g[k][0] <= f[k][0]);
    return (back.length ? back : [0, 1]).reduce((a, b) => (low(b) > low(a) ? b : a));
  });
  const advance = c.advance ? c.advance.map((a) => a * units) : feet.map((f, j) => f[planted[j]][0] - feet[(j + 1) % c.n][planted[j]][0]);
  // A step lands where the planted foot changes.
  const strikes = planted.map((k, j) => (k !== planted[(j + c.n - 1) % c.n] ? j : -1)).filter((j) => j >= 0);
  const stride = advance.reduce((a, b) => a + b, 0);
  if (!(stride > 1e-6)) throw new Error(`strideOf: ${actor.name}'s '${name}' goes nowhere (its planted foot does not move back); walk it with a speed instead`);
  const tol = 0.03 * units;
  const contacts = feet.map((f, j) => (Math.abs(f[0][1] - f[1][1]) <= tol ? j : -1)).filter((j) => j >= 0);
  const out = Object.freeze({ n: c.n, fps: c.fps, advance: Object.freeze(advance), stride, contacts: Object.freeze(contacts.length ? contacts : [0]), strikes: Object.freeze(strikes) });
  m.set(name, out);
  return out;
}

// walkTo(actor, x0, x1, t0, t1, { s, cycle, stand, hold }) => { x(t), state(t), t0, end, steps }: a walk
// whose planted foot holds still, x following it frame by frame (see the top of this file).
export function walkTo(actor, x0, x1, t0, t1 = null, o = {}) {
  const { s, cycle = 'walk', stand: grounded = true, hold = 1 / 6, speed = 0.6 } = o;
  if (!(s > 0)) throw new TypeError(`walkTo ${actor?.name}: give the actor's stage size, { s }`);
  for (const [k, v] of [['x0', x0], ['x1', x1], ['t0', t0]]) if (!Number.isFinite(v)) throw new TypeError(`walkTo ${actor.name}: ${k} must be a number, got ${v}`);
  if (t1 !== null && !(t1 > t0)) throw new TypeError(`walkTo ${actor.name}: t1 (${t1}) must be after t0 (${t0})`);
  const dir = x1 >= x0 ? 1 : -1, D = Math.abs(x1 - x0), face = actor.look(dir);
  const settle = (q) => (grounded ? stand(actor, q) : q);
  const i0 = Math.round(t0 * FPS);
  if (!actor.puppet?.worldOf) {
    // No skeleton: a slide at `speed` heights a second (or arriving at t1), the actor's own cycle over it.
    const N = t1 === null ? Math.max(1, Math.round(D / (speed * 2 * s) * FPS)) : Math.round((t1 - t0) * FPS);
    const x = (t) => { const i = Math.max(0, Math.min(N, Math.floor(t * FPS + 1e-9) - i0)); return x0 + (x1 - x0) * i / N; };
    const state = (t) => { const i = Math.floor(t * FPS + 1e-9) - i0; return i >= 0 && i < N ? { ...face, ...actor.cycle(cycle, (t - t0)) } : { ...face }; };
    return Object.freeze({ kind: 'walk', actor: actor.name, x, state, t0, end: (i0 + N) / FPS, frames: N });
  }
  const g = strideOf(actor, cycle), k = actor.stage.k(s), Du = D / k;
  const cum = (j) => Math.floor(j / g.n) * g.stride + g.advance.slice(0, j % g.n).reduce((a, b) => a + b, 0);
  // The cycle frames to play: ending on a contact, nearest the distance.
  let M = 0, best = Infinity;
  for (let j = 1; cum(j) < Du + g.stride; j++) {
    if (!g.contacts.includes(j % g.n)) continue;
    const e = Math.abs(cum(j) - Du);
    if (e < best) { best = e; M = j; }
  }
  if (!M) M = Math.max(1, Math.round(Du / g.stride * g.n));
  const N = t1 === null ? Math.max(1, Math.round(M * FPS / g.fps)) : Math.max(1, Math.round((t1 - t0) * FPS));
  const res = Du - cum(M), jOf = (i) => Math.floor(i * M / N + 1e-9);
  const xAt = (i) => x0 + dir * k * (cum(jOf(i)) + res * i / N);
  const x = (t) => xAt(Math.max(0, Math.min(N, Math.floor(t * FPS + 1e-9) - i0)));
  const frameAt = (j) => actor.cycle(cycle, (j % g.n) / g.fps + 1e-9);
  const state = (t) => {
    const i = Math.floor(t * FPS + 1e-9) - i0;
    if (i < 0) return settle({ ...face });
    if (i < N) return settle({ ...face, ...frameAt(jOf(i)), walking: cycle });
    if (i < N + Math.round(hold * FPS)) return settle({ ...face, ...frameAt(M) });
    return settle({ ...face });
  };
  const steps = [];
  for (let i = 0; i < N; i++) if ((i === 0 || jOf(i) !== jOf(i - 1)) && g.strikes.includes(jOf(i) % g.n)) steps.push((i0 + i) / FPS);
  return Object.freeze({ kind: 'walk', actor: actor.name, x, state, t0, end: (i0 + N) / FPS, frames: N, cycles: M / g.n, steps: Object.freeze(steps) });
}
