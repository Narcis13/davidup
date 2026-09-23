// SAM AND THE REAL MOON. The moon film's sam as an overlay clip (4.0 D1): drawn in chalk on no stock
// (render --alpha), so a davidup composition puts him over a photograph of the real moon. Its cuts are the
// composition's: the music track's `cut` markers (D4), read with atMark; with no marks it plays to its own.
// A clip (meta intent): davidup captions and signs off (D3, in the film's hand exported as a font).
//
// Anchor: sam. Format 1:1, 12 fps, chalkboard. With the fallback marks:
// t      dur   shot    what changes
// 0.00   4.00  hello   sam walks on from the left (planted feet) and waves at us
// 4.00   4.00  look    he turns to the moon (up and to the right, off his frame), looks up at it and points
// 8.00   4.00  night   he presents it, happy, then bows goodnight
import { film, shot, seq, paper, fill, ellipse, meta, perform, walkTo, stand, lookAt, reach, partAt, ramp, ease, puppet, actorOf, atMark, plucks, note, pentHz } from '../core/index.js';
import { fromStore } from '../core/assets.js';

fromStore(['sam']);
const sam = actorOf(puppet('sam'));
export const cast = { sam };

export const CUT1 = atMark('cut', { nth: 0, or: 4 }), CUT2 = atMark('cut', { nth: 1, or: 8 }), END = atMark('end', { or: 12 });
const FEET = 1000, S = 400, Y = FEET - 0.86 * S, X = 520, MOON = [1500, -300];   // the photo's moon, off the clip's frame

const walk = walkTo(sam, -200, X, 0.2, null, { s: S });
const greet = perform(sam, [[0, stand(sam, sam.look(0))], [walk.end + 0.15, ['wave', 'happy'], { dur: 0.3, anticipate: 0.1 }]]);
const at = [X, Y, S];
const facing = stand(sam, sam.look(1));
const up = lookAt(sam, MOON, { at, state: facing });
const pointing = perform(sam, [[0, facing], [0.3, up, { dur: 0.3 }], [1.0, 'surprised', { dur: 0.3 }]]);
const bye = perform(sam, [[0, { ...facing, ...sam.look(0) }], [0.2, ['present', 'happy'], { dur: 0.3 }], [2.2, ['bow', 'sleep'], { dur: 0.5, anticipate: 0.15 }]]);

const shadow = fill(ellipse(X, FEET + 8, 150, 20), 'shade', { alpha: 0.3, name: 'shadow' });
const frame = (state, x, last = false) => [
  paper(),
  meta('anchor', { cel: 'sam' }), meta('intent', 'crop'), last && meta('intent', 'clip'),
  x === X && shadow,
  sam.place(x, Y, S, state),
];
const hello = shot('hello', CUT1, ({ t }) => {
  const walking = t < walk.end + 0.1;
  return frame(walking ? walk.state(t) : greet.state(t), walking ? walk.x(t) : X);
}, { recipe: 'hello' });
// The arm up towards the moon: from where the hand hangs to a point up and to the right, eased on the twos.
const HANG = partAt(sam, 'hand-r', at, facing), AIM = [X + 260, Y - 460];
const twos = (t) => Math.floor(t * 6 + 1e-9) / 6;
const aim = (t) => { const k = ease.io(ramp(1.0, 1.5, twos(t))); return [HANG[0] + (AIM[0] - HANG[0]) * k, HANG[1] + (AIM[1] - HANG[1]) * k]; };
const look = shot('look', CUT2 - CUT1, ({ t }) => {
  const state = pointing.state(t);
  return frame(t >= 1.0 ? { ...state, ...reach(sam, 'hand-r', aim(t), { at, state }) } : state, X);
}, { recipe: 'look' });
const night = shot('night', END - CUT2, ({ t }) => frame(bye.state(t), X, true), { recipe: 'night' });

// A step a footfall, a pluck on each cut, a low one as he bows.
const score = ({ shots: [h, l, n] }) => ({
  master: 0.4,
  events: [
    walk.steps.map((t, j) => note(h.t0 + t, pentHz(0, j % 2 ? 2 : 0), 0.12, 'triangle', 0.06)),
    plucks(l.t0 + 0.3, 1, { steps: 'rise', len: 0.3 }), plucks(n.t0 + 0.2, 1, { len: 0.3 }),
    note(n.t0 + 2.2, pentHz(-1, 0), 0.8, 'sine', 0.1),
  ],
});

export default film({ name: 'sam-moon', look: 'chalkboard', timeline: seq(hello, look, night), score, assets: ['sam'] });
