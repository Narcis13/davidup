// Marks, lattices and motifs from v1 core.js, as functions returning ops (or lists). Recipes and films
// place them; the look colours them through roles. Randomness comes from the `seed` argument, so a mark
// only changes when its arguments do. Also the camera: cam() and whip() are list-level.
import { circle, clip, ellipse, fill, group, line, mkPath, poly, rect, roundRect, stroke, translate, mmul, rotate, scale, xf } from './list.js';
import { grain } from './finish.js';
import { rng } from './rand.js';

const TAU = Math.PI * 2;

// ---------- small geometry ----------

// A plus sign as a path of two subs (v1 cross).
export const cross = (x, y, s) => mkPath([{ pts: [x - s, y, x + s, y], closed: false }, { pts: [x, y - s, x, y + s], closed: false }]);

// A hexagon with pointy top (v1 hexPath).
export function hex(x, y, s) {
  const pts = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; pts.push(x + s * Math.cos(a), y + s * Math.sin(a)); }
  return poly(pts, true);
}

// Hex cell centres covering box [x, y, w, h] (v1 hexCells).
export function hexCells(box, s) {
  const w = Math.sqrt(3) * s, h = 1.5 * s, [bx, by, bw, bh] = box, out = [];
  let row = 0;
  for (let y = by - s; y < by + bh + s; y += h, row++) {
    const o = row % 2 ? w / 2 : 0;
    for (let x = bx - w + o; x < bx + bw + w; x += w) out.push([x, y]);
  }
  return out;
}

// ---------- lattices and particles ----------

// Hex outlines over box, one stroke op.
export const hexLattice = (box, s, role = 'chalkDim', { alpha = 1, w = 0.8 } = {}) =>
  stroke(mkPath(hexCells(box, s).flatMap(([x, y]) => hex(x, y, s).sub)), role, { w, wobble: 0, alpha, name: 'hexLattice' });

// A nucleus or spark with rays; g scales ray length (animate 0..1 to ignite) (v1 aster).
export function aster(x, y, r, n, role, seed, g = 1, { core = 'night', rim = 'chalk', hi = 'light' } = {}) {
  const q = rng(seed), rays = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + (q() - 0.5) * 0.3, r0 = r * 1.6, r1 = r * (2.6 + q() * 1.6) * g;
    rays.push({ pts: [x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1], closed: false });
  }
  return group({ name: 'aster', seed }, [
    g > 0 && stroke(mkPath(rays), role, { w: 1.4, wobble: 0, alpha: 0.9, name: 'rays' }),
    fill(circle(x, y, r, 24), core, { name: 'core' }),
    stroke(circle(x, y, r, 24), rim, { w: 1.6, wobble: 0, name: 'rim' }),
    fill(circle(x + r * 0.2, y - r * 0.2, r * 0.35, 12), hi, { name: 'hi' }),
  ]);
}

// Fireworks of dots on rays (v1 dotBurst). Dots fade outward in three alpha steps.
export function dotBurst(x, y, R, rays, role, seed, g = 1) {
  const q = rng(seed), buckets = [[], [], []];
  for (let k = 0; k < rays; k++) {
    const a = k / rays * TAU + (q() - 0.5) * 0.2, n = 6 + (q() * 6 | 0);
    for (let j = 1; j <= n; j++) {
      const d = R * g * j / n * (0.9 + q() * 0.2), rad = 1.2 + q() * 1.4;
      buckets[Math.min(2, Math.floor(j / n * 3))].push(...circle(x + Math.cos(a) * d, y + Math.sin(a) * d, rad, 8).sub);
    }
  }
  return group({ name: 'dotBurst', seed }, buckets.map((sub, b) => sub.length && fill(mkPath(sub), role, { alpha: 0.85 - b * 0.25, name: `d${b}` })));
}

// Motion lines behind a moving thing heading `dir` (v1 speedLines).
export function speedLines(x, y, dir, seed, { n = 7, alpha = 0.6, role = 'ink' } = {}) {
  const q = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const side = (q() - 0.5) * 70, back = 30 + q() * 40, L = 60 + q() * 120, px = -Math.sin(dir), py = Math.cos(dir);
    const x0 = x - Math.cos(dir) * back + px * side, y0 = y - Math.sin(dir) * back + py * side;
    out.push(stroke(line(x0, y0, x0 - Math.cos(dir) * L, y0 - Math.sin(dir) * L), role, { w: 0.8 + q() * 1.8, wobble: 0, alpha, name: `s${i}` }));
  }
  return group({ name: 'speedLines', seed }, out);
}

// Looping accent trails behind a flier (v1 loops).
export function loops(x, y, dir, seed, { alpha = 0.6, roles = ['accents.0', 'accents.1', 'accents.2', 'accents.3'] } = {}) {
  const q = rng(seed), m = mmul(translate(x, y), rotate(dir));
  return group({ name: 'loops', xf: m, seed }, roles.map((role, k) => {
    const A = 14 + q() * 16, w = 0.12 + q() * 0.1, ph = q() * TAU, pts = [];
    for (let u = 0; u <= 220; u += 4) pts.push(-u - Math.cos(u * w * 1.7 + ph) * 8, Math.sin(u * w + ph) * A + (k - 2) * 6);
    return stroke(poly(pts, false), role, { w: 1.2, wobble: 0, alpha, name: `l${k}` });
  }));
}

// Thin guide lines with ticks, a circle and a few crosses around (cx, cy) (v1 construction).
export function construction(cx, cy, R, seed, { role = 'guide', alpha = 1 } = {}) {
  if (alpha <= 0) return null;
  const q = rng(seed), sub = [];
  for (let i = 0; i < 3; i++) {
    const a = q() * Math.PI, L = R * (1.3 + q() * 1.2);
    sub.push({ pts: [cx - Math.cos(a) * L, cy - Math.sin(a) * L, cx + Math.cos(a) * L, cy + Math.sin(a) * L], closed: false });
    for (let k = -3; k <= 3; k++) {
      const u = k * L / 4, x = cx + Math.cos(a) * u, y = cy + Math.sin(a) * u;
      sub.push({ pts: [x - Math.sin(a) * 5, y + Math.cos(a) * 5, x + Math.sin(a) * 5, y - Math.cos(a) * 5], closed: false });
    }
  }
  sub.push(...circle(cx, cy, R * 1.12, 64).sub);
  for (let i = 0; i < 5; i++) sub.push(...cross(cx + (q() - 0.5) * R * 3, cy + (q() - 0.5) * R * 3, 6).sub);
  return stroke(mkPath(sub), role, { w: 0.9, wobble: 0, alpha, name: 'construction' });
}

// ---------- motifs ----------

// The anchor dot of the flipbook, two inks slightly off (v1 seedDot).
export const seedDot = (x, y, r = 9, { ink = 'ink', ink2 = 'accents.0' } = {}) => group('seedDot', [
  ink2 && fill(circle(x + r * 0.3, y + r * 0.2, r, 24), ink2, { alpha: 0.8, name: 'b' }),
  fill(circle(x, y, r, 24), ink, { name: 'a' }),
]);

// Concentric crayon rings at the given radii (animate them outward; drop the ones past the frame).
export const ripples = (cx, cy, radii, role, seed, w = 4) => group({ name: 'ripples', seed },
  radii.map((r, i) => r > 0 && stroke(circle(cx, cy, r, Math.max(40, Math.round(r / 6))), role, { tool: 'crayon', w, seed: seed + i, name: `r${i}` })));

// A dashed wobbly ring (v1 dashedRing).
export const dashedRing = (cx, cy, r, role, seed, { dash = [14, 10], w = 1.5 } = {}) =>
  stroke(circle(cx, cy, r, 90), role, { w, wobble: 1.5, dash, seed, name: 'dashedRing' });

// Dots along a circle, a few missing (v1 dottedArc).
export function dottedArc(cx, cy, r, role, seed, { step = 9, size = 1.1 } = {}) {
  const q = rng(seed), n = Math.round(TAU * r / step), sub = [];
  for (let k = 0; k < n; k++) { if (q() < 0.12) continue; const a = k / n * TAU; sub.push(...circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, 6).sub); }
  return fill(mkPath(sub), role, { name: 'dottedArc' });
}

// A pressed-flower drawing: recursive branches, leaf clusters at the tips, the odd flower (v1 plant).
export function plant(x, y, len, depth, seed, { stem = 'ink', leaf = 'accents.0', flower = 'accents.1', angle = -Math.PI / 2, w = 1.3 } = {}) {
  const q = rng(seed), stems = [], leaves = [], petals = [];
  (function branch(x, y, len, a, d, w) {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    stems.push(stroke(poly([x, y, (x + x2) / 2 + (q() - 0.5) * len * 0.2, (y + y2) / 2 + (q() - 0.5) * len * 0.2, x2, y2], false), stem, { w, wobble: 1, name: `b${stems.length}` }));
    if (d <= 0) {
      for (let k = 0; k < 5; k++) {
        const la = a + (q() - 0.5) * 2.2, cx = x2 + Math.cos(la) * 6, cy = y2 + Math.sin(la) * 6;
        leaves.push(...xf(ellipse(0, 0, 7, 3, 12), mmul(translate(cx, cy), rotate(la))).sub);
      }
      if (q() < 0.4) for (let k = 0; k < 6; k++) { const fa = k / 6 * TAU; petals.push({ pts: [x2, y2, x2 + Math.cos(fa) * 8, y2 + Math.sin(fa) * 8], closed: false }); }
      return;
    }
    const n = 2 + (q() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) branch(x2, y2, len * (0.55 + q() * 0.25), a + (q() - 0.5) * 1.4, d - 1, w * 0.75);
  })(x, y, len, angle, depth, w);
  return group({ name: 'plant', seed }, [
    ...stems,
    leaves.length && fill(mkPath(leaves), leaf, { alpha: 0.7, name: 'leaves' }),
    petals.length && stroke(mkPath(petals), flower, { w: 0.9, wobble: 0, name: 'flowers' }),
  ]);
}

// The frame below a torn paper line at height y (v1 tornEdge).
export function tornEdge(y, { amp = 9, seed = 1, freq = 60, W = 1080, H = 1080 } = {}) {
  const q = rng(seed), pts = [-10, H + 10, -10, y];
  for (let x = -10; x <= W + 10; x += freq / 5) pts.push(x, y + (q() - 0.5) * amp * 2 + Math.sin(x / freq) * amp * 0.6);
  pts.push(W + 10, H + 10);
  return poly(pts, true);
}

// A new paper colour from a torn edge downward, a soft shadow under the tear, grain (v1 section).
export function section(y, role, seed = 1, { W = 1080, H = 1080 } = {}) {
  const p = tornEdge(y, { seed, W, H });
  return group({ name: 'section', seed }, [
    group({ name: 'shadow', xf: translate(0, 3) }, [fill(p, { base: 'ink', alpha: 0.1 })]),
    fill(p, role, { name: 'sheet' }),
    clip(p, [grain([0, y, W, Math.max(1, H - y)], 600, { base: role, shade: 0.5 }, 0.06, seed + 1, 1.6)]),
  ]);
}

// A paper square with a drawing inside, turned a little (v1 stickyNote). kids draw in note units 0..s.
export function stickyNote(x, y, s, seed, kids = []) {
  const rot = (rng(seed)() - 0.5) * 0.12;
  return group({ name: 'stickyNote', xf: mmul(translate(x, y), rotate(rot)), cache: 'never', seed }, [
    fill(rect(4, 5, s, s), { base: 'ink', alpha: 0.08 }, { name: 'shadow' }),
    fill(rect(0, 0, s, s), { base: 'paper', tint: 0.5 }, { name: 'sheet' }),
    stroke(rect(0.5, 0.5, s - 1, s - 1), { base: 'ink', alpha: 0.25 }, { w: 1, wobble: 0, name: 'edge' }),
    ...[kids].flat(),
  ]);
}

// A speech bubble: a wobbly rounded rect over box [x, y, w, h] with a tail out to the point tail ([x, y], or
// null for none), filled paper and outlined in pen. The tail leaves the side nearest the point, a base
// `base` wide; the wobble comes from seed, so a bubble only changes when its arguments do.
export function bubble(box, tail, { seed = 1, role = 'ink', paper = 'paper', w = 3, wobble = 2.5, base } = {}) {
  const [x, y, bw, bh] = box, r = rng(seed), cx = x + bw / 2, cy = y + bh / 2;
  const ring = roundRect(x, y, bw, bh, Math.min(bw, bh) * 0.42, 5).sub[0].pts, pts = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([ring[i] + (r() - 0.5) * wobble * 2, ring[i + 1] + (r() - 0.5) * wobble * 2]);
  let outline = pts;
  if (tail) {
    // The rim point facing the tip, and the points either side within half the base: they give way to it.
    const half = (base ?? Math.min(bw, bh) * 0.36) / 2, dx = tail[0] - cx, dy = tail[1] - cy;
    let best = 0, score = -Infinity;
    pts.forEach(([px, py], k) => { const v = (px - cx) * dx + (py - cy) * dy; if (v / Math.hypot(px - cx, py - cy) > score) { score = v / Math.hypot(px - cx, py - cy); best = k; } });
    const n = pts.length, near = (k) => Math.hypot(pts[k][0] - pts[best][0], pts[k][1] - pts[best][1]) <= half;
    let a = best, b = best;
    while (near((a - 1 + n) % n) && (a - 1 + n) % n !== b) a = (a - 1 + n) % n;
    while (near((b + 1) % n) && (b + 1) % n !== a) b = (b + 1) % n;
    outline = [];
    for (let k = (b + 1) % n, c = 0; c < n; k = (k + 1) % n, c++) {
      if (k === a) { outline.push(pts[a], tail, pts[b]); break; }
      outline.push(pts[k]);
    }
  }
  const path = poly(outline, true);
  return group({ name: 'bubble', seed }, [
    fill(path, paper, { name: 'sheet' }),
    stroke(path, role, { w, wobble: w * 0.3, name: 'edge' }),
  ]);
}

// A thin line wandering down the frame (v1 thread).
export function thread(x, seed, { role = 'accents.0', w = 1.2, H = 1080 } = {}) {
  const q = rng(seed), pts = [];
  let px = x;
  for (let y = -10; y <= H + 10; y += 24) { px += (q() - 0.5) * 26; pts.push(px, y); }
  return stroke(poly(pts, false), role, { w, wobble: 0, alpha: 0.8, name: 'thread' });
}

// ---------- camera ----------

// A camera over kids: the point (x, y) lands at the frame centre, zoomed and turned (v1 cam). A zooming or
// turning camera draws direct; a pure pan stays cacheable.
export function cam({ x, y, zoom = 1, rot = 0, W = 1080, H = 1080 }, kids) {
  let m = translate(W / 2, H / 2);
  if (zoom !== 1) m = mmul(m, scale(zoom));
  if (rot) m = mmul(m, rotate(rot));
  m = mmul(m, translate(-(x ?? W / 2), -(y ?? H / 2)));
  const o = { name: 'cam', xf: m };
  if (zoom !== 1 || rot) o.cache = 'never';
  return group(o, kids);
}

// A horizontal camera offset for motion-matched cuts: leaves right over the last `out` seconds, arrives
// from the left over the first `inn` (v1 whip). Add it to a cam's x.
export function whip(t, dur, { inn = 0.17, out = 0.17, dist = 520 } = {}) {
  if (t < inn) return -dist * Math.pow(1 - t / inn, 2);
  if (t > dur - out) return dist * Math.pow((t - (dur - out)) / out, 2);
  return 0;
}
