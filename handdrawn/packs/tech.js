// The tech pack: cels to place in films (plan 1.6). Cels are copied in from films by `hdf donate`
// (between the donated markers; donate again to update one) or drawn here. packs/manifest.json lists them
// with their box, inputs and description; packs/sheets/<cel>.jpg shows each in every look.

import { cel, fill, stroke, circle, rect, roundRect, poly, line, arc, union, radial } from '../core/index.js';

const TAU = Math.PI * 2;
const LINE = { w: 2.6, wobble: 1.6 };

// A fan: a ring and five blades turned by `a`.
const fanOf = (cx, cy, r, a) => union(...Array.from({ length: 5 }, (_, k) => {
  const b = a + k / 5 * TAU, c = Math.cos(b), s = Math.sin(b), q = r * 0.86;
  return poly([[cx + c * r * 0.2, cy + s * r * 0.2], [cx + (c * 0.8 - s * 0.5) * q, cy + (s * 0.8 + c * 0.5) * q], [cx + c * q, cy + s * q]]);
}));

// A graphics card seen from the side it cools: a board with two fans and a gold edge connector along the
// bottom, centred on the origin. spin: fan angle as a turn fraction (0..1); hot: 0 | 1 heat wiggles above.
export const gpu = cel('gpu', ({ spin = 0, hot = 0 }) => {
  const board = roundRect(-170, -70, 340, 130, 10), shroud = roundRect(-160, -62, 320, 106, 16);
  const a = spin * TAU / 5;
  const fans = [-80, 80].flatMap((x, k) => {
    const ring = circle(x, -9, 44, 36);
    return [fill(ring, 'shade', { name: `fan${k}` }), fill(fanOf(x, -9, 42, a + k), 'light', { name: `blades${k}` }), stroke(ring, 'ink', { w: 2.2, wobble: 1 }), fill(circle(x, -9, 7, 12), 'ink')];
  });
  const pins = union(...Array.from({ length: 16 }, (_, k) => rect(-120 + k * 12, 60, 7, 16)));
  return [
    fill(board, 'fills.3', { name: 'board' }), stroke(board, 'ink', LINE),
    fill(pins, 'accents.2', { name: 'pins' }), stroke(line(-124, 60, 72, 60), 'ink', { w: 1.6, wobble: 0.6 }),
    fill(shroud, 'fills.1', { finish: true, name: 'shroud' }), stroke(shroud, 'ink', LINE),
    ...fans,
    hot && stroke(union(...[-110, -40, 30, 100].map((x) => poly([[x, -84], [x + 8, -100], [x - 4, -116], [x + 6, -132]], false))), 'accents.0', { w: 2.4, wobble: 1.4, name: 'heat' }),
  ];
}, { box: [-176, -140, 352, 220], inputs: { spin: [0, 1, 0.125], hot: [0, 1, 1] }, desc: 'a graphics card: board, two fans, gold edge pins; spin turns the fans, hot adds heat lines' });

// A rack server: `units` stacked 1U boxes (1 to 6) with drive bays and a status light each, bottom on y = 0.
// load: how many lights are lit (0..units), the rest dark.
export const server = cel('server', ({ units = 4, load = 2 }) => {
  const u = 44, out = [];
  const frame = roundRect(-130, -units * u - 14, 260, units * u + 14, 8);
  out.push(fill(frame, 'shade', { name: 'rack' }), stroke(frame, 'ink', LINE));
  for (let k = 0; k < units; k++) {
    const y = -(k + 1) * u - 6, box = roundRect(-120, y, 240, u - 6, 5);
    out.push(fill(box, 'fills.1', { finish: true, name: `u${k}` }), stroke(box, 'ink', { w: 2.2, wobble: 1.2, name: `u${k}Line` }));
    out.push(stroke(union(...Array.from({ length: 5 }, (_, j) => rect(-104 + j * 30, y + 8, 22, u - 22))), 'ink', { w: 1.4, wobble: 0.8, alpha: 0.8, name: `bays${k}` }));
    const lit = k < load, led = circle(92, y + (u - 6) / 2, 6, 12);
    out.push(fill(led, lit ? 'accents.3' : { base: 'ink', alpha: 0.35 }, { name: `led${k}` }));
    if (lit) out.push(fill(circle(92, y + (u - 6) / 2, 16, 20), 'accents.3', { cov: radial(92, y + (u - 6) / 2, 4, 16, 0.5, 0), name: `glow${k}` }));
  }
  return out;
}, { box: [-134, -282, 268, 286], inputs: { units: [1, 6, 1], load: [0, 6, 1] }, desc: 'a rack server of 1 to 6 units on y = 0, each with drive bays and a status light; load lights them' });

// A token: a rounded tile (a word-piece of a model's input) with a scribbled glyph, centred on the origin.
// hue picks accents.0..3; glow 0 | 1 rings it as the one being read.
export const token = cel('token', ({ hue = 0, glow = 0 }) => {
  const tile = roundRect(-46, -30, 92, 60, 14);
  return [
    glow && fill(roundRect(-64, -48, 128, 96, 26), `accents.${hue}`, { cov: radial(0, 0, 30, 70, 0.55, 0), name: 'glow' }),
    fill(tile, { base: `accents.${hue}`, tint: 0.35 }, { name: 'tile' }),
    stroke(poly([[-24, 8], [-14, -12], [-4, 8], [6, -12], [16, 8], [24, -6]], false), 'ink', { w: 3, wobble: 1.2, name: 'glyph' }),
    stroke(tile, 'ink', { w: 2.4, wobble: 1.4 }),
  ];
}, { box: [-66, -50, 132, 100], inputs: { hue: [0, 3, 1], glow: [0, 1, 1] }, desc: 'a token tile with a scribbled glyph; hue picks accents.0-3, glow marks it' });

// A chip seen from above: a square package with pins on four sides and a die, centred on the origin.
// pulse: 0 | 1 lights traces running out from the die.
export const chip = cel('chip', ({ pulse = 0 }) => {
  const pkg = roundRect(-70, -70, 140, 140, 10), die = roundRect(-34, -34, 68, 68, 4), pins = [];
  for (let k = 0; k < 7; k++) {
    const p = -54 + k * 18;
    pins.push(rect(p - 4, -90, 8, 20), rect(p - 4, 70, 8, 20), rect(-90, p - 4, 20, 8), rect(70, p - 4, 20, 8));
  }
  const traces = union(...[[-34, -12, -62, -12, -62, -40], [34, 14, 60, 14, 60, 44], [-12, 34, -12, 58], [12, -34, 12, -60, 40, -60]].map((q) => poly(q, false)));
  return [
    fill(union(...pins), 'accents.2', { name: 'pins' }), stroke(union(...pins), 'ink', { w: 1.2, wobble: 0.4, alpha: 0.7 }),
    fill(pkg, 'shade', { finish: true, name: 'package' }), stroke(pkg, 'ink', LINE),
    stroke(traces, pulse ? 'accents.2' : { base: 'light', alpha: 0.5 }, { w: pulse ? 3 : 2, wobble: 0.6, name: 'traces' }),
    fill(die, 'fills.1', { name: 'die' }), stroke(die, 'ink', { w: 2.2, wobble: 1 }),
    fill(circle(-52, -52, 5, 12), 'light', { name: 'dot' }),
    stroke(arc(0, 0, 18, 0.3, 2.2), 'ink', { w: 1.6, wobble: 0.6, alpha: 0.6, name: 'mark' }),
  ];
}, { box: [-92, -92, 184, 184], inputs: { pulse: [0, 1, 1] }, desc: 'a chip from above: package, pins on four sides, die; pulse lights its traces' });
