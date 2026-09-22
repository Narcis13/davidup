// Marks, lattices and motifs from v1 core.js, as functions returning ops (or lists). Recipes and films
// place them; the look colours them through roles. Randomness comes from the `seed` argument, so a mark
// only changes when its arguments do. Also the teacher's pen (4.0 T7: underline, circleAround, arrowTo, ...)
// and the camera: cam() and whip() are list-level.
import { bounds, circle, clip, ellipse, fill, group, line, mkPath, poly, rect, roundRect, stroke, translate, mmul, rotate, scale, withProps, xf } from './list.js';
import { grain, RULED } from './finish.js';
import { currentHand, glyph, houseHand } from './glyphs.js';
import { hash32, rng } from './rand.js';
import { splinePts } from './spline.js';
import { textBox } from './text.js';
import { reveal } from './tools.js';

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

// ---------- the notebook's margin (4.0 L4) ----------

// The strip of a notebook page left of its red margin line, [x, y, w, h] for a W x H frame: where doodles go.
export const margin = (W = 1080, H = 1080) => [0, 0, RULED.margin * (Math.min(W, H) / 1080), H];

// A ring a mug left, r its radius: a broken dark rim where the coffee dried, a faint stain inside, and a
// fainter second rim a little off where the mug was set down again. role: the coffee (by default the look's
// orange fill (fills.4) mixed halfway to its shade, a brown in most looks).
export function coffeeRing(x, y, r, seed, { role = { base: 'fills.4', mix: ['shade', 0.5] }, alpha = 1, twice = true } = {}) {
  const q = rng(seed), rim = (cx, cy, rr, a, w, k) => {
    const sub = [], n = 4 + Math.floor(q() * 3), gap = 0.25 + 0.3 * q();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU + q() * 0.4, a1 = a0 + ((TAU / n) * (1 - gap * q())), pts = [];
      for (let j = 0; j <= 12; j++) { const t = a0 + ((a1 - a0) * j) / 12, rj = rr * (1 + (q() - 0.5) * 0.03); pts.push(cx + Math.cos(t) * rj, cy + Math.sin(t) * rj); }
      sub.push({ pts, closed: false });
    }
    return stroke(mkPath(sub), role, { tool: 'pencil', w, wobble: 0.6, alpha: alpha * a, seed: seed + k, name: 'rim' });
  };
  const dx = (q() - 0.5) * r * 0.5, dy = (q() - 0.5) * r * 0.5;
  return group({ name: 'coffeeRing', seed }, [
    fill(ellipse(x, y, r, r, 60), role, { alpha: alpha * 0.07, name: 'stain' }),
    fill(ellipse(x + r * 0.2, y + r * 0.25, r * 0.35, r * 0.28, 24), role, { alpha: alpha * 0.06, name: 'pool' }),
    rim(x, y, r, 0.55, Math.max(1.5, r * 0.05), 1),
    rim(x, y, r * 0.965, 0.3, Math.max(1, r * 0.02), 2),
    twice && rim(x + dx, y + dy, r * 1.01, 0.22, Math.max(1, r * 0.03), 3),
  ]);
}

// A wire paper clip len long lying along angle a from (x, y), its big loop at the far end: the wire in the
// look's metal (chalkDim), a highlight along it and its shadow on the page.
export function paperClip(x, y, len, a = 0, seed = 1, { role = 'chalkDim', w } = {}) {
  const L = len, r1 = 0.07 * L, r2 = 0.12 * L, r3 = 0.145 * L, y2 = 2 * r2 - r1, c3 = (y2 - 0.12 * L) / 2, off = (y2 - 0.12 * L) / 2;
  const arc = (cx, cy, r, a0, a1) => Array.from({ length: 13 }, (_, j) => { const t = a0 + ((a1 - a0) * j) / 12; return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]; });
  const cR1 = 0.86 * L - r1, cL = r2, cR3 = L - r3, pts = [
    [0.3 * L, r1], [cR1, r1], ...arc(cR1, 0, r1, Math.PI / 2, -Math.PI / 2),
    [cL, -r1], ...arc(cL, r2 - r1, r2, -Math.PI / 2, -Math.PI * 1.5),
    [cR3, y2], ...arc(cR3, c3, r3, Math.PI / 2, -Math.PI / 2), [0.16 * L, c3 - r3],
  ].map(([px, py]) => [px, py - off]);
  const ww = w ?? Math.max(1.2, L * 0.03), m = mmul(translate(x, y), rotate(a)), path = xf(mkPath([{ pts: pts.flat(), closed: false }]), m);
  return group({ name: 'paperClip', seed }, [
    group({ name: 'shadow', xf: translate(ww * 0.8, ww * 1.2) }, [stroke(path, { base: 'ink', alpha: 0.18 }, { tool: 'pencil', w: ww * 1.2, wobble: 0, seed, name: 'wire-shadow' })]),
    stroke(path, role, { tool: 'pencil', w: ww, wobble: 0, seed, name: 'wire' }),
    group({ xf: translate(-ww * 0.2, -ww * 0.25) }, [stroke(path, 'light', { tool: 'pencil', w: ww * 0.35, wobble: 0, alpha: 0.7, seed, name: 'glint' })]),
  ]);
}

// The doodles marginDoodle() draws: what a pupil draws in the margin when the lesson is slow.
export const MARGIN_DOODLES = Object.freeze(['spiral', 'star', 'cube', 'heart', 'flower', 'zigzag']);

// marginDoodle(kind, x, y, s, seed, { role, w }) => a small pen doodle about s across, centred on (x, y), in the look's
// pen (the notebook's felt tip), so it wobbles as the page's lettering does. kind is one of MARGIN_DOODLES.
export function marginDoodle(kind, x, y, s, seed = 1, { role = 'ink', w } = {}) {
  const q = rng(seed), h = s / 2, pw = w ?? Math.max(1.4, s * 0.035), subs = [];
  const put = (pts, closed = false) => subs.push({ pts: pts.flat(), closed });
  switch (kind) {
    case 'spiral': {
      const pts = [], turns = 3 + q();
      for (let j = 0; j <= 80; j++) { const t = (j / 80) * turns * TAU, r = (h * j) / 80; pts.push([x + Math.cos(t) * r, y + Math.sin(t) * r]); }
      put(pts); break;
    }
    case 'star': {
      const pts = [];
      for (let j = 0; j < 5; j++) { const t = -Math.PI / 2 + (j * 2 * TAU) / 5; pts.push([x + Math.cos(t) * h, y + Math.sin(t) * h]); }
      put(pts, true); break;
    }
    case 'cube': {
      const a = h * 0.62, d = h * 0.38, sq = (ox, oy) => [[ox - a, oy - a], [ox + a, oy - a], [ox + a, oy + a], [ox - a, oy + a]];
      const f = sq(x - d / 2, y + d / 2), b = sq(x + d / 2, y - d / 2);
      put(f, true); put(b, true);
      for (let j = 0; j < 4; j++) put([f[j], b[j]]);
      break;
    }
    case 'heart': {
      const pts = [];
      for (let j = 0; j <= 40; j++) {
        const t = (j / 40) * TAU, hx = 16 * Math.sin(t) ** 3, hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([x + (hx / 17) * h, y - (hy / 17) * h - h * 0.1]);
      }
      put(pts, true); break;
    }
    case 'flower': {
      const r = h * 0.22;
      subs.push({ pts: ellipse(x, y, r, r, 16).sub[0].pts, closed: true });
      for (let j = 0; j < 6; j++) {
        const t = (j / 6) * TAU + q() * 0.2, cx = x + Math.cos(t) * h * 0.6, cy = y + Math.sin(t) * h * 0.6, pts = [];
        for (let k = 0; k <= 16; k++) { const u = (k / 16) * TAU; pts.push([cx + Math.cos(t) * Math.cos(u) * h * 0.38 - Math.sin(t) * Math.sin(u) * h * 0.2, cy + Math.sin(t) * Math.cos(u) * h * 0.38 + Math.cos(t) * Math.sin(u) * h * 0.2]); }
        put(pts, true);
      }
      break;
    }
    case 'zigzag': {
      const pts = [];
      for (let j = 0; j <= 8; j++) pts.push([x - h + (s * j) / 8, y + (j % 2 ? -h : h) * 0.45]);
      put(pts); break;
    }
    default: throw new Error(`marginDoodle: unknown kind '${kind}' (expected ${MARGIN_DOODLES.join(', ')})`);
  }
  return stroke(mkPath(subs), role, { w: pw, seed, name: `doodle:${kind}` });
}

// The ring pts ([x, y] pairs round a centre) giving way to a tail out to the point tail: the rim point facing
// it and the points either side within half the base leave (at least its two neighbours), and the outline
// runs through the tip instead.
function withTail(pts, tail, half, cx, cy) {
  const dx = tail[0] - cx, dy = tail[1] - cy;
  let best = 0, score = -Infinity;
  pts.forEach(([px, py], k) => { const v = (px - cx) * dx + (py - cy) * dy; if (v / Math.hypot(px - cx, py - cy) > score) { score = v / Math.hypot(px - cx, py - cy); best = k; } });
  const n = pts.length, near = (k) => Math.hypot(pts[k][0] - pts[best][0], pts[k][1] - pts[best][1]) <= half;
  let a = best, b = best;
  while (near((a - 1 + n) % n) && (a - 1 + n) % n !== b) a = (a - 1 + n) % n;
  while (near((b + 1) % n) && (b + 1) % n !== a) b = (b + 1) % n;
  if (a === b) { a = (best - 1 + n) % n; b = (best + 1) % n; }   // nothing within half: the neighbours are the base
  const outline = [];
  for (let k = (b + 1) % n, c = 0; c < n; k = (k + 1) % n, c++) {
    if (k === a) { outline.push(pts[a], tail, pts[b]); break; }
    outline.push(pts[k]);
  }
  return outline;
}

// The rim of the ellipse (cx, cy, rx, ry) facing the point (x, y): where the line from the centre crosses it.
const rimToward = (cx, cy, rx, ry, [x, y]) => {
  const a = Math.atan2((y - cy) / ry, (x - cx) / rx);
  return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
};

// The bubbles bubble() draws: speech, thought (a cloud and puffs), shout (spikes), whisper (dashed), caption (a strip).
export const BUBBLE_KINDS = Object.freeze(['speech', 'thought', 'shout', 'whisper', 'caption']);

// A bubble round box [x, y, w, h] (the copy's box and its margin) with a tail out to the point tail ([x, y],
// or null for none), filled paper and outlined in pen; the wobble comes from seed, so a bubble only changes
// when its arguments do. kind:
//   speech   a wobbly rounded rect, the tail leaving the side nearest the point, a base `base` wide
//   whisper  the same outline dashed
//   shout    a spiky burst round the box, one spike running out to the point
//   thought  a cloud of lobes round the box, the tail three shrinking puffs towards the point
//   caption  a plain strip over the box: no tail, a thin edge (a narrator's line)
export function bubble(box, tail, { kind = 'speech', seed = 1, role = 'ink', paper = 'paper', w = 3, wobble = 2.5, base } = {}) {
  if (!BUBBLE_KINDS.includes(kind)) throw new TypeError(`bubble: kind '${kind}' (${BUBBLE_KINDS.join(', ')})`);
  const [x, y, bw, bh] = box, r = rng(seed), cx = x + bw / 2, cy = y + bh / 2;
  const half = (base ?? Math.min(bw, bh) * 0.36) / 2;
  if (kind === 'caption') {
    const path = poly([[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]].map(([px, py]) => [px + (r() - 0.5) * wobble, py + (r() - 0.5) * wobble]), true);
    return group({ name: 'bubble', seed }, [
      fill(path, paper, { name: 'sheet' }),
      stroke(path, role, { w: w * 0.6, wobble: w * 0.2, name: 'edge' }),
    ]);
  }
  if (kind === 'shout') {
    // Spikes round an ellipse that holds the box: valleys on it, points out past it, every other one longer.
    const rx = bw / 2 * 1.16, ry = bh / 2 * 1.3, n = Math.max(12, 2 * Math.round(Math.PI * (rx + ry) / Math.max(24, Math.min(bw, bh) * 0.55) / 2));
    const out = Math.min(bw, bh) * 0.32, pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) / n * TAU - Math.PI / 2, spike = k % 2 === 0, e = spike ? out * (0.75 + r() * 0.5) * (k % 4 === 0 ? 1.25 : 1) : out * 0.05 * r();
      pts.push([cx + Math.cos(a) * (rx + e * Math.abs(Math.cos(a)) + e * 0.4), cy + Math.sin(a) * (ry + e * Math.abs(Math.sin(a)) + e * 0.4)]);
    }
    const path = poly(tail ? withTail(pts, tail, Math.min(bw, bh) * 0.2, cx, cy) : pts, true);
    return group({ name: 'bubble', seed }, [
      fill(path, paper, { name: 'sheet' }),
      stroke(path, role, { w: w * 1.2, wobble: w * 0.2, name: 'edge' }),
    ]);
  }
  if (kind === 'thought') {
    // Lobes: arcs bulging out from points on an ellipse round the box, each a little different.
    const rx = bw / 2 * 1.12, ry = bh / 2 * 1.22, n = Math.max(7, Math.round(Math.PI * (rx + ry) / Math.max(30, Math.min(bw, bh) * 0.62)));
    const at = Array.from({ length: n }, (_, k) => (k + (r() - 0.5) * 0.3) / n * TAU);
    const pts = [];
    at.forEach((a0, k) => {
      const a1 = at[(k + 1) % n] + (k === n - 1 ? TAU : 0), p0 = [cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry], p1 = [cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry];
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, c = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), bulge = c * (0.32 + r() * 0.12);
      const nx = (mx - cx) / (Math.hypot(mx - cx, my - cy) || 1), ny = (my - cy) / (Math.hypot(mx - cx, my - cy) || 1);
      for (let j = 0; j < 8; j++) {
        const u = j / 8, s = Math.sin(u * Math.PI);
        pts.push([p0[0] + (p1[0] - p0[0]) * u + nx * bulge * s, p0[1] + (p1[1] - p0[1]) * u + ny * bulge * s]);
      }
    });
    const path = poly(pts, true), kids = [fill(path, paper, { name: 'sheet' }), stroke(path, role, { w, wobble: w * 0.3, name: 'edge' })];
    if (tail) {
      // Three puffs from past the rim to the point, each smaller.
      const [ex, ey] = rimToward(cx, cy, rx * 1.18, ry * 1.18, tail), R = Math.min(bw, bh) * 0.13, puffs = [];
      for (let j = 0; j < 3; j++) {
        const u = (j + 0.6) / 3.2, pr = R * (1 - j * 0.28);
        puffs.push(ellipse(ex + (tail[0] - ex) * u, ey + (tail[1] - ey) * u, pr, pr * 0.8, 16));
      }
      const dots = mkPath(puffs.flatMap((p) => p.sub));
      kids.push(fill(dots, paper, { name: 'puffs' }), stroke(dots, role, { w: w * 0.8, wobble: 0, name: 'puffEdge' }));
    }
    return group({ name: 'bubble', seed }, kids);
  }
  const ring = roundRect(x, y, bw, bh, Math.min(bw, bh) * 0.42, 5).sub[0].pts, pts = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([ring[i] + (r() - 0.5) * wobble * 2, ring[i + 1] + (r() - 0.5) * wobble * 2]);
  const path = poly(tail ? withTail(pts, tail, half, cx, cy) : pts, true);
  return group({ name: 'bubble', seed }, [
    fill(path, paper, { name: 'sheet' }),
    stroke(path, role, kind === 'whisper' ? { w: w * 0.8, wobble: w * 0.3, dash: [w * 3, w * 2.4], name: 'edge' } : { w, wobble: w * 0.3, name: 'edge' }),
  ]);
}

// A thin line wandering down the frame (v1 thread).
export function thread(x, seed, { role = 'accents.0', w = 1.2, H = 1080 } = {}) {
  const q = rng(seed), pts = [];
  let px = x;
  for (let y = -10; y <= H + 10; y += 24) { px += (q() - 0.5) * 26; pts.push(px, y); }
  return stroke(poly(pts, false), role, { w, wobble: 0, alpha: 0.8, name: 'thread' });
}

// ---------- emphasis: the teacher's pen (4.0 T7) ----------

// The marks below, each a group named mark:<kind>. They are pen strokes (a highlight is a marker's band) in
// the look's pen and the shot's hand, so they overshoot and hook as its lettering does, and they are not
// words: lint counts only a callout's copy.
export const EMPHASIS = Object.freeze(['underline', 'circleAround', 'arrowTo', 'highlight', 'strike', 'bracket', 'starburst', 'callout', 'tickMark', 'crossMark', 'question']);

// A target's box [x, y, w, h]: a box, a group that knows its box (textBox, bullets, a callout), or any op or
// list (its bounds). A point [x, y] is a box with no size.
function boxOf(target, who) {
  if (Array.isArray(target) && target.length === 4 && target.every(Number.isFinite)) return target;
  if (Array.isArray(target) && target.length === 2 && target.every(Number.isFinite)) return [target[0], target[1], 0, 0];
  if (target && typeof target === 'object' && Array.isArray(target.box) && target.op === 'group') return target.box;
  const b = target && typeof target === 'object' ? bounds(target) : null;
  if (!b) throw new TypeError(`${who}: target must be a box [x, y, w, h], a point [x, y] or something drawn, got ${JSON.stringify(target)?.slice(0, 80)}`);
  return b;
}

// (p, o) or (o): the draw-on progress may come as a number or as o.p.
const progress = (p, o) => (typeof p === 'number' ? [p, o ?? {}] : [(p ?? {}).p ?? 1, p ?? {}]);

// The seed of a mark: its own, else its kind and name, so an unnamed mark wobbles the same wherever it goes
// and two marks of a kind differ only when named apart.
const seedOf = (kind, o) => o.seed ?? hash32('mark', kind, o.name ?? '');

// A pen width for a mark round something h tall.
const penFor = (h, o) => o.w ?? Math.min(8, Math.max(2, h * 0.06));

// A mark's group drawn on to p, props (tip, ...) set on it and its .box what it draws when done (so bounds and
// lint see the whole mark while it draws on). Its fills (a closed head, a leader's dot) come with its last
// stroke: until then they are left out.
function drawnOn(g, p, extra = {}) {
  const props = { ...extra, box: bounds(g.kids) };
  if (p >= 1) return withProps(g, props);
  const bare = withProps(g, { kids: g.kids.filter((k) => k.op !== 'fill') });
  return withProps(reveal(Math.max(0, p), bare), props);
}

// The mark's group, drawn on to p: its strokes come in `order` (o.order, 1e6 by default, so a mark on a card
// with lettering is drawn after the words), each after the last.
function markGroup(kind, o, seed, p, parts, props) {
  const base = o.order ?? 1e6;
  const kids = parts.filter(Boolean).map((op, k) => (op.op === 'stroke' && op.order === undefined ? withProps(op, { order: base + k }) : op));
  return drawnOn(group({ name: `mark:${kind}`, seed }, kids), p, props);
}

// A pen stroke of a mark: points [[x, y], ...] through a spline (tension 0.5) or straight (o.straight).
function penLine(pts, role, o, seed, name, extra = {}) {
  const path = o.straight ? poly(pts, false) : mkPath([{ pts: splinePts(pts, { n: 6 }), closed: false }]);
  const s = { w: o.w, seed, name, ...extra };
  if (o.wobble !== undefined) s.wobble = o.wobble;
  if (o.tool) s.tool = o.tool;
  return stroke(path, role, s);
}

// underline(target, p, { role, w, gap, wavy, double, seed, name, order }) => a line drawn left to right under
// the target's box, a little long at the end and lifting off as a quick hand's does; wavy: a squiggle; double:
// a second, shorter line under the first.
export function underline(target, p, o) {
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(target, 'underline'), seed = seedOf('underline', o), r = rng(seed), role = o.role ?? 'accents.0';
  const pen = penFor(h, o), gap = o.gap ?? Math.max(pen * 1.5, h * 0.1), y0 = y + h + gap, x0 = x - w * 0.02, x1 = x + w * 1.04;
  const one = (dy, from, to, k) => {
    const n = o.wavy ? Math.max(4, Math.round((to - from) / Math.max(12, h * 0.28))) * 2 : 4, pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, wave = o.wavy ? (i % 2 ? 1 : -1) * Math.max(3, h * 0.07) : 0;
      pts.push([from + (to - from) * u, y0 + dy + wave + (r() - 0.5) * h * 0.04 - u * u * h * 0.05]);
    }
    return penLine(pts, role, { ...o, w: pen }, hash32(seed, k), `underline${k || ''}`);
  };
  return markGroup('underline', o, seed, p, [one(0, x0, x1, 0), o.double && one(pen * 2.4, x + w * 0.06, x + w * 0.9, 1)]);
}

// circleAround(target, p, { role, w, pad, turns, seed, name, order }) => a loop drawn round the target's box
// (clearing its corners, pad beyond): an ellipse from the upper left, clockwise, a little over once round
// (turns, 1.12) so its end runs past its start, starting inside and ending outside, tilted a touch.
export function circleAround(target, p, o) {
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(target, 'circleAround'), seed = seedOf('circleAround', o), r = rng(seed), role = o.role ?? 'accents.0';
  const pad = o.pad ?? Math.max(6, Math.min(w, h) * 0.25), rx = w / 2 * 1.3 + pad, ry = h / 2 * 1.35 + pad, cx = x + w / 2, cy = y + h / 2;
  const turns = o.turns ?? 1.12, a0 = -Math.PI * 0.8 + (r() - 0.5) * 0.4, tilt = (r() - 0.5) * 0.12, n = 40, pts = [];
  const ph = r() * TAU, ca = Math.cos(tilt), sa = Math.sin(tilt);
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = a0 + u * turns * TAU, k = 0.95 + 0.09 * u + 0.025 * Math.sin(ph + u * TAU * 2);
    const ex = Math.cos(a) * rx * k, ey = Math.sin(a) * ry * k;
    pts.push([cx + ex * ca - ey * sa, cy + ex * sa + ey * ca]);
  }
  return markGroup('circleAround', o, seed, p, [penLine(pts, role, { ...o, w: penFor(h, o) }, hash32(seed, 0), 'loop')]);
}

// Where the line from box b's middle towards (tx, ty) leaves b grown by pad (b a point: the point).
function edgeToward(b, pad, tx, ty) {
  const [x, y, w, h] = b, cx = x + w / 2, cy = y + h / 2;
  if (!w && !h) return [cx, cy];
  const dx = tx - cx, dy = ty - cy, hw = w / 2 + pad, hh = h / 2 + pad;
  if (!dx && !dy) return [cx, cy];
  const k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

// The two barbs of an arrow head at (x, y) heading a, each len long.
const barbs = (x, y, a, L, spread = 0.45) => [
  [x - Math.cos(a - spread) * L, y - Math.sin(a - spread) * L], [x, y], [x - Math.cos(a + spread) * L, y - Math.sin(a + spread) * L],
];

// arrowTo(from, to, { curve, head: 'open' | 'closed' | 'none', size, gap, p, role, w, seed, name, order }) =>
// a shaft from `from` to `to` (points, or boxes: it leaves and arrives at their edges, `gap` off them), bowed
// by curve (a fraction of its length to the left of its run; 0.2, 0 straight, negative the other way), then
// its head: two barbs (open) or a triangle (closed), drawn after the shaft. .from and .to are its ends.
export function arrowTo(from, to, o = {}) {
  const p = o.p ?? 1, seed = seedOf('arrowTo', o), r = rng(seed), role = o.role ?? 'accents.0';
  const A = boxOf(from, 'arrowTo'), B = boxOf(to, 'arrowTo'), pen = o.w ?? 3, gap = o.gap ?? pen * 3;
  const ac = [A[0] + A[2] / 2, A[1] + A[3] / 2], bc = [B[0] + B[2] / 2, B[1] + B[3] / 2];
  const a = edgeToward(A, A[2] || A[3] ? gap : 0, ...bc), b = edgeToward(B, B[2] || B[3] ? gap : 0, ...ac);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L, bow = (o.curve ?? 0.2) * L;
  const mx = (a[0] + b[0]) / 2 + nx * bow, my = (a[1] + b[1]) / 2 + ny * bow, pts = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12, v = 1 - u, j = i && i < 12 ? (r() - 0.5) * pen * 0.3 : 0;
    pts.push([v * v * a[0] + 2 * u * v * mx + u * u * b[0] + j, v * v * a[1] + 2 * u * v * my + u * u * b[1] + j]);
  }
  const head = o.head ?? 'open', size = o.size ?? Math.max(pen * 5, Math.min(40, L * 0.14)), heading = Math.atan2(b[1] - pts[11][1], b[0] - pts[11][0]);
  const tip = barbs(b[0], b[1], heading, size);
  const parts = [penLine(pts, role, { ...o, w: pen }, hash32(seed, 0), 'shaft')];
  if (head === 'open') parts.push(penLine(tip, role, { ...o, w: pen, straight: true }, hash32(seed, 1), 'head'));
  else if (head === 'closed') parts.push(stroke(poly(tip, true), role, { w: pen, seed: hash32(seed, 1), name: 'head' }), fill(poly(tip, true), role, { name: 'headFill' }));
  else if (head !== 'none') throw new TypeError(`arrowTo: head '${head}' (open, closed, none)`);
  return markGroup('arrowTo', o, seed, p, parts, { from: a, to: b });
}

// highlight(target, p, { role, alpha, seed, name, order }) => a highlighter's band across the target's box,
// laid left to right in the marker tool and multiplied, so the copy shows through: draw it before the copy.
export function highlight(target, p, o) {
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(target, 'highlight'), seed = seedOf('highlight', o), r = rng(seed), band = o.w ?? h * 0.78;
  const yc = y + h * 0.56, tilt = (r() - 0.5) * h * 0.1, x0 = x - band * 0.15, x1 = x + w + band * 0.15;
  const pts = [[x0, yc + tilt], [x0 + (x1 - x0) * 0.5, yc + (r() - 0.5) * h * 0.05], [x1, yc - tilt]];
  const s = { tool: 'marker', w: band, wobble: o.wobble ?? 1, seed: hash32(seed, 0), blend: 'multiply', name: 'band' };
  if (o.alpha !== undefined) s.alpha = o.alpha;
  return markGroup('highlight', o, seed, p, [stroke(mkPath([{ pts: splinePts(pts, { n: 6 }), closed: false }]), o.role ?? 'accents.2', s)]);
}

// strike(target, p, { role, w, at, double, seed, name, order }) => a line struck through the target's box at
// `at` of its height (0.58: through lower case), running a little past both ends, tilted a touch.
export function strike(target, p, o) {
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(target, 'strike'), seed = seedOf('strike', o), r = rng(seed), role = o.role ?? 'accents.0', pen = penFor(h, o);
  const one = (dy, k) => {
    const yc = y + h * (o.at ?? 0.58) + dy, tilt = (r() - 0.3) * h * 0.12;
    return penLine([[x - w * 0.04, yc + tilt], [x + w * 0.5, yc + (r() - 0.5) * h * 0.04], [x + w * 1.04, yc - tilt]], role, { ...o, w: pen }, hash32(seed, k), `strike${k || ''}`);
  };
  return markGroup('strike', o, seed, p, [one(0, 0), o.double && one(pen * 2.6, 1)]);
}

const SIDES = ['left', 'right', 'top', 'bottom'];

// bracket(target, side, p, { kind: 'curly' | 'square' | 'round', pad, depth, role, w, seed, name, order }) =>
// a brace along one side of the target's box ('left' by default), its ends turned towards the box; .tip is
// its outermost middle point, where a label or an arrow leaves from.
export function bracket(target, side = 'left', p, o) {
  [p, o] = progress(p, o);
  if (!SIDES.includes(side)) throw new TypeError(`bracket: side '${side}' (${SIDES.join(', ')})`);
  const [x, y, w, h] = boxOf(target, 'bracket'), seed = seedOf('bracket', o), r = rng(seed), role = o.role ?? 'accents.0';
  const kind = o.kind ?? 'curly', vert = side === 'left' || side === 'right', L = vert ? h : w;
  const pad = o.pad ?? Math.max(6, L * 0.05), d = o.depth ?? Math.min(36, Math.max(10, L * 0.12));
  // In the brace's own frame: u along the side, v out from the box.
  const shapes = {
    curly: [[0, 0], [0.06, 0.42], [0.4, 0.5], [0.47, 0.6], [0.5, 1], [0.53, 0.6], [0.6, 0.5], [0.94, 0.42], [1, 0]],
    square: [[0, 0], [0, 1], [1, 1], [1, 0]],
    round: Array.from({ length: 9 }, (_, i) => [i / 8, Math.sin(i / 8 * Math.PI)]),
  };
  if (!shapes[kind]) throw new TypeError(`bracket: kind '${kind}' (${Object.keys(shapes).join(', ')})`);
  const place = ([u, v]) => {
    const U = u * L + (r() - 0.5) * 1.5, V = v * d + (r() - 0.5) * 1.5;
    return side === 'left' ? [x - pad - V, y + U] : side === 'right' ? [x + w + pad + V, y + U] : side === 'top' ? [x + U, y - pad - V] : [x + U, y + h + pad + V];
  };
  const pts = shapes[kind].map(place), tip = place([0.5, 1]);
  return markGroup('bracket', o, seed, p, [penLine(pts, role, { ...o, w: penFor(Math.min(L, 120), o), straight: kind === 'square' }, hash32(seed, 0), 'brace')], { tip });
}

// starburst(at, p, { n, r, len, role, w, seed, name, order }) => rays round a point (or out from round a box),
// long and short in turn, drawn one after another: the "look here!" of a comic.
export function starburst(at, p, o) {
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(at, 'starburst'), seed = seedOf('starburst', o), q = rng(seed), role = o.role ?? 'accents.0';
  const n = o.n ?? 10, rx = o.r ?? (w ? w / 2 * 1.15 + 8 : 30), ry = o.r ?? (h ? h / 2 * 1.15 + 8 : 30), L = o.len ?? Math.max(16, Math.min(rx, ry) * 0.7);
  const cx = x + w / 2, cy = y + h / 2, a0 = q() * TAU, rays = [];
  for (let k = 0; k < n; k++) {
    const a = a0 + k / n * TAU + (q() - 0.5) * 0.25, l = L * (k % 2 ? 0.6 : 1) * (0.85 + q() * 0.3), c = Math.cos(a), s = Math.sin(a);
    rays.push(penLine([[cx + c * rx, cy + s * ry], [cx + c * (rx + l), cy + s * (ry + l)]], role, { ...o, w: o.w ?? 3, straight: true }, hash32(seed, k), `ray${k}`));
  }
  return markGroup('starburst', o, seed, p, rays);
}

// callout(str, at, { box, leader: 'dot' | 'arrow' | 'line' | 'none', size, width, dir, reach, curve, align,
// role, textRole, ink2, look | hand, p, seed, name, order }) => a label and a leader from it to `at` (a point,
// or a box: the leader stops at its edge). The copy is written into `box`, or into one `width` wide (320) whose
// middle sits `reach` (170) from at in direction dir (radians; -PI/4, up and to the right); it is lettered
// (a text: group, so lint counts its words) before the leader is drawn. .copy is the copy's ink box, for an
// arrowTo or another mark to start from.
export function callout(str, at, o = {}) {
  const p = o.p ?? 1, seed = seedOf('callout', o), role = o.role ?? 'accents.0', size = o.size ?? 40, base = o.order ?? 1e6;
  const T = boxOf(at, 'callout'), tc = [T[0] + T[2] / 2, T[1] + T[3] / 2];
  let bx = o.box;
  if (!bx) {
    const width = o.width ?? 320, dir = o.dir ?? -Math.PI / 4, reach = o.reach ?? 170, bh = size * 1.3;
    const ex = tc[0] + Math.cos(dir) * (reach + T[2] / 2), ey = tc[1] + Math.sin(dir) * (reach + T[3] / 2);
    bx = [ex - width / 2, ey - bh / 2, width, bh];
  }
  const copyO = { size, align: o.align ?? 'center', valign: 'middle', role: o.textRole ?? 'ink', ink2: o.ink2 ?? null, seed: hash32(seed, 'copy'), order: base };
  for (const k of ['look', 'hand', 'maxLines']) if (o[k] !== undefined) copyO[k] = o[k];
  const copy = textBox(str, bx, copyO), cb = copy.box;
  const leader = o.leader ?? 'dot', parts = [copy];
  if (leader !== 'none') {
    if (!['dot', 'arrow', 'line'].includes(leader)) throw new TypeError(`callout: leader '${leader}' (dot, arrow, line, none)`);
    const lo = { role, w: o.w ?? Math.max(2, size * 0.07), curve: o.curve ?? 0.15, head: leader === 'arrow' ? 'open' : 'none', gap: size * 0.2, seed: hash32(seed, 'leader'), order: base + 5e5 };
    if (o.wobble !== undefined) lo.wobble = o.wobble;
    const arrow = arrowTo(cb, T[2] || T[3] ? T : [tc[0], tc[1]], lo);
    parts.push(...arrow.kids);
    if (leader === 'dot') parts.push(fill(circle(arrow.to[0], arrow.to[1], Math.max(3, lo.w * 1.3), 16), role, { name: 'dot' }));
  }
  return drawnOn(group({ name: 'mark:callout', seed }, parts), p, { copy: cb });
}

// tickMark(at, p, { size, role, w, seed, name, order }) => a check mark, size tall (40), round a point or on
// a box's middle: a short stroke down, then a long one up. (tick is the sound, recipes/sfx.js.)
export function tickMark(at, p, o) {
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(at, 'tickMark'), seed = seedOf('tickMark', o), r = rng(seed), s = o.size ?? (h || 40), cx = x + w / 2, cy = y + h / 2;
  const pts = [[cx - s * 0.45, cy + s * 0.02], [cx - s * 0.15 + (r() - 0.5) * s * 0.05, cy + s * 0.38], [cx + s * 0.2, cy - s * 0.05], [cx + s * 0.55, cy - s * 0.55]];
  return markGroup('tickMark', o, seed, p, [penLine(pts, o.role ?? 'accents.0', { ...o, w: penFor(s, o), straight: true }, hash32(seed, 0), 'tick')]);
}

// crossMark(at, p, { size, role, w, seed, name, order }) => an X, size tall (40), round a point or on a box's
// middle: the stroke down to the right, then the one down to the left. (cross is v1's plus-sign path.)
export function crossMark(at, p, o) {
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(at, 'crossMark'), seed = seedOf('crossMark', o), r = rng(seed), s = o.size ?? (h || 40), cx = x + w / 2, cy = y + h / 2, hs = s / 2;
  const j = () => (r() - 0.5) * s * 0.08, pen = penFor(s, o), role = o.role ?? 'accents.0';
  return markGroup('crossMark', o, seed, p, [
    penLine([[cx - hs + j(), cy - hs + j()], [cx + hs + j(), cy + hs + j()]], role, { ...o, w: pen, straight: true }, hash32(seed, 0), 'a'),
    penLine([[cx + hs + j(), cy - hs + j()], [cx - hs + j(), cy + hs + j()]], role, { ...o, w: pen, straight: true }, hash32(seed, 1), 'b'),
  ]);
}

// question(at, s, p, { role, w, hand, seed, name, order }) => a big drawn ?, s tall (120), centred on a
// point or a box's middle, from the shot's hand (or o.hand), in pen strokes that are not lettering: a mark,
// not a word.
export function question(at, s, p, o) {
  if (typeof s !== 'number') [s, p, o] = [undefined, s, p];
  [p, o] = progress(p, o);
  const [x, y, w, h] = boxOf(at, 'question'), seed = seedOf('question', o), size = s ?? (h || 120), H = o.hand ?? currentHand() ?? houseHand();
  const g = glyph('?', H);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of g.s) for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
  const k = size / Math.max(1, y1 - y0), cx = x + w / 2, cy = y + h / 2, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const role = o.role ?? 'accents.0', pen = penFor(size, o);
  const parts = g.s.map((pts, si) => {
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) { out[i] = cx + (pts[i] - mx) * k; out[i + 1] = cy + (pts[i + 1] - my) * k; }
    const st = { w: pen, seed: hash32(seed, si), name: `q${si}` };
    if (o.wobble !== undefined) st.wobble = o.wobble;
    return stroke(mkPath([{ pts: out, closed: false }]), role, st);
  });
  return markGroup('question', o, seed, p, parts);
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
