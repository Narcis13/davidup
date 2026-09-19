// Sand on a light table (v1 sand.js). The frame is not redrawn from nothing: it is a bed of sand that
// remembers. Gestures pour it, sprinkle it, draw in it with a fingertip, comb it, sweep it with the palm, blow
// it sideways; sand pushed aside piles into ridges and slumps into cones. One picture becomes the next.
//
//   const bed = sim('one-year', { gestures: [G.sprinkle(.2, .66, pts, { r: 240 }), G.pour(...)], N: 540 });
//   shot('sand', 36, ({ t }) => bed.frame(t))            // the bed, what flies over it, the hand
//   bed(t, { view: { x, y, w }, tint: [r, g, b] })      // just the bed, an image op covering the frame
//   bed.hiss()                                           // score events: every gesture hisses while it lasts
//
// The table is a square of `world` units (default 1080, the frame), the bed N x N cells over it; gesture
// points and times are world units and seconds of shot time. State is a Float32Array height field plus the
// grain generator's seed, stepped at dt (1/48 s). stateAt(K) steps forward from whatever is nearest: the live
// state, or a checkpoint (a copy of the field every `every` drawn frames). So a render worker whose range
// starts at frame k steps from the last checkpoint it has (from zero in a fresh worker) and then only
// forwards, and every worker arrives at bit-identical state: the stepping is the same float32 arithmetic in
// the same order whoever does it.
//
// The bed reaches the rasteriser as image('sim:<name>?K=..&v=..&t=..'): the src names the state, the camera
// and the lamp, so frames hash and dedup, and the pixels are computed at the op's device size.
import { ease } from '../core/curves.js';
import { circle, fill, group, image } from '../core/list.js';
import { rng } from '../core/rand.js';
import { registerSource } from '../core/sources.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, t) => { const u = clamp((t - a) / (b - a), 0, 1); return u; };
const easeOf = (e, dflt) => (typeof e === 'function' ? e : e ? ease[e] : dflt);

// ---------- paths ----------

export function pathOf(pts) {
  const P = pts.map((p) => [p[0], p[1]]), L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return { P, L, len: L[L.length - 1] || 1e-6 };
}
// [x, y, dx, dy] at arc length s.
export function pointAt(path, s) {
  const { P, L } = path;
  s = clamp(s, 0, path.len);
  let i = 1;
  while (i < P.length - 1 && L[i] < s) i++;
  const a = P[i - 1], b = P[i] || a, seg = Math.max(1e-6, L[i] - L[i - 1]), t = clamp((s - L[i - 1]) / seg, 0, 1), dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), dx / d, dy / d];
}
// A back-and-forth path covering a polygon, passes `spacing` apart (for wiping or pouring an area).
export function scanFill(poly, spacing, angle = 0) {
  const ca = Math.cos(-angle), sa = Math.sin(-angle), R = poly.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
  let y0 = 1e9, y1 = -1e9;
  for (const p of R) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const out = [];
  let flip = false;
  for (let y = y0 + spacing / 2; y < y1; y += spacing) {
    const xs = [];
    for (let i = 0; i < R.length; i++) { const a = R[i], b = R[(i + 1) % R.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const seg = [[xs[k], y], [xs[k + 1], y]]; if (flip) seg.reverse(); out.push(...seg); }
    flip = !flip;
  }
  const cb = Math.cos(angle), sb = Math.sin(angle);
  return out.map(([x, y]) => [x * cb - y * sb, x * sb + y * cb]);
}
export const circlePts = (cx, cy, r, n = 28, a0 = 0, turns = 1) => Array.from({ length: Math.round(n * turns) + 1 }, (_, k) => { const a = a0 + k / n * TAU; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
export const spiralPts = (cx, cy, r, turns = 3, n = 24) => Array.from({ length: Math.round(turns * n) + 1 }, (_, k) => { const u = k / (turns * n), a = u * turns * TAU; return [cx + Math.cos(a) * r * u, cy + Math.sin(a) * r * u]; });

// ---------- gestures (times in seconds, points in world units) ----------

const lin = (t) => t;
export const G = {
  // a stream from the fist: dark lines, trunks, letters
  pour: (t0, t1, pts, o = {}) => ({ tool: 'pour', t0, t1, path: pathOf(pts), r: o.r ?? 10, amount: o.amount ?? 1.6, ease: easeOf(o.ease, lin), hover: true }),
  // a cloud from the fingers: skies, ground, crowns
  sprinkle: (t0, t1, pts, o = {}) => ({ tool: 'sprinkle', t0, t1, path: pathOf(pts), r: o.r ?? 120, amount: o.amount ?? 1.2, ease: easeOf(o.ease, lin), hover: true }),
  // a fingertip clearing a line down to the light
  finger: (t0, t1, pts, o = {}) => ({ tool: 'wipe', t0, t1, path: pathOf(pts), r: o.r ?? 9, strength: o.strength ?? 1, keep: o.keep ?? 1, ease: easeOf(o.ease, ease.io), hand: 'finger' }),
  // a sweep; keep < 1 carries sand off the table
  palm: (t0, t1, pts, o = {}) => ({ tool: 'wipe', t0, t1, path: pathOf(pts), r: o.r ?? 70, strength: o.strength ?? 0.9, streaks: o.streaks ?? 0.4, keep: o.keep ?? 1, ease: easeOf(o.ease, ease.io), hand: 'palm' }),
  // one touch; hand: null for a mark nobody makes
  dab: (t, x, y, o = {}) => ({ tool: 'wipe', t0: t, t1: t + (o.dur ?? 0.07), path: pathOf([[x, y], [x + 0.5, y + 0.5]]), r: o.r ?? 6, strength: 1, keep: o.keep ?? 1, ease: lin, hand: o.hand === undefined ? 'finger' : o.hand, quick: true }),
  // several fingers at once: water, fields, fur
  comb: (t0, t1, pts, o = {}) => {
    const n = o.fingers ?? 4, sp = o.spacing ?? 26, base = pathOf(pts), out = [];
    for (let f = 0; f < n; f++) {
      const off = (f - (n - 1) / 2) * sp, P = [];
      for (let s = 0; s <= base.len; s += 8) { const q = pointAt(base, s); P.push([q[0] - q[3] * off, q[1] + q[2] * off]); }
      out.push({ tool: 'wipe', t0, t1, path: pathOf(P), r: o.r ?? 7, strength: o.strength ?? 1, keep: o.keep ?? 1, ease: easeOf(o.ease, ease.io), hand: f === Math.floor(n / 2) ? 'palm' : null });
    }
    return out;
  },
  // a snake that covers a polygon
  fill: (t0, t1, poly, o = {}) => {
    const tool = o.tool || 'pour', r = o.r ?? (tool === 'pour' ? 12 : 16), pts = scanFill(poly, o.spacing ?? r * 1.3, o.angle ?? 0);
    return tool === 'pour' ? G.pour(t0, t1, pts, { r, amount: o.amount ?? 1.4 }) : G.finger(t0, t1, pts, { r, strength: o.strength ?? 1, keep: o.keep ?? 1 });
  },
  // the hand goes somewhere and touches nothing
  move: (t0, t1, pts, o = {}) => ({ tool: 'none', t0, t1, path: pathOf(pts), r: 1, ease: easeOf(o.ease, ease.io), hand: o.hand || 'palm' }),
  // the top layer inside box creeps along (vx, vy) units a second, fading out over `feather` at the box's edges
  wind: (t0, t1, o = {}) => ({ tool: 'wind', t0, t1, box: o.box || null, feather: o.feather ?? 160, vx: o.vx ?? 900, vy: o.vy ?? -60, strength: o.strength ?? 0.5, lift: o.lift ?? 1.4, turb: o.turb ?? 0.5, ease: easeOf(o.ease, lin), hand: null, path: pathOf([[0, 0], [1, 1]]) }),
  // a grain, a seed, a flake in the air: drawn over the bed while it travels, lands as a small pour
  fly: (t0, t1, pts, o = {}) => ({ tool: 'fly', t0, t1, path: pathOf(pts), r: o.r ?? 5, light: !!o.light, land: o.land === undefined ? { r: o.r ?? 5, amount: 2.4 } : o.land, wob: o.wob ?? 0, seed: o.seed ?? 1, ease: easeOf(o.ease, lin), hand: null }),
};

// An init that starts the film on a table already covered, inside box [x0, y0, x1, y1] (world units).
export const cover = ({ box = null, amount = 3.2, grain = 0.5, feather = 140, seed = 3 } = {}) => (h, N, world) => {
  const k = N / world, r = rng(seed), [x0, y0, x1, y1] = box || [0, 0, world, world], fw = Math.max(1, feather * k);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = Math.min((i - x0 * k) / fw, (x1 * k - i) / fw, (j - y0 * k) / fw, (y1 * k - j) / fw);
    if (e <= 0) continue;
    h[j * N + i] += amount * (e >= 1 ? 1 : e * e * (3 - 2 * e)) * (1 - grain / 2 + grain * r());
  }
};

// ---------- the simulation ----------

const SIMS = new Map();

export function sim(name, { N = 540, world = 1080, dt = 1 / 48, every = 24, gestures = [], init = null, hand = true, air = { light: { base: 'paper', tint: 0.8 }, dark: 'ink' } } = {}) {
  if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) throw new TypeError(`sim: name must be a word, got '${name}'`);
  const all = gestures.flat(Infinity).filter(Boolean).sort((a, b) => a.t0 - b.t0);
  for (const g of all) if (g.tool === 'wind' && !g.box) g.box = [0, 0, world, world];
  const flyers = all.filter((g) => g.tool === 'fly');
  const perCheckpoint = Math.max(1, Math.round(every / 12 / dt));
  const streak = new Float32Array(4096);
  { let s = 7; for (let i = 0; i < 4096; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; streak[i] = s / 4294967296; } }
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < 4095; i++) streak[i] = (streak[i - 1] + streak[i] * 2 + streak[i + 1]) / 4;

  // live state; every step mutates it in place
  const S = { h: new Float32Array(N * N), seed: 1, k: 0 };
  const reset = () => { S.h.fill(0); S.seed = 1; S.k = 0; if (init) init(S.h, N, world); };
  reset();
  const checkpoints = new Map([[0, { h: S.h.slice(), seed: S.seed }]]);
  const srand = () => { S.seed = (Math.imul(S.seed, 1664525) + 1013904223) >>> 0; return S.seed / 4294967296; };
  const cellNoise = (i, j) => streak[(Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & 4095];

  // sand steeper than the angle of repose falls to its lowest neighbour, so heaps become cones
  function slump(box, passes = 1, talus = 2.2) {
    const h = S.h, x0 = Math.max(1, box[0]), y0 = Math.max(1, box[1]), x1 = Math.min(N - 2, box[2]), y1 = Math.min(N - 2, box[3]);
    for (let p = 0; p < passes; p++) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const q = j * N + i, hc = h[q];
      if (hc < talus) continue;
      let bi = -1, bd = talus;
      for (const nb of [q - 1, q + 1, q - N, q + N]) { const d = hc - h[nb]; if (d > bd) { bd = d; bi = nb; } }
      if (bi >= 0) { const m = (bd - talus) * 0.25; h[q] -= m; h[bi] += m; }
    }
  }
  function pour(x, y, r, amount) {
    const h = S.h, R = Math.ceil(r * 2.2), s2 = r * r * 0.5, x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(N - 1, Math.ceil(x + R)), y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(N - 1, Math.ceil(y + R));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const d2 = (i - x) * (i - x) + (j - y) * (j - y), g = Math.exp(-d2 / (2 * s2));
      if (g < 0.02) continue;
      h[j * N + i] += amount * g * (0.55 + 0.9 * srand());
    }
    for (let k = 0; k < 3; k++) {   // stray grains
      const a = srand() * TAU, d = r * (1.5 + srand() * 3.5), i = Math.round(x + Math.cos(a) * d), j = Math.round(y + Math.sin(a) * d);
      if (i >= 0 && j >= 0 && i < N && j < N) h[j * N + i] += 0.5 + srand() * 0.5;
    }
    if (r > 4) slump([x0, y0, x1, y1]);
  }
  function sprinkle(x, y, R, grains, amount) {
    const h = S.h;
    for (let k = 0; k < grains; k++) {
      const a = srand() * TAU, d = R * Math.sqrt(srand()) * (0.55 + 0.45 * srand()), fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d * 0.8, i = Math.floor(fx), j = Math.floor(fy);
      if (i < 1 || j < 1 || i >= N - 2 || j >= N - 2) continue;
      const tx = fx - i, ty = fy - j, v = amount * (0.4 + 1.2 * srand()), p = j * N + i;
      h[p] += v * (1 - tx) * (1 - ty); h[p + 1] += v * tx * (1 - ty); h[p + N] += v * (1 - tx) * ty; h[p + N + 1] += v * tx * ty;
    }
  }
  // a fingertip or a palm: a ragged edge (each cell its own threshold), the sand it moves pushed ahead and
  // aside into a soft berm, never back into the trail
  function wipe(x, y, r, dx, dy, strength, streaks, keep = 1) {
    const h = S.h, rw = Math.max(3, r * 0.75), R = Math.ceil(r * 1.12 + rw + 1), x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(N - 1, Math.ceil(x + R)), y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(N - 1, Math.ceil(y + R));
    let moved = 0, wsum = 0;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const ex = i - x, ey = j - y, d = Math.hypot(ex, ey), re = r * (0.88 + 0.3 * cellNoise(i, j));
      if (d < re) {
        let k = strength * (1 - sm(0.5 * r, re, d));
        if (streaks) { const perp = ex * -dy + ey * dx; k *= 1 - streaks * streak[(Math.round(perp * 3 + 2048) & 4095)]; }
        const p = j * N + i, m = h[p] * k;
        h[p] -= m; moved += m;
      } else if (d < re + rw) { const f = (ex * dx + ey * dy) / (d || 1), wv = (0.3 + 0.9 * f) * (1 - (d - re) / rw); if (wv > 0) wsum += wv; }
    }
    if (moved <= 0 || wsum <= 0 || keep <= 0) return;
    const per = moved * keep / wsum;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const ex = i - x, ey = j - y, d = Math.hypot(ex, ey), re = r * (0.88 + 0.3 * cellNoise(i, j));
      if (d >= re && d < re + rw) { const f = (ex * dx + ey * dy) / (d || 1), wv = (0.3 + 0.9 * f) * (1 - (d - re) / rw); if (wv > 0) h[j * N + i] += per * wv * (0.7 + 0.6 * srand()); }
    }
  }
  function blow(g) {
    const h = S.h, k = N / world, bx0 = Math.max(1, Math.floor(g.box[0] * k)), by0 = Math.max(1, Math.floor(g.box[1] * k)), bx1 = Math.min(N - 2, Math.ceil(g.box[2] * k)), by1 = Math.min(N - 2, Math.ceil(g.box[3] * k));
    const dx = g.vx * k * dt, dy = g.vy * k * dt, sx = dx >= 0 ? -1 : 1, s = g.strength, lift = g.lift, tb = g.turb, fw = Math.max(1, g.feather * k);
    for (let j = by0; j <= by1; j++) {
      const i0 = sx < 0 ? bx1 : bx0, i1 = sx < 0 ? bx0 : bx1, ey = Math.min(1, (j - by0) / fw, (by1 - j) / fw);
      for (let i = i0; sx < 0 ? i >= i1 : i <= i1; i += sx) {
        const p = j * N + i, hv = h[p];
        if (hv < 0.05) continue;
        let e = Math.min(ey, (i - bx0) / fw, (bx1 - i) / fw);
        if (e <= 0) continue;
        e = e > 1 ? 1 : e * e * (3 - 2 * e);
        const tu = streak[(i * 7 + j * 13 + (S.k * 3)) & 4095] * 0.6 + streak[(i * 23 + j * 3 + 900) & 4095] * 0.4;
        const take = Math.min(hv, lift) * s * e * (0.6 + 0.8 * tu);
        if (take < 0.01) continue;
        const ti = Math.round(i + dx * e * (0.7 + 0.6 * tu)), tj = Math.round(j + dy * e * (0.7 + 0.6 * tu) + (tu - 0.5) * tb * 4);
        h[p] -= take;
        if (ti >= 0 && tj >= 0 && ti < N && tj < N) h[tj * N + ti] += take;
      }
    }
  }
  function apply(g, ta, tb) {
    if (g.tool === 'none') return;
    const k = N / world;
    if (g.tool === 'wind') { if (tb > g.t0 && ta < g.t1) blow(g); return; }
    if (g.tool === 'fly') { if (g.land && ta <= g.t1 && tb > g.t1) { const q = pointAt(g.path, g.path.len); pour(q[0] * k, q[1] * k, (g.land.r ?? g.r) * k, g.land.amount ?? 2.4); } return; }
    const ua = g.ease(clamp((ta - g.t0) / (g.t1 - g.t0), 0, 1)), ub = g.ease(clamp((tb - g.t0) / (g.t1 - g.t0), 0, 1));
    if (ub <= ua && !(g.quick && ta <= g.t0)) return;
    const sa = ua * g.path.len, sb = ub * g.path.len, r = g.r * k;
    if (g.tool === 'sprinkle') { const q = pointAt(g.path, (sa + sb) / 2); sprinkle(q[0] * k, q[1] * k, r, Math.max(1, Math.round(r * r * 0.075 * g.amount)), 0.42); return; }
    const step = Math.max(0.8, r * (g.tool === 'pour' ? 0.5 : 0.22)) / k;
    for (let s = sa; s <= sb + 1e-9; s += step) {
      const q = pointAt(g.path, s);
      if (g.tool === 'pour') pour(q[0] * k, q[1] * k, r, g.amount * 0.42); else wipe(q[0] * k, q[1] * k, r, q[2], q[3], g.strength, g.streaks || 0, g.keep ?? 1);
      if (sb - sa < 1e-6) break;
    }
  }
  function step() {
    const ta = S.k * dt, tb = ta + dt;
    for (const g of all) { if (g.t0 >= tb) break; if (g.t1 > ta - dt) apply(g, ta, tb); }
    S.k++;
    if (S.k % perCheckpoint === 0 && !checkpoints.has(S.k)) checkpoints.set(S.k, { h: S.h.slice(), seed: S.seed });
  }
  // The live state brought to step K: forwards from itself, or from the nearest checkpoint at or before K.
  function stateAt(K) {
    K = Math.max(0, Math.floor(K));
    const c = Math.floor(K / perCheckpoint) * perCheckpoint;
    let best = -1;
    for (let q = c; q >= 0; q -= perCheckpoint) if (checkpoints.has(q)) { best = q; break; }
    if (!(S.k <= K && S.k >= best)) { const cp = checkpoints.get(best); S.h.set(cp.h); S.seed = cp.seed; S.k = best; }
    while (S.k < K) step();
    return S;
  }
  const stepOf = (t) => Math.floor(t / dt + 1e-6);

  // ---------- the look ----------
  const tex = new Map();
  function textures(w, h) {
    const key = `${w}x${h}`;
    if (tex.has(key)) return tex.get(key);
    const n = w * h, gr = new Float32Array(n);
    let s = 99;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const w2 = Math.ceil(w / 2), w4 = Math.ceil(w / 4), n2 = new Float32Array(w2 * Math.ceil(h / 2)), n4 = new Float32Array(w4 * Math.ceil(h / 4));
    for (let i = 0; i < n2.length; i++) n2[i] = rnd();
    for (let i = 0; i < n4.length; i++) n4[i] = rnd();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gr[y * w + x] = 0.46 * rnd() + 0.34 * n2[(y >> 1) * w2 + (x >> 1)] + 0.2 * n4[(y >> 2) * w4 + (x >> 2)];
    const t = { grain: gr, canvas: null };
    if (tex.size > 4) tex.clear();
    tex.set(key, t);
    return t;
  }
  const viewRect = (V, aspect) => { const v = V || { x: world / 2, y: world / 2, w: world }; return { x: v.x, y: v.y, w: v.w, h: v.w * aspect }; };
  // The bed as pixels, w x h, through the camera V (world units, the window that fills the image), under a lamp tint.
  function pixels(K, w, h, V, tn, makeCanvas) {
    const T = textures(w, h);
    if (!T.canvas) T.canvas = makeCanvas(w, h);
    const g = T.canvas.getContext('2d'), img = g.createImageData(w, h), out = img.data;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);   // a recording canvas (skia) keeps every earlier putImageData unless fully cleared
    const hf = stateAt(K).h, gr = T.grain, R = viewRect(V, h / w), kc = (N - 1) / world;
    const stepx = R.w / w, stepy = R.h / h, wx0 = R.x - R.w / 2, wy0 = R.y - R.h / 2, lx = world / 2, ly = world * 0.46, inv = 1 / world;
    const tr = tn ? tn[0] : 1, tg = tn ? tn[1] : 1, tb2 = tn ? tn[2] : 1;
    for (let y = 0; y < h; y++) {
      const wy = wy0 + (y + 0.5) * stepy, fy = clamp(wy * kc, 0, N - 1.001), j = fy | 0, ty = fy - j, row = j * N, dv = (wy - ly) * inv;
      for (let x = 0; x < w; x++) {
        const wx = wx0 + (x + 0.5) * stepx, fx = clamp(wx * kc, 0, N - 1.001), i = fx | 0, tx = fx - i, p0 = row + i;
        const a0 = hf[p0] + (hf[p0 + 1] - hf[p0]) * tx, a1 = hf[p0 + N] + (hf[p0 + N + 1] - hf[p0 + N]) * tx, hh = a0 + (a1 - a0) * ty, p = y * w + x;
        const du = (wx - lx) * inv * 1.05, d2 = du * du + dv * dv, hot = 1 / (1 + 3.1 * d2 + 2.6 * d2 * d2);
        let e = (Math.sqrt(d2) - 0.5) / 0.28; e = e < 0 ? 0 : e > 1 ? 1 : e;
        const edge = e * e * (3 - 2 * e), cov = 1 - Math.exp(-hh * 1.25);
        let a = (cov - gr[p]) * 6 + 0.5; a = a < 0 ? 0 : a > 1 ? 1 : a;
        const dep = hh > 2.6 ? 1 : hh / 2.6, dim = 1 - 0.3 * cov, q = p * 4;
        out[q] = ((250 * hot + 226 * (1 - hot)) * (1 - 0.62 * edge) * tr) * dim * (1 - a) + (118 - 94 * dep) * a;
        out[q + 1] = ((232 * hot + 168 * (1 - hot)) * (1 - 0.7 * edge) * tg) * dim * (1 - a) + (66 - 53 * dep) * a;
        out[q + 2] = ((196 * hot + 92 * (1 - hot)) * (1 - 0.8 * edge) * tb2) * dim * (1 - a) + (26 - 19 * dep) * a;
        out[q + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return T.canvas;
  }

  // ---------- the hand: a soft shadow that does the work ----------
  function handState(t, V, aspect) {
    const gs = all.filter((g) => g.hand !== null);
    let act = null;
    for (const g of gs) if (t >= g.t0 && t <= g.t1) { act = g; break; }
    const at = (g) => { const q = pointAt(g.path, g.ease(clamp((t - g.t0) / (g.t1 - g.t0), 0, 1)) * g.path.len); return [q[0], q[1]]; };
    if (act) return { p: at(act), lift: act.hover ? 0.55 : 0, kind: act.hand || (act.hover ? 'fist' : 'finger'), a: 1 };
    let prev = null, next = null;
    for (const g of gs) { if (g.t1 < t) prev = g; else if (g.t0 > t) { next = g; break; } }
    const RV = viewRect(V, aspect), rest = [RV.x + RV.w * 0.85, RV.y + RV.h * 0.95];
    const pe = prev ? pointAt(prev.path, prev.path.len) : rest, ns = next ? pointAt(next.path, 0) : rest;
    const dtp = prev ? t - prev.t1 : 9, dtn = next ? next.t0 - t : 9, gap = prev && next ? next.t0 - prev.t1 : 9;
    if (gap < 1.2) { const u = ease.io(dtp / gap); return { p: [lerp(pe[0], ns[0], u), lerp(pe[1], ns[1], u)], lift: 0.8 * Math.sin(u * Math.PI) + 0.1, kind: next.hand || 'fist', a: 1 }; }
    if (dtn < 0.6) { const u = ease.out(1 - dtn / 0.6); return { p: [lerp(rest[0], ns[0], u), lerp(rest[1], ns[1], u)], lift: 1 - u * 0.6, kind: next.hand || 'fist', a: u }; }
    if (dtp < 0.6) { const u = ease.in(dtp / 0.6); return { p: [lerp(pe[0], rest[0], u), lerp(pe[1], rest[1], u)], lift: 0.3 + u * 0.7, kind: prev.hand || 'fist', a: 1 - u }; }
    return null;
  }
  // The hand's silhouette on a canvas 1/9 of the frame (drawn large, which is what blurs it). st in frame units.
  const Q = 9;
  let handCanvas = null;
  function handPixels({ x: px, y: py, lift, kind, sc, W, H }, makeCanvas) {
    const cw = Math.ceil(W / Q), ch = Math.ceil(H / Q);
    if (!handCanvas || handCanvas.width !== cw || handCanvas.height !== ch) handCanvas = makeCanvas(cw, ch);
    const g = handCanvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); g.setTransform(1 / Q, 0, 0, 1 / Q, 0, 0);
    const off = lift * 70 * sc, tx = px + off * 0.5, ty = py + off, sh = [W + 200, H + 520], dx = sh[0] - tx, dy = sh[1] - ty, dl = Math.hypot(dx, dy), ux = dx / dl, uy = dy / dl, nx = -uy, ny = ux, s = (1 + lift * 0.3) * sc;
    g.fillStyle = '#1c0e05'; g.strokeStyle = '#1c0e05'; g.lineCap = 'round'; g.lineJoin = 'round';
    const at = (along, side) => [tx + ux * along * s + nx * side * s, ty + uy * along * s + ny * side * s];
    const seg = (a, b, w) => { g.lineWidth = w * s; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); };
    const blob = (p, rx, ry) => { g.beginPath(); g.ellipse(p[0], p[1], rx * s, ry * s, Math.atan2(uy, ux), 0, TAU); g.fill(); };
    if (kind === 'finger') { seg(at(6, 0), at(104, 3), 23); blob(at(160, 14), 66, 58); seg(at(128, -44), at(84, -50), 27); seg(at(118, 40), at(100, 52), 30); }
    else if (kind === 'palm') { [[12, -44, 26], [0, -15, 27], [8, 15, 27], [34, 44, 24]].forEach(([tip, side, w]) => seg(at(tip + 12, side * 1.05), at(112, side * 0.8), w)); blob(at(160, 2), 70, 66); seg(at(150, -64), at(84, -104), 29); }
    else { blob(at(64, 0), 64, 58); seg(at(40, -52), at(88, -48), 30); }
    const w0 = kind === 'fist' ? [118, 6] : [212, 14];
    g.lineWidth = 86 * s; g.beginPath(); g.moveTo(...at(w0[0], w0[1])); g.lineTo(...at(w0[0] + 110, w0[1] + 12)); g.stroke();
    g.lineWidth = 104 * s; g.beginPath(); g.moveTo(...at(w0[0] + 110, w0[1] + 12)); g.lineTo(...at(dl / s + 80, 60)); g.stroke();
    return handCanvas;
  }

  // ---------- the node factory ----------
  const fmt = (v) => +v.toFixed(3);
  const viewKey = (V) => (V ? `${fmt(V.x)},${fmt(V.y)},${fmt(V.w)}` : '-');
  const toScreen = (V, box) => (x, y) => { const R = viewRect(V, box[3] / box[2]), s = box[2] / R.w; return [box[0] + box[2] / 2 + (x - R.x) * s, box[1] + box[3] / 2 + (y - R.y) * s]; };

  // The bed at shot time t, as an image op over box (default the 1080 frame).
  function bed(t, { view = null, tint = null, box = [0, 0, 1080, 1080] } = {}) {
    const src = `sim:${name}?K=${stepOf(t)}&v=${viewKey(view)}&t=${tint ? tint.map(fmt).join(',') : '-'}`;
    return image(src, box[0], box[1], box[2], box[3], { name: `sand:${name}`, backdrop: true });
  }
  // What flies over the bed (G.fly), as fills.
  bed.air = (t, { view = null, box = [0, 0, 1080, 1080] } = {}) => {
    const kids = [], sc = box[2] / viewRect(view, box[3] / box[2]).w, to = toScreen(view, box);
    for (const g of flyers) {
      if (t < g.t0 || t > g.t1) continue;
      const u = g.ease(clamp((t - g.t0) / (g.t1 - g.t0), 0, 1)), q = pointAt(g.path, u * g.path.len), r0 = rng(g.seed * 13 + 1), wob = g.wob ? Math.sin(u * 22 + g.seed) * g.wob : 0;
      const [sx, sy] = to(q[0] - q[3] * wob, q[1] + q[2] * wob), rr = Math.max(0.7, g.r * sc), role = g.light ? air.light : air.dark, al = g.light ? 0.9 : 0.85;
      kids.push(fill(circle(sx, sy, rr, 12), role, { alpha: al }));
      let a2 = al;
      for (let n = 0; n < 2; n++) { const a = r0() * TAU, d = rr * (1.4 + r0() * 1.8); a2 *= 0.6; kids.push(fill(circle(sx + Math.cos(a) * d, sy + Math.sin(a) * d, rr * 0.5, 8), role, { alpha: a2 })); }
    }
    return kids.length ? group('air', kids) : null;
  };
  // The hand's shadow: two image ops multiplied over whatever is under them (null when it is out of shot).
  bed.hand = (t, { view = null, box = [0, 0, 1080, 1080] } = {}) => {
    if (!hand) return null;
    const st = handState(t, view, box[3] / box[2]);
    if (!st || st.a <= 0.01) return null;
    const sc = box[2] / viewRect(view, box[3] / box[2]).w, [x, y] = toScreen(view, box)(st.p[0], st.p[1]);
    const src = `sim-hand:${name}?x=${fmt(x - box[0])}&y=${fmt(y - box[1])}&l=${fmt(st.lift)}&k=${st.kind}&s=${fmt(sc)}&W=${fmt(box[2])}&H=${fmt(box[3])}`;
    const a = (0.46 - st.lift * 0.2) * st.a, o = { blend: 'multiply' };
    return group({ name: 'hand', cache: 'never' }, [
      image(src, box[0], box[1], box[2], box[3], { ...o, alpha: a }),
      image(src, box[0] + (10 + st.lift * 30) * sc, box[1] + (14 + st.lift * 40) * sc, box[2], box[3], { ...o, alpha: a * 0.55 }),
    ]);
  };
  // Everything: bed, air, hand. `over` (a list) goes between the air and the hand, the way a card laid on
  // the glass sits under the hand that lays it.
  bed.frame = (t, o = {}) => [bed(t, o), bed.air(t, o), o.over ?? null, bed.hand(t, o)];
  // Every gesture hisses for as long as it lasts: quiet for a fingertip, broad and low for a palm, thin for a pour.
  bed.hiss = ({ gain = 1, seed = 5 } = {}) => all.filter((g) => g.tool !== 'none').map((g) => ({
    t: g.t0, dur: Math.max(g.t1 - g.t0, 0.06), type: 'hiss', seed,
    hz: g.tool === 'wipe' ? (g.r > 40 ? 1800 : 3600) : 5200,
    gain: gain * (g.tool === 'wipe' ? (g.r > 40 ? 0.22 : 0.12) : g.tool === 'pour' ? 0.07 : 0.05),
  }));
  bed.stateAt = (K) => stateAt(K);
  bed.stepOf = stepOf;
  bed.gestures = all;
  bed.end = all.reduce((m, g) => Math.max(m, g.t1), 0);
  bed.pixels = pixels;
  bed.handPixels = handPixels;
  bed.N = N; bed.world = world; bed.dt = dt; bed.perCheckpoint = perCheckpoint; bed.checkpoints = checkpoints;
  SIMS.set(name, bed);
  return bed;
}

const params = (src) => Object.fromEntries(new URLSearchParams(src.slice(src.indexOf('?') + 1)));
const simOf = (src) => {
  const name = src.slice(src.indexOf(':') + 1, src.indexOf('?'));
  const b = SIMS.get(name);
  if (!b) throw new Error(`sim '${name}' is not defined (the film module defines it with sim('${name}', ...))`);
  return b;
};
const nums = (s) => (s === '-' ? null : s.split(',').map(Number));

registerSource('sim', (src, { w, h, makeCanvas }) => {
  const b = simOf(src), q = params(src), v = nums(q.v);
  return b.pixels(+q.K, w, h, v && { x: v[0], y: v[1], w: v[2] }, nums(q.t), makeCanvas);
});
registerSource('sim-hand', (src, { makeCanvas }) => {
  const q = params(src);
  return simOf(src).handPixels({ x: +q.x, y: +q.y, lift: +q.l, kind: q.k, sc: +q.s, W: +q.W, H: +q.H }, makeCanvas);
});
