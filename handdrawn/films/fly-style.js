// FLY STYLE. The fruit-fly film's kit: a fly on a peach, an ink blot into blueprint, the egg (spark,
// construction, doubling, bands), a flight over the kitchen floor with the camera following, and what
// the fly sees. Port of v1 examples/fly-style.html, built from recipes A to H, plus a sign-off (S) that
// v1 did not have. v1 wrote literal colours; here every colour is a paperInk role, so the film restyles.
// Beat sheet (v1 durations moved onto the 1/12 s grid)
// t      dur   shot     recipes   what happens
// 0.00   3.25  peach    A + B     fly on a hatched peach, push-in; at 2.4 an ink blot opens on blueprint
// 3.25   3.25  egg      C, D, E   spark, construction, egg outline, lattice; nuclei double 5 times; bands
// 6.50   2.25  flight   G         the fly crosses the kitchen, camera leading, speed lines and loops
// 8.75   0.92  eye      H         the room through a compound eye, cells shrinking from 40 to 13
// 9.67   2.50  signoff  S         "fly style"
import {
  film, seq, shot, cel, night, fill, stroke, clip, group, fx, meta, circle, ellipse, rect, poly, line, cubic,
  rng, hatchIn, grain, cross, hexCells, hex, cam, plucks, swell, cueNotes, travel, dyad, note, pentHz,
} from '../core/index.js';
import {
  ellipseRot, establishing, blotToBlueprint, sparkConstruct, doubling, bands, followTravel, povMosaic, signOffShot,
} from '../recipes/shots.js';

const TAU = Math.PI * 2;

// ---------- the fly (local coords, heading up = -y) ----------
const FLY = { head: ellipse(0, -40, 20, 18, 32), thorax: ellipse(0, 0, 26, 30, 36), abd: ellipse(0, 54, 27, 46, 44) };
const EYES = [[-1, ellipseRot(-19, -44, 13, 15, -0.3, 28)], [1, ellipseRot(19, -44, 13, 15, 0.3, 28)]];
const PARTS = [['abd', 'fills.1'], ['thorax', 'fills.2'], ['head', { base: 'fills.1', tint: 0.08 }]];

function wing(side, ang) {
  const px = side * 10, py = -8, dx = side * Math.sin(ang), dy = Math.cos(ang), cx = px + dx * 58, cy = py + dy * 58, rot = Math.atan2(dy, dx);
  return { cx, cy, rot, path: ellipseRot(cx, cy, 60, 20, rot, 40) };
}
// A quadratic Bezier as a polyline.
const quad = (p0, q, p1) => cubic(p0, [p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1])], [p1[0] + 2 / 3 * (q[0] - p1[0]), p1[1] + 2 / 3 * (q[1] - p1[1])], p1, 10);

function compoundEye(side, path, ink) {
  const box = [side * 19 - 14, -60, 28, 32], cells = hexCells(box, 3.4), buckets = [[], [], []];
  for (const [x, y] of cells) { const l = Math.max(0, Math.min(1, 1 - Math.hypot(x - side * 13, y + 50) / 26)); buckets[Math.min(2, Math.floor(l * 3))].push(...hex(x, y, 3.4).sub); }
  const all = { sub: buckets.flat(), box };
  return clip(path, ink ? [
    fill(path, { base: 'blush', shade: 0.15 }),
    ...buckets.map((sub, j) => sub.length && fill({ sub, box }, { base: 'blush', shade: 0.35 - j * 0.2, tint: j === 2 ? 0.35 : 0 }, { name: `facets${j}` })),
    stroke(all, { base: 'blush', shade: 0.7 }, { w: 0.6, wobble: 0, alpha: 0.55, name: 'facetLines' }),
    fill(circle(side * 14, -51, 2.6, 10), 'light', { alpha: 0.85 }),
  ] : [
    stroke(all, 'chalk', { w: 0.7, wobble: 0, alpha: 0.75 }),
    fill(circle(side * 14, -51, 2.4, 10), 'chalk'),
  ]);
}

// pose: wing (angle from the body axis), flap (0 | 1: three ghost wings), legs (0..1 tucked), walk (phase)
export const fly = cel('fly', ({ mode = 'ink', wing: ang = 0.55, flap = 0, legs = 0, walk = 0 }) => {
  const ink = mode === 'ink', ln = ink ? 'ink' : 'chalk', lw = ink ? 2.2 : 2.4, out = [];
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    const y0 = -14 + i * 14, ph = Math.sin(walk * TAU + i * 2.1 + s) * 6 * (1 - legs);
    const pts = [s * 22, y0, s * (40 - legs * 10), y0 - 12 + ph + i * 4, s * (60 - legs * 22), y0 + 2 + ph + i * 8, s * (70 - legs * 30), y0 + 26 + ph + i * 10];
    out.push(stroke(poly(pts, false), ln, { w: ink ? 2 : 1.8, wobble: 1.5, alpha: ink ? 0.95 : 0.9, name: `leg${i}${s}` }));
  }
  const ghosts = flap > 0 ? [-1, 0, 1] : [0];
  for (const s of [-1, 1]) for (const g of ghosts) {
    const wg = wing(s, ang + g * 0.22 * flap), nm = `wing${s}${g}`;
    if (ink) {
      const veins = [-1, 0, 1].flatMap((k) => {
        const c = Math.cos(wg.rot), sn = Math.sin(wg.rot), a = [wg.cx - c * 52, wg.cy - sn * 52], e = [wg.cx + c * 55 - sn * k * 13, wg.cy + sn * 55 + c * k * 13];
        return quad(a, [(wg.cx + e[0]) / 2 - sn * k * 10, (wg.cy + e[1]) / 2 + c * k * 10], e).sub;
      });
      out.push(fill(wg.path, { base: 'chalk', alpha: 0.34 / ghosts.length + 0.06 }, { name: nm }),
        stroke(wg.path, { base: 'ink', alpha: 0.55 }, { w: 1.2, wobble: 1.2, name: `${nm}l` }),
        stroke({ sub: veins, box: wg.path.box }, { base: 'ink', alpha: 0.5 }, { w: 0.9, wobble: 0, name: `${nm}v` }));
    } else out.push(stroke(wg.path, { base: 'chalk', alpha: 0.8 }, { w: 1.4, wobble: 1.2, name: `${nm}l` }));
  }
  for (const [k, role] of PARTS) {
    const p = FLY[k];
    if (ink) {
      out.push(fill(p, role, { finish: true, name: k }));
      if (k === 'abd') out.push(clip(p, [stroke({ sub: [0, 1, 2, 3, 4].flatMap((i) => quad([-30, 23 + i * 16], [0, 32 + i * 16], [30, 23 + i * 16]).sub), box: p.box }, 'shade', { w: 7, wobble: 0, alpha: 0.9, name: 'stripes' })]));
    }
    out.push(stroke(p, ln, { w: lw, wobble: 1.8, name: `${k}Line` }));
  }
  for (const [s, p] of EYES) out.push(compoundEye(s, p, ink), stroke(p, ln, { w: 1.6, wobble: 1.2, name: `eye${s}` }));
  for (const s of [-1, 1]) out.push(stroke(poly([s * 6, -56, s * 12, -70, s * 20, -74], false), ln, { w: 1.4, wobble: 1, name: `ant${s}` }), stroke(circle(s * 20, -74, 2.2, 10), ln, { w: 1.4, wobble: 0, name: `knob${s}` }));
  if (!ink) return out;
  return [fx('scribble', { amp: 5, alpha: 0.5, only: ['thorax', 'abd'] }, out, { seed: 91 })];
}, { box: [-132, -112, 264, 218], inputs: { wing: [0, 2, 0.01], flap: [0, 1, 1], legs: [0, 1, 0.5], walk: [0, 1, 0.05] }, desc: 'a fruit fly; mode ink | blueprint' });

// ---------- peach (A + B) ----------
const twitch = (k) => (k % 9 === 0 ? 0.18 : 0);
const peachScene = (ctx, mode) => establishing.layer(ctx, {
  mode, push: [1.15, 1.3], pushOver: 2.4, at: [540, 520],
  ground: { x: 560, y: 980, r: 700, role: 'fills.0' },
  patches: [
    { x: 300, y: 560, r: 420, angle: 0.8, gap: 6, len: 16, jitter: 6, role: 'light', alpha: 0.6, w: 1.4 },
    { x: 820, y: 1150, r: 620, angle: -0.6, gap: 5, len: 18, jitter: 5, role: 'blush', alpha: 0.38, w: 1.2 },
    { x: 860, y: 1200, r: 480, angle: 0.9, gap: 6, len: 20, jitter: 5, role: { base: 'blush', shade: 0.3 }, alpha: 0.35, w: 1.1 },
  ],
  x: 520, y: 430, rot: -0.17, scale: 1.9, construction: { y: 10, r: 120, alpha: 0.8 }, scribble: false,
  subject: (c, m) => fly({ mode: m, wing: 0.55 + twitch(c.k) }),
  extras: (c, m) => m === 'ink' && [
    fill(circle(215, 690, 15, 24), { base: 'light', alpha: 0.55 }, { name: 'dew' }), stroke(circle(215, 690, 15, 24), 'ink', { w: 2, wobble: 0 }),
    fill(ellipse(219, 694, 6, 4, 16), { base: 'light', tint: 0.5, alpha: 0.9 }), fill(circle(209, 684, 2, 8), { base: 'light', tint: 0.5, alpha: 0.9 }),
    stroke({ sub: [...cross(300, 300, 8).sub, ...cross(760, 640, 8).sub], box: [292, 292, 476, 356] }, 'guide', { w: 0.9, wobble: 0, name: 'crosses' }),
  ],
});
const peach = blotToBlueprint({ name: 'peach', dur: 3.25, t0: 2.4, span: 0.8, x: 560, y: 380, reach: 1000, scene: peachScene, anchor: { cel: 'fly' } });

// ---------- egg (C, D, E) ----------
const EGG = { x: 540, y: 560, rx: 205, ry: 330, rot: -0.42 };
const DOUBLINGS = [1.1, 1.4, 1.7, 2.0, 2.3];
const polar = (t) => {
  const pe = Math.max(0, Math.min(1, (t - 0.7) / 0.4));
  if (pe <= 0.5) return null;
  const tx = EGG.x + Math.sin(EGG.rot) * EGG.ry * 0.96, ty = EGG.y - Math.cos(EGG.rot) * EGG.ry * 0.96;
  return group('polar', [[-70, -95, 22], [-18, -118, 19]].flatMap(([dx, dy, r0]) => [
    stroke(line(tx, ty, tx + dx, ty + dy), 'chalk', { w: 2, wobble: 0 }),
    fill(ellipseRot(tx + dx, ty + dy - 8, r0, r0 * 1.25, 0.4, 24), { base: 'guide' }),
  ]));
};
const egg = shot('egg', 3.25, (ctx) => [
  night(),
  sparkConstruct.layer(ctx, { body: EGG }),
  polar(ctx.t),
  doubling.layer(ctx, { body: EGG, cues: DOUBLINGS, from: 1.0, fade: [2.4, 2.8] }),
  bands.layer(ctx, { body: EGG, from: 2.4, every: 0.11 }),
  meta('anchor', { name: 'shape' }),
], { recipe: 'C+D+E' });

// ---------- the kitchen floor (world coordinates) ----------
const ROOM_BG = { base: 'chalk', mix: ['paper', 0.5] }, INK = 'ink';
export const room = cel('room', () => {
  const tiles = [], specks = [], crosses = [];
  for (let i = -1; i < 22; i++) for (let j = -1; j < 22; j++) if ((i + j) % 2) {
    tiles.push(...rect(i * 120 + 8, j * 120 + 8, 104, 104).sub);
    specks.push(grain([i * 120 + 8, j * 120 + 8, 104, 104], 14, { base: 'inks.2', tint: 0.2 }, 0.35, 21 + i * 31 + j, 2));
  }
  for (let i = 0; i < 22; i++) for (let j = 0; j < 22; j++) crosses.push(...cross(i * 120, j * 120, 4).sub);
  const r = rng(24), woodgrain = [];
  for (let i = 0; i < 40; i++) { const y = 260 + r() * 740; woodgrain.push({ pts: [910, y, 1200, y + (r() - 0.5) * 20, 1500, y + (r() - 0.5) * 20, 1850, y], closed: false }); }
  const px = 1380, py = 650, gr = rng(29), grapes = [];
  for (let i = 0; i < 9; i++) grapes.push([px + 80 + (gr() - 0.5) * 90, py + 70 + (gr() - 0.5) * 70]);
  const orange = circle(px - 60, py - 20, 85);
  return [
    fill(rect(-200, -200, 2800, 2800), ROOM_BG, { name: 'floor' }),
    fill({ sub: tiles, box: [-112, -112, 2744, 2744] }, { base: 'inks.2', tint: 0.6 }, { name: 'tiles' }),
    ...specks,
    stroke({ sub: crosses, box: [-4, -4, 2528, 2528] }, { base: 'ink', alpha: 0.35 }, { w: 1, wobble: 0, name: 'crosses' }),
    fill(rect(900, 250, 960, 760), 'fills.3', { name: 'table' }),
    stroke({ sub: woodgrain, box: [900, 250, 960, 760] }, { base: 'shade', alpha: 0.35 }, { w: 1.2, wobble: 3, seed: 61, name: 'woodgrain' }),
    stroke(rect(900, 250, 960, 760), INK, { w: 3, wobble: 2.5, name: 'tableEdge' }),
    fill(circle(px, py, 230, 80), { base: 'light', tint: 0.3 }, { name: 'plate' }),
    stroke(circle(px, py, 215, 80), { base: 'accents.1', mix: ['ink', 0.35] }, { w: 5, wobble: 0 }),
    stroke(circle(px, py, 230, 80), INK, { w: 2.5, wobble: 2 }),
    stroke({ sub: [1, 2, 3, 4, 5].flatMap((k) => circle(px, py, 40 * k, 48).sub), box: [px - 200, py - 200, 400, 400] }, { base: 'chalkDim', alpha: 0.6 }, { w: 1, wobble: 0 }),
    fill(orange, 'fills.0', { name: 'orange' }),
    hatchIn(orange, { angle: 1, gap: 5, len: 12, jitter: 4, role: { base: 'fills.0', shade: 0.3 }, alpha: 0.4, seed: 27 }),
    stroke(orange, INK, { w: 2.5, wobble: 2, seed: 28 }),
    ...grapes.flatMap(([x, y], i) => [
      fill(circle(x, y, 22, 24), { base: 'inks.1', mix: ['inks.2', 0.6] }, { name: `grape${i}` }),
      stroke(circle(x, y, 22, 24), INK, { w: 2, wobble: 0 }),
      fill(circle(x - 6, y - 7, 5, 10), { base: 'light', alpha: 0.5 }),
    ]),
  ];
}, { desc: 'the kitchen floor, table, plate and fruit (world coordinates)' });

// ---------- flight (G) and eye (H) ----------
const flight = followTravel({
  name: 'flight', dur: 2.25, path: [[300, 2000], [1300, 1500], [500, 700], [1900, 450]], lead: 120, bg: ROOM_BG,
  world: () => [room()], subject: () => fly({ wing: 1.25, flap: 1, legs: 1 }),
});
const eye = povMosaic({
  name: 'eye', dur: 11 / 12, s: [40, 13], over: 0.7,
  world: (ctx) => [fill(rect(-2, -2, ctx.W + 4, ctx.H + 4), ROOM_BG), cam({ x: 1380, y: 650, zoom: 0.8, W: ctx.W, H: ctx.H }, [room()])],
});
const signoff = signOffShot({ name: 'signoff', a: 'fly', b: 'style', rings: [260, 330], y: 500 });

// ---------- score (v1 buildScore on the cues) ----------
const score = ({ shots }) => {
  const at = Object.fromEntries(shots.map((s) => [s.name, s]));
  return {
    master: 0.6,
    events: [
      plucks(0, 2.4, { every: 0.5, len: 0.7, gain: 0.2 }),
      swell(2.4, 1.2),
      cueNotes(DOUBLINGS.map((t) => at.egg.t0 + t), { oct: 1, len: 0.5, gain: 0.22 }),
      Array.from({ length: 7 }, (_, i) => note(at.egg.t0 + 2.4 + i * 0.11, pentHz(2, i % 5), 0.25, 'triangle', 0.14)),
      travel(at.flight.t0, at.flight.dur),
      dyad(at.signoff.t0, 1.0, { root: [-1, 0], third: [0, 2] }),
    ],
  };
};

export default film({ name: 'fly-style', look: 'paperInk', timeline: seq(peach, egg, flight, eye, signoff), score });
