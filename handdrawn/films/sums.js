// SUMS (4.0 T8): numbers on the board. A drawn hand writes "2 + 3 = ?"; two apples, then three, pop in under
// it, each numbered as it lands (countOn) while a tally grows a mark an apple; as the fifth lands the hand comes
// back and the ? gives way to a 5, which is ringed. Then the twelve months are written round a ring (textRound:
// upright all the way round, clockwise on the top half, the other way on the bottom), a tally in the middle
// counting them; the sign-off. For a kids-9 audience.
//
// Anchor: the sum (its box is there before a figure is), then the ring. Format 1:1, 12 fps.
// t      dur    shot     what changes                                                   sound
// 0.00   10.08  sum      the hand writes the sum and leaves; five apples at 0.8 s each,  the marker a word at a
//                        numbered, tallied; the hand writes 5 in the ?'s place, ringed   time; a pop an apple; a ding
// 10.08  9.50   months   the ring drawn, the hand writes the months (2 a second), a      the marker; a tick a mark
//                        tally mark each; the hand leaves, the ring holds
// 19.58  2.50   sign     the sign-off (22.08 s in all)
import {
  film, seq, shot, paper, group, meta, stroke, circle, ramp, ease, equation, pictograph, tally, countOn, countTimes, textRound,
  circleAround, reveal, writeOn, writer, writing, pop, ding, tick, writerSounds, dyad,
} from '../core/index.js';
import { bounds } from '../core/list.js';
import { apple, signOffShot } from '../recipes/shots.js';

const audience = 'kids-9';
const SUM = { answer: 5, x: 540, y: 330, size: 170, seed: 23 };
const WRITE = { at: 0.25, per: 'word', wps: 2 };

// The sum with its ? (p 0.5: written, not resolved), and the answer alone, for the hand to follow.
const ASKED = equation('2 + 3 = ?', { ...SUM, p: 0.5 });
const ANSWER = group('answer', equation('2 + 3 = ?', { ...SUM, p: 1 }).kids.filter((k) => k.name === 'text:5'));
const asked = writing(ASKED, WRITE);
// The apples: two under the 2, three under the 3, a beat each once the hand has gone.
const PER = 0.8, T0 = asked.end + 0.5, TIMES = countTimes(5, { t0: T0, per: PER });
const GROUPS = [{ n: 2, x: 330, from: 0 }, { n: 3, x: 700, from: 2 }], CELL = 130, ROW = 560;
const XS = [265, 395, 570, 700, 830];
const RESOLVE = { ...WRITE, at: TIMES[4] + PER + 0.2 };
const answered = writing(ANSWER, RESOLVE);
const RING_AT = answered.end + 0.3;
const SUM_DUR = Math.ceil((RING_AT + 0.5 + 1.5) * 12) / 12;

// How far apple j has popped in by t (0..1 over a quarter second from its time).
const popped = (t, j) => ramp(TIMES[j], TIMES[j] + 0.25, t, ease.linear);
const FULL = bounds([equation('2 + 3 = ?', SUM), pictograph(5, apple, { x: 540, y: ROW, cols: 5, cell: CELL }), tally(5, { x: 440, y: 780, h: 100 })]);

export const sum = shot('sum', SUM_DUR, ({ t, look }) => {
  const before = t < RESOLVE.at;
  // The sum: written by the hand, then resolving as the second writing's progress passes the ?.
  const eq = before ? writeOn(ASKED, { t, ...WRITE }) : equation('2 + 3 = ?', { ...SUM, p: 0.5 + 0.5 * answered.p(t) });
  const apples = GROUPS.map((g) => pictograph(g.n, apple, { x: g.x, y: ROW, cols: g.n, cell: CELL, name: `apples${g.from}`, p: Array.from({ length: g.n }, (_, j) => popped(t, g.from + j)).reduce((a, b) => a + b, 0) / g.n }));
  const marks = TIMES.reduce((a, _, j) => a + ramp(TIMES[j] + 0.15, TIMES[j] + 0.45, t, ease.linear), 0);
  const slot = equation('2 + 3 = ?', SUM).slots[0];
  return [
    paper(),
    meta('anchor', { name: 'sum' }),
    group({ name: 'sum', box: FULL }, [
      eq,
      ...apples,
      countOn(5, t, { t0: T0 + 0.1, per: PER, at: XS.map((x) => [x, ROW + 110]), size: 64, seed: 5 }),
      tally(marks, { x: 440, y: 780, h: 100, role: 'inks.1', seed: 9 }),
      t >= RING_AT && circleAround(slot, ramp(RING_AT, RING_AT + 0.5, t), { role: 'accents.0', name: 'answer', pad: 22 }),
    ]),
    before ? writer(ASKED, t, { ...WRITE, look }) : writer(ANSWER, t, { ...RESOLVE, look }),
  ];
});

// The months round a ring, january at the top, each centred on its twelfth; lettered outside the ring. Each
// month's strokes are numbered past the last's (order), so one writeOn writes them in turn, not all at once.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const R = 360, RING = { x: 540, y: 540 };
const NAMES = group({ name: 'months' }, MONTHS.map((m, i) => textRound(m, { ...RING, r: R, at: -Math.PI / 2 + i / 12 * Math.PI * 2, size: 40, ink2: null, seed: 40 + i, order: i * 1000 })));
const WRITE2 = { at: 1, per: 'word', wps: 2 };
const months = writing(NAMES, WRITE2);
// When each month is written (its unit's end), for its tally mark.
const DONE = months.units.map((u) => u.t2);

export const ring = shot('months', Math.ceil((months.end + 1.5) * 12) / 12, ({ t, look }) => {
  const marks = DONE.reduce((a, d) => a + ramp(d, d + 0.2, t, ease.linear), 0);
  return [
    paper(),
    meta('anchor', { name: 'year' }),
    group({ name: 'year', box: bounds([stroke(circle(RING.x, RING.y, R + 40), 'ink')]) }, [
      reveal(ramp(0.15, 0.85, t), stroke(circle(RING.x, RING.y, R, 72), 'inks.1', { w: 4, seed: 3, name: 'ring' })),
      writeOn(NAMES, { t, ...WRITE2 }),
      tally(marks, { x: RING.x - 125, y: RING.y - 50, h: 100, seed: 12 }),
    ]),
    writer(NAMES, t, { ...WRITE2, look }),
  ];
});

const sign = signOffShot({ name: 'sign', a: 'sums', b: 'and months', rings: null });

// The marker on each word, a pop an apple, a ding as the 5 is ringed, a tick a month's tally mark.
const score = ({ shots: [s, m, g] }) => ({
  master: 0.45,
  events: [
    writerSounds(ASKED, { ...WRITE, t0: s.t0, tool: 'marker' }),
    TIMES.map((t) => pop(s.t0 + t)),
    writerSounds(ANSWER, { ...RESOLVE, t0: s.t0, tool: 'marker' }),
    ding(s.t0 + RING_AT),
    writerSounds(NAMES, { ...WRITE2, t0: m.t0, tool: 'marker' }),
    DONE.map((d) => tick(m.t0 + d, { gain: 0.1 })),
    dyad(g.t0, g.dur),
  ],
});

export default film({ name: 'sums', look: 'whiteboard', audience, timeline: seq(sum, ring, sign), score });
