// The hands pack (4.0 T6): a drawn hand that writes. writingHand is the cel, writer puts it on the pen tip of
// anything being written on, so any lettering or diagram can be "written by hand".
//
//   writer(node, t, { tool, side, skin, ink, scale, look, ...writeOn's options })   the hand on node's pen
//   writer(node, t, { p })                                                           ...at reveal progress p
//   writer(node, t, { by: { actor, at: [x, y, s], state, prop } })   4.0 K8: the actor's own hand writes, the
//                                                                    prop (heldTool's, attached) its point
//   heldTool({ tool: 'chalk', ink })   the tool alone as a prop (core/props.js attach): { node, grip, tip }
//
// Draw the writer after the node, in the same coordinates (inside the same place / cam), so it sits on top.

import { bounds, circle, fill, group, mapPaths, mmul, poly, rotate, stroke, translate, withProps, xf } from '../core/list.js';
import { held, propAt } from '../core/props.js';
import { cel, place } from '../core/tree.js';
import { resolveLook } from '../core/looks.js';
import { writing } from '../core/write.js';
import { penAt } from '../core/tools.js';

const TOOLS = ['pen', 'marker', 'chalk', 'crayon'];
const LINE = { w: 2.6, wobble: 1 };
const A = 55 * Math.PI / 180, U = [Math.cos(A), Math.sin(A)], N = [-Math.sin(A), Math.cos(A)];
// A point s along the tool from its tip and n across it (n > 0 towards the lower left, the fingers' side).
const at = (s, n) => [U[0] * s + N[0] * n, U[1] * s + N[1] * n];
// A closed outline through points given as [s, n] pairs.
const outline = (sn) => poly(sn.map(([s, n]) => at(s, n)), true);
// An oval centred s along and n across, rs long and rn wide, turned with the tool.
const oval = (s, n, rs, rn, k = 20) => outline(Array.from({ length: k }, (_, j) => { const a = (j / k) * Math.PI * 2; return [s + Math.cos(a) * rs, n + Math.sin(a) * rn]; }));

// Each tool: its length, width, how long its point is, where the hand grips it, the body's role and the
// point's (i: the ink input, an index into the look's inks).
const SPEC = {
  pen: { L: 150, W: 9, tipL: 16, grip: 62, body: (i) => `inks.${i}`, tip: () => 'ink' },
  marker: { L: 168, W: 22, tipL: 20, grip: 78, body: () => 'light', tip: (i) => `inks.${i}`, cap: (i) => `inks.${i}` },
  chalk: { L: 84, W: 14, tipL: 0, grip: 40, body: () => 'light', tip: () => 'light' },
  crayon: { L: 124, W: 15, tipL: 18, grip: 60, body: (i) => `inks.${i}`, tip: (i) => `inks.${i}`, wrap: true },
};

// The tool, point at (0, 0), lying along the hand's axis.
function toolOf(kind, ink) {
  const T = SPEC[kind], h = T.W / 2, out = [];
  const body = outline([[T.tipL, -h], [T.L, -h], [T.L, h], [T.tipL, h]]);
  out.push(fill(body, T.body(ink), { name: 'barrel' }), stroke(body, 'ink', { ...LINE, w: 2.2 }));
  if (T.cap) {
    const cap = outline([[T.L - 34, -h - 1.5], [T.L + 4, -h - 1.5], [T.L + 4, h + 1.5], [T.L - 34, h + 1.5]]);
    out.push(fill(cap, T.cap(ink), { name: 'cap' }), stroke(cap, 'ink', { ...LINE, w: 2.2 }));
  }
  if (T.wrap) {
    const wrap = outline([[T.tipL + 14, -h - 1], [T.L - 10, -h - 1], [T.L - 10, h + 1], [T.tipL + 14, h + 1]]);
    out.push(fill(wrap, 'paper', { name: 'wrapper' }), stroke(wrap, 'ink', { ...LINE, w: 1.8 }),
      stroke(poly([at(T.tipL + 30, -h + 2), at(T.L - 26, -h + 2)], false), T.body(ink), { w: 2, wobble: 0.6, name: 'stripe' }));
  }
  if (T.tipL) {
    const nib = outline([[0, -1.5], [T.tipL, -h * 0.75], [T.tipL, h * 0.75], [0, 1.5]]);
    out.push(fill(nib, T.tip(ink), { name: 'nib' }), stroke(nib, 'ink', { ...LINE, w: 2 }));
  } else {
    const end = oval(4, 0, 5, h * 0.9, 12);
    out.push(fill(end, T.tip(ink), { name: 'nib' }));
  }
  return group('tool', out);
}

// A hand holding a writing tool, seen from a three-quarter view above: the point at (0, 0), the tool running
// down and to the right into a loose fist, thumb over it, three fingers curled round it, the wrist and a cuff
// going off down to the right. tool: 0 pen, 1 marker, 2 chalk, 3 crayon; ink: which of the look's inks the
// tool carries; skin: a role (a light warm tint of the paper's light by default).
export const writingHandCel = cel('writing-hand', ({ tool = 1, ink = 0, skin = { base: 'light', mix: ['blush', 0.35] } }) => {
  const kind = TOOLS[tool] ?? 'marker', g = SPEC[kind].grip, dark = { base: skin, shade: 0.12 };
  const back = oval(g + 50, -26, 58, 40, 24);
  // The wrist and forearm: from behind the knuckles down to the right, steeper than the tool; a cuff over it.
  const w0 = at(g + 88, -30), dir = [Math.cos(A + 0.28), Math.sin(A + 0.28)], nx = -dir[1], ny = dir[0];
  const arm = (d0, d1, r0, r1) => poly([
    [w0[0] + dir[0] * d0 + nx * r0, w0[1] + dir[1] * d0 + ny * r0], [w0[0] + dir[0] * d1 + nx * r1, w0[1] + dir[1] * d1 + ny * r1],
    [w0[0] + dir[0] * d1 - nx * r1, w0[1] + dir[1] * d1 - ny * r1], [w0[0] + dir[0] * d0 - nx * r0, w0[1] + dir[1] * d0 - ny * r0],
  ], true);
  const fore = arm(-30, 150, 36, 40), cuff = arm(110, 250, 48, 50);
  const fingers = [0, 1, 2].map((k) => oval(g + 4 + k * 21, 12 + k * 3, 13, 21, 18));
  const thumb = outline([[g - 30, -10], [g - 12, -18], [g + 30, -30], [g + 34, -14], [g + 4, -4], [g - 26, 2]]);
  const nail = oval(g - 22, -6, 7, 5, 12);
  return [
    fill(fore, skin, { name: 'wrist' }), stroke(fore, 'ink', LINE),
    fill(cuff, 'fills.0', { name: 'cuff' }), stroke(cuff, 'ink', LINE),
    fill(back, skin, { name: 'back' }), stroke(back, 'ink', LINE),
    toolOf(kind, ink),
    ...fingers.flatMap((f, k) => [fill(f, k ? skin : dark, { name: `finger${k}` }), stroke(f, 'ink', LINE)]),
    fill(thumb, skin, { name: 'thumb' }), stroke(thumb, 'ink', LINE),
    stroke(nail, 'ink', { w: 1.6, wobble: 0.5, name: 'nail' }),
  ];
}, { box: [-10, -8, 264, 384], inputs: { tool: [0, 3, 1], ink: [0, 3, 1] }, desc: 'a hand holding a pen, marker, chalk or crayon, its point at (0, 0), the arm off down to the right' });

// writingHand({ tool: 'pen' | 'marker' | 'chalk' | 'crayon', side: 'r' | 'l', skin, ink }) => the cel of a
// hand holding that tool, point at (0, 0): a right hand by default, mirrored for 'l' (the arm off to the left).
export function writingHand({ tool = 'marker', side = 'r', skin, ink = 0 } = {}) {
  const i = TOOLS.indexOf(tool);
  if (i < 0) throw new TypeError(`writingHand: tool '${tool}' is not one of ${TOOLS.join(', ')}`);
  if (side !== 'r' && side !== 'l') throw new TypeError(`writingHand: side '${side}' is not 'r' or 'l'`);
  const c = writingHandCel(skin === undefined ? { tool: i, ink } : { tool: i, ink, skin });
  return side === 'l' ? place(0, 0, { flip: true }, c) : c;
}

// The tool alone, to be held (4.0 K8): lying along +x, gripped at the origin (where the drawn hand grips it),
// its point at [grip, 0] ahead of the fist.
const lying = (kind, ink) => {
  const m = mmul(translate(SPEC[kind].grip, 0), rotate(Math.PI - A));
  return [withProps(toolOf(kind, ink), { kids: mapPaths(toolOf(kind, ink).kids, (path) => xf(path, m)), name: kind })];
};
const LYING = TOOLS.map((k) => bounds(lying(k, 0))).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
  Math.max(a[0] + a[2], b[0] + b[2]) - Math.min(a[0], b[0]), Math.max(a[1] + a[3], b[1] + b[3]) - Math.min(a[1], b[1])]);
export const heldToolCel = cel('held-tool', ({ tool = 2, ink = 0 }) => lying(TOOLS[tool] ?? 'chalk', ink), { box: LYING.map((v, j) => Math.round(v + (j < 2 ? -3 : 6))), inputs: { tool: [0, 3, 1], ink: [0, 3, 1] }, desc: 'a pen, marker, chalk or crayon on its own, gripped at the origin, its point ahead along +x' });

// heldTool({ tool, ink }) => { node, grip, tip, name }: what attach(actor, 'hand-r', ...) holds.
export function heldTool({ tool = 'chalk', ink = 0 } = {}) {
  const i = TOOLS.indexOf(tool);
  if (i < 0) throw new TypeError(`heldTool: tool '${tool}' is not one of ${TOOLS.join(', ')}`);
  return Object.freeze({ node: heldToolCel({ tool: i, ink }), grip: [0, 0], tip: [SPEC[tool].grip, 0], name: tool });
}

// The tool a look writes with: the whiteboard's marker, chalk on a chalk look, else the pen.
export const toolFor = (look) => {
  if (!look) return 'pen';
  const L = resolveLook(look);
  return L.penTool === 'bullet' ? 'marker' : L.chalkPass ? 'chalk' : 'pen';
};

// writer(node, t, o) => a group: the writing hand on node's pen tip at shot time t, following writeOn(node,
// { t, ...o }) (same options: at, per, wps, lead, lift, exit), coming in from off the frame over the lead,
// lifted off the surface between units (a small shadow stays at the point), gone after the last; null when it
// is not there. With o.p (0..1) it follows reveal(p, node) instead, down while 0 < p < 1 and absent otherwise
// (o.leave 0..1 takes it away from the end). tool (default the look's: toolFor(o.look)), side, skin, ink:
// writingHand's; scale the hand's size (1: about 360 units from point to cuff).
// by (4.0 K8): { actor, at: [x, y, s], state, prop, elbow } -- a puppet writes instead of a drawn hand: it is
// placed at `at` holding the prop (attach's, its tip the point) and reaches (core/props.js held) so the tip
// follows the pen, raising the arm over the lead, lifting between units, lowering it after the last. It is
// always drawn (at `state`, the prop in hand, while the pen is not there). node must be in stage coordinates.
export function writer(node, t, o = {}) {
  const { tool = toolFor(o.look), side = 'r', skin, ink = 0, scale = 1, p, leave, look, by, ...sched } = o;
  let pen;
  if (typeof p === 'number') {
    const done = p >= 1 && typeof leave === 'number' && leave < 1;
    if (!(p > 0 && p < 1) && !done) pen = null;
    else pen = { ...penAt(Math.min(p, 1), node), down: !done, lift: done ? 1 : 0, enter: 1, leave: done ? leave : 0 };
  } else pen = writing(node, sched).pen(t);
  if (by) return byActor(by, pen, scale);
  if (!pen) return null;
  const sx = side === 'l' ? -1 : 1, off = 900 * scale, away = (1 - pen.enter) + pen.leave;
  const x = pen.x + sx * off * 0.62 * away + sx * pen.lift * 7 * scale, y = pen.y + off * away - pen.lift * 13 * scale;
  const rot = sx * 0.05 * Math.sin(pen.x / 140);
  return group('writer', [
    pen.lift > 0 && pen.enter >= 1 && pen.leave === 0 && fill(circle(pen.x, pen.y, 4 * scale, 12), { base: 'shade', alpha: 0.22 * pen.lift }, { name: 'tipShadow' }),
    place(x, y, { rot, scale: scale * (1 + 0.04 * pen.lift) }, writingHand({ tool, side, skin, ink })),
  ]);
}

// The writer as a puppet holding a prop: its tip on the pen (see writer).
function byActor({ actor, at, state = {}, prop, elbow }, pen, scale) {
  if (!actor?.puppet) throw new TypeError('writer by: needs { actor } a puppet, which holds the prop');
  if (prop?.kind !== 'prop') throw new TypeError(`writer by ${actor.name}: needs { prop }, attach(${actor.name}, socket, heldTool(...))`);
  if (!Array.isArray(at) || at.length !== 3) throw new TypeError(`writer by ${actor.name}: at is its place [x, y, s]`);
  const [x, y, s] = at, props = [...[state.props ?? []].flat(), prop];
  if (!pen) return group('writer', [actor.place(x, y, s, { ...state, props })]);
  const away = Math.min(1, Math.max(0, (1 - pen.enter) + pen.leave));
  const hang = propAt(actor, prop, at, state);
  const up = [pen.x - pen.lift * 6 * scale, pen.y - pen.lift * 12 * scale];
  const target = [up[0] + (hang[0] - up[0]) * away, up[1] + (hang[1] - up[1]) * away];
  const patch = away >= 1 ? {} : held(actor, prop, target, { at, state, elbow });
  return group('writer', [
    pen.lift > 0 && pen.enter >= 1 && pen.leave === 0 && fill(circle(pen.x, pen.y, 4 * scale, 12), { base: 'shade', alpha: 0.22 * pen.lift }, { name: 'tipShadow' }),
    actor.place(x, y, s, { ...state, ...patch, props }),
  ]);
}
