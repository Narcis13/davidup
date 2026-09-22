// FOLLOW (4.0 K6): secondary motion. sam wears a scarf of four links (a stick source's extra part with a
// chain): it jumps, and the scarf swings after the landing, a link at a time down to the tip; it bows and
// stands, and the scarf runs the other way and settles. Then the fox walks on with its tail lagging the
// walk, stops to wave (the tail overshooting into place) and falls asleep. Each actor is placed with its
// performance's state function and the time (place(x, y, s, fn, t)), so its follow parts are worked out
// from the frames before t: pure in t, the same whichever worker draws the frame.
//
// Anchor: sam, then the fox. Format 1:1, 12 fps, whiteboard.
// t      dur   shot    what changes
// 0.00   5.50  jump    stand; jump (0.75), land (1.75), bow (3.0), stand (4.0), the scarf settling
// 5.50   5.50  walk    the fox walks on (to 2.5), waves (2.5), falls asleep (4.0)
// 11.00  2.50  sign    the sign-off (13.5 s in all)
import { film, seq, shot, paper, group, meta, ramp, puppet, actorOf, stickSource, perform, stand, dyad } from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { CAST } from '../recipes/doodle.js';
fromStore(['fox']);
import { signOffShot } from '../recipes/shots.js';

// sam with a scarf: four links from the neck, trailing back, bouncy enough to swing.
const SRC = { ...stickSource({ name: 'sam' }), parts: { scarf: { parent: 'neck', pivot: 'neck', chain: { n: 4, len: 18, w: 9, angle: 60, role: 'inks.2', taper: 0.3 }, follow: { lag: 2, damp: 0.5, limit: 45 }, before: 'head' } } };
const SAM = actorOf(puppet(SRC));
const FEET = 900, S = 300, Y = FEET - 0.86 * S;
const act = perform(SAM, [[0, 'stand'], [0.75, 'jump', { dur: 0.1 }], [1.75, 'stand', { dur: 0.25 }], [3.0, 'bow', { dur: 0.4 }], [4.0, 'stand', { dur: 0.4 }]]);
const jump = shot('jump', 5.5, ({ t }) => [paper(), meta('anchor', { name: 'sam' }), SAM.place(540, Y, S, (u) => stand(SAM, act.state(u)), t)]);

const FOX = CAST.FOX;
const fact = perform(FOX, [[0, 'walk'], [2.5, 'wave', { dur: 0.3, anticipate: 0.15, overshoot: 0.1 }], [4.0, 'asleep', { dur: 0.5 }]]);
const walk = shot('walk', 5.5, ({ t }) => [paper(), meta('anchor', { name: 'fox' }), FOX.place(280 + 440 * ramp(0, 2.5, t), 640, 220, fact.state, t)]);
const sign = signOffShot({ name: 'sign', a: 'tails', b: 'follow', rings: null });
export default film({ name: 'follow', look: 'whiteboard', timeline: seq(jump, walk, sign), score: ({ shots: [a, b, s] }) => ({ master: 0.45, events: [...dyad(s.t0, s.dur)] }) });
