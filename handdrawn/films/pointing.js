// POINTING (4.0 K4): sam, a stick teacher, directed by a pose timeline. It points at three labels in turn,
// each point wound up the other way first (anticipation) and carried a little past (overshoot), the label
// written on as the arm lands, then it cheers. Between the moves the pose holds, so those drawn frames are
// the same list and dedup.
//
// Anchor: the labels. Format 1:1, 12 fps, whiteboard.
// t      dur   shot    what changes
// 0.00   7.25  point   idle; up at "sun" (0.5), across at "cloud" (2.25), down at "rain" (4.0), cheer (5.75)
// 7.25   2.50  sign    the sign-off (9.75 s in all)
import { film, seq, shot, paper, fill, stroke, circle, line, spline, group, meta, handText, reveal, ramp, puppet, actorOf, stickSource, perform, dyad } from '../core/index.js';
import { signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const X = 250, FEET = 960, S = 260;   // sam's stage place: centre x, feet, size (2 of these tall)
const WIND = { anticipate: 0.17, overshoot: 0.1, dur: 1 / 3 };

// Where each label sits, what it says, and the arm's angle and the head's tilt that point at it.
const LABELS = [
  { text: 'sun', at: [640, 230], arm: -136, head: -8 },
  { text: 'cloud', at: [700, 500], arm: -106, head: -2 },
  { text: 'rain', at: [660, 770], arm: -68, head: 8 },
];

export const act = perform(SAM, [
  [0, ['idle', { dir: 0 }]],
  ...LABELS.map((l, j) => [0.5 + 1.75 * j, ['point-r', { 'arm-r': l.arm, head: l.head }], WIND]),
  [5.75, ['cheer', 'happy'], WIND],
]);

// A little drawing beside each word: rays, a cloud, three drops.
const ICONS = [
  ([x, y]) => [stroke(circle(x, y, 34, 24), 'inks.2', { w: 5, wobble: 1, seed: 3 }), ...Array.from({ length: 8 }, (_, k) => {
    const a = k * Math.PI / 4;
    return stroke(line(x + Math.cos(a) * 48, y + Math.sin(a) * 48, x + Math.cos(a) * 66, y + Math.sin(a) * 66), 'inks.2', { w: 4, wobble: 0.5, seed: 4 + k });
  })],
  ([x, y]) => [stroke(spline([[x - 60, y + 20], [x - 58, y - 10], [x - 25, y - 22], [x, y - 44], [x + 34, y - 26], [x + 62, y - 6], [x + 58, y + 20]], { n: 6 }), 'inks.1', { w: 5, wobble: 1, seed: 12 }),
    stroke(line(x - 60, y + 20, x + 58, y + 20), 'inks.1', { w: 5, wobble: 1, seed: 13 })],
  ([x, y]) => [-36, 0, 36].map((dx, k) => stroke(spline([[x + dx, y - 30], [x + dx - 12, y + 4], [x + dx, y + 16], [x + dx + 12, y + 4], [x + dx, y - 30]], { n: 5 }), 'inks.1', { w: 4, wobble: 0.5, seed: 20 + k })),
];

export const point = shot('point', 7.25, ({ t }) => {
  const labels = LABELS.map((l, j) => {
    const land = act.beats[j + 1].land, p = ramp(land, land + 0.6, t);
    if (p <= 0) return null;
    const kids = [...ICONS[j](l.at), handText(l.text, l.at[0] + 100, l.at[1] + 18, { size: 64, ink2: null, role: 'ink', seed: 30 + j })];
    return group(`label${j}`, [p >= 1 ? group('drawn', kids) : reveal(p, group('drawn', kids))]);
  });
  return [
    paper(),
    meta('anchor', { name: 'labels' }),
    group({ name: 'labels', box: [560, 150, 460, 700] }, labels),
    SAM.place(X, FEET - 0.86 * S, S, act.state(t)),
  ];
}, { recipe: 'point' });

const sign = signOffShot({ name: 'sign', a: 'sam', b: 'points', rings: null });

// A pluck as each point lands, a dyad under the sign-off.
const score = ({ shots: [p, s] }) => ({ master: 0.45, events: [...act.events(p.t0), ...dyad(s.t0, s.dur)] });

export default film({ name: 'pointing', look: 'whiteboard', timeline: seq(point, sign), score });
