// Retargeting (3.0 S14, v3 plan Q5): a clip's skeleton (core/rig.js) drives a puppet's joints, so the fox
// gallops the way Muybridge's horse did. A map names, for each puppet part, the clip chain whose direction
// it follows:
//
//   { "rig": "quadruped",
//     "parts": {
//       "leg-l": { "chain": ["hip", "ankle-h1"], "zero": [0, 1] },   // hip -> hoof; pointing down draws rest
//       "body":  { "chain": ["hip", "shoulder"], "zero": "mean", "gain": 1 }
//     },
//     "ground": ["leg-l", "leg-r"] }
//
// Per frame, a part's direction in the world is the chain's direction less its zero: a direction [dx, dy]
// in the puppet that the chain maps onto (a leg hanging down, [0, 1]), or "mean", the chain's own average
// over the clip (a horse's level spine is an upright fox's rest), times gain. The part's joint is that less
// its parent's direction (parts nest: a leg turns with the body), quantised to the 2 degree grid. A clip that
// faces the other way from the puppet (map `facing`, default 1) is mirrored first.
//
// The lift: joint angles are the same at any size, but how high the body rides is not. Each frame lifts the
// puppet so its lowest point touches the ground where the clip's did, plus the clip's own gap under its feet
// (a gallop's moment in the air) scaled by the puppet's leg over the clip's (the `ground` parts' pivot height
// over the mean hip -> hoof length). It is stored as the frame's `lift`, in puppet units, up positive:
// puppet.liftOf(cycle, t) reads it and the actor contract lifts its stage by it.
//
// The stride (4.0 K7): a clip that knows how far it travels a frame (`advance`, in its figure heights:
// core/pose.js) hands it on as the cycle's `advance`, in the puppet's box heights, scaled by leg length (the
// puppet's hip to ankle, or to the ground on a leg of one segment, over the clip's hip to ankle): the same
// angles on a longer leg carry the body further. core/ik.js's strideOf and walkTo read it.
//
//   retarget(clip, foxPayload, map) => { cycle: { fps, n, frames, advance? }, report: { parts, scale, lift, stride? } }
import { FPS } from './curves.js';
import { bounds } from './list.js';
import { JOINT, puppet } from './puppet.js';

const DEG = 180 / Math.PI;
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const q2 = (a) => Math.max(JOINT[0], Math.min(JOINT[1], Math.round(wrap180(a) / JOINT[2]) * JOINT[2])) || 0;
// The mean of angles (degrees), on the circle.
const circMean = (as) => Math.atan2(as.reduce((s, a) => s + Math.sin(a / DEG), 0), as.reduce((s, a) => s + Math.cos(a / DEG), 0)) * DEG;

// The problems with a map against a clip and a puppet, as strings (empty: it will run).
export function checkMap(map, clip, d) {
  const bad = [];
  if (!map || typeof map !== 'object' || !map.parts || typeof map.parts !== 'object') return ['map: expected { rig, parts: { part: { chain: [from, to], zero } } }'];
  if (map.rig && clip.rig && map.rig !== clip.rig) bad.push(`map: made for a ${map.rig} rig, the clip is ${clip.rig}`);
  const joints = new Set(clip.frames.flatMap((f) => Object.keys(f.skel?.joints ?? {})));
  for (const [n, m] of Object.entries(map.parts)) {
    const p = d.parts?.[n];
    if (!p) { bad.push(`parts.${n}: the puppet has no part '${n}' (has ${Object.keys(d.parts ?? {}).join(', ')})`); continue; }
    if (p.variants) bad.push(`parts.${n}: a part with variants takes a key, not an angle`);
    if (!Array.isArray(m?.chain) || m.chain.length !== 2) { bad.push(`parts.${n}.chain: [from, to], two joint names`); continue; }
    for (const j of m.chain) if (!joints.has(j)) bad.push(`parts.${n}.chain: the clip has no joint '${j}' (has ${[...joints].join(', ')})`);
    const z = m.zero ?? 'mean';
    if (z !== 'mean' && !(Array.isArray(z) && z.length === 2 && z.every(Number.isFinite) && (z[0] || z[1]))) bad.push(`parts.${n}.zero: "mean" or a direction [dx, dy]`);
    if (m.gain !== undefined && !Number.isFinite(m.gain)) bad.push(`parts.${n}.gain: a number`);
  }
  for (const n of map.ground ?? []) if (!d.parts?.[n]) bad.push(`ground: the puppet has no part '${n}'`);
  return bad;
}

// The cycle a clip's skeleton drives on a puppet payload d through a map: { cycle: { fps, n, frames },
// report: { parts, flip, scale, lift } }. Throws, saying why, when the clip has no skeleton or the map does not fit.
export function retarget(clip, d, map) {
  const frames = clip.frames;
  if (!frames?.length || !frames.every((f) => f.skel?.joints)) {
    throw new Error(`retarget: the clip has no skeleton in ${frames?.length ? 'every frame' : 'any frame'} (hdf clip --store <id> --rig ${map?.rig ?? 'quadruped'})`);
  }
  const bad = checkMap(map, clip, d);
  if (bad.length) throw new Error(`retarget: the map does not fit:\n  ${bad.join('\n  ')}`);
  const flip = (clip.facing ?? 1) !== (map.facing ?? 1) ? -1 : 1;
  const J = (k, j) => { const p = frames[k].skel.joints[j]; return [p[0] * flip, p[1]]; };
  const dirOf = (k, [a, b]) => { const A = J(k, a), B = J(k, b); return Math.atan2(B[1] - A[1], B[0] - A[0]) * DEG; };

  // Every mapped part's direction in the world, frame by frame.
  const names = Object.keys(map.parts), world = {};
  for (const n of names) {
    const m = map.parts[n], raw = frames.map((_, k) => dirOf(k, m.chain));
    const zero = (m.zero ?? 'mean') === 'mean' ? circMean(raw) : Math.atan2(m.zero[1], m.zero[0]) * DEG;
    world[n] = raw.map((a) => wrap180(a - zero) * (m.gain ?? 1));
  }
  // A part's world direction is its parent's plus its own joint; an unmapped part keeps its joint at rest.
  const worldOf = (n, k) => (world[n] ? world[n][k] : d.parts[n]?.parent !== undefined ? worldOf(d.parts[n].parent, k) : 0);
  const joints = frames.map((_, k) => Object.fromEntries(names.map((n) => {
    const par = d.parts[n].parent;
    return [n, q2(world[n][k] - (par !== undefined ? worldOf(par, k) : 0))];
  })));

  // The lift, from the puppet's own drawing of each frame and the clip's gap under its feet.
  const make = puppet({ ...d, cycles: undefined, name: d.name ?? 'puppet' });
  const bottom = (q) => { const b = bounds([make({ ...make.rest, ...q })]); return b ? b[1] + b[3] : 0; };
  const rest = bottom({});
  const legs = (map.ground ?? []).map((n) => make.ground[1] - (make.pivotAt(n) ?? [0, 0])[1]).filter((v) => v > 0);
  const hips = frames.flatMap((f) => Object.entries(f.skel.joints).filter(([j]) => /^ankle-/.test(j))
    .map(([j, p]) => { const top = f.skel.chains.find((c) => c.includes(j))?.[0], h = top && f.skel.joints[top]; return h ? Math.hypot(p[0] - h[0], p[1] - h[1]) : 0; }))
    .filter((v) => v > 0);
  const scale = legs.length && hips.length ? legs.reduce((a, b) => a + b, 0) / legs.length / (hips.reduce((a, b) => a + b, 0) / hips.length) : 0;
  const gapOf = (f) => {
    let low = -Infinity;
    for (const s of f.outer?.sub ?? []) for (let i = 1; i < s.pts.length; i += 2) low = Math.max(low, s.pts[i]);
    return Number.isFinite(low) ? Math.max(0, -low) : 0;
  };
  const lifts = frames.map((f, k) => (map.ground ? Math.round(gapOf(f) * scale - (rest - bottom(joints[k]))) : 0));
  const out = joints.map((q, k) => (lifts[k] ? { ...q, lift: lifts[k] } : q));

  // The stride: the clip's advance (its heights) in the puppet's box heights, by leg length.
  let advance = null;
  if (Array.isArray(clip.advance) && clip.advance.length === frames.length && clip.advance.every(Number.isFinite)) {
    const legOf = (n) => {
      const hip = make.pivotAt(n), ankle = make.pivotAt(n.replace(/^leg/, 'foot'));
      if (!hip) return 0;
      return ankle ? Math.hypot(ankle[0] - hip[0], ankle[1] - hip[1]) : make.ground[1] - hip[1];
    };
    const mine = ['leg-l', 'leg-r'].map(legOf).filter((v) => v > 0), mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const k = mine.length && hips.length ? mean(mine) / mean(hips) : (d.units || 1) / (clip.h || 1);
    const boxH = make.cel.box[3] || 1;
    advance = clip.advance.map((a) => Math.round(a * (clip.h || 1) * k / boxH * 1e4) / 1e4 || 0);
  }
  return {
    cycle: { fps: clip.fps ?? FPS, n: out.length, frames: out, ...(advance ? { advance } : {}) },
    report: { parts: names, flip: flip < 0, scale: Math.round(scale * 1000) / 1000, lift: lifts,
      ...(advance ? { stride: Math.round(advance.reduce((s, v) => s + v, 0) * 1e3) / 1e3 } : {}) },
  };
}
