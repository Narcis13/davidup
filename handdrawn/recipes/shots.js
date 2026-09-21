// Shot recipes from v1 references/scenes.md, as functions. Names follow the v1 letters so scenes.md stays a
// lookup: establishing (A) ... enso (Z); the doodle set (AA ... AM) is in recipes/doodle.js.
//
// Every recipe R is
//   R(opts)            => a shot (recipe letter set for `hdf board`), with the ground, an anchor meta and
//                         the recipe's drawing; opts override the defaults listed at each recipe
//   R.layer(ctx, opts) => the drawing alone, for composing several recipes in one shot
// ctx is a shot's draw context ({ t, k, i, T, seed, W, H, CX, CY, look }). Subjects are passed as
// functions (ctx, mode) => node, so the same recipe carries any puppet; `mode` is 'ink' or 'blueprint'.
// A recipe with a subject or a figure (A, G, M, U, W, X, Z) also takes actor: a cast member (core/actor.js)
// stands in the subject's place, idling on the twos (walking, for G's traveller), fitted to the boat's height
// box (140 units) or, when opts carry `h`, with its rest pose drawn `h` units tall (the drawing, not the box). An actor draws in
// its own roles whatever the mode.
// Coordinates are v1's: laid out for 1080 x 1080 around (540, 540).
import {
  FPS, paper, night, fill, stroke, dots, group, clip, fx, meta, circle, ellipse, rect, poly, line, spline, xf,
  translate, rotate, scale, mmul, inside, shot, place, cel, ramp, ease, flicker, rng, handText, signOff,
  squiggleText, reveal, duotone, resolveLook, plate, knockout, grain, hatchIn, linear, radial,
  cross, hexLattice, aster, dotBurst, speedLines, loops, construction, seedDot, ripples, dashedRing, dottedArc,
  plant, section, stickyNote, thread, cam,
} from '../core/index.js';
import { bounds, norm } from '../core/list.js';

const TAU = Math.PI * 2;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const frame = ({ W, H }) => rect(-2, -2, W + 4, H + 4);

// An ellipse turned by rot about its centre.
export const ellipseRot = (x, y, rx, ry, rot = 0, n = 64) => xf(ellipse(0, 0, rx, ry, n), mmul(translate(x, y), rotate(rot)));
// A point on a cubic Bezier [p0, c0, c1, p1] at u.
export function bez([p0, p1, p2, p3], u) {
  const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

// recipe(letter, name, defaults, layer, { ground, anchor, crop, camera }) => R
//   ground   'paper' | 'night' | 'none' (the layer draws its own first op)
//   anchor   meta data, a list of them, or (o) => either
function recipe(letter, name, defaults, layer, { ground = 'paper', anchor, crop = false, camera } = {}) {
  const R = (opts = {}) => {
    const o = cast({ ...defaults, ...opts });
    const anchors = [typeof (o.anchor ?? anchor) === 'function' ? (o.anchor ?? anchor)(o) : (o.anchor ?? anchor)].flat().filter(Boolean);
    return shot(o.name ?? name, o.dur, (ctx) => [
      ground === 'paper' ? paper() : ground === 'night' ? night() : null,
      ...norm(layer(ctx, o)),
      ...anchors.map((a) => meta('anchor', a)),
      (o.crop ?? crop) && meta('intent', 'crop'),
    ], { recipe: letter, camera: o.camera ?? camera, fit: o.fit, look: o.look });
  };
  R.layer = (ctx, opts = {}) => layer(ctx, cast({ ...defaults, ...opts }));
  R.recipe = letter;
  R.defaults = defaults;
  return Object.freeze(R);
}

// ---------- a default puppet: the paper boat of the four-looks film ----------

const HULL = [[-78, 0], [78, 0], [52, 44], [-52, 44]], SAIL = [[0, -84], [-46, 0], [46, 0]];
export const BOAT = { hull: poly(HULL), sail: poly(SAIL) };   // the boat's hull and sail paths
// mode 'ink': light body under a faint finish, ink line; 'blueprint': chalk line only. note: a written hull.
export const boat = cel('boat', ({ mode = 'ink', note = 0 }) => {
  const ink = mode !== 'blueprint', ln = ink ? 'ink' : 'chalk', w = ink ? 2.6 : 2.4;
  const tex = { density: 0.16, role: 'inks.0', gap: 7, len: 12, alpha: 0.22, grain: 30, cell: 8 };
  return [
    ink && fill(BOAT.sail, 'light', { finish: tex, name: 'sail' }),
    ink && fill(BOAT.hull, 'light', { finish: tex, name: 'hull' }),
    stroke(BOAT.hull, ln, { w, wobble: 1.6, name: 'hullLine' }),
    stroke(BOAT.sail, ln, { w, wobble: 1.6, name: 'sailLine' }),
    stroke(line(0, -84, 0, 44), ln, { w: 1.6, wobble: 1, dash: [7, 6], name: 'mast' }),
    ink && note && squiggleText([-44, 16, 88], 3, 4, { lineH: 9, amp: 2.5, w: 1, role: 'ink' }),
  ];
}, { box: [-82, -90, 164, 138], inputs: { note: [0, 1, 1] }, desc: 'a paper boat; mode ink | blueprint' });

const boatSubject = (ctx, mode) => boat({ mode, note: 1 });

// An actor as a subject: its state drawn centred on its box, h units tall (the boat is 138), mirrored for
// dir -1. Scaled, so it draws direct. fit 'drawn' (what a recipe's `h` asks for) measures the rest pose's
// drawing instead of the box -- a rig box holds every swing of every pose, so a puppet fitted by it reads
// small -- and boxes the figure by what this state draws, so the anchor, the push and lint see the drawing.
export function actorFigure(actor, state = {}, h = 140, fit = 'box') {
  const dir = state.dir < 0 ? -1 : 1;
  if (fit !== 'drawn') {
    const [bx, by, bw, bh] = actor.box, k = h / (bh || 1);
    return group({ name: 'actor', xf: mmul(scale(k * dir, k), translate(-(bx + bw / 2), -(by + bh / 2))), cache: 'never' }, [actor(state)]);
  }
  const [rx, ry, rw, rh] = restBox(actor), k = h / (rh || 1), g = actor(state), d = bounds(g.kids) ?? g.box;
  return group({ name: 'actor', xf: mmul(scale(k * dir, k), translate(-(rx + rw / 2), -(ry + rh / 2))), cache: 'never', box: d }, [g]);
}
const rests = new WeakMap();
function restBox(actor) {
  if (!rests.has(actor)) { const g = actor(actor.idle(0, 0)); rests.set(actor, bounds(g.kids) ?? actor.box); }
  return rests.get(actor);
}
// opts with an actor in them: the subject or figure becomes the actor. G's subject is handed a pose and is
// turned to head up the path, so the actor there is turned back upright, faces the way it travels and walks.
function cast(o) {
  const A = o.actor;
  if (!A) return o;
  const out = { ...o };
  const [h, fit] = Number.isFinite(o.h) && o.h > 0 ? [o.h, 'drawn'] : [140, 'box'];
  if ('figure' in o) out.figure = (ctx) => actorFigure(A, A.idle(ctx.t, o.seed), h, fit);
  if ('subject' in o) {
    out.subject = (a, b) => (a && a.dir !== undefined && a.x !== undefined
      ? place(0, 0, { rot: -(a.dir + Math.PI / 2) }, actorFigure(A, { ...A.cycle('walk', a.t), ...A.look(Math.cos(a.dir)) }, h, fit))
      : actorFigure(A, A.idle(a.t, o.seed), h, fit));
  }
  return out;
}

// ---------- ink look (A to M) ----------

// A. Establishing shot on a textured surface (1.5 to 2.5 s). A huge ground circle below the frame with a
// light hatch, a blush hatch, grain and a wobbly rim; the subject big with construction lines and a
// scribble; the camera pushes in. mode 'blueprint' draws the same composition in chalk on night. The push
// stops short of cutting the subject: it zooms no further than keeps the subject inside the frame (a big
// actor, `h` or `scale` pushed up), unless opts ask for a crop.
export const establishing = recipe('A', 'establishing', {
  dur: 2, mode: 'ink', subject: boatSubject, x: 540, y: 440, rot: -0.1, scale: 1.9,
  ground: { x: 560, y: 1000, r: 700, role: 'fills.0' }, at: [540, 520], push: [1.15, 1.3],
  patches: [
    { x: 300, y: 580, r: 420, angle: 0.8, gap: 6, len: 16, jitter: 6, role: 'light', alpha: 0.6, w: 1.4 },
    { x: 820, y: 1150, r: 620, angle: -0.6, gap: 5, len: 18, jitter: 5, role: 'blush', alpha: 0.38, w: 1.2 },
  ],
  grain: 7000, construction: { y: -10, r: 110 }, scribble: true, extras: null, pushOver: null, seed: 100,
}, (ctx, o) => {
  const ink = o.mode !== 'blueprint', G = o.ground, g = circle(G.x, G.y, G.r, 120), s = o.seed;
  const subject = o.subject(ctx, o.mode);
  const want = lerp(o.push[0], o.push[1], ramp(0, o.pushOver ?? ctx.T, ctx.t));
  const zoom = o.crop ? want : Math.min(want, fitZoom(bounds(norm([place(o.x, o.y, { rot: o.rot, scale: o.scale }, subject)])), o.at, ctx.W, ctx.H));
  const world = [
    ink
      ? [
        fill(g, G.role, { name: 'ground' }),
        clip(g, o.patches.map((p, j) => hatchIn(circle(p.x, p.y, p.r, 64), { ...p, seed: s + 2 + j }))),
        clip(g, [grain([G.x - G.r, G.y - G.r, 2 * G.r, 2 * G.r], o.grain, { base: G.role, shade: 0.5 }, 0.35, s + 6, 2)]),
        stroke(g, 'ink', { w: 3, wobble: 2.5, alpha: 0.85, name: 'rim' }),
      ]
      : stroke(g, { base: 'chalk', alpha: 0.7 }, { w: 1.2, wobble: 1.5, name: 'rim' }),
    place(o.x, o.y, { rot: o.rot, scale: o.scale }, group('pose', [
      ink && o.construction && construction(0, o.construction.y, o.construction.r, s + 9, { alpha: o.construction.alpha ?? 0.9 }),
      group('subject', [o.scribble && ink ? fx('scribble', { amp: 5, alpha: 0.5 }, [subject], { seed: s + 10 }) : subject]),
    ])),
    o.extras?.(ctx, o.mode),
  ];
  return [ink ? paper() : night(), cam({ x: o.at[0], y: o.at[1], zoom, W: ctx.W, H: ctx.H }, world)];
}, { ground: 'none', anchor: { name: 'subject' }, camera: 'push-in' });

// The largest zoom about `at` that keeps box b inside a W x H frame (Infinity when nothing limits it).
function fitZoom(b, [ax, ay], W, H) {
  if (!b) return Infinity;
  const lim = (d, half) => (d > 1e-9 ? half / d : Infinity);
  return Math.min(lim(ax - b[0], W / 2), lim(b[0] + b[2] - ax, W / 2), lim(ay - b[1], H / 2), lim(b[1] + b[3] - ay, H / 2));
}

// B. Ink blot into blueprint (0.6 to 0.8 s, or the tail of a longer shot). scene(ctx, mode) is drawn in
// ink, and from t0 the same composition in blueprint grows out of an ink blot centred on the subject.
export const blotToBlueprint = recipe('B', 'blot', {
  dur: 0.75, t0: 0, span: null, x: 560, y: 380, reach: 1000, scene: (ctx, mode) => establishing.layer(ctx, { mode }), seed: 77,
}, (ctx, o) => {
  const p = clamp01((ctx.t - o.t0) / (o.span ?? ctx.T - o.t0));
  return [
    ...norm(o.scene(ctx, 'ink')),
    p > 0 && fx('blot', { p, x: o.x, y: o.y, reach: o.reach }, o.scene(ctx, 'blueprint'), { seed: o.seed }),
  ];
}, { ground: 'none', anchor: { name: 'subject' } });

// The egg-like body C, D and E share: { x, y, rx, ry, rot }.
const EGG = { x: 540, y: 560, rx: 205, ry: 330, rot: -0.42 };
const eggPath = (b, n = 140) => ellipseRot(b.x, b.y, b.rx, b.ry, b.rot, n);

// C. Spark, construction, self-drawing outline (1.2 s): an aster ignites over 0.3 s, construction lines
// fade in over 0.4 s, the outline draws itself over 0.4 s, a hex lattice fades in inside.
export const sparkConstruct = recipe('C', 'spark', {
  dur: 1.25, body: EGG, spark: 'accents.1', outline: 'chalk', lattice: 'chalkDim', from: 0, seed: 11,
}, (ctx, o) => {
  const t = ctx.t - o.from, b = o.body, egg = eggPath(b), s = o.seed;
  const pe = ramp(0.7, 1.1, t, ease.out), pl = ramp(1.0, 1.4, t);
  return [
    construction(b.x, b.y, 300, s + 2, { role: 'guide', alpha: 0.7 * ramp(0.3, 0.7, t) }),
    group('shape', [
      aster(b.x, b.y, 4, 14, o.spark, s + 1, ramp(0, 0.3, t)),
      pe > 0 && reveal(pe, stroke(egg, o.outline, { w: 3, wobble: 1.5, seed: s + 3, name: 'outline' })),
      pl > 0 && clip(egg, [hexLattice([b.x - 360, b.y - 360, 720, 720], 17, o.lattice, { alpha: 0.38 * pl, w: 0.9 })]),
    ]),
  ];
}, { ground: 'night', anchor: { name: 'shape' } });

// Seeded points inside a path (rejection sampling in its box).
export function pointsIn(path, n, seed, shrink = 0.85) {
  const q = rng(seed), [bx, by, bw, bh] = path.box, cx = bx + bw / 2, cy = by + bh / 2, out = [];
  for (let tries = 0; out.length < n && tries < n * 200; tries++) {
    const x = cx + (q() - 0.5) * bw * shrink, y = cy + (q() - 0.5) * bh * shrink;
    if (inside(path, x, y)) out.push([x, y]);
  }
  return out;
}

// D. Doubling particles (1.5 to 2 s): at each cue the count doubles (2^k asters at seeded places inside the
// body), spindle lines join siblings for 0.25 s after a cue, a lineage tree grows in a corner.
export const doubling = recipe('D', 'doubling', {
  dur: 1.75, body: EGG, cues: [0.1, 0.4, 0.7, 1.0, 1.3], from: 0, fade: null, role: 'accents.1', tree: { x: 930, y: 80 }, seed: 11,
}, (ctx, o) => {
  const t = ctx.t, s = o.seed;
  if (t < o.from) return [];
  const k = o.cues.filter((c) => t >= c).length, n = 2 ** k, pts = pointsIn(eggPath(o.body, 64), 32, s + 4, 0.8);
  const alpha = o.fade ? 1 - ramp(o.fade[0], o.fade[1], t) : 1;
  const last = k ? o.cues[k - 1] : o.from, g = ramp(last, last + 0.25, t, ease.out);
  const kids = [];
  if (alpha > 0) {
    if (k && g < 1) {
      const sub = [];
      for (let j = 0; j + 1 < n && j + 1 < pts.length; j += 2) sub.push({ pts: [...pts[j], ...pts[j + 1]], closed: false });
      kids.push(stroke({ sub, box: [0, 0, 0, 0] }, { base: o.role, alpha: 0.8 }, { w: 1, wobble: 0, name: 'spindles' }));
    }
    for (let j = 0; j < n && j < pts.length; j++) kids.push(aster(pts[j][0], pts[j][1], k < 3 ? 7 : 5, 12, o.role, s + 10 + j, 0.6 + 0.4 * g));
  }
  const tree = [];
  if (k && o.tree) {
    const { x: x0, y: y0 } = o.tree, dots = [], links = [];
    for (let d = 0; d <= k; d++) {
      const cnt = 2 ** d, span = Math.min(220, cnt * 14);
      for (let j = 0; j < cnt; j++) {
        const x = x0 - span / 2 + (cnt === 1 ? 0 : j * span / (cnt - 1)), y = y0 + d * 22;
        dots.push(...circle(x, y, 2, 8).sub);
        if (d < k) {
          const cc = cnt * 2, sp = Math.min(220, cc * 14);
          for (const jj of [2 * j, 2 * j + 1]) links.push({ pts: [x, y, x0 - sp / 2 + jj * sp / (cc - 1), y0 + (d + 1) * 22], closed: false });
        }
      }
    }
    tree.push(group('lineage', [fill({ sub: dots, box: [x0 - 110, y0, 220, k * 22] }, 'chalk'), links.length && stroke({ sub: links, box: [x0 - 110, y0, 220, k * 22] }, 'chalk', { w: 1, wobble: 0 })]));
  }
  return [group({ name: 'particles', alpha }, kids), ...tree];
}, { ground: 'night', anchor: { name: 'particles' } });

// E. Bands (0.8 to 1.2 s): 1 to n flat accent bands every ~0.11 s, with grain, inside the body in its own
// frame, and a faint outer ring.
export const bands = recipe('E', 'bands', {
  dur: 1, body: EGG, n: 7, every: 0.11, from: 0, role: 'accents.3', h: 26, seed: 11,
}, (ctx, o) => {
  const t = ctx.t, b = o.body;
  if (t < o.from) return [];
  const nb = Math.min(o.n, 1 + Math.floor((t - o.from) / o.every)), rows = [];
  for (let j = 0; j < nb; j++) {
    const y = -b.ry * 0.7 + j * (b.ry * 1.4 / o.n), r = rect(-b.rx - 20, y, b.rx * 2 + 40, o.h);
    rows.push(fill(r, o.role, { alpha: 0.85, name: `band${j}` }), clip(r, [grain([-b.rx - 20, y, b.rx * 2 + 40, o.h], 260, 'light', 0.55, o.seed + 30 + j, 1.6)]));
  }
  return group('bands', [
    clip(eggPath(b), [group({ name: 'frame', xf: mmul(translate(b.x, b.y), rotate(b.rot)) }, rows)]),
    stroke(ellipseRot(b.x, b.y, b.rx * 1.06, b.ry * 1.03, b.rot, 96), { base: 'accents.0', tint: 0.6 }, { w: 1, wobble: 0, alpha: 0.5, name: 'halo' }),
  ]);
}, { ground: 'night', anchor: { name: 'bands' } });

// F. Macro insert (2 drawn frames): the same scene with the camera zoomed 4 to 6 on a detail. Hard cuts.
export const macroInsert = recipe('F', 'macro', {
  dur: 2 / FPS, scene: (ctx) => establishing.layer(ctx), x: 540, y: 440, zoom: 5,
}, (ctx, o) => [cam({ x: o.x, y: o.y, zoom: o.zoom, W: ctx.W, H: ctx.H }, group('detail', o.scene(ctx, 'ink')))],
{ anchor: { name: 'detail' }, crop: true, camera: 'macro' });

// G. Camera-follow travel (2 to 3 s): along a cubic path, heading from the derivative, the camera leads by
// `lead`; seeded speed lines per frame, fixed loops, a hatched shadow. world(ctx) is in world coordinates;
// subject({ x, y, dir, t, k, i }) draws the traveller heading up (-y) at the origin.
export const followTravel = recipe('G', 'travel', {
  dur: 2.25, path: [[300, 2000], [1300, 1500], [500, 700], [1900, 450]], lead: 120,
  world: () => [], subject: () => boat({}), shadow: true, lines: true, trails: true, bg: { base: 'chalk', mix: ['paper', 0.5] }, seed: 21,
}, (ctx, o) => {
  const u = ramp(0, ctx.T, ctx.t), p = bez(o.path, u), q = bez(o.path, Math.min(1, u + 0.01)), dir = Math.atan2(q[1] - p[1], q[0] - p[0]);
  const pose = { x: p[0], y: p[1], dir, t: ctx.t, k: ctx.k, i: ctx.i };
  return [
    fill(frame(ctx), o.bg, { name: 'bg' }),
    cam({ x: p[0] + Math.cos(dir) * o.lead, y: p[1] + Math.sin(dir) * o.lead, W: ctx.W, H: ctx.H }, [
      ...norm(o.world(ctx)),
      o.shadow && place(p[0] + 45, p[1] + 70, { rot: dir + Math.PI / 2 }, hatchIn(ellipse(0, 0, 40, 90, 32), { angle: 0.4, gap: 4, len: 12, jitter: 3, role: 'ink', alpha: 0.35, seed: o.seed + 9 })),
      o.lines && speedLines(p[0], p[1], dir, o.seed + ctx.k, { n: 9, alpha: 0.55 }),
      o.trails && loops(p[0], p[1], dir, o.seed + 3, { alpha: 0.7 }),
      place(p[0], p[1], { rot: dir + Math.PI / 2 }, group('traveller', [o.subject(pose, ctx)])),
    ]),
  ];
}, { anchor: { name: 'traveller' }, camera: 'follow' });

// H. POV mosaic (0.6 to 1.2 s): the scene seen through a compound eye, hex cells shrinking from s[0] to
// s[1] over `over` seconds inside an iris with a chalk rim. flicker: alternate with the clean view.
export const povMosaic = recipe('H', 'eye', {
  dur: 11 / 12, world: (ctx) => [paper(), establishing.layer(ctx)], s: [40, 13], over: 0.7, x: 540, y: 540, r: 505, rim: 'chalk', flicker: false, seed: 31,
}, (ctx, o) => {
  const s = lerp(o.s[0], o.s[1], ramp(0, o.over, ctx.t)), q = rng(o.seed), crosses = [];
  for (let j = 0; j < 10; j++) crosses.push(...cross(q() * ctx.W, q() * ctx.H, 5).sub);
  const clean = o.flicker && flicker(ctx.i);
  return group('eye', [
    clip(circle(o.x, o.y, o.r, 120), [
      clean ? group('view', o.world(ctx)) : fx('mosaic', { s }, o.world(ctx)),
      stroke({ sub: crosses, box: [0, 0, ctx.W, ctx.H] }, { base: 'night', alpha: 0.5 }, { w: 1, wobble: 0, name: 'crosses' }),
    ]),
    stroke(circle(o.x, o.y, o.r, 120), o.rim, { w: 3, wobble: 2, seed: o.seed + 1, name: 'rim' }),
  ]);
}, { ground: 'night', anchor: { name: 'eye' }, camera: 'pov' });

// I. Network (1 to 1.5 s): a couple of thousand particles drifting on seeded arcs round two accent
// clusters, a slow camera turn, night.
export const network = recipe('I', 'network', {
  dur: 1.25, n: 2000, clusters: [[380, 420], [700, 640]], R: 420, role: 'chalkDim', turn: [0, 0.15], seed: 41,
}, (ctx, o) => {
  const q = rng(o.seed), sub = [];
  for (let j = 0; j < o.n; j++) {
    const [cx, cy] = o.clusters[j % o.clusters.length], r = 20 + q() * o.R, a0 = q() * TAU, sp = (q() - 0.5) * 0.9 * (120 / r);
    const a = a0 + sp * ctx.t;
    sub.push(...circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 1.1 + q() * 1.2, 5).sub);
  }
  return cam({ zoom: 1, rot: lerp(o.turn[0], o.turn[1], ramp(0, ctx.T, ctx.t)), W: ctx.W, H: ctx.H }, group('network', [
    fill({ sub, box: [0, 0, ctx.W, ctx.H] }, o.role, { alpha: 0.8, name: 'particles' }),
    ...o.clusters.map(([x, y], j) => aster(x, y, 9, 16, `accents.${j}`, o.seed + 1 + j, 1)),
  ]));
}, { ground: 'night', anchor: { name: 'network' }, crop: true });

// J. Impact (0.5 s): one flash frame, then a filled blob and 30 droplets flying out, then a hold with
// red construction circles.
export const impact = recipe('J', 'impact', {
  dur: 0.5, x: 540, y: 560, r: 90, role: 'blush', seed: 51,
}, (ctx, o) => {
  if (ctx.k === 0) return [group('impact', [fill(circle(o.x, o.y, o.r, 48), o.role)]), fx('flash', {}, [])];
  const q = rng(o.seed), pts = [], drops = [], g = ramp(1 / FPS, 0.3, ctx.t, ease.out);
  for (let j = 0; j < 18; j++) { const a = j / 18 * TAU, rr = o.r * (0.8 + q() * 0.45); pts.push([o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr]); }
  for (let j = 0; j < 30; j++) {
    const a = q() * TAU, d = o.r * (1.2 + q() * 2.2) * g, rr = 3 + q() * 9;
    drops.push(...circle(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, rr, 12).sub);
  }
  const hold = ramp(0.25, 0.35, ctx.t);
  return group('impact', [
    fill(spline(pts, { closed: true }), o.role, { name: 'blob' }),
    fill({ sub: drops, box: [o.x - o.r * 4, o.y - o.r * 4, o.r * 8, o.r * 8] }, o.role, { name: 'drops' }),
    hold > 0 && stroke({ sub: [1.6, 2.3, 3].flatMap((m) => circle(o.x, o.y, o.r * m, 64).sub), box: [0, 0, 0, 0] }, 'blush', { w: 1.2, wobble: 0, alpha: hold, name: 'rings' }),
    hold > 0 && construction(o.x, o.y, o.r * 1.4, o.seed + 1, { role: 'blush', alpha: 0.6 * hold }),
  ]);
}, { anchor: { name: 'impact' } });

// K. Vibration (1 s): a zig-zag between two points, thick dark under thin chalk, changing every drawn
// frame, and concentric circles leaving the source every `every` drawn frames.
export const vibration = recipe('K', 'vibration', {
  dur: 1, from: [300, 540], to: [780, 540], amp: 30, teeth: 14, every: 3, speed: 260, role: 'ink', seed: 61,
}, (ctx, o) => {
  const q = rng(o.seed + ctx.k), [x0, y0] = o.from, [x1, y1] = o.to, L = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / L, ny = (x1 - x0) / L, pts = [];
  for (let j = 0; j <= o.teeth; j++) {
    const u = j / o.teeth, a = (j === 0 || j === o.teeth ? 0 : (j % 2 ? 1 : -1)) * o.amp * (0.6 + q() * 0.8);
    pts.push(x0 + (x1 - x0) * u + nx * a, y0 + (y1 - y0) * u + ny * a);
  }
  const zig = poly(pts, false), rings = [];
  for (let b = 0; b * o.every <= ctx.k; b++) {
    const r = (ctx.k - b * o.every) / FPS * o.speed + 12;
    if (r < 700) rings.push(stroke(circle(x0, y0, r, 64), o.role, { w: 1.4, wobble: 1, alpha: Math.max(0.15, 1 - r / 700), seed: o.seed + b, name: `ring${b}` }));
  }
  return group('vibration', [
    ...rings,
    stroke(zig, o.role, { w: 6, wobble: 1, name: 'dark' }),
    stroke(zig, 'chalk', { w: 2, wobble: 0.6, name: 'light' }),
    fill(circle(x0, y0, 10, 24), o.role, { name: 'source' }),
  ]);
}, { anchor: { name: 'vibration' }, crop: true });

// L. Time passing (1 to 2 s): a sun disc on an arc, one tally mark per `every` drawn frames, the paper
// flickering between day and dusk.
export const timePassing = recipe('L', 'time', {
  dur: 1.5, x: 540, y: 760, R: 380, every: 3, tally: [140, 900], sun: 'accents.2', seed: 71,
}, (ctx, o) => {
  const a = Math.PI + ramp(0, ctx.T, ctx.t, ease.linear) * Math.PI, sx = o.x + Math.cos(a) * o.R, sy = o.y + Math.sin(a) * o.R * 0.8;
  const marks = [], n = Math.floor(ctx.k / o.every) + 1;
  for (let j = 0; j < n; j++) {
    const grp = Math.floor(j / 5), x = o.tally[0] + grp * 70 + (j % 5) * 12;
    marks.push(j % 5 === 4
      ? { pts: [x - 52, o.tally[1] + 30, x + 4, o.tally[1] - 6], closed: false }
      : { pts: [x, o.tally[1] - 10, x + 2, o.tally[1] + 36], closed: false });
  }
  return [
    !flicker(ctx.i) && fill(frame(ctx), { base: 'night', alpha: 0.22 }, { name: 'dusk' }),
    stroke(line(60, o.y, ctx.W - 60, o.y), 'ink', { w: 3, wobble: 2, name: 'horizon' }),
    group('sun', [fill(circle(sx, sy, 60, 48), o.sun, { finish: true }), stroke(circle(sx, sy, 60, 48), 'ink', { w: 2.4 })]),
    stroke({ sub: marks, box: [o.tally[0] - 60, o.tally[1] - 10, 400, 50] }, 'ink', { w: 2.6, wobble: 1.2, seed: o.seed, name: 'tally' }),
  ];
}, { anchor: { name: 'sun' } });

// M. Coda (1.5 s): night, two sparks, the subject as a hatched silhouette fading out.
export const coda = recipe('M', 'coda', {
  dur: 1.5, subject: (ctx) => boat({ mode: 'blueprint' }), x: 540, y: 560, scale: 2.2, fade: [0.5, 1.5], sparks: [[260, 300], [820, 360]], seed: 81,
}, (ctx, o) => [
  ...o.sparks.map(([x, y], j) => aster(x, y, 6, 14, `accents.${j}`, o.seed + j, 1)),
  place(o.x, o.y, { scale: o.scale }, group({ name: 'coda', alpha: 1 - ramp(o.fade[0], o.fade[1], ctx.t) }, [
    !o.actor && fill(BOAT.sail, { base: 'night', tint: 0.12 }, { finish: { kind: 'hatch', role: 'chalkDim' } }),
    !o.actor && fill(BOAT.hull, { base: 'night', tint: 0.12 }, { finish: { kind: 'hatch', role: 'chalkDim' } }),
    o.subject(ctx, 'blueprint'),
  ])),
], { ground: 'night', anchor: { name: 'coda' } });

// ---------- riso look (N to S) ----------

// A riso card: plates [[kids...] per ink] printed as halftone plates (v1 risoCard). kids are fills with
// cov (coverage 0..1, or radial / linear descriptors), strokes (bands of coverage) and knockouts.
export function risoCard(plates, { inks = ['inks.0', 'inks.1', 'inks.2'], angles = [0.26, 1.31, 0], cell = 7, seed = 30, box = [0, 0, 1080, 1080] } = {}) {
  return group('card', plates.map((kids, k) => kids && plate(inks[k], kids, { angle: angles[k % angles.length], cell, seed: seed + k, box })));
}

const cov = (path, c) => fill(path, 'ink', { cov: c });
// Three sample riso cards (sun over the sea, a big moon, stripes under a disc), the default for recipes that
// take cards (O, P, Q), so each renders with no arguments; N's iris takes one (`iris: { card: CARDS[0] }`).
export const CARDS = Object.freeze([
  () => risoCard([
    [cov(rect(0, 0, 1080, 600), linear(0, 0, 0, 600, 0.02, 0.35)), knockout(circle(540, 430, 150)), cov(rect(0, 600, 1080, 480), 0.85)],
    [cov(rect(0, 0, 1080, 600), radial(540, 430, 60, 520, 0.9, 0))],
    [cov(circle(540, 430, 150), 0.95), cov(rect(0, 600, 1080, 480), 0.4)],
  ]),
  () => risoCard([
    [cov(rect(0, 0, 1080, 1080), 0.9), knockout(circle(540, 420, 300))],
    [cov(rect(0, 0, 1080, 1080), radial(540, 420, 300, 520, 0.6, 0))],
    [cov(circle(540, 420, 300), 0.7), ...[[470, 350, 40], [600, 480, 60], [520, 560, 25]].map(([x, y, r]) => cov(circle(x, y, r), 0.3))],
  ]),
  () => risoCard([
    [...[0, 1, 2, 3, 4].map((j) => cov(rect(0, j * 216, 1080, 108), 0.7))],
    [cov(circle(540, 540, 260), 0.9), knockout(circle(540, 540, 120))],
    [cov(rect(0, 760, 1080, 320), linear(0, 760, 0, 1080, 0, 0.8))],
  ]),
]);

// N. Seed dot and ripples (1.5 to 2.5 s): a ring is born every `every` drawn frames and travels outward
// at `speed`, alternating two accents; optionally an iris opens on a card at the end.
export const seedRipples = recipe('N', 'intro', {
  dur: 2, x: 540, y: 540, every: 4, speed: 260, roles: ['accents.1', 'accents.0'], w: 4, dot: 10, iris: null, seed: 40,
}, (ctx, o) => {
  const rings = [];
  for (let b = 0; b * o.every / FPS <= ctx.t + 1e-9; b++) {
    const r = (ctx.t - b * o.every / FPS) * o.speed;
    if (r > 8 && r < 900) rings.push(stroke(circle(o.x, o.y, r, Math.max(48, r / 5 | 0)), o.roles[b % 2], { tool: 'crayon', w: o.w, seed: o.seed + b, name: `ring${b}` }));
  }
  const ir = o.iris, p = ir ? ramp(ir.from ?? ctx.T - 0.7, ir.to ?? ctx.T, ctx.t, ease.out) : 0, R = 30 + p * (ir?.R ?? 380);
  return [
    group('ripples', rings),
    p > 0 && fx('iris', { r: R, x: o.x, y: o.y, ring: 'ink' }, [paper(), ...norm(ir.card(ctx))], { seed: o.seed + 1 }),
    seedDot(o.x, o.y, o.dot),
  ];
}, { anchor: [{ name: 'seedDot' }, { name: 'ripples' }], crop: true });

const montageShot = recipe('O', 'montage', {
  cards: CARDS, per: 0.25, dot: 10, x: 540, y: 540,
}, (ctx, o) => {
  const k = Math.min(o.cards.length - 1, Math.floor(ctx.t / o.per + 1e-9));
  return [group('card', norm(o.cards[k]({ ...ctx, t: ctx.t - k * o.per }))), o.dot && seedDot(o.x, o.y, o.dot)];
}, { anchor: [{ name: 'card' }, { name: 'seedDot' }] });
// O. Card montage (2 to 8 s): one card per `per` seconds (3 drawn frames at 0.25), hard cuts, the seed dot
// on top of every card. cards: [(ctx) => list] without paper. dur defaults to cards x per.
export const montage = Object.assign((opts = {}) => montageShot({ dur: (opts.cards ?? CARDS).length * (opts.per ?? 0.25), ...opts }), { layer: montageShot.layer, recipe: 'O', defaults: montageShot.defaults });

// A list with every dots op's screen made coarser (badges draw cards at a tenth of their size).
const coarse = (list, f) => norm(list).map((op) => (op.op === 'dots' ? { ...op, cell: (op.cell ?? 8) * f } : op.kids ? { ...op, kids: coarse(op.kids, f) } : op));

// P. Badge gallery (1.5 s): every card as a round stamp on concentric dashed rings over a faint dot screen;
// the badges grow in over `grow` (ease out), hold, then the whole ring shrinks to the seed dot (ease in).
export const badgeGallery = recipe('P', 'gallery', {
  dur: 1.5, cards: CARDS, x: 540, y: 540, r0: 40, gap: 118, size: 52, ring: 'ink', grow: 0.5, shrink: [1.0, 1.5], screen: 'inks.2', dot: 10, seed: 51,
}, (ctx, o) => {
  const progress = ramp(0, o.grow, ctx.t, ease.out), sc = 1 - ramp(o.shrink[0], o.shrink[1], ctx.t, ease.in) * 0.98, s = o.size * progress;
  const kids = [];
  let placed = 0;
  for (let k = 1; placed < o.cards.length && k < 8; k++) {
    const R = o.r0 + k * o.gap, n = Math.min(o.cards.length - placed, Math.max(5, Math.round(TAU * R / (o.size * 2.5))));
    kids.push(dashedRing(o.x, o.y, R, o.ring, o.seed + k));
    for (let j = 0; j < n; j++, placed++) {
      if (s <= 1) continue;
      const a = j / n * TAU + k * 0.5, x = o.x + Math.cos(a) * R, y = o.y + Math.sin(a) * R, m = 2 * s / 1080;
      kids.push(clip(circle(x, y, s, 48), [group({ name: `badge${placed}`, xf: mmul(translate(x - s, y - s), scale(m)) }, [fill(rect(0, 0, 1080, 1080), 'paper'), ...coarse(o.cards[placed](ctx), 3)])]));
      kids.push(stroke(circle(x, y, s, 48), o.ring, { w: 3, wobble: 0, name: `rim${placed}` }));
    }
  }
  return [
    dots(frame(ctx), o.screen, { cell: 9, cov: 0.16, angle: 0.26, jitter: 0.3, seed: o.seed, name: 'screen' }),
    group({ name: 'badges', xf: mmul(mmul(translate(o.x, o.y), scale(sc)), translate(-o.x, -o.y)) }, kids),
    o.dot && seedDot(o.x, o.y, o.dot),
  ];
}, { anchor: [{ name: 'badges' }, { name: 'seedDot' }] });

// Q. Duotone beat (0.5 to 1 s): the same cards in two inks for a beat, a montage under duotone(look, a, b).
// a, b default to the base look's first accent and first ink.
export function duotoneBeat({ base = 'risoPop', a, b, ...opts } = {}) {
  const p = resolveLook(base).palette;
  return montage({ name: 'duotone', ...opts, look: duotone(base, a ?? p.accents[0], b ?? p.inks[0]) });
}
duotoneBeat.recipe = 'Q';

// R. Starfield with circled dots (1.5 s): night in three accent grains, a ring expands from the seed and
// wakes twenty small dots with dashed rings as it passes, a few sparks, and one constellation line per
// drawn frame between two woken dots.
export const starfield = recipe('R', 'stars', {
  dur: 1.5, x: 540, y: 540, n: 20, speed: 520, seed: 91,
}, (ctx, o) => {
  const q = rng(o.seed), stars = [];
  for (let j = 0; j < o.n; j++) stars.push([80 + q() * (ctx.W - 160), 80 + q() * (ctx.H - 160)]);
  const R = ctx.t * o.speed, woken = stars.filter(([x, y]) => Math.hypot(x - o.x, y - o.y) < R);
  const sky = [0, 1, 2].map((j) => grain([0, 0, ctx.W, ctx.H], 160, `accents.${j}`, 0.5, o.seed + 3 + j, 1.8)), kids = [];
  if (R < 1200) sky.push(dashedRing(o.x, o.y, Math.max(1, R), 'chalkDim', o.seed + 7));
  woken.forEach(([x, y], j) => kids.push(fill(circle(x, y, 4, 12), 'chalk', { name: `s${j}` }), dashedRing(x, y, 14, 'chalkDim', o.seed + 20 + j, { dash: [5, 4], w: 1 })));
  if (woken.length > 1) {
    const r2 = rng(o.seed + ctx.k), a = woken[Math.floor(r2() * woken.length)], b = woken[Math.floor(r2() * woken.length)];
    if (a !== b) kids.push(stroke(line(a[0], a[1], b[0], b[1]), 'chalk', { w: 1, wobble: 0, alpha: 0.8, name: 'link' }));
  }
  [[200, 220], [860, 300], [720, 880]].forEach(([x, y], j) => { if (Math.hypot(x - o.x, y - o.y) < R) kids.push(aster(x, y, 5, 12, `accents.${j}`, o.seed + 40 + j, 1)); });
  return [...sky, group('stars', kids), seedDot(o.x, o.y, 10, { ink: 'chalk', ink2: 'accents.0' })];
}, { ground: 'night', anchor: [{ name: 'stars' }, { name: 'seedDot' }] });

// S. Sign-off (the last shot): signOff(a, b) on paper with faint ripples. The first word writes over
// reveal[0]..reveal[1], the second over reveal[1]..reveal[2], then it holds; lint wants it complete 1.5 s
// before the end, hence 2.5 s by default.
export const signOffShot = recipe('S', 'signoff', {
  dur: 2.5, a: 'hand', b: 'drawn', x: 540, y: 500, size: 96, reveal: [0, 0.5, 1.0], rings: [260, 330, 400], ringRole: { base: 'accents.1', alpha: 0.35 }, seed: 110,
}, (ctx, o) => [
  o.rings && ripples(o.x, o.y + 40, o.rings, o.ringRole, o.seed, 3),
  signOff(o.a, o.b, { x: o.x, y: o.y, size: o.size, pA: ramp(o.reveal[0], o.reveal[1], ctx.t), pB: ramp(o.reveal[1], o.reveal[2], ctx.t) }),
], { anchor: { name: 'signOff' } });

// ---------- screen look (T is a film option; U, V) ----------

const screenDots = (path, role, cov, seed, cell = 6) => dots(path, role, { cell, cov, angle: 0, seed });

// U. Flat landscape, day and night (1 to 2.5 s each), cut at nightAt: day is sun, dotted mountains, a band
// of reeds and water; night is moon, a hill with a lit window glowing through a radial screen, dark
// water. subject(ctx, isNight) bobs on the water at (x, y).
export const landscapeDayNight = recipe('U', 'sea', {
  dur: 2.5, nightAt: 1.5, subject: () => boat({ note: 1 }), x: 540, y: 700, scale: 1.1, water: 632, seed: 60,
}, (ctx, o) => {
  const { W, H, t } = ctx, dark = t >= o.nightAt, s = o.seed, wy = o.water, out = [];
  if (!dark) {
    const sun = circle(760, 200, 70), m = poly([0, 520, 180, 380, 330, 470, 480, 360, 640, 470, 800, 390, W, 500, W, 560, 0, 560]);
    const band = rect(0, 545, W, 90), q = rng(s + 3), reeds = [];
    for (let j = 0; j < 90; j++) { const x = q() * W; reeds.push({ pts: [x, 640, x + (q() - 0.5) * 20, 560 + q() * 40], closed: false }); }
    const water = rect(0, wy, W, H - wy + 2);
    out.push(
      fill(sun, 'fills.5', { name: 'sun' }), screenDots(sun, 'blush', 0.35, s),
      fill(m, 'fills.2', { name: 'hills' }), screenDots(m, 'fills.1', 0.45, s + 1),
      fill(band, 'fills.5', { name: 'band' }), screenDots(band, 'fills.4', 0.6, s + 2),
      stroke({ sub: reeds, box: [0, 540, W, 110] }, 'ink', { w: 2, wobble: 2, seed: s + 4, name: 'reeds' }),
      fill(water, 'fills.0', { name: 'water' }), screenDots(water, 'fills.7', 0.4, s + 5),
    );
  } else {
    const moon = circle(720, 170, 60), hill = poly([600, 640, 780, 420, W, 380, W, 640]), glowC = circle(860, 420, 90), water = rect(0, wy, W, H - wy + 2);
    out.push(
      fill(moon, 'light', { name: 'moon' }), dots(moon, 'chalkDim', { cell: 5, cov: 0.3, seed: s + 6 }),
      fill(hill, 'fills.7', { name: 'hill' }), fill(rect(830, 380, 60, 60), 'fills.7'), fill(poly([825, 380, 860, 345, 895, 380]), 'fills.7'),
      dots(glowC, 'fills.5', { cell: 5, cov: radial(860, 420, 0, 90, 1, 0), seed: s + 7, name: 'glow' }), fill(rect(850, 405, 20, 22), 'fills.5', { name: 'window' }),
      fill(water, 'fills.7', { name: 'water' }), screenDots(water, 'fills.0', 0.25, s + 8),
    );
  }
  const q = rng(s + 10), wake = [];
  for (let j = 0; j < 40; j++) { const x = q() * W, y = wy + 28 + q() * 400, L = 20 + q() * 60; wake.push({ pts: [x, y, x + L, y], closed: false }); }
  out.push(stroke({ sub: wake, box: [0, wy, W, 460] }, dark ? 'chalkDim' : 'light', { w: 2, wobble: 0, name: 'wake' }));
  out.push(place(o.x, o.y + Math.round(Math.sin(t * 3) * 4), { rot: Math.sin(t * 3) * 0.04, scale: o.scale }, group('subject', [o.subject(ctx, dark)])));
  return [dark ? night() : paper(), ...out];
}, { ground: 'none', anchor: { name: 'subject' } });

// The fold states of V: a written sheet, a triangle, a diamond, the boat.
const FOLDS = [
  () => [fill(rect(-150, -110, 300, 220), 'light'), stroke(rect(-150, -110, 300, 220), 'ink', { w: 2.4 }), squiggleText([-120, -70, 240], 6, 5, { lineH: 26, amp: 4 })],
  () => [fill(poly([-150, 60, 150, 60, 0, -110]), 'light'), stroke(poly([-150, 60, 150, 60, 0, -110]), 'ink', { w: 2.4 }), stroke(line(0, -110, 0, 60), { base: 'ink', alpha: 0.4 }, { w: 1.2, dash: [6, 5] })],
  () => [fill(poly([0, -120, 110, 0, 0, 120, -110, 0]), 'light'), stroke(poly([0, -120, 110, 0, 0, 120, -110, 0]), 'ink', { w: 2.4 }), stroke(line(-110, 0, 110, 0), { base: 'ink', alpha: 0.4 }, { w: 1.2, dash: [6, 5] })],
  () => [place(0, 20, { scale: 1.6 }, boat({}))],
];

// V. Origami setup and payoff (1.5 s): on a desk with wobbly grain, a written sheet folds into a boat in
// hard cuts every `every` drawn frames; reverse: the boat unfolds back into the sheet.
export const origami = recipe('V', 'origami', {
  dur: 1.5, every: 3, reverse: false, x: 540, y: 560, desk: 'fills.3', states: FOLDS, seed: 70,
}, (ctx, o) => {
  const q = rng(o.seed), grainLines = [], n = o.states.length;
  for (let j = 0; j < 40; j++) { const y = 20 + q() * (ctx.H - 40); grainLines.push({ pts: [0, y, ctx.W * 0.35, y + (q() - 0.5) * 20, ctx.W * 0.7, y + (q() - 0.5) * 20, ctx.W, y], closed: false }); }
  const k = Math.min(n - 1, Math.floor(ctx.k / o.every)), st = o.reverse ? n - 1 - k : k;
  return [
    fill(frame(ctx), o.desk, { name: 'desk' }),
    stroke({ sub: grainLines, box: [0, 0, ctx.W, ctx.H] }, { base: o.desk, shade: 0.3 }, { w: 1.2, wobble: 3, alpha: 0.35, seed: o.seed + 1, name: 'woodgrain' }),
    place(o.x, o.y, group('origami', o.states[st]())),
  ];
}, { anchor: { name: 'origami' } });

// ---------- pencil look (W to Z) ----------

const spiral = (s) => spline(Array.from({ length: 56 }, (_, j) => { const a = j * 0.4; return [s / 2 + Math.cos(a) * a * 1.9, s / 2 + Math.sin(a) * a * 1.9]; }), { n: 3 });

// W. Page with torn sections (2 to 3 s): a squiggle text wall, a small label, a sticky note with a spiral,
// then a section in fills.0 rises with plants on its floor, then a night section rises with dotted arcs,
// dot bursts and a thin blueprint figure; a thread over everything.
export const tornPage = recipe('W', 'page', {
  dur: 2.5, label: 'what i keep', figure: (ctx) => boat({ mode: 'blueprint' }), rise: [0, 0.8], dark: [1.4, 2.0], seed: 80,
}, (ctx, o) => {
  const s = o.seed, { W, H } = ctx, y1 = lerp(H + 20, 620, ramp(o.rise[0], o.rise[1], ctx.t)), y2 = lerp(H + 20, 700, ramp(o.dark[0], o.dark[1], ctx.t));
  return [
    squiggleText([80, 90, W - 160], 6, s, { lineH: 26, amp: 5, role: 'shade' }),
    o.label && handText(o.label, 80, 300, { size: 26, ink2: null }),
    stickyNote(720, 250, 120, s + 1, [stroke(spiral(120), 'ink', { w: 1, wobble: 0.4 })]),
    section(y1, 'fills.0', s + 2, { W, H }),
    y1 < H - 80 && [
      plant(180, H + 5, 120, 4, s + 3, { leaf: 'accents.0', flower: 'accents.1' }),
      plant(900, H + 5, 100, 4, s + 4, { leaf: 'accents.0', flower: 'accents.1' }),
      plant(560, H + 5, 90, 3, s + 5, { leaf: 'accents.0', flower: 'accents.1' }),
    ],
    y2 < H && [
      section(y2, 'night', s + 6, { W, H }),
      [1, 2, 3, 4, 5].map((k) => dottedArc(540, 960, 40 + k * 42, 'chalkDim', s + 7 + k)),
      dotBurst(260, 940, 90, 12, 'accents.3', s + 13), dotBurst(860, 900, 70, 10, 'accents.1', s + 14),
      place(540, 940, { scale: 0.55 }, group('figure', [o.figure(ctx, 'blueprint')])),
    ],
    thread(540, s + 16, { role: 'accents.0', H }),
  ];
}, { anchor: { name: 'stickyNote' } });

// X. Dark section devices (1.5 s): dotted arcs every `gap` around a still centre, dot bursts, a chalk
// figure, stars as grain, an optional caption in chalkDim.
export const darkSection = recipe('X', 'dark', {
  dur: 1.5, x: 540, y: 560, rings: 6, gap: 42, figure: (ctx) => boat({ mode: 'blueprint' }), scale: 1.2, caption: null, seed: 120,
}, (ctx, o) => {
  const g = ramp(0, 0.8, ctx.t, ease.out);
  return [
    grain([0, 0, ctx.W, ctx.H], 400, 'chalk', 0.5, o.seed, 1.6),
    Array.from({ length: o.rings }, (_, k) => dottedArc(o.x, o.y, 60 + (k + 1) * o.gap, 'chalkDim', o.seed + 1 + k)),
    dotBurst(o.x - 300, o.y + 280, 90, 12, 'accents.3', o.seed + 20, g), dotBurst(o.x + 310, o.y - 260, 70, 12, 'accents.1', o.seed + 21, g),
    place(o.x, o.y, { scale: o.scale }, group('figure', [o.figure(ctx, 'blueprint')])),
    o.caption && handText(o.caption, o.x, o.y + 320, { size: 30, role: 'chalkDim', ink2: null, align: 'center' }),
  ];
}, { ground: 'night', anchor: { name: 'figure' } });

// The sixteen swatches of Y, each (x, y, s, seed) => list in a cell s wide.
const SWATCHES = [
  (x, y, s, sd) => hexLattice([x, y, s, s], 14, 'ink', { alpha: 0.7 }),
  (x, y, s, sd) => [fill(rect(x, y, s, s), 'fills.0'), dots(rect(x, y, s, s), 'shade', { cell: 7, cov: 0.4, seed: sd })],
  (x, y, s, sd) => [1, 2, 3, 4].map((k) => dottedArc(x + s / 2, y + s / 2, k * s / 9, 'ink', sd + k)),
  (x, y, s, sd) => squiggleText([x + 10, y + 24, s - 20], 7, sd, { lineH: s / 8 }),
  ...[0.4, 1.2, 2.0, 2.8].map((a) => (x, y, s, sd) => hatchIn(rect(x, y, s, s), { angle: a, gap: 6, len: 14, jitter: 4, role: 'ink', alpha: 0.6, seed: sd })),
  (x, y, s, sd) => [fill(rect(x, y, s, s), 'fills.1'), dots(rect(x, y, s, s), 'inks.1', { cell: 8, cov: linear(x, y, x + s, y, 0, 0.9), angle: 0.26, jitter: 0.3, seed: sd })],
  (x, y, s, sd) => [fill(rect(x, y, s, s), 'night'), dotBurst(x + s / 2, y + s / 2, s * 0.4, 12, 'accents.2', sd)],
  (x, y, s, sd) => ripples(x + s / 2, y + s / 2, [s * 0.15, s * 0.3, s * 0.45], 'accents.0', sd, 2.5),
  (x, y, s, sd) => plant(x + s / 2, y + s - 6, s * 0.3, 3, sd),
  (x, y, s, sd) => aster(x + s / 2, y + s / 2, 8, 14, 'accents.1', sd, 1),
  (x, y, s, sd) => speedLines(x + s * 0.85, y + s / 2, 0, sd, { n: 8 }),
  (x, y, s, sd) => [fill(rect(x, y, s, s), 'fills.2'), clip(rect(x, y, s, s), [grain([x, y, s, s], 500, 'shade', 0.5, sd, 1.6)])],
  (x, y, s, sd) => construction(x + s / 2, y + s / 2, s * 0.25, sd, { role: 'ink' }),
];

// Y. Pattern sampler (1.5 s): a 4 x 4 grid, each cell a different lattice or mark, one more cell per drawn
// frame.
export const patternSampler = recipe('Y', 'sampler', {
  dur: 1.5, x: 120, y: 120, cell: 200, gap: 12, seed: 130,
}, (ctx, o) => {
  const n = Math.min(16, ctx.k + 1), kids = [];
  for (let j = 0; j < n; j++) {
    const x = o.x + (j % 4) * (o.cell + o.gap), y = o.y + Math.floor(j / 4) * (o.cell + o.gap), box = rect(x, y, o.cell, o.cell);
    kids.push(clip(box, [SWATCHES[j](x, y, o.cell, o.seed + j * 7)]), stroke(box, 'ink', { w: 1.6, wobble: 1, seed: o.seed + j, name: `edge${j}` }));
  }
  return group('sampler', kids);
}, { anchor: { name: 'sampler' } });

// Z. Enso (1.5 s): a thick brush circle draws itself round a thin figure, then the paper dims to chalk.
export const enso = recipe('Z', 'enso', {
  dur: 1.5, x: 540, y: 540, r: 300, w: 14, figure: (ctx) => boat({}), scale: 1.2, draw: [0.1, 0.9], dim: [1.0, 1.5], seed: 140,
}, (ctx, o) => {
  const p = ramp(o.draw[0], o.draw[1], ctx.t, ease.out), d = ramp(o.dim[0], o.dim[1], ctx.t);
  const q = rng(o.seed), pts = [];
  for (let j = 0; j <= 40; j++) { const a = -Math.PI / 2 + j / 40 * TAU * 0.94, rr = o.r * (1 + (q() - 0.5) * 0.03); pts.push(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr); }
  return [
    d > 0 && fill(frame(ctx), 'chalk', { alpha: 0.55 * d, name: 'dim' }),
    place(o.x, o.y, { scale: o.scale }, group('figure', [o.figure(ctx, 'ink')])),
    p > 0 && group('enso', [stroke(poly(pts, false), 'ink', { tool: 'brush', w: o.w, p, seed: o.seed })]),
  ];
}, { anchor: { name: 'figure' } });

// The doodle set, AA to AM.
export * from './doodle.js';
