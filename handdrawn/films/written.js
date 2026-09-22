// WRITTEN BY HAND (4.0 T6): a caption written on the whiteboard by a drawn hand at two words a second, the
// hand coming in from the lower right, lifting off the board between words, then underlining the key word
// and leaving; the sign-off.
//
// Anchor: the caption (its box is there before a letter is). Format 1:1, 12 fps.
// t      dur   shot      what changes
// 0.00   6.33  caption   the hand comes in (0.4 s), writes 8 words at 2 a second, underlines "light", leaves
// 6.33   2.50  sign      the sign-off (8.83 s in all)
import { film, seq, shot, paper, group, stroke, spline, meta, textBox, measure, writeOn, writer, plucks, dyad } from '../core/index.js';
import { bounds } from '../core/list.js';
import { signOffShot } from '../recipes/shots.js';

const COPY = 'the moon has no light of its own';
const WRITE = { at: 0.25, per: 'word', wps: 2 };

export const caption = shot('caption', 6 + 1 / 3, ({ t, look }) => {
  const words = textBox(COPY, [170, 330, 740, 400], { size: 96, align: 'center', ink2: null, role: 'ink', seed: 7 });
  // The key word's underline, written after the caption as one more unit (a stroke weighs its length / 240).
  const light = words.lines[1] ?? words.lines[0];
  const under = stroke(spline([[light[1] + 20, light[2] + 26], [light[1] + measure('light', 96) * 0.5, light[2] + 20], [light[1] + measure('light', 96) + 6, light[2] + 28]], { n: 6 }), 'inks.2', { w: 6, wobble: 1, seed: 9, order: 1e6, name: 'underline' });
  const card = group({ name: 'caption', box: bounds([words, under]) }, [words, under]);
  return [
    paper(),
    meta('anchor', { name: 'caption' }),
    writeOn(card, { t, ...WRITE }),
    writer(card, t, { ...WRITE, look }),
  ];
});
const sign = signOffShot({ name: 'sign', a: 'written', b: 'by hand', rings: null });

// A pluck as each word lands; a dyad under the sign-off.
const score = ({ shots: [c, s] }) => ({ master: 0.45, events: [...plucks(c.t0 + 0.65, 4), ...dyad(s.t0, s.dur)] });

export default film({ name: 'written', look: 'whiteboard', timeline: seq(caption, sign), score });
