// Found motion (v1 roto.js): real movement, traced into vector strokes by cli/roto.py and redrawn with the
// brush, one pose per drawn frame. The motion is real; every line on screen is still drawn by code.
//
//   registerClips(CLIPS);        // CLIPS: the default export of a clips module written by `hdf clip`
//   registerClip('horse', CLIPS.horse)                  // or one at a time
//   traced('horse', i, { x: 540, y: 800, h: 470, wash: 'fills.0' })   // pose i, feet at (x, y)
//   gap('horse', k)      how far pose k's lowest point is above the ground, in clip units
//   airborne('horse')    the pose highest off the ground
//
// A clip (plan 1.6): { n, fps, h, credit, source, frames: [{ outer: path, lines: [{ path, w }] }] }, in the
// clip's own units with the ground at y = 0 (so a pose in the air lifts itself). registerClip also takes
// the v1 shape (outer: [[[x, y], ...], ...], lines: [{ w, p: [[x, y], ...] }]), so a v1 clips.js converts
// by import. Clips live in a module-level registry: the film module registers them at import, which
// happens in every render worker and in the player alike.
import { group, fill, mkPath, stroke, translate, isPath } from '../core/list.js';
import { wash as washOp } from '../core/finish.js';

const CLIPS = new Map();

const pairsToFlat = (pts) => pts.flat();
const polyLen = (p) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };

function asOuter(outer) {
  if (isPath(outer)) return outer;
  if (outer && Array.isArray(outer.sub)) return mkPath(outer.sub.map((s) => ({ pts: [...s.pts], closed: s.closed !== false })));
  return mkPath(outer.map((c) => ({ pts: pairsToFlat(c), closed: true })));
}
function asLine(l) {
  const pts = l.path ? (isPath(l.path) ? l.path.sub[0].pts : l.path.sub?.[0]?.pts ?? l.path) : pairsToFlat(l.p);
  return { pts: [...pts], w: l.w };
}

// Registers (and returns) a clip. Lines are kept longest first, the order `p` draws them on in.
export function registerClip(name, data) {
  if (typeof name !== 'string' || !name) throw new TypeError('registerClip: needs a name');
  if (!data || !Array.isArray(data.frames) || !data.frames.length) throw new TypeError(`registerClip ${name}: expected { n, h, frames: [...] }`);
  const frames = data.frames.map((fr) => {
    const lines = fr.lines.map(asLine).filter((l) => l.pts.length >= 4)
      .map((l, j) => ({ ...l, len: polyLen(l.pts), j }))
      .sort((a, b) => b.len - a.len || a.j - b.j)
      .map(({ pts, w }) => Object.freeze({ path: mkPath([{ pts, closed: false }]), w }));
    return Object.freeze({ outer: asOuter(fr.outer), lines: Object.freeze(lines) });
  });
  const clip = Object.freeze({
    name, n: data.n ?? frames.length, fps: data.fps ?? 12, h: data.h, credit: data.credit ?? '', source: data.source ?? '', frames: Object.freeze(frames),
  });
  if (!(clip.h > 0)) throw new TypeError(`registerClip ${name}: h (the tallest pose, in clip units) must be > 0`);
  CLIPS.set(name, clip);
  return clip;
}

// Registers every clip of a clips module ({ name: data }); returns the registered clips by name.
export const registerClips = (all) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, registerClip(k, v)]));

export function clipOf(name) {
  const c = CLIPS.get(name);
  if (!c) throw new Error(`unknown clip '${name}' (register it with registerClip before drawing; have ${[...CLIPS.keys()].join(', ') || 'none'})`);
  return c;
}

// Pose k of the clip, looping both ways.
export const pose = (name, k) => { const c = clipOf(name); return c.frames[((Math.floor(k) % c.n) + c.n) % c.n]; };

// How far pose k's lowest point is above the ground, in clip units (v1 rotoGap).
export const gap = (name, k) => -pose(name, k).outer.box[1] - pose(name, k).outer.box[3];

// The pose that is highest off the ground (v1 rotoAirborne).
export function airborne(name) {
  const c = clipOf(name);
  let best = 0, g = -Infinity;
  for (let k = 0; k < c.n; k++) { const v = gap(name, k); if (v > g) { g = v; best = k; } }
  return best;
}

// Pose k as a group whose origin is the ground point (x, y). h: the height of the tallest pose in frame units.
// fill: body colour under the lines (a role, null for none); wash: a watercolour off the register (a role);
// ink, weight (stroke width factor), amp (brush wander), p: 0..1 draws the strokes on longest first, the
// body arriving with the first fifth. seed (boil it for a living line), alpha, maxLines.
// Points are scaled, flipped and turned into place, so stroke widths and the brush's wander are in frame
// units exactly as v1 drew them; only the translation is left in the group's xf, so a pose that holds
// still (or slides) is a cached layer.
export function traced(name, k, o = {}) {
  const {
    x = 540, y = 540, h = 300, flip = false, rot = 0, fill: body = 'light', wash = null, ink = 'ink', weight = 1, seed = 1, p = 1,
    washOff = 7, washAl = 0.55, alpha = 1, amp = 0.5, maxLines = Infinity,
  } = o;
  const c = clipOf(name), fr = pose(name, k), s = h / c.h, dir = flip ? -1 : 1, ca = Math.cos(rot), sa = Math.sin(rot);
  const m = [s * dir * ca, s * dir * sa, -s * sa, s * ca, 0, 0];
  const place = (path) => mkPath(path.sub.map((sub) => {
    const q = sub.pts, out = new Array(q.length);
    for (let i = 0; i < q.length; i += 2) { out[i] = m[0] * q[i] + m[2] * q[i + 1]; out[i + 1] = m[1] * q[i] + m[3] * q[i + 1]; }
    return { pts: out, closed: sub.closed };
  }));
  const kids = [];
  if (body || wash) {
    const outer = place(fr.outer);
    if (body) kids.push(fill(outer, body, { alpha: alpha * Math.min(1, p * 5), name: 'body' }));
    if (wash) kids.push(washOp(outer, wash, { al: washAl * alpha * Math.min(1, p * 2.5), off: washOff, seed: seed + 3 }));
  }
  const n = Math.min(fr.lines.length, maxLines), upto = p * n;
  for (let i = 0; i < n && i < upto; i++) {
    const l = fr.lines[i], pts = l.path.sub[0].pts;
    kids.push(stroke(place(l.path), ink, {
      tool: 'brush', w: Math.max(1.1, l.w * s * weight), amp, taper: 0.45, p: Math.min(1, upto - i), smooth: pts.length > 4,
      seed: seed + i * 7, order: i, name: `l${i}`, ...(alpha === 1 ? {} : { alpha }),
    }));
  }
  const pk = ((Math.floor(k) % c.n) + c.n) % c.n;
  return group({ name: o.name ?? `traced:${name}`, pose: pk, xf: translate(x, y) }, kids);
}
