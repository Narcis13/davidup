// Skeletons in clips (3.0 S14, v3 plan Q5): a traced pose's silhouette -> named joints a retarget can read.
// The silhouette is filled into a mask, thinned to its medial skeleton (core/skeleton.js), its whiskers
// pruned, and the end points of the largest piece labelled by a rig template, by position:
//
//   quadruped  the (up to) four lowest ends are the hooves, the front-most of the rest the head, the back-most
//              the tail tip. The tail -> head path is the spine; each hoof's path to the head joins it, and
//              the two hooves that join nearer the tail are the hind legs. hip / shoulder: the spine at the
//              mean join of the hind / fore pair. A knee is half way along its leg's path.
//   biped      the two lowest ends are the feet, the highest the head; hip is where the feet's paths to the
//              head meet, the two remaining ends with the longest arms are the hands, shoulder the mean of
//              where they join the hip -> head path; knees and elbows half way.
//
// Joints of a pair are numbered by position: 1 the leading one (furthest the way the figure faces), 2 the
// other (knee-h1, ankle-h1 / knee-f2, ...; biped knee-1, wrist-2). A joint a frame cannot find (the legs
// folded into one blob mid-gallop) is filled in from the frames either side, the clip looping.
//
//   rigClip(clip, 'quadruped')   the clip with frames[k].skel = { joints: { name: [x, y] }, chains: [[...]] }
//   skelOf(outer, 'biped', { h, facing })   one pose's joints, missing ones left out
//   skelOfMask({ mask, w, h, x0, y0, s }, rig, { h })   the same from a mask
//
// Coordinates are the clip's own: x from the middle, the ground at y = 0, up negative. Pure: no canvas.
import { degrees, prune, zhangSuen } from './skeleton.js';

// The rig templates: the joints each labels and the chains (joint paths, root first) a retarget can follow.
export const RIGS = Object.freeze({
  quadruped: Object.freeze({
    joints: Object.freeze(['head', 'shoulder', 'hip', 'tail-tip', 'knee-f1', 'ankle-f1', 'knee-f2', 'ankle-f2', 'knee-h1', 'ankle-h1', 'knee-h2', 'ankle-h2']),
    chains: Object.freeze([['tail-tip', 'hip', 'shoulder', 'head'], ['shoulder', 'knee-f1', 'ankle-f1'], ['shoulder', 'knee-f2', 'ankle-f2'],
      ['hip', 'knee-h1', 'ankle-h1'], ['hip', 'knee-h2', 'ankle-h2']].map(Object.freeze)),
  }),
  biped: Object.freeze({
    joints: Object.freeze(['head', 'shoulder', 'hip', 'elbow-1', 'wrist-1', 'elbow-2', 'wrist-2', 'knee-1', 'ankle-1', 'knee-2', 'ankle-2']),
    chains: Object.freeze([['hip', 'shoulder', 'head'], ['shoulder', 'elbow-1', 'wrist-1'], ['shoulder', 'elbow-2', 'wrist-2'],
      ['hip', 'knee-1', 'ankle-1'], ['hip', 'knee-2', 'ankle-2']].map(Object.freeze)),
  }),
});

const r1 = (v) => Math.round(v * 10) / 10;
const subsOf = (outer) => (Array.isArray(outer?.sub) ? outer.sub.map((s) => s.pts)
  : Array.isArray(outer) ? outer.map((c) => (Array.isArray(c[0]) ? c.flat() : c)) : []);

// A closed outline (flat point lists, even-odd) filled into a mask at s pixels a unit, with a 2 px margin.
// Pixel (i, j) is the point (x0 + (i + .5) / s, y0 + (j + .5) / s).
export function rasterise(outer, s = 1) {
  const subs = subsOf(outer).filter((p) => p.length >= 6);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of subs) for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  if (!Number.isFinite(x0)) return { mask: new Uint8Array(0), w: 0, h: 0, x0: 0, y0: 0, s };
  x0 -= 2 / s; y0 -= 2 / s;
  const w = Math.ceil((x1 - x0) * s) + 3, h = Math.ceil((y1 - y0) * s) + 3, mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) / s, xs = [];
    for (const p of subs) {
      const n = p.length / 2;
      for (let a = 0; a < n; a++) {
        const b = (a + 1) % n, ya = p[2 * a + 1], yb = p[2 * b + 1];
        if ((ya <= y) !== (yb <= y)) xs.push(p[2 * a] + (y - ya) / (yb - ya) * (p[2 * b] - p[2 * a]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) * s - 0.5)), i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) * s - 0.5));
      for (let i = i0; i <= i1; i++) mask[j * w + i] = 1;
    }
  }
  return { mask, w, h, x0, y0, s };
}

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
function nbrs(sk, w, h, i) {
  const x = i % w, y = (i - x) / w, out = [];
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && sk[ny * w + nx]) out.push(ny * w + nx);
  }
  return out;
}

// The largest 8-connected piece of a skeleton, as a mask.
function largest(sk, w, h) {
  const lab = new Int32Array(w * h).fill(-1), sizes = [];
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || lab[i] >= 0) continue;
    const id = sizes.length, stack = [i];
    lab[i] = id; let n = 0;
    while (stack.length) {
      const q = stack.pop(); n++;
      for (const r of nbrs(sk, w, h, q)) if (lab[r] < 0) { lab[r] = id; stack.push(r); }
    }
    sizes.push(n);
  }
  const best = sizes.indexOf(Math.max(...sizes));
  return Uint8Array.from(lab, (l) => (l === best && best >= 0 ? 1 : 0));
}

// Shortest paths over the skeleton from one pixel (steps of 1 and sqrt 2): { dist, prev }.
function tree(sk, w, h, root) {
  const dist = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1), done = new Uint8Array(w * h);
  dist[root] = 0;
  // The skeleton is thin, so a bucketed frontier by distance is plenty: a sorted array of open pixels.
  const open = [root];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
    const q = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (done[q]) continue;
    done[q] = 1;
    for (const r of nbrs(sk, w, h, q)) {
      const d = dist[q] + (r % w !== q % w && (r - r % w) !== (q - q % w) ? Math.SQRT2 : 1);
      if (d < dist[r]) { dist[r] = d; prev[r] = q; open.push(r); }
    }
  }
  return { dist, prev };
}

// The path from pixel a back to the tree's root: [a, ..., root].
const pathOf = (T, a) => { const out = []; for (let q = a; q >= 0; q = T.prev[q]) out.push(q); return out; };
// The pixel at arclength L along a path (from its start).
function along(T, path, L) {
  const d0 = T.dist[path[0]];
  for (const q of path) if (d0 - T.dist[q] >= L) return q;
  return path[path.length - 1];
}

// One pose's joints: { joints: { name: [x, y] } } with the joints it found. o: { h (the clip's height, for
// what 'low' means), facing (1 right, -1 left), s (pixels a unit), whisker (prune length, units) }.
export function skelOf(outer, rig, { h, facing = 1, s, whisker } = {}) {
  if (!RIGS[rig]) throw new Error(`rig: '${rig}' is not a rig (have ${Object.keys(RIGS).join(', ')})`);
  const subs = subsOf(outer);
  if (!subs.length) return { joints: {} };
  let top = Infinity, low = -Infinity;
  for (const p of subs) for (let i = 1; i < p.length; i += 2) { top = Math.min(top, p[i]); low = Math.max(low, p[i]); }
  const H = h ?? low - top, sc = s ?? Math.min(1, 320 / H);
  return skelOfMask(rasterise(outer, sc), rig, { h: H, facing, whisker });
}

// The same from a mask in hand: R is { mask, w, h, x0, y0, s } as rasterise() returns it (pixel (i, j) is
// the point (x0 + (i + .5) / s, y0 + (j + .5) / s)); o.h is the figure's height in those units.
export function skelOfMask(R, rig, { h: H, facing = 1, whisker } = {}) {
  if (!RIGS[rig]) throw new Error(`rig: '${rig}' is not a rig (have ${Object.keys(RIGS).join(', ')})`);
  const { w } = R, sc = R.s ?? 1;
  if (!R.w) return { joints: {} };
  if (!(H > 0)) throw new TypeError('skelOfMask: needs h, the figure\'s height');
  const thin = prune(zhangSuen(R.mask, R.w, R.h), R.w, R.h, Math.round((whisker ?? 0.08 * H) * sc));
  const sk = largest(thin, R.w, R.h), nb = degrees(sk, R.w, R.h);
  const at = (i) => [R.x0 + ((i % w) + 0.5) / sc, R.y0 + (Math.floor(i / w) + 0.5) / sc];
  const ends = [];
  for (let i = 0; i < sk.length; i++) if (sk[i] && nb[i] === 1) ends.push(i);
  const X = (i) => at(i)[0] * facing, Y = (i) => at(i)[1];
  const J = {};
  const put = (name, i) => { if (i !== undefined && i >= 0) J[name] = at(i).map(r1); };
  const mean = (pts) => [r1(pts.reduce((a, p) => a + p[0], 0) / pts.length), r1(pts.reduce((a, p) => a + p[1], 0) / pts.length)];
  // A limb: its end, its path to the tree root, where that path meets the `trunk` set of pixels, its length.
  const limb = (T, trunk, e) => {
    const path = pathOf(T, e), k = path.findIndex((q) => trunk.has(q));
    const leg = k < 0 ? path : path.slice(0, k + 1);
    return { end: e, join: leg[leg.length - 1], path: leg, len: T.dist[e] - T.dist[leg[leg.length - 1]] };
  };
  const pair = (limbs, knee, ankle, tag, T) => {
    limbs.sort((a, b) => X(b.end) - X(a.end)).forEach((l, k) => {
      put(`${ankle}-${tag}${k + 1}`, l.end);
      put(`${knee}-${tag}${k + 1}`, along(T, l.path, l.len / 2));
    });
  };

  if (rig === 'quadruped') {
    const feet = ends.filter((e) => Y(e) > -0.35 * H).sort((a, b) => Y(b) - Y(a) || X(a) - X(b)).slice(0, 4);
    const rest = ends.filter((e) => !feet.includes(e)).sort((a, b) => X(b) - X(a));
    if (!rest.length) return { joints: J };
    const head = rest[0], tail = rest.length > 1 ? rest[rest.length - 1] : undefined;
    put('head', head);
    if (tail === undefined) return { joints: J };
    put('tail-tip', tail);
    const T = tree(sk, R.w, R.h, head), spine = pathOf(T, tail), onSpine = new Set(spine);
    const S = T.dist[tail], pos = (q) => S - T.dist[q];   // arclength from the tail tip
    const legs = feet.map((e) => limb(T, onSpine, e)).sort((a, b) => pos(a.join) - pos(b.join));
    const hind = legs.length >= 4 ? legs.slice(0, 2) : legs.filter((l) => pos(l.join) < S / 2);
    const fore = legs.length >= 4 ? legs.slice(2) : legs.filter((l) => pos(l.join) >= S / 2);
    const frac = (group) => group.reduce((a, l) => a + pos(l.join), 0) / group.length / S;
    if (hind.length) put('hip', along(T, spine, frac(hind) * S));
    if (fore.length) put('shoulder', along(T, spine, frac(fore) * S));
    pair(hind, 'knee', 'ankle', 'h', T);
    pair(fore, 'knee', 'ankle', 'f', T);
    // What rigClip needs to steady the hip and shoulder over the clip: the spine, tail tip first, and where
    // along it (0 .. 1) each pair joined.
    return {
      joints: J, spine: spine.map((q) => at(q).map(r1)), feet: feet.length,
      at: { ...(hind.length ? { hip: frac(hind) } : {}), ...(fore.length ? { shoulder: frac(fore) } : {}) },
    };
  }

  // biped
  const feet = ends.filter((e) => Y(e) > -0.4 * H).sort((a, b) => Y(b) - Y(a) || X(a) - X(b)).slice(0, 2);
  const rest = ends.filter((e) => !feet.includes(e)).sort((a, b) => Y(a) - Y(b) || X(b) - X(a));
  if (!rest.length) return { joints: J };
  const head = rest[0];
  put('head', head);
  const T = tree(sk, R.w, R.h, head);
  if (!feet.length) return { joints: J };
  let hip;
  if (feet.length === 2) {
    const a = new Set(pathOf(T, feet[0]));
    hip = pathOf(T, feet[1]).find((q) => a.has(q));
  } else hip = along(T, pathOf(T, feet[0]), T.dist[feet[0]] * 0.5);
  put('hip', hip);
  const trunk = new Set(pathOf(T, hip));
  const legs = feet.map((e) => limb(T, trunk, e));
  const arms = rest.slice(1).map((e) => limb(T, trunk, e)).filter((l) => l.join !== hip).sort((a, b) => b.len - a.len).slice(0, 2);
  if (arms.length) J.shoulder = mean(arms.map((l) => at(l.join)));
  pair(legs, 'knee', 'ankle', '', T);
  pair(arms, 'elbow', 'wrist', '', T);
  return { joints: J };
}

// Joints missing from some frames, filled in along the loop from the nearest frames that have them.
export function fillJoints(frames, names) {
  const n = frames.length;
  for (const name of names) {
    const have = frames.map((f, k) => (f[name] ? k : -1)).filter((k) => k >= 0);
    if (!have.length || have.length === n) continue;
    for (let k = 0; k < n; k++) {
      if (frames[k][name]) continue;
      const a = have.reduce((b, j) => (((k - j + n) % n) < ((k - b + n) % n) ? j : b)), b = have.reduce((c, j) => (((j - k + n) % n) < ((c - k + n) % n) ? j : c));
      const da = (k - a + n) % n, db = (b - k + n) % n, t = a === b ? 0 : da / (da + db);
      frames[k][name] = [0, 1].map((i) => r1(frames[a][name][i] + (frames[b][name][i] - frames[a][name][i]) * t));
    }
  }
  return frames;
}

const median = (v) => { const a = [...v].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
// The point at fraction f along a polyline.
function onLine(pts, f) {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), L = seg.reduce((a, b) => a + b, 0);
  let d = f * L;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const t = seg[i] ? Math.min(1, d / seg[i]) : 0; return [0, 1].map((k) => r1(pts[i][k] + (pts[i + 1][k] - pts[i][k]) * t)); }
    d -= seg[i];
  }
  return pts[0];
}

// A gallop's hip and shoulder sit at much the same place along the spine all the way through, while the legs
// they are found from fold into the belly for a frame or three. So: hip and shoulder at the clip's median
// place along each frame's own spine, and a frame whose legs joined far from it (or that found fewer than
// four) loses its legs, which fillJoints then carries over from the frames either side.
function steady(got, tol = 0.12) {
  const fresh = got.filter((g) => !g.kept && g.spine?.length > 1);
  const good = fresh.filter((g) => g.feet === 4 && g.at.hip !== undefined && g.at.shoulder !== undefined);
  if (!good.length) return;
  const fh = median(good.map((g) => g.at.hip)), fs = median(good.map((g) => g.at.shoulder));
  for (const g of fresh) {
    const ok = g.feet === 4 && Math.abs(g.at.hip - fh) <= tol && Math.abs(g.at.shoulder - fs) <= tol;
    g.joints.hip = onLine(g.spine, fh);
    g.joints.shoulder = onLine(g.spine, fs);
    if (!ok) for (const k of Object.keys(g.joints)) if (/^(knee|ankle)-/.test(k)) delete g.joints[k];
  }
  // A spine does not pitch far from its usual line for one frame: when it seems to, the tail -> head path has
  // gone round something (a rider's arm joining the head on), and the shoulder is taken from the frames
  // either side instead.
  const pitch = (g) => Math.atan2(g.joints.shoulder[1] - g.joints.hip[1], g.joints.shoulder[0] - g.joints.hip[0]) * 180 / Math.PI;
  const usual = median(fresh.map(pitch));
  for (const g of fresh) if (Math.abs(pitch(g) - usual) > 15) delete g.joints.shoulder;
}

// A clip with a skeleton in every frame (a clip's frames that already carry one keep it unless force).
// Returns a new clip object; rig and facing are recorded on it.
export function rigClip(clip, rig, { facing = clip.facing ?? 1, force = false, ...o } = {}) {
  if (!RIGS[rig]) throw new Error(`rig: '${rig}' is not a rig (have ${Object.keys(RIGS).join(', ')})`);
  const T = RIGS[rig];
  const got = clip.frames.map((fr) => (!force && fr.skel?.joints ? { joints: { ...fr.skel.joints }, kept: true } : skelOf(fr.outer, rig, { h: clip.h, facing, ...o })));
  if (rig === 'quadruped') steady(got);
  const found = got.map((g) => g.joints);
  fillJoints(found, T.joints);
  const chains = T.chains.map((c) => [...c]);
  const frames = clip.frames.map((fr, k) => {
    const joints = Object.fromEntries(T.joints.filter((j) => found[k][j]).map((j) => [j, found[k][j]]));
    return { ...fr, skel: { joints, chains: chains.filter((c) => c.every((j) => joints[j])) } };
  });
  return { ...clip, rig, facing, frames };
}
