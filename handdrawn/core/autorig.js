// Auto-rig a single drawing (4.0 W3): a flat humanoid drawn once (a PNG, a scan on plain paper, an SVG) becomes a
// puppet with the standard biped names, rough by nature; the workbench (W2) moves what it gets wrong.
//
//   the figure   every mark on the drawing (alpha when it has any, else what differs from the paper round its
//                edge), closed over by a mm and its holes filled: the silhouette. The drawing is read as a figure
//                the rig sheet's height (TALL mm, RIG.units tall in the puppet), so a pen's width means what it
//                means on a rig sheet.
//   the joints   core/rig.js labels the silhouette's skeleton (biped: the feet the lowest ends, the head the
//                highest, the hands the two longest of the rest) and hands back its paths. Along each arm's path
//                the pivot is where it leaves the body (where it gets no wider than its middle; a leg at the
//                crotch), half its width back inside, then the elbow and wrist at a person's proportions of what
//                is left (0.42, 0.78); a leg the same (knee 0.47, ankle 0.86). The neck is the narrowest point of
//                the trunk between the shoulders and the head.
//   the cut      every pixel of the silhouette goes to the part whose stretch of skeleton is nearest along the
//                silhouette (so a hand held near the hip stays the hand's); then a limb is cut straight across at
//                each joint, the cut perpendicular to the bone (at a bend, to the two bones' mean), and the trunk
//                at the neck. Each joint takes a disc the limb's half-width from the part above it, so the piece below
//                turns in a round socket and no wedge opens at the elbow. Marks off the silhouette (a loose hat)
//                go to the nearest part.
//   the pieces   each part's pixels read as a rig sheet's box is (core/rigsheet.js readBox: lines, coloured-in
//                fills, dots, the roles over the whole drawing), with the part's silhouette under it as a paper
//                fill, so a piece that swings in front of another hides it as cut paper would.
//   the rest     the vocabulary turns limbs from hanging straight down (K3), so each arm, forearm, thigh and shin
//                is turned to hang and the body to stand up; the hand and foot keep their angle to the forearm
//                and shin, the head to the body. The angles the drawing was drawn at are the pose `drawn`, so
//                `fox({...p.rest, ...p.poses.drawn})` is the drawing again.
//
// Sides: of two limbs the one further left in the picture is -l (the drawing's left face on, the far one in
// profile, as a rig sheet's). A limb found once is drawn for both sides: mirrored about the body face on, the same
// drawing in profile. Pure, like the rig sheet: planes in, a payload out.
import { bounds, fill, mkPath } from './list.js';
import { puppet } from './puppet.js';
import { skelOfMask } from './rig.js';
import { CHROMA, K, ORDER, RIG, SOFT, closing, holdCycles, opsOf, readBox, rolesOf } from './rigsheet.js';
import { components, distanceTransform } from './skeleton.js';
import { traceAlpha } from './trace.js';

export const APPM = 4;                         // pixels per mm a drawing is best read at (cli/sketch.mjs scales it so)
export const TALL = RIG.height;                // mm: the figure's height, as on a rig sheet
// Where the joints sit along a limb, of what is left past its pivot: [elbow, wrist] and [knee, ankle].
export const PROPORTIONS = Object.freeze({ arm: Object.freeze([0.42, 0.78]), leg: Object.freeze([0.47, 0.86]) });

const LIMBS = Object.freeze({ arm: Object.freeze(['arm', 'fore', 'hand']), leg: Object.freeze(['leg', 'shin', 'foot']) });
export const PARTS = Object.freeze(['body', 'head', ...['l', 'r'].flatMap((s) => [...LIMBS.arm, ...LIMBS.leg].map((p) => `${p}-${s}`))]);
const CODE = Object.fromEntries(PARTS.map((p, i) => [p, i]));
const PARENT = Object.fromEntries(ORDER.map(([n, parent]) => [n, parent]));

const r2 = (v) => Math.round(v * 100) / 100;
const grid2 = (v) => { let a = ((v % 360) + 540) % 360 - 180; a = Math.round(a / 2) * 2; return a === -180 ? 180 : a || 0; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const rot = ([x, y], deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
// Degrees that turn `from` onto `v` (y down, so positive is clockwise on screen, as a puppet's joints are).
const angle = (from, v) => (Math.atan2(from[0] * v[1] - from[1] * v[0], dot(from, v)) * 180) / Math.PI;
const DOWN = [0, 1], UP = [0, -1];

// ---------- the figure ----------

const median = (a) => { const s = Float32Array.from(a).sort(); return s.length ? s[s.length >> 1] : 1; };
// The paper: the median of a two pixel band round the edge, [lum, [r, g, b] | null].
export function paperOf({ img, rgb = null }) {
  const { w, h } = img, idx = [];
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) if (y >= 0 && y < h) idx.push(y * w + x);
  for (let y = 2; y < h - 2; y++) for (const x of [0, 1, w - 2, w - 1]) if (x >= 0 && x < w) idx.push(y * w + x);
  const med = (p) => median(idx.map((i) => p[i])) || 1;
  return [med(img.data), rgb ? rgb.map(med) : null];
}

// The pixels outside a mask that the image's edge reaches (4-connected) flipped: its holes filled.
function fillHoles(mask, w, h) {
  const out = new Uint8Array(w * h).fill(1), stack = [];
  const seed = (i) => { if (!mask[i] && out[i]) { out[i] = 0; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  return out;
}

// A drawing's planes ({ img: { data, w, h } lum 0..1, rgb: [r, g, b] Float32Arrays | null, alpha: Float32Array |
// null }) -> { mask (the silhouette: the largest piece, closed and filled), ink (every mark kept), box [x0, y0, x1,
// y1] px of the marks, height px, paper }. Marks under 1% of the largest are specks.
export function figureOf(P) {
  const { w, h } = P.img, n = w * h, paper = paperOf(P), [pl, pc] = paper, marked = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (P.alpha) { marked[i] = P.alpha[i] > 0.5 ? 1 : 0; continue; }
    let c = 0;
    if (pc) {
      const r = Math.min(1, P.rgb[0][i] / pc[0]), g = Math.min(1, P.rgb[1][i] / pc[1]), b = Math.min(1, P.rgb[2][i] / pc[2]);
      c = Math.max(r, g, b) - Math.min(r, g, b);
    }
    marked[i] = P.img.data[i] / pl < SOFT || c > CHROMA ? 1 : 0;
  }
  const comps = components(marked, w, h).sort((a, b) => b.area - a.area);
  if (!comps.length) throw new Error('autorig: nothing is drawn (a figure on plain paper or a transparent background)');
  const ink = new Uint8Array(n), box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of comps) {
    if (c.area < 0.01 * comps[0].area) break;
    for (const i of c.px) ink[i] = 1;
    box[0] = Math.min(box[0], c.box[0]); box[1] = Math.min(box[1], c.box[1]); box[2] = Math.max(box[2], c.box[2]); box[3] = Math.max(box[3], c.box[3]);
  }
  const height = box[3] - box[1] + 1;
  const filled = fillHoles(closing(ink, w, h, Math.max(1, height / TALL)), w, h);
  const big = components(filled, w, h).sort((a, b) => b.area - a.area)[0], mask = new Uint8Array(n);
  for (const i of big.px) mask[i] = 1;
  return { mask, ink, box, height, paper };
}

// ---------- spreading labels ----------

// A binary heap of pixel indices by a float key.
function heap() {
  const idx = [], key = [];
  return {
    get size() { return idx.length; },
    push(i, k) {
      let c = idx.length;
      idx.push(i); key.push(k);
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (key[p] <= key[c]) break;
        [idx[p], idx[c]] = [idx[c], idx[p]]; [key[p], key[c]] = [key[c], key[p]]; c = p;
      }
    },
    pop() {
      const top = [idx[0], key[0]], li = idx.pop(), lk = key.pop();
      if (idx.length) {
        idx[0] = li; key[0] = lk;
        for (let c = 0; ;) {
          const a = 2 * c + 1, b = a + 1;
          let m = c;
          if (a < idx.length && key[a] < key[m]) m = a;
          if (b < idx.length && key[b] < key[m]) m = b;
          if (m === c) break;
          [idx[m], idx[c]] = [idx[c], idx[m]]; [key[m], key[c]] = [key[c], key[m]]; c = m;
        }
      }
      return top;
    },
  };
}
const N8 = [[-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2], [-1, 0, 1], [1, 0, 1], [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2]];
// Every pixel `pass` lets through (all when null) takes the label of the labelled pixel nearest along them.
function spread(label, pass, w, h) {
  const dist = new Float64Array(w * h).fill(Infinity), H = heap();
  for (let i = 0; i < label.length; i++) if (label[i] >= 0) { dist[i] = 0; H.push(i, 0); }
  while (H.size) {
    const [i, d] = H.pop();
    if (d > dist[i]) continue;
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy, c] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (pass && !pass[q]) continue;
      if (d + c < dist[q]) { dist[q] = d + c; label[q] = label[i]; H.push(q, d + c); }
    }
  }
  return label;
}

// ---------- polylines ----------

const arclen = (pts) => { const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + len(sub(pts[i], pts[i - 1]))); return s; };
function along(pts, S, d) {
  if (d <= 0) return [...pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (S[i] >= d) { const t = (d - S[i - 1]) / (S[i] - S[i - 1] || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
  }
  return [...pts[pts.length - 1]];
}

// ---------- the rig ----------

// A drawing's planes (see figureOf) -> { payload, table, found, copied, blank, rig }: a puppet payload with the
// standard biped names in one view, the colours' roles (as a rig sheet's), the limbs found and copied, the parts
// that came out empty, and rig: { w, h, label (Int8Array, PARTS index or -1), joints { name: [x, y] px }, bones
// [[a, b]] } for a picture of what was found.
export function autoRig(P, { name = 'drawing', view = 'front', desc, roles } = {}) {
  if (view !== 'front' && view !== 'side') throw new Error(`autorig: view '${view}' (expected front | side)`);
  const F = figureOf(P), { w, h } = P.img, n = w * h, ppm = F.height / TALL, mm = 1 / ppm;
  const got = skelOfMask({ mask: F.mask, w, h, x0: 0, y0: 0, s: 1 }, 'biped', { h: F.height, paths: true, corners: true });
  if (!got.paths) {
    throw new Error(`autorig: found ${got.joints.head ? 'a head but no feet' : 'no head'} on the drawing's skeleton; draw one standing figure with its legs apart and its arms clear of its body`);
  }
  if (!got.paths.legs.length) throw new Error('autorig: found no legs; draw the figure standing, legs apart');
  const DT = distanceTransform(F.mask, w, h);
  const px = ([x, y]) => Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x)));
  const dtAt = (p) => DT[px(p)];

  // The trunk, hip (the fork of the legs) to the head's end.
  const trunk = got.paths.trunk, TS = arclen(trunk), T1 = TS[TS.length - 1], hip = trunk[0], headC = trunk[trunk.length - 1];
  const onTrunk = (p) => { let bi = 0; for (let i = 1; i < trunk.length; i++) if (len(sub(trunk[i], p)) < len(sub(trunk[bi], p))) bi = i; return TS[bi]; };
  // A limb: its path from the trunk, carried on past the skeleton's end by the ink's half-width there (to the tip).
  // The crotch: the paper nearest the legs' fork, when two legs part there.
  const crotch = got.paths.legs.length === 2 ? (() => {
    const R = Math.ceil(dtAt(hip)) + 2, [hx, hy] = hip;
    let best = null, bd = Infinity;
    for (let y = Math.max(0, Math.floor(hy - R)); y <= Math.min(h - 1, Math.ceil(hy + R)); y++) {
      for (let x = Math.max(0, Math.floor(hx - R)); x <= Math.min(w - 1, Math.ceil(hx + R)); x++) {
        const d = Math.hypot(x + 0.5 - hx, y + 0.5 - hy);
        if (!F.mask[y * w + x] && y + 0.5 > hy && d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
      }
    }
    return best;
  })() : null;
  const limbOf = (pts, kind) => {
    const S0 = arclen(pts), end = pts[pts.length - 1], back = along(pts, S0, Math.max(0, S0[S0.length - 1] - 6 * ppm));
    const d = unit(sub(end, back)), r = dtAt(end), tip = [end[0] + d[0] * r, end[1] + d[1] * r];
    const all = [...pts, tip], S = arclen(all), L0 = S[S.length - 1];
    // Where it leaves the body: the first point out from the trunk no wider than the limb's middle (x 1.2); the
    // joint sits half the limb's width back inside.
    const mid = median(pts.filter((_, i) => S0[i] >= 0.3 * L0 && S0[i] <= 0.7 * L0).map(dtAt));
    // A leg leaves the body at the crotch (the fork of the skeleton sits above it): half its width above.
    const exit = kind === 'leg' && crotch ? S0[Math.max(0, pts.findIndex((p) => p[1] >= crotch[1] - 0.5 * mid))] + mid
      : S0[Math.max(0, pts.findIndex((p) => dtAt(p) <= 1.2 * mid))];
    const sp = Math.min(Math.max(0, exit - mid), 0.35 * L0), L = L0 - sp, [a, b] = PROPORTIONS[kind];
    const s = [sp, sp + a * L, sp + b * L, L0];
    return { kind, pts: all, S, s, j: s.map((v) => along(all, S, v)), join: onTrunk(pts[0]), width: mid };
  };
  const found = { arm: got.paths.arms.map((p) => limbOf(p, 'arm')), leg: got.paths.legs.map((p) => limbOf(p, 'leg')) };
  const sideOf = {}, copied = [];
  for (const kind of ['arm', 'leg']) {
    const L = found[kind];
    if (L.length === 2) {
      const [a, b] = [...L].sort((p, q) => p.j[3][0] - q.j[3][0]);
      sideOf[`${kind}-l`] = a; sideOf[`${kind}-r`] = b;
    } else if (L.length === 1) {
      const s = L[0].j[3][0] < hip[0] ? 'l' : 'r', o = s === 'l' ? 'r' : 'l';
      sideOf[`${kind}-${s}`] = L[0];
      copied.push(`${kind}-${o}`);
    }
  }
  // The neck: the narrowest point of the trunk between where the arms join it and the head.
  const arms = found.arm, sj = arms.length ? arms.reduce((a, l) => a + l.join, 0) / arms.length : 0.55 * T1;
  let sNeck = sj + 0.5 * (T1 - sj), best = Infinity;
  for (let i = 0; i < trunk.length; i++) if (TS[i] >= sj && TS[i] <= T1) { const d = dtAt(trunk[i]); if (d < best) { best = d; sNeck = TS[i]; } }
  const neck = along(trunk, TS, sNeck), chest = along(trunk, TS, Math.min(sj, sNeck));

  // Seeds on the skeleton: each stretch of path is its part's.
  const label = new Int8Array(n).fill(-1);
  const seed = (p, part) => { const i = px(p); if (F.mask[i]) label[i] = CODE[part]; };
  trunk.forEach((p, i) => seed(p, TS[i] < sNeck ? 'body' : 'head'));
  for (const [key, l] of Object.entries(sideOf)) {
    const s = key.slice(-1), names = LIMBS[l.kind].map((q) => `${q}-${s}`);
    l.pts.forEach((p, i) => { const d = l.S[i]; seed(p, d < l.s[0] ? 'body' : d < l.s[1] ? names[0] : d < l.s[2] ? names[1] : names[2]); });
  }
  spread(label, F.mask, w, h);
  // Straight cuts: a limb's pixels across its joints' planes, the trunk's across the neck's (within reach of it).
  const cutsOf = (l) => {
    const b = [0, 1, 2].map((k) => unit(sub(l.j[k + 1], l.j[k])));
    return [[l.j[0], b[0]], [l.j[1], unit([b[0][0] + b[1][0], b[0][1] + b[1][1]])], [l.j[2], unit([b[1][0] + b[2][0], b[1][1] + b[2][1]])]];
  };
  const chains = Object.entries(sideOf).map(([key, l]) => ({ codes: LIMBS[l.kind].map((q) => CODE[`${q}-${key.slice(-1)}`]), cuts: cutsOf(l) }));
  const chainOf = new Map(chains.flatMap((c) => c.codes.map((k) => [k, c])));
  const nNeck = unit([unit(sub(neck, hip))[0] + unit(sub(headC, neck))[0], unit(sub(neck, hip))[1] + unit(sub(headC, neck))[1]]);
  const neckR = 2.5 * Math.max(dtAt(neck), ppm);
  for (let i = 0; i < n; i++) {
    const lb = label[i];
    if (lb < 0) continue;
    const p = [(i % w) + 0.5, Math.floor(i / w) + 0.5], c = chainOf.get(lb);
    if (c) {
      let k = -1;
      while (k < 2 && dot(sub(p, c.cuts[k + 1][0]), c.cuts[k + 1][1]) >= 0) k++;
      label[i] = k < 0 ? CODE.body : c.codes[k];
    } else if ((lb === CODE.body || lb === CODE.head) && len(sub(p, neck)) <= neckR) {
      label[i] = dot(sub(p, neck), nNeck) >= 0 ? CODE.head : CODE.body;
    }
  }
  // Round sockets: each joint's disc (its limb's half-width) goes to the part below it.
  const socket = (child, parent, at, width = dtAt(at)) => {
    const r = Math.max(Math.min(dtAt(at), width), ppm), [cx, cy] = at;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        const i = y * w + x;
        if (F.mask[i] && (label[i] === CODE[parent] || label[i] === CODE[child]) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) label[i] = CODE[child];
      }
    }
  };
  socket('head', 'body', neck);
  for (const [key, l] of Object.entries(sideOf)) {
    const s = key.slice(-1), [a, b, c] = LIMBS[l.kind].map((q) => `${q}-${s}`);
    socket(a, 'body', l.j[0], 1.1 * l.width); socket(b, a, l.j[1]); socket(c, b, l.j[2]);
  }
  // Marks off the silhouette: the nearest part's.
  const all = spread(Int8Array.from(label), null, w, h);
  for (let i = 0; i < n; i++) if (F.ink[i] && !F.mask[i]) label[i] = all[i];

  // The angles the drawing was drawn at, and each part's drawn pivot (px).
  const theta = { hips: 0, body: angle(UP, sub(neck, hip)) }, pivotPx = { hips: hip, body: hip, head: neck };
  theta.head = theta.body;
  for (const [key, l] of Object.entries(sideOf)) {
    const s = key.slice(-1), [a, b, c] = LIMBS[l.kind].map((q) => `${q}-${s}`);
    theta[a] = angle(DOWN, sub(l.j[1], l.j[0])); theta[b] = angle(DOWN, sub(l.j[2], l.j[1])); theta[c] = theta[b];
    pivotPx[a] = l.j[0]; pivotPx[b] = l.j[1]; pivotPx[c] = l.j[2];
  }
  const mirrorPx = ([x, y]) => [2 * hip[0] - x, y];
  for (const key of copied) {
    const s = key.slice(-1), o = s === 'l' ? 'r' : 'l', kind = key.slice(0, -2);
    for (const q of LIMBS[kind]) {
      theta[`${q}-${s}`] = view === 'front' ? -theta[`${q}-${o}`] : theta[`${q}-${o}`];
      pivotPx[`${q}-${s}`] = view === 'front' ? mirrorPx(pivotPx[`${q}-${o}`]) : pivotPx[`${q}-${o}`];
    }
  }
  const present = ORDER.map(([q]) => q).filter((q) => q === 'hips' || pivotPx[q]);
  // mm about the hip, the drawing's axes.
  const toMm = (p) => [(p[0] - hip[0]) * mm, (p[1] - hip[1]) * mm];
  // A point of a part's drawing (mm) at rest: about its pivot, turned back by the angle it was drawn at.
  const restPivot = {};
  const restOfPivot = (q) => {
    if (restPivot[q]) return restPivot[q];
    const par = PARENT[q];
    if (!par) return (restPivot[q] = toMm(pivotPx[q]));
    const P0 = restOfPivot(par), v = rot(sub(toMm(pivotPx[q]), toMm(pivotPx[par])), -theta[par]);
    return (restPivot[q] = [P0[0] + v[0], P0[1] + v[1]]);
  };
  const local = (q, pMm) => rot(sub(pMm, toMm(pivotPx[q])), -theta[q]);
  const restAt = (q, p) => { const P0 = restOfPivot(q), v = local(q, toMm(p)); return [P0[0] + v[0], P0[1] + v[1]]; };

  // Each part's pixels read as a rig sheet's box, in mm about its pivot, turned to rest.
  const pieces = {}, backs = {}, blank = [], [pl, pc] = F.paper;
  const byPart = PARTS.map(() => []);
  for (let i = 0; i < n; i++) if (label[i] >= 0 && (F.mask[i] || F.ink[i])) byPart[label[i]].push(i);
  for (const part of PARTS) {
    const pxs = byPart[CODE[part]];
    if (!pivotPx[part]) continue;
    if (pxs.length < ppm * ppm) { blank.push(part); continue; }
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const i of pxs) { const x = i % w, y = (i - x) / w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const m = Math.ceil(2 * ppm);
    x0 -= m; y0 -= m; x1 += m; y1 += m;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cn = cw * ch;
    const lum = new Float32Array(cn).fill(pl), rgb = pc ? pc.map((v) => new Float32Array(cn).fill(v)) : null, plane = new Uint8Array(cn);
    for (const i of pxs) {
      const x = i % w, y = (i - x) / w, j = (y - y0) * cw + (x - x0);
      lum[j] = P.img.data[i];
      if (rgb) for (let c = 0; c < 3; c++) rgb[c][j] = P.rgb[c][i];
      plane[j] = 255;
    }
    const read = readBox({ lum: { data: lum, w: cw, h: ch }, rgb: rgb?.map((d) => ({ data: d, w: cw, h: ch })) ?? null }, { ppm, paper: [pl, pc] });
    const L = (p) => local(part, toMm(p));
    const atPx = ([x, y]) => L([x0 + x + 0.5, y0 + y + 0.5]), atC = ([x, y]) => L([x0 + x, y0 + y]);
    const flat = (s) => { const out = []; for (let k = 0; k < s.length; k += 2) out.push(atC([s[k], s[k + 1]])); return out; };
    pieces[part] = {
      lines: read.lines.map((l) => ({ pts: l.pts.map(atPx), w: l.w / ppm, rgb: l.rgb, closed: l.closed, len: l.len / ppm })),
      blobs: read.blobs.map((f) => ({ subs: f.subs.map(flat), rgb: f.rgb, area: f.area / (ppm * ppm), ...(f.ink ? { ink: true } : {}), ...(f.paper ? { paper: true } : {}) })),
      dots: read.dots.map((d) => ({ c: atC(d.c), r: d.r / ppm, rgb: d.rgb })),
    };
    backs[part] = traceAlpha(plane, cw, ch, { threshold: 127, step: 1, eps: 0.3 * ppm, minArea: 4 }).sub.map((s) => flat(s.pts));
  }
  if (!pieces.body) throw new Error('autorig: the body came out empty; draw a trunk between the head and the legs');
  const { roleOf, table } = rolesOf([{ pieces }], { roles });

  // The payload: the rig sheet's painter order, pivots at rest, the ground under the feet.
  const u = ([x, y]) => [r2(x * K), r2(y * K)];
  const flip = ([x, y]) => [-x, y];
  const opsFor = (q) => {
    const own = pieces[q] ? q : copied.includes(q) ? q.replace(/-(l|r)$/, (_, s) => (s === 'l' ? '-r' : '-l')) : null;
    if (!own || !pieces[own]) return [];
    const mirror = own !== q && view === 'front', back = backs[own];
    const under = back?.length ? [fill(mkPath(back.map((s) => ({ pts: (mirror ? s.map(flip) : s).flatMap(u), closed: true }))), 'paper', { name: q })] : [];
    return JSON.parse(JSON.stringify([...under, ...opsOf(pieces[own], roleOf, q, mirror)]));
  };
  const parts = {};
  for (const [q, parent] of ORDER) {
    if (!present.includes(q)) continue;
    parts[q] = { ...(parent ? { parent } : {}), pivot: u(restOfPivot(q)), ops: q === 'hips' ? [] : opsFor(q) };
  }
  const drawn = {};
  for (const q of Object.keys(parts)) if (q !== 'hips') drawn[q] = grid2(theta[q] - (theta[PARENT[q]] ?? 0));
  // The sole: the lowest the drawing reaches at rest; the hip stays over x = 0.
  const bare = puppet({ kind: 'puppet', name: `${name}~rest`, units: RIG.units, ground: [0, 0], parts });
  const b = bounds(bare(bare.rest).kids) ?? [0, 0, 0, 0], drop = b[1] + b[3];
  const shift = (p) => [r2(p[0]), r2(p[1] - drop)];
  for (const q of Object.keys(parts)) parts[q].pivot = shift(parts[q].pivot);
  // The skeleton at rest in the stick's names (core/stick.js), for `hdf retarget`.
  const joints = { hip: shift(u(restAt('body', hip))), chest: shift(u(restAt('body', chest))), neck: shift(u(restAt('head', neck))), head: shift(u(restAt('head', headC))) };
  const bones = [['hip', 'chest']];
  for (const s of ['l', 'r']) {
    const arm = `arm-${s}`, leg = `leg-${s}`;
    if (parts[arm]) {
      Object.assign(joints, { [`shoulder-${s}`]: parts[arm].pivot, [`elbow-${s}`]: parts[`fore-${s}`].pivot, [`wrist-${s}`]: parts[`hand-${s}`].pivot });
      bones.push([`shoulder-${s}`, `elbow-${s}`], [`elbow-${s}`, `wrist-${s}`]);
    }
    if (parts[leg]) {
      Object.assign(joints, { [`hip-${s}`]: parts[leg].pivot, [`knee-${s}`]: parts[`shin-${s}`].pivot, [`ankle-${s}`]: parts[`foot-${s}`].pivot, [`toe-${s}`]: shift(u(restAt(`foot-${s}`, mirrorOf(`foot-${s}`, 3)))) });
      bones.push([`hip-${s}`, `knee-${s}`], [`knee-${s}`, `ankle-${s}`], [`ankle-${s}`, `toe-${s}`]);
    }
  }
  // A limb's joint k in the picture, for either side (a copied side's mirrored face on).
  function mirrorOf(q, k) {
    const s = q.slice(-1), kind = /^(arm|fore|hand)/.test(q) ? 'arm' : 'leg', l = sideOf[`${kind}-${s}`];
    if (l) return l.j[k];
    const o = sideOf[`${kind}-${s === 'l' ? 'r' : 'l'}`].j[k];
    return view === 'front' ? mirrorPx(o) : o;
  }
  // Sockets: in each hand, half way from the wrist to the tip, pointing along it.
  const sockets = {};
  for (const s of ['l', 'r']) {
    const q = `hand-${s}`;
    if (!parts[q]) continue;
    const wr = mirrorOf(q, 2), tip = mirrorOf(q, 3), at = local(q, toMm([(wr[0] + tip[0]) / 2, (wr[1] + tip[1]) / 2])), dir = local(q, toMm(tip));
    sockets[q] = { part: q, at: u(at), angle: grid2((Math.atan2(dir[1], dir[0]) * 180) / Math.PI) };
  }
  const payload = {
    kind: 'puppet', name, units: RIG.units, ground: [0, 0], box: [0, 0, 0, 0], views: [view],
    desc: desc ?? `one drawing rigged by hdf sketch --auto (${view}): the standard biped parts, so the vocabulary poses and walks it; the pose 'drawn' is the drawing`,
    parts, poses: { drawn }, sockets, skeleton: { joints, bones },
  };
  const rest = puppet({ ...payload, box: undefined });
  payload.box = holdCycles(payload, rest.cel.box);

  // What was found, for the picture: the joints in the drawing's pixels and the bones between them.
  const J = { hip, chest, neck, head: headC };
  const B = [['hip', 'chest'], ['chest', 'neck'], ['neck', 'head']];
  for (const [key, l] of Object.entries(sideOf)) {
    const names = l.kind === 'arm' ? ['shoulder', 'elbow', 'wrist', 'fingers'] : ['hip', 'knee', 'ankle', 'toe'], s = key.slice(-1);
    names.forEach((q, k) => { J[`${q}-${s}`] = l.j[k]; });
    B.push(...[0, 1, 2].map((k) => [`${names[k]}-${s}`, `${names[k + 1]}-${s}`]), [l.kind === 'arm' ? 'chest' : 'hip', `${names[0]}-${s}`]);
  }
  return {
    payload, table, copied, blank, found: Object.keys(sideOf).sort(),
    rig: { w, h, label, joints: Object.fromEntries(Object.entries(J).map(([k, p]) => [k, p.map(r2)])), bones: B },
  };
}
