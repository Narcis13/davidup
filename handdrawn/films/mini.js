// The smallest film: a ball rolls in, then a sign-off. 3 s = 36 drawn frames.
// P1 port of docs/hand-drawn-canvas-mini/mini.html; the sign-off becomes signOff() once text.js lands.
import {
  cel, shot, seq, film, place, paper, fill, stroke, text, meta, circle, line, curve, ease, ramp, pulse,
} from '../core/index.js';

const ball = cel('ball', ({ twitch = 0 }) => [
  fill(circle(0, 0, 90), 'fills.0', { finish: true }),
  stroke(circle(0, 0, 90), 'ink', { w: 2.6, wobble: 1.8 + twitch }),
], { box: [-92, -92, 184, 184], inputs: { twitch: [0, 1, 1] }, desc: 'a hatched ball' });

const guides = cel('guides', () => [
  stroke(line(-240, 0, 240, 0), 'ink', { w: 0.9, alpha: 0.5 }),
  stroke(line(0, -240, 0, 240), 'ink', { w: 0.9, alpha: 0.5 }),
  stroke(circle(0, 0, 123), 'ink', { w: 0.9, alpha: 0.5 }),
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

const sign = shot('sign', 1, ({ t, CX, CY }) => [
  paper(),
  meta('anchor', { text: 'sign' }),
  text('mini', CX - 20, CY, { size: 96, align: 'right', reveal: ramp(0, 0.5, t) }),
  text('film', CX + 20, CY, { size: 96, reveal: ramp(0.5, 1, t) }),
]);

export default film({ name: 'mini', look: 'paperInk', timeline: seq(roll, sign) });
