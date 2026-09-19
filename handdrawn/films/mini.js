// The smallest film: a ball rolls in, then a sign-off that holds 1.5 s. 4.5 s = 54 drawn frames.
// Port of docs/hand-drawn-canvas-mini/mini.html.
import {
  cel, shot, seq, film, place, paper, fill, stroke, meta, circle, line, curve, ease, ramp, pulse, signOff, plucks, dyad,
} from '../core/index.js';

export const ball = cel('ball', ({ twitch = 0 }) => [
  fill(circle(0, 0, 90), 'fills.0', { finish: true }),
  stroke(circle(0, 0, 90), 'ink', { w: 2.6, wobble: 1.8 + twitch }),
], { box: [-92, -92, 184, 184], inputs: { twitch: [0, 1, 1] }, desc: 'a hatched ball' });

export const guides = cel('guides', () => [
  stroke(line(-240, 0, 240, 0), 'guide', { w: 0.9 }),
  stroke(line(0, -240, 0, 240), 'guide', { w: 0.9 }),
  stroke(circle(0, 0, 123), 'guide', { w: 0.9 }),
], { box: [-240, -240, 480, 480], desc: 'construction lines' });

const roll = shot('roll', 2, ({ t, i, W, CX, CY }) => {
  const x = curve([[0, CX - 400], [1.6, CX + 300]], ease.out)(t);
  return [
    paper(),
    stroke(line(0, CY + 100, W, CY + 100), 'ink', { w: 3, wobble: 2, name: 'floor' }),
    meta('anchor', { cel: 'ball' }),
    place(x, CY, { rot: x / 90 }, ball({ twitch: +pulse(i, 6) })),
    pulse(i, 6) && place(x, CY, guides()),
  ];
});

const sign = shot('sign', 2.5, ({ t, CX, CY }) => [
  paper(),
  meta('anchor', { name: 'signOff' }),
  signOff('mini', 'film', { x: CX, y: CY, pA: ramp(0, 0.5, t), pB: ramp(0.5, 1, t) }),
]);

// v1: a rising triangle pluck every 0.5 s while the ball rolls, a low sine under the sign-off.
const score = ({ shots: [r, s] }) => ({
  master: 0.5,
  events: [plucks(r.t0, r.dur, { steps: 'rise', len: 0.4 }), dyad(s.t0, s.dur, { gain: 0.3 })],
});

export default film({ name: 'mini', look: 'paperInk', timeline: seq(roll, sign), score });
