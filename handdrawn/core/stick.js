// Stick puppets (4.0 K2): a stickman that is its own rig. A stick payload names joints and the bones between
// them; compileStick() turns it into an ordinary puppet payload (parts, pivots, views, variants), so puppet(),
// lint, sheets, the cut-out look and the actor contract see nothing new.
//
//   { kind: 'stick', name: 'sam', units: 300,
//     joints: { hip: [0, -150], chest: [0, -234], neck: [0, -255], head: [0, -278], 'shoulder-l': [0, -234],
//               'elbow-l': [6, -186], 'wrist-l': [12, -138], 'hip-l': [0, -150], 'knee-l': [0, -78],
//               'ankle-l': [0, -10], 'toe-l': [21, -3], ... the same with -r },
//     spread: { shoulder: 24, elbow: 30, ... },     // the front view: how far each pair sits from the middle
//     bones: [['hip', 'chest', 5], ['chest', 'neck', 5], ['shoulder-l', 'elbow-l', 5], ...],   // [from, to, w]
//     head: { r: 23, face: true }, hands: 'dots' | 'mitts' | 'fingers' | 'none', style: 'line' | 'tube',
//     parts: { scarf: { parent: 'neck', pivot: 'neck', chain: { n: 4, len: 16, w: 8, angle: 70 }, before: 'head' } } }
//
// Joints are the side view, facing right (+x), the ground at y = 0, up negative. A bone is a part whose pivot
// is its proximal joint and whose drawing is one stroke to its distal joint (the pen tapers it) -- or, in the
// `tube` style, a filled capsule with an ink edge. The part is named after its distal joint in the standard
// biped names: chest -> body, neck -> neck, elbow -> arm, wrist -> fore, knee -> leg, ankle -> shin, toe ->
// foot, each with its side; any other joint names its own part (a tail). The root is `hips` at the hip; a
// joint no bone reaches hangs off its anchor (shoulder-l off the chest, hip-l off the hip), and the part that
// owns the anchor draws the collar line out to it (only seen in the front and three-quarter views). The head
// is a circle about the head joint on a part pivoting at the neck; hands are dots or mitts on `hand-l`,
// `hand-r` at the wrists, or `fingers` (4.0 K7): a mitt with variants open, fist, point and thumb, which a
// hands track (actor.hands) picks from; a face prints on the head: `eye` (open, happy, sleep, wide, half a lid, a wink),
// `pupil` (a slide, shown with an open, wide or half-lidded eye), `brow-l`, `brow-r` (a turn and a slide up
// and down), `mouth` (0 shut, 1 to 3 opening, 4 an oo, 5 a smile), with the ranges scaled to the head so the
// fox's numbers mean the same thing.
//
// Views: `side` is the joints as given; `front` stands each pair `spread` from the middle (-l on the drawing's
// left, like the fox's brow-l) with the centre joints on the hip's x; `three-quarter` is between. Every part
// keeps its name and painter order in every view: the -l limbs first (the far side, in profile facing right),
// then the hips, body, neck, head and face, then the -r limbs.
//
// Extra parts (4.0 K6): `parts` adds ordinary puppet parts to the compiled ones (a scarf, a tail, a hat), in
// the side view's coordinates; a pivot may name a joint instead ('neck': that joint in every view), and
// `before` puts the part ahead of a compiled part in painter order (by default it goes in front of all).
//
// The compiled payload keeps its source as `stick`, so stickMap() can hand `hdf retarget` a map with no
// file: the stick's joints are the biped rig's (core/rig.js), -l on side 1 and -r on side 2, each bone
// following the clip's chain over the same joints and its own rest direction as the zero.
//
//   stickSource({ name: 'sam', h: 300, build: 'kid', style: 'tube', face: true })   what `hdf stick` writes
//   compileStick(src)    the puppet payload (memoised per source object)
//   puppet(src)          the same as puppet(compileStick(src))
//   stickMap(d)          a retarget map for a stick payload (source or compiled)
import { circle, ellipse, fill, line, mmul, poly, rotate, serialise, stroke, translate, xf } from './list.js';
import { HAND_POSES } from './face.js';

export const STICK_VIEWS = Object.freeze(['side', 'three-quarter', 'front']);
export const STYLES = Object.freeze(['line', 'tube']);
export const HANDS = Object.freeze(['dots', 'mitts', 'fingers', 'none']);
// 4.0 K7: the hand shapes a `fingers` stick draws, which a hands track picks from (core/face.js).
export const FINGERS = Object.freeze(Object.keys(HAND_POSES));
export const EYES = Object.freeze(['open', 'happy', 'sleep', 'wide', 'half', 'wink']);
export const MOUTHS = 6;

// Distal joint (without its side) -> part name.
const PART_OF = Object.freeze({ chest: 'body', neck: 'neck', elbow: 'arm', wrist: 'fore', knee: 'leg', ankle: 'shin', toe: 'foot' });
// A joint no bone reaches hangs off this one.
const ANCHOR = Object.freeze({ shoulder: 'chest', hip: 'hip' });

const side = (j) => /-(l|r)$/.exec(j)?.[1] ?? null;
const stem = (j) => j.replace(/-(l|r)$/, '');
const r2 = (v) => Math.round(v * 100) / 100;
const pt = (p) => [r2(p[0]), r2(p[1])];
const data = (ops) => JSON.parse(serialise(ops));   // ops as the payload stores them ($p paths)

// ---------- builds: what `hdf stick` writes ----------

// Fractions of the figure's height H. y are heights above the ground; x forward of the hip (side view).
export const BUILDS = Object.freeze({
  adult: { r: 0.075, chest: 0.78, hip: 0.5, knee: 0.26, ankle: 0.035, toe: [0.07, 0.01], elbow: [0.02, 0.62], wrist: [0.04, 0.46],
    w: 0.017, body: 1, spread: { shoulder: 0.08, elbow: 0.1, wrist: 0.11, hip: 0.035, knee: 0.04, ankle: 0.045, toe: 0.075 } },
  kid: { r: 0.115, chest: 0.69, hip: 0.42, knee: 0.22, ankle: 0.03, toe: [0.065, 0.01], elbow: [0.02, 0.555], wrist: [0.035, 0.43],
    w: 0.02, body: 1, spread: { shoulder: 0.075, elbow: 0.09, wrist: 0.1, hip: 0.035, knee: 0.04, ankle: 0.045, toe: 0.07 } },
  tall: { r: 0.062, chest: 0.8, hip: 0.54, knee: 0.28, ankle: 0.03, toe: [0.065, 0.008], elbow: [0.02, 0.63], wrist: [0.04, 0.47],
    w: 0.014, body: 1, spread: { shoulder: 0.075, elbow: 0.092, wrist: 0.1, hip: 0.032, knee: 0.036, ankle: 0.04, toe: 0.068 } },
  round: { r: 0.085, chest: 0.74, hip: 0.45, knee: 0.23, ankle: 0.035, toe: [0.075, 0.01], elbow: [0.03, 0.58], wrist: [0.05, 0.44],
    w: 0.022, body: 3.2, spread: { shoulder: 0.1, elbow: 0.125, wrist: 0.135, hip: 0.05, knee: 0.052, ankle: 0.056, toe: 0.086 } },
});

// A stick source for a build: the joints, the bones with their widths, the head, the front spread.
export function stickSource({ name = 'stick', h = 300, build = 'adult', style = 'line', hands = 'dots', face = true } = {}) {
  const B = BUILDS[build];
  if (!B) throw new Error(`stick: build '${build}' (have ${Object.keys(BUILDS).join(', ')})`);
  if (!STYLES.includes(style)) throw new Error(`stick: style '${style}' (have ${STYLES.join(', ')})`);
  if (!HANDS.includes(hands)) throw new Error(`stick: hands '${hands}' (have ${HANDS.join(', ')})`);
  if (!(h > 0)) throw new Error(`stick: h ${h}; the figure's height in units, > 0`);
  const H = h, r = B.r * H, Y = (f) => r2(-f * H), X = (f) => r2(f * H);
  const joints = { hip: [0, Y(B.hip)], chest: [0, Y(B.chest)], neck: [0, r2(-(H - 2 * r))], head: [0, r2(-(H - r))] };
  for (const s of ['l', 'r']) {
    Object.assign(joints, {
      [`shoulder-${s}`]: [0, Y(B.chest)], [`elbow-${s}`]: [X(B.elbow[0]), Y(B.elbow[1])], [`wrist-${s}`]: [X(B.wrist[0]), Y(B.wrist[1])],
      [`hip-${s}`]: [0, Y(B.hip)], [`knee-${s}`]: [0, Y(B.knee)], [`ankle-${s}`]: [0, Y(B.ankle)], [`toe-${s}`]: [X(B.toe[0]), Y(B.toe[1])],
    });
  }
  // A line is the pen's width; a tube is its diameter (the body of a round build is thicker still).
  const w = r2(B.w * H * (style === 'tube' ? 2.6 : 1)), wb = r2(w * (style === 'tube' ? B.body : Math.min(B.body, 1.6)));
  const bones = [['hip', 'chest', wb], ['chest', 'neck', w]];
  for (const s of ['l', 'r']) {
    bones.push([`shoulder-${s}`, `elbow-${s}`, w], [`elbow-${s}`, `wrist-${s}`, w],
      [`hip-${s}`, `knee-${s}`, w], [`knee-${s}`, `ankle-${s}`, w], [`ankle-${s}`, `toe-${s}`, w]);
  }
  return {
    kind: 'stick', name, units: H, build, style, hands,
    desc: `a stick puppet (${build}, ${style}${face ? ', a face' : ''}): its joints are the biped rig's, so a filmed walk retargets with no map`,
    joints, spread: Object.fromEntries(Object.entries(B.spread).map(([k, v]) => [k, X(v)])),
    bones, head: { r: r2(r), face: !!face },
  };
}

// ---------- checking ----------

export const isStick = (d) => !!d && typeof d === 'object' && d.kind === 'stick';

// The problems with a stick source, as strings (empty: it compiles).
export function checkStick(d) {
  const bad = [];
  if (!isStick(d)) return ["stick: expected { kind: 'stick', joints, bones, head }"];
  if (!(d.units > 0)) bad.push('units: the figure\'s height in logical units, > 0');
  const J = d.joints && typeof d.joints === 'object' ? d.joints : null;
  if (!J) return [...bad, 'joints: { name: [x, y] }, the side view facing right'];
  for (const [n, p] of Object.entries(J)) if (!(Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) bad.push(`joints.${n}: [x, y]`);
  for (const n of ['hip', 'neck', 'head']) if (!J[n]) bad.push(`joints.${n}: every stick has a ${n}`);
  if (!Array.isArray(d.bones) || !d.bones.length) return [...bad, 'bones: [[from, to, w], ...]'];
  const to = new Map();
  d.bones.forEach((b, i) => {
    if (!Array.isArray(b) || b.length < 2 || b.length > 3) { bad.push(`bones[${i}]: [from, to, w]`); return; }
    const [a, z, w] = b;
    for (const j of [a, z]) if (!J[j]) bad.push(`bones[${i}]: no joint '${j}'`);
    if (w !== undefined && !(w > 0)) bad.push(`bones[${i}]: width ${w}, > 0`);
    if (z === 'hip') bad.push(`bones[${i}]: the hip is the root; no bone ends there`);
    if (to.has(z)) bad.push(`bones[${i}]: '${z}' already ends bone ${to.get(z)}; a joint ends one bone`);
    to.set(z, i);
  });
  // Every bone must hang, bone by bone or through an anchor, from the hip.
  const up = (j, seen = []) => {
    if (j === 'hip') return true;
    if (seen.includes(j)) return false;
    const b = to.has(j) ? d.bones[to.get(j)][0] : ANCHOR[stem(j)];
    return !!b && !!J[b] && up(b, [...seen, j]);
  };
  for (const [a] of d.bones) if (J[a] && !up(a)) bad.push(`bones: '${a}' does not hang from the hip (no bone ends there, and it is not a shoulder or a hip)`);
  if (!d.head || !(d.head.r > 0)) bad.push('head: { r, face }, r > 0');
  if (d.style !== undefined && !STYLES.includes(d.style)) bad.push(`style: ${STYLES.join(' | ')}`);
  if (d.hands !== undefined && !HANDS.includes(d.hands)) bad.push(`hands: ${HANDS.join(' | ')}`);
  if (d.views !== undefined && !(Array.isArray(d.views) && d.views.length && d.views.every((v) => STICK_VIEWS.includes(v)))) bad.push(`views: some of ${STICK_VIEWS.join(', ')}`);
  if (d.parts !== undefined) {
    if (!d.parts || typeof d.parts !== 'object' || Array.isArray(d.parts)) bad.push('parts: { name: { parent, pivot, ... } }, extra parts');
    else for (const [n, p] of Object.entries(d.parts)) {
      if (!p || typeof p !== 'object') { bad.push(`parts.${n}: a part { parent, pivot, ops | chain, ... }`); continue; }
      if (typeof p.pivot === 'string' && !J[p.pivot]) bad.push(`parts.${n}: pivot names joint '${p.pivot}', which the stick has not`);
      if (p.before !== undefined && typeof p.before !== 'string') bad.push(`parts.${n}: before names a part`);
    }
  }
  return bad;
}

// ---------- compiling ----------

const compiled = new WeakMap();

// A stick source -> a puppet payload (see the top of this file). The same source object compiles once.
export function compileStick(src) {
  let out = compiled.get(src);
  if (out) return out;
  const bad = checkStick(src);
  if (bad.length) throw new Error(`stick ${src?.name ?? ''}: ${bad.join('; ')}`);
  compiled.set(src, (out = build(src)));
  return out;
}

function build(src) {
  const u = src.units, J = src.joints, style = src.style ?? 'line', hands = src.hands ?? 'dots';
  const views = src.views ?? STICK_VIEWS, R = src.head.r, face = src.head.face !== false;
  const tube = style === 'tube', ink = r2(Math.max(1, u * 0.008));
  const hipX = J.hip[0];

  // Where each joint sits in each view.
  const spread = { shoulder: 0.08 * u, elbow: 0.1 * u, wrist: 0.11 * u, hip: 0.035 * u, knee: 0.04 * u, ankle: 0.045 * u, toe: 0.075 * u, ...(src.spread ?? {}) };
  const frontOf = (j) => {
    if (src.front?.[j]) return src.front[j];
    const s = side(j), p = J[j];
    if (!s) return [hipX, p[1]];
    return [hipX + (s === 'l' ? -1 : 1) * (spread[stem(j)] ?? 0), p[1]];
  };
  const at = {};
  for (const V of views) {
    at[V] = {};
    for (const j of Object.keys(J)) {
      const f = frontOf(j), s = J[j];
      at[V][j] = V === 'side' ? s : V === 'front' ? f : [hipX + 0.65 * (s[0] - hipX) + 0.75 * (f[0] - hipX), s[1]];
    }
  }
  const byView = (fn) => Object.fromEntries(views.map((V) => [V, fn(V)]));

  // The bone graph: each distal joint's bone, each joint's owning part.
  const boneTo = new Map(src.bones.map(([a, z, w]) => [z, { a, z, w: w ?? u * 0.017 }]));
  const nameOf = (z) => (PART_OF[stem(z)] ? `${PART_OF[stem(z)]}${side(z) ? `-${side(z)}` : ''}` : z);
  const ownerOf = (j) => (j === 'hip' ? 'hips' : boneTo.has(j) ? nameOf(j) : ownerOf(ANCHOR[stem(j)]));
  // An anchored joint (a shoulder, a hip of one side): the owner of its anchor draws the collar out to it.
  const collars = {};
  for (const { a } of boneTo.values()) {
    if (a === 'hip' || boneTo.has(a)) continue;
    const anc = ANCHOR[stem(a)], own = ownerOf(anc);
    (collars[own] ??= []).push([anc, a]);
  }

  const capsule = (x0, y0, x1, y1, r, n = 8) => {
    const a = Math.atan2(y1 - y0, x1 - x0), pts = [];
    for (let i = 0; i <= n; i++) { const t = a + Math.PI / 2 + (i / n) * Math.PI; pts.push([x0 + r * Math.cos(t), y0 + r * Math.sin(t)]); }
    for (let i = 0; i <= n; i++) { const t = a - Math.PI / 2 + (i / n) * Math.PI; pts.push([x1 + r * Math.cos(t), y1 + r * Math.sin(t)]); }
    return poly(pts.map(pt));
  };
  // One segment from (x0, y0) to (x1, y1) in a part's own coordinates.
  const seg = (x0, y0, x1, y1, w, name) => (tube
    ? [fill(capsule(x0, y0, x1, y1, w / 2), 'fills.0', { finish: true, name }), stroke(capsule(x0, y0, x1, y1, w / 2), 'ink', { w: ink, name })]
    : Math.hypot(x1 - x0, y1 - y0) < 1e-6 ? [] : [stroke(line(r2(x0), r2(y0), r2(x1), r2(y1)), 'ink', { w, name })]);

  const parts = {};

  // The root: the hips, and their collar to each hip of a side.
  const collarOps = (own, V, origin) => (collars[own] ?? []).flatMap(([anc, j]) => {
    const A = at[V][anc], Z = at[V][j], w = src.bones.find(([a]) => a === j)?.[2] ?? u * 0.017;
    return Math.hypot(Z[0] - A[0], Z[1] - A[1]) < 0.5 ? [] : seg(A[0] - origin[0], A[1] - origin[1], Z[0] - origin[0], Z[1] - origin[1], w, 'collar');
  });
  const bonePart = (b) => {
    const n = nameOf(b.z);
    parts[n] = {
      parent: ownerOf(b.a),
      pivot: byView((V) => pt(at[V][b.a])),
      ops: byView((V) => {
        const A = at[V][b.a], Z = at[V][b.z];
        return data([...seg(0, 0, Z[0] - A[0], Z[1] - A[1], b.w, n), ...collarOps(n, V, A)]);
      }),
    };
  };
  const hipsPart = () => {
    parts.hips = { pivot: byView((V) => pt(at[V].hip)), ops: byView((V) => data(collarOps('hips', V, at[V].hip))) };
  };

  // The head: a circle about the head joint, on a part pivoting at the neck.
  const headPart = () => {
    const parent = boneTo.has('neck') ? nameOf('neck') : 'body';
    parts.head = {
      parent,
      pivot: byView((V) => pt(at[V].neck)),
      ops: byView((V) => {
        const c = [at[V].head[0] - at[V].neck[0], at[V].head[1] - at[V].neck[1]], path = circle(r2(c[0]), r2(c[1]), R, 32);
        return data(tube ? [fill(path, 'fills.0', { finish: true, name: 'head' }), stroke(path, 'ink', { w: ink, name: 'head' })]
          : [stroke(path, 'ink', { w: boneTo.get('neck')?.w ?? u * 0.017, name: 'head' })]);
      }),
    };
  };

  // The face, in the head's coordinates (its origin the neck). Features sit about the head's centre, the side
  // view's forward, the front's centred, the three-quarter's between; -l is the drawing's left, the far side.
  const faceParts = () => {
    const fw = r2(Math.max(0.8, R * 0.09)), q = (v, s) => r2(Math.max(s, Math.round(v / s) * s));
    const pupilStep = q(R * 0.025, 0.25), browStep = q(R / 21, 0.5);
    const centre = (V) => [at[V].head[0] - at[V].neck[0], at[V].head[1] - at[V].neck[1]];
    // Each view's eye places ([x, y] from the head's centre, -l first) and its mouth, as fractions of R.
    const LAYOUT = {
      side: { eyes: { r: [0.42, -0.12] }, mouth: [0.5, 0.42], mw: 0.6 },
      'three-quarter': { eyes: { l: [0.02, -0.12], r: [0.56, -0.12] }, mouth: [0.3, 0.42], mw: 0.85 },
      front: { eyes: { l: [-0.34, -0.12], r: [0.34, -0.12] }, mouth: [0, 0.42], mw: 1 },
    };
    const place = (V, [fx, fy]) => { const c = centre(V); return [c[0] + fx * R, c[1] + fy * R]; };
    const eyeOps = (kind, V) => Object.entries(LAYOUT[V].eyes).flatMap(([s, e]) => {
      const [x, y] = place(V, e), er = R * (kind === 'wide' ? 0.26 : 0.2);
      // wink: the far (-l) eye open with its own pupil, the near one a happy arch (in profile only the arch).
      if (kind === 'wink') return s === 'l' ? [stroke(circle(r2(x), r2(y), r2(er), 16), 'ink', { w: fw, name: 'eye' }), fill(circle(r2(x), r2(y), r2(R * 0.1), 12), 'ink', { name: 'eye' })] : eyeOps1('happy', x, y, er);
      if (kind === 'half') return [   // a lid across the top half: the lower arc and the lid line
        stroke(poly(Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * Math.PI; return pt([x + er * Math.cos(a), y + er * Math.sin(a)]); }), false), 'ink', { w: fw, name: 'eye' }),
        stroke(line(r2(x - er * 1.1), r2(y - er * 0.05), r2(x + er * 1.1), r2(y - er * 0.05)), 'ink', { w: fw, name: 'eye' }),
      ];
      return eyeOps1(kind, x, y, er);
    });
    const eyeOps1 = (kind, x, y, er) => {
      if (kind === 'open' || kind === 'wide') return [stroke(circle(r2(x), r2(y), r2(er), 16), 'ink', { w: fw, name: 'eye' })];
      const k = kind === 'happy' ? -1 : 1;   // happy: an arch; sleep: a lid, curved down
      return [stroke(poly([[x - er, y], [x - er * 0.5, y + k * er * 0.55], [x + er * 0.5, y + k * er * 0.55], [x + er, y]].map(pt), false), 'ink', { w: fw, name: 'eye' })];
    };
    parts.eye = { parent: 'head', variants: Object.fromEntries(EYES.map((k) => [k, byView((V) => data(eyeOps(k, V)))])) };
    parts.pupil = {
      parent: 'head',
      ops: byView((V) => data(Object.values(LAYOUT[V].eyes).map((e) => { const [x, y] = place(V, e); return fill(circle(r2(x), r2(y), r2(R * 0.1), 12), 'ink', { name: 'pupil' }); }))),
      slide: { x: [-4 * pupilStep, 4 * pupilStep, pupilStep], y: [-3 * pupilStep, 3 * pupilStep, pupilStep] },
      when: { eye: ['open', 'wide', 'half'] },
    };
    // Brows: a short stroke over each eye, turning about its own middle. In profile only the near one shows.
    for (const s of ['l', 'r']) {
      const where = (V) => { const e = LAYOUT[V].eyes[s] ?? LAYOUT[V].eyes.r; const [x, y] = place(V, [e[0], e[1] - 0.36]); return [x + at[V].neck[0], y + at[V].neck[1]]; };
      parts[`brow-${s}`] = {
        parent: 'head',
        pivot: byView((V) => pt(where(V))),
        ops: byView((V) => (LAYOUT[V].eyes[s] ? data([stroke(line(r2(-R * 0.17), 0, r2(R * 0.17), 0), 'ink', { w: fw, name: `brow-${s}` })]) : [])),
        slide: { y: [-6 * browStep, 3 * browStep, browStep] },
      };
    }
    // Mouths: 0 shut, 1 a little open, 2 open, 3 wide, 4 an oo, 5 a smile.
    const mouthOps = (k, V) => {
      const [x, y] = place(V, LAYOUT[V].mouth), m = R * LAYOUT[V].mw;
      const O = (rx, ry, filled) => (filled ? fill(ellipse(r2(x), r2(y), r2(rx), r2(ry), 16), 'ink', { name: 'mouth' }) : stroke(ellipse(r2(x), r2(y), r2(rx), r2(ry), 16), 'ink', { w: fw, name: 'mouth' }));
      return [
        () => stroke(line(r2(x - 0.2 * m), r2(y), r2(x + 0.2 * m), r2(y)), 'ink', { w: fw, name: 'mouth' }),
        () => O(0.12 * m, 0.06 * R, false),
        () => O(0.15 * m, 0.11 * R, true),
        () => O(0.19 * m, 0.17 * R, true),
        () => O(0.08 * m, 0.09 * R, true),
        () => stroke(poly([[x - 0.26 * m, y - 0.05 * R], [x - 0.12 * m, y + 0.08 * R], [x + 0.12 * m, y + 0.08 * R], [x + 0.26 * m, y - 0.05 * R]].map(pt), false), 'ink', { w: fw, name: 'mouth' }),
      ][k]();
    };
    parts.mouth = { parent: 'head', variants: Object.fromEntries(Array.from({ length: MOUTHS }, (_, k) => [String(k), byView((V) => data([mouthOps(k, V)]))])) };
  };

  // Hands at the wrists: a dot, or a mitt along the forearm with a thumb.
  const handPart = (s) => {
    const wr = `wrist-${s}`, fore = boneTo.get(wr);
    if (!fore || hands === 'none') return;
    const w = fore.w;
    if (hands === 'fingers') {
      parts[`hand-${s}`] = { parent: nameOf(wr), pivot: byView((V) => pt(at[V][wr])),
        variants: Object.fromEntries(FINGERS.map((k) => [k, byView((V) => fingerOps(k, V, fore, w))])) };
      return;
    }
    parts[`hand-${s}`] = {
      parent: nameOf(wr),
      pivot: byView((V) => pt(at[V][wr])),
      ops: byView((V) => {
        const A = at[V][fore.a], Z = at[V][wr], a = Math.atan2(Z[1] - A[1], Z[0] - A[0]);
        if (hands === 'dots') {
          const path = circle(0, 0, r2(tube ? w * 0.62 : Math.max(w * 1.3, u * 0.014)), 16);
          return data(tube ? [fill(path, 'fills.0', { finish: true, name: 'hand' }), stroke(path, 'ink', { w: ink, name: 'hand' })] : [fill(path, 'ink', { name: 'hand' })]);
        }
        const L = Math.max(u * 0.05, w * 2.2), m = mmul(rotate(a), translate(L * 0.45, 0));
        const mitt = xf(ellipse(0, 0, L * 0.55, L * 0.38, 16), m), thumb = xf(ellipse(L * 0.05, -L * 0.36, L * 0.2, L * 0.12, 10), m);
        return data([fill(thumb, 'fills.0', { name: 'hand' }), stroke(thumb, 'ink', { w: ink, name: 'hand' }),
          fill(mitt, 'fills.0', { finish: true, name: 'hand' }), stroke(mitt, 'ink', { w: tube ? ink : Math.max(ink, w * 0.7), name: 'hand' })]);
      }),
    };
  };

  // A hand with fingers (4.0 K7) in the forearm's direction, the thumb forward: a palm, and fingers drawn as
  // strokes (open: four spread and a thumb; point: the index; thumb: the thumb up) or folded into a fist.
  const fingerOps = (k, V, fore, w) => {
    const A = at[V][fore.a], Z = at[V][`wrist-${side(fore.z)}`], a = Math.atan2(Z[1] - A[1], Z[0] - A[0]);
    const L = Math.max(u * 0.06, w * 2.6), m = rotate(a), fw = tube ? ink * 1.6 : Math.max(ink, w * 0.55);
    const P = ([x, y]) => pt([x * L, y * L]);
    const digit = (pts) => stroke(xf(poly(pts.map(P), false), m), 'ink', { w: fw, name: 'hand' });
    const palm = xf(ellipse(0.3 * L, 0, 0.3 * L, k === 'open' ? 0.26 * L : 0.3 * L, 16), m);
    const body = [fill(palm, 'fills.0', { finish: true, name: 'hand' }), stroke(palm, 'ink', { w: tube ? ink : Math.max(ink, w * 0.7), name: 'hand' })];
    if (k === 'open') {
      const tips = [-18, -6, 6, 18].map((d, i) => { const y0 = -0.15 + 0.1 * i, r = d * Math.PI / 180; return [[0.52, y0], [0.52 + 0.42 * Math.cos(r), y0 + 0.42 * Math.sin(r)]]; });
      return data([...tips.map(digit), digit([[0.22, -0.2], [0.42, -0.55]]), ...body]);
    }
    const knuckle = xf(ellipse(0.35 * L, -0.28 * L, 0.14 * L, 0.09 * L, 10), m);
    const fist = [fill(knuckle, 'fills.0', { name: 'hand' }), stroke(knuckle, 'ink', { w: ink, name: 'hand' })];
    if (k === 'point') return data([digit([[0.5, -0.12], [1.02, -0.12]]), ...body, ...fist]);
    if (k === 'thumb') return data([digit([[0.3, -0.24], [0.3, -0.68]]), ...body]);
    return data([...body, ...fist]);
  };

  // Painter order: the far (-l) limbs, anything else, the hips, body, neck, head and face, the near (-r) limbs.
  const limbs = (s) => [...boneTo.values()].filter((b) => side(b.z) === s).map((b) => b.z);
  const order = (zs) => zs.sort((a, b) => depth(a) - depth(b));
  const depth = (z) => { let n = 0; for (let j = z; boneTo.has(j); j = boneTo.get(j).a) n++; return n; };
  hipsPart();
  const far = order(limbs('l')), near = order(limbs('r')), mid = [...boneTo.values()].filter((b) => !side(b.z)).map((b) => b.z);
  const others = mid.filter((z) => !['chest', 'neck'].includes(z));
  const keys = [];
  const add = (z) => { bonePart(boneTo.get(z)); keys.push(nameOf(z)); if (stem(z) === 'wrist') { handPart(side(z)); if (parts[`hand-${side(z)}`]) keys.push(`hand-${side(z)}`); } };
  far.forEach(add);
  others.forEach(add);
  keys.push('hips');
  for (const z of ['chest', 'neck']) if (boneTo.has(z)) add(z);
  headPart(); keys.push('head');
  if (face) { faceParts(); keys.push('eye', 'pupil', 'brow-l', 'brow-r', 'mouth'); }
  near.forEach(add);
  for (const n of Object.keys(parts)) if (!keys.includes(n)) keys.push(n);
  // Extra parts (a scarf): a joint name for a pivot is that joint in each view; `before` a compiled part.
  for (const [n, { before, pivot, ...p }] of Object.entries(src.parts ?? {})) {
    if (parts[n]) throw new Error(`stick ${src.name ?? ''}: extra part '${n}' is a part the stick compiles already`);
    parts[n] = { ...p, ...(pivot === undefined ? {} : { pivot: typeof pivot === 'string' ? byView((V) => pt(at[V][pivot])) : pivot }) };
    if (before !== undefined && !keys.includes(before)) throw new Error(`stick ${src.name ?? ''}: extra part '${n}' goes before '${before}', which is not a part`);
    keys.splice(before === undefined ? keys.length : keys.indexOf(before), 0, n);
  }
  const ordered = Object.fromEntries(keys.map((n) => [n, parts[n]]));

  // The box: anything the limbs can reach, turning about the hip, and the ground under the feet. Wide enough
  // for a raised arm or a kick, so a pose or a retargeted cycle fits without a box of its own.
  const up = (j) => (boneTo.has(j) ? boneTo.get(j).a : j === 'head' ? 'neck' : ANCHOR[stem(j)]);
  const reach = (z) => { let L = 0; for (let j = z; j !== 'hip' && up(j) && J[up(j)]; j = up(j)) L += Math.hypot(J[j][0] - J[up(j)][0], J[j][1] - J[up(j)][1]); return L; };
  const tops = Object.keys(J).filter((j) => j !== 'hip').map(reach);
  const wMax = Math.max(...src.bones.map((b) => b[2] ?? 0));
  const hand = hands === 'mitts' ? Math.max(u * 0.05, wMax * 2.2) * 1.1 : hands === 'fingers' ? Math.max(u * 0.06, wMax * 2.6) * 1.1 : hands === 'dots' ? Math.max(...src.bones.map((b) => b[2] ?? 0)) * 1.3 : 0;
  const pad = Math.max(...src.bones.map((b) => b[2] ?? 0)) / 2 + ink + hand + 2;
  const Rr = Math.max(...tops, reach('head') + R) + pad;
  const box = src.box ?? [r2(hipX - Rr), r2(J.hip[1] - Rr), r2(2 * Rr), r2(Math.max(-(J.hip[1] - Rr) + pad, Rr))];

  const withHands = ['l', 'r'].filter((sd) => parts[`hand-${sd}`]?.variants), fingers = withHands.length > 0;
  const fingerInputs = Object.fromEntries(withHands.map((sd) => [`hand-${sd}`, [...FINGERS]]));
  const fingerRest = Object.fromEntries(withHands.map((sd) => [`hand-${sd}`, 'open']));
  const { kind: _k, joints: _j, bones: _b, head: _h, spread: _s, front: _f, style: _st, hands: _ha, build: _bu, views: _v, parts: _p, ...keep } = src;
  return {
    ...keep,
    kind: 'puppet',
    name: src.name,
    units: u,
    ground: src.ground ?? [hipX, 0],
    box,
    views: [...views],
    ...(face || fingers ? { inputs: { ...(face ? { eye: [...EYES], mouth: [0, MOUTHS - 1, 1] } : {}), ...fingerInputs, ...(src.inputs ?? {}) } } : src.inputs ? { inputs: src.inputs } : {}),
    poses: { ...(face || fingers ? { rest: { ...(face ? { eye: 'open', mouth: 0 } : {}), ...fingerRest } } : {}), ...(src.poses ?? {}) },
    ...(src.cycles ? { cycles: src.cycles } : {}),
    parts: ordered,
    stick: stickOf(src),
  };
}

// What the compiled payload keeps of its source: enough to compile it again and to derive a retarget map.
const stickOf = (src) => {
  const { poses: _p, cycles: _c, box: _b, ...rest } = src;
  return rest;
};

// ---------- retargeting with no map ----------

// The biped rig's chain for each stick part: a bone follows the clip's joints of the same name (-l side 1,
// -r side 2; the stick's two shoulders are the rig's one, its hips of a side the rig's hip).
const RIG_JOINT = (j) => {
  const s = side(j), k = stem(j), n = s === 'l' ? 1 : s === 'r' ? 2 : null;
  if (k === 'shoulder' || k === 'chest') return 'shoulder';
  if (k === 'hip') return 'hip';
  if (k === 'neck' || k === 'head') return 'head';
  if (['elbow', 'wrist', 'knee', 'ankle'].includes(k) && n) return `${k}-${n}`;
  return null;
};

// A retarget map for a stick (its source, or a payload compiled from one): every bone whose two ends are
// joints of the biped rig follows that chain, zeroed on its own rest direction in the side view, so the rest
// pose is the clip's pose exactly where they agree. The head follows shoulder -> head; hands, feet and the
// hips follow their parents.
export function stickMap(d) {
  const src = isStick(d) ? d : d?.stick;
  if (!src?.joints) throw new Error(`stickMap: '${d?.name ?? '?'}' is not a stick puppet (no stick source)`);
  const J = src.joints, parts = {};
  const boneTo = new Map(src.bones.map(([a, z]) => [z, a]));
  const nameOf = (z) => (PART_OF[stem(z)] ? `${PART_OF[stem(z)]}${side(z) ? `-${side(z)}` : ''}` : z);
  const put = (n, a, z, from = a, to = z) => {
    const A = RIG_JOINT(from), Z = RIG_JOINT(to);
    if (!A || !Z || A === Z) return;
    const dx = J[z][0] - J[a][0], dy = J[z][1] - J[a][1];
    if (Math.hypot(dx, dy) < 1e-6) return;
    parts[n] = { chain: [A, Z], zero: [r2(dx), r2(dy)] };
  };
  for (const [z, a] of boneTo) {
    const n = nameOf(z);
    if (n === 'neck') put(n, a, z, 'chest', 'head');
    else put(n, a, z);
  }
  put('head', 'neck', 'head', 'shoulder-l', 'head');
  const ground = ['leg-l', 'leg-r'].filter((n) => parts[n]);
  return { rig: 'biped', facing: 1, desc: `derived from the stick ${src.name ?? ''}: each bone on the rig's joints of its name, -l side 1`, parts, ground };
}
