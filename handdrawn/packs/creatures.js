// The creatures pack: cels to place in films (plan 1.6). Cels are copied in from films by `hdf donate`
// (between the donated markers; donate again to update one) or drawn here. packs/manifest.json lists them
// with their box, inputs and description; packs/sheets/<cel>.jpg shows each in every look.

import {
  cel, stroke, poly, cubic, fill, ellipse, clip, hexCells, hex, circle, fx, traced, clipFromStore, pen,
} from '../core/index.js';
import { ellipseRot } from '../recipes/shots.js';
import { fromStore } from '../core/assets.js';
import { hog } from '../recipes/doodle.js';

// ---- donated: horse from films/gallop.js ----
fromStore(['horse']);
clipFromStore('horse');
// One traced pose as a cel, ground point at the origin, 300 units tall (for sheets and packs).
export const horse = cel('horse', ({ pose = 0, flip = 0 }) => [
  traced('horse', pose, { x: 0, y: 0, h: 300, flip: !!flip, wash: 'fills.0', seed: 5 }),
], { box: [-240, -310, 480, 320], inputs: { pose: [0, 11, 1], flip: [0, 1, 1] }, desc: 'a galloping horse: one of 12 Muybridge poses traced from film (found motion); feet at the origin' });
// ---- end horse ----

// ---- donated: hedgehog from films/held-once.js ----
// The hedgehog as a timeless cel (drawn complete): the cast member of every doodle recipe, for sheets and packs.
// dir 1 faces +x; eye 'dot' | 'happy' | 'sleep' | 'wide'; fright lifts the quills.
export const hedgehog = cel('hedgehog', ({ dir = 1, eye = 'happy', scarf = 'accents.0', fright = 0 }) => [
  pen(99, 0, -9, 3, (d) => hog(d, 0, 0, 60, { dir, eye, scarf, fright, w: 4.2 }), { still: true }),
], { box: [-110, -100, 220, 156], inputs: { dir: [-1, 1, 2], fright: [0, 1, 0.25] }, desc: 'the doodle hedgehog with a scarf; eye dot | happy | sleep | wide' });
// ---- end hedgehog ----

// ---- donated: fly from films/fly-style.js ----
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
}, { box: [-132, -112, 264, 224], inputs: { wing: [0, 2, 0.01], flap: [0, 1, 1], legs: [0, 1, 0.5], walk: [0, 1, 0.05] }, desc: 'a fruit fly; mode ink | blueprint' });
// ---- end fly ----
