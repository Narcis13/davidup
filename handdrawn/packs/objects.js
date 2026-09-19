// The objects pack: cels to place in films (plan 1.6). Cels are copied in from films by `hdf donate`
// (between the donated markers; donate again to update one) or drawn here. packs/manifest.json lists them
// with their box, inputs and description; packs/sheets/<cel>.jpg shows each in every look.

import {
  cel, fill, stroke, circle, ellipse, rect, roundRect, poly, line, spline, cubic, union, radial, squiggleText,
} from '../core/index.js';

const LINE = { w: 2.6, wobble: 1.6 };

// A round teapot, spout to the left, standing on y = 0. lid: 0 on, 1 lifted; steam: 0 | 1.
export const teapot = cel('teapot', ({ lid = 0, steam = 0 }) => {
  const body = spline([[-70, -8], [-78, -52], [-48, -92], [0, -100], [48, -92], [78, -52], [70, -8], [40, 0], [-40, 0]], { closed: true, tension: 0.2 });
  const spout = poly([[-66, -40], [-104, -64], [-124, -96], [-112, -100], [-96, -76], [-60, -64]]);
  const handle = spline([[66, -78], [104, -80], [112, -46], [86, -18], [70, -20], [92, -44], [88, -66], [68, -62]], { closed: true, tension: 0.3 });
  const up = lid * 26, lidPath = ellipse(0, -100 - up, 40, 10, 24), knob = circle(0, -114 - up, 7, 16);
  return [
    fill(handle, 'fills.1', { name: 'handle' }), stroke(handle, 'ink', LINE),
    fill(spout, 'fills.1', { finish: true, name: 'spout' }), stroke(spout, 'ink', LINE),
    fill(body, 'fills.1', { finish: true, name: 'body' }),
    stroke(spline([[-60, -54], [0, -44], [60, -54]], { tension: 0.3 }), 'accents.0', { w: 5, wobble: 1.2, alpha: 0.8, name: 'band' }),
    stroke(body, 'ink', LINE),
    fill(lidPath, 'fills.2', { name: 'lid' }), stroke(lidPath, 'ink', { w: 2.2, wobble: 1 }),
    fill(knob, 'fills.2'), stroke(knob, 'ink', { w: 2, wobble: 0.6 }),
    steam && stroke(union(...[-18, 6, 30].map((x, k) => spline([[x, -128 - up], [x - 10, -150 - up - k * 4], [x + 6, -172 - up - k * 6], [x - 4, -194 - up - k * 8]], { tension: 0.2 }))), 'shade', { w: 2.2, wobble: 1.4, alpha: 0.8, name: 'steam' }),
  ];
}, { box: [-128, -214, 244, 218], inputs: { lid: [0, 1, 0.25], steam: [0, 1, 1] }, desc: 'a round teapot on y = 0, spout left; lid lifts, steam on' });

// A desk lamp: a weighted base on y = 0, an arm up to a cone shade that opens down and to the right.
// on: 0 | 1 (bulb lit, a pool of light and rays).
export const lamp = cel('lamp', ({ on = 0 }) => {
  const base = roundRect(-60, -18, 120, 18, 8), j0 = [-10, -18], j1 = [-40, -130], j2 = [30, -200];
  const shade = poly([[22, -214], [48, -196], [128, -150], [66, -104]]);
  const bulb = circle(96, -128, 14, 16);
  const rays = union(...[0.2, 0.75, 1.3].map((a) => line(96 + Math.cos(a) * 44, -128 + Math.sin(a) * 44, 96 + Math.cos(a) * 96, -128 + Math.sin(a) * 96)));
  return [
    on && fill(circle(110, -80, 140, 48), 'light', { cov: radial(110, -80, 10, 140, 0.9, 0), name: 'pool' }),
    fill(base, 'fills.3', { finish: true, name: 'base' }), stroke(base, 'ink', LINE),
    stroke(poly([j0, j1, j2], false), 'ink', { w: 5, wobble: 1.2, name: 'arms' }),
    ...[j0, j1, j2].map((p) => fill(circle(p[0], p[1], 6, 12), 'ink')),
    fill(bulb, on ? 'light' : { base: 'paper', shade: 0.15 }, { name: 'bulb' }), stroke(bulb, 'ink', { w: 1.8, wobble: 0.8 }),
    fill(shade, 'fills.3', { finish: true, name: 'shade' }), stroke(shade, 'ink', LINE),
    on && stroke(rays, 'accents.2', { w: 2.4, wobble: 1, name: 'rays' }),
  ];
}, { box: [-80, -224, 336, 290], inputs: { on: [0, 1, 1] }, desc: 'a desk lamp standing on y = 0, shade opening down and right; on lights a pool' });

// A hardback book lying flat, centred on the origin: shut (open 0) with a cover panel, or open flat (open 1)
// as a spread with scribbled lines of text.
export const book = cel('book', ({ open = 0 }) => {
  if (!open) {
    const cover = roundRect(-90, -120, 180, 240, 6), spine = rect(-90, -120, 18, 240), panel = roundRect(-50, -80, 110, 60, 4);
    return [
      fill(cover, 'fills.0', { finish: true, name: 'cover' }),
      fill(spine, { base: 'fills.0', shade: 0.3 }, { name: 'spine' }),
      fill(panel, 'light', { name: 'panel' }), stroke(panel, 'ink', { w: 1.8, wobble: 0.8 }),
      stroke(union(line(-36, -60, 44, -60), line(-30, -44, 34, -44)), 'ink', { w: 2, wobble: 1.2, name: 'title' }),
      stroke(cover, 'ink', LINE), stroke(line(-72, -118, -72, 118), 'ink', { w: 1.6, wobble: 0.8 }),
    ];
  }
  const leaf = (s) => poly([[0, -104], [s * 60, -116], [s * 150, -112], [s * 150, 104], [s * 60, 112], [0, 104]]);
  const text = (s) => union(...Array.from({ length: 9 }, (_, k) => {
    const y = -84 + k * 20, x0 = s * 22, x1 = s * (k === 8 ? 90 : 128);
    return cubic([x0, y], [(2 * x0 + x1) / 3, y - 3], [(x0 + 2 * x1) / 3, y + 3], [x1, y], 6);
  }));
  return [
    fill(roundRect(-160, -122, 320, 240, 6), 'fills.0', { finish: true, name: 'boards' }),
    fill(leaf(-1), 'light', { name: 'left' }), fill(leaf(1), 'light', { name: 'right' }),
    stroke(text(-1), 'shade', { w: 1.6, wobble: 1.6, alpha: 0.7, name: 'textL' }), stroke(text(1), 'shade', { w: 1.6, wobble: 1.6, alpha: 0.7, name: 'textR' }),
    stroke(leaf(-1), 'ink', LINE), stroke(leaf(1), 'ink', LINE),
    stroke(line(0, -104, 0, 104), 'ink', { w: 2, wobble: 0.6, name: 'gutter' }),
  ];
}, { box: [-166, -126, 332, 252], inputs: { open: [0, 1, 1] }, desc: 'a hardback book lying flat: shut, or open to a spread of scribbled text' });

// ---- donated: boat from recipes/shots.js ----
const HULL = [[-78, 0], [78, 0], [52, 44], [-52, 44]], SAIL = [[0, -84], [-46, 0], [46, 0]];
const BOAT = { hull: poly(HULL), sail: poly(SAIL) };
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
// ---- end boat ----
