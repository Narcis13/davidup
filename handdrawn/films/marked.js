// MARKED UP (4.0 T7): the teacher's pen. A sentence is written on the whiteboard by a drawn hand, then the same
// hand marks it up, each mark drawing on in turn: an underline under "light", a circle round "sun", and a
// label, "a star", written beside it with an arrow to the circle; the sign-off. The marks are pen strokes in
// the look's pen and hand, so they overshoot and hook as the lettering does, and they are not words.
//
// Anchor: the sentence (its box is there before a letter is). Format 1:1, 12 fps.
// t      dur   shot      what changes
// 0.00   9.00  marks     the hand comes in, writes 8 words at 2.5 a second, underlines "light", circles "sun",
//                        writes "a star" and draws its arrow to the circle, leaves; the card holds
// 9.00   2.50  sign      the sign-off (11.5 s in all)
import { film, seq, shot, paper, group, meta, textBox, wordBox, underline, circleAround, callout, writeOn, writer, plucks, dyad } from '../core/index.js';
import { bounds } from '../core/list.js';
import { signOffShot } from '../recipes/shots.js';

const COPY = 'the moon borrows its light from the sun';
const WRITE = { at: 0.25, per: 'word', wps: 2.5 };

export const marks = shot('marks', 9, ({ t, look }) => {
  const words = textBox(COPY, [150, 360, 780, 330], { size: 92, align: 'center', ink2: null, role: 'ink', seed: 7 });
  // Each mark comes after the one before (order), so one writeOn schedules the whole card: the words, then the
  // marks, each a unit of its own (a stroke weighs its length / 240 words).
  const sun = wordBox(words, 'sun');
  const ring = circleAround(sun, { order: 2e6, name: 'sun' });
  const card = [
    words,
    underline(wordBox(words, 'light'), { order: 1e6, role: 'inks.2' }),
    ring,
    callout('a star', ring, { order: 3e6, leader: 'arrow', dir: Math.PI / 2, reach: 150, size: 64, curve: -0.25 }),
  ];
  const node = group({ name: 'card', box: bounds(card) }, card);
  return [
    paper(),
    meta('anchor', { name: 'card' }),
    writeOn(node, { t, ...WRITE }),
    writer(node, t, { ...WRITE, look }),
  ];
});
const sign = signOffShot({ name: 'sign', a: 'marked', b: 'up', rings: null });

// A pluck as each word lands; a dyad under the sign-off.
const score = ({ shots: [m, s] }) => ({ master: 0.45, events: [...plucks(m.t0 + 0.65, 4), ...dyad(s.t0, s.dur)] });

export default film({ name: 'marked', look: 'whiteboard', timeline: seq(marks, sign), score });
