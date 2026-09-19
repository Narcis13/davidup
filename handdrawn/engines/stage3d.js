// Paper in space (v1 paper3d.js). Everything is still drawn in 2D, on sheets of paper; the sheets then stand
// in a room: a camera, a lamp that shades each sheet by its angle, shadows cast on the table and the pages.
//
//   const cam = camera3({ eye: [0, 1000, 1300], target: [0, 120, 0], f: 1500 });
//   const moon = card3(260, 600, [fill(circle(130, 126, 118), 'light'), ...]);   // a sheet: w x h units + its ops
//   stage3d({ cam, look: ctx.look }, sheet3(moon, [TL, TR, BR, BL]), ...)          // shadows on the floor, then sheets
//
// Paths are polylines and finishes are geometry, so a sheet is projected point by point through the pinhole:
// every fill, stroke and dot screen lands in screen space as an ordinary op (the pen strokes it crisp there,
// its width scaled by the local foreshortening), clipped against the near plane. Image ops are the exception:
// they become `mesh` ops, the v1 triangle mesh, drawn by the rasteriser. Shading is a role.shade on every
// colour of the sheet (a mesh's `dark`). A shadow is the union of a sheet's fills (and photo silhouettes)
// pushed along the light onto a plane, drawn at 1/10 resolution in fx('soft') and laid down once.
// Axes: x right, y up, z towards the viewer; the table is y = 0.
import { expand } from '../core/finish.js';
import { clip, fill, fx, group, lookNode, mkPath, mmul, norm, withProps, I } from '../core/list.js';

// 3-vector helpers: add sub mul dot cross len norm lerp.
export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const { add, sub, mul, dot, cross } = V3;

export const LIGHT = V3.norm([-0.55, 1, 0.5]);   // the direction TO the lamp
const NEAR = 40;                                  // nothing nearer the camera than this is drawn

// The camera. f is the focal length in frame units; (cx, cy) where the target lands (the frame centre).
// up: [0, .3, -1] lets it look straight down without flipping.
export function camera3({ eye = [0, 1000, 1300], target = [0, 100, 0], f = 1500, up = [0, 1, 0], cx = 540, cy = 540 } = {}) {
  const fw = V3.norm(sub(target, eye)), rt = V3.norm(cross(fw, up)), u = cross(rt, fw);
  return Object.freeze({ eye, target, f, fw, rt, up: u, cx, cy });
}
// A world point as [x, y, depth] in frame units.
export function proj3(cam, p) {
  const d = sub(p, cam.eye), z = dot(d, cam.fw), k = cam.f / Math.max(1, z);
  return [cam.cx + dot(d, cam.rt) * k, cam.cy - dot(d, cam.up) * k, z];
}
const depth = (cam, p) => dot(sub(p, cam.eye), cam.fw);

// Unit normal of a quad [TL, TR, BR, BL].
export const quadNormal = (P) => V3.norm(cross(sub(P[1], P[0]), sub(P[3], P[0])));
// How much to darken a sheet at its angle to the lamp (v1 shadeOf).
export const shadeOf = (P, light = LIGHT) => 0.46 * (1 - Math.abs(dot(quadNormal(P), light)));
// Whether the camera sees the quad's front (corners in texture order TL TR BR BL).
export function facing(cam, P) {
  const ctr = mul(add(add(P[0], P[1]), add(P[2], P[3])), 0.25);
  return dot(cross(sub(P[1], P[0]), sub(P[3], P[0])), sub(cam.eye, ctr)) < 0;
}

// A sheet: w x h units, drawn by `kids` with (0, 0) at its top left. Use fills for its paper, not paper().
export const card3 = (w, h, kids, o = {}) => Object.freeze({ ...o, w, h, kids: norm(kids) });

// ---------- projecting a sheet ----------

// Sheet units -> world, bilinear over the quad (planar quads map straight lines to straight lines).
function mapper(P, w, h) {
  const e1 = sub(P[1], P[0]), e3 = sub(P[3], P[0]), ex = add(sub(P[0], P[1]), sub(P[2], P[3]));
  return (x, y) => { const u = x / w, v = y / h, k = u * v; return [P[0][0] + e1[0] * u + e3[0] * v + ex[0] * k, P[0][1] + e1[1] * u + e3[1] * v + ex[1] * k, P[0][2] + e1[2] * u + e3[2] * v + ex[2] * k]; };
}

// World polylines [{ pts: [[x, y, z], ...], closed }] into a screen path; subs crossing the near plane are cut
// there (Sutherland-Hodgman for closed ones). null when nothing is in front of the camera.
export function worldPath(cam, subs) {
  const out = [];
  const flat = (list) => { const pts = []; for (const q of list) { const r = proj3(cam, q); pts.push(r[0], r[1]); } return pts; };
  const cutAt = (a, b, za, zb) => V3.lerp(a, b, (NEAR - za) / (zb - za));
  for (const s of subs) {
    const W3 = s.pts, n = W3.length, Z = W3.map((q) => depth(cam, q));
    const behind = Z.filter((z) => z < NEAR).length;
    if (!n || behind === n) continue;
    if (!behind) { out.push({ pts: flat(W3), closed: s.closed }); continue; }
    if (s.closed) {
      const poly = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ina = Z[i] >= NEAR, inb = Z[j] >= NEAR;
        if (ina) poly.push(W3[i]);
        if (ina !== inb) poly.push(cutAt(W3[i], W3[j], Z[i], Z[j]));
      }
      if (poly.length >= 3) out.push({ pts: flat(poly), closed: true });
    } else {
      let run = [];
      for (let i = 0; i < n; i++) {
        if (Z[i] >= NEAR) run.push(W3[i]);
        if (i + 1 < n && (Z[i] >= NEAR) !== (Z[i + 1] >= NEAR)) {
          run.push(cutAt(W3[i], W3[i + 1], Z[i], Z[i + 1]));
          if (Z[i + 1] < NEAR) { if (run.length >= 2) out.push({ pts: flat(run), closed: false }); run = []; }
        }
      }
      if (run.length >= 2) out.push({ pts: flat(run), closed: false });
    }
  }
  return out.length ? mkPath(out) : null;
}

// A projector for one quad: local point (through matrix m) -> world -> screen.
function projector(cam, P, w, h) {
  const map = mapper(P, w, h);
  const world = (m, x, y) => map(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  const screen = (q) => proj3(cam, q);
  const path = (p, m) => worldPath(cam, p.sub.map((s) => {
    const pts = [];
    for (let i = 0; i < s.pts.length; i += 2) pts.push(world(m, s.pts[i], s.pts[i + 1]));
    return { pts, closed: s.closed };
  }));
  // Screen units per local unit at (x, y): the square root of the local Jacobian's area.
  const scale = (m, x, y) => {
    const a = world(m, x, y), b = world(m, x + 1, y), c = world(m, x, y + 1);
    if (depth(cam, a) < NEAR) return 0;
    const A = screen(a), B = screen(b), C = screen(c);
    return Math.sqrt(Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])));
  };
  const point = (m, x, y) => { const q = world(m, x, y); return depth(cam, q) < NEAR ? null : screen(q); };
  return { path, scale, point, world };
}

// A role darkened by d (the lamp), composed with any shade it already has.
export function shadeRole(role, d) {
  if (!(d > 0.001)) return role;
  if (typeof role === 'string') return { base: role, shade: d };
  return { ...role, shade: 1 - (1 - (role.shade ?? 0)) * (1 - d) };
}

const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
const mulAlpha = (a, k) => (k === 1 ? a : (a ?? 1) * k);

// Ops in sheet units (expanded) -> ops in screen space.
function flatten(ops, pr, m, k, d, n, out) {
  for (const op of ops) {
    switch (op.op) {
      case 'group': {
        if (op.screen) throw new Error('stage3d: a sheet cannot hold paper()/night() stock; give it fill(rect(0, 0, w, h), \'paper\') instead');
        flatten(op.kids, pr, mmul(m, op.xf ?? I), k * (op.alpha ?? 1), d, n, out);
        break;
      }
      case 'fill': {
        const path = pr.path(op.path, m);
        if (!path) break;
        const props = { path, role: shadeRole(op.role, d), alpha: mulAlpha(op.alpha, k) };
        if (op.cov && typeof op.cov === 'object') {
          const c = op.cov, s = pr.scale(m, ...centre(op.path.box));
          if (c.kind === 'radial') { const p = pr.point(m, c.x, c.y); props.cov = p ? { ...c, x: p[0], y: p[1], r0: (c.r0 ?? 0) * s, r1: c.r1 * s } : undefined; }
          else if (c.kind === 'linear') { const a = pr.point(m, c.x0, c.y0), b = pr.point(m, c.x1, c.y1); props.cov = a && b ? { ...c, x0: a[0], y0: a[1], x1: b[0], y1: b[1] } : undefined; }
        }
        if (props.alpha === undefined) delete props.alpha;
        out.push(withProps(op, props));
        break;
      }
      case 'stroke': {
        const path = pr.path(op.path, m);
        if (!path) break;
        const s = pr.scale(m, ...centre(op.path.box));
        const props = { path, role: shadeRole(op.role, d), w: (op.w ?? 2) * s, alpha: mulAlpha(op.alpha, k) };
        if (op.dash) props.dash = op.dash.map((v) => v * s);
        if (props.alpha === undefined) delete props.alpha;
        out.push(withProps(op, props));
        break;
      }
      case 'dots': {
        const path = pr.path(op.path, m);
        if (!path) break;
        const props = { path, role: shadeRole(op.role, d), cell: (op.cell ?? 8) * pr.scale(m, ...centre(op.path.box)), alpha: mulAlpha(op.alpha, k) };
        if (props.alpha === undefined) delete props.alpha;
        out.push(withProps(op, props));
        break;
      }
      case 'specks': {   // grain rectangles become one fill of little quads
        const q = op.rects, sub = [];
        for (let i = 0; i < q.length; i += 4) sub.push({ pts: [q[i], q[i + 1], q[i] + q[i + 2], q[i + 1], q[i] + q[i + 2], q[i + 1] + q[i + 3], q[i], q[i + 1] + q[i + 3]], closed: true });
        const path = sub.length && pr.path(mkPath(sub), m);
        if (path) out.push(fill(path, shadeRole(op.role, d), { alpha: (op.alpha ?? 1) * k, rule: 'nonzero', name: 'grain' }));
        break;
      }
      case 'image': {
        const grid = [];
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
          const p = pr.point(m, op.x + op.w * i / n, op.y + op.h * j / n);
          grid.push(p ? p[0] : NaN, p ? p[1] : NaN);
        }
        const o = { op: 'mesh', src: op.src, n, grid, dark: d };
        if (op.alpha !== undefined || k !== 1) o.alpha = (op.alpha ?? 1) * k;
        if (op.name) o.name = op.name;
        out.push(Object.freeze(o));
        break;
      }
      case 'clip': {
        const path = pr.path(op.path, m);
        if (!path) break;
        const kids = [];
        flatten(op.kids, pr, m, k, d, n, kids);
        out.push(clip(path, kids));
        break;
      }
      case 'fx': {
        const kids = [];
        flatten(op.kids, pr, m, k, d, n, kids);
        if (op.kind === 'photoMask') { const path = pr.path(op.args.sil, m); if (path) out.push(clip(path, kids)); break; }
        out.push(withProps(op, { kids }));
        break;
      }
      case 'look': {
        const kids = [];
        flatten(op.kids, pr, m, k, d, n, kids);
        out.push(lookNode(op.look, kids));
        break;
      }
      case 'meta': out.push(op); break;
      default: throw new Error(`stage3d: cannot project '${op.op}'`);
    }
  }
  return out;
}

// One sheet on the quad P (world corners in texture order TL TR BR BL) as screen-space ops, or null when the
// whole quad is behind the camera. dark: the lamp's shading (0..1); back: the card seen from behind (drawn
// mirrored, as the back of a sheet is); alpha; n: mesh density for images; look: the look finishes expand in.
export function project(cam, card, P, { dark = 0, back = null, alpha = 1, look, n = 8, name } = {}) {
  if (P.every((p) => depth(cam, p) < NEAR)) return null;
  const front = facing(cam, P), c = !front && back ? back : card;
  const m0 = !front && back ? [-1, 0, 0, 1, c.w, 0] : I;
  const pr = projector(cam, P, c.w, c.h);
  const kids = flatten(expand(c.kids, look ?? 'paperInk'), pr, m0, alpha, Math.min(0.85, dark), n, []);
  return group({ name: name ?? c.name ?? 'sheet' }, kids);
}

// ---------- shadows ----------

// Every fill of a card (and photo silhouettes), in card units.
function silhouette(card, look) {
  const sub = [];
  const walk = (ops, m) => {
    for (const op of ops) {
      if (op.op === 'group') walk(op.kids, mmul(m, op.xf ?? I));
      else if (op.op === 'clip' || op.op === 'fx' || op.op === 'look') walk(op.kids, m);
      else if ((op.op === 'fill' && !op.day && (op.alpha ?? 1) > 0.2) || (op.op === 'image' && op.sil)) {
        const p = op.op === 'fill' ? op.path : op.sil;
        for (const s of p.sub) {
          const q = s.pts, pts = new Array(q.length);
          for (let i = 0; i < q.length; i += 2) { pts[i] = m[0] * q[i] + m[2] * q[i + 1] + m[4]; pts[i + 1] = m[1] * q[i] + m[3] * q[i + 1] + m[5]; }
          sub.push({ pts, closed: true });
        }
      }
    }
  };
  walk(expand(card.kids, look ?? 'paperInk'), I);
  return sub.length ? mkPath(sub) : null;
}

// Shadows of several sheets laid down together, so overlaps do not add up (v1 shadowsBegin / shadow3 /
// shadowsEnd). casters: [{ card, P, r0 = [0, 0, 0], n = [0, 1, 0], alpha = 1 }], each pushed along the light onto
// its own plane (point r0, normal n). clip: a polygon of world points the shadows stay inside (a page).
export function shadows(cam, casters, { clip: region = null, alpha = 0.34, q = 10, role = { base: 'ink', shade: 0.6 }, light = LIGHT, look, name = 'shadows' } = {}) {
  const kids = [];
  for (const { card, P, r0 = [0, 0, 0], n = [0, 1, 0], alpha: a = 1 } of casters) {
    const dn = dot(light, n);
    if (Math.abs(dn) < 0.05 || a <= 0) continue;
    const Q = P.map((p) => add(sub(p, mul(light, dot(sub(p, r0), n) / dn)), mul(n, 0.6)));
    const sil = silhouette(card, look);
    const path = sil && projector(cam, Q, card.w, card.h).path(sil, I);
    if (path) kids.push(fill(path, role, { alpha: Math.min(1, a), rule: 'nonzero' }));
  }
  if (!kids.length) return null;
  let body = kids;
  if (region) {
    const path = worldPath(cam, [{ pts: region, closed: true }]);
    if (!path) return null;
    body = [clip(path, kids)];
  }
  return group({ name }, [fx('soft', { q, alpha }, body)]);
}

// A sheet standing in the room, for stage3d: dark defaults to the lamp's shading; shadow: cast on the floor.
export const sheet3 = (card, P, o = {}) => Object.freeze({ kind: 'sheet3', card, P, ...o });

// Sheets in a room, drawn in the order given (back to front is the caller's business), their shadows on the
// floor first. floor: { r0, n } the plane shadows fall on. Plain ops among the sheets pass through.
export function stage3d({ cam, look, light = LIGHT, floor = { r0: [0, 0, 0], n: [0, 1, 0] }, shadowAlpha = 0.34 }, ...items) {
  items = items.flat(Infinity).filter(Boolean);
  const casters = items.filter((s) => s.kind === 'sheet3' && s.shadow !== false).map((s) => ({ card: s.card, P: s.P, ...floor, alpha: s.shadowAlpha ?? 1 }));
  return group({ name: 'stage3d' }, [
    shadows(cam, casters, { alpha: shadowAlpha, light, look }),
    ...items.map((s) => (s.kind === 'sheet3' ? project(cam, s.card, s.P, { dark: s.dark ?? shadeOf(s.P, light), back: s.back, alpha: s.alpha ?? 1, look, n: s.n }) : s)),
  ]);
}
