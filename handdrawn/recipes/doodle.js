// The doodle set (v1 scenes.md "Doodle look", shots AA to AM): drawings on a found photo. Each recipe is a
// function of an options object returning a shot. Shared shape (v1 doodle.md): the object alone for a few
// frames, drawings arrive from several pens with different starts, a gag in the last third.
//
//   import { becomesVehicle } from 'handdrawn/recipes/doodle.js';
//   becomesVehicle({ photo: PHOTOS.violin, rot: -Math.PI / 2 })
//
// Common options: photo (a cutout, plan 1.6; register it in film({ assets })), name, dur (on the 1/12 s grid;
// the recipe's timing stretches to it), paper (a PASTELS name, or null for the inherited look), look (base
// look, default doodlePastel), actor (the cast member, default HOG), seed (added to every pen seed), word(s)
// (null drops them), say (a line from actor.say(text, t0): the cast member speaks it, in shot seconds; AC).
// Everything is laid out on a 1080 square "stage" centred in the frame, so other formats keep the layout and
// get more paper at the sides; ground lines and seas run well past the square.
//
// A cast member is an actor (core/actor.js, plan 1.3): the recipes ask it for look(dir), emote(name) and
// cycle('run', t) and put() the merged state on the stage, centred at (x, y), feet at y + .86 s, with rot,
// hand ([x, y]) and fright (0..1) beside it. HOG is the default: the builder hog(d, x, y, s, o) below as an
// actor, drawing exactly what it drew when recipes called it directly. Any puppet in the store is one
// actor away (`actor: CAST.FOX`), and the old option `who: builder` still works (it is wrapped the same way).
// spark (the runaway light) and bird stay builders the recipes call themselves.
import {
  FPS, ease, ramp, shot, rng, LOOKS, pastel, signOff, circle, ellipse, rect, poly, spline, xf, fill, stroke, group, clip,
  fx, meta, lookNode, translate, rotate, scale, mmul, linear, speedLines, cam, whip, pin, on, silhouette, photo,
  photoFront, rim, backdrop, glow, pen,
} from '../core/index.js';
import { withProps } from '../core/list.js';
import { actorOf } from '../core/actor.js';
import { puppet } from '../core/puppet.js';
import { stored } from '../core/store.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, u) => a + (b - a) * u;
const sm = (a, b, t, e = ease.io) => ramp(a, b, t, e);

// ---------- motion helpers (v1 night-shift) ----------

// From a to b over t = 0..1 on an arc h high.
export const hop = (a, b, t, h) => { t = clamp01(t); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * h]; };
// From a to b over t = 0..1 in a straight line.
export const lin = (a, b, t) => { t = clamp01(t); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; };

// ---------- geometry helpers ----------

const tf = (x, y, s, rot = 0, dir = 1) => (px, py) => {
  const X = px * s * dir, Y = py * s, ca = Math.cos(rot), sa = Math.sin(rot);
  return [x + X * ca - Y * sa, y + X * sa + Y * ca];
};
const M = (T, pts) => pts.map((p) => T(p[0], p[1]));
const blob = (pts) => spline(pts, { closed: true, tension: 0, n: 6 });       // v1 splinePath(pts, true)
const pairs = (path) => { const q = path.sub[0].pts, out = []; for (let i = 0; i < q.length; i += 2) out.push([q[i], q[i + 1]]); return out; };
const smooth = (pts, n = 8) => pairs(spline(pts, { tension: 0, n }));
const ellPts = (x, y, rx, ry, n = 12) => Array.from({ length: n }, (_, k) => [x + Math.cos(k / n * TAU) * rx, y + Math.sin(k / n * TAU) * ry]);

// Where a vertical line x crosses a path (frame coordinates), as y values.
function crossings(path, x) {
  const ys = [];
  for (const s of path.sub) {
    const q = s.pts, m = q.length / 2;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      if (!s.closed && j === 0) break;
      const x0 = q[2 * i], y0 = q[2 * i + 1], x1 = q[2 * j], y1 = q[2 * j + 1];
      if ((x0 <= x) !== (x1 <= x)) ys.push(y0 + (y1 - y0) * (x - x0) / (x1 - x0));
    }
  }
  return ys;
}
// The top (bottom) of a placed photo's silhouette above frame x, whatever its rotation.
const topAt = (sil, x) => { const ys = crossings(sil, x); return ys.length ? Math.min(...ys) : sil.box[1]; };
const bottomAt = (sil, x) => { const ys = crossings(sil, x); return ys.length ? Math.max(...ys) : sil.box[1] + sil.box[3]; };

// Frame point of the rest pose pl0 -> the same photo point in pose pl (so a rig drawn at rest rides the photo).
function attach(pl0, pl) {
  const ca = Math.cos(pl0.rot), sa = Math.sin(pl0.rot), fx0 = pl0.flip ? -1 : 1;
  return ([x, y]) => {
    const dx = x - pl0.x, dy = y - pl0.y, lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
    return on(pl, lx / (pl0.w * fx0) + 0.5, ly / pl0.h + 0.5);
  };
}

// ---------- roles (never hex; chosen to survive nightShot's chalk pass where it matters) ----------

// Roles the doodle cast and props share (quills, tea, star, ...), as role objects.
export const ROLES = Object.freeze({
  quills: { base: 'fills.4', shade: 0.3 },
  white: { base: 'paper', tint: 0.92 },          // stays white in the chalk pass ('light' goes dark there)
  flame: { base: 'fills.2', tint: 0.55 },
  flameWash: 'accents.2',
  flameLine: { base: 'accents.2', shade: 0.45 },
  flameEye: { base: 'fills.4', shade: 0.78 },
  warm: { base: 'light', mix: ['accents.2', 0.5] },
  star: { base: 'fills.2', tint: 0.45 },
  tea: { base: 'fills.4', shade: 0.35 },
  wood: { base: 'fills.4', shade: 0.45 },
  hill: { base: 'paper', mix: ['fills.3', 0.7] },
});

// ---------- the cast ----------

const dot = (d, x, y, r, role = 'ink') => d.mark((k) => fill(circle(x, y, Math.max(0.2, r * k), 16), role), 0.05);

// The hedgehog of v1 held-once and night-shift: gouache body, quill wash, brush outline, dot eyes, a scarf
// (the anchor colour). hand = [x, y] in frame units reaches an arm there; run = run-cycle phase; fright lifts
// the quills.
export function hog(d, x, y, s, o = {}) {
  const { dir = 1, rot = 0, scarf = 'accents.0', eye = 'dot', hand = null, body = 'light', quills = ROLES.quills, w = 4, run = null, fright = 0 } = o;
  const bobY = run == null ? 0 : -Math.abs(Math.sin(run)) * s * 0.12, T = tf(x, y + bobY, s, rot + (run == null ? 0 : 0.1), dir);
  const B = [[-1, 0.15], [-0.85, -0.5], [-0.3, -0.92], [0.35, -0.85], [0.8, -0.45], [1.32, -0.04], [0.85, 0.35], [0.5, 0.62], [-0.4, 0.68], [-0.9, 0.5]];
  const Q = [[-1, 0.15], [-0.85, -0.5], [-0.3, -0.92], [0.35, -0.85], [0.72, -0.52], [0.42, -0.22], [0.18, 0.12], [-0.12, 0.47], [-0.9, 0.5]];
  d.fill(blob(M(T, B)), body).wash(blob(M(T, Q)), quills, { al: 0.75, off: 3 }).line(M(T, B), { close: true, w });
  d.line(M(T, [[0.72, -0.52], [0.42, -0.22], [0.18, 0.12], [-0.12, 0.47]]), { w: w * 0.8 });
  const sp = [], L = 1.22 + fright * 0.45;
  for (let k = 0; k < 11; k++) {
    const a = Math.PI * (1.08 + k * 0.105), cx = -0.1 + Math.cos(a), cy = -0.08 + Math.sin(a) * 0.88;
    sp.push(M(T, [[cx * 0.97, cy * 0.97], [cx * L - 0.08 * (1 - fright), cy * L]]));
  }
  d.lines(sp, { w: w * 0.85, dur: 0.05, stagger: 0.025 });
  d.lines([[[-0.45, -0.35], [-0.55, -0.5]], [[-0.1, -0.45], [-0.18, -0.62]], [[-0.55, 0.05], [-0.68, -0.08]], [[-0.2, -0.05], [-0.3, -0.2]], [[0.15, -0.4], [0.1, -0.57]]].map((p) => M(T, p)), { w: w * 0.7, dur: 0.04, stagger: 0.02 });
  d.line(M(T, [[0.3, -0.52], [0.4, -0.74], [0.54, -0.54]]), { w: w * 0.8 });
  if (eye === 'happy') d.line(M(T, [[0.64, -0.14], [0.74, -0.25], [0.84, -0.14]]), { w: w * 0.85 });
  else if (eye === 'sleep') d.line(M(T, [[0.64, -0.2], [0.74, -0.12], [0.84, -0.2]]), { w: w * 0.85 });
  else if (eye === 'wide') { d.fill(circle(...T(0.74, -0.2), s * 0.15, 16), ROLES.white).line(ellPts(...T(0.74, -0.2), s * 0.15, s * 0.15, 8), { close: true, w: w * 0.6 }); dot(d, ...T(0.77, -0.2), s * 0.06); }
  else dot(d, ...T(0.74, -0.18), s * 0.075);
  dot(d, ...T(1.32, -0.04), s * 0.1);
  d.wash(ellipse(...T(0.62, 0.1), s * 0.17, s * 0.1, 16), 'blush', { al: 0.8, off: 1 });
  const sw = run == null ? 0 : Math.sin(run) * 0.42;
  const legs = run == null ? [[[-0.45, 0.66], [-0.47, 0.86], [-0.25, 0.86]], [[0.3, 0.6], [0.3, 0.86], [0.52, 0.86]]] : [[[-0.35, 0.62], [-0.35 + sw, 0.9]], [[0.25, 0.6], [0.25 - sw, 0.9]]];
  d.lines(legs.map((p) => M(T, p)), { w: w * 0.85 });
  if (scarf) {
    const fl = run == null ? 0 : Math.sin(run * 1.3) * 0.14;
    const S1 = [[0.16, 0.1], [0.5, 0.28], [0.88, 0.34], [0.84, 0.5], [0.45, 0.47], [0.1, 0.3]];
    const S2 = [[0.2, 0.28], [-0.25, 0.3 + fl], [-0.7, 0.1 - fl], [-0.72, 0.34 - fl], [-0.25, 0.5 + fl], [0.2, 0.44]];
    d.wash(blob(M(T, S2)), scarf, { al: 0.95, off: 2 }).wash(blob(M(T, S1)), scarf, { al: 0.95, off: 2 }).line(M(T, S2), { close: true, w: w * 0.7 }).line(M(T, S1), { close: true, w: w * 0.7 });
  }
  if (hand) {
    const a = T(0.5, 0.3), m = [(a[0] + hand[0]) / 2 + 6 * dir, (a[1] + hand[1]) / 2 + 10];
    d.line([a, m, hand], { w: w * 0.9 });
    dot(d, hand[0], hand[1], s * 0.09);
  }
  return d;
}

// The spark: a flame with legs (v1 night-shift). Its roles do not change in the chalk pass, so it looks the
// same in and out of the light. mood: 'happy' | 'sad' | 'o'.
export function spark(d, x, y, s, o = {}) {
  const { dir = 1, run = null, mood = 'happy', lean = 0, squash = 1 } = o, T = tf(x, y, s, 0, dir), k = squash;
  const B = [[-lean * 1.2, -1.55 * k], [0.5 - lean * 0.4, -0.6 * k], [0.78, 0.15], [0.5, 0.8], [0, 0.95], [-0.5, 0.8], [-0.78, 0.15], [-0.42 - lean * 0.4, -0.55 * k]];
  d.fill(blob(M(T, B)), ROLES.flame)
    .wash(blob(M(T, B.map(([a, b]) => [a * 0.82, b * 0.82 + 0.16]))), ROLES.flameWash, { al: 0.8, off: 1, blend: 'source-over' })
    .line(M(T, B), { close: true, w: 3.2, role: ROLES.flameLine });
  const e = mood === 'sad' ? 0.12 : 0;
  dot(d, ...T(0.12, e), s * 0.085, ROLES.flameEye); dot(d, ...T(0.46, e), s * 0.085, ROLES.flameEye);
  if (mood === 'happy') d.line(M(T, [[0.16, 0.3], [0.3, 0.42], [0.44, 0.3]]), { w: 2.4, role: ROLES.flameEye });
  else if (mood === 'sad') d.line(M(T, [[0.16, 0.46], [0.3, 0.36], [0.44, 0.46]]), { w: 2.4, role: ROLES.flameEye });
  else dot(d, ...T(0.3, 0.38), s * 0.1, ROLES.flameEye);
  const sw = run == null ? 0 : Math.sin(run) * 0.5;
  d.lines((run == null ? [[[-0.25, 0.9], [-0.25, 1.3]], [[0.25, 0.9], [0.25, 1.3]]] : [[[-0.2, 0.9], [-0.2 + sw, 1.32]], [[0.2, 0.9], [0.2 - sw, 1.32]]]).map((p) => M(T, p)), { w: 3, role: ROLES.flameLine });
  return d;
}

// A small bird (v1 held-once).
export function bird(d, x, y, s, o = {}) {
  const { dir = 1, rot = 0, role = 'fills.1' } = o, T = tf(x, y, s, rot, dir);
  const B = [[-0.9, -0.2], [-0.3, -0.8], [0.5, -0.75], [0.85, -0.35], [0.5, 0.1], [-0.4, 0.1]];
  d.fill(blob(M(T, B))).wash(blob(M(T, B)), role, { al: 0.7, off: 2 }).line(M(T, B), { close: true, w: 3 })
    .line(M(T, [[0.85, -0.42], [1.2, -0.32], [0.85, -0.22]]), { w: 2.6 }).line(M(T, [[-0.5, -0.35], [-0.1, -0.05], [0.25, -0.4]]), { w: 2.6 });
  dot(d, ...T(0.5, -0.48), s * 0.09);
  d.lines([[[-0.1, 0.1], [-0.1, 0.4]], [[0.2, 0.1], [0.2, 0.4]]].map((p) => M(T, p)), { w: 2.4, dur: 0.04 });
  return d;
}

// The hedgehog as an actor: states are hog's own options (dir, eye, run phase), put() is hog itself.
export const HOG = actorOf(hog, {
  name: 'hedgehog', size: 60, box: [-110, -100, 220, 156], inputs: { dir: [-1, 1, 2], fright: [0, 1, 0.25] }, mouthAt: [1.02, 0.14],
  defaults: { eye: 'happy', scarf: 'accents.0', w: 4.2 }, desc: 'the doodle hedgehog with a scarf; eye dot | happy | sleep | wide',
});

// The recipe's actor: actor, or who (a v1 builder) wrapped once, or HOG.
const wrapped = new WeakMap();
const actorFor = (o) => {
  if (o.actor) return o.actor;
  if (!o.who || o.who === hog) return HOG;
  if (!wrapped.has(o.who)) wrapped.set(o.who, actorOf(o.who));
  return wrapped.get(o.who);
};

let fox = null;
// The doodle characters by name. FOX is the store's puppet as an actor, built the first time it is asked
// for, and only once the film has read it (fromStore(['fox'])); undefined before that. It stands 2.6 s tall:
// narrower than the hedgehog, so a little taller to weigh the same on the stage.
export const CAST = Object.freeze({
  hog, spark, bird, HOG,
  get FOX() { return fox ?? (stored().includes('fox') ? (fox = actorOf(puppet('fox'), { height: 2.6 })) : undefined); },
});

// ---------- props (v1 held-once / night-shift) ----------

function sun(d, x, y, r, role = 'fills.2') {
  d.wash(circle(x, y, r, 32), role, { al: 0.85, off: 3 }).line(ellPts(x, y, r, r), { close: true, w: 3.2 });
  d.lines(Array.from({ length: 9 }, (_, k) => { const a = k / 9 * TAU + 0.2; return [[x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35], [x + Math.cos(a) * r * 1.8, y + Math.sin(a) * r * 1.8]]; }), { w: 3, dur: 0.05, stagger: 0.03, role: 'accents.2' });
  return d;
}
function cloud(d, x, y, s, role = 'light') {
  const K = [[-1, 0.3], [-0.8, -0.15], [-0.35, -0.2], [-0.1, -0.6], [0.4, -0.55], [0.6, -0.15], [1, -0.05], [1.05, 0.3]].map((p) => [x + p[0] * s, y + p[1] * s]);
  d.fill(blob(K), role, { al: 0.9 }).line(K, { close: true, w: 3 });
  return d;
}
const heartPts = (x, y, s) => Array.from({ length: 18 }, (_, k) => { const a = k / 18 * TAU; return [x + s * Math.pow(Math.sin(a), 3), y - s * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16]; });
function heart(d, x, y, s, role = 'accents.0') { const p = heartPts(x, y, s); d.wash(poly(p), role, { al: 0.9, off: 2 }).line(p, { close: true, w: 3 }); return d; }
function sparkle(d, x, y, s, role = 'ink') {
  d.lines([[[x - s, y], [x + s, y]], [[x, y - s], [x, y + s]], [[x - s * 0.5, y - s * 0.5], [x + s * 0.5, y + s * 0.5]], [[x + s * 0.5, y - s * 0.5], [x - s * 0.5, y + s * 0.5]]], { w: 2.4, dur: 0.04, stagger: 0.02, role });
  return d;
}
const stars = (d, list) => list.forEach(([x, y, s]) => sparkle(d, x, y, s, ROLES.star));
function musicNote(d, x, y, s, role = 'ink') {
  d.mark((k) => fill(xf(ellipse(0, 0, Math.max(0.2, s * 0.42 * k), Math.max(0.2, s * 0.3 * k), 16), mmul(translate(x, y), rotate(-0.4))), role), 0.05)
    .line([[x + s * 0.36, y - s * 0.1], [x + s * 0.4, y - s * 1.3], [x + s * 0.9, y - s * 0.95]], { w: 2.8, role });
  return d;
}
const ground = (d, y, x0 = -900, x1 = 1980) => d.line([[x0, y + 3], [lerp(x0, x1, 0.3), y - 2], [lerp(x0, x1, 0.65), y + 4], [x1, y]], { w: 3.6 });
function trestle(d, x, top, gy, w = 70) {
  d.lines([[[x, top], [x - w, gy]], [[x, top], [x + w, gy]], [[x - w * 0.55, lerp(top, gy, 0.6)], [x + w * 0.55, lerp(top, gy, 0.6)]]], { w: 3.4 });
}

// Crumbs of light behind a runner: where path(t) was a moment ago (v1 trail).
function trail(path, tau, { n = 9, step = 0.07 } = {}) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const p = path(tau - k * step);
    if (!p) continue;
    const r = rng(k * 7 + Math.floor(tau * 12));
    out.push(fill(circle(p[0] + (r() - 0.5) * 16, p[1] + (r() - 0.5) * 16 + k * 2, 4.5 * (1 - k / (n + 2)) + 1, 12), k % 2 ? 'fills.2' : { base: 'fills.2', tint: 0.6 }, { alpha: 1 - k / (n + 1), name: `c${k}` }));
  }
  return group('trail', out);
}

// ---------- the frame ----------

const need = (ph, who) => { if (!ph || !ph.w || !ph.h || !ph.name) throw new TypeError(`${who}: needs photo: a cutout { name, w, h, src, sil } (see hdf photo)`); return ph; };
const lookFor = (o, sheet) => { const base = o.look ?? LOOKS.doodlePastel, p = o.paper === undefined ? sheet : o.paper; return p ? pastel(base, p) : base; };

// The recipe's own clock (tau runs over the design length D0 whatever dur is) and a pen bound to it.
function clock(c, D0, seed = 0) {
  const tau = c.t * D0 / c.T, i = c.i;
  return { tau, i, P: (start, sd, build, o) => pen(tau, i, start, sd + seed, build, o) };
}
const NOW = { start: -9 };
// The photo height that makes its long side in the frame (after rot) `long` units: the default size for
// objects that lie along the frame (vehicles, bridges, tubes).
const fitH = (ph, rot, long) => { const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), ar = ph.w / ph.h; return long / Math.max(c * ar + s, s * ar + c); };   // a doodle that is already on the paper

// backdrop, the anchor, then the 1080 stage centred in the frame; night (nightShot) and a camera inside it.
// view: { x, y, zoom } in stage units.
// crop: the subject may leave the frame on purpose (a following camera, an object rising from below).
function frameOf(c, { anchor, kids, k = 0, lights = [], view = null, crop = false }) {
  const { W, H, CX, CY } = c, [stock, ...light] = backdrop({ W, H });
  let inner = kids;
  if (k > 0) inner = [fx('nightShot', { k, lights: lights.filter((l) => l && l.r > 0) }, inner)];
  if (view) inner = [cam({ ...view, W: 1080, H: 1080 }, inner)];
  return [stock, ...light, meta('anchor', anchor), crop && meta('intent', 'crop'), group({ name: 'stage', xf: translate(CX - 540, CY - 540), cache: 'never' }, inner)];
}
const photoAnchor = (ph) => ({ name: `photo:${ph.name}` });

// The camera leans towards the action (v1 follow); whip on for motion-matched cuts.
function follow(p, t, T, { zoom = 1.16, kx = 0.35, ky = 0.22, dy = 0, whip: w = false, inn, out, dist } = {}) {
  return { x: 540 + (p[0] - 540) * kx + (w ? whip(t, T, { inn, out, dist }) : 0), y: 540 + (p[1] - 540) * ky + dy, zoom };
}

// ======================================================================================================
// AA. The object becomes a vehicle. It floats (shadow 0), drifts and bobs; mast, sail and a sailor are
// attached to the photo so they bob with it; the sea is drawn over the hull, foam along the waterline;
// gag: a far lighthouse lights up and one word.
// ======================================================================================================
export function becomesVehicle(o = {}) {
  const {
    name = 'becomesVehicle', dur = 3.5, photo: ph, x = 610, y = 640, h: h0, rot = 0, drift = 16, bob = 7,
    mastAt = 0.62, mast = 1.9, flag = 'accents.0', sailor = true, word = 'almost', lighthouse = true, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const h = h0 ?? fitH(ph, rot, 820);
  const D0 = 3.5, anchor = photoAnchor(ph);
  return shot(name, dur, (c) => {
    const { tau, P } = clock(c, D0, seed);
    const pl0 = pin(ph, { x, y, h, rot }), sil = silhouette(pl0), [bx, by, bw, bh] = sil.box;
    const pl = pin(ph, { x: x - tau * drift, y: y + Math.sin(tau * 2.2) * bob, h, rot: rot + Math.sin(tau * 2.2 + 1) * 0.018 }), at = attach(pl0, pl);
    const y0 = by + bh * 0.84;                                              // the waterline stays put
    const mx = bx + bw * mastAt, my = topAt(sil, mx) + 4, mL = Math.min(bh * mast, my - 70), SW = mL * 0.34;
    const S = (a, f) => at([mx + a * SW, my - f * mL]), foot = at([mx, my]), top = S(0, 1);
    const sailPts = [[-0.04, 0.93], [-0.45, 0.9], [-0.84, 0.84], [-1, 0.57], [-0.89, 0.29], [-0.45, 0.25], [-0.04, 0.22], [0, 0.57]].map(([a, f]) => S(a, f));
    const sx = bx + bw * 0.86, s = 58, seat = at([sx, topAt(sil, sx) - s * 0.8]);
    const kids = [];
    kids.push(P(0.3, 21, (d) => { cloud(d, 900, 150, 62); cloud(d, 210, 110, 44); }));
    if (lighthouse) {
      kids.push(P(1.6, 23, (d) => d.line([[40, y0], [84, y0 - 62], [136, y0]], { w: 3.2 }).line([[86, y0 - 62], [86, y0 - 112]], { w: 3.2 }), { still: true }));
      if (tau > 2.0) kids.push(glow(86, y0 - 118, 70 * sm(2.0, 2.3, tau), { role: ROLES.warm }), fill(circle(86, y0 - 118, 6, 16), ROLES.flame, { name: 'lamp' }));
    }
    kids.push(P(0.35, 4, (d) => d.line([foot, top], { w: 4.6 }), { still: true }));   // the mast foot goes behind the hull
    kids.push(photo(pl, { shadow: 0 }));
    kids.push(P(0.6, 4, (d) => {
      d.fill(blob(sailPts), 'light').line(sailPts, { close: true, w: 3.8 });
      for (let k = 0; k < 5; k++) { const f = 0.72 - k * 0.045; d.line([S(-0.11, f), S(-0.45, f - 0.01), S(-0.77, f)], { w: 1.8, dur: 0.05, role: 'shade' }); }
      [[0.584, -0.23], [0.63, -0.39], [0.538, -0.55], [0.675, -0.66], [0.416, -0.36], [0.376, -0.59]].forEach(([f, a]) => musicNote(d, ...S(a, f), 15));
      if (flag) { const fl = [top, at([mx - SW * 0.34, my - mL + SW * 0.2]), at([mx, my - mL + SW * 0.39])]; d.wash(poly(fl), flag, { al: 0.95, off: 1 }).line(fl, { close: true, w: 2.8 }); }
    }));
    if (sailor) {
      const oarA = [seat[0] + 22, seat[1] + s * 0.3], oarB = [seat[0] + 210, y0 + 70];
      kids.push(P(1.0, 6, (d) => { A.put(d, seat[0], seat[1], s, { ...A.idle(tau, 1), ...A.look(-1), ...A.emote(tau > 2.4 ? 'happy' : 'dot'), rot: pl.rot - rot, hand: oarA }); d.line([oarA, oarB], { w: 3.6, role: ROLES.wood }); }));
    }
    // the sea, over the hull
    const topPts = Array.from({ length: 41 }, (_, k) => [-600 + k * 60, y0 + Math.sin(k * 1.3 + tau * 3) * 7]);
    const sea = poly([...smooth(topPts), [1680, 1600], [-600, 1600]]);
    kids.push(P(0.15, 12, (d) => {
      d.fill(sea, { base: 'paper', tint: 0.35 }, { al: 0.9, dur: 0.4 }).wash(sea, 'fills.1', { al: 0.42, off: 0, rim: false, dur: 0.4 });
      [[y0 + 92, 0.13], [y0 + 192, 0.15]].forEach(([yy, al], k) => d.wash(poly([...smooth(Array.from({ length: 20 }, (_, j) => [j * 125 - 620, yy + Math.sin(j * 1.7 + k * 2) * 14]), 10), [1700, 1600], [-620, 1600]]), 'fills.1', { al, off: 6, rim: false, seed: 60 + k, dur: 0.5 }));
      d.line(topPts, { w: 3.6, role: 'accents.1' });
      for (let r = 0; r < 4; r++) for (let k = -3; k < 9; k++) {
        const wx = -60 + k * 215 + (r % 2) * 100 - ((tau * 30) % 215) * (r % 2 ? 1 : 0.5), wy = y0 + 77 + r * 66;
        d.line([[wx, wy], [wx + 28, wy - 16], [wx + 56, wy], [wx + 84, wy - 12]], { w: 2.8, role: 'accents.1', dur: 0.04 });
      }
    }, { speed: 2800, still: true }));
    kids.push(P(0.7, 14, (d) => {
      for (let k = 0; k < 19; k++) {
        const fx0 = at([bx + bw * (0.02 + k * 0.96 / 18), y0])[0], r = 13 + (k * 7 % 3) * 4, yy = y0 + 6 + Math.sin(k * 2.1 + tau * 4) * 3;
        d.fill(circle(fx0, yy, r, 16), 'light', { al: 0.97 });
        if (k % 2) d.line([[fx0 - r * 0.7, yy - r * 0.5], [fx0, yy - r], [fx0 + r * 0.7, yy - r * 0.5]], { w: 2.2, role: 'accents.1', dur: 0.03 });
      }
    }, { still: true }));
    if (word) kids.push(P(2.3, 15, (d) => d.text(word, 170, 470, { size: 66, w: 4.6 })));
    return frameOf(c, { anchor, kids });
  }, { recipe: 'AA', camera: 'static', look: lookFor(o, 'sky') });
}

// ======================================================================================================
// AB. Someone lives inside. The cast is drawn after the photo, then photoFront lays the front wall back over
// them below the lip; they rise into view (y + (1 - up) * 70). Gag: steam turns into a heart, they nod.
// ======================================================================================================
export function livesInside(o = {}) {
  const {
    name = 'livesInside', dur = 3.5, photo: ph, x = 540, ground: gy = 902, h = 520, pivot = [0.5, 1], lip = [0.04, 0.96],
    lipDrop = 0.06, at = [0.3, 0.68], size = 70, scarves = ['accents.0', 'accents.1'], word = 'for two',
    perch = 0.93, withBird = true, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 3.5, anchor = photoAnchor(ph);
  return shot(name, dur, (c) => {
    const { tau, P } = clock(c, D0, seed);
    const pl = pin(ph, { x, y: gy, h, pivot });
    const kids = [P(0.2, 1, (d) => ground(d, gy), { speed: 2800, still: true }), photo(pl)];
    kids.push(P(0.4, 51, (d) => { sun(d, 150, 170, 48); cloud(d, 850, 140, 58); }));
    const up = ease.out(sm(0.5, 1.0, tau, ease.linear)), nod = Math.sin(tau * 5) * 0.05 * sm(2.2, 2.6, tau);
    const spots = at.map((u) => rim(pl, 'top', u));
    spots.forEach((p, k) => kids.push(P(0.5 + k * 0.3, 9 + k, (d) => A.put(d, p[0], p[1] + 70 - up * 70, size, { ...A.idle(tau, k), ...A.look(k % 2 ? -1 : 1), ...A.emote('happy'), scarf: scarves[k % scarves.length], rot: k % 2 ? -nod : nod }))));
    const lipPts = Array.from({ length: 9 }, (_, k) => { const p = rim(pl, 'top', lerp(lip[0], lip[1], k / 8)); return [p[0], p[1] + lipDrop * pl.h]; });
    const L = smooth(lipPts, 6);
    kids.push(photoFront(pl, poly([...L, [1700, L[L.length - 1][1]], [1700, 1600], [-620, 1600], [-620, L[0][1]]])));
    const mx = spots.reduce((a, p) => a + p[0], 0) / spots.length, my = Math.min(...spots.map((p) => p[1])) - 0.2 * pl.h;
    kids.push(P(1.9, 23, (d) => { d.lines([[[mx - 16, my], [mx - 30, my - 36], [mx - 8, my - 72], [mx - 22, my - 108]], [[mx + 16, my], [mx + 30, my - 36], [mx + 8, my - 72], [mx + 22, my - 108]]], { w: 3 }); heart(d, mx, my - 170, 42); }));
    if (withBird) { const b = rim(pl, 'top', perch); kids.push(P(1.4, 27, (d) => bird(d, b[0], b[1] - 12, 30, { dir: -1 }))); }
    if (word) kids.push(P(2.5, 29, (d) => d.text(word, 690, 300, { size: 76, w: 5.3 })));
    kids.push(P(1.2, 33, (d) => [[110, 0], [200, 1], [935, 0], [1010, 1]].forEach(([fx0, k]) => {
      d.line([[fx0, gy], [fx0 + 4, gy - 30], [fx0 - 2, gy - 58]], { w: 2.8, role: 'accents.3' });
      d.wash(circle(fx0 - 2, gy - 68, 14, 16), k ? 'fills.0' : 'fills.2', { al: 0.95, off: 2 }).line(ellPts(fx0 - 2, gy - 68, 13, 13, 8), { close: true, w: 2.6 });
    })));
    return frameOf(c, { anchor, kids });
  }, { recipe: 'AB', camera: 'static', look: lookFor(o, 'peach') });
}

// ======================================================================================================
// AC. The object does its job, at last: it tips over its base (pivot, rot) and pours from its spout into
// drawn cups; a bird on a string does the lifting; steam and a heart, one character waits. Gag: the pour.
// ======================================================================================================
export function doesItsJob(o = {}) {
  const {
    name = 'doesItsJob', dur = 3.5, photo: ph, x = 690, ground: gy = 706, h = 320, pivot = [0.4, 1], spout = [0.02, 0.28],
    handle = [0.86, 0.1], tip, cups = 2, word = 'for two', stream = ROLES.tea, actor, who, seed = 0, say = null,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 3.5, anchor = photoAnchor(ph), side = spout[0] < 0.5 ? -1 : 1, tipTo = tip ?? 0.36 * side;
  return shot(name, dur, (c) => {
    const { tau, i, P } = clock(c, D0, seed);
    const k = sm(2.0, 2.5, tau), pl = pin(ph, { x, y: gy, h, pivot, rot: tipTo * k + (tau > 2.5 ? Math.sin(tau * 9) * 0.006 : 0) });
    const cupA = on(pin(ph, { x, y: gy, h, pivot, rot: tipTo }), ...spout)[0] + 12 * side, cupX = (n) => cupA + side * 125 * n;
    const hx = side < 0 ? 88 : 992;
    const kids = [P(0.2, 1, (d) => ground(d, gy, 60, 1020), { speed: 2800, still: true }), photo(pl, { ground: gy })];
    kids.push(P(0.4, 40, (d) => { sun(d, side < 0 ? 930 : 150, 150, 48); cloud(d, 560, 130, 60); cloud(d, side < 0 ? 330 : 750, 215, 40); }));
    kids.push(P(0.5, 3, (d) => { for (let n = 0; n < cups; n++) teacup(d, cupX(n), gy - 42, 42, n % 2 ? 'fills.0' : 'fills.1'); }));
    const pose = { ...A.idle(tau), ...A.look(-side), ...A.emote(tau > 2.6 ? 'happy' : 'dot'), ...say?.state(c.t), w: 4.2 };
    kids.push(P(0.9, 5, (d) => A.put(d, hx, gy - 62, 54, pose)));
    if (say) kids.push(say.draw(c.t, hx, gy - 62, 54, pose));
    if (handle) {
      const h0 = on(pl, ...handle), flap = Math.sin(i * 2.4) * 10, by = h0[1] - 170 - k * 10;
      kids.push(P(1.3, 7, (d) => {
        bird(d, h0[0] + 8, by, 34, { dir: -1 });
        d.line([[h0[0] + 6, by + 14], [h0[0] - 4, (by + h0[1]) / 2], h0], { w: 2.4 });
        d.lines([[[h0[0] - 6, by - 26], [h0[0] - 22, by - 52 - flap]], [[h0[0] + 22, by - 28], [h0[0] + 40, by - 52 - flap]]], { w: 3 });
      }));
    }
    if (tau > 2.4) { const s0 = on(pl, ...spout); kids.push(P(2.4, 9, (d) => d.line([s0, [s0[0] + 10 * side, s0[1] + 50], [cupA, gy - 66]], { w: 6, role: stream, dur: 0.2 }), { still: true })); }
    kids.push(P(2.7, 11, (d) => {
      d.lines([[[cupA - 12, gy - 106], [cupA - 24, gy - 134], [cupA - 6, gy - 160], [cupA - 18, gy - 188]], [[cupA + 16, gy - 106], [cupA + 28, gy - 134], [cupA + 12, gy - 158], [cupA + 24, gy - 186]]], { w: 2.8 });
      if (cups > 1) heart(d, cupX(1), gy - 131, 26);
    }));
    if (word) kids.push(P(2.8, 13, (d) => d.text(word, side < 0 ? 70 : 640, 400, { size: 80, w: 5.6 })));
    return frameOf(c, { anchor, kids });
  }, { recipe: 'AC', camera: 'static', look: lookFor(o, 'rose') });
}
function teacup(d, x, y, s, role) {
  const B = [[-1, -0.6], [1, -0.6], [0.75, 0.25], [0.4, 0.6], [-0.4, 0.6], [-0.75, 0.25]].map((p) => [x + p[0] * s, y + p[1] * s]);
  d.fill(poly(B)).wash(poly(B), role, { al: 0.55, off: 3 }).line([B[0], B[5], B[4], B[3], B[2], B[1]], { w: 3.2 })
    .line(ellPts(x, y - 0.6 * s, s, s * 0.16, 10), { close: true, w: 2.8 })
    .line([[x + 0.85 * s, y - 0.3 * s], [x + 1.4 * s, y - 0.25 * s], [x + 1.3 * s, y + 0.2 * s], [x + 0.7 * s, y + 0.3 * s]], { w: 3 });
  return d;
}

// ======================================================================================================
// AD. Time passes on it. A drawn hand sweeps the real dial from its hub (angle from tau), a drawn sun crosses
// the sky with it, the character on top falls asleep at the end.
// ======================================================================================================
export function timeOnIt(o = {}) {
  const {
    name = 'timeOnIt', dur = 3.5, photo: ph, x = 540, y = 625, h = 610, hub = [0.5, 0.5], hand = 0.36, turns = 1,
    words = ['tick', 'soon?', 'z'], actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 3.5, anchor = photoAnchor(ph), [wTick, wAsk, wZ] = words ?? [];
  return shot(name, dur, (c) => {
    const { tau, P } = clock(c, D0, seed);
    const day = sm(0.9, 3.0, tau, ease.linear), pl = pin(ph, { x, y, h });
    const kids = [P(0.2, 8, (d) => {
      d.line([[40, 810], [200, 752], [390, 800]], { w: 3.4 }).line([[700, 800], [880, 745], [1045, 810]], { w: 3.4 });
      d.line([[760, 1020], [850, 940], [800, 870], [900, 800]], { w: 2.6, role: 'shade' }).line([[806, 1020], [900, 945], [850, 875], [934, 808]], { w: 2.6, role: 'shade' });
      d.lines([[[934, 808], [934, 735]], [[934, 738], [992, 750], [934, 768]]], { w: 3.2 });
    }, { speed: 2400, still: true })];
    const sa = lerp(-2.6, -0.35, day);
    kids.push(P(0.5, 9, (d) => sun(d, 540 + Math.cos(sa) * 470, 800 + Math.sin(sa) * 620, 42, day > 0.8 ? 'fills.4' : 'fills.2'), { still: true }));
    kids.push(photo(pl));
    const top = rim(pl, 'top', 0.5), sleepy = tau > 2.75;
    kids.push(P(0.45, 5, (d) => A.put(d, top[0] - 8, top[1] - 42 + (sleepy ? 5 : 0), 60, { ...A.idle(tau), ...A.look(1), ...A.emote(sleepy ? 'sleep' : 'dot'), rot: sleepy ? 0.17 : 0, w: 4.2 })));
    const c0 = on(pl, ...hub), ha = -Math.PI / 2 + day * TAU * turns, R = pl.w * hand;
    if (tau > 0.95) {
      kids.push(stroke(poly([c0, [c0[0] + Math.cos(ha) * R, c0[1] + Math.sin(ha) * R]], false), 'accents.0', { tool: 'brush', w: 7, seed: 2, p: sm(0.95, 1.1, tau), amp: 0.5, name: 'hand' }));
      kids.push(fill(circle(c0[0], c0[1], 10, 16), 'accents.0', { name: 'hub' }));
    }
    kids.push(P(1.2, 15, (d) => d.lines([[[270, 570], [247, 620], [270, 670]], [[235, 550], [205, 620], [235, 690]], [[810, 570], [833, 620], [810, 670]], [[845, 550], [875, 620], [845, 690]]], { w: 3.2, stagger: 0.08 })));
    if (wTick) kids.push(P(1.5, 17, (d) => d.text(wTick, 120, 480, { size: 56, w: 3.9 }).text(wTick, 850, 490, { size: 56, w: 3.9 })));
    if (wAsk) kids.push(P(2.1, 19, (d) => d.text(wAsk, 730, 340, { size: 76, w: 5.3 })));
    if (sleepy && wZ) kids.push(P(2.8, 21, (d) => d.text(wZ, top[0] - 130, top[1] - 120, { size: 48, w: 3.4 }).text(wZ, top[0] - 175, top[1] - 170, { size: 62, w: 4.3 })));
    return frameOf(c, { anchor, kids });
  }, { recipe: 'AD', camera: 'static', look: lookFor(o, 'mint') });
}

// ======================================================================================================
// AE. Night falls. The sheet goes to night (nightShot k rises), a match lights the flame (a light), stars and
// a moon arrive in chalk, then a second character walks in already drawn. Gag: a heart and two words.
// ======================================================================================================
export function nightFalls(o = {}) {
  const {
    name = 'nightFalls', dur = 4.25, photo: ph, x = 290, ground: gy = 912, h = 740, pivot = [0.5, 1], flame = [0.52, 0.62],
    match = [1.0, 0.74], k: night = 0.86, friend = 'accents.1', word = 'you came', moon = true, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 4.25, anchor = photoAnchor(ph);
  return shot(name, dur, (c) => {
    const { tau, i, P } = clock(c, D0, seed);
    const pl = pin(ph, { x, y: gy, h, pivot }), F = on(pl, ...flame), lit = sm(1.0, 1.25, tau), fk = 1 + Math.sin(i * 1.9) * 0.06;
    const m = on(pl, ...match), holding = tau < 1.5, hand = [m[0] + 60, m[1] + 40];
    const kids = [P(0.1, 1, (d) => ground(d, gy, 440), { speed: 2800, still: true }), photo(pl)];
    kids.push(P(1.3, 31, (d) => {
      stars(d, [[620, 150, 13], [480, 90, 9], [760, 300, 9], [1000, 330, 10], [980, 90, 12], [90, 120, 10], [560, 330, 8]]);
      if (moon) { const mo = [[835, 120], [800, 160], [812, 220], [860, 252], [915, 240], [868, 222], [842, 175]]; d.wash(blob(mo), ROLES.star, { al: 0.95, off: 0 }).line(mo, { close: true, w: 3.2 }); }
    }));
    const turned = tau > 2.0;
    kids.push(P(0.15, 7, (d) => { A.put(d, 620, gy - 74, 68, { ...A.idle(tau), ...A.look(turned ? 1 : -1), ...A.emote(tau > 3.0 ? 'happy' : 'dot'), hand: holding ? hand : null, w: 4.2 }); if (holding) d.line([hand, m], { w: 2.8, role: ROLES.wood }); }));
    const walk = sm(1.8, 3.1, tau, ease.out), fx0 = lerp(1220, 900, walk), step = walk < 1 ? Math.abs(Math.sin(tau * 11)) * 8 : 0;
    kids.push(P(-9, 17, (d) => A.put(d, fx0, gy - 74 - step, 68, { ...(walk < 1 ? A.cycle('walk', tau) : A.idle(tau, 2)), ...A.look(-1), ...A.emote(walk >= 1 ? 'happy' : 'dot'), scarf: friend, rot: walk < 1 ? Math.sin(tau * 11) * 0.05 : 0, w: 4.2 })));
    kids.push(P(1.9, 19, (d) => { for (let n = 0; n < 7; n++) dot(d, 1060 - n * 30, gy + 43 + Math.sin(n) * 7, 3.6, 'chalkDim'); }, { still: true }));
    kids.push(P(3.2, 23, (d) => heart(d, 760, 700 - sm(3.2, 4.2, tau, ease.linear) * 34, 32, { base: 'accents.0', tint: 0.3 })));
    if (word) kids.push(P(3.3, 25, (d) => d.text(word, 560, 560, { size: 76, w: 5.3 })));
    const lights = [
      { x: F[0], y: F[1], r: 560 * lit * fk, glow: 0.5 },
      holding && tau > 0.85 && { x: m[0], y: m[1], r: 150 * sm(0.85, 1, tau), glow: 0.8, role: 'accents.2' },
    ];
    return frameOf(c, { anchor, kids, k: night * sm(0.1, 0.9, tau), lights });
  }, { recipe: 'AE', camera: 'static', look: lookFor(o, 'lilac') });
}

// A shot's last frame as a print for printsOnALine (AF): (ctx) => list.
export const lastFrame = (node) => {
  if (!node || node.kind !== 'shot') throw new TypeError('lastFrame: expected a shot');
  return (c) => node.draw({ ...c, t: (node.n - 1) / FPS, k: node.n - 1, T: node.dur });
};

const STAGE = { W: 1080, H: 1080, CX: 540, CY: 540 };
// A shot's list made fit to hang inside a print: stock becomes a plain sheet, anchors and sign-off metas go.
function printable(list, sheet) {
  const walkList = (ops) => ops.flat(Infinity).filter(Boolean).flatMap((op) => {
    if (op.op === 'paper') return [fill(rect(-2, -2, 1084, 1084), sheet, { name: 'sheet' })];
    if (op.op === 'night') return [fill(rect(-2, -2, 1084, 1084), 'night', { name: 'sheet' })];
    if (op.op === 'meta') return [];
    if (!op.kids) return [op];
    const props = { kids: walkList(op.kids) };
    if (op.op === 'group' && typeof op.name === 'string' && (op.name.startsWith('text:') || op.name === 'signOff')) props.name = `print:${op.name}`;
    return [withProps(op, props)];
  });
  return walkList([list]);
}

// ======================================================================================================
// AF. Prints on a line: the last frame of every scene hung as small prints on a drawn string, then the
// sign-off and the cast. prints: [list | (ctx) => list | { list | draw, look }]; lastFrame(shot) makes one.
// A print with its own look is wrapped in a look op marked inset (a thumbnail, so lint's one-look rule
// passes it), otherwise it is drawn in this shot's look on a lighter sheet. Words inside prints are thumbnails, not this shot's words: their text groups are
// renamed 'print:' so lint does not count them.
// ======================================================================================================
export function printsOnALine(o = {}) {
  const {
    name = 'printsOnALine', dur = 4.5, prints = [], a = 'the end', b = 'for now', size = 66,
    scarves = ['accents.0', 'accents.1'], cast = true, sheet = { base: 'paper', tint: 0.4 }, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  const D0 = 4.5, n = prints.length, ps = n ? Math.min(168, 940 / n - 32) : 168, gapX = ps + 32, step = n ? Math.min(0.22, 1.1 / n) : 0.22;
  return shot(name, dur, (c) => {
    const { t, T } = c, { tau, P } = clock(c, D0, seed);
    const yAt = (px) => 330 + Math.sin((px - 40) / 1000 * Math.PI) * 46;
    const kids = [P(0.1, 2, (d) => d.line(Array.from({ length: 9 }, (_, k) => [40 + k * 125, yAt(40 + k * 125)]), { w: 3 }), { speed: 2400 })];
    const hung = [];
    prints.forEach((e, k) => {
      const q = sm(0.4 + k * step, 0.62 + k * step, tau, ease.out);
      if (q <= 0) return;
      const px = 540 + (k - (n - 1) / 2) * gapX, py = yAt(px) + 110, r = (rng(k + 3)() - 0.5) * 0.16 + Math.sin(tau * 2 + k) * 0.012;
      const make = typeof e === 'function' ? e : e && !Array.isArray(e) && !e.op ? (e.draw ?? (() => e.list)) : () => e;
      let body = printable(make({ ...c, ...STAGE }), sheet);
      if (e && e.look) body = [withProps(lookNode(e.look, body), { inset: true })];
      const m = mmul(mmul(translate(px, py - 100), rotate(r)), translate(0, 100 - (1 - q) * 40));
      hung.push(group({ name: `print${k}`, xf: m, cache: 'never' }, [
        fill(rect(-ps / 2 - 6, -ps / 2 - 4, ps + 20, ps + 44), { base: 'ink', alpha: 0.18 }, { name: 'shade' }),
        fill(rect(-ps / 2 - 10, -ps / 2 - 10, ps + 20, ps + 44), ROLES.white, { name: 'card' }),
        clip(rect(-ps / 2, -ps / 2, ps, ps), [group({ name: 'shot', xf: mmul(translate(-ps / 2, -ps / 2), scale(ps / 1080)) }, body)]),
        fill(rect(-7, -ps / 2 - 22, 14, 26), `accents.${k % 4}`, { name: 'peg' }),
      ]));
    });
    kids.push(group('prints', hung));
    // the sign-off is finished 1.6 s before the end whatever dur is (lint: sign-off)
    const done = T - 1.6;
    kids.push(signOff(a, b, { x: 540, y: 720, size, pA: ramp(done - 1.35, done - 0.7, t, ease.linear), pB: ramp(done - 0.65, done, t, ease.linear) }));
    if (cast) {
      kids.push(P(2.2, 4, (d) => A.put(d, 440, 955, 40, { ...A.idle(tau), ...A.look(1), ...A.emote('happy'), scarf: scarves[0] }), { speed: 2600 }));
      kids.push(P(2.4, 5, (d) => A.put(d, 640, 955, 40, { ...A.idle(tau, 1), ...A.look(-1), ...A.emote('happy'), scarf: scarves[1 % scarves.length] }), { speed: 2600 }));
      kids.push(P(2.8, 6, (d) => heart(d, 540, 915, 18)));
    }
    return frameOf(c, { anchor: { name: hung.length ? 'prints' : 'signOff' }, kids });
  }, { recipe: 'AF', camera: 'static', look: lookFor(o, 'sand') });
}

// ======================================================================================================
// AG. The light escapes. nightShot with one light on the runaway: a match lights it, it hops out of the lamp
// (hop), the pool goes with it and the lamp goes dark behind it; the keeper jumps and gives chase.
// ======================================================================================================
export function lightEscapes(o = {}) {
  const {
    name = 'lightEscapes', dur = 3.5, photo: ph, x = 560, ground: gy = 930, h = 700, pivot = [0.5, 1], flame = [0.52, 0.62],
    match = [-0.02, 0.74], land = 830, k: night = 0.88, runner = spark, word = 'hey!', title = null, whip: wh = false, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 3.5, anchor = photoAnchor(ph), HS = 70, HY = 62, SS = 34, SY = 45;
  return shot(name, dur, (c) => {
    const { t, T } = c, { tau, i, P } = clock(c, D0, seed);
    const pl = pin(ph, { x, y: gy, h, pivot }), F = on(pl, ...flame), lit = sm(0.85, 1.05, tau), m = on(pl, ...match);
    const path = (u) => (u < 1.95 ? F : u < 2.55 ? hop(F, [land, gy - SY], (u - 1.95) / 0.6, 300) : [land + (u - 2.55) * 480, gy - SY]), sp = path(tau);
    const hx = tau < 2.7 ? x - 325 : x - 325 + Math.pow(tau - 2.7, 1.4) * 700, hand = [m[0] - 46, m[1] + 40];
    const view = follow([lerp(440, sp[0], sm(1.9, 2.6, tau)), 640], t, T, { zoom: 1.08 + 0.1 * sm(0, 1.9, tau), kx: 0.5, whip: wh, inn: 0 });
    const kids = [P(-9, 1, (d) => ground(d, gy), { still: true }), photo(pl)];
    kids.push(P(1.0, 31, (d) => stars(d, [[150, 160, 12], [330, 90, 9], [880, 140, 13], [980, 330, 9], [760, 70, 8], [90, 420, 8]])));
    kids.push(P(0.05, 7, (d) => {
      A.put(d, hx, gy - HY, HS, { ...A.look(1), ...A.emote(tau > 2.0 ? 'wide' : 'dot'), ...(tau > 2.7 ? A.cycle('run', tau) : {}), hand: tau < 1.5 ? hand : null, fright: sm(2.0, 2.2, tau) * (1 - sm(2.6, 2.8, tau)) });
      if (tau < 1.5) d.line([hand, m], { w: 3, role: ROLES.wood });
    }, NOW));
    if (tau > 1.35) kids.push(P(-9, 9, (d) => runner(d, sp[0], sp[1], tau < 1.95 ? 24 : SS, { run: tau > 2.55 ? tau * 17 : null, mood: tau < 1.95 ? 'o' : 'happy', lean: tau > 2.55 ? 0.25 : 0 })));
    if (tau > 1.95) kids.push(trail(path, tau));
    if (title) kids.push(P(1.1, 41, (d) => d.text(title, 470, 250, { size: 92, w: 6.4, align: 'center' })));
    if (word && tau > 2.1) kids.push(P(2.1, 43, (d) => d.text(word, hx - 50, gy - 200, { size: 80, w: 5.6 })));
    const lights = [
      { x: m[0], y: m[1], r: 150 * sm(0.2, 0.4, tau) * (1 - sm(1.2, 1.5, tau)), role: 'accents.2' },
      { x: sp[0], y: sp[1], r: (tau < 1.95 ? 470 : 330) * lit * (1 + Math.sin(i * 1.9) * 0.05) },
    ];
    return frameOf(c, { anchor, kids, k: night, lights, view, crop: true });
  }, { recipe: 'AG', camera: 'follow', look: lookFor(o, 'lilac') });
}

// ======================================================================================================
// AH. Along the edge. Both runners take the photo's real top edge (its silhouette, whatever the rotation)
// with a delay between them, a note pops where each step lands, the camera follows the midpoint.
// ======================================================================================================
export function alongTheEdge(o = {}) {
  const {
    name = 'alongTheEdge', dur = 2.5, photo: ph, x = 540, y = 600, h: h0, rot = 0, delay = 0.45, notes = true, trestles = true,
    k: night = 0.88, runner = spark, whip: wh = false, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const h = h0 ?? fitH(ph, rot, 900);
  const D0 = 2.5, anchor = photoAnchor(ph), HS = 70, HY = 62, SS = 34, SY = 45, GY = 930;
  return shot(name, dur, (c) => {
    const { t, T } = c, { tau, P } = clock(c, D0, seed);
    const pl = pin(ph, { x, y, h, rot }), sil = silhouette(pl), [bx, , bw] = sil.box;
    const edge = (v) => { const ex = bx + bw * (0.04 + 0.92 * clamp01(v)); return [ex, topAt(sil, ex)]; };
    const runAt = (t0, t1, s) => (u) => {
      const v = (u - t0) / (t1 - t0);
      if (v < 0) { const e0 = edge(0); return hop([-80, 560], [e0[0], e0[1] - s], 1 + v * 4, 120); }
      if (v > 1) { const e1 = edge(1); return hop([e1[0], e1[1] - s], [1240, 640], (v - 1) * 3.2, 90); }
      const p = edge(v); return [p[0], p[1] - s];
    };
    const pa = runAt(0.15, 1.55, SY), pb = runAt(0.15 + delay, 1.55 + delay + 0.1, HY), sp = pa(tau), hp = pb(tau);
    const view = follow([(sp[0] + hp[0]) / 2, 520], t, T, { zoom: 1.2, kx: 0.45, whip: wh });
    const kids = [P(-9, 1, (d) => {
      ground(d, GY);
      if (trestles) [0.2, 0.8].forEach((f) => { const tx = bx + bw * f; trestle(d, tx, bottomAt(sil, tx) - 8, GY); });
    }, { still: true }), photo(pl, { shadow: 0 })];
    if (notes) [0.18, 0.36, 0.54, 0.72, 0.9].forEach((v, k) => {
      const t0 = 0.15 + v * 1.4;
      if (tau > t0) { const p = edge(v), up = (tau - t0) * 90; kids.push(P(t0, 50 + k, (d) => musicNote(d, p[0] - 10, p[1] - 110 - up, 24, k % 2 ? 'accents.0' : 'accents.1'))); }
    });
    kids.push(P(-9, 7, (d) => A.put(d, hp[0], hp[1], HS, { ...A.emote('dot'), ...A.cycle('run', tau) })));
    kids.push(P(-9, 9, (d) => runner(d, sp[0], sp[1], SS, { run: tau * 17, lean: 0.25 })), trail(pa, tau));
    kids.push(P(0.5, 41, (d) => stars(d, [[120, 170, 11], [420, 110, 9], [760, 190, 12], [960, 90, 9]])));
    return frameOf(c, { anchor, kids, k: night, lights: [{ x: sp[0], y: sp[1], r: 330 }], view, crop: true });
  }, { recipe: 'AH', camera: 'follow', look: lookFor(o, 'sky') });
}

// ======================================================================================================
// AI. Inside the tube. The runner hops into the mouth and disappears; only its light travels along the
// object (mouth to bell in photo units), then it bursts out of the far end with a recoil of the photo,
// rings, a big word and a zoom kick.
// ======================================================================================================
export function insideTheTube(o = {}) {
  const {
    name = 'insideTheTube', dur = 2, photo: ph, x = 540, y = 500, h: h0, rot = 0, mouth = [0.5, 0], bell = [0.5, 1],
    k: night = 0.88, runner = spark, word = 'toot!', trestles = true, whip: wh = false, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const h = h0 ?? fitH(ph, rot, 980);
  const D0 = 2, anchor = photoAnchor(ph), HS = 70, HY = 62, SS = 34, GY = 930;
  return shot(name, dur, (c) => {
    const { t, T } = c, { tau, i, P } = clock(c, D0, seed);
    const kick = tau > 1.0 ? Math.exp(-(tau - 1.0) * 7) : 0;
    const pl0 = pin(ph, { x, y, h, rot }), m0 = on(pl0, ...mouth), b0 = on(pl0, ...bell), el = Math.hypot(b0[0] - m0[0], b0[1] - m0[1]) || 1, e = [(b0[0] - m0[0]) / el, (b0[1] - m0[1]) / el];
    const pl = pin(ph, { x: x - e[0] * kick * 46, y: y - e[1] * kick * 46, h, rot: rot + kick * 0.03 * Math.sin(tau * 60) });
    const mo = on(pl, ...mouth), be = on(pl, ...bell), inside = tau > 0.3 && tau < 1.0;
    const path = (u) => (u < 0.3 ? hop([-80, 760], mo, u / 0.3, 220) : u < 1.0 ? on(pl, ...lin(mouth, bell, (u - 0.3) / 0.7)) : hop(be, [be[0] + e[0] * 900, be[1] + e[1] * 900 - 200], (u - 1.0) / 0.5, 70)), sp = path(tau);
    const view = follow([sp[0], 640], t, T, { zoom: 1.1 + kick * 0.08, kx: 0.3, ky: 0, whip: wh });
    const hx = tau < 1.15 ? lerp(-90, 130, sm(0.35, 0.9, tau, ease.out)) - kick * 60 : 130 + Math.pow(tau - 1.15, 1.2) * 1250;
    const sil = silhouette(pl0), [bx, , bw] = sil.box;
    const kids = [P(-9, 1, (d) => { ground(d, GY); if (trestles) [0.25, 0.75].forEach((f) => { const tx = bx + bw * f, top = bottomAt(sil, tx) - 8; if (top < GY - 60) trestle(d, tx, top, GY, 60); }); }, { still: true }), photo(pl, { shadow: 0 })];
    kids.push(P(-9, 7, (d) => A.put(d, hx, GY - HY, HS, { ...A.emote(tau > 0.9 && tau < 1.3 ? 'wide' : 'dot'), ...(tau > 1.15 || tau < 0.9 ? A.cycle('run', tau) : {}), rot: tau > 0.9 && tau < 1.15 ? -0.3 : 0, fright: kick })));
    if (!inside) kids.push(P(-9, 9, (d) => runner(d, sp[0], sp[1], SS, { lean: 0.3, mood: tau > 1 ? 'o' : 'happy' })), trail(path, tau, { n: 10, step: 0.04 }));
    if (tau > 1.0) {
      const a0 = Math.atan2(e[1], e[0]);
      kids.push(P(1.0, 21, (d) => d.lines([0, 1, 2].map((k) => Array.from({ length: 9 }, (_, j) => {
        const a = a0 - 1.0 + j * 0.25, r = 70 + k * 58 + (tau - 1) * 120;
        return [be[0] + e[0] * 10 + Math.cos(a) * r, be[1] + e[1] * 10 + Math.sin(a) * r];
      })), { w: 4, stagger: 0.04, speed: 3000 }), { still: true }));
      if (word) kids.push(P(1.02, 23, (d) => d.text(word, 560, 300, { size: 120, w: 8.4, align: 'center' }), { speed: 4000 }));
      [[880, 250], [960, 700], [800, 760]].forEach(([nx, ny], k) => kids.push(P(1.05 + k * 0.08, 25 + k, (d) => musicNote(d, nx + (tau - 1) * 60, ny - (tau - 1) * 50, 30, k % 2 ? 'accents.1' : 'accents.0'))));
    }
    return frameOf(c, { anchor, kids, k: night, lights: [{ x: sp[0], y: sp[1], r: inside ? 230 : 330 + kick * 300 }], view, crop: true });
  }, { recipe: 'AI', camera: 'follow', look: lookFor(o, 'butter') });
}

// ======================================================================================================
// AJ. The object looks back. Two small red lights behind its eye and jaw, a roar (shake, zigzags, the camera
// punches in), the follower's quills stand up and he jumps, then the runaway pops out laughing.
// ======================================================================================================
export function looksBack(o = {}) {
  const {
    name = 'looksBack', dur = 3, photo: ph, x = 680, ground: gy = 930, h = 760, pivot = [0.5, 1], flip = true,
    eye = [0.62, 0.275], jaw = [0.74, 0.44], crown = [0.4, 0], k: night = 0.9, runner = spark,
    roar: roarWord = 'rrrr', laugh = 'hee hee', whip: wh = false, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 3, anchor = photoAnchor(ph), HS = 70, HY = 62, SS = 34, SY = 45;
  return shot(name, dur, (c) => {
    const { t, T } = c, { tau, i, P } = clock(c, D0, seed);
    const roar = sm(1.15, 1.3, tau) * (1 - sm(1.75, 1.95, tau));
    const pl = pin(ph, { x: x + Math.sin(tau * 55) * 7 * roar, y: gy, h, pivot, flip, rot: -0.04 * roar });
    const E = on(pl, ...eye), J = on(pl, ...jaw), C = on(pl, ...crown), out = tau > 2.0;
    const path = (u) => (u < 2.0 ? J : u < 2.25 ? hop(C, [C[0] + 30, C[1] - 40], (u - 2.0) / 0.25, 110) : u < 2.6 ? hop([C[0] + 30, C[1] - 40], [1010, gy - SY], (u - 2.25) / 0.35, 40) : [1010 + (u - 2.6) * 600, gy - SY]), sp = path(tau);
    const hx = tau < 1.2 ? lerp(-90, 215, sm(0.2, 0.85, tau, ease.out)) : tau < 2.3 ? 215 - 95 * sm(1.2, 1.4, tau, ease.out) : 120 + Math.pow(tau - 2.3, 1.25) * 1500;
    const hy = gy - HY - (tau > 1.2 && tau < 1.6 ? Math.sin((tau - 1.2) / 0.4 * Math.PI) * 120 : 0);
    const view = follow([out ? sp[0] : 450, 560], t, T, { zoom: 1.08 + roar * 0.1, kx: 0.4, ky: 0, whip: wh });
    const fl = 1 + Math.sin(i * 2.1) * 0.12;
    const H = P(-9, 7, (d) => A.put(d, hx, hy, HS, { ...A.emote(tau > 0.85 && tau < 2.3 ? 'wide' : 'dot'), ...(tau < 0.85 || tau > 2.3 ? A.cycle('run', tau) : {}), fright: sm(1.15, 1.3, tau) * (1 - sm(2.0, 2.3, tau)) }));
    const kids = [P(-9, 1, (d) => ground(d, gy), { still: true })];
    if (tau > 2.3) kids.push(H);   // he runs round the back of it
    kids.push(photo(pl));
    if (tau <= 2.3) kids.push(H);
    if (roar > 0) {
      const side = flip ? -1 : 1;
      kids.push(P(1.15, 21, (d) => d.lines([-0.35, -0.12, 0.1, 0.32].map((a) => Array.from({ length: 7 }, (_, j) => {
        const r = 60 + j * 52, z = (j % 2 ? 1 : -1) * 16;
        return [J[0] + side * 210 + side * Math.cos(a) * r + Math.sin(a) * z, J[1] + 20 + Math.sin(a) * r * 1.4 + Math.cos(a) * z];
      })), { w: 5, stagger: 0.03, smooth: false, speed: 3500, role: 'accents.0' }), { still: true }));
      if (roarWord) kids.push(P(1.2, 23, (d) => d.text(roarWord, 70, 330, { size: 130, w: 9.1 }), { speed: 4000 }));
    }
    if (tau > 1.25 && tau < 2.2) kids.push(P(1.25, 25, (d) => { d.line([[hx + 44, hy - 230], [hx + 40, hy - 160]], { w: 7 }); dot(d, hx + 39, hy - 138, 6); }));
    if (out) {
      kids.push(P(-9, 9, (d) => runner(d, sp[0], sp[1], SS, { run: tau > 2.6 ? tau * 17 : null, lean: tau > 2.6 ? 0.25 : 0 })), trail(path, tau));
      if (laugh) kids.push(P(2.05, 27, (d) => d.text(laugh, 720, 110, { size: 64, w: 4.5 })));
    }
    kids.push(P(0.4, 41, (d) => stars(d, [[120, 130, 11], [330, 200, 8], [960, 170, 12]])));
    const on0 = sm(0.1, 0.5, tau);
    const lights = out ? [{ x: sp[0], y: sp[1], r: 330 }] : [
      { x: E[0], y: E[1], r: (70 + roar * 70) * fl * on0, role: 'accents.0', glow: 0.9 },
      { x: J[0], y: J[1], r: (120 + roar * 160) * fl * on0, role: { base: 'accents.0', mix: ['accents.2', 0.5] }, glow: 0.8 },
      { x: hx + 30, y: hy, r: 150, glow: 0, k: 0.55 },
    ];
    return frameOf(c, { anchor, kids, k: night, lights, view, crop: true });
  }, { recipe: 'AJ', camera: 'follow', look: lookFor(o, 'rose') });
}

// ======================================================================================================
// AK. Getaway. The photo itself gallops (x from tau, bounce from |sin|) with the rider on it, dust puffs and
// speed lines behind, the view travels with it and drawn milestones pass by; the follower rides a hobby horse.
// ======================================================================================================
export function getaway(o = {}) {
  const {
    name = 'getaway', dur = 2.5, photo: ph, x0 = 120, speed = 560, ground: gy = 930, h = 610, pivot = [0.5, 1], seat = [0.1, 0.4],
    k: night = 0.88, runner = spark, word = 'clop clop', whip: wh = false, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 2.5, anchor = photoAnchor(ph), HS = 70, SS = 34;
  return shot(name, dur, (c) => {
    const { t, T } = c, { tau, i, P } = clock(c, D0, seed);
    const poseAt = (u) => pin(ph, { x: x0 + u * speed, y: gy - Math.abs(Math.sin(u * 13)) * 46, h, pivot, rot: Math.sin(u * 26 + 0.6) * 0.06 });
    const px = x0 + tau * speed, gal = tau * 13, bounce = Math.abs(Math.sin(gal)) * 46;
    const view = { x: px - 60 + (wh ? whip(t, T, { dist: 380 }) : 0), y: 600, zoom: 1.12 };
    const pl = poseAt(tau), S = on(pl, ...seat), hx = px - 440, hb = Math.abs(Math.sin(gal + 1.2)) * 40;
    const kids = [P(-9, 1, (d) => {
      ground(d, gy, -400, 2600);
      for (let k = 0; k < 9; k++) {
        const mx = k * 330 - 100;
        d.lines([[[mx, gy], [mx - 8, gy - 26]], [[mx + 12, gy], [mx + 14, gy - 34]], [[mx + 24, gy], [mx + 34, gy - 22]]], { w: 3 });
        if (k % 3 === 1) d.lines([[[mx + 150, gy], [mx + 150, gy - 120]], [[mx + 150, gy - 120], [mx + 210, gy - 100], [mx + 150, gy - 80]]], { w: 3.4 });
      }
    }, { still: true })];
    kids.push(photo(pl, { ground: gy, shadow: 0.3 - bounce / 400 }));
    const puffs = [];
    for (let k = 0; k < 4; k++) {
      const age = (tau * 4 + k / 4) % 1, dx = px - 150 - age * 190 - k * 12, dy = gy - 14 - age * 46, r = 12 + age * 26;
      puffs.push(fill(circle(dx, dy, r, 20), 'light', { alpha: (1 - age) * 0.9, name: `p${k}` }), stroke(poly(Array.from({ length: 9 }, (_, j) => { const a = Math.PI * (0.9 + j / 8); return [dx + Math.cos(a) * r, dy + Math.sin(a) * r]; }), false), 'ink', { w: 2.4, wobble: 0, alpha: (1 - age) * 0.9, name: `q${k}` }));
    }
    kids.push(group('dust', puffs), speedLines(px - 250, gy - 330, 0, 5 + Math.floor(tau * 6), { n: 8, alpha: 0.7 }));
    kids.push(P(-9, 5, (d) => {   // he follows on a hobby horse
      const yy = gy - 92 - hb, hd = [[hx + 70, yy + 24], [hx + 86, yy - 32], [hx + 150, yy - 20], [hx + 160, yy + 10], [hx + 106, yy + 22]];
      d.line([[hx - 60, gy - 8 - hb * 0.4], [hx + 80, yy + 10]], { w: 5, role: ROLES.wood });
      d.fill(blob(hd), { base: 'fills.4', tint: 0.4 }).line(hd, { close: true, w: 3.6 });
      dot(d, hx + 128, yy - 8, 4);
      d.lines([[[hx + 86, yy - 32], [hx + 78, yy - 56]], [[hx + 100, yy - 30], [hx + 98, yy - 56]]], { w: 3 });
      A.put(d, hx, yy - 16, HS, { ...A.idle(tau), ...A.emote('dot'), rot: -0.08, hand: [hx + 78, yy + 4] });
    }));
    kids.push(P(-9, 9, (d) => runner(d, S[0] + 6, S[1] - 44, SS, { mood: 'happy', lean: 0.35 })));
    kids.push(trail((u) => { const s0 = on(poseAt(u), ...seat); return [s0[0] + 6, s0[1] - 44]; }, tau, { n: 10, step: 0.04 }));
    if (word) kids.push(P(0.5, 31, (d) => d.text(word, px - 300, gy + 100, { size: 64, w: 4.5 })));
    kids.push(P(0.2, 41, (d) => stars(d, [[300, 150, 11], [700, 90, 9], [1100, 170, 12], [1500, 110, 10], [1850, 180, 11]])));
    return frameOf(c, { anchor, kids, k: night, lights: [{ x: S[0] + 40, y: S[1] + 40, r: 400 }], view, crop: true });
  }, { recipe: 'AK', camera: 'travel', look: lookFor(o, 'cream') });
}

// ======================================================================================================
// AL. Caught, then let go. The light dims in the jar (r shrinks), a held beat, the lid tips (pivot, rot),
// it shoots up and night (k) starts to lift.
// ======================================================================================================
export function caughtLetGo(o = {}) {
  const {
    name = 'caughtLetGo', dur = 3.5, photo: ph, x = 477, ground: gy = 930, h = 700, pivot = [0.15, 1], flame = [0.52, 0.63],
    lid = [0.1, 0.34], push: tilt = 0.07, k: night = 0.86, runner = spark, words = ['gotcha', 'go on'], dawn: withDawn = true, actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 3.5, anchor = photoAnchor(ph), HS = 70, HY = 62, SS = 34, [wCatch, wGo] = words ?? [];
  return shot(name, dur, (c) => {
    const { tau, i, P } = clock(c, D0, seed);
    const push = sm(2.2, 2.5, tau, ease.out), dawn = withDawn ? sm(1.8, 3.5, tau, ease.linear) : 0, back = sm(2.5, 3.2, tau);
    const view = { x: 540, y: 600 - 60 * back, zoom: 1.12 - 0.12 * back };
    const pl = pin(ph, { x, y: gy, h, pivot, rot: tilt * push }), F = on(pl, ...flame), free = tau > 2.6, dim = 1 - 0.62 * sm(0.9, 2.0, tau);
    const path = (u) => (u < 2.6 ? [F[0], F[1] + 6] : [F[0] + 40 * Math.sin((u - 2.6) * 7), F[1] - Math.pow(u - 2.6, 1.6) * 1500]), sp = path(tau);
    const kids = [P(-9, 1, (d) => { ground(d, gy); d.line([[-100, gy - 120], [300, gy - 150], [700, gy - 128], [1200, gy - 160]], { w: 2.4, role: 'shade' }); }, { still: true })];
    if (dawn > 0) kids.push(fill(rect(-600, gy - 420, 2280, 300), { base: 'fills.4', tint: 0.25 }, { cov: linear(0, gy - 420, 0, gy - 120, 0, 0.55 * dawn), day: true, name: 'dawn' }));
    kids.push(photo(pl));
    kids.push(P(-9, 9, (d) => runner(d, sp[0], sp[1], free ? SS : 25, { mood: free ? 'happy' : tau > 0.8 ? 'sad' : 'o', lean: 0 })));
    if (free) kids.push(trail(path, tau, { n: 14, step: 0.035 }));
    if (tau > 1.2 && !free) { const ty = F[1] + 14 + ((tau - 1.2) % 0.7) * 60; kids.push(fill(ellipse(F[0] + 12, ty, 4, 6, 12), 'fills.1', { name: 'tear' })); }
    const hand = tau > 2.15 && tau < 2.7 ? on(pl, ...lid) : tau > 2.9 ? [290, gy - 170 + Math.sin(tau * 14) * 14] : null;
    kids.push(P(-9, 7, (d) => A.put(d, 215, gy - HY, HS, { ...A.idle(tau), ...A.emote(tau < 0.9 || free ? 'happy' : 'dot'), hand, rot: tau > 1.2 && tau < 2.1 ? 0.06 : 0 })));
    if (wCatch && tau < 1.1) kids.push(P(0.2, 21, (d) => d.text(wCatch, 110, gy - 190, { size: 68, w: 4.8 })));
    if (tau > 1.4 && tau < 2.3) kids.push(P(1.4, 23, (d) => { for (let n = 0; n < 3; n++) dot(d, 190 + n * 34, gy - 200, 6); }, { gap: 0.2 }));
    if (wGo && tau > 2.95) kids.push(P(2.95, 25, (d) => d.text(wGo, 130, gy - 230, { size: 68, w: 4.8 })));
    kids.push(P(-9, 41, (d) => stars(d, [[120, 140, 11], [330, 80, 9], [880, 120, 12], [980, 320, 9], [760, 230, 8]])));
    const r = free ? 380 + (tau - 2.6) * 500 : 430 * dim * (1 + Math.sin(i * 1.9) * 0.04);
    return frameOf(c, { anchor, kids, k: night - 0.2 * dawn, lights: [{ x: sp[0], y: sp[1], r }], view, crop: true });
  }, { recipe: 'AL', camera: 'push', look: lookFor(o, 'lilac') });
}

// ======================================================================================================
// AM. Sunrise. A semicircular object rises behind a drawn hill that is painted over it, rays draw on, the
// runaway light arrives at its hub, night (k) goes to 0.
// ======================================================================================================
export function sunrise(o = {}) {
  const {
    name = 'sunrise', dur = 3, photo: ph, x = 540, from = 1180, rise: riseBy = 470, h = 500, hub = [0.5, 0.97], hill = 800,
    rays = 13, k: night = 0.66, runner = spark, word = 'morning', actor, who, seed = 0,
  } = o;
  const A = actorFor({ actor, who });
  need(ph, name);
  const D0 = 3, anchor = photoAnchor(ph), SS = 34;
  return shot(name, dur, (c) => {
    const { tau, P } = clock(c, D0, seed);
    const rise = sm(0.4, 2.1, tau, ease.out), k = night * (1 - sm(0.5, 2.0, tau));
    const view = { x: 540, y: 540, zoom: 1.06 - 0.06 * rise };
    const pl = pin(ph, { x, y: from - rise * riseBy, h }), H = on(pl, ...hub);
    const hillPts = Array.from({ length: 25 }, (_, n) => { const m = n - 6; return [m * 100 - 60, hill + Math.sin(m * 0.9 + 1) * 26 - Math.sin(m / 12 * Math.PI) * 40]; });
    const path = (u) => (u < 0.55 ? [540, lerp(1100, H[1], u / 0.55)] : null), sp = path(tau);
    const kids = [];
    if (rise > 0.15) kids.push(P(0.7, 11, (d) => d.lines(Array.from({ length: rays }, (_, n) => {
      const a = Math.PI + (n + 0.5) / rays * Math.PI, r0 = pl.w * 0.54, r1 = pl.w * (0.64 + (n % 2) * 0.1);
      return [[H[0] + Math.cos(a) * r0, H[1] + Math.sin(a) * r0], [H[0] + Math.cos(a) * r1, H[1] + Math.sin(a) * r1]];
    }), { w: 6, role: 'accents.2', stagger: 0.04, speed: 1200 }), { still: true }));
    kids.push(photo(pl, { shadow: 0 }));
    kids.push(P(-9, 3, (d) => {
      d.fill(poly([...smooth(hillPts), [1800, 1700], [-720, 1700]]), ROLES.hill, { al: 1 }).line(hillPts, { w: 3.8 });
      [150, 380, 800, 960].forEach((gx) => {
        const gy = hill + Math.sin((gx + 60) / 100 * 0.9 + 1) * 26 - Math.sin((gx + 60) / 1200 * Math.PI) * 40;
        d.lines([[[gx, gy], [gx - 8, gy - 28]], [[gx + 12, gy], [gx + 14, gy - 36]], [[gx + 24, gy], [gx + 34, gy - 24]]], { w: 3, role: 'accents.3' });
      });
    }, { still: true }));
    kids.push(P(-9, 7, (d) => A.put(d, 240, hill - 58, 50, { ...A.idle(tau), ...A.emote('happy'), hand: [300, hill - 160 + Math.sin(tau * 12) * 14] })));
    if (sp) kids.push(P(-9, 9, (d) => runner(d, sp[0], sp[1], SS, { lean: 0 })), trail(path, tau, { n: 12, step: 0.04 }));
    [[760, 300, 1.3], [850, 250, 1.45], [900, 330, 1.6]].forEach(([bx, by, t0], n) => kids.push(P(t0, 51 + n, (d) => {
      const f = Math.sin(tau * 10 + n) * 6, ox = tau * 20;
      d.line([[bx - 26 + ox, by + 6], [bx - 10 + ox, by - 10 - f], [bx + ox, by + 4], [bx + 12 + ox, by - 10 - f], [bx + 28 + ox, by + 6]], { w: 3.2 });
    })));
    if (word) kids.push(P(1.9, 31, (d) => d.text(word, 540, 190, { size: 96, w: 6.7, align: 'center' })));
    return frameOf(c, { anchor, kids, k, lights: [{ x: H[0], y: Math.min(H[1] - 120, 690), r: 300 + rise * 1100, glow: 0 }], view, crop: true });
  }, { recipe: 'AM', camera: 'push', look: lookFor(o, 'peach') });
}

// The set by v1 letter, so scenes.md stays a lookup.
export const DOODLE = Object.freeze({
  AA: becomesVehicle, AB: livesInside, AC: doesItsJob, AD: timeOnIt, AE: nightFalls, AF: printsOnALine, AG: lightEscapes,
  AH: alongTheEdge, AI: insideTheTube, AJ: looksBack, AK: getaway, AL: caughtLetGo, AM: sunrise,
});
